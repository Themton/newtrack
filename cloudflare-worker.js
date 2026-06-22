// ===== Flash Proxy + Auto-Sync Worker v3.1 (trackmt) =====
// Flash API Proxy + Supabase Proxy + Auto-Sync สถานะ Flash (รองรับ 1000+ ออเดอร์/วัน)

const SB_URL = "https://lnvyaftumywicgtotozp.supabase.co";
const SB_KEY ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxudnlhZnR1bXl3aWNndG90b3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzE1NjcsImV4cCI6MjA5NTk0NzU2N30.Ymj0QMrzkFZz1QmCqbL0P5lsFmFQzswkbvsLEh3SbB4";

// ─────────────────────────────────────────────────────────────
//  สลับสภาพแวดล้อมที่นี่ที่เดียว:  "production"  หรือ  "training"
// ─────────────────────────────────────────────────────────────
const ENV = "production";

const FLASH_API = ENV === "training"
  ? "https://api-training.flashexpress.com"
  : "https://api.flashexpress.com";

const FLASH_ACCOUNTS = ENV === "training"
  ? {
      "CA5610": "0bc50ae59546a42fe64dca031005fdb1528486214ec0a4c01551d4f7f762a84c",
    }
  : {
      "CBC9351": "0d0b630e5e245149fe120a062c342b3f41ffaea51597464841e97d324b792334",
      "CBF1654": "976a16aac51569cb55b055c0665fef802d77a8dfad05b277b6fe312985e360e3",
    };

// บัญชีเริ่มต้น (ใช้เมื่อ request ไม่ได้ระบุ mchId)
const DEFAULT_MCH = ENV === "training" ? "CA5610" : "CBC9351";

// ===== ค่าปรับแต่ง Auto-Sync =====
const PER_RUN = 400;      // จำนวนพัสดุที่เช็กต่อ cron 1 รอบ
const CONCURRENCY = 6;    // ยิง Flash พร้อมกันกี่ตัว (ปรับขึ้นได้ถ้า Flash ไม่บ่น rate limit)
const CHUNK_GAP = 150;    // หน่วงระหว่างก้อน (ms) กัน rate limit

async function flashSign(params, apiKey) {
  const keys = Object.keys(params).filter(k => k !== "sign" && params[k] !== "" && params[k] !== null && params[k] !== undefined).sort();
  const stringA = keys.map(k => `${k}=${params[k]}`).join("&");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stringA + "&key=" + apiKey));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function callFlash(path, params, mchId) {
  const apiKey = FLASH_ACCOUNTS[mchId];
  if (!apiKey) return { code: -1, message: "Invalid mchId: " + mchId };
  params.mchId = mchId;
  if (!params.nonceStr) params.nonceStr = String(Date.now()) + Math.random().toString(36).substring(2, 8);
  params.sign = await flashSign(params, apiKey);
  const body = new URLSearchParams(params).toString();
  try {
    const res = await fetch(FLASH_API + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    return await res.json();
  } catch (e) { return { code: -1, message: e.message }; }
}

// ขอไฟล์ PDF ใบปะหน้าจาก Flash (คืน Response ตรง ๆ เพราะเป็น PDF stream)
async function flashLabel(pno, mchId, size) {
  const apiKey = FLASH_ACCOUNTS[mchId];
  if (!apiKey) return { error: "Invalid mchId: " + mchId };
  const params = { mchId, nonceStr: String(Date.now()) + Math.random().toString(36).slice(2, 8) };
  params.sign = await flashSign(params, apiKey);
  const body = new URLSearchParams(params).toString();
  const seg = size === "small" ? "/small/pre_print" : "/pre_print";
  return fetch(FLASH_API + "/open/v1/orders/" + pno + seg, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/pdf" },
    body
  });
}

async function sbQuery(path, opts = {}) {
  const headers = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" };
  if (opts.prefer) headers["Prefer"] = opts.prefer;
  if (opts.range) headers["Range"] = opts.range;
  const r = await fetch(SB_URL + "/rest/v1/" + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? await r.json() : null;
}

async function broadcastChange() {
  try { await sbQuery("fx_settings?key=eq.last_updated", { method: "PATCH", body: { value: String(Date.now()) }, prefer: "return=minimal" }); } catch {}
}

// fallback เมื่อ Flash ไม่ส่ง stateText มา (ปกติจะใช้ data.stateText จริงก่อน)
// ยืนยันตรงกับเอกสาร Flash: 1=รับพัสดุแล้ว, 5=เซ็นรับแล้ว
function stateText(s) {
  return { 1: "รับพัสดุแล้ว", 2: "ระหว่างการขนส่ง", 3: "กำลังจัดส่ง", 4: "ส่งคืน", 5: "เซ็นรับแล้ว", 6: "คืนสำเร็จ" }[s] || "ระหว่างการขนส่ง";
}

const DONE = ["เซ็นรับแล้ว", "คืนสำเร็จ"];

async function getTracking(pno, preferMchId) {
  const tryOrder = [preferMchId, ...Object.keys(FLASH_ACCOUNTS).filter(k => k !== preferMchId)];
  for (const mchId of tryOrder) {
    const apiKey = FLASH_ACCOUNTS[mchId];
    if (!apiKey) continue;
    try {
      const p = { mchId, nonceStr: String(Date.now()) + Math.random().toString(36).slice(2, 6) };
      p.sign = await flashSign(p, apiKey);
      const body = new URLSearchParams(p).toString();
      const r = await fetch(FLASH_API + "/open/v1/orders/" + pno + "/routes", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (data && data.code === 1) return data;
    } catch {}
  }
  return null;
}

async function syncFlash() {
  const t0 = Date.now();

  // 1) ดึงพัสดุที่ "ค้างเช็กนานสุด / ยังไม่เคยเช็ก" มาก่อน (round-robin ด้วย flash_checked_at)
  let parcels = [];
  try {
    parcels = await sbQuery(
      "fx_parcels?select=id,flash_pno,flash_status,flash_detail,status,shop_id" +
      "&flash_pno=neq.&flash_pno=not.is.null&status=neq.cancelled" +
      "&order=flash_checked_at.asc.nullsfirst" +
      "&limit=" + PER_RUN
    ) || [];
  } catch (e) { return { ok: false, error: e.message, ms: Date.now() - t0 }; }

  const nowIso = new Date().toISOString();

  // ตัวที่ "ส่งถึงแล้ว" (DONE) ไม่ต้องยิง Flash ซ้ำ — แต่ต้องประทับเวลาให้หลุดจากหัวคิว
  // (ไม่งั้นมันค้าง flash_checked_at = null อยู่หัวคิวตลอด กิน budget จนตัว in_transit ไม่ได้เช็ก)
  const doneIds = parcels.filter(p => p.flash_pno && DONE.includes(p.flash_status)).map(p => p.id);
  for (let i = 0; i < doneIds.length; i += 100) {
    const c = doneIds.slice(i, i + 100);
    try { await sbQuery("fx_parcels?id=in.(" + c.join(",") + ")", { method: "PATCH", body: { flash_checked_at: nowIso }, prefer: "return=minimal" }); } catch {}
  }

  parcels = parcels.filter(p => p.flash_pno && !DONE.includes(p.flash_status));
  if (!parcels.length) return { ok: true, version: "v3.1", checked: 0, updated: 0, errors: 0, stamped_done: doneIds.length, ms: Date.now() - t0 };

  let shops = [];
  try { shops = await sbQuery("fx_shops?select=id,flash_mch_id") || []; } catch {}
  const shopMap = {};
  shops.forEach(s => { shopMap[s.id] = s.flash_mch_id; });

  let updated = 0, errors = 0;

  // 2) ประมวลผลเป็นก้อน ก้อนละ CONCURRENCY ตัว ยิงพร้อมกัน
  for (let i = 0; i < parcels.length; i += CONCURRENCY) {
    const chunk = parcels.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (p) => {
      const mchId = shopMap[p.shop_id] || DEFAULT_MCH;
      try {
        const r = await getTracking(p.flash_pno, mchId);
        if (r && r.code === 1 && r.data) {
          const newStatus = r.data.stateText || stateText(r.data.state);
          const lr = r.data.routes && r.data.routes[0];
          const detail = (lr && lr.message) || "";
          const updatedAt = (lr && lr.routedAt) ? new Date(lr.routedAt * 1000).toISOString() : null;
          const changed = (newStatus !== p.flash_status) || (detail !== (p.flash_detail || ""));
          return { id: p.id, ok: true, changed, status: newStatus, detail, updatedAt };
        }
        return { id: p.id, ok: false };
      } catch { return { id: p.id, ok: false }; }
    }));

    // 2.1) บันทึกเฉพาะตัวที่สถานะเปลี่ยนจริง (จัดกลุ่มค่าซ้ำเพื่อลดจำนวน PATCH)
    const groups = {};
    for (const x of results) {
      if (!x.ok || !x.changed) continue;
      const key = JSON.stringify({ status: x.status, detail: x.detail, updatedAt: x.updatedAt });
      (groups[key] = groups[key] || []).push(x.id);
    }
    for (const key in groups) {
      const { status, detail, updatedAt } = JSON.parse(key);
      const ids = groups[key];
      const body = { flash_status: status, flash_detail: detail, flash_checked_at: nowIso };
      if (updatedAt) body.flash_updated_at = updatedAt;
      try { await sbQuery("fx_parcels?id=in.(" + ids.join(",") + ")", { method: "PATCH", body, prefer: "return=minimal" }); updated += ids.length; }
      catch { errors += ids.length; }
    }

    // 2.2) ตัวที่เช็กแล้วแต่ไม่เปลี่ยน + ตัวที่เช็กไม่สำเร็จ → ประทับเวลา checked ก้อนเดียว
    //      (กันไม่ให้ค้างหัวคิว จะได้หมุนไปเช็กตัวอื่น แล้ววนกลับมาใหม่รอบถัด ๆ ไป)
    const stamp = results.filter(x => !(x.ok && x.changed)).map(x => x.id);
    const failed = results.filter(x => !x.ok).length;
    if (failed) errors += failed;
    if (stamp.length) {
      try { await sbQuery("fx_parcels?id=in.(" + stamp.join(",") + ")", { method: "PATCH", body: { flash_checked_at: nowIso }, prefer: "return=minimal" }); } catch {}
    }

    if (i + CONCURRENCY < parcels.length) await new Promise(r => setTimeout(r, CHUNK_GAP));
  }

  if (updated > 0) await broadcastChange();
  return { ok: true, version: "v3.1", checked: parcels.length, updated, errors, ms: Date.now() - t0 };
}

export default {
  async scheduled(event, env, ctx) {
    const result = await syncFlash();
    console.log("auto-sync:", JSON.stringify(result));
  },

  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const allowed = ["https://themton.github.io", "http://localhost:5173", "http://localhost:3000"];
    const corsOrigin = allowed.includes(origin) ? origin : "https://themton.github.io";
    const cors = { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,apikey,Authorization,Prefer" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (url.pathname === "/") return json({ status: "ok", version: "v3.1", features: ["flash-proxy", "supabase-proxy", "auto-sync"] });
    if (url.pathname === "/sync") return json(await syncFlash());

    if (url.pathname === "/test") {
      const pno = url.searchParams.get("pno") || "";
      const mchId = url.searchParams.get("mch") || DEFAULT_MCH;
      if (!pno) return json({ error: "ต้องระบุ ?pno=TH..." });
      const r = await getTracking(pno, mchId);
      return json({ pno, mchId, flash_response: r });
    }

    if (url.pathname === "/status") {
      try {
        const all = await sbQuery("fx_parcels?select=flash_status,flash_pno&flash_pno=neq.&flash_pno=not.is.null&status=neq.cancelled") || [];
        const c = { total: all.length, pending: 0, in_transit: 0, delivered: 0, no_status: 0 };
        all.forEach(p => {
          if (!p.flash_status) c.no_status++;
          else if (DONE.includes(p.flash_status)) c.delivered++;
          else c.in_transit++;
        });
        return json(c);
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // ═══ FLASH SECURE API ═══
    if (url.pathname === "/flash-api/ping" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return json(await callFlash("/open/v1/ping", {}, body.mchId || DEFAULT_MCH));
    }
    if (url.pathname === "/flash-api/create" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || DEFAULT_MCH; delete body.mchId;
      return json(await callFlash("/open/v1/orders", body, mchId));
    }
    if (url.pathname === "/flash-api/cancel" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || DEFAULT_MCH;
      return json(await callFlash("/open/v1/orders/" + body.pno + "/cancel", { pno: body.pno }, mchId));
    }
    if (url.pathname === "/flash-api/tracking" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || DEFAULT_MCH;
      const pnos = String(body.pnos || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!pnos.length) return json({ code: -1, message: "pnos required" });
      const data = [];
      for (const pno of pnos) {
        try {
          const r = await getTracking(pno, mchId);
          if (r && r.code === 1 && r.data) {
            const d = r.data;
            const lr = d.routes && d.routes[0];
            data.push({
              pno,
              state: d.state,
              stateText: d.stateText || stateText(d.state),
              stateChangeAt: (lr && lr.routedAt) ? lr.routedAt : 0,
              routes: d.routes || [],
            });
          }
        } catch {}
      }
      return json({ code: 1, data });
    }
    // เรียกพนักงานเข้ารับพัสดุ (notify courier)
    if (url.pathname === "/flash-api/notify" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || DEFAULT_MCH; delete body.mchId;
      return json(await callFlash("/open/v1/notify", body, mchId));
    }
    // ปริ้นใบปะหน้า (print label) — คืนไฟล์ PDF
    if (url.pathname === "/flash-api/label" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || DEFAULT_MCH;
      if (!body.pno) return json({ code: -1, message: "pno required" });
      const r = await flashLabel(body.pno, mchId, body.size);
      if (r.error) return json({ code: -1, message: r.error }, 400);
      const ct = r.headers.get("Content-Type") || "";
      if (ct.includes("application/json")) return json(await r.json(), r.status);
      const buf = await r.arrayBuffer();
      return new Response(buf, { status: r.status, headers: { ...cors, "Content-Type": "application/pdf" } });
    }

   // Supabase proxy ปิดแล้ว (กันการเข้าถึง DB ตรงจากภายนอก)
    return json({ error: "not found" }, 404);
  }
};
