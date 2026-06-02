/* หน้าเช็คพัสดุ (ลูกค้า) */
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const sections = ['loading', 'notfound', 'errorBox', 'result'];
function show(id) {
  sections.forEach(s => $(s).classList.toggle('hidden', s !== id));
}

async function track(no) {
  const tno = (no || '').trim().toUpperCase();
  if (!tno) return;
  show('loading');
  history.replaceState(null, '', '#' + encodeURIComponent(tno));

  try {
    const { data, error } = await db.rpc('track_parcel', { p_tracking_no: tno });
    if (error) throw error;
    if (!data) { show('notfound'); return; }
    render(data);
  } catch (e) {
    $('errorMsg').textContent = e.message || 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ — ตรวจสอบค่าใน config.js';
    show('errorBox');
  }
}

function render(p) {
  $('resTno').textContent = p.tracking_no;

  const info = statusInfo(p.status);
  const badge = $('resBadge');
  badge.innerHTML = `<span>${info.icon}</span> ${info.label}`;
  badge.style.background = info.color;
  badge.style.color = '#fff';

  // progress flow
  const isFail = p.status === 'failed' || p.status === 'returned';
  const reached = FLOW_STEPS.indexOf(p.status);
  const flow = $('flow');
  flow.innerHTML = '';
  const fillPct = reached < 0 ? 0 : (reached / (FLOW_STEPS.length - 1)) * 88;
  const fill = document.createElement('div');
  fill.className = 'fill';
  fill.style.width = isFail ? '0%' : fillPct + '%';
  flow.appendChild(fill);
  FLOW_STEPS.forEach((key, i) => {
    const s = statusInfo(key);
    const step = document.createElement('div');
    step.className = 'step' + (i < reached ? ' done' : i === reached ? ' current' : '');
    step.innerHTML = `<div class="dot">${s.icon}</div><small>${s.label}</small>`;
    flow.appendChild(step);
  });

  // timeline
  const tl = $('timeline');
  tl.innerHTML = '';
  const events = p.events || [];
  if (!events.length) {
    tl.innerHTML = '<li class="tl-item"><div class="meta">ยังไม่มีประวัติการขนส่ง</div></li>';
  } else {
    events.forEach((e, i) => {
      const s = statusInfo(e.status);
      const li = document.createElement('li');
      li.className = 'tl-item' + (i === 0 ? ' latest' : '');
      li.innerHTML = `
        <span class="pin">${s.icon}</span>
        <div class="st">${s.label}</div>
        <div class="meta">${fmtDateTime(e.event_time)}${e.location ? ' · ' + escapeHtml(e.location) : ''}</div>
        ${e.description ? `<div class="desc">${escapeHtml(e.description)}</div>` : ''}`;
      tl.appendChild(li);
    });
  }

  // info boxes
  const boxes = [];
  if (p.receiver_name) boxes.push(['ผู้รับ', p.receiver_name]);
  if (p.weight != null) boxes.push(['น้ำหนัก', p.weight + ' กก.']);
  if (p.cod_amount) boxes.push(['เก็บเงินปลายทาง', Number(p.cod_amount).toLocaleString() + ' ฿']);
  boxes.push(['อัปเดตล่าสุด', fmtDateTime(p.updated_at)]);
  $('info').innerHTML = boxes.map(([k, v]) =>
    `<div class="box"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`).join('');

  show('result');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* events */
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); track($('trackInput').value); });
$('demoLink').addEventListener('click', (e) => { e.preventDefault(); $('trackInput').value = 'FL1234567890'; track('FL1234567890'); });

/* deep link via hash */
window.addEventListener('DOMContentLoaded', () => {
  const h = decodeURIComponent(location.hash.replace('#', ''));
  if (h) { $('trackInput').value = h; track(h); }
});
