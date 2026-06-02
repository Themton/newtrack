/* หน้า Admin — auth + จัดการพัสดุ + ประวัติการขนส่ง */
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let parcels = [];      // cache
let editingId = null;  // id ที่กำลังแก้ไข (null = เพิ่มใหม่)

/* ---------- toast ---------- */
let toastT;
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.className = 'toast ' + type, 2600);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- เติม select สถานะ ---------- */
function fillStatusSelect(el) {
  el.innerHTML = PARCEL_STATUSES.map(s => `<option value="${s.key}">${s.icon} ${s.label}</option>`).join('');
}
fillStatusSelect($('pStatus'));
fillStatusSelect($('evStatus'));

/* ============================================================
   AUTH
   ============================================================ */
async function refreshSession() {
  const { data } = await db.auth.getSession();
  const session = data.session;
  if (session) {
    $('loginView').classList.add('hidden');
    $('dashView').classList.remove('hidden');
    $('userTag').textContent = session.user.email;
    loadParcels();
  } else {
    $('dashView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'กำลังเข้าสู่ระบบ…';
  const { error } = await db.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });
  $('loginBtn').disabled = false;
  $('loginBtn').textContent = 'เข้าสู่ระบบ';
  if (error) { toast('เข้าสู่ระบบไม่สำเร็จ: ' + error.message, 'err'); return; }
  refreshSession();
});

$('logoutBtn').addEventListener('click', async () => {
  await db.auth.signOut();
  refreshSession();
});

/* ============================================================
   LOAD + RENDER TABLE
   ============================================================ */
async function loadParcels() {
  const { data, error } = await db.from('parcels').select('*').order('updated_at', { ascending: false });
  if (error) { toast('โหลดข้อมูลไม่สำเร็จ: ' + error.message, 'err'); return; }
  parcels = data || [];
  renderStats();
  renderTable();
}

function renderStats() {
  const total = parcels.length;
  const transit = parcels.filter(p => ['picked_up', 'at_sorting', 'in_transit', 'out_for_delivery'].includes(p.status)).length;
  const delivered = parcels.filter(p => p.status === 'delivered').length;
  const problem = parcels.filter(p => ['failed', 'returned'].includes(p.status)).length;
  const items = [['ทั้งหมด', total], ['กำลังขนส่ง', transit], ['ส่งสำเร็จ', delivered], ['มีปัญหา', problem]];
  $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
}

function renderTable() {
  const q = $('filterInput').value.trim().toLowerCase();
  const rows = parcels.filter(p =>
    !q || p.tracking_no.toLowerCase().includes(q) || (p.receiver_name || '').toLowerCase().includes(q));
  $('emptyRow').classList.toggle('hidden', rows.length > 0);
  $('tbody').innerHTML = rows.map(p => {
    const s = statusInfo(p.status);
    return `<tr>
      <td class="tno-cell">${esc(p.tracking_no)}</td>
      <td>${esc(p.receiver_name || '-')}</td>
      <td><span class="pill" style="background:${s.color}">${s.icon} ${s.label}</span></td>
      <td>${fmtDateTime(p.updated_at)}</td>
      <td><div class="act" style="justify-content:flex-end">
        <button class="btn ghost sm" data-edit="${p.id}">แก้ไข</button>
        <button class="btn danger sm" data-del="${p.id}">ลบ</button>
      </div></td>
    </tr>`;
  }).join('');
}

$('filterInput').addEventListener('input', renderTable);

/* event delegation บนตาราง */
$('tbody').addEventListener('click', (e) => {
  const editId = e.target.getAttribute('data-edit');
  const delId = e.target.getAttribute('data-del');
  if (editId) openModal(parcels.find(p => p.id === editId));
  if (delId) deleteParcel(delId);
});

/* ============================================================
   MODAL (เพิ่ม / แก้ไข)
   ============================================================ */
function openModal(parcel) {
  editingId = parcel ? parcel.id : null;
  $('modalTitle').textContent = parcel ? 'แก้ไขพัสดุ' : 'เพิ่มพัสดุ';
  $('pId').value = parcel?.id || '';
  $('pTno').value = parcel?.tracking_no || '';
  $('pTno').disabled = !!parcel; // ไม่ให้แก้เลขพัสดุหลังสร้าง
  $('pSenderName').value = parcel?.sender_name || '';
  $('pSenderPhone').value = parcel?.sender_phone || '';
  $('pReceiverName').value = parcel?.receiver_name || '';
  $('pReceiverPhone').value = parcel?.receiver_phone || '';
  $('pReceiverAddress').value = parcel?.receiver_address || '';
  $('pWeight').value = parcel?.weight ?? '';
  $('pCod').value = parcel?.cod_amount ?? '';
  $('pStatus').value = parcel?.status || 'created';
  $('pNote').value = parcel?.note || '';

  // events editor เฉพาะตอนแก้ไข
  $('eventsBlock').classList.toggle('hidden', !parcel);
  if (parcel) loadEvents(parcel.id);

  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); editingId = null; }
$('modalClose').addEventListener('click', closeModal);
$('newBtn').addEventListener('click', () => openModal(null));
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

$('parcelForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    tracking_no: $('pTno').value.trim().toUpperCase(),
    sender_name: $('pSenderName').value.trim() || null,
    sender_phone: $('pSenderPhone').value.trim() || null,
    receiver_name: $('pReceiverName').value.trim() || null,
    receiver_phone: $('pReceiverPhone').value.trim() || null,
    receiver_address: $('pReceiverAddress').value.trim() || null,
    weight: $('pWeight').value ? Number($('pWeight').value) : null,
    cod_amount: $('pCod').value ? Number($('pCod').value) : 0,
    status: $('pStatus').value,
    note: $('pNote').value.trim() || null,
  };
  $('saveBtn').disabled = true;

  let res;
  if (editingId) {
    res = await db.from('parcels').update(payload).eq('id', editingId);
  } else {
    res = await db.from('parcels').insert(payload).select().single();
  }
  $('saveBtn').disabled = false;

  if (res.error) { toast('บันทึกไม่สำเร็จ: ' + res.error.message, 'err'); return; }

  if (!editingId && res.data) {
    // พัสดุใหม่ -> ใส่ event แรกให้อัตโนมัติ
    await db.from('tracking_events').insert({
      parcel_id: res.data.id, status: payload.status, description: 'รับเข้าระบบเรียบร้อย'
    });
  }
  toast('บันทึกเรียบร้อย', 'ok');
  closeModal();
  loadParcels();
});

async function deleteParcel(id) {
  const p = parcels.find(x => x.id === id);
  if (!confirm(`ลบพัสดุ ${p?.tracking_no} ?\n(ประวัติการขนส่งจะถูกลบด้วย)`)) return;
  const { error } = await db.from('parcels').delete().eq('id', id);
  if (error) { toast('ลบไม่สำเร็จ: ' + error.message, 'err'); return; }
  toast('ลบเรียบร้อย', 'ok');
  loadParcels();
}

/* ============================================================
   EVENTS (ประวัติการขนส่ง)
   ============================================================ */
async function loadEvents(parcelId) {
  const { data, error } = await db.from('tracking_events')
    .select('*').eq('parcel_id', parcelId).order('event_time', { ascending: false });
  if (error) { $('evList').innerHTML = `<li><small>โหลดประวัติไม่สำเร็จ</small></li>`; return; }
  renderEvents(data || []);
}

function renderEvents(events) {
  if (!events.length) { $('evList').innerHTML = `<li><small>ยังไม่มีประวัติ</small></li>`; return; }
  $('evList').innerHTML = events.map(e => {
    const s = statusInfo(e.status);
    return `<li>
      <div class="grow">
        <div><b>${s.icon} ${s.label}</b></div>
        <small>${fmtDateTime(e.event_time)}${e.location ? ' · ' + esc(e.location) : ''}</small>
        ${e.description ? `<div style="font-size:.9rem">${esc(e.description)}</div>` : ''}
      </div>
      <button class="btn danger sm" data-delev="${e.id}">ลบ</button>
    </li>`;
  }).join('');
}

$('addEvBtn').addEventListener('click', async () => {
  if (!editingId) return;
  const payload = {
    parcel_id: editingId,
    status: $('evStatus').value,
    location: $('evLocation').value.trim() || null,
    description: $('evDesc').value.trim() || null,
  };
  const { error } = await db.from('tracking_events').insert(payload);
  if (error) { toast('เพิ่มสถานะไม่สำเร็จ: ' + error.message, 'err'); return; }
  // trigger ในฐานข้อมูลจะอัปเดตสถานะล่าสุดของพัสดุให้เอง
  $('evLocation').value = ''; $('evDesc').value = '';
  $('pStatus').value = payload.status;
  toast('เพิ่มสถานะแล้ว', 'ok');
  loadEvents(editingId);
  loadParcels();
});

$('evList').addEventListener('click', async (e) => {
  const id = e.target.getAttribute('data-delev');
  if (!id) return;
  if (!confirm('ลบรายการสถานะนี้?')) return;
  const { error } = await db.from('tracking_events').delete().eq('id', id);
  if (error) { toast('ลบไม่สำเร็จ: ' + error.message, 'err'); return; }
  loadEvents(editingId);
});

/* ============================================================
   START
   ============================================================ */
if (SUPABASE_URL.includes('YOUR-PROJECT')) {
  toast('⚠️ ยังไม่ได้ตั้งค่า Supabase ใน assets/config.js', 'err');
}
refreshSession();
db.auth.onAuthStateChange(() => refreshSession());
