// ===== Flash Proxy + Auto-Sync Worker v2.0 (trackmt) =====
// Flash API Proxy + Supabase Proxy + Auto-Sync สถานะ Flash

const SB_URL = "https://fnkohtdpwdwedjrtklre.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua29odGRwd2R3ZWRqcnRrbHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA3MjIsImV4cCI6MjA4ODkyNjcyMn0.AuotNxQWgKiSYpS7kLBMm3jOCFhJWsXy31yaqG6dwic";
const FLASH_PROD = "https://api.flashexpress.com";

const FLASH_ACCOUNTS = {
  "CBC9351": "0d0b630e5e245149fe120a062c342b3f41ffaea51597464841e97d324b792334",
  "CBF1654": "976a16aac51569cb55b055c0665fef802d77a8dfad05b277b6fe312985e360e3",
};

const BATCH = 200;
const DELAY = 250;

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
    const res = await fetch(FLASH_PROD + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    return await res.json();
  } catch (e) { return { code: -1, message: e.message }; }
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
      const r = await fetch(FLASH_PROD + "/open/v1/orders/" + pno + "/routes", {
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
  let parcels = [];
  try {
    parcels = await sbQuery(
      "fx_parcels?select=id,flash_pno,flash_status,flash_detail,status,shop_id" +
      "&flash_pno=neq.&flash_pno=not.is.null&status=neq.cancelled" +
      "&order=created_at.desc", { range: "0-" + (BATCH - 1) }
    ) || [];
  } catch (e) { return { ok: false, error: e.message, ms: Date.now() - t0 }; }

  parcels = parcels.filter(p => p.flash_pno && !DONE.includes(p.flash_status));
  if (!parcels.length) return { ok: true, checked: 0, updated: 0, ms: Date.now() - t0 };

  let shops = [];
  try { shops = await sbQuery("fx_shops?select=id,flash_mch_id") || []; } catch {}
  const shopMap = {};
  shops.forEach(s => { shopMap[s.id] = s.flash_mch_id; });

  let updated = 0, errors = 0;
  const updates = {};

  for (let i = 0; i < parcels.length; i++) {
    const p = parcels[i];
    const mchId = shopMap[p.shop_id] || "CBC9351";
    try {
      const r = await getTracking(p.flash_pno, mchId);
      if (r && r.code === 1 && r.data) {
        const newStatus = stateText(r.data.state);
        const latestRoute = r.data.routes?.[0];
        const detail = latestRoute?.message || "";
        const updatedAt = latestRoute?.routedAt ? new Date(latestRoute.routedAt * 1000).toISOString() : null;
        if (newStatus !== p.flash_status || detail !== (p.flash_detail || "")) {
          const key = JSON.stringify({ status: newStatus, detail, updatedAt });
          if (!updates[key]) updates[key] = [];
          updates[key].push(p.id);
        }
      }
    } catch { errors++; }
    if (i < parcels.length - 1) await new Promise(r => setTimeout(r, DELAY));
  }

  for (const key in updates) {
    const { status, detail, updatedAt } = JSON.parse(key);
    const ids = updates[key];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const body = { flash_status: status, flash_detail: detail };
        if (updatedAt) body.flash_updated_at = updatedAt;
        await sbQuery("fx_parcels?id=in.(" + chunk.join(",") + ")", { method: "PATCH", body, prefer: "return=minimal" });
        updated += chunk.length;
      } catch { errors += chunk.length; }
    }
  }

  if (updated > 0) await broadcastChange();
  return { ok: true, version: "v2.0", checked: parcels.length, updated, errors, ms: Date.now() - t0 };
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

    if (url.pathname === "/") return json({ status: "ok", version: "v2.0", features: ["flash-proxy", "supabase-proxy", "auto-sync"] });
    if (url.pathname === "/sync") return json(await syncFlash());

    if (url.pathname === "/test") {
      const pno = url.searchParams.get("pno") || "";
      const mchId = url.searchParams.get("mch") || "CBC9351";
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
      return json(await callFlash("/open/v1/ping", {}, body.mchId || "CBC9351"));
    }
    if (url.pathname === "/flash-api/create" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || "CBC9351"; delete body.mchId;
      return json(await callFlash("/open/v1/orders", body, mchId));
    }
    if (url.pathname === "/flash-api/cancel" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || "CBC9351";
      return json(await callFlash("/open/v1/orders/" + body.pno + "/cancel", { pno: body.pno }, mchId));
    }
    if (url.pathname === "/flash-api/tracking" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const mchId = body.mchId || "CBC9351";
      const pnos = body.pnos || "";
      if (!pnos) return json({ code: -1, message: "pnos required" });
      return json(await callFlash("/open/v1/orders/routesBatch", { pnos }, mchId));
    }

    // ═══ SUPABASE PROXY ═══
    const targetUrl = SB_URL + url.pathname + url.search;
    const h = new Headers();
    h.set("apikey", SB_KEY); h.set("Authorization", "Bearer " + SB_KEY); h.set("Content-Type", "application/json");
    if (req.headers.get("Prefer")) h.set("Prefer", req.headers.get("Prefer"));
    const reqBody = ["GET", "HEAD"].includes(req.method) ? null : await req.text();
    try {
      const res = await fetch(targetUrl, { method: req.method, headers: h, body: reqBody });
      const respHeaders = new Headers();
      respHeaders.set("Content-Type", res.headers.get("Content-Type") || "application/json");
      Object.entries(cors).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(res.body, { status: res.status, headers: respHeaders });
    } catch (e) { return json({ error: e.message }, 500); }
  }
};
