// ===== Flash Proxy + Auto-Sync Worker v3.3 (trackmt) =====
// Flash API Proxy + Supabase Proxy + Auto-Sync สถานะ Flash (รองรับ 1000+ ออเดอร์/วัน)

const SB_URL = "https://lnvyaftumywicgtotozp.supabase.co";
const SB_KEY ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxudnlhZnR1bXl3aWNndG90b3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzE1NjcsImV4cCI6MjA5NTk0NzU2N30.Ymj0QMrzkFZz1QmCqbL0P5lsFmFQzswkbvsLEh3SbB4";

// Short-lived J&T permission, signed only by this Worker. Never send the signing secret to the browser.
const sessionBytes = value => new TextEncoder().encode(value);
const sessionBase64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sessionKey = secret => crypto.subtle.importKey("raw", sessionBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function issueJtSession(user, secret) {
  const payload = sessionBase64(sessionBytes(JSON.stringify({ id: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + 8 * 3600 })));
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), sessionBytes(payload));
  return payload + "." + sessionBase64(new Uint8Array(signature));
}
async function verifyJtSession(token, secret) {
  if (!secret || !token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const signature = Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    if (!await crypto.subtle.verify("HMAC", await sessionKey(secret), signature, sessionBytes(parts[0]))) return null;
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))));
    if (!claims.id || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    const users = await sbQuery(`fx_users?select=id,role,is_active&id=eq.${encodeURIComponent(claims.id)}&limit=1`);
    const user = users?.[0];
    return user?.is_active && user.role === claims.role ? user : null;
  } catch { return null; }
}

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

// J&T Open Platform. Keep credentials in Worker Secrets; never put them in App.jsx.

function md5(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const words = new Uint32Array(((bytes.length + 9 + 63) >> 6) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i & 3) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length & 3) * 8);
  words[words.length - 2] = bitLen >>> 0;
  words[words.length - 1] = Math.floor(bitLen / 0x100000000);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const rol = (x, n) => (x << n) | (x >>> (32 - n));
  const add = (x, y) => (x + y) >>> 0;
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  for (let off = 0; off < words.length; off += 16) {
    let A = a, B = b, C = c, D = d;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const next = add(B, rol(add(add(A, F), add(k[i], words[off + g])), s[i]));
      A = D; D = C; C = B; B = next;
    }
    a = add(a, A); b = add(b, B); c = add(c, C); d = add(d, D);
  }
  const out = new Uint8Array(16), vals = [a,b,c,d];
  vals.forEach((v, i) => { out[i*4]=v&255; out[i*4+1]=(v>>>8)&255; out[i*4+2]=(v>>>16)&255; out[i*4+3]=(v>>>24)&255; });
  return Array.from(out, x => x.toString(16).padStart(2, "0")).join("");
}

function base64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }

async function boundedText(req, limit = 32768) {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

async function equalSecret(actual, expected) {
  const encoder = new TextEncoder();
  const hashes = await Promise.all([actual, expected].map(x => crypto.subtle.digest("SHA-256", encoder.encode(x))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

// Separate UAT inboxes. Production credentials must never fall back to UAT keys.
async function jtCallback(req, env, vip) {
  const reply = (code, msg, status, billCode) => Response.json({ code, msg, data: billCode ? { billCode } : null, succ: code === 1, fail: code !== 1 }, { status });
  if (req.method !== "POST") return reply(0, "POST required", 405);
  const suffix = { VIP8530310123: "23", VIP8530310124: "24" }[vip];
  const apiAccount = env[`JT_${suffix}_API_ACCOUNT`];
  const privateKey = env[`JT_${suffix}_PRIVATE_KEY`];
  if (!env.JT_TRACKING_INBOX || !apiAccount || !privateKey) return reply(0, "Tracking inbox not configured", 503);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return reply(0, "Invalid content type", 415);
  try {
    const form = new URLSearchParams(await boundedText(req));
    const raw = form.get("bizContent");
    if (!raw || form.getAll("bizContent").length !== 1) return reply(0, "Invalid business content", 400);
    const signature = base64(new Uint8Array(md5(raw + privateKey).match(/../g).map(h => parseInt(h, 16))));
    const validAccount = await equalSecret(req.headers.get("apiAccount") || "", apiAccount);
    const validDigest = await equalSecret(req.headers.get("digest") || "", signature);
    if (!validAccount || !validDigest) return reply(0, "Signature rejected", 401);
    const timestamp = Number(req.headers.get("timestamp"));
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || Math.abs(Date.now() - timestamp) > 86400000) return reply(0, "Invalid timestamp", 400);
    const data = JSON.parse(raw);
    const traces = data.details ?? data.traces;
    if (data.logisticproviderid !== "JNT" || typeof data.billCode !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(data.billCode) || !Array.isArray(traces) || !traces.length || traces.length > 100) return reply(0, "Invalid tracking event", 400);
    if (traces.some(t => !t || typeof t.scanTime !== "string" || typeof t.scanType !== "string" || !t.txlogisticid)) return reply(0, "Incomplete tracking event", 400);
    // Deterministic event key makes retries idempotent; no Flash rows are touched.
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const eventId = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    await env.JT_TRACKING_INBOX.put(`uat/${vip}/${data.billCode}/${eventId}`, JSON.stringify({ receivedAt: new Date().toISOString(), vip, data }));
    return reply(1, "success", 200, data.billCode);
  } catch (error) {
    if (error.message === "too-large") return reply(0, "Request too large", 413);
    if (error instanceof SyntaxError) return reply(0, "Invalid JSON", 400);
    return reply(0, "Tracking event could not be stored; retry", 503);
  }
}

async function jtRequest(path, body, env) {
  const vip = body.customerCode;
  const suffix = { VIP8530310123: "23", VIP8530310124: "24" }[vip];
  if (!suffix) return { code: 400, msg: "Unknown J&T VIP account" };
  const apiAccount = env[`JT_${suffix}_API_ACCOUNT`];
  const privateKey = env[`JT_${suffix}_PRIVATE_KEY`];
  const businessPassword = env[`JT_${suffix}_BUSINESS_PASSWORD`];
  if (!apiAccount || !privateKey || !businessPassword) return { code: 503, msg: `J&T VIP ${suffix} is not configured` };
  const bizContent = { ...body, customerCode: vip, password: businessPassword };
  const timestamp = Date.now();
  const digestBytes = md5(JSON.stringify(bizContent) + privateKey).match(/../g).map(h => parseInt(h, 16));
  const digest = base64(new Uint8Array(digestBytes));
  const form = new URLSearchParams({ bizContent: JSON.stringify(bizContent) });
  const base = env.JT_API_BASE || "https://demoopenapi.jtexpress.co.th";
  if (!["https://demoopenapi.jtexpress.co.th", "https://ylopenapi.jtexpress.co.th"].includes(base)) throw new Error("Invalid J&T API base");
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", apiAccount, digest, timestamp: String(timestamp) }, body: form, signal: AbortSignal.timeout(20000) });
  return await res.json();
}

// ===== ค่าปรับแต่ง Auto-Sync =====
const PER_RUN = 400;      // จำนวนพัสดุที่เช็กต่อ cron 1 รอบ
const CONCURRENCY = 6;    // ยิง Flash พร้อมกันกี่ตัว (ปรับขึ้นได้ถ้า Flash ไม่บ่น rate limit)
const CHUNK_GAP = 150;    // หน่วงระหว่างก้อน (ms) กัน rate limit
const STALE_MIN = 10;     // เช็กพัสดุแต่ละใบซ้ำก็ต่อเมื่อผ่านไปแล้วเกินกี่นาที (กันดึงซ้ำถี่เกิน → ลด egress)

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
  return { 1: "รับพัสดุแล้ว", 2: "ระหว่างการขนส่ง", 3: "กำลังจัดส่ง", 4: "ส่งคืน", 5: "เซ็นรับแล้ว", 6: "คืนสำเร็จ" }[s] || "";
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
    const staleBefore = new Date(Date.now() - STALE_MIN * 60000).toISOString();
    parcels = await sbQuery(
      "fx_parcels?select=id,flash_pno,flash_status,flash_detail,status,shop_id" +
      "&or=(source.is.null,source.not.in.(jnt,jnt_uat))" +
      "&flash_pno=neq.&flash_pno=not.is.null&status=neq.cancelled" +
      "&and=(or(flash_status.is.null,flash_status.not.in.(เซ็นรับแล้ว,คืนสำเร็จ)),or(flash_checked_at.is.null,flash_checked_at.lt." + staleBefore + "))" +
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
  if (!parcels.length) return { ok: true, version: "v3.4", checked: 0, updated: 0, errors: 0, stamped_done: doneIds.length, ms: Date.now() - t0 };

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
  return { ok: true, version: "v3.4", checked: parcels.length, updated, errors, ms: Date.now() - t0 };
}

export default {
  async scheduled(event, env, ctx) {
    const result = await syncFlash();
    console.log("auto-sync:", JSON.stringify(result));
  },

  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = ["https://themton.github.io", "http://localhost:5173", "http://localhost:3000"];
    const corsOrigin = allowed.includes(origin) ? origin : "https://themton.github.io";
    const cors = { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,apikey,Authorization,Prefer" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { ...cors, "Content-Type": "application/json" } });

    const callback = url.pathname.match(/^\/jt-callback\/uat\/(VIP853031012[34])$/);
    if (callback) return jtCallback(req, env, callback[1]);

    if (url.pathname === "/auth/jt-login" && req.method === "POST") {
      if (!env.JT_SESSION_SECRET) return json({ msg: "J&T login is not configured" }, 503);
      let credentials;
      try { credentials = JSON.parse(await boundedText(req, 2048)); } catch { return json({ msg: "Invalid login request" }, 400); }
      const { username, password } = credentials || {};
      if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(username) || typeof password !== "string" || !password || password.length > 256) return json({ msg: "Invalid login request" }, 400);
      try {
        const digest = await crypto.subtle.digest("SHA-256", sessionBytes(password));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        const users = await sbQuery(`fx_users?select=id,username,display_name,role,avatar_color&username=eq.${encodeURIComponent(username)}&password=eq.${hash}&is_active=eq.true&limit=1`);
        if (!users?.length) return json({ msg: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
        const user = users[0];
        if (!["admin", "shipping", "accounting", "tracking"].includes(user.role)) return json({ msg: "ไม่มีสิทธิ์เข้าใช้งาน" }, 403);
        return json({ user, session: await issueJtSession(user, env.JT_SESSION_SECRET) });
      } catch { return json({ msg: "ตรวจสอบการเข้าสู่ระบบไม่ได้" }, 503); }
    }

    if (url.pathname.startsWith("/jt-api/")) {
      if (!env.JT_SESSION_SECRET) return json({ msg: "J&T access is not configured" }, 503);
      const supplied = req.headers.get("Authorization") || "";
      const user = supplied.startsWith("Bearer ") ? await verifyJtSession(supplied.slice(7), env.JT_SESSION_SECRET) : null;
      if (!user) return json({ msg: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง" }, 401);
      if (["/jt-api/create", "/jt-api/cancel"].includes(url.pathname) && !["admin", "shipping"].includes(user.role)) return json({ msg: "ไม่มีสิทธิ์สร้างหรือยกเลิกเลข J&T" }, 403);
      if (url.pathname === "/jt-api/label" && !["admin", "shipping", "accounting"].includes(user.role)) return json({ msg: "ไม่มีสิทธิ์พิมพ์ใบปะหน้า J&T" }, 403);
      if (Number(req.headers.get("Content-Length") || 0) > 32768) return json({ msg: "Request too large" }, 413);
    }

    if (url.pathname === "/") return json({ status: "ok", version: "v3.6", jntEnvironment: env.JT_API_BASE === "https://ylopenapi.jtexpress.co.th" ? "production" : "sandbox", features: ["flash-proxy", "jnt-create-order", "jnt-cancel", "jnt-label", "supabase-proxy", "auto-sync"] });
    if (url.pathname === "/jt-api/create" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (env.JT_API_BASE !== "https://ylopenapi.jtexpress.co.th" || body.environment !== "production") return json({ code: 409, msg: "J&T production request or environment is not ready" }, 409);
      if (!body.customerCode || !body.txlogisticId || !body.sender || !body.receiver || !body.packageInfo) return json({ code: 400, msg: "J&T required fields are missing" }, 400);
      for (const party of [body.sender, body.receiver]) {
        if (!["name", "postCode", "mobile", "city", "prov", "address"].every(key => typeof party[key] === "string" && party[key].trim())) return json({ msg: "Sender/receiver address is incomplete" }, 400);
        if (!/^\d{5}$/.test(party.postCode)) return json({ msg: "Invalid postal code" }, 400);
      }
      if (!Number.isFinite(Number(body.packageInfo.weight)) || Number(body.packageInfo.weight) <= 0) return json({ msg: "Invalid package weight" }, 400);
      if (body.codInfo && (!Number.isFinite(Number(body.codInfo.codValue)) || Number(body.codInfo.codValue) <= 0)) return json({ msg: "Invalid COD amount" }, 400);
      delete body.environment;
      try { return json(await jtRequest("/webopenplatformapi/api/order/addOrder", body, env)); } catch { return json({ code: 500, msg: "J&T request failed; check order before retrying" }, 502); }
    }
    if (url.pathname === "/jt-api/cancel" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (env.JT_API_BASE !== "https://ylopenapi.jtexpress.co.th" || body.environment !== "production") return json({ code: 409, msg: "J&T production request or environment is not ready" }, 409);
      if (!body.customerCode || !body.txlogisticId || !body.reason) return json({ code: 400, msg: "customerCode, txlogisticId and reason are required" }, 400);
      delete body.environment;
      try { return json(await jtRequest("/webopenplatformapi/api/order/cancelOrder", body, env)); } catch (e) { return json({ code: 500, msg: e.message }, 502); }
    }
    if (url.pathname === "/jt-api/tracking" && req.method === "POST") {
      let body;
      try { body = JSON.parse(await boundedText(req)); } catch { return json({ code: 400, msg: "Invalid or oversized request" }, 400); }
      if (typeof body.customerCode !== "string") return json({ code: 400, msg: "J&T VIP account is required" }, 400);
      if (typeof body.txlogisticId !== "string" || !body.txlogisticId.trim() || body.txlogisticId.length > 50) return json({ code: 400, msg: "txlogisticId is required" }, 400);
      try { return json(await jtRequest("/webopenplatformapi/api/logistics/trace", { customerCode: body.customerCode, txlogisticId: body.txlogisticId, ...(body.billCode ? { billCode: body.billCode } : {}), lang: "th" }, env)); }
      catch { return json({ code: 500, msg: "J&T tracking request failed" }, 502); }
    }
    if (url.pathname === "/jt-api/label" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (env.JT_API_BASE !== "https://ylopenapi.jtexpress.co.th" || body.environment !== "production") return json({ code: 409, msg: "J&T production request or environment is not ready" }, 409);
      if (!body.customerCode || !body.txlogisticId || !body.billCode) return json({ code: 400, msg: "customerCode, txlogisticId and billCode are required" }, 400);
      try {
        const type = Number(body.type || 1);
        if (![1,2,3,4,5].includes(type)) return json({ msg: "Invalid label size" }, 400);
        const result = await jtRequest("/webopenplatformapi/api/order/printOrder", { customerCode: body.customerCode, txlogisticId: body.txlogisticId, billCode: body.billCode, type }, env);
        if (!body.asPdf || String(result.code) !== "1") return json(result);
        if (result.data?.base64EncodeContent) {
          const bytes = Uint8Array.from(atob(result.data.base64EncodeContent), ch => ch.charCodeAt(0));
          return new Response(bytes, { headers: { ...cors, "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
        }
        if (result.data?.urlContent) {
          const target = new URL(result.data.urlContent);
          if (target.protocol !== "https:" || !(target.hostname.endsWith(".jtexpress.co.th") || target.hostname.endsWith(".jtexpress.my"))) return json({ msg: "Invalid J&T PDF host" }, 502);
          const pdf = await fetch(target.href, { redirect: "error", signal: AbortSignal.timeout(15000) });
          if (!pdf.ok) return json({ msg: "J&T PDF download failed" }, 502);
          return new Response(pdf.body, { headers: { ...cors, "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
        }
        return json({ msg: "J&T returned no label" }, 502);
      } catch { return json({ code: 500, msg: "J&T label request failed" }, 502); }
    }
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
        const all = await sbQuery("fx_parcels?select=flash_status,flash_pno&or=(source.is.null,source.not.in.(jnt,jnt_uat))&flash_pno=neq.&flash_pno=not.is.null&status=neq.cancelled") || [];
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
