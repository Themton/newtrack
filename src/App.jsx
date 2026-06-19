import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ADDR_DB, { PROVINCES } from "./addr.js";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://lnvyaftumywicgtotozp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxudnlhZnR1bXl3aWNndG90b3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNzE1NjcsImV4cCI6MjA5NTk0NzU2N30.Ymj0QMrzkFZz1QmCqbL0P5lsFmFQzswkbvsLEh3SbB4";
const BASE_URL = SUPABASE_URL; // ใช้ Supabase ตรง

// ═══════════════════════════════════════════════════════════════
// FLASH EXPRESS API CONFIG
// ═══════════════════════════════════════════════════════════════
const FLASH_ACCOUNTS = [
  { name: "CBC9351", mchId: "CBC9351" },
  { name: "CBF1654", mchId: "CBF1654" },
];
const WORKER_URL = "https://newtrack-proxy.themtja.workers.dev";

// Flash Express API — calls Worker (keys are in Worker, NOT here)
const flashApi = {
  getAccount(mchId) {
    return FLASH_ACCOUNTS.find(a => a.mchId === mchId) || FLASH_ACCOUNTS[0];
  },
  async callWorker(endpoint, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 วินาที timeout
    try {
      const res = await fetch(`${WORKER_URL}/flash-api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text();
      if (!res.ok) throw new Error(`Worker HTTP ${res.status}: ${text.substring(0, 200)}`);
      try { return JSON.parse(text); } catch { throw new Error(`Worker ตอบกลับไม่ใช่ JSON: ${text.substring(0, 200)}`); }
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError") throw new Error("Worker timeout (15s) — ลองอีกครั้ง");
      throw e;
    }
  },
  async ping(account) {
    return this.callWorker("ping", { mchId: account?.mchId || "CBC9351" });
  },
  async createOrder(parcel, account) {
    const acc = account || FLASH_ACCOUNTS[0];
    // Validate
    const missing = [];
    if (!parcel.sender_name) missing.push("ชื่อผู้ส่ง");
    if (!parcel.sender_phone) missing.push("เบอร์ผู้ส่ง");
    if (!parcel.receiver_name) missing.push("ชื่อผู้รับ");
    if (!parcel.receiver_phone) missing.push("เบอร์ผู้รับ");
    if (!parcel.receiver_district) missing.push("อำเภอผู้รับ");
    if (!parcel.receiver_postal) missing.push("รหัสไปรษณีย์ผู้รับ");
    if (missing.length) throw new Error("ข้อมูลไม่ครบ:\n" + missing.join(", "));

    const mapProv = (p) => p === "กรุงเทพมหานคร" ? "กรุงเทพ" : p;
    const uniqueId = "O" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

    const params = {
      mchId: acc.mchId,
      nonceStr: String(Date.now()) + Math.random().toString(36).substring(2, 8),
      outTradeNo: uniqueId,
      srcName: parcel.sender_name,
      srcPhone: parcel.sender_phone,
      srcDetailAddress: parcel.sender_address || parcel.sender_name,
      dstName: parcel.receiver_name,
      dstPhone: parcel.receiver_phone,
      dstProvinceName: mapProv(parcel.receiver_province || ""),
      dstCityName: parcel.receiver_district || "",
      dstPostalCode: String(parcel.receiver_postal),
      dstDetailAddress: [parcel.receiver_address, parcel.receiver_subdistrict, parcel.receiver_district, parcel.receiver_province].filter(Boolean).join(" ") || parcel.receiver_name,
      articleCategory: "1",
      expressCategory: "1",
      codEnabled: parcel.cod_enabled ? "1" : "0",
      weight: String(Math.max(1, Math.round((parcel.weight || 1) * 1000))),
    };
    if (parcel.sender_province) params.srcProvinceName = mapProv(parcel.sender_province);
    let senderPostal = parcel.sender_postal || "";
    if (!senderPostal) { const m = (parcel.sender_address || "").match(/\b(\d{5})\b/); if (m) senderPostal = m[1]; }
    if (senderPostal) params.srcPostalCode = String(senderPostal);
    if (parcel.receiver_subdistrict) params.dstDistrictName = parcel.receiver_subdistrict;
    if (parcel.cod_enabled && parcel.cod_amount > 0) {
      params.codAmount = String(Math.round(parcel.cod_amount * 100));
    }
    return this.callWorker("create", params);
  },
  async cancelOrder(pno, account) {
    return this.callWorker("cancel", { pno, mchId: account?.mchId || "CBC9351" });
  },
  async getTracking(pnos, account) {
    return this.callWorker("tracking", { pnos: pnos.join(","), mchId: account?.mchId || "CBC9351" });
  },
  async notifyCourier(sender, account) {
    const mapProv = (p) => p === "กรุงเทพมหานคร" ? "กรุงเทพ" : p;
    return this.callWorker("notify", {
      mchId: account?.mchId || FLASH_ACCOUNTS[0].mchId,
      srcName: sender.name || "",
      srcPhone: sender.phone || "",
      srcProvinceName: mapProv(sender.province || ""),
      srcCityName: sender.city || sender.district || "",
      srcPostalCode: String(sender.postal || ""),
      srcDetailAddress: sender.address || sender.name || "",
    });
  },
  async openLabel(pno, account, size) {
    const res = await fetch(`${WORKER_URL}/flash-api/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pno, size: size || "", mchId: account?.mchId || FLASH_ACCOUNTS[0].mchId }),
    });
    const ct = res.headers.get("Content-Type") || "";
    if (ct.includes("application/pdf")) {
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
      return { ok: true };
    }
    let msg = "ขอใบปะหน้าจาก Flash ไม่สำเร็จ";
    try { const d = await res.json(); msg = d.message || msg; } catch {}
    throw new Error(msg);
  },
  async fetchLabelBytes(pno, account, size) {
    const res = await fetch(`${WORKER_URL}/flash-api/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pno, size: size || "", mchId: account?.mchId || FLASH_ACCOUNTS[0].mchId }),
    });
    const ct = res.headers.get("Content-Type") || "";
    if (ct.includes("application/pdf")) return await res.arrayBuffer();
    let msg = "ขอใบปะหน้าไม่สำเร็จ";
    try { const d = await res.json(); msg = d.message || msg; } catch {}
    throw new Error(msg);
  },
};

// ═══════════════════════════════════════════════════════════════
// SUPABASE CLIENT (with Cloudflare Worker fallback)
// ═══════════════════════════════════════════════════════════════
let activeBaseUrl = BASE_URL;

const sb = {
  headers: () => ({
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  }),
  async query(table, { method = "GET", filters = "", body, order, limit } = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const params = [];
    if (filters) params.push(filters);
    if (order) params.push(`order=${order}`);
    if (method === "GET") params.push("select=*");
    if (limit) params.push(`limit=${limit}`);
    if (params.length) url += `?${params.join("&")}`;
    const hdrs = { ...this.headers() };
    if (method === "GET" && !limit) hdrs["Range"] = "0-9999"; // ดึงได้สูงสุด 10000 แถว
    const res = await fetch(url, { method, headers: hdrs, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || `HTTP ${res.status}`); }
    return res.json();
  },
  select: (t, o) => sb.query(t, { ...o, method: "GET" }),
  insert: (t, b) => sb.query(t, { method: "POST", body: b }),
  update: (t, id, b) => sb.query(t, { method: "PATCH", body: b, filters: `id=eq.${id}` }),
  delete: (t, id) => sb.query(t, { method: "DELETE", filters: `id=eq.${id}` }),
  broadcastChange: async () => { try { await sb.query("fx_settings", { method: "PATCH", body: { value: String(Date.now()) }, filters: "key=eq.last_updated" }); } catch {} },
  realtime: (table, cb) => {
    try {
      const wsUrl = SUPABASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON_KEY + "&vsn=1.0.0";
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ topic: `realtime:public:${table}`, event: "phx_join", payload: { config: { broadcast: { self: true }, postgres_changes: [{ event: "*", schema: "public", table }] } }, ref: "1" }));
        setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" })), 30000);
      };
      ws.onmessage = (e) => { try { const msg = JSON.parse(e.data); if (msg.event === "postgres_changes") cb(msg.payload); } catch {} };
      return () => ws.close();
    } catch { return () => {}; }
  },
};

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateParcelNo() {
  const now = new Date();
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const uniq = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
  return `FX-${d}-${uniq}`;
}

const ROLES = {
  admin: { label: "แอดมิน", icon: "👑", color: "#dc2626", bg: "#fef2f2" },
  shipping: { label: "พนักงานจัดส่ง", icon: "🚚", color: "#0284c7", bg: "#e0f2fe" },
  accounting: { label: "พนักงานบัญชี", icon: "💰", color: "#059669", bg: "#ecfdf5" },
  tracking: { label: "ค้นหาพัสดุ", icon: "🔍", color: "#7c3aed", bg: "#f5f3ff" },
};

const CAN = {
  admin:      { create: true, edit: true, delete: true, status: true, print: true, users: true, viewCOD: true, cancelFlash: true, dashboard: true, evaluate: true, exportData: true, tracking: true },
  shipping:   { create: true, edit: true, delete: true, status: true, print: true, users: false, viewCOD: false, cancelFlash: false, dashboard: false, evaluate: false, exportData: false, tracking: true },
  accounting: { create: false, edit: false, delete: false, status: false, print: true, users: false, viewCOD: true, cancelFlash: false, dashboard: true, evaluate: true, exportData: true, tracking: true },
  tracking:   { create: false, edit: false, delete: false, status: false, print: false, users: false, viewCOD: false, cancelFlash: false, dashboard: false, evaluate: false, exportData: false, tracking: true },
};


// ═══════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════
const LOGO_SRC = "data:image/png;base64,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";

function LoginScreen({ onLogin, isDemo }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
    setLoading(true); setError("");
    try {
      if (isDemo) {
        const demoUsers = [
          { id: "u1", username: "admin", password: "admin1234", display_name: "แอดมิน", role: "admin", avatar_color: "#dc2626" },
          { id: "u2", username: "shipping1", password: "ship1234", display_name: "พนักงานจัดส่ง 1", role: "shipping", avatar_color: "#0284c7" },
          { id: "u3", username: "accounting1", password: "acc1234", display_name: "พนักงานบัญชี 1", role: "accounting", avatar_color: "#059669" },
        ];
        const u = demoUsers.find(u => u.username === username && u.password === password);
        if (u) { onLogin(u); } else { setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"); }
        setLoading(false); return;
      }
      const safeUser = username.replace(/[^a-zA-Z0-9_]/g, "");
      const hash = await sha256(password);
      const users = await sb.select("fx_users", { filters: `username=eq.${safeUser}&password=eq.${hash}&is_active=eq.true` });
      if (users?.length) {
        const user = users[0];
        sb.update("fx_users", user.id, { last_login: new Date().toISOString() }).catch(() => {});
        sb.insert("fx_login_logs", { user_id: user.id, username: user.username, action: "login" }).catch(() => {});
        onLogin(user);
      } else {
        sb.insert("fx_login_logs", { username, action: "failed" }).catch(() => {});
        setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }
    } catch (e) { setError("เชื่อมต่อไม่ได้: " + e.message); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans Thai', -apple-system, sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src={LOGO_SRC} alt="MT" style={{ width: 84, height: 84, objectFit: "contain", marginBottom: 16, filter: "drop-shadow(0 8px 24px rgba(220,38,38,.45))" }} />
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", margin: 0 }}>MT Track</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>บริษัทเดอะเอ็มที</p>
        </div>
        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, padding: 32, backdropFilter: "blur(10px)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 24px", textAlign: "center" }}>เข้าสู่ระบบ</h2>
          {error && <div style={{ padding: "10px 14px", background: "rgba(220,38,38,.15)", border: "1px solid rgba(220,38,38,.3)", borderRadius: 10, marginBottom: 16, fontSize: 13, color: "#f87171" }}>❌ {error}</div>}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>ชื่อผู้ใช้</label>
            <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().trim())} placeholder="username" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "12px 16px", background: "rgba(255,255,255,.06)", border: "1.5px solid rgba(255,255,255,.12)", borderRadius: 12, fontSize: 15, color: "#f8fafc", outline: "none", fontFamily: "inherit" }} autoFocus />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>รหัสผ่าน</label>
            <div style={{ position: "relative" }}>
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleLogin()} style={{ width: "100%", padding: "12px 48px 12px 16px", background: "rgba(255,255,255,.06)", border: "1.5px solid rgba(255,255,255,.12)", borderRadius: 12, fontSize: 15, color: "#f8fafc", outline: "none", fontFamily: "inherit" }} />
              <button onClick={() => setShowPass(!showPass)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", fontSize: 18, cursor: "pointer", opacity: .5 }}>{showPass ? "🙈" : "👁️"}</button>
            </div>
          </div>
          <button onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: 14, background: loading ? "#475569" : "linear-gradient(135deg,#dc2626,#f97316)", border: "none", borderRadius: 12, color: "#fff", fontSize: 16, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", boxShadow: loading ? "none" : "0 4px 20px rgba(220,38,38,.4)" }}>
            {loading ? "กำลังเข้าสู่ระบบ..." : "🔓 เข้าสู่ระบบ"}
          </button>
        </div>
        {isDemo && (
          <div style={{ marginTop: 20, padding: 16, background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.2)", borderRadius: 14, fontSize: 12, color: "#fbbf24" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠️ Demo — บัญชีทดสอบ:</div>
            <div style={{ display: "grid", gap: 4, fontFamily: "monospace", fontSize: 11 }}>
              <div>👑 admin / admin1234</div>
              <div>🚚 shipping1 / ship1234</div>
              <div>💰 accounting1 / acc1234</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USER MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════════
function UserManagement({ onClose, isDemo, inline }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", display_name: "", role: "shipping" });
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true); setLoadError("");
    if (isDemo) {
      setUsers([
        { id: "u1", username: "admin", display_name: "แอดมิน", role: "admin", is_active: true, last_login: "2026-04-04T10:00:00Z" },
        { id: "u2", username: "shipping1", display_name: "พนักงานจัดส่ง 1", role: "shipping", is_active: true, last_login: "2026-04-04T09:30:00Z" },
        { id: "u3", username: "accounting1", display_name: "พนักงานบัญชี 1", role: "accounting", is_active: true, last_login: "2026-04-03T16:00:00Z" },
      ]);
      setLoading(false); return;
    }
    try {
      const d = await sb.select("fx_users", { order: "created_at.asc" });
      setUsers(d || []);
    } catch (e) {
      console.warn("Load users error:", e.message);
      setLoadError(e.message);
      setUsers([]);
    }
    setLoading(false);
  }, [isDemo]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAdd = async () => {
    if (!form.username || !form.password || !form.display_name) { uiAlert("กรุณากรอกข้อมูลให้ครบ"); return; }
    setSaving(true);
    try {
      const hash = await sha256(form.password);
      await sb.insert("fx_users", { username: form.username.toLowerCase().trim(), password: hash, display_name: form.display_name, role: form.role });
      setShowAdd(false); setForm({ username: "", password: "", display_name: "", role: "shipping" }); loadUsers();
    } catch (e) { uiAlert("Error: " + e.message); }
    setSaving(false);
  };

  const toggleActive = async (u) => {
    if (isDemo) return;
    try { await sb.update("fx_users", u.id, { is_active: !u.is_active }); loadUsers(); } catch (e) { uiAlert(e.message); }
  };

  const resetPassword = async (u) => {
    const newPass = prompt(`รีเซ็ตรหัสผ่าน ${u.display_name}\nพิมพ์รหัสผ่านใหม่:`);
    if (!newPass) return;
    try { const hash = await sha256(newPass); await sb.update("fx_users", u.id, { password: hash }); uiAlert("รีเซ็ตสำเร็จ"); } catch (e) { uiAlert(e.message); }
  };

  const I = { width: "100%", padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, outline: "none", fontFamily: "inherit" };

  const renderContent = () => (<>
    <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>👥 จัดการผู้ใช้งาน</h2>
      <button onClick={() => setShowAdd(!showAdd)} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>＋ เพิ่มผู้ใช้</button>
    </div>
    {showAdd && (
      <div style={{ padding: "16px 24px", background: "#fafafa", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อผู้ใช้ *</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="username" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>รหัสผ่าน *</label><input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="password" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อที่แสดง *</label><input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="ชื่อ-สกุล" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ตำแหน่ง</label><select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...I, background: "#fff" }}><option value="admin">👑 แอดมิน</option><option value="shipping">🚚 พนักงานจัดส่ง</option><option value="accounting">💰 พนักงานบัญชี</option><option value="tracking">🔍 ค้นหาพัสดุ</option></select></div>
        </div>
        <button onClick={handleAdd} disabled={saving} style={{ marginTop: 10, padding: "10px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{saving ? "..." : "✅ บันทึก"}</button>
      </div>
    )}
    <div style={{ overflowY: "auto" }}>
      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>กำลังโหลด...</div> : loadError ? <div style={{ padding: 40, textAlign: "center" }}><div style={{ color: "#dc2626", fontWeight: 600 }}>❌ โหลดไม่ได้: {loadError}</div><button onClick={loadUsers} style={{ marginTop: 10, padding: "8px 16px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>🔄 ลองอีกครั้ง</button></div> : users.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>ยังไม่มีผู้ใช้ กด "+ เพิ่มผู้ใช้" เพื่อเริ่มต้น</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["ผู้ใช้", "ตำแหน่ง", "สถานะ", "เข้าล่าสุด", "จัดการ"].map((h, i) => <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 12, borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}</tr></thead>
          <tbody>{users.map(u => { const r = ROLES[u.role] || ROLES.shipping; return (
            <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "12px 14px" }}><div style={{ fontWeight: 600 }}>{u.display_name}</div><div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>@{u.username}</div></td>
              <td style={{ padding: "12px 14px" }}><span style={{ padding: "3px 10px", borderRadius: 20, background: r.bg, color: r.color, fontSize: 12, fontWeight: 600 }}>{r.icon} {r.label}</span></td>
              <td style={{ padding: "12px 14px" }}><span style={{ color: u.is_active ? "#059669" : "#dc2626", fontWeight: 600, fontSize: 12 }}>{u.is_active ? "🟢 ใช้งาน" : "🔴 ปิด"}</span></td>
              <td style={{ padding: "12px 14px", fontSize: 12, color: "#64748b" }}>{u.last_login ? new Date(u.last_login).toLocaleString("th-TH") : "—"}</td>
              <td style={{ padding: "12px 14px" }}><div style={{ display: "flex", gap: 4 }}>
                <button title="รีเซ็ต" onClick={() => resetPassword(u)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🔑</button>
                <button title={u.is_active ? "ปิด" : "เปิด"} onClick={() => toggleActive(u)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{u.is_active ? "🚫" : "✅"}</button>
              </div></td>
            </tr>); })}</tbody>
        </table>
      )}
    </div>
  </>);

  if (inline) return <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>{renderContent()}</div>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {renderContent()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRINT LABEL 100x75mm
// ═══════════════════════════════════════════════════════════════
function PrintLabel({ parcel, onClose }) {
  const ref = useRef();
  const [barcodeUrl, setBarcodeUrl] = useState("");

  useEffect(() => {
    if (!parcel.flash_pno) return;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js";
    script.onload = () => {
      const canvas = document.createElement("canvas");
      try {
        window.JsBarcode(canvas, parcel.flash_pno, { format: "CODE128", width: 2, height: 120, displayValue: false, margin: 4, background: "#ffffff" });
        setBarcodeUrl(canvas.toDataURL("image/png"));
      } catch {}
    };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, [parcel.flash_pno]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html><head>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
      <style>@page{size:100mm 75mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{width:100mm;height:75mm;font-family:'IBM Plex Sans Thai',sans-serif}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
    </head><body>${ref.current.innerHTML}
      <script>var imgs=document.querySelectorAll('img'),loaded=0,total=imgs.length;if(!total)window.print();else{imgs.forEach(function(img){if(img.complete){loaded++;if(loaded>=total)window.print();}else{img.onload=img.onerror=function(){loaded++;if(loaded>=total)window.print();};}});setTimeout(function(){window.print();},5000);}</script>
    </body></html>`);
    win.document.close();
  };

  const pno = parcel.flash_pno || "";
  const sc = parcel.flash_sort_code || "";
  const maskPhone = (ph) => (ph || "").replace(/^(\d{3})\d{4}(\d{3})$/, "$1****$2");
  const now = new Date().toLocaleString("en-GB", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 480, width: "95%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🖨️ ใบปะหน้า</h3><button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button></div>
        <div ref={ref} style={{ border: "1px solid #ccc" }}>
          <div style={{ width: "100mm", height: "75mm", fontFamily: "'IBM Plex Sans Thai',sans-serif", border: "0.5mm solid #000", overflow: "hidden", boxSizing: "border-box", display: "flex", flexDirection: "column", background: "#fff" }}>
            {/* Row1: Sort Code */}
            <div style={{ background: "#333", color: "#fff", display: "flex", alignItems: "stretch", height: "8mm" }}>
              <div style={{ background: "#e67e22", color: "#fff", fontSize: "14pt", fontWeight: 900, padding: "0 3mm", display: "flex", alignItems: "center", justifyContent: "center", minWidth: "10mm" }}>1</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20pt", fontWeight: 900, letterSpacing: "1px" }}>{sc || "FLASH EXPRESS"}</div>
            </div>
            {/* Row2: Barcode */}
            <div style={{ textAlign: "center", height: "16mm", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {pno && barcodeUrl ? <img src={barcodeUrl} style={{ maxWidth: "94mm", height: "14mm" }} alt="" /> : <div style={{ height: "14mm" }} />}
            </div>
            {/* Row3: Tracking Number */}
            <div style={{ background: "#f0f0f0", textAlign: "center", fontSize: "14pt", fontWeight: 900, fontFamily: "'Courier New',monospace", letterSpacing: "2.5px", padding: "1.2mm 0", borderTop: "0.5mm solid #bbb", borderBottom: "0.5mm solid #bbb" }}>{pno || "—"}</div>
            {/* Row4: DST */}
            <div style={{ background: "#666", color: "#fff", fontSize: "9pt", fontWeight: 700, padding: "0.8mm 3mm" }}><span style={{ fontWeight: 900 }}>DST</span> &nbsp;&nbsp; {parcel.receiver_district || ""} — {parcel.receiver_province || ""}</div>
            {/* Row5: Sender */}
            <div style={{ fontSize: "6.5pt", color: "#555", padding: "0.5mm 3mm", borderBottom: "0.3mm solid #ddd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>ผู้ส่ง {parcel.sender_name} {parcel.sender_phone} {parcel.sender_address || ""}</div>
            {/* Row6: Receiver + QR */}
            <div style={{ display: "flex", flex: 1, padding: "1mm 3mm", gap: "2mm", overflow: "hidden" }}>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <div style={{ fontSize: "10pt", fontWeight: 800 }}>ผู้รับ {parcel.receiver_name}</div>
                <div style={{ fontSize: "15pt", fontWeight: 900, fontFamily: "'Courier New',monospace", lineHeight: 1.1 }}>{maskPhone(parcel.receiver_phone)}</div>
                <div style={{ fontSize: "7.5pt", lineHeight: 1.35, marginTop: "0.5mm" }}>
                  {parcel.receiver_address || ""}<br/>
                  {parcel.receiver_subdistrict}{parcel.receiver_subdistrict ? ", " : ""}{parcel.receiver_district}<br/>
                  {parcel.receiver_province} {parcel.receiver_postal}
                </div>
              </div>
              {pno && <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${pno}&margin=0`} style={{ width: "20mm", height: "20mm", alignSelf: "center", flexShrink: 0 }} alt="" />}
            </div>
            {/* Row7: COD */}
            {parcel.cod_enabled && <div style={{ background: "#000", display: "flex", alignItems: "center", padding: "1.5mm 3mm", gap: "3mm" }}>
              <span style={{ background: "#fff", color: "#000", fontSize: "8pt", fontWeight: 900, padding: "0.8mm 3mm" }}>COD</span>
              <span style={{ color: "#fff", fontSize: "14pt", fontWeight: 900 }}>เก็บเงินค่าสินค้า COD {Number(parcel.cod_amount || 0).toLocaleString()}</span>
            </div>}
            {/* Row8: Note */}
            {parcel.remark && <div style={{ fontSize: "9pt", fontWeight: 700, padding: "0.8mm 3mm", borderTop: "0.3mm solid #999", background: "#f9f9f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Note: {parcel.remark}</div>}
            {/* Row9: Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "5.5pt", color: "#999", padding: "0.3mm 3mm", borderTop: "0.3mm solid #ddd", marginTop: "auto" }}>
              <span>Print-: {now}</span>
              <span>1/1</span>
              <span>THE MT</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={handlePrint} style={{ flex: 1, padding: 12, background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>🖨️ ปริ้นลาเบล</button>
          <button onClick={onClose} style={{ padding: "12px 24px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARCEL FORM
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// ADDRESS PARSER — วางที่อยู่แล้วจับอัตโนมัติ
// ═══════════════════════════════════════════════════════════════
function parseThaiAddress(raw) {
  const r = { name: "", phone: "", address: "", subdistrict: "", district: "", province: "", postal: "", page: "", note: "" };
  if (!raw) return r;
  let lines = raw.replace(/\r/g, "").split("\n").map(s => s.trim()).filter(Boolean);

  // ── แยกบรรทัดพิเศษ: @สินค้า/หมายเหตุ, FB:, เพจ/P: ──
  const rest = [];
  let sellerPage = "";
  for (const line of lines) {
    if (/^@/.test(line)) { if (!r.note) r.note = line.replace(/^@\s*/, "").trim(); continue; }
    let m;
    if ((m = line.match(/^(?:FB|facebook|เฟส|เฟซ|ไลน์|line)\s*[:：\-]\s*(.+)/i))) { if (!r.page) r.page = m[1].trim(); continue; }
    if ((m = line.match(/^(?:P|page|เพจ)\s*[:：\-]\s*(.+)/i))) { if (!sellerPage) sellerPage = m[1].trim(); continue; }
    rest.push(line);
  }
  if (!r.page && sellerPage) r.page = sellerPage.replace(/\s*โทร\.?[\s\d\-]+$/i, "").trim();
  const full = rest.join(" ");

  // ── โหมดมีป้ายกำกับ (ชื่อ/ที่อยู่/จังหวัด/อำเภอ/ตำบล/ไปรษณีย์/เบอร์ อัดรวมกัน) ──
  const LAB = [
    { keys: ["ชื่อ-สกุล", "ชื่อสกุล", "ชื่อ", "ผู้รับ"], f: "name" },
    { keys: ["ที่อยู่", "บ้านเลขที่"], f: "address" },
    { keys: ["ตำบล", "แขวง"], f: "subdistrict" },
    { keys: ["อำเภอ", "เขต"], f: "district" },
    { keys: ["จังหวัด"], f: "province" },
    { keys: ["รหัสไปรษณีย์", "เลขไปรษณีย์", "ไปรษณีย์"], f: "postal" },
    { keys: ["เบอร์โทรศัพท์", "เบอร์โทร", "โทรศัพท์", "เบอร์", "โทร"], f: "phone" },
  ];
  const found = [];
  for (const lab of LAB) {
    for (const k of lab.keys) {
      const idx = full.indexOf(k);
      if (idx >= 0) { found.push({ f: lab.f, start: idx, vs: idx + k.length }); break; }
    }
  }
  if (found.length >= 3) {
    found.sort((a, b) => a.start - b.start);
    for (let i = 0; i < found.length; i++) {
      const end = i + 1 < found.length ? found[i + 1].start : full.length;
      let v = full.slice(found[i].vs, end).replace(/^[:：\-\s,()]+|[\s,()]+$/g, "").trim();
      if (found[i].f === "phone") { const pm = v.match(/\d[\d\-\s]{7,}/); v = pm ? pm[0].replace(/[^\d]/g, "") : ""; }
      else if (found[i].f === "postal") { const pm = v.match(/\d{5}/); v = pm ? pm[0] : ""; }
      if (v) r[found[i].f] = v;
    }
    if (r.postal && ADDR_DB[r.postal]?.length) {
      const a = ADDR_DB[r.postal][0];
      if (!r.province) r.province = a.p;
      if (!r.district) r.district = a.d;
      if (!r.subdistrict) r.subdistrict = a.s;
    }
    return r;
  }

  // ── โหมดทั่วไป (เดิม) ──
  const phoneMatch = full.match(/(\d[\d-]{8,})/);
  if (phoneMatch) r.phone = phoneMatch[1].replace(/-/g, "");
  const postalMatch = full.match(/\b(\d{5})\b/);
  if (postalMatch) {
    r.postal = postalMatch[1];
    const addrList = ADDR_DB[r.postal];
    if (addrList?.length) { r.province = addrList[0].p; r.district = addrList[0].d; r.subdistrict = addrList[0].s; }
  }
  const provMatch = full.match(/(จ\.|จังหวัด)\s*([ก-๙]+)/);
  if (provMatch) r.province = provMatch[2];
  else { for (const p of PROVINCES) { if (full.includes(p)) { r.province = p; break; } } }
  const distMatch = full.match(/(อ\.|อำเภอ|เขต)\s*([ก-๙]+)/);
  if (distMatch) r.district = distMatch[2];
  const subMatch = full.match(/(ต\.|ตำบล|แขวง)\s*([ก-๙]+)/);
  if (subMatch) r.subdistrict = subMatch[2];
  if (rest.length >= 2) r.name = rest[0].replace(/(\d[\d-]{8,})/, "").trim();
  else r.name = full.split(/\d{3}/)[0]?.trim() || "";
  if (r.phone && r.name.includes(r.phone)) r.name = r.name.replace(r.phone, "").trim();
  let addr = full;
  [r.name, r.phone, `จ.${r.province}`, `จังหวัด${r.province}`, r.province, `อ.${r.district}`, `อำเภอ${r.district}`, `เขต${r.district}`, `ต.${r.subdistrict}`, `ตำบล${r.subdistrict}`, `แขวง${r.subdistrict}`, r.postal].forEach(v => { if (v) addr = addr.replace(v, ""); });
  r.address = addr.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  return r;
}

// ═══════════════════════════════════════════════════════════════
// PARCEL FORM — with Shop selector + Address parser
// ═══════════════════════════════════════════════════════════════
function ParcelForm({ parcel, user, shops, salePersons = [], onSave, onClose }) {
  const isEdit = !!parcel?.id;
  const [form, setForm] = useState(parcel || { sender_name: "", sender_phone: "", sender_address: "", sender_province: "", receiver_name: "", receiver_phone: "", receiver_address: "", receiver_province: "", receiver_district: "", receiver_subdistrict: "", receiver_postal: "", weight: 1, item_desc: "", sale_person: "", sale_price: 0, customer_fb_line: "", quantity: 1, cod_enabled: false, cod_amount: 0, remark: "" });
  const [saving, setSaving] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [rawAddr, setRawAddr] = useState("");

  // โหลดข้อมูลร้านค้าเริ่มต้น
  useEffect(() => {
    if (!isEdit && shops?.length) {
      const def = shops.find(s => s.is_default) || shops[0];
      if (def) setForm(f => ({ ...f, sender_name: def.name || "", sender_phone: def.phone || "", sender_address: def.address || "", sender_province: def.province || "", sender_postal: def.postal || "", sender_district: def.district || "", sender_subdistrict: def.subdistrict || "", shop_id: def.id }));
    }
  }, [isEdit, shops]);

  const selectShop = (shopId) => {
    const shop = shops?.find(s => s.id === shopId);
    if (shop) setForm(f => ({ ...f, sender_name: shop.name || "", sender_phone: shop.phone || "", sender_address: shop.address || "", sender_province: shop.province || "", sender_postal: shop.postal || "", sender_district: shop.district || "", sender_subdistrict: shop.subdistrict || "", shop_id: shop.id }));
  };

  const handleParseAddress = () => {
    const parsed = parseThaiAddress(rawAddr);
    setForm(f => ({
      ...f,
      receiver_name: parsed.name || f.receiver_name,
      receiver_phone: parsed.phone || f.receiver_phone,
      receiver_address: parsed.address || f.receiver_address,
      receiver_subdistrict: parsed.subdistrict || f.receiver_subdistrict,
      receiver_district: parsed.district || f.receiver_district,
      receiver_province: parsed.province || f.receiver_province,
      receiver_postal: parsed.postal || f.receiver_postal,
      customer_fb_line: parsed.page || f.customer_fb_line,
      remark: parsed.note || f.remark,
    }));
    setPasteMode(false);
    setRawAddr("");
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => {
    if (!form.receiver_name || !form.receiver_phone) { uiAlert("กรุณากรอกชื่อ+เบอร์ผู้รับ"); return; }
    setSaving(true);
    try { const d = { ...form }; delete d.id; delete d.created_at; delete d.updated_at; if (isEdit) { await sb.update("fx_parcels", parcel.id, d); } else { d.parcel_no = generateParcelNo(); d.status = "draft"; d.created_by = user.id; d.created_by_name = user.display_name; d.source = "manual"; await sb.insert("fx_parcels", d); try { await sb.insert("fx_activity_log", { actor_id: user.id, actor_name: user.display_name, action: "สร้างพัสดุ", detail: `${d.parcel_no} · ${d.receiver_name}` }); } catch {} } sb.broadcastChange(); onSave(); } catch (e) { uiAlert(e.message); }
    setSaving(false);
  };
  const I = { width: "100%", padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none", fontFamily: "inherit" };
  const L = { display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 };
  const F = ({ label, k, ph, type = "text", span }) => <div style={{ gridColumn: span ? `span ${span}` : undefined }}><label style={L}>{label}</label><input type={type} value={form[k] || ""} onChange={e => set(k, type === "number" ? +e.target.value : e.target.value)} placeholder={ph} style={I} /></div>;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 30, overflowY: "auto" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 680, marginBottom: 40, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)", padding: "20px 24px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{isEdit ? "✏️ แก้ไข" : "📦 สร้างพัสดุใหม่"}</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24, maxHeight: "70vh", overflowY: "auto" }}>
          {/* ═══ เลือกร้านค้า ═══ */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>🏪 ร้านค้า / ผู้ส่ง</h3>
            {shops?.length > 0 && (
              <select value={form.shop_id || ""} onChange={e => selectShop(e.target.value)} style={{ padding: "6px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", fontWeight: 600, color: "#dc2626" }}>
                <option value="">-- เลือกร้าน --</option>
                {shops.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="ชื่อ" k="sender_name" ph="ร้าน" /><F label="เบอร์" k="sender_phone" ph="08X..." />
            <F label="ที่อยู่" k="sender_address" ph="ที่อยู่" span={2} />
            <div><label style={L}>จังหวัด</label><select value={form.sender_province || ""} onChange={e => set("sender_province", e.target.value)} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
            <F label="ไปรษณีย์" k="sender_postal" ph="XXXXX" />
          </div>

          {/* ═══ ผู้รับ + ปุ่มวางที่อยู่ ═══ */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📥 ผู้รับ</h3>
            <button onClick={() => setPasteMode(!pasteMode)} style={{ padding: "6px 14px", background: pasteMode ? "#dc2626" : "#eef2ff", color: pasteMode ? "#fff" : "#4f46e5", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
              {pasteMode ? "✕ ปิด" : "📋 วางที่อยู่อัตโนมัติ"}
            </button>
          </div>

          {pasteMode && (
            <div style={{ marginBottom: 16, padding: 14, background: "#eef2ff", borderRadius: 12, border: "1.5px solid #c7d2fe" }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5", marginBottom: 6, display: "block" }}>วางชื่อ + ที่อยู่ทั้งหมดตรงนี้ ระบบจะจับอัตโนมัติ</label>
              <textarea value={rawAddr} onChange={e => setRawAddr(e.target.value)} rows={5} placeholder={"เพจ: ครีมรากโสม\nสมชาย ใจดี 0891112222\n456 ม.5 ต.บ้านนา อ.เมือง จ.นครสวรรค์ 60000"} style={{ ...I, resize: "vertical", fontSize: 13, borderColor: "#a5b4fc" }} />
              <button onClick={handleParseAddress} disabled={!rawAddr.trim()} style={{ marginTop: 8, padding: "8px 20px", background: rawAddr.trim() ? "#4f46e5" : "#94a3b8", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: rawAddr.trim() ? "pointer" : "not-allowed" }}>⚡ จับที่อยู่อัตโนมัติ</button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="ชื่อ *" k="receiver_name" ph="ชื่อ" /><F label="เบอร์ *" k="receiver_phone" ph="08X..." />
            <F label="ที่อยู่" k="receiver_address" ph="ที่อยู่" span={2} />
            <div style={{ gridColumn: "span 2" }}>
              <label style={L}>รหัสไปรษณีย์ (พิมพ์แล้วเติมที่อยู่อัตโนมัติ)</label>
              <input value={form.receiver_postal || ""} onChange={e => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                set("receiver_postal", v);
                if (v.length === 5 && ADDR_DB[v]) {
                  const list = ADDR_DB[v];
                  if (list.length === 1) {
                    set("receiver_province", list[0].p); set("receiver_district", list[0].d); set("receiver_subdistrict", list[0].s);
                    setForm(f => ({ ...f, receiver_postal: v, receiver_province: list[0].p, receiver_district: list[0].d, receiver_subdistrict: list[0].s }));
                  }
                }
              }} placeholder="XXXXX → เติมจังหวัด อำเภอ ตำบล อัตโนมัติ" style={{ ...I, borderColor: "#6366f1", fontWeight: 600 }} />
              {form.receiver_postal?.length === 5 && ADDR_DB[form.receiver_postal]?.length > 1 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {ADDR_DB[form.receiver_postal].map((a, i) => (
                    <button key={i} onClick={() => setForm(f => ({ ...f, receiver_province: a.p, receiver_district: a.d, receiver_subdistrict: a.s }))}
                      style={{ padding: "4px 10px", fontSize: 11, border: form.receiver_subdistrict === a.s && form.receiver_district === a.d ? "2px solid #6366f1" : "1px solid #e2e8f0", borderRadius: 8, background: form.receiver_subdistrict === a.s && form.receiver_district === a.d ? "#eef2ff" : "#fff", cursor: "pointer", fontWeight: 500 }}>
                      {a.s} · {a.d}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <F label="ตำบล" k="receiver_subdistrict" ph="ตำบล" /><F label="อำเภอ" k="receiver_district" ph="อำเภอ" />
            <div><label style={L}>จังหวัด</label><select value={form.receiver_province || ""} onChange={e => set("receiver_province", e.target.value)} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
          </div>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>📦 พัสดุ</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <F label="น้ำหนัก (kg)" k="weight" type="number" /><F label="จำนวน" k="quantity" type="number" /><F label="สินค้า" k="item_desc" ph="สินค้า" />
            <div style={{ gridColumn: "span 3" }}>
              <label style={L}>👤 พนักงานขาย (Sale)</label>
              <input list="salePersonList" value={form.sale_person || ""} onChange={e => set("sale_person", e.target.value)} placeholder="เลือกจากรายชื่อ หรือพิมพ์ชื่อใหม่" style={I} />
              <datalist id="salePersonList">{salePersons.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <F label="💵 ราคาขาย (บาท)" k="sale_price" type="number" span={3} />
            <F label="📱 FB / Line ลูกค้า" k="customer_fb_line" ph="ชื่อ FB หรือ Line ของลูกค้า" span={3} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>💰 COD</h3>
            <div onClick={() => set("cod_enabled", !form.cod_enabled)} style={{ width: 44, height: 24, borderRadius: 12, background: form.cod_enabled ? "#059669" : "#d1d5db", cursor: "pointer", position: "relative" }}><div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff", position: "absolute", top: 2, left: form.cod_enabled ? 22 : 2, transition: ".2s" }} /></div>
          </div>
          {form.cod_enabled && <F label="จำนวนเงิน (บาท)" k="cod_amount" type="number" />}
          <div style={{ marginTop: 16 }}><label style={L}>หมายเหตุ</label><textarea value={form.remark || ""} onChange={e => set("remark", e.target.value)} rows={2} style={{ ...I, resize: "vertical" }} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: 14, background: saving ? "#94a3b8" : "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{saving ? "..." : isEdit ? "💾 บันทึก" : "📦 สร้าง"}</button>
          <button onClick={onClose} style={{ padding: "14px 28px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// IMPORT EXCEL MODAL
// ═══════════════════════════════════════════════════════════════
function ImportModal({ user, shops, onSave, onClose, inline }) {
  const [rows, setRows] = useState([]);
  const [rejectedRows, setRejectedRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [importFailed, setImportFailed] = useState([]);
  const [importTotal, setImportTotal] = useState(0);
  const [selectedShop, setSelectedShop] = useState(shops?.find(s => s.is_default)?.id || shops?.[0]?.id || "");
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      // Find header row — row that has values in multiple columns (not just col 0)
      let headerIdx = 0;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        const filledCols = row.filter((v, j) => j > 0 && v && String(v).trim()).length;
        const rowText = row.map(String).join("|").toLowerCase();
        if (filledCols >= 3 && (rowText.includes("mobile") || rowText.includes("name") || rowText.includes("ชื่อ"))) { headerIdx = i; break; }
      }
      const parsed = [];
      for (let i = headerIdx + 1; i < data.length; i++) {
        const r = data[i];
        if (!r || !r[0]) continue;
        const phone = String(r[0] || "").replace(/[^0-9]/g, "");
        const name = String(r[1] || "");
        const address = String(r[2] || "");
        const subdistrict = String(r[3] || "");
        const district = String(r[4] || "");
        const postal = String(r[5] || "").replace(/[^0-9]/g, "");
        const codAmount = parseFloat(r[10]) || 0;
        const remark = String(r[11] || "");
        if (!phone && !name) continue;

        // Auto-fill province from postal code
        let province = "";
        let autoDistrict = district;
        let autoSubdistrict = subdistrict;
        if (postal && ADDR_DB[postal]) {
          const addrList = ADDR_DB[postal];
          province = addrList[0]?.p || "";
          // Try to match district/subdistrict
          if (!autoDistrict && addrList.length === 1) autoDistrict = addrList[0].d;
          if (!autoSubdistrict && addrList.length === 1) autoSubdistrict = addrList[0].s;
          // If district provided, find matching entry
          if (district) {
            const match = addrList.find(a => a.d === district);
            if (match) { province = match.p; if (!autoSubdistrict) autoSubdistrict = match.s; }
          }
        }

        parsed.push({
          receiver_phone: phone.startsWith("0") ? phone : "0" + phone,
          receiver_name: name,
          receiver_address: address,
          receiver_subdistrict: autoSubdistrict,
          receiver_district: autoDistrict,
          receiver_province: province,
          receiver_postal: postal,
          cod_enabled: codAmount > 0,
          cod_amount: codAmount,
          customer_fb_line: String(r[6] || ""),
          item_desc: String(r[7] || ""),
          sale_person: String(r[8] || ""),
          sale_price: parseFloat(r[9]) || 0,
          remark: remark,
          _selected: true,
        });
      }
      // แยกรายชื่อที่ไม่มีชื่อแอดมิน
      const valid = parsed.filter(r => r.sale_person && r.sale_person.trim());
      const rejected = parsed.filter(r => !r.sale_person || !r.sale_person.trim());
      setRows(valid);
      setRejectedRows(rejected);
    } catch (err) { uiAlert("อ่านไฟล์ไม่ได้: " + err.message); }
  };

  const handleImport = async () => {
    const selected = rows.filter(r => r._selected);
    if (!selected.length) { uiAlert("ไม่มีรายการที่เลือก"); return; }
    const shop = shops?.find(s => s.id === selectedShop);
    setImporting(true);
    setImportTotal(selected.length);
    let success = 0;
    const failedItems = [];
    for (let i = 0; i < selected.length; i++) {
      const r = selected[i];
      try {
        const parcelData = {
          parcel_no: generateParcelNo(),
          status: "draft",
          sender_name: shop?.name || "", sender_phone: shop?.phone || "", sender_address: shop?.address || "",
          sender_province: shop?.province || "", sender_district: shop?.district || "",
          sender_subdistrict: shop?.subdistrict || "", sender_postal: shop?.postal || "",
          receiver_name: r.receiver_name, receiver_phone: r.receiver_phone, receiver_address: r.receiver_address || "-",
          receiver_subdistrict: r.receiver_subdistrict, receiver_district: r.receiver_district,
          receiver_province: r.receiver_province || "", receiver_postal: r.receiver_postal,
          weight: 1, quantity: 1, item_desc: r.item_desc || "",
          cod_enabled: r.cod_enabled, cod_amount: r.cod_amount || 0,
          customer_fb_line: r.customer_fb_line || "",
          sale_person: r.sale_person || "",
          sale_price: r.sale_price || 0,
          remark: r.remark || "",
          source: "import",
          created_by: user.id, created_by_name: user.display_name, shop_id: selectedShop || null,
        };
        await sb.insert("fx_parcels", parcelData);
        success++;
      } catch (err) {
        console.warn("Import failed:", r.receiver_name, err.message);
        failedItems.push({ ...r, _error: err.message });
      }
      setProgress(Math.round(((i + 1) / selected.length) * 100));
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 500));
    }
    setDone(true);
    try { if (success > 0) await sb.insert("fx_activity_log", { actor_id: user.id, actor_name: user.display_name, action: "Import พัสดุ", detail: `${success} ใบ` }); } catch {}
    if (failedItems.length > 0) {
      setImportFailed(failedItems);
    }
    // ไม่ auto-close — รอกดปุ่มตกลง
  };

  const toggleRow = (i) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, _selected: !r._selected } : r));
  const toggleAll = () => { const allSel = rows.every(r => r._selected); setRows(prev => prev.map(r => ({ ...r, _selected: !allSel }))); };

  if (inline) return (
    <div style={{ padding: 24 }}>
      {/* Popup แจ้งเตือนรายชื่อไม่มีแอดมิน */}
      {rejectedRows.length > 0 && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 20, maxWidth: 550, width: "100%", maxHeight: "80vh", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#fef2f2,#fff7ed)", borderBottom: "1px solid #fca5a5" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626" }}>⚠️ พบรายชื่อไม่มีชื่อแอดมิน</div>
              <div style={{ fontSize: 13, color: "#92400e", marginTop: 4 }}>{rejectedRows.length} รายชื่อถูกแยกออก ไม่ import เพราะไม่มี SalesPerson</div>
            </div>
            <div style={{ padding: "16px 24px", maxHeight: 300, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#fef2f2" }}>
                  {["#","ชื่อ","เบอร์","COD"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>{h}</th>)}
                </tr></thead>
                <tbody>{rejectedRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #fee2e2" }}>
                    <td style={{ padding: "6px 10px", color: "#9ca3af" }}>{i + 1}</td>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.receiver_name}</td>
                    <td style={{ padding: "6px 10px" }}>{r.receiver_phone}</td>
                    <td style={{ padding: "6px 10px" }}>{r.cod_amount || 0}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{ padding: "16px 24px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => {
                const bom = "\uFEFF";
                const headers = ["MobileNo","Name","Address","SubDistrict","District","ZIP","FB/Line","SalesChannel","SalesPerson","SalePrice","COD","Remark"];
                const csvRows = rejectedRows.map(r => [r.receiver_phone, r.receiver_name, r.receiver_address, r.receiver_subdistrict, r.receiver_district, r.receiver_postal, r.customer_fb_line, r.item_desc, "", r.sale_price, r.cod_amount, r.remark]);
                const csv = bom + [headers, ...csvRows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
                const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `no-salesperson-${new Date().toISOString().slice(0,10)}.csv`; a.click();
              }} style={{ padding: "10px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📥 ดาวน์โหลด {rejectedRows.length} รายชื่อ</button>
              <button onClick={() => setRejectedRows([])} style={{ padding: "10px 20px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#64748b" }}>✕ ปิด</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>🏪 ร้านผู้ส่ง:</label>
        <select value={selectedShop} onChange={e => setSelectedShop(e.target.value)} style={{ padding: "8px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit", minWidth: 200 }}><option value="">--</option>{shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </div>
      {rows.length === 0 && !importing && (<>
        <div onClick={() => fileRef.current?.click()} style={{ border: "2px dashed #d1d5db", borderRadius: 16, padding: 50, textAlign: "center", cursor: "pointer", background: "#fff" }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#475569" }}>คลิกเลือกไฟล์ หรือ ลากวาง</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>รองรับ .csv .xlsx .xls</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
        </div>
        <div style={{ marginTop: 16, padding: 16, background: "#fef9c3", borderRadius: 12, border: "1px solid #fde68a" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>📋 คอลัมน์ที่ต้องมี</div>
          <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>ชื่อ, เบอร์โทร, ที่อยู่, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์, COD, หมายเหตุ</div>
          <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 4 }}>* ชื่อคอลัมน์ภาษาไทยหรืออังกฤษก็ได้ ระบบจับอัตโนมัติ</div>
        </div>
        <button onClick={() => {
          const bom = "\uFEFF";
          const headers = ["Mobile","Name","Address","Sub District","District","Zipcode","FB/LINE","Product","Sale","Sale Price","COD","Remark"];
          const sample = ["0812345678","สมชาย ใจดี","123/4 หมู่ 5","ในเมือง","เมืองพิษณุโลก","65000","fb:somchai","ครีมหน้าขาว","แอดมิน","390","390","ครีม 1 เซรั่ม 1"];
          const csv = bom + [headers.join(","), sample.join(",")].join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "import-template.csv"; a.click();
        }} style={{ marginTop: 12, padding: "10px 20px", background: "#fff", color: "#4f46e5", border: "2px solid #4f46e5", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📄 ดาวน์โหลดไฟล์ตัวอย่าง</button>
      </>)}
      {rows.length > 0 && !importing && (<>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><span style={{ fontSize: 14, fontWeight: 700 }}>พบ {rows.length} รายการ</span><button onClick={toggleAll} style={{ padding: "6px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{rows.every(r => r._selected) ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
        {rejectedRows.length > 0 && (
          <div style={{ marginBottom: 12, padding: "12px 16px", background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={{ fontWeight: 800, color: "#dc2626", fontSize: 14 }}>⚠️ {rejectedRows.length} รายชื่อไม่มีชื่อแอดมิน</span>
                <div style={{ fontSize: 12, color: "#92400e", marginTop: 2 }}>รายชื่อเหล่านี้ถูกแยกออก ไม่ import — ดาวน์โหลดไปแก้ไขแล้ว import ใหม่</div>
              </div>
              <button onClick={() => {
                const bom = "\uFEFF";
                const headers = ["MobileNo","Name","Address","SubDistrict","District","ZIP","FB/Line","SalesChannel","SalesPerson","SalePrice","COD","Remark"];
                const csvRows = rejectedRows.map(r => [r.receiver_phone, r.receiver_name, r.receiver_address, r.receiver_subdistrict, r.receiver_district, r.receiver_postal, r.customer_fb_line, r.item_desc, "", r.sale_price, r.cod_amount, r.remark]);
                const csv = bom + [headers, ...csvRows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
                const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `no-salesperson-${new Date().toISOString().slice(0,10)}.csv`; a.click();
              }} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>📥 ดาวน์โหลด {rejectedRows.length} รายชื่อ</button>
            </div>
          </div>
        )}
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ background: "#f8fafc" }}><th style={{ padding: 8, width: 30 }}>✓</th><th style={{ padding: 8, textAlign: "left" }}>ชื่อ</th><th style={{ padding: 8, textAlign: "left" }}>เบอร์</th><th style={{ padding: 8, textAlign: "left" }}>อำเภอ</th><th style={{ padding: 8, textAlign: "right" }}>COD</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: "1px solid #f1f5f9", opacity: r._selected ? 1 : .4 }}><td style={{ padding: 8, textAlign: "center" }}><input type="checkbox" checked={r._selected} onChange={() => toggleRow(i)} /></td><td style={{ padding: 8, fontWeight: 600 }}>{r.receiver_name}</td><td style={{ padding: 8, fontFamily: "monospace" }}>{r.receiver_phone}</td><td style={{ padding: 8 }}>{r.receiver_district}</td><td style={{ padding: 8, textAlign: "right", fontWeight: 600, color: r.cod_amount > 0 ? "#d97706" : "#cbd5e1" }}>{r.cod_amount > 0 ? `฿${r.cod_amount}` : "—"}</td></tr>)}</tbody></table></div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button onClick={handleImport} style={{ flex: 1, padding: 14, background: "#059669", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>📥 นำเข้า {rows.filter(r => r._selected).length} รายการ</button><button onClick={() => setRows([])} style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>เลือกไฟล์ใหม่</button></div>
      </>)}
      {importing && <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>{done ? (importFailed.length > 0 ? "⚠️" : "✅") : "⏳"}</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{done ? (importFailed.length > 0 ? `นำเข้าสำเร็จ ${importTotal - importFailed.length}/${importTotal} รายการ` : "สำเร็จ!") : `กำลังนำเข้า... ${progress}%`}</div>
        <div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, marginTop: 12 }}><div style={{ width: `${progress}%`, height: "100%", background: importFailed.length > 0 ? "#f59e0b" : "#059669", borderRadius: 4 }} /></div>
        {done && importFailed.length > 0 && (<div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, color: "#dc2626", fontWeight: 700, marginBottom: 8 }}>❌ {importFailed.length} รายการนำเข้าไม่สำเร็จ:</div>
          <div style={{ maxHeight: 150, overflow: "auto", textAlign: "left", background: "#fef2f2", borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 12 }}>
            {importFailed.map((f, i) => <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #fecaca" }}>❌ {f.receiver_name} ({f.receiver_phone}) — <span style={{ color: "#999" }}>{f._error}</span></div>)}
          </div>
          <button onClick={() => { const bom = "\uFEFF"; const headers = ["ชื่อ","เบอร์","ที่อยู่","ตำบล","อำเภอ","จังหวัด","ไปรษณีย์","COD","หมายเหตุ","สาเหตุ"]; const csvRows = importFailed.map(f => [f.receiver_name,f.receiver_phone,f.receiver_address,f.receiver_subdistrict,f.receiver_district,f.receiver_province,f.receiver_postal,f.cod_amount||"",f.remark||"",f._error].map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")); const csv = bom + [headers.join(","), ...csvRows].join("\n"); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `import-failed-${new Date().toISOString().slice(0,10)}.csv`; a.click(); }} style={{ padding: "10px 24px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📥 ดาวน์โหลดรายการที่ล้มเหลว ({importFailed.length} รายการ)</button>
          <button onClick={() => { sb.broadcastChange(); onSave(); }} style={{ padding: "10px 24px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer", marginLeft: 8 }}>✅ ตกลง</button>
        </div>)}
        {done && importFailed.length === 0 && <button onClick={() => { sb.broadcastChange(); onSave(); }} style={{ marginTop: 16, padding: "10px 24px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>✅ ตกลง</button>}
      </div>}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 30, overflowY: "auto" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 800, marginBottom: 40, overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg,#059669,#10b981)", padding: "20px 24px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>📥 Import Excel</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "#fff", width: 36, height: 36, borderRadius: 10, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 24, maxHeight: inline ? "none" : "75vh", overflowY: "auto" }}>
          {/* เลือกร้าน */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>🏪 ร้านผู้ส่ง:</label>
            <select value={selectedShop} onChange={e => setSelectedShop(e.target.value)} style={{ padding: "8px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit", flex: 1, minWidth: 150 }}>
              <option value="">-- เลือกร้าน --</option>
              {shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* เลือกไฟล์ */}
          {rows.length === 0 && (
            <div>
              <div onClick={() => fileRef.current?.click()} style={{ border: "2px dashed #d1d5db", borderRadius: 16, padding: 40, textAlign: "center", cursor: "pointer", background: "#fafafa" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#475569" }}>คลิกเพื่อเลือกไฟล์ Excel</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>รองรับ .xlsx, .xls (รูปแบบ Flash Express)</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
              </div>
              <button onClick={() => {
                const bom = "\uFEFF";
                const headers = ["Mobile","Name","Address","Sub District","District","Zipcode","FB/LINE","Product","Sale","Sale Price","COD","Remark"];
                const sample = ["0812345678","สมชาย ใจดี","123/4 หมู่ 5","ในเมือง","เมืองพิษณุโลก","65000","fb:somchai","ครีมหน้าขาว","แอดมิน","390","390","ครีม 1 เซรั่ม 1"];
                const csv = bom + [headers.join(","), sample.join(",")].join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "import-template.csv"; a.click();
              }} style={{ marginTop: 12, padding: "10px 20px", background: "#fff", color: "#4f46e5", border: "2px solid #4f46e5", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📄 ดาวน์โหลดไฟล์ตัวอย่าง</button>
            </div>
          )}

          {/* แสดงข้อมูลที่อ่านได้ */}
          {rows.length > 0 && !importing && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>พบ {rows.length} รายการ (เลือก {rows.filter(r => r._selected).length})</span>
                <button onClick={toggleAll} style={{ padding: "6px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{rows.every(r => r._selected) ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</button>
              </div>
              <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: 8, width: 30 }}>✓</th>
                    <th style={{ padding: 8, textAlign: "left" }}>ชื่อ</th>
                    <th style={{ padding: 8, textAlign: "left" }}>เบอร์</th>
                    <th style={{ padding: 8, textAlign: "left" }}>อำเภอ</th>
                    <th style={{ padding: 8, textAlign: "right" }}>COD</th>
                  </tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9", opacity: r._selected ? 1 : .4 }}>
                      <td style={{ padding: 8, textAlign: "center" }}><input type="checkbox" checked={r._selected} onChange={() => toggleRow(i)} /></td>
                      <td style={{ padding: 8, fontWeight: 600 }}>{r.receiver_name}</td>
                      <td style={{ padding: 8, fontFamily: "monospace" }}>{r.receiver_phone}</td>
                      <td style={{ padding: 8 }}>{r.receiver_district}</td>
                      <td style={{ padding: 8, textAlign: "right", fontWeight: 600, color: r.cod_amount > 0 ? "#d97706" : "#cbd5e1" }}>{r.cod_amount > 0 ? `฿${r.cod_amount}` : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}

          {/* Progress */}
          {importing && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{done ? (importFailed.length > 0 ? "⚠️" : "✅") : "⏳"}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{done ? (importFailed.length > 0 ? `นำเข้าสำเร็จ ${importTotal - importFailed.length}/${importTotal} รายการ` : "นำเข้าสำเร็จ!") : `กำลังนำเข้า... ${progress}%`}</div>
              <div style={{ width: "100%", height: 8, background: "#e2e8f0", borderRadius: 4, marginTop: 12 }}>
                <div style={{ width: `${progress}%`, height: "100%", background: importFailed.length > 0 ? "#f59e0b" : "#059669", borderRadius: 4, transition: ".3s" }} />
              </div>
              {done && importFailed.length > 0 && (<div style={{ marginTop: 16, textAlign: "left" }}>
                <div style={{ fontSize: 14, color: "#dc2626", fontWeight: 700, marginBottom: 8, textAlign: "center" }}>❌ {importFailed.length} รายการนำเข้าไม่สำเร็จ</div>
                <div style={{ maxHeight: 150, overflow: "auto", background: "#fef2f2", borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 12 }}>
                  {importFailed.map((f, i) => <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #fecaca" }}>❌ {f.receiver_name} ({f.receiver_phone}) — <span style={{ color: "#999" }}>{f._error}</span></div>)}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button onClick={() => { const bom = "\uFEFF"; const headers = ["ชื่อ","เบอร์","ที่อยู่","ตำบล","อำเภอ","จังหวัด","ไปรษณีย์","COD","หมายเหตุ","สาเหตุ"]; const csvRows = importFailed.map(f => [f.receiver_name,f.receiver_phone,f.receiver_address,f.receiver_subdistrict,f.receiver_district,f.receiver_province,f.receiver_postal,f.cod_amount||"",f.remark||"",f._error].map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")); const csv = bom + [headers.join(","), ...csvRows].join("\n"); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `import-failed-${new Date().toISOString().slice(0,10)}.csv`; a.click(); }} style={{ padding: "10px 24px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📥 ดาวน์โหลดรายการที่ล้มเหลว</button>
                  <button onClick={() => { sb.broadcastChange(); onSave(); }} style={{ padding: "10px 24px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>✅ ตกลง</button>
                </div>
              </div>)}
              {done && importFailed.length === 0 && <button onClick={() => { sb.broadcastChange(); onSave(); }} style={{ marginTop: 16, padding: "10px 24px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>✅ ตกลง</button>}
            </div>
          )}
        </div>
        {rows.length > 0 && !importing && (
          <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 10 }}>
            <button onClick={handleImport} disabled={!rows.some(r => r._selected)} style={{ flex: 1, padding: 14, background: rows.some(r => r._selected) ? "#059669" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>📥 นำเข้า {rows.filter(r => r._selected).length} รายการ</button>
            <button onClick={() => { setRows([]); }} style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>เลือกไฟล์ใหม่</button>
            <button onClick={onClose} style={{ padding: "14px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHOP MANAGEMENT MODAL
// ═══════════════════════════════════════════════════════════════
function ShopManagement({ onClose, onUpdate, isDemo, inline }) {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", province: "", postal: "", flash_mch_id: FLASH_ACCOUNTS[0]?.mchId || "" });
  const [saving, setSaving] = useState(false);
  const I = { width: "100%", padding: "10px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, outline: "none", fontFamily: "inherit" };

  const load = useCallback(async () => {
    if (isDemo) { setShops([{ id: "s1", name: "ร้าน ABC Shop", phone: "081-234-5678", address: "123 สุขุมวิท", province: "กรุงเทพมหานคร", postal: "10110", is_default: true, is_active: true }]); setLoading(false); return; }
    try { const d = await sb.select("fx_shops", { order: "created_at.asc" }); setShops(d || []); } catch {} setLoading(false);
  }, [isDemo]);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditId(null); setForm({ name: "", phone: "", address: "", province: "", postal: "", flash_mch_id: FLASH_ACCOUNTS[0]?.mchId || "" }); setShowForm(true); };
  const openEdit = (s) => { setEditId(s.id); setForm({ name: s.name || "", phone: s.phone || "", address: s.address || "", province: s.province || "", postal: s.postal || "", flash_mch_id: s.flash_mch_id || FLASH_ACCOUNTS[0]?.mchId || "" }); setShowForm(true); };

  const handleSave = async () => {
    if (!form.name || !form.phone) { uiAlert("กรุณากรอกชื่อร้าน + เบอร์โทร"); return; }
    setSaving(true);
    try {
      if (editId) { await sb.update("fx_shops", editId, form); }
      else { await sb.insert("fx_shops", { ...form, is_active: true, is_default: shops.length === 0 }); }
      setShowForm(false); load(); onUpdate?.();
    } catch (e) { uiAlert(e.message); }
    setSaving(false);
  };

  const toggleDefault = async (s) => {
    if (isDemo) return;
    try {
      const currentDefault = shops.find(sh => sh.is_default);
      if (currentDefault && currentDefault.id !== s.id) await sb.update("fx_shops", currentDefault.id, { is_default: false });
      await sb.update("fx_shops", s.id, { is_default: true }); load(); onUpdate?.();
    } catch (e) { uiAlert(e.message); }
  };

  const deleteShop = async (s) => {
    if (!await uiConfirm(`ลบร้าน ${s.name}?`)) return;
    try { await sb.delete("fx_shops", s.id); load(); onUpdate?.(); } catch (e) { uiAlert(e.message); }
  };

  const renderContent = () => (<>
    <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🏪 จัดการร้านค้า / ผู้ส่ง</h2>
      <button onClick={openAdd} style={{ padding: "8px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>＋ เพิ่มร้าน</button>
    </div>
    {showForm && (
      <div style={{ padding: "16px 24px", background: "#fafafa", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#1e293b" }}>{editId ? "✏️ แก้ไขร้านค้า" : "＋ เพิ่มร้านใหม่"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ชื่อร้าน *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่อร้าน" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>เบอร์โทร *</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08X..." style={I} /></div>
          <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>ที่อยู่</label><input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="บ้านเลขที่ ถนน ซอย ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" style={I} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>จังหวัด</label><select value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} style={{ ...I, background: "#fff" }}><option value="">--</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>รหัสไปรษณีย์</label><input value={form.postal} onChange={e => setForm(f => ({ ...f, postal: e.target.value }))} placeholder="XXXXX" style={I} /></div>
          <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 12, fontWeight: 600, color: "#dc2626" }}>⚡ บัญชี Flash Express</label><select value={form.flash_mch_id} onChange={e => setForm(f => ({ ...f, flash_mch_id: e.target.value }))} style={{ ...I, background: "#fff", borderColor: "#fbbf24" }}>{FLASH_ACCOUNTS.map(a => <option key={a.mchId} value={a.mchId}>{a.name} ({a.mchId})</option>)}</select></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={handleSave} disabled={saving} style={{ padding: "10px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>{saving ? "..." : editId ? "💾 บันทึก" : "✅ เพิ่มร้าน"}</button>
          <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
        </div>
      </div>
    )}
    <div style={{ overflowY: "auto" }}>
      {loading ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>โหลด...</div> :
      shops.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>ยังไม่มีร้านค้า — กด "＋ เพิ่มร้าน"</div> :
      shops.map(s => (
        <div key={s.id} style={{ padding: "14px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name} {s.is_default && <span style={{ fontSize: 10, background: "#ecfdf5", color: "#059669", padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 6 }}>ค่าเริ่มต้น</span>}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{s.phone} · {s.address} {s.province} {s.postal}</div>
            <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>⚡ {s.flash_mch_id || FLASH_ACCOUNTS[0]?.mchId}</div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button title="แก้ไข" onClick={() => openEdit(s)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
            {!s.is_default && <button title="ตั้งเป็นค่าเริ่มต้น" onClick={() => toggleDefault(s)} style={{ width: 30, height: 30, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>⭐</button>}
            <button title="ลบ" onClick={() => deleteShop(s)} style={{ width: 30, height: 30, border: "1px solid #fca5a5", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑️</button>
          </div>
        </div>
      ))}
    </div>
  </>);

  if (inline) return <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>{renderContent()}</div>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "95%", maxWidth: 560, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>{renderContent()}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATUS MODAL
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
let _uiDialog = null;
const uiConfirm = (message, opts = {}) => new Promise((resolve) => { if (_uiDialog) _uiDialog({ mode: "confirm", message, ...opts, resolve }); else resolve(window.confirm(message)); });
const uiAlert = (message, opts = {}) => new Promise((resolve) => { if (_uiDialog) _uiDialog({ mode: "alert", message, ...opts, resolve }); else { window.alert(message); resolve(); } });
function PublicTracking() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const search = async () => {
    const term = q.trim();
    if (!term) return;
    setLoading(true); setResults(null);
    try {
      const enc = encodeURIComponent(term);
      const url = `${SUPABASE_URL}/rest/v1/fx_parcels?or=(flash_pno.eq.${enc},receiver_phone.eq.${enc})&select=flash_pno,flash_sort_code,receiver_name,receiver_province,receiver_district,flash_status,flash_detail,flash_updated_at,created_at,status&order=created_at.desc&limit=20`;
      const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
      setResults(res.ok ? await res.json() : []);
    } catch { setResults([]); }
    setLoading(false);
  };
  const sColor = (fs, st) => {
    if (st === "cancelled") return { bg: "#fee2e2", color: "#991b1b", txt: "ยกเลิก" };
    if (!fs || fs === "สร้างรายการ") return { bg: "#fef3c7", color: "#92400e", txt: "กำลังเตรียมพัสดุ" };
    if (fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ")) return { bg: "#d1fae5", color: "#065f46", txt: fs };
    if (fs.includes("ไม่สำเร็จ") || fs.includes("คืน") || fs.includes("ตีกลับ") || fs.includes("ส่งกลับ")) return { bg: "#fee2e2", color: "#991b1b", txt: fs };
    if (fs.includes("ขนส่ง")) return { bg: "#ede9fe", color: "#6d28d9", txt: fs };
    return { bg: "#e0f2fe", color: "#0369a1", txt: fs };
  };
  const mask = (n) => { const s = (n || "").trim(); if (s.length <= 2) return s; return s.slice(0, 1) + "•".repeat(Math.max(1, s.length - 2)) + s.slice(-1); };
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#fff7ed,#f8fafc)", display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px", fontFamily: "'IBM Plex Sans Thai',sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 42 }}>🚚</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "8px 0 2px", color: "#dc2626" }}>ติดตามพัสดุ</h1>
          <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>บริษัทเดอะเอ็มที — กรอกเลขพัสดุ หรือ เบอร์โทรผู้รับ</p>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="เลขพัสดุ TH... หรือ เบอร์โทร" style={{ flex: 1, padding: "14px 18px", border: "2px solid #e2e8f0", borderRadius: 14, fontSize: 16, outline: "none", fontFamily: "inherit" }} autoFocus />
          <button onClick={search} disabled={loading} style={{ padding: "14px 26px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 14, fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>{loading ? "⏳" : "🔍 ค้นหา"}</button>
        </div>
        {results && results.map((p, i) => { const sc = sColor(p.flash_status, p.status); return (
          <div key={i} style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "18px 20px", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: "#4f46e5" }}>📦 {p.flash_pno || "—"}</span>
              <span style={{ padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700, background: sc.bg, color: sc.color }}>{sc.txt}</span>
            </div>
            <div style={{ fontSize: 14, color: "#334155" }}>ผู้รับ: {mask(p.receiver_name)}</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>ปลายทาง: {p.receiver_district || ""} {p.receiver_province || ""}</div>
            {p.flash_detail && <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>💬 {p.flash_detail}</div>}
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>📅 เข้าระบบ {new Date(p.created_at).toLocaleDateString("th-TH")}{p.flash_updated_at ? ` • อัปเดต ${new Date(p.flash_updated_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>
          </div>
        ); })}
        {results && results.length === 0 && !loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}><div style={{ fontSize: 40 }}>📭</div><div style={{ marginTop: 8, fontWeight: 600 }}>ไม่พบพัสดุ</div><div style={{ fontSize: 13, marginTop: 4 }}>กรุณาตรวจสอบเลขพัสดุหรือเบอร์โทรอีกครั้ง</div></div>
        )}
        <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "#cbd5e1" }}>ระบบจัดการขนส่ง · บริษัทเดอะเอ็มที</div>
      </div>
    </div>
  );
}
export default function FlashBackend() {
  const [user, setUser] = useState(() => {
    try { const s = sessionStorage.getItem("fx_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [parcels, setParcels] = useState([]);
  // เดือนที่เลือกดู (โหลดเฉพาะเดือนนี้เพื่อประหยัด egress) — ค่าเริ่มต้น = เดือนปัจจุบัน
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editParcel, setEditParcel] = useState(null);
  
  const [viewParcel, setViewParcel] = useState(null);
  const [printPreview, setPrintPreview] = useState(null); // array of parcels to preview before print
  const [labelProgress, setLabelProgress] = useState(null); // {done,total} ระหว่างโหลดใบ Flash จำนวนมาก
  const [shops, setShops] = useState([]);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [assignModal, setAssignModal] = useState(false);
  const [assignName, setAssignName] = useState("");
  const [activePage, setActivePageRaw] = useState(() => {
    try { return sessionStorage.getItem("fx_page") || "dashboard"; } catch { return "dashboard"; }
  });
  const setActivePage = (p) => { setActivePageRaw(p); try { sessionStorage.setItem("fx_page", p); } catch {} };
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;

  const handleLogin = (u) => { const safe = { id: u.id, username: u.username, display_name: u.display_name, role: u.role, avatar_color: u.avatar_color }; setUser(safe); try { sessionStorage.setItem("fx_user", JSON.stringify(safe)); } catch {} };
  const handleLogout = () => { setUser(null); setParcels([]); setActivePageRaw("parcels"); try { sessionStorage.removeItem("fx_user"); sessionStorage.removeItem("fx_page"); } catch {} };

  // ถ้า user ไม่มีสิทธิ์เข้าหน้าปัจจุบัน → ไปหน้า parcels
  useEffect(() => {
    if (!user) return;
    const p = CAN[user.role] || {};
    if (activePage === "dashboard" && !p.dashboard) setActivePageRaw("parcels");
    if (activePage === "evaluate" && !p.evaluate) setActivePageRaw("parcels");
    if (activePage === "export" && !p.exportData) setActivePageRaw("parcels");
    if (activePage === "exportpno" && !p.exportData) setActivePageRaw("parcels");
    if (activePage === "users" && !p.users) setActivePageRaw("parcels");
  }, [user, activePage]);
  const [selectedShopFilter, setSelectedShopFilter] = useState("");
  const [codFilter, setCodFilter] = useState("");
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifSelected, setNotifSelected] = useState(new Set());
  const [upsellShop, setUpsellShop] = useState("");
  const [upsellData, setUpsellData] = useState([]);
  const [upsellLoading, setUpsellLoading] = useState(true);
  const [upsellFilter, setUpsellFilter] = useState("ALL");
  const [upsellSearch, setUpsellSearch] = useState("");
  const [upsellFile, setUpsellFile] = useState(null);
  const [upsellRows, setUpsellRows] = useState([]);
  const [upsellImporting, setUpsellImporting] = useState(false);
  const [upsellProgress, setUpsellProgress] = useState(0);
  const [upsellSelected, setUpsellSelected] = useState(new Set());
  const [upsellRejected, setUpsellRejected] = useState([]);
  const [rptFilter, setRptFilter] = useState("ALL");
  const [rptSearch, setRptSearch] = useState("");
  const [rptShop, setRptShop] = useState("");
  const [rptPage, setRptPage] = useState(0);
  const [rptPerPage, setRptPerPage] = useState(100);
  // EvaluatePage states
  const [evalFrom, setEvalFrom] = useState("");
  const [evalTo, setEvalTo] = useState("");
  const [evalShop, setEvalShop] = useState("");
  // DashboardPage states
  const [showNotifDetail, setShowNotifDetail] = useState(false);
  // ExportPage states
  const [exportShop, setExportShop] = useState("");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportStaff, setExportStaff] = useState("");
  const [exportProduct, setExportProduct] = useState("");
  const [exporting, setExporting] = useState(false);
  // Export เลขพัสดุ (plain list) states
  const [pnoShop, setPnoShop] = useState("");
  const [pnoFrom, setPnoFrom] = useState("");
  const [pnoTo, setPnoTo] = useState("");
  const [pnoSep, setPnoSep] = useState("newline");
  const [summaryPeriod, setSummaryPeriod] = useState("daily");
  const [summaryFrom, setSummaryFrom] = useState(new Date().toISOString().slice(0, 10));
  const [summaryTo, setSummaryTo] = useState(new Date().toISOString().slice(0, 10));
  const PER_PAGE = 100;
  const isDemo = SUPABASE_URL.includes("YOUR_PROJECT");
  const perm = user ? (CAN[user.role] || {}) : {};

  const demoData = useMemo(() => [
    { id: "d1", parcel_no: "FX-260404-0001", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "สมชาย ใจดี", receiver_phone: "089-111-2222", receiver_address: "456 ม.5", receiver_province: "นครสวรรค์", receiver_district: "เมือง", receiver_subdistrict: "ปากน้ำโพ", receiver_postal: "60000", weight: 1.5, cod_enabled: true, cod_amount: 890, status: "created", flash_pno: "TH44128DA70M5A", flash_sort_code: "NSN-01-A", item_desc: "เสื้อผ้า", label_printed: true, created_by_name: "พนักงานจัดส่ง 1", created_at: "2026-04-04T08:30:00Z", updated_at: "2026-04-04T09:00:00Z" },
    { id: "d2", parcel_no: "FX-260404-0002", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "วิภา แก้วงาม", receiver_phone: "085-333-4444", receiver_address: "78 ซ.รามคำแหง 24", receiver_province: "กรุงเทพมหานคร", receiver_district: "บางกะปิ", receiver_subdistrict: "หัวหมาก", receiver_postal: "10240", weight: 0.5, cod_enabled: false, cod_amount: 0, status: "in_transit", flash_pno: "TH44128DA70K4A", flash_sort_code: "BKK-24-C", item_desc: "เคสมือถือ", label_printed: true, created_by_name: "แอดมิน", created_at: "2026-04-04T09:15:00Z", updated_at: "2026-04-04T10:30:00Z" },
    { id: "d3", parcel_no: "FX-260404-0003", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "นภา สุขสบาย", receiver_phone: "062-555-6666", receiver_address: "9/1 นิมมาน", receiver_province: "เชียงใหม่", receiver_district: "เมือง", receiver_subdistrict: "สุเทพ", receiver_postal: "50200", weight: 2, cod_enabled: true, cod_amount: 1250, status: "delivered", flash_pno: "TH44128DA70J9A", flash_sort_code: "CNX-01-B", item_desc: "รองเท้า", label_printed: true, created_by_name: "พนักงานจัดส่ง 1", created_at: "2026-04-03T14:00:00Z", updated_at: "2026-04-04T11:20:00Z" },
    { id: "d4", parcel_no: "FX-260404-0004", sender_name: "ร้าน ABC", sender_phone: "081-234-5678", receiver_name: "ประเสริฐ มั่งมี", receiver_phone: "091-777-8888", receiver_address: "222 ม.3", receiver_province: "นครราชสีมา", receiver_district: "เมือง", receiver_subdistrict: "ในเมือง", receiver_postal: "30000", weight: 3.5, cod_enabled: true, cod_amount: 2100, status: "draft", flash_pno: "", flash_sort_code: "", item_desc: "เครื่องสำอาง", label_printed: false, created_by_name: "แอดมิน", created_at: "2026-04-04T11:45:00Z", updated_at: "2026-04-04T11:45:00Z" },
  ], []);

  const loadParcels = useCallback(async () => {
    if (isDemo) { setParcels(demoData); setLoading(false); return; }
    setLoading(true);
    try {
      // โหลดเฉพาะเดือนที่เลือก (ลด egress) — กรองด้วย created_at
      const [yy, mm] = month.split("-").map(Number);
      const start = new Date(yy, mm - 1, 1).toISOString();
      const end = new Date(yy, mm, 1).toISOString(); // ต้นเดือนถัดไป
      const monthFilter = `&created_at=gte.${start}&created_at=lt.${end}`;
      let all = [], pg = 0;
      while (pg < 30) {
        const from = pg * 1000;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/fx_parcels?select=*&order=created_at.desc${monthFilter}`, { headers: { ...sb.headers(), Range: `${from}-${from + 999}` } });
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) break;
        all = all.concat(data);
        if (data.length < 1000) break;
        pg++;
      }
      setParcels(all);
      // (เอา auto-fix ที่ดัน created→printed ออก — สถานะจะเป็น printed เฉพาะตอนกดปริ้น/เปลี่ยนเป็นปริ้นแล้วเท่านั้น)
    } catch {} setLoading(false);
  }, [isDemo, demoData, month]);

  // เลื่อนเดือนก่อนหน้า/ถัดไป
  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setPage(0);
  };

  useEffect(() => { if (user) loadParcels(); }, [user, loadParcels]);

  // Load shops
  const loadShops = useCallback(async () => {
    if (isDemo) { setShops([{ id: "s1", name: "ร้าน ABC Shop", phone: "081-234-5678", address: "123 สุขุมวิท", province: "กรุงเทพมหานคร", is_default: true, is_active: true }, { id: "s2", name: "ร้าน XYZ Online", phone: "089-999-8888", address: "456 พหลโยธิน", province: "เชียงใหม่", is_default: false, is_active: true }]); return; }
    try { const d = await sb.select("fx_shops", { order: "created_at.asc" }); setShops(d || []); } catch {}
  }, [isDemo]);
  useEffect(() => { if (user) loadShops(); }, [user, loadShops]);

  // ═══ REFRESH FLASH STATUS — ดึงสถานะจริงจาก Flash API ═══
  const [flashRefreshing, setFlashRefreshing] = useState(false);
  const refreshFlashStatus = async () => {
    const toCheck = parcels.filter(p => p.flash_pno && p.status !== "cancelled" && p.flash_status !== "เซ็นรับแล้ว" && p.flash_status !== "คืนสำเร็จ");
    if (!toCheck.length) { showToast("ไม่มีรายการที่ต้องอัพเดต"); return; }
    setFlashRefreshing(true);
    let updated = 0;
    try {
      // แยกตาม Flash account
      const byAcc = {};
      for (const p of toCheck) { const a = getFlashAccount(p); const k = a.mchId; if (!byAcc[k]) byAcc[k] = { acc: a, parcels: [] }; byAcc[k].parcels.push(p); }
      for (const group of Object.values(byAcc)) {
        for (let i = 0; i < group.parcels.length; i += 20) {
          const batch = group.parcels.slice(i, i + 20);
          try {
            const result = await flashApi.getTracking(batch.map(p => p.flash_pno), group.acc);
            if (result.code === 1 && result.data) {
              for (const item of result.data) {
                const parcel = batch.find(p => p.flash_pno === item.pno);
                if (!parcel) continue;
                const lastRoute = item.routes?.[0];
                const updates = { flash_status: item.stateText || "", flash_detail: lastRoute?.message || "", flash_updated_at: new Date((item.stateChangeAt || 0) * 1000).toISOString() };
                // (ไม่ดัน status เป็น printed อัตโนมัติ — printed เฉพาะตอนกดปริ้นจริง)
                setParcels(prev => prev.map(x => x.id === parcel.id ? { ...x, ...updates, flash_state: item.state } : x));
                if (!isDemo) { try { await sb.update("fx_parcels", parcel.id, updates); } catch {} }
                updated++;
              }
            }
          } catch (e) { console.warn("Tracking batch error:", e.message); }
          if (i + 20 < group.parcels.length) await new Promise(r => setTimeout(r, 500));
        }
      }
      showToast(`อัพเดตสถานะ ${updated} รายการ`);
      if (updated) loadParcels();
    } finally { setFlashRefreshing(false); }
  };

  // ═══ พัสดุค้างรับ "ทุกเดือน" — สำหรับเมนู "แฟลชยังไม่เข้ารับ" (มีเลขแล้วแต่ Flash ยังไม่สแกนรับ = ยังไม่มีรายละเอียดล่าสุด) ═══
  const [notInFlashAll, setNotInFlashAll] = useState([]);
  const loadNotInFlash = useCallback(async () => {
    if (isDemo) return;
    try {
      // ยังไม่เข้ารับ = flash_detail ว่าง (Flash จะใส่รายละเอียดให้เมื่อสแกนรับจริงเท่านั้น)
      const url = `${SUPABASE_URL}/rest/v1/fx_parcels?select=*&flash_pno=not.is.null&flash_pno=neq.&status=neq.cancelled&flash_detail=is.null&order=created_at.desc`;
      const res = await fetch(url, { headers: sb.headers() });
      const data = await res.json();
      if (Array.isArray(data)) setNotInFlashAll(data);
    } catch {}
  }, [isDemo]);
  useEffect(() => { if (user && !isDemo) loadNotInFlash(); }, [user, loadNotInFlash]);

  // ═══ REALTIME — broadcast timestamp polling (เหมือน crmtel) ═══
  const lastTs = useRef("0");
  const mutating = useRef(false);
  useEffect(() => {
    if (!user || isDemo) return;
    const poll = setInterval(async () => {
      if (mutating.current) return;
      try {
        const rows = await sb.select("fx_settings", { filters: "key=eq.last_updated" });
        const ts = rows?.[0]?.value || "0";
        if (ts !== lastTs.current && lastTs.current !== "0") {
          const pg = activePageRef.current;
          loadNotInFlash();
          if (["parcels", "report", "dashboard"].includes(pg)) { loadParcels(); loadShops(); }
        }
        lastTs.current = ts;
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, [user, isDemo, loadParcels, loadShops]);

  // ═══ AUTO-SYNC FLASH STATUS — ทุก 5 นาที + ตอนโหลดหน้า ═══
  const parcelsRef = useRef(parcels);
  parcelsRef.current = parcels;
  // auto-sync สถานะ Flash ย้ายไปทำที่ Cloudflare Worker (cron) แล้ว — ตัดออกจากเบราว์เซอร์เพื่อเลิกงานซ้ำและลด egress
  // (ปุ่มรีเฟรชสถานะเอง refreshFlashStatus ยังใช้ได้ตามปกติ)

  const STATUS_TABS = [
    { key: "ALL", label: "ทั้งหมด", icon: "📋", color: "#475569" },
    { key: "draft", label: "เตรียมส่ง", icon: "📝", color: "#f59e0b" },
    { key: "created", label: "สร้างเลขพัสดุแล้ว", icon: "✅", color: "#059669" },
    { key: "printed", label: "ปริ้นแล้ว", icon: "🖨️", color: "#6366f1" },
    { key: "cancelled", label: "ยกเลิก", icon: "❌", color: "#dc2626" },
  ];

  const filtered = useMemo(() => {
    let list = parcels;
    if (selectedShopFilter) list = list.filter(p => p.shop_id === selectedShopFilter);
    if (statusFilter !== "ALL") list = list.filter(p => p.status === statusFilter);
    if (codFilter === "cod") list = list.filter(p => Number(p.cod_amount) > 0);
    else if (codFilter === "nocod") list = list.filter(p => !Number(p.cod_amount));
    else if (codFilter) list = list.filter(p => Number(p.cod_amount) === Number(codFilter));
    if (search) { const q = search.toLowerCase(); list = list.filter(p => [p.parcel_no, p.receiver_name, p.receiver_phone, p.flash_pno, p.flash_sort_code, p.receiver_province, p.receiver_address, p.remark, p.created_by_name].some(v => (v || "").toLowerCase().includes(q))); }
    return list;
  }, [parcels, search, selectedShopFilter, statusFilter, codFilter]);

  const paged = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const statsData = useMemo(() => { const list = selectedShopFilter ? parcels.filter(p => p.shop_id === selectedShopFilter) : parcels; return list; }, [parcels, selectedShopFilter]);
  const stats = useMemo(() => ({ total: statsData.length, draft: statsData.filter(p => p.status === "draft").length, created: statsData.filter(p => p.status === "created").length, printed: statsData.filter(p => p.status === "printed").length, cancelled: statsData.filter(p => p.status === "cancelled").length, codTotal: statsData.filter(p => p.cod_enabled).reduce((s, p) => s + Number(p.cod_amount || 0), 0) }), [statsData]);

  // แจ้งเตือน: พัสดุที่มีเลข Tracking แต่ Flash ยังไม่รับเข้าระบบ
  const notInFlash = useMemo(() => parcels.filter(p => p.flash_pno && p.status !== "cancelled" && p.flash_detail == null), [parcels]);

  const handleDelete = async (p) => { if (!await uiConfirm(`ลบ "${p.receiver_name}"?`)) return; if (isDemo) { setParcels(prev => prev.filter(x => x.id !== p.id)); return; } mutating.current = true; try { await sb.delete("fx_parcels", p.id); setParcels(prev => prev.filter(x => x.id !== p.id)); showToast("ลบสำเร็จ"); logActivity("ลบพัสดุ", `${p.parcel_no || ""} · ${p.receiver_name}`); await sb.broadcastChange(); } catch (e) { uiAlert(e.message); } setTimeout(() => { mutating.current = false; }, 1000); };
  const markPrinted = async (p) => {
    mutating.current = true;
    try {
      await sb.update("fx_parcels", p.id, { label_printed: true, status: "printed" });
      await sb.broadcastChange();
      await loadParcels();
      showToast("✅ เปลี่ยนเป็นปริ้นแล้ว");
    } catch (e) { uiAlert("❌ " + e.message); }
    setTimeout(() => { mutating.current = false; }, 2000);
  };

  const markCreated = async (p) => {
    mutating.current = true;
    try {
      await sb.update("fx_parcels", p.id, { label_printed: false, status: "created" });
      await sb.broadcastChange();
      await loadParcels();
      showToast("เปลี่ยนกลับเป็นสร้างเลขแล้ว");
    } catch (e) { uiAlert("❌ " + e.message); }
    setTimeout(() => { mutating.current = false; }, 2000);
  };

  // สร้างเลข Tracking Flash Express
  const [flashLoading, setFlashLoading] = useState(null);
  const [globalLoading, setGlobalLoading] = useState(null); // { msg, progress }
  const [toast, setToast] = useState(null); // { msg, type }
  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // ═══ ตรวจเวอร์ชันใหม่ แล้วรีโหลดอัตโนมัติ (กันแท็บเก่าค้างรันโค้ดเก่า เขียน DB ผิด) ═══
  useEffect(() => {
    const liveKey = [...document.querySelectorAll('script[type="module"][src]')].map(s => s.getAttribute("src")).filter(Boolean).sort().join("|");
    if (!liveKey) return; // dev mode / ไม่มี bundle
    let reloading = false;
    const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
    const check = async () => {
      if (reloading) return;
      try {
        const res = await fetch(`${base}index.html?cb=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const fetchedKey = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(m => m[1]).sort().join("|");
        if (fetchedKey && fetchedKey !== liveKey) {
          reloading = true;
          try { showToast("🔄 มีเวอร์ชันใหม่ กำลังอัปเดต..."); } catch {}
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch {}
    };
    const iv = setInterval(check, 60000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);
  const [uiDlg, setUiDlg] = useState(null);
  useEffect(() => { _uiDialog = setUiDlg; return () => { _uiDialog = null; }; }, []);
  const logActivity = async (action, detail) => { try { if (!isDemo) await sb.insert("fx_activity_log", { actor_id: user?.id || null, actor_name: user?.display_name || "", action, detail }); } catch {} };
  // Get Flash account for a parcel (from its shop)
  const getFlashAccount = (p) => {
    const shop = shops?.find(s => s.id === p.shop_id);
    const mchId = shop?.flash_mch_id || FLASH_ACCOUNTS[0]?.mchId;
    return flashApi.getAccount(mchId);
  };

  const createFlashOrder = async (p) => {
    if (p.flash_pno) { uiAlert("พัสดุนี้มีเลข Tracking แล้ว: " + p.flash_pno); return; }
    if (!p.receiver_name || !p.receiver_phone) { uiAlert(`❌ ${p.receiver_name}\nกรุณากรอกชื่อและเบอร์ผู้รับก่อน`); return; }
    if (!p.receiver_province && !p.receiver_postal) { uiAlert(`❌ ${p.receiver_name}\nกรุณากรอกจังหวัดหรือรหัสไปรษณีย์ผู้รับ`); return; }
    const acc = getFlashAccount(p);
    if (!await uiConfirm(`สร้างเลข Tracking Flash Express?\n\nบัญชี: ${acc.mchId}\nผู้รับ: ${p.receiver_name}\nเบอร์: ${p.receiver_phone}`)) return;
    setFlashLoading(p.id);
    mutating.current = true;
    try {
      const result = await flashApi.createOrder(p, acc);
      console.log("Flash API response:", JSON.stringify(result));
      if (result.code === 1 && result.data) {
        const updates = {
          flash_pno: result.data.pno || "",
          flash_sort_code: result.data.sortCode || result.data.dstStoreName || "",
          flash_api_response: result.data,
          status: "created",
        };
        if (!isDemo) await sb.update("fx_parcels", p.id, updates);
        setParcels(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
        showToast(`สร้างเลข Tracking สำเร็จ! ${updates.flash_pno}`);
        sb.broadcastChange();
      } else {
        uiAlert(`❌ Flash API Error (code: ${result.code}):\n${result.message || ""}\n${result.data ? "\nรายละเอียด: " + JSON.stringify(result.data) : ""}\n\n📤 ผู้ส่ง: ${p.sender_name || "❌"} | ${p.sender_phone || "❌"}\nที่อยู่ส่ง: ${p.sender_address || "❌"} | ${p.sender_province || "❌"} | ปณ.${p.sender_postal || "❌"}\n\n📥 ผู้รับ: ${p.receiver_name} | ${p.receiver_phone}\nจังหวัด: ${p.receiver_province || "❌"} | อำเภอ: ${p.receiver_district || "❌"}\nตำบล: ${p.receiver_subdistrict || "❌"} | ปณ.${p.receiver_postal || "❌"}\nที่อยู่: ${p.receiver_address || "❌"}`);
      }
    } catch (e) { uiAlert("เชื่อมต่อ Flash API ไม่ได้:\n" + e.message); }
    setFlashLoading(null);
    setTimeout(() => { mutating.current = false; }, 1000);
  };

  const cancelFlashOrder = async (p) => {
    if (!p.flash_pno) { uiAlert("พัสดุนี้ยังไม่มีเลข Tracking"); return; }
    if (!await uiConfirm(`ยกเลิกเลขพัสดุ?\n\n${p.flash_pno}\nผู้รับ: ${p.receiver_name}\n\n⚠️ จะยกเลิกจากระบบ Flash Express ด้วย`)) return;
    mutating.current = true;
    setFlashLoading(p.id);
    try {
      const acc = getFlashAccount(p);
      const result = await flashApi.cancelOrder(p.flash_pno, acc);
      console.log("Flash cancel response:", JSON.stringify(result));
      if (result.code === 1 || result.code === 1032) {
        const updates = { status: "cancelled" };
        if (!isDemo) await sb.update("fx_parcels", p.id, updates);
        setParcels(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
        showToast(`ยกเลิกเลขพัสดุ ${p.flash_pno} สำเร็จ`);
        logActivity("ยกเลิกพัสดุ", `${p.flash_pno} · ${p.receiver_name}`);
        sb.broadcastChange();
      } else {
        uiAlert(`❌ ยกเลิกไม่สำเร็จ\n\nCode: ${result.code}\nMessage: ${result.message || "ไม่มีข้อความ"}\n\nรายละเอียด: ${JSON.stringify(result.data || result, null, 2)}\n\n⚠️ พัสดุอาจถูกรับแล้ว หรือยกเลิกไม่ได้`);
        // ถามว่าต้องการยกเลิกในระบบอย่างเดียวไหม
        if (await uiConfirm("ต้องการยกเลิกเฉพาะในระบบหลังบ้านไหม?\n(ไม่ยกเลิกฝั่ง Flash Express)")) {
          const updates = { status: "cancelled" };
          if (!isDemo) await sb.update("fx_parcels", p.id, updates);
          setParcels(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
          showToast(`ยกเลิกในระบบแล้ว (ไม่ได้ยกเลิกฝั่ง Flash)`);
          sb.broadcastChange();
        }
      }
    } catch (e) { uiAlert("เชื่อมต่อ Flash API ไม่ได้:\n" + e.message); }
    setFlashLoading(null);
  };

  // Batch สร้างเลข Tracking
  const [batchProgress, setBatchProgress] = useState(null);
  const [cancelProgress, setCancelProgress] = useState(null);
  const batchCreateFlash = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id) && !p.flash_pno && p.receiver_name && p.receiver_phone);
    if (!targets.length) { uiAlert("ไม่มีรายการที่เลือก (ต้องยังไม่มีเลข Tracking + มีข้อมูลผู้รับ)"); return; }
    if (!await uiConfirm(`สร้างเลข Tracking Flash Express ${targets.length} รายการ?`)) return;
    setBatchProgress({ total: targets.length, done: 0, success: 0, errors: [] });
    let success = 0; const errors = [];
    for (let i = 0; i < targets.length; i++) {
      const pct = Math.round(((i + 1) / targets.length) * 100);
      setGlobalLoading({ msg: `กำลังสร้างเลข Tracking ${i + 1}/${targets.length}`, progress: pct });
      const p = targets[i];
      try {
        const result = await flashApi.createOrder(p, getFlashAccount(p));
        console.log(`Flash batch [${i+1}/${targets.length}] ${p.receiver_name}:`, JSON.stringify(result));
        if (result.code === 1 && result.data) {
          const updates = { flash_pno: result.data.pno || "", flash_sort_code: result.data.sortCode || result.data.dstStoreName || "", flash_api_response: result.data, status: "created" };
          if (!isDemo) await sb.update("fx_parcels", p.id, updates);
          setParcels(prev => prev.map(x => x.id === p.id ? { ...x, ...updates } : x));
          success++;
        } else { console.error("Flash API error:", JSON.stringify(result)); errors.push(`${p.receiver_name}: [code ${result.code}] ${result.message || "error"}`); }
      } catch (e) { console.error("Flash API exception:", e); errors.push(`${p.receiver_name}: ${e.message}`); }
      if (i % 3 === 2) await new Promise(r => setTimeout(r, 500));
    }
    setGlobalLoading(null);
    setBatchProgress(null);
    sb.broadcastChange();
    if (errors.length) {
      uiAlert(`❌ สร้างเลข Tracking สำเร็จ ${success}/${targets.length} รายการ\n\nรายการที่ไม่สำเร็จ:\n${errors.slice(0, 20).join("\n")}${errors.length > 20 ? "\n... อีก " + (errors.length - 20) + " รายการ" : ""}`);
    }
    if (success > 0) {
      showToast(`สร้างเลข Tracking สำเร็จ ${success} รายการ`);
      logActivity("สร้างเลขหลายใบ", `${success} ใบ`);
      // (ไม่เปิดหน้าต่างปริ้นอัตโนมัติแล้ว — สถานะจะอยู่ "สร้างเลขแล้ว" จนกว่าจะกดปริ้น/เปลี่ยนเป็นปริ้นแล้วเอง)
    }
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => { const ids = paged.map(p => p.id); const allSel = ids.every(id => selectedIds.has(id)); setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => allSel ? n.delete(id) : n.add(id)); return n; }); };
  const batchAssignSale = async () => {
    const name = assignName.trim();
    const ids = [...selectedIds];
    if (!ids.length) return;
    for (const id of ids) {
      setParcels(prev => prev.map(x => x.id === id ? { ...x, sale_person: name } : x));
      try { if (!isDemo) await sb.update("fx_parcels", id, { sale_person: name }); } catch {}
    }
    logActivity("โยกพนักงานขาย", `${ids.length} ใบ → ${name || "(ไม่ระบุ)"}`);
    setAssignModal(false); setAssignName(""); setSelectedIds(new Set());
    showToast(`โยก ${ids.length} ใบ ให้ ${name || "(ไม่ระบุ)"} แล้ว`);
  };

  const selectedCounts = useMemo(() => {
    const sel = parcels.filter(p => selectedIds.has(p.id));
    return { total: sel.length, noTracking: sel.filter(p => !p.flash_pno).length, hasTracking: sel.filter(p => p.flash_pno).length, canMarkPrinted: sel.filter(p => p.flash_pno && p.status === "created").length, canCancel: sel.filter(p => p.flash_pno && p.status !== "cancelled").length };
  }, [parcels, selectedIds]);

  // ═══ SHARED PRINT PAGE — CRM2 style (SVG barcode + QR local + jsPDF) ═══
  const openPrintPage = (targets) => {
    const maskPhone = (ph) => (ph || "").replace(/^(\d{3})\d{4}(\d{3})$/, "$1****$2");
    const now = new Date().toLocaleString("en-GB", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const total = targets.length;
    const lblData = targets.map((p, i) => {
      let fr = p.flash_api_response || {};
      if (typeof fr === "string") { try { fr = JSON.parse(fr); } catch { fr = {}; } }
      return {
        i,
        sc: p.flash_sort_code || fr.sortCode || "",
        zone: fr.sortingLineCode || fr.lineCode || "",
        dst2: fr.dstStoreName || "",
        pno: p.flash_pno || "",
        dist: p.receiver_district || "",
        prov: p.receiver_province || "",
        sname: p.sender_name || "",
        sphone: p.sender_phone || "",
        saddr: (() => {
          let a = `${p.sender_address || ""}`.replace(/\s+/g, " ").trim();
          [p.sender_subdistrict, p.sender_district, p.sender_province, p.sender_postal].filter(Boolean).forEach(e => { if (a && !a.includes(e)) a += " " + e; else if (!a) a = e; });
          return a.replace(/(\S+\s+\d{5})\s+\1\s*$/, "$1").trim();
        })(),
        rname: p.receiver_name || "",
        rphone: maskPhone(p.receiver_phone),
        raddr1: p.receiver_address || "",
        raddr2: `${p.receiver_subdistrict || ""}${p.receiver_subdistrict ? ", " : ""}${p.receiver_district || ""}`,
        raddr3: `${p.receiver_province || ""} ${p.receiver_postal || ""}`.trim(),
        cod: (p.cod_enabled && Number(p.cod_amount) > 0) ? Number(p.cod_amount) : 0,
        item: p.remark || "",
      };
    });

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ใบปะหน้า Flash Express (${total} ใบ)</title>`;
    html += `<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800;900&family=Noto+Sans+Thai:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>`;
    html += `<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>`;
    html += `<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>`;
    html += `<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"><\/script>`;
    html += `<style>@page{size:100mm 75mm;margin:0}*{box-sizing:border-box}body{margin:0;padding:0;font-family:'Sarabun','Noto Sans Thai',Tahoma,Arial,sans-serif;background:#eee}`;
    html += `@media print{.no-print{display:none!important}.label.hide-print{display:none!important}body{background:#fff}}`;
    html += `.toolbar{background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:14px;position:sticky;top:0;z-index:100}`;
    html += `.toolbar-top{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}`;
    html += `.toolbar-top button{padding:8px 20px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer}`;
    html += `.btn-print{background:#dc2626;color:#fff}.btn-dl{background:#059669;color:#fff}`;
    html += `.page-select{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;align-items:center}`;
    html += `.page-select label{display:flex;align-items:center;gap:3px;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;background:rgba(255,255,255,.1)}`;
    html += `.page-select input:checked+span{color:#10b981;font-weight:800}`;
    html += `.label{width:100mm;height:75mm;border:1.5px solid #000;position:relative;overflow:hidden;page-break-after:always;margin:0 auto 3mm}`;
    html += `.label:last-child{margin-bottom:0}`;
    html += `.label-num{position:absolute;top:2px;left:4px;background:#d97706;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:0 0 4px 0;z-index:2}`;
    html += `.sort-code{text-align:center;padding:2px 8px;font-size:18px;font-weight:900;letter-spacing:1px;border-bottom:1px solid #000}`;
    html += `.bc-wrap{text-align:center;padding:2px 15px 0;border-bottom:1.5px solid #000}`;
    html += `.bc-wrap svg{width:92%;height:45px}`;
    html += `.pno-row{font-size:12px;font-weight:900;text-align:center;letter-spacing:1.5px;padding:2px 0;border-bottom:1.5px solid #000;background:#f8f8f8}`;
    html += `.dst-bar{background:#333;color:#fff;padding:2px 8px;font-size:8px;font-weight:700;letter-spacing:1px}`;
    html += `.body-area{padding:4px 8px 2px;border-bottom:1px solid #000;min-height:98px;position:relative}`;
    html += `.src-line{font-size:7.5px;color:#555;line-height:1.4;margin-bottom:2px}`;
    html += `.dst-name{font-size:10px;font-weight:800;margin-top:2px}`;
    html += `.dst-phone{font-size:12px;font-weight:900;letter-spacing:0.5px}`;
    html += `.dst-addr{font-size:8.5px;font-weight:700;line-height:1.3}`;
    html += `.qr-box{position:absolute;right:4px;top:28px;text-align:center}`;
    html += `.qr-box canvas{width:62px;height:62px}`;
    html += `.cod-row{border-bottom:1px solid #000;display:flex;align-items:stretch;min-height:22px}`;
    html += `.cod-tag{background:#000;color:#fff;font-size:11px;font-weight:900;padding:3px 8px;display:flex;align-items:center}`;
    html += `.cod-val{flex:1;font-size:15px;font-weight:900;padding:2px 8px;display:flex;align-items:center}`;
    html += `.note-row{padding:2px 8px;font-size:10px;color:#000;border-bottom:1px solid #eee;font-weight:700}`;
    html += `.foot{font-size:6.5px;color:#999;padding:1px 8px;display:flex;justify-content:space-between}`;
    html += `</style></head><body>`;

    // Toolbar
    html += `<div class="no-print toolbar"><div class="toolbar-top">`;
    html += `<button class="btn-print" onclick="printSelected()">🖨️ ปริ้นที่เลือก</button>`;
    html += `<button class="btn-dl" onclick="downloadOurLabels()">📥 ดาวน์โหลด PDF (ใบของเรา)</button>`;
    html += `<span style="font-size:12px">ทั้งหมด ${total} ใบ</span>`;
    html += `</div>`;
    html += `<div class="no-print" style="text-align:center;font-size:11px;color:#fbbf24;margin-bottom:8px;line-height:1.4">📥 <b>"ดาวน์โหลด PDF (ใบของเรา)"</b> = ดาวน์โหลดไฟล์ใบปะหน้าดีไซน์ของระบบ รวมไฟล์เดียว เร็วทันที &nbsp;·&nbsp; 🖨️ <b>"ปริ้นที่เลือก"</b> = ปริ้นจากเบราว์เซอร์</div>`;
    html += `<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">`;
    html += `<button onclick="toggleAll(true)" style="padding:4px 12px;border:1px solid rgba(255,255,255,.3);border-radius:6px;background:transparent;color:#10b981;font-size:11px;font-weight:700;cursor:pointer">☑ เลือกทั้งหมด</button>`;
    html += `<button onclick="toggleAll(false)" style="padding:4px 12px;border:1px solid rgba(255,255,255,.3);border-radius:6px;background:transparent;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer">☐ ยกเลิกทั้งหมด</button>`;
    html += `</div>`;
    html += `<div class="page-select" id="pageSelect">`;
    for (let i = 0; i < total; i++) {
      html += `<label><input type="checkbox" checked data-idx="${i}" onchange="updateLabel(${i},this.checked)"/><span>${i + 1}</span></label>`;
    }
    html += `</div></div>`;

    // Labels
    targets.forEach((p, idx) => {
      const sc = p.flash_sort_code || "";
      const pno = p.flash_pno || "";
      const codVal = Number(p.cod_amount || 0);
      html += `<div class="label" id="lbl${idx}">`;
      html += `<div class="label-num no-print">${idx + 1}</div>`;
      html += `<div class="sort-code">${sc || "FLASH EXPRESS"}</div>`;
      html += `<div class="bc-wrap"><svg id="bc${idx}"></svg></div>`;
      html += `<div class="pno-row">${pno}</div>`;
      html += `<div class="dst-bar">DST &nbsp; ${p.receiver_district || ""} — ${p.receiver_province || ""}</div>`;
      html += `<div class="body-area">`;
      html += `<div class="src-line">ผู้ส่ง ${p.sender_name} ${p.sender_phone} ${p.sender_address || ""}</div>`;
      html += `<div class="dst-name">ผู้รับ ${p.receiver_name}</div>`;
      html += `<div class="dst-phone">${maskPhone(p.receiver_phone)}</div>`;
      html += `<div class="dst-addr">${p.receiver_address || ""}<br>${p.receiver_subdistrict || ""}${p.receiver_subdistrict ? ", " : ""}${p.receiver_district || ""}<br>${p.receiver_province || ""} ${p.receiver_postal || ""}</div>`;
      html += `<div class="qr-box"><canvas id="qr${idx}" width="170" height="170"></canvas></div>`;
      html += `</div>`;
      html += `<div class="cod-row">`;
      if (p.cod_enabled && codVal > 0) {
        html += `<div class="cod-tag">COD</div><div class="cod-val">เก็บเงินค่าสินค้า COD ${codVal.toLocaleString()}</div>`;
      } else {
        html += `<div class="cod-val" style="font-size:10px;color:#666">—</div>`;
      }
      html += `</div>`;
      html += `<div class="dst-item" style="font-size:15px;color:#000;font-weight:800;padding:2px 8px;line-height:1.2">📦 สินค้า: ${p.remark || "-"}</div>`;
      html += `<div class="foot"><span>Print-: ${now}</span><span>${idx + 1}/${total}</span><span>THE MT</span></div>`;
      html += `</div>`;
    });

    // Scripts
    html += `<script>`;
    html += `var LBLS=${JSON.stringify(lblData)};var PNOW=${JSON.stringify(now)};`;
    html += `function renderAll(){if(typeof JsBarcode==="undefined"||typeof qrcode==="undefined"){setTimeout(renderAll,200);return;}`;
    targets.forEach((p, i) => {
      const pno = (p.flash_pno || "").replace(/"/g, "");
      html += `try{JsBarcode("#bc${i}","${pno}",{format:"CODE128",width:2.2,height:45,displayValue:false,margin:0});}catch(e){}`;
      html += `try{var q=qrcode(0,"M");q.addData("${pno}");q.make();var c=document.getElementById("qr${i}");if(c){var ctx=c.getContext("2d");var sz=q.getModuleCount();var cs=Math.floor(170/sz);for(var r=0;r<sz;r++)for(var cl=0;cl<sz;cl++)if(q.isDark(r,cl)){ctx.fillStyle="#000";ctx.fillRect(cl*cs,r*cs,cs,cs);}}}catch(e){}`;
    });
    html += `}`;
    html += `function updateLabel(idx,checked){var el=document.getElementById("lbl"+idx);if(el){if(checked){el.classList.remove("hide-print");el.style.opacity="1";}else{el.classList.add("hide-print");el.style.opacity="0.3";}}}`;
    html += `function toggleAll(val){document.querySelectorAll("#pageSelect input").forEach(function(cb){cb.checked=val;updateLabel(parseInt(cb.dataset.idx),val);})}`;
    html += `function printSelected(){window.print();}`;
    html += `function cut(ctx,t,max){t=t||"";if(ctx.measureText(t).width<=max)return t;while(t.length&&ctx.measureText(t+"…").width>max)t=t.slice(0,-1);return t+"…";}`;
    html += `function drawLbl(ctx,d,idx,total,W,H,now){ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);ctx.strokeStyle="#000";ctx.lineWidth=4;ctx.strokeRect(2,2,W-4,H-4);ctx.lineWidth=2;ctx.fillStyle="#000";ctx.textBaseline="alphabetic";`;
    html += `ctx.textAlign="left";ctx.font="italic 900 40px Arial";ctx.fillText("FLASH",18,56);ctx.font="900 14px Arial";ctx.fillText("EXPRESS",150,56);`;
    html += `var sc=String(d.sc||"").split("-");var pre=sc[0]||"",mid=sc[1]||"",suf=sc.slice(2).join("-");var sx=320,sy=60;ctx.textAlign="left";ctx.fillStyle="#000";ctx.font="900 38px Arial";ctx.fillText(pre,sx,sy);sx+=ctx.measureText(pre).width+10;ctx.fillText("-",sx,sy);sx+=ctx.measureText("-").width+12;ctx.font="900 64px Arial";ctx.fillText(mid,sx,sy+2);sx+=ctx.measureText(mid).width+12;ctx.font="900 38px Arial";ctx.fillText("-",sx,sy);sx+=ctx.measureText("-").width+10;ctx.fillText(suf,sx,sy);`;
    html += `ctx.beginPath();ctx.moveTo(0,88);ctx.lineTo(W,88);ctx.stroke();`;
    html += `try{var bcv=document.createElement("canvas");JsBarcode(bcv,d.pno||" ",{format:"CODE128",width:2,height:80,displayValue:false,margin:0});ctx.drawImage(bcv,60,96,W-120,98);}catch(e){}ctx.beginPath();ctx.moveTo(0,200);ctx.lineTo(W,200);ctx.stroke();`;
    html += `ctx.fillStyle="#f6f6f6";ctx.fillRect(2,200,W-4,46);ctx.fillStyle="#000";ctx.textAlign="center";ctx.font="900 30px 'Sarabun',Tahoma,sans-serif";ctx.fillText(d.pno||"",W/2,234);ctx.beginPath();ctx.moveTo(0,246);ctx.lineTo(W,246);ctx.stroke();`;
    html += `ctx.fillStyle="#222";ctx.fillRect(2,246,W-4,44);ctx.fillStyle="#fff";ctx.textAlign="left";ctx.font="700 24px 'Sarabun',Tahoma,sans-serif";ctx.fillText("DST   "+(d.dst2||((d.dist||"")+" — "+(d.prov||""))),20,277);`;
    html += `if(d.zone){ctx.fillStyle="#000";ctx.fillRect(712,300,272,200);var zl=String(d.zone).length;ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="900 "+(zl<=3?96:zl<=5?64:44)+"px Arial";ctx.fillText(String(d.zone),848,432);}`;
    html += `ctx.fillStyle="#333";ctx.textAlign="left";ctx.font="16px 'Sarabun',Tahoma,sans-serif";ctx.fillText(cut(ctx,"ผู้ส่ง "+(d.sname||"")+" ("+(d.sphone||"")+")",660),20,322);ctx.fillStyle="#666";ctx.font="15px 'Sarabun',Tahoma,sans-serif";ctx.fillText(cut(ctx,d.saddr,660),20,346);`;
    html += `ctx.fillStyle="#000";ctx.font="800 25px 'Sarabun',Tahoma,sans-serif";ctx.fillText(cut(ctx,"ผู้รับ "+(d.rname||""),660),20,392);ctx.font="900 32px 'Sarabun',Tahoma,sans-serif";ctx.fillText(d.rphone||"",20,430);ctx.font="700 22px 'Sarabun',Tahoma,sans-serif";ctx.fillText(cut(ctx,d.raddr1,660),20,464);ctx.fillText(cut(ctx,d.raddr2,660),20,492);ctx.fillText(cut(ctx,d.raddr3,660),20,520);`;
    html += `if(d.cod>0){ctx.fillStyle="#000";ctx.fillRect(20,585,108,46);ctx.fillStyle="#fff";ctx.textAlign="left";ctx.font="900 24px 'Sarabun',Tahoma,sans-serif";ctx.fillText("COD",36,617);ctx.fillStyle="#000";ctx.font="900 26px 'Sarabun',Tahoma,sans-serif";ctx.fillText("เก็บเงิน COD "+Number(d.cod).toLocaleString(),142,617);}`;
    html += `if(d.item){ctx.fillStyle="#000";ctx.textAlign="left";ctx.font="800 30px 'Sarabun',Tahoma,sans-serif";ctx.fillText(cut(ctx,"สินค้า: "+d.item,660),20,675);}`;
    html += `try{var q=qrcode(0,"M");q.addData(d.pno||" ");q.make();var n=q.getModuleCount();var qs=172,qx=W-198,qy=508,cell=qs/n;ctx.fillStyle="#000";for(var r=0;r<n;r++)for(var c=0;c<n;c++)if(q.isDark(r,c))ctx.fillRect(qx+c*cell,qy+r*cell,Math.ceil(cell),Math.ceil(cell));}catch(e){}`;
    html += `ctx.beginPath();ctx.moveTo(0,705);ctx.lineTo(W,705);ctx.stroke();ctx.fillStyle="#777";ctx.font="14px 'Sarabun',Tahoma,sans-serif";ctx.textAlign="left";ctx.fillText(now+"  พิมพ์ครั้งที่: 1",16,730);ctx.textAlign="center";ctx.fillText((idx+1)+"/"+total,W/2,730);ctx.textAlign="right";ctx.fillText("THE MT",W-16,730);ctx.textAlign="left";}`;
    html += `async function downloadOurLabels(){var btn=document.querySelector(".btn-dl");var sel=LBLS.filter(function(x){var el=document.getElementById("lbl"+x.i);return el&&!el.classList.contains("hide-print");});if(!sel.length){alert("ไม่มีใบที่เลือก");return;}if(typeof jspdf==="undefined"||typeof JsBarcode==="undefined"||typeof qrcode==="undefined"){alert("กำลังโหลดไลบรารี ลองใหม่อีกครั้ง");return;}btn.disabled=true;var origin=btn.innerHTML;try{if(document.fonts&&document.fonts.ready){await document.fonts.ready;}}catch(e){}try{var W=1000,H=750;var pdf=new jspdf.jsPDF({orientation:"landscape",unit:"mm",format:[100,75]});var cv=document.createElement("canvas");cv.width=W;cv.height=H;var ctx=cv.getContext("2d");for(var idx=0;idx<sel.length;idx++){if(idx>0)pdf.addPage([100,75],"landscape");drawLbl(ctx,sel[idx],idx,sel.length,W,H,PNOW);var img=cv.toDataURL("image/jpeg",0.9);pdf.addImage(img,"JPEG",0,0,100,75);btn.innerHTML="⏳ "+(idx+1)+"/"+sel.length;if(idx%10===9)await new Promise(function(r){setTimeout(r,0);});}pdf.save("flash-labels-"+sel.length+".pdf");btn.innerHTML="✅ ดาวน์โหลดแล้ว "+sel.length+" ใบ";setTimeout(function(){btn.innerHTML=origin;btn.disabled=false;},3000);}catch(e){alert("ผิดพลาด: "+e.message);btn.disabled=false;btn.innerHTML=origin;}}`;
    html += `renderAll();`;
    html += `<\/script></body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
  };

  const batchMarkPrinted = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id) && p.flash_pno && p.status === "created");
    if (!targets.length) { uiAlert("ไม่มีรายการที่เปลี่ยนได้\n(ต้องมีเลข Tracking + สถานะ \"สร้างเลขแล้ว\")"); return; }
    if (!await uiConfirm(`เปลี่ยนสถานะเป็น "ปริ้นแล้ว" ${targets.length} รายการ?`)) return;
    mutating.current = true;
    try {
      const ids = targets.map(t => t.id).join(",");
      await sb.query("fx_parcels", { method: "PATCH", body: { label_printed: true, status: "printed" }, filters: `id=in.(${ids})` });
      await sb.broadcastChange();
      await loadParcels();
      showToast(`✅ เปลี่ยนสถานะสำเร็จ ${targets.length} รายการ`);
      setSelectedIds(new Set());
    } catch (e) {
      uiAlert("❌ เปลี่ยนสถานะไม่ได้: " + e.message);
      await loadParcels();
    }
    setTimeout(() => { mutating.current = false; }, 2000);
  };

  const batchPrint = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id) && p.flash_pno);
    if (!targets.length) { uiAlert("ไม่มีรายการที่มีเลข Tracking ให้ปริ้น"); return; }
    setPrintPreview(targets.map(p => ({ ...p })));
  };

  const batchCancelFlash = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id) && p.flash_pno && p.status !== "cancelled");
    if (!targets.length) { uiAlert("ไม่มีรายการที่ยกเลิกได้\n(ต้องมีเลข Tracking และยังไม่ถูกยกเลิก)"); return; }
    if (!await uiConfirm(`ยกเลิก ${targets.length} เลขพัสดุ?\n\n⚠️ จะยกเลิกจากระบบ Flash Express ด้วย\n(ยกเลิกได้เฉพาะพัสดุที่ยังไม่ถูกรับเข้าระบบ)`)) return;
    mutating.current = true;
    let ok = 0; const failList = []; let done = 0;
    setCancelProgress({ done: 0, total: targets.length });
    const CONC = 5;
    for (let i = 0; i < targets.length; i += CONC) {
      const slice = targets.slice(i, i + CONC);
      await Promise.all(slice.map(async (p) => {
        try {
          const result = await flashApi.cancelOrder(p.flash_pno, getFlashAccount(p));
          if (result.code === 1 || result.code === 1032) {
            if (!isDemo) await sb.update("fx_parcels", p.id, { status: "cancelled" });
            setParcels(prev => prev.map(x => x.id === p.id ? { ...x, status: "cancelled" } : x));
            ok++;
          } else { failList.push(p.flash_pno); }
        } catch { failList.push(p.flash_pno); }
        done++; setCancelProgress({ done, total: targets.length });
      }));
    }
    setCancelProgress(null);
    setSelectedIds(new Set());
    try { await sb.broadcastChange(); } catch {}
    setTimeout(() => { mutating.current = false; }, 1500);
    if (failList.length && await uiConfirm(`ยกเลิกฝั่ง Flash สำเร็จ ${ok} ใบ\nไม่สำเร็จ ${failList.length} ใบ (อาจถูกรับเข้าระบบแล้ว)\n\nต้องการทำเครื่องหมาย "ยกเลิก" ให้ ${failList.length} ใบที่เหลือเฉพาะในระบบหลังบ้านไหม?`)) {
      const fails = parcels.filter(p => failList.includes(p.flash_pno));
      for (const p of fails) { try { if (!isDemo) await sb.update("fx_parcels", p.id, { status: "cancelled" }); setParcels(prev => prev.map(x => x.id === p.id ? { ...x, status: "cancelled" } : x)); } catch {} }
      try { await sb.broadcastChange(); } catch {}
      showToast(`ยกเลิกในระบบแล้ว ${fails.length} ใบ`);
    } else {
      showToast(`ยกเลิกสำเร็จ ${ok} ใบ` + (failList.length ? ` (พลาด ${failList.length})` : ""));
      logActivity("ยกเลิกหลายใบ", `${ok} ใบ`);
    }
  };

  const batchDelete = async () => {
    const targets = parcels.filter(p => selectedIds.has(p.id));
    if (!targets.length) return;
    if (!await uiConfirm(`ลบ ${targets.length} รายการ?`)) return;
    let success = 0;
    for (let i = 0; i < targets.length; i++) {
      setGlobalLoading({ msg: `กำลังลบ ${i + 1}/${targets.length}`, progress: Math.round(((i + 1) / targets.length) * 100) });
      const p = targets[i];
      try { if (!isDemo) await sb.delete("fx_parcels", p.id); success++; } catch {}
    }
    setParcels(prev => prev.filter(x => !selectedIds.has(x.id)));
    setGlobalLoading(null);
    showToast(`ลบสำเร็จ ${success}/${targets.length} รายการ`);
    logActivity("ลบหลายใบ", `${success} ใบ`);
    sb.broadcastChange();
    setSelectedIds(new Set());
  };

  // ═══ UPSELL DATA — โหลดข้อมูล upsell ═══
  const loadUpsell = useCallback(async () => { setUpsellLoading(true); try { const d = await sb.select("fx_upsell", { order: "created_at.desc" }); setUpsellData(d || []); } catch {} setUpsellLoading(false); }, [isDemo]);
  useEffect(() => { if (user && !isDemo) loadUpsell(); }, [user]);

  // Tracking page states
  const [trkSearch, setTrkSearch] = useState("");
  const [trkResults, setTrkResults] = useState([]);
  const [trkLoading, setTrkLoading] = useState(false);

  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("track")) return <PublicTracking />;
  if (!user) return <LoginScreen onLogin={handleLogin} isDemo={isDemo} />;

  // ═══ TRACKING ROLE — หน้าค้นหาเลขพัสดุอย่างเดียว ═══
  if (user.role === "tracking") {
    const doSearch = async () => {
      if (!trkSearch.trim()) return;
      setTrkLoading(true);
      try {
        const q = trkSearch.trim().toLowerCase();
        const all = parcelsRef.current.length ? parcelsRef.current : (await sb.select("fx_parcels", { order: "created_at.desc" })) || [];
        const results = all.filter(p => 
          (p.flash_pno || "").toLowerCase().includes(q) || 
          (p.receiver_phone || "").includes(q) || 
          (p.receiver_name || "").toLowerCase().includes(q)
        );
        setTrkResults(results.slice(0, 50));
      } catch {} 
      setTrkLoading(false);
    };

    const getStatusColor = (fs) => {
      if (!fs || fs === "สร้างรายการ") return { bg: "#fef3c7", color: "#92400e" };
      if (fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ")) return { bg: "#d1fae5", color: "#065f46" };
      if (fs.includes("ไม่สำเร็จ") || fs.includes("คืน") || fs.includes("ตีกลับ") || fs.includes("ส่งกลับ")) return { bg: "#fee2e2", color: "#991b1b" };
      if (fs.includes("ขนส่ง")) return { bg: "#ede9fe", color: "#6d28d9" };
      return { bg: "#e0f2fe", color: "#0369a1" };
    };

    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 800 }}>
          <div style={{ textAlign: "center", marginBottom: 30 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#dc2626", margin: 0 }}>🚚 ระบบจัดการขนส่ง</h1>
            <p style={{ color: "#64748b", margin: "8px 0 0" }}>🔍 ค้นหาเลขพัสดุ / ชื่อ / เบอร์โทร</p>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            <input value={trkSearch} onChange={e => setTrkSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} placeholder="พิมพ์เลข Tracking, ชื่อ, หรือเบอร์โทร..." style={{ flex: 1, padding: "14px 18px", border: "2px solid #e2e8f0", borderRadius: 14, fontSize: 16, outline: "none", fontFamily: "inherit" }} autoFocus />
            <button onClick={doSearch} disabled={trkLoading} style={{ padding: "14px 28px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 14, fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>{trkLoading ? "⏳" : "🔍 ค้นหา"}</button>
          </div>
          {trkResults.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontSize: 13, fontWeight: 700, color: "#6b7280" }}>พบ {trkResults.length} รายการ</div>
              {trkResults.map(p => {
                const sc = getStatusColor(p.flash_status);
                return (
                  <div key={p.id} style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{p.receiver_name}</span>
                      <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: sc.bg, color: sc.color }}>{p.flash_status || "สร้างรายการ"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#6b7280", flexWrap: "wrap" }}>
                      <span>📱 {p.receiver_phone}</span>
                      {p.flash_pno && <span style={{ color: "#4f46e5", fontWeight: 600, fontFamily: "monospace" }}>📦 {p.flash_pno}</span>}
                      {p.flash_sort_code && <span>🏷️ {p.flash_sort_code}</span>}
                    </div>
                    {p.flash_detail && <div style={{ fontSize: 12, color: "#9ca3af" }}>💬 {p.flash_detail}</div>}
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>
                      📅 {new Date(p.created_at).toLocaleDateString("th-TH")}
                      {p.flash_updated_at && <span> • อัพเดต {new Date(p.flash_updated_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {trkResults.length === 0 && trkSearch && !trkLoading && (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>
              <div style={{ fontSize: 36 }}>📭</div>
              <div style={{ marginTop: 8, fontWeight: 600 }}>ไม่พบข้อมูล</div>
            </div>
          )}
          <div style={{ textAlign: "center", marginTop: 30 }}>
            <button onClick={handleLogout} style={{ padding: "8px 20px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>🚪 ออกจากระบบ ({user.display_name})</button>
          </div>
        </div>
      </div>
    );
  }
  const role = ROLES[user.role] || ROLES.shipping;

  const MENU = [
    ...(perm.dashboard ? [{ key: "dashboard", label: "Dashboard", icon: "📊" }] : []),
    { key: "parcels", label: "การจัดส่ง", icon: "📦" },
    { key: "report", label: "รายงานสถานะ", icon: "🚚" },
    { key: "notinflash", label: "แฟลชยังไม่เข้ารับ", icon: "📭" },
    ...(perm.status ? [{ key: "problems", label: "พัสดุมีปัญหา", icon: "⚠️" }] : []),
    ...(perm.dashboard ? [{ key: "summary", label: "สรุปรายงาน", icon: "📋" }] : []),
    ...(perm.evaluate ? [{ key: "evaluate", label: "ประเมินผล", icon: "📈" }] : []),
    ...(perm.viewCOD ? [{ key: "cod", label: "กระทบยอด COD", icon: "💵" }] : []),
    { key: "import", label: "Import ไฟล์", icon: "📥" },
    { key: "upsell", label: "Upsell", icon: "💰" },
    ...(perm.exportData ? [{ key: "export", label: "Export ข้อมูล", icon: "📤" }] : []),
    ...(perm.exportData ? [{ key: "exportpno", label: "Export เลขพัสดุ", icon: "🔢" }] : []),
    { key: "shops", label: "ร้านค้า", icon: "🏪" },
    ...(perm.users ? [{ key: "users", label: "จัดการผู้ใช้", icon: "👥" }] : []),
    ...(perm.users ? [{ key: "activity", label: "บันทึกกิจกรรม", icon: "📜" }] : []),
  ];

  // ═══ COD RECONCILE PAGE — กระทบยอด COD ═══
  const CODReconcilePage = () => {
    const [filt, setFilt] = useState("outstanding");
    const [shop, setShop] = useState("");
    const [sel, setSel] = useState(new Set());
    const [busy, setBusy] = useState(false);
    const isDeliv = (fs) => !!fs && (fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ") || (fs.includes("สำเร็จ") && !fs.includes("ไม่สำเร็จ")));
    const codAll = useMemo(() => parcels.filter(p => p.cod_enabled && Number(p.cod_amount) > 0 && p.status !== "cancelled" && (!shop || p.shop_id === shop)), [parcels, shop]);
    const delivered = useMemo(() => codAll.filter(p => isDeliv(p.flash_status)), [codAll]);
    const sum = (arr) => arr.reduce((s, p) => s + Number(p.cod_amount || 0), 0);
    const codTotal = sum(codAll), collected = sum(delivered);
    const received = sum(delivered.filter(p => p.cod_received));
    const outstanding = collected - received, inTransit = codTotal - collected;
    const rows = useMemo(() => delivered.filter(p => filt === "all" || (filt === "received" ? p.cod_received : !p.cod_received)).sort((a, b) => new Date(b.flash_updated_at || b.created_at) - new Date(a.flash_updated_at || a.created_at)), [delivered, filt]);
    const fmt = (n) => "฿" + Number(n).toLocaleString();
    const setOne = async (p, val) => {
      const at = val ? new Date().toISOString() : null;
      setParcels(prev => prev.map(x => x.id === p.id ? { ...x, cod_received: val, cod_received_at: at } : x));
      try { if (!isDemo) await sb.update("fx_parcels", p.id, { cod_received: val, cod_received_at: at }); } catch (e) { uiAlert("บันทึกไม่สำเร็จ: " + e.message); }
    };
    const confirmSel = async () => {
      const t = rows.filter(p => sel.has(p.id) && !p.cod_received);
      if (!t.length) { uiAlert("เลือกรายการที่ยังค้างรับก่อน"); return; }
      if (!(await uiConfirm(`ยืนยันรับเงิน COD ${t.length} รายการ\nรวม ${fmt(sum(t))}?`, { okText: "✅ ยืนยันรับเงิน" }))) return;
      setBusy(true);
      const at = new Date().toISOString();
      for (const p of t) { setParcels(prev => prev.map(x => x.id === p.id ? { ...x, cod_received: true, cod_received_at: at } : x)); try { if (!isDemo) await sb.update("fx_parcels", p.id, { cod_received: true, cod_received_at: at }); } catch {} }
      setSel(new Set()); setBusy(false); showToast(`ยืนยันรับเงินแล้ว ${t.length} รายการ`);
    };
    const allSel = rows.length > 0 && rows.every(p => sel.has(p.id));
    const cards = [
      { l: "COD ทั้งหมด", v: codTotal, c: "#4f46e5", sub: codAll.length + " ใบ" },
      { l: "กำลังส่ง (ยังไม่เก็บ)", v: inTransit, c: "#f59e0b", sub: (codAll.length - delivered.length) + " ใบ" },
      { l: "เก็บเงินได้แล้ว", v: collected, c: "#0ea5e9", sub: delivered.length + " ใบส่งสำเร็จ" },
      { l: "Flash โอนแล้ว", v: received, c: "#10b981", sub: delivered.filter(p => p.cod_received).length + " ใบ" },
      { l: "ค้างรับจาก Flash", v: outstanding, c: "#dc2626", sub: delivered.filter(p => !p.cod_received).length + " ใบ" },
    ];
    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>💵 กระทบยอด COD</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>ติดตามเงินเก็บปลายทาง — เก็บได้แล้ว / Flash โอนแล้ว / ค้างรับ · ติ๊กยืนยันเมื่อได้รับเงินจาก Flash</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
          {cards.map((c, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #e2e8f0", borderLeft: `4px solid ${c.c}` }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{c.l}</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: c.c }}>{fmt(c.v)}</div>
              <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          {[["outstanding", "⏳ ค้างรับ"], ["received", "✅ รับแล้ว"], ["all", "📋 ส่งสำเร็จทั้งหมด"]].map(([k, l]) => (
            <button key={k} onClick={() => { setFilt(k); setSel(new Set()); }} style={{ padding: "8px 16px", borderRadius: 8, border: filt === k ? "none" : "1px solid #e2e8f0", background: filt === k ? "#4f46e5" : "#fff", color: filt === k ? "#fff" : "#475569", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>
          ))}
          {shops.length > 0 && <select value={shop} onChange={e => setShop(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}><option value="">🏪 ทุกร้าน</option>{shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <div style={{ flex: 1 }} />
          {filt !== "received" && <button onClick={confirmSel} disabled={busy || sel.size === 0} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: sel.size ? "#10b981" : "#cbd5e1", color: "#fff", fontWeight: 700, fontSize: 13, cursor: sel.size ? "pointer" : "default" }}>✅ ยืนยันรับเงินที่เลือก ({sel.size})</button>}
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "10px 12px", width: 36 }}><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map(p => p.id)))} /></th>
                {["วันที่ส่งสำเร็จ", "เลขพัสดุ", "ผู้รับ", "ร้านค้า", "ยอด COD", "สถานะรับเงิน"].map((h, i) => <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>)}
              </tr></thead>
              <tbody>{rows.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: p.cod_received ? "#f0fdf4" : "#fff" }}>
                  <td style={{ padding: "10px 12px" }}><input type="checkbox" checked={sel.has(p.id)} onChange={() => setSel(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} /></td>
                  <td style={{ padding: "10px 12px", color: "#64748b", whiteSpace: "nowrap" }}>{new Date(p.flash_updated_at || p.created_at).toLocaleDateString("th-TH")}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#4f46e5" }}>{p.flash_pno || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{p.receiver_name}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>{(shops.find(s => s.id === p.shop_id) || {}).name || "—"}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 800, color: "#0f172a" }}>{fmt(p.cod_amount)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => setOne(p, !p.cod_received)} style={{ padding: "5px 12px", borderRadius: 20, border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", background: p.cod_received ? "#d1fae5" : "#fef3c7", color: p.cod_received ? "#065f46" : "#92400e" }}>
                      {p.cod_received ? `✅ รับแล้ว${p.cod_received_at ? " " + new Date(p.cod_received_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" }) : ""}` : "⏳ กดเมื่อรับเงิน"}
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {rows.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 36 }}>💸</div><div style={{ marginTop: 8 }}>{filt === "outstanding" ? "ไม่มียอดค้างรับ — เก็บครบแล้ว 🎉" : filt === "received" ? "ยังไม่มีรายการที่ยืนยันรับเงิน" : "ยังไม่มีพัสดุ COD ที่ส่งสำเร็จ"}</div></div>}
        </div>
      </div>
    );
  };

  // ═══ แฟลชยังไม่เข้ารับ — พัสดุสร้างเลขแล้วแต่ Flash ยังไม่สแกนรับ ═══
  const NotInFlashPage = () => {
    useEffect(() => { if (!isDemo) loadNotInFlash(); }, []);
    const source = isDemo ? notInFlash : notInFlashAll;
    const list = useMemo(() => [...source].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)), [source]);
    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📭 แฟลชยังไม่เข้ารับ</h2>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>พัสดุที่สร้างเลขแล้วแต่ Flash ยังไม่สแกนรับ — ปริ้นใบปะหน้าให้พนักงานแฟลช แล้วรอเข้ารับ</p>
          </div>
          {list.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={refreshFlashStatus} disabled={flashRefreshing} style={{ padding: "10px 16px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: flashRefreshing ? "default" : "pointer" }}>{flashRefreshing ? "⟳ กำลังเช็ก..." : "🔄 เช็กสถานะตอนนี้"}</button>
              <button onClick={() => setPrintPreview(list.map(p => ({ ...p })))} style={{ padding: "10px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>🖨️ ปริ้นทั้งหมด ({list.length})</button>
            </div>
          )}
        </div>
        {list.length === 0 && <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 50, textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 40 }}>✅</div><div style={{ marginTop: 10, fontWeight: 600 }}>แฟลชเข้ารับครบทุกชิ้นแล้ว</div></div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map(p => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{p.receiver_name} <span style={{ fontFamily: "monospace", fontSize: 12, color: "#4f46e5", fontWeight: 600, marginLeft: 6 }}>{p.flash_pno}</span></div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 3 }}>📍 {[p.receiver_district, p.receiver_province].filter(Boolean).join(" ")} · 📅 {new Date(p.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })} {p.cod_enabled && Number(p.cod_amount) > 0 ? <span style={{ color: "#dc2626", fontWeight: 700 }}>· COD ฿{Number(p.cod_amount).toLocaleString()}</span> : null}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: "#fef3c7", color: "#92400e", whiteSpace: "nowrap" }}>รอเข้ารับ</span>
                <button onClick={() => setPrintPreview([{ ...p }])} style={{ padding: "8px 14px", borderRadius: 8, background: "#059669", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>🖨️ ปริ้น</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ═══ PROBLEM PARCELS PAGE — พัสดุตีกลับ/ส่งไม่สำเร็จ ═══
  const ProblemPage = () => {
    const isProblem = (fs) => !!fs && (fs.includes("ไม่สำเร็จ") || fs.includes("ตีกลับ") || fs.includes("คืน") || fs.includes("ส่งกลับ"));
    const probs = useMemo(() => parcels.filter(p => isProblem(p.flash_status) && p.status !== "cancelled").sort((a, b) => new Date(b.flash_updated_at || b.created_at) - new Date(a.flash_updated_at || a.created_at)), [parcels]);
    const [notes, setNotes] = useState({});
    const [saving, setSaving] = useState(null);
    const saveNote = async (p) => {
      const txt = notes[p.id] ?? p.remark ?? "";
      setSaving(p.id);
      setParcels(prev => prev.map(x => x.id === p.id ? { ...x, remark: txt } : x));
      try { if (!isDemo) await sb.update("fx_parcels", p.id, { remark: txt }); showToast("บันทึกหมายเหตุแล้ว"); } catch (e) { uiAlert("บันทึกไม่สำเร็จ: " + e.message); }
      setSaving(null);
    };
    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>⚠️ พัสดุมีปัญหา (ตีกลับ / ส่งไม่สำเร็จ)</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>รวมใบที่ส่งไม่สำเร็จ/ตีกลับ — โทรหาลูกค้า · จดหมายเหตุนัดส่งใหม่ · ตัดสินใจยกเลิก ในที่เดียว</p>
        </div>
        {probs.length === 0 && <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: 50, textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 40 }}>🎉</div><div style={{ marginTop: 10, fontWeight: 600 }}>ไม่มีพัสดุที่มีปัญหา</div></div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {probs.map(p => (
            <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid #fecaca", borderLeft: "4px solid #ef4444", padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{p.receiver_name} <span style={{ fontFamily: "monospace", fontSize: 12, color: "#4f46e5", fontWeight: 600, marginLeft: 6 }}>{p.flash_pno || ""}</span></div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 3 }}>📍 {[p.receiver_district, p.receiver_province].filter(Boolean).join(" ")} {p.cod_enabled && Number(p.cod_amount) > 0 ? <span style={{ color: "#dc2626", fontWeight: 700 }}>· COD ฿{Number(p.cod_amount).toLocaleString()}</span> : null}</div>
                </div>
                <span style={{ padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700, background: "#fee2e2", color: "#991b1b", whiteSpace: "nowrap" }}>{p.flash_status}</span>
              </div>
              {p.flash_detail && <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 10, padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>💬 {p.flash_detail}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                <a href={`tel:${p.receiver_phone}`} style={{ padding: "8px 16px", borderRadius: 8, background: "#10b981", color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>📞 โทรหาลูกค้า ({p.receiver_phone})</a>
                {perm.cancelFlash && <button onClick={() => cancelFlashOrder(p)} style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", border: "1px solid #fca5a5", color: "#dc2626", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>❌ ตัดสินใจยกเลิก/ตีกลับ</button>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>📝 หมายเหตุ / นัดส่งใหม่</label>
                  <textarea value={notes[p.id] ?? p.remark ?? ""} onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value }))} placeholder="เช่น โทรแล้วลูกค้านัดส่งใหม่ 5 มิ.ย. / ที่อยู่ผิดให้ตีกลับ" rows={2} style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 3, boxSizing: "border-box" }} />
                </div>
                <button onClick={() => saveNote(p)} disabled={saving === p.id} style={{ padding: "8px 16px", borderRadius: 8, background: "#4f46e5", color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>{saving === p.id ? "..." : "💾 บันทึก"}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ═══ ACTIVITY LOG PAGE — บันทึกกิจกรรม ═══
  const ActivityLogPage = () => {
    const [logs, setLogs] = useState(null);
    const [q, setQ] = useState("");
    useEffect(() => { (async () => { try { const d = await sb.select("fx_activity_log", { order: "created_at.desc", limit: 300 }); setLogs(d || []); } catch { setLogs([]); } })(); }, []);
    const icon = (a) => (a || "").includes("ลบ") ? "🗑️" : (a || "").includes("ยกเลิก") ? "❌" : (a || "").includes("สร้าง") ? "📦" : "•";
    const color = (a) => (a || "").includes("ลบ") ? "#dc2626" : (a || "").includes("ยกเลิก") ? "#f97316" : (a || "").includes("สร้าง") ? "#059669" : "#64748b";
    const filtered = (logs || []).filter(l => !q || [l.actor_name, l.detail, l.action].some(v => (v || "").toLowerCase().includes(q.toLowerCase())));
    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📜 บันทึกกิจกรรม</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>ใครสร้าง / ยกเลิก / ลบ พัสดุใบไหน เมื่อไหร่ — ย้อนหลัง 300 รายการล่าสุด</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหาชื่อผู้ใช้ / รายละเอียด / การกระทำ" style={{ width: "100%", maxWidth: 420, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 14, marginBottom: 16, boxSizing: "border-box" }} />
        {logs === null && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>⏳ กำลังโหลด...</div>}
        {logs !== null && (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {["เวลา", "ผู้ใช้", "การกระทำ", "รายละเอียด"].map((h, i) => <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>)}
                </tr></thead>
                <tbody>{filtered.map(l => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 14px", color: "#64748b", whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}>{l.actor_name || "—"}</td>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}><span style={{ color: color(l.action), fontWeight: 700 }}>{icon(l.action)} {l.action}</span></td>
                    <td style={{ padding: "10px 14px", color: "#475569" }}>{l.detail}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 36 }}>📭</div><div style={{ marginTop: 8 }}>{(logs.length === 0) ? "ยังไม่มีบันทึกกิจกรรม" : "ไม่พบรายการที่ค้นหา"}</div></div>}
          </div>
        )}
      </div>
    );
  };

  // ═══ SUMMARY REPORT PAGE — สรุปรายงานขนส่ง ═══
  const SummaryReportPage = () => {
    const tracked = parcels.filter(p => p.flash_pno);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const getDateRange = (period) => {
      const end = new Date(now); end.setHours(23,59,59,999);
      const start = new Date(now); start.setHours(0,0,0,0);
      if (period === "daily") return { start, end, label: "วันนี้ (" + now.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) + ")" };
      if (period === "7days") { start.setDate(start.getDate() - 6); return { start, end, label: "7 วันล่าสุด" }; }
      if (period === "monthly") { start.setDate(1); return { start, end, label: "เดือน" + now.toLocaleDateString("th-TH", { month: "long", year: "numeric" }) }; }
      if (period === "custom") {
        const s = new Date(summaryFrom); s.setHours(0,0,0,0);
        const e = new Date(summaryTo); e.setHours(23,59,59,999);
        return { start: s, end: e, label: `${s.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} - ${e.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}` };
      }
      return { start, end, label: "" };
    };

    const range = getDateRange(summaryPeriod);
    const data = tracked.filter(p => { const d = new Date(p.created_at); return d >= range.start && d <= range.end; });

    const matchSt = (fs, key) => {
      if (!fs) return false;
      if (key === "transit") return fs.includes("ขนส่ง") && !fs.includes("ไม่สำเร็จ") && !fs.includes("คืน");
      if (key === "delivered") return fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ");
      if (key === "returned") return fs.includes("คืน") || fs.includes("ส่งกลับ") || fs.includes("ไม่สำเร็จ") || fs.includes("ตีกลับ");
      if (key === "delivering") return fs.includes("กำลังจัดส่ง") || fs.includes("นำจ่าย") || fs.includes("ระหว่างการจัดส่ง");
      if (key === "pickup") return fs.includes("รับพัสดุ") || fs.includes("รับสินค้า");
      return false;
    };

    const totalCreated = data.length;
    const delivered = data.filter(p => matchSt(p.flash_status, "delivered")).length;
    const inTransit = data.filter(p => matchSt(p.flash_status, "transit")).length;
    const delivering = data.filter(p => matchSt(p.flash_status, "delivering")).length;
    const pickedUp = data.filter(p => matchSt(p.flash_status, "pickup")).length;
    const returned = data.filter(p => matchSt(p.flash_status, "returned")).length;
    const pending = data.filter(p => !p.flash_status || p.flash_status === "สร้างรายการ").length;
    const codParcels = data.filter(p => p.cod_enabled);
    const codTotal = codParcels.reduce((s, p) => s + Number(p.cod_amount || 0), 0);
    const codDelivered = data.filter(p => p.cod_enabled && matchSt(p.flash_status, "delivered")).reduce((s, p) => s + Number(p.cod_amount || 0), 0);
    const successRate = totalCreated > 0 ? ((delivered / totalCreated) * 100).toFixed(1) : "0.0";
    const returnRate = totalCreated > 0 ? ((returned / totalCreated) * 100).toFixed(1) : "0.0";

    // แยกตามร้านค้า
    const byShop = {};
    for (const p of data) {
      const sid = p.shop_id || "none";
      if (!byShop[sid]) byShop[sid] = { total: 0, delivered: 0, returned: 0, cod: 0, codDelivered: 0 };
      byShop[sid].total++;
      if (matchSt(p.flash_status, "delivered")) { byShop[sid].delivered++; if (p.cod_enabled) byShop[sid].codDelivered += Number(p.cod_amount || 0); }
      if (matchSt(p.flash_status, "returned")) byShop[sid].returned++;
      if (p.cod_enabled) byShop[sid].cod += Number(p.cod_amount || 0);
    }

    // แยกตามประเภทสินค้า (ดึงจาก remark: ตัด "ปลายทาง..." + เลขท้ายออก → ชื่อสินค้า)
    const productType = (remark) => {
      if (!remark) return "(ไม่ระบุ)";
      let s = String(remark).split("ปลายทาง")[0].trim();
      s = s.replace(/[0-9]+\s*$/, "").trim();
      return s || "(ไม่ระบุ)";
    };
    const byType = {};
    for (const p of data) {
      const t = productType(p.remark);
      if (!byType[t]) byType[t] = { total: 0, delivered: 0, returned: 0, cod: 0, codDelivered: 0 };
      byType[t].total++;
      if (matchSt(p.flash_status, "delivered")) { byType[t].delivered++; if (p.cod_enabled) byType[t].codDelivered += Number(p.cod_amount || 0); }
      if (matchSt(p.flash_status, "returned")) byType[t].returned++;
      if (p.cod_enabled) byType[t].cod += Number(p.cod_amount || 0);
    }
    const typeRows = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);

    // แยกตามวัน (สำหรับ 7 วัน/เดือน)
    const byDay = {};
    for (const p of data) {
      const d = p.created_at?.slice(0, 10) || todayStr;
      if (!byDay[d]) byDay[d] = { total: 0, delivered: 0, returned: 0, cod: 0 };
      byDay[d].total++;
      if (matchSt(p.flash_status, "delivered")) byDay[d].delivered++;
      if (matchSt(p.flash_status, "returned")) byDay[d].returned++;
      if (p.cod_enabled) byDay[d].cod += Number(p.cod_amount || 0);
    }
    const days = Object.keys(byDay).sort().reverse();

    const C = (bg, color, icon, label, value) => (
      <div style={{ background: bg, borderRadius: 14, padding: "16px 20px", flex: 1, minWidth: 140 }}>
        <div style={{ fontSize: 12, color, opacity: .7, marginBottom: 4 }}>{icon} {label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
      </div>
    );

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>📋 สรุปรายงานขนส่ง</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>{range.label}</p>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          {[{ key: "daily", label: "📅 รายวัน" }, { key: "7days", label: "📆 7 วัน" }, { key: "monthly", label: "🗓️ รายเดือน" }, { key: "custom", label: "📌 เลือกวันที่" }].map(t => (
            <button key={t.key} onClick={() => setSummaryPeriod(t.key)} style={{ padding: "10px 20px", border: summaryPeriod === t.key ? "none" : "1.5px solid #e5e7eb", borderRadius: 10, background: summaryPeriod === t.key ? "#4f46e5" : "#fff", color: summaryPeriod === t.key ? "#fff" : "#374151", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{t.label}</button>
          ))}
          {summaryPeriod === "custom" && (<>
            <input type="date" value={summaryFrom} onChange={e => setSummaryFrom(e.target.value)} style={{ padding: "10px 14px", border: "1.5px solid #4f46e5", borderRadius: 10, fontSize: 14, fontFamily: "inherit", fontWeight: 600 }} />
            <span style={{ color: "#9ca3af", fontWeight: 700 }}>→</span>
            <input type="date" value={summaryTo} onChange={e => setSummaryTo(e.target.value)} style={{ padding: "10px 14px", border: "1.5px solid #4f46e5", borderRadius: 10, fontSize: 14, fontFamily: "inherit", fontWeight: 600 }} />
          </>)}
        </div>

        {/* Summary Cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          {C("#eff6ff", "#1d4ed8", "📦", "สร้างทั้งหมด", totalCreated.toLocaleString())}
          {C("#ecfdf5", "#059669", "✅", "จัดส่งสำเร็จ", delivered.toLocaleString())}
          {C("#ede9fe", "#6d28d9", "🚛", "ระหว่างขนส่ง", (inTransit + delivering + pickedUp).toLocaleString())}
          {C("#fee2e2", "#dc2626", "↩️", "ตีกลับ", returned.toLocaleString())}
          {C("#fef3c7", "#d97706", "📝", "รอดำเนินการ", pending.toLocaleString())}
        </div>

        {/* Rate + COD */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          {C("#ecfdf5", "#059669", "📊", "อัตราส่งสำเร็จ", successRate + "%")}
          {C("#fee2e2", "#dc2626", "📊", "อัตราตีกลับ", returnRate + "%")}
          {C("#fff7ed", "#c2410c", "💰", "COD ทั้งหมด", "฿" + codTotal.toLocaleString())}
          {C("#f0fdf4", "#15803d", "💵", "COD เก็บแล้ว", "฿" + codDelivered.toLocaleString())}
        </div>

        {/* ตารางแยกร้านค้า */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "14px 20px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 800, fontSize: 15 }}>🏪 แยกตามร้านค้า</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f9fafb" }}>
              {["ร้านค้า", "สร้าง", "สำเร็จ", "ตีกลับ", "อัตราสำเร็จ", "COD", "COD เก็บแล้ว"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: 12 }}>{h}</th>)}
            </tr></thead>
            <tbody>{Object.entries(byShop).map(([sid, s]) => {
              const shop = shops?.find(sh => sh.id === sid);
              return (
                <tr key={sid} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{shop?.name || "ไม่ระบุ"}</td>
                  <td style={{ padding: "10px 14px" }}>{s.total}</td>
                  <td style={{ padding: "10px 14px", color: "#059669", fontWeight: 700 }}>{s.delivered}</td>
                  <td style={{ padding: "10px 14px", color: "#dc2626", fontWeight: 700 }}>{s.returned}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 700 }}>{s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(1) : 0}%</td>
                  <td style={{ padding: "10px 14px", color: "#c2410c" }}>฿{s.cod.toLocaleString()}</td>
                  <td style={{ padding: "10px 14px", color: "#15803d", fontWeight: 700 }}>฿{s.codDelivered.toLocaleString()}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>

        {/* ตารางแยกตามประเภทสินค้า (จาก Note) */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "14px 20px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 800, fontSize: 15 }}>📦 แยกตามประเภทสินค้า <span style={{ fontWeight: 400, fontSize: 12, color: "#9ca3af" }}>(ดึงจาก Note)</span></div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f9fafb" }}>
              {["ประเภทสินค้า", "จำนวน", "สำเร็จ", "ตีกลับ", "อัตราสำเร็จ", "COD", "COD เก็บแล้ว"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: 12 }}>{h}</th>)}
            </tr></thead>
            <tbody>{typeRows.map(([t, s]) => (
              <tr key={t} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700 }}>{t}</td>
                <td style={{ padding: "10px 14px", fontWeight: 700 }}>{s.total}</td>
                <td style={{ padding: "10px 14px", color: "#059669", fontWeight: 700 }}>{s.delivered}</td>
                <td style={{ padding: "10px 14px", color: "#dc2626", fontWeight: 700 }}>{s.returned}</td>
                <td style={{ padding: "10px 14px", fontWeight: 700 }}>{s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(1) : 0}%</td>
                <td style={{ padding: "10px 14px", color: "#c2410c" }}>฿{s.cod.toLocaleString()}</td>
                <td style={{ padding: "10px 14px", color: "#15803d", fontWeight: 700 }}>฿{s.codDelivered.toLocaleString()}</td>
              </tr>
            ))}
            {typeRows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "#9ca3af" }}>ไม่มีข้อมูล</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ตารางแยกรายวัน (7 วัน/เดือน) */}
        {summaryPeriod !== "daily" && days.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 800, fontSize: 15 }}>📅 แยกตามวัน</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f9fafb" }}>
                {["วันที่", "สร้าง", "สำเร็จ", "ตีกลับ", "อัตราสำเร็จ", "COD"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: 12 }}>{h}</th>)}
              </tr></thead>
              <tbody>{days.map(d => {
                const s = byDay[d];
                return (
                  <tr key={d} style={{ borderBottom: "1px solid #f3f4f6", background: d === todayStr ? "#eff6ff" : "#fff" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}>{new Date(d).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td style={{ padding: "10px 14px" }}>{s.total}</td>
                    <td style={{ padding: "10px 14px", color: "#059669", fontWeight: 700 }}>{s.delivered}</td>
                    <td style={{ padding: "10px 14px", color: "#dc2626", fontWeight: 700 }}>{s.returned}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 700 }}>{s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(1) : 0}%</td>
                    <td style={{ padding: "10px 14px", color: "#c2410c" }}>฿{s.cod.toLocaleString()}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ═══ EVALUATE PAGE — ประเมินผลแอดมิน ═══
  const EvaluatePage = () => {

    const evalData = useMemo(() => {
      let list = parcels.filter(p => p.flash_pno);
      if (evalShop) list = list.filter(p => p.shop_id === evalShop);
      if (evalFrom) list = list.filter(p => (p.created_at || "").slice(0, 10) >= evalFrom);
      if (evalTo) list = list.filter(p => (p.created_at || "").slice(0, 10) <= evalTo);
      return list;
    }, [parcels, evalShop, evalFrom, evalTo]);

    const staffEval = useMemo(() => {
      const map = {};
      evalData.forEach(p => {
        const name = p.sale_person || p.created_by_name || "ไม่ระบุ";
        if (!map[name]) map[name] = { total: 0, delivered: 0, returned: 0, inTransit: 0, waiting: 0, cancelled: 0, cod: 0, codDelivered: 0, provinces: {} };
        const m = map[name];
        m.total++;
        const fs = p.flash_status || "";
        if (fs === "เซ็นรับแล้ว") { m.delivered++; if (p.cod_enabled) m.codDelivered += Number(p.cod_amount || 0); }
        else if (fs.includes("ส่งคืน") || fs.includes("คืนสำเร็จ") || fs.includes("นำส่งไม่สำเร็จ") || fs.includes("ตีกลับ") || fs.includes("ส่งกลับ")) m.returned++;
        else if (fs === "รับพัสดุแล้ว" || fs === "อยู่ในระบบขนส่ง" || fs === "กำลังจัดส่ง") m.inTransit++;
        else if (p.status === "cancelled") m.cancelled++;
        else m.waiting++;
        if (p.cod_enabled) m.cod += Number(p.cod_amount || 0);
        const prov = p.receiver_province || "ไม่ระบุ";
        if (!m.provinces[prov]) m.provinces[prov] = { total: 0, returned: 0 };
        m.provinces[prov].total++;
        if (fs.includes("ส่งคืน") || fs.includes("คืนสำเร็จ") || fs.includes("นำส่งไม่สำเร็จ") || fs.includes("ตีกลับ") || fs.includes("ส่งกลับ")) m.provinces[prov].returned++;
      });
      return Object.entries(map).map(([name, d]) => {
        const completed = d.delivered + d.returned;
        const deliveryRate = completed > 0 ? ((d.delivered / completed) * 100).toFixed(1) : "—";
        const returnRate = completed > 0 ? ((d.returned / completed) * 100).toFixed(1) : "—";
        const topReturnProv = Object.entries(d.provinces).filter(([, v]) => v.returned > 0).sort((a, b) => b[1].returned - a[1].returned).slice(0, 3);
        return { name, ...d, deliveryRate, returnRate, topReturnProv };
      }).sort((a, b) => b.total - a.total);
    }, [evalData]);

    // Overall stats
    const overall = useMemo(() => {
      const t = { total: 0, delivered: 0, returned: 0, inTransit: 0 };
      staffEval.forEach(s => { t.total += s.total; t.delivered += s.delivered; t.returned += s.returned; t.inTransit += s.inTransit; });
      const completed = t.delivered + t.returned;
      t.deliveryRate = completed > 0 ? ((t.delivered / completed) * 100).toFixed(1) : "—";
      t.returnRate = completed > 0 ? ((t.returned / completed) * 100).toFixed(1) : "—";
      return t;
    }, [staffEval]);

    const rateColor = (rate) => {
      const n = parseFloat(rate);
      if (isNaN(n)) return "#6b7280";
      if (n >= 90) return "#059669";
      if (n >= 70) return "#d97706";
      return "#dc2626";
    };
    const returnColor = (rate) => {
      const n = parseFloat(rate);
      if (isNaN(n)) return "#6b7280";
      if (n <= 5) return "#059669";
      if (n <= 15) return "#d97706";
      return "#dc2626";
    };

    const I = { padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontFamily: "inherit" };

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#111" }}>📈 ประเมินผลแอดมิน</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>วิเคราะห์อัตราจัดส่งสำเร็จ vs ตีกลับ แยกรายบุคคล</p>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>ตั้งแต่วันที่</label>
            <input type="date" value={evalFrom} onChange={e => setEvalFrom(e.target.value)} style={I} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>ถึงวันที่</label>
            <input type="date" value={evalTo} onChange={e => setEvalTo(e.target.value)} style={I} />
          </div>
          {shops?.length > 0 && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 4 }}>ร้านค้า</label>
              <select value={evalShop} onChange={e => setEvalShop(e.target.value)} style={{ ...I, minWidth: 150 }}>
                <option value="">ทุกร้าน</option>
                {shops.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ fontSize: 13, color: "#6b7280", padding: "10px 0" }}>พัสดุที่มีเลข Tracking: <strong>{evalData.length}</strong> รายการ</div>
        </div>

        {/* Overall Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>📋 ทั้งหมด</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#111" }}>{overall.total}</div>
          </div>
          <div style={{ background: "#ecfdf5", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, color: "#065f46", marginBottom: 4 }}>✅ จัดส่งสำเร็จ</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#059669" }}>{overall.delivered}</div>
          </div>
          <div style={{ background: "#fee2e2", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, color: "#991b1b", marginBottom: 4 }}>↩️ ตีกลับ</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#dc2626" }}>{overall.returned}</div>
          </div>
          <div style={{ background: "#dbeafe", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, color: "#1e40af", marginBottom: 4 }}>🚛 กำลังจัดส่ง</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "#2563eb" }}>{overall.inTransit}</div>
          </div>
          <div style={{ background: "#ecfdf5", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, color: "#065f46", marginBottom: 4 }}>📊 อัตราสำเร็จรวม</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: rateColor(overall.deliveryRate) }}>{overall.deliveryRate}%</div>
          </div>
          <div style={{ background: "#fee2e2", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, color: "#991b1b", marginBottom: 4 }}>📊 อัตราตีกลับรวม</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: returnColor(overall.returnRate) }}>{overall.returnRate}%</div>
          </div>
        </div>

        {/* Per-Staff Table */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: 24 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, fontSize: 15, color: "#111" }}>👥 แยกรายบุคคล ({staffEval.length} คน)</div>
          {!staffEval.length ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>ไม่มีข้อมูล</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    {["#", "แอดมิน/พนักงาน", "ทั้งหมด", "✅ สำเร็จ", "↩️ ตีกลับ", "🚛 กำลังส่ง", "⏳ รอ", "❌ ยกเลิก", "อัตราสำเร็จ", "อัตราตีกลับ", ...(perm.viewCOD ? ["COD รวม", "COD สำเร็จ"] : []), "จังหวัดตีกลับบ่อย"].map((h, i) => (
                      <th key={i} style={{ padding: "10px 12px", textAlign: i >= 2 ? "center" : "left", fontWeight: 700, color: "#6b7280", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffEval.map((s, i) => (
                    <tr key={s.name} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 ? "#fafafa" : "#fff" }}>
                      <td style={{ padding: "12px", textAlign: "center", color: "#9ca3af", fontSize: 12 }}>{i + 1}</td>
                      <td style={{ padding: "12px", fontWeight: 700, color: "#111", whiteSpace: "nowrap" }}>🧑‍💻 {s.name}</td>
                      <td style={{ padding: "12px", textAlign: "center", fontWeight: 700 }}>{s.total}</td>
                      <td style={{ padding: "12px", textAlign: "center", fontWeight: 700, color: "#059669" }}>{s.delivered}</td>
                      <td style={{ padding: "12px", textAlign: "center", fontWeight: 700, color: "#dc2626" }}>{s.returned}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#2563eb" }}>{s.inTransit}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#d97706" }}>{s.waiting}</td>
                      <td style={{ padding: "12px", textAlign: "center", color: "#6b7280" }}>{s.cancelled}</td>
                      <td style={{ padding: "12px", textAlign: "center" }}>
                        <span style={{ padding: "4px 12px", borderRadius: 8, fontWeight: 800, fontSize: 14, background: rateColor(s.deliveryRate) === "#059669" ? "#ecfdf5" : rateColor(s.deliveryRate) === "#d97706" ? "#fffbeb" : "#fef2f2", color: rateColor(s.deliveryRate) }}>{s.deliveryRate}%</span>
                      </td>
                      <td style={{ padding: "12px", textAlign: "center" }}>
                        <span style={{ padding: "4px 12px", borderRadius: 8, fontWeight: 800, fontSize: 14, background: returnColor(s.returnRate) === "#059669" ? "#ecfdf5" : returnColor(s.returnRate) === "#d97706" ? "#fffbeb" : "#fef2f2", color: returnColor(s.returnRate) }}>{s.returnRate}%</span>
                      </td>
                      {perm.viewCOD && <>
                        <td style={{ padding: "12px", textAlign: "center", fontWeight: 700, color: "#b45309" }}>฿{s.cod.toLocaleString()}</td>
                        <td style={{ padding: "12px", textAlign: "center", fontWeight: 700, color: "#059669" }}>฿{s.codDelivered.toLocaleString()}</td>
                      </>}
                      <td style={{ padding: "12px", fontSize: 12 }}>
                        {s.topReturnProv.length ? s.topReturnProv.map(([prov, v]) => (
                          <span key={prov} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, background: "#fee2e2", color: "#991b1b", fontSize: 11, fontWeight: 600, marginRight: 4, marginBottom: 2 }}>{prov} ({v.returned})</span>
                        )) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rating Guide */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", padding: "16px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#111" }}>📋 เกณฑ์ประเมิน</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#059669" }}>✅ อัตราจัดส่งสำเร็จ</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#059669", display: "inline-block" }}></span> ≥ 90% — ดีเยี่ยม</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#d97706", display: "inline-block" }}></span> 70-89% — ปานกลาง</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#dc2626", display: "inline-block" }}></span> &lt; 70% — ต้องปรับปรุง</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#dc2626" }}>↩️ อัตราตีกลับ</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#059669", display: "inline-block" }}></span> ≤ 5% — ดีเยี่ยม</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#d97706", display: "inline-block" }}></span> 6-15% — ปานกลาง</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#dc2626", display: "inline-block" }}></span> &gt; 15% — ต้องปรับปรุง</div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>
            * คำนวณจากพัสดุที่มีผลลัพธ์แล้ว (สำเร็จ + ตีกลับ) — ไม่รวมพัสดุที่กำลังจัดส่งอยู่
          </div>
        </div>
      </div>
    );
  };

  // ═══ REPORT PAGE — รายงานสถานะพัสดุ Flash ═══
  const ReportPage = () => {
    const RPT_PER = rptPerPage;

    // เฉพาะพัสดุที่มีเลข Tracking
    const tracked = useMemo(() => parcels.filter(p => p.flash_pno), [parcels]);

    const FLASH_TABS = [
      { key: "ALL", label: "ทั้งหมด", icon: "📋", color: "#4f46e5" },
      { key: "สร้างรายการ", label: "สร้างรายการ", icon: "📝", color: "#f59e0b" },
      { key: "รับพัสดุแล้ว", label: "รับพัสดุแล้ว", icon: "📬", color: "#0ea5e9" },
      { key: "ขนส่ง", label: "ในระบบขนส่ง", icon: "🚛", color: "#8b5cf6" },
      { key: "กำลังจัดส่ง", label: "กำลังจัดส่ง", icon: "🛵", color: "#3b82f6" },
      { key: "เซ็นรับแล้ว", label: "เซ็นรับแล้ว", icon: "✅", color: "#10b981" },
      { key: "RETURN_ALL", label: "ตีกลับทั้งหมด", icon: "↩️", color: "#ef4444" },
      { key: "นำส่งไม่สำเร็จ", label: "นำส่งไม่สำเร็จ", icon: "❌", color: "#f97316" },
      { key: "ส่งคืน", label: "กำลังส่งคืน", icon: "🔄", color: "#ef4444" },
      { key: "คืนสำเร็จ", label: "คืนสำเร็จ", icon: "📦", color: "#6b7280" },
      { key: "OTHER", label: "อื่นๆ", icon: "❓", color: "#78716c" },
    ];

    const RETURN_STATUSES = ["ส่งคืน", "คืนสำเร็จ", "นำส่งไม่สำเร็จ", "ตีกลับ", "ส่งกลับ"];
    const KNOWN_KEYS = ["รับพัสดุแล้ว", "ขนส่ง", "กำลังจัดส่ง", "เซ็นรับแล้ว", "นำส่งไม่สำเร็จ", "ส่งคืน", "คืนสำเร็จ"];

    // match สถานะ Flash ทุกรูปแบบ (API คืนชื่อต่างกัน)
    const matchStatus = (fs, key) => {
      if (!fs) return false;
      if (key === "ขนส่ง") return fs.includes("ขนส่ง") && !fs.includes("ไม่สำเร็จ") && !fs.includes("คืน");
      if (key === "รับพัสดุแล้ว") return fs.includes("รับพัสดุ") || fs.includes("รับสินค้า");
      if (key === "กำลังจัดส่ง") return fs.includes("กำลังจัดส่ง") || fs.includes("นำจ่าย") || fs.includes("รอการนำส่ง") || fs.includes("ระหว่างการจัดส่ง");
      if (key === "เซ็นรับแล้ว") return fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ");
      if (key === "นำส่งไม่สำเร็จ") return fs.includes("ไม่สำเร็จ");
      if (key === "ส่งคืน") return (fs.includes("ส่งคืน") || fs.includes("ส่งกลับ")) && !fs.includes("สำเร็จ");
      if (key === "คืนสำเร็จ") return fs.includes("คืนสำเร็จ");
      if (key === "OTHER") return !KNOWN_KEYS.some(k => matchStatus(fs, k));
      return fs.includes(key);
    };

    const filtered = useMemo(() => {
      let list = tracked;
      if (rptShop) list = list.filter(p => p.shop_id === rptShop);
      if (rptFilter !== "ALL") {
        if (rptFilter === "สร้างรายการ") list = list.filter(p => !p.flash_status || p.flash_status === "" || p.flash_status === "สร้างรายการ");
        else if (rptFilter === "RETURN_ALL") list = list.filter(p => RETURN_STATUSES.some(s => (p.flash_status || "").includes(s)));
        else if (rptFilter === "OTHER") list = list.filter(p => p.flash_status && p.flash_status !== "สร้างรายการ" && !KNOWN_KEYS.some(k => matchStatus(p.flash_status, k)));
        else if (rptFilter.startsWith("EXACT::")) list = list.filter(p => (p.flash_status || "") === rptFilter.slice(7));
        else list = list.filter(p => matchStatus(p.flash_status, rptFilter));
      }
      if (rptSearch) {
        const q = rptSearch.toLowerCase();
        list = list.filter(p => (p.receiver_name || "").toLowerCase().includes(q) || (p.receiver_phone || "").includes(q) || (p.flash_pno || "").toLowerCase().includes(q) || (p.flash_detail || "").toLowerCase().includes(q));
      }
      return list;
    }, [tracked, rptFilter, rptShop, rptSearch]);

    const rptPaged = filtered.slice(rptPage * RPT_PER, (rptPage + 1) * RPT_PER);
    const rptTotalPages = Math.ceil(filtered.length / RPT_PER);

    // นับแยกสถานะ — รอบเดียว O(n) แทน 11 รอบ
    const statusCounts = useMemo(() => {
      const list = rptShop ? tracked.filter(p => p.shop_id === rptShop) : tracked;
      const counts = { ALL: list.length, "สร้างรายการ": 0, "รับพัสดุแล้ว": 0, "ขนส่ง": 0, "กำลังจัดส่ง": 0, "เซ็นรับแล้ว": 0, RETURN_ALL: 0, "นำส่งไม่สำเร็จ": 0, "ส่งคืน": 0, "คืนสำเร็จ": 0, OTHER: 0 };
      for (const p of list) {
        const fs = p.flash_status;
        if (!fs || fs === "" || fs === "สร้างรายการ") { counts["สร้างรายการ"]++; }
        else if (matchStatus(fs, "เซ็นรับแล้ว")) { counts["เซ็นรับแล้ว"]++; }
        else if (matchStatus(fs, "ขนส่ง")) { counts["ขนส่ง"]++; }
        else if (matchStatus(fs, "รับพัสดุแล้ว")) { counts["รับพัสดุแล้ว"]++; }
        else if (matchStatus(fs, "กำลังจัดส่ง")) { counts["กำลังจัดส่ง"]++; }
        else if (matchStatus(fs, "คืนสำเร็จ")) { counts["คืนสำเร็จ"]++; counts.RETURN_ALL++; }
        else if (matchStatus(fs, "นำส่งไม่สำเร็จ")) { counts["นำส่งไม่สำเร็จ"]++; counts.RETURN_ALL++; }
        else if (matchStatus(fs, "ส่งคืน")) { counts["ส่งคืน"]++; counts.RETURN_ALL++; }
        else { counts.OTHER++; }
      }
      return counts;
    }, [tracked, rptShop]);

    // แตกสถานะ Flash จริงทุกตัวที่ไม่เข้ากลุ่มหลัก → แสดงเป็นการ์ดของตัวเอง (ให้ตรงกับ Flash ครบทุกสถานะ)
    const otherStatusList = useMemo(() => {
      const list = rptShop ? tracked.filter(p => p.shop_id === rptShop) : tracked;
      const m = {};
      for (const p of list) {
        const fs = p.flash_status;
        if (!fs || fs === "สร้างรายการ") continue;
        if (!KNOWN_KEYS.some(k => matchStatus(fs, k))) m[fs] = (m[fs] || 0) + 1;
      }
      return Object.entries(m).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    }, [tracked, rptShop]);

    const getStatusStyle = (fs) => {
      const map = {
        "รับพัสดุแล้ว": { bg: "#e0f2fe", color: "#0369a1" },
        "อยู่ในระบบขนส่ง": { bg: "#ede9fe", color: "#6d28d9" },
        "กำลังจัดส่ง": { bg: "#dbeafe", color: "#1d4ed8" },
        "เซ็นรับแล้ว": { bg: "#d1fae5", color: "#065f46" },
        "ส่งคืน": { bg: "#fee2e2", color: "#991b1b" },
        "คืนสำเร็จ": { bg: "#f3f4f6", color: "#374151" },
      };
      return map[fs] || { bg: "#fef3c7", color: "#92400e" };
    };

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#111" }}>🚚 รายงานสถานะพัสดุ Flash</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>ติดตามสถานะขนส่งแบบเรียลไทม์ — อัพเดตอัตโนมัติทุก ~2 นาที (ระบบหลังบ้าน)</p>
          <div style={{ marginTop: 12, padding: "10px 16px", background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca", fontSize: 12, color: "#7f1d1d", display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>↩️ ตีกลับทั้งหมด</span><span>= รวมทุกสถานะตีกลับ</span>
            <span style={{ borderLeft: "1px solid #fca5a5", paddingLeft: 12 }}>❌ <b>นำส่งไม่สำเร็จ</b> = ส่งไม่ได้ (ไม่มีคนรับ/ปฏิเสธ/ที่อยู่ผิด)</span>
            <span style={{ borderLeft: "1px solid #fca5a5", paddingLeft: 12 }}>🔄 <b>กำลังส่งคืน</b> = พัสดุกำลังส่งกลับ</span>
            <span style={{ borderLeft: "1px solid #fca5a5", paddingLeft: 12 }}>📦 <b>คืนสำเร็จ</b> = ส่งคืนถึงผู้ส่งแล้ว</span>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
          {FLASH_TABS.map(t => {
            const cnt = statusCounts[t.key];
            const active = rptFilter === t.key;
            return (
              <div key={t.key} onClick={() => { setRptFilter(t.key); setRptPage(0); }} style={{
                background: active ? t.color : "#fff", color: active ? "#fff" : "#111",
                borderRadius: 12, padding: "14px 16px", border: active ? "none" : "1px solid #e5e7eb",
                cursor: "pointer", transition: "all .15s",
              }}>
                <div style={{ fontSize: 11, opacity: active ? .85 : .6, marginBottom: 4 }}>{t.icon} {t.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{cnt}</div>
              </div>
            );
          })}
          {otherStatusList.map(o => {
            const key = "EXACT::" + o.label;
            const active = rptFilter === key;
            return (
              <div key={key} title="สถานะจริงจาก Flash" onClick={() => { setRptFilter(key); setRptPage(0); }} style={{
                background: active ? "#0d9488" : "#fff", color: active ? "#fff" : "#111",
                borderRadius: 12, padding: "14px 16px", border: active ? "none" : "1px dashed #5eead4",
                cursor: "pointer", transition: "all .15s",
              }}>
                <div style={{ fontSize: 11, opacity: active ? .85 : .6, marginBottom: 4 }}>🏷️ {o.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{o.count}</div>
              </div>
            );
          })}
        </div>

        {/* Search + Filter */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, position: "relative", minWidth: 200 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: .4 }}>🔍</span>
            <input value={rptSearch} onChange={e => { setRptSearch(e.target.value); setRptPage(0); }} placeholder="ค้นหา ชื่อ, เบอร์, เลข Tracking..." style={{ width: "100%", padding: "10px 12px 10px 36px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, outline: "none", fontFamily: "inherit" }} />
          </div>
          {shops?.length > 0 && (
            <select value={rptShop} onChange={e => { setRptShop(e.target.value); setRptPage(0); }} style={{ padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontFamily: "inherit", fontWeight: 600, color: rptShop ? "#dc2626" : "#6b7280" }}>
              <option value="">🏪 ทุกร้าน</option>
              {shops.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button onClick={loadParcels} style={{ padding: "10px 16px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>🔄 รีเฟรช</button>
          <button onClick={() => {
            const data = filtered;
            if (!data.length) { uiAlert("ไม่มีข้อมูลที่จะ Export"); return; }
            const bom = "\uFEFF";
            const headers = ["ลำดับ","วันที่","ลูกค้า","เบอร์โทร","เลข Tracking","Sort Code","สถานะ Flash","รายละเอียดล่าสุด","อัพเดตล่าสุด","สถานะระบบ","COD","ยอด COD","ร้านค้า","ที่อยู่","ตำบล","อำเภอ","จังหวัด","รหัสไปรษณีย์","หมายเหตุ"];
            const rows = data.map((p, i) => {
              const shop = shops?.find(s => s.id === p.shop_id);
              return [i+1, new Date(p.created_at).toLocaleString("th-TH"), p.receiver_name, p.receiver_phone, p.flash_pno, p.flash_sort_code||"", p.flash_status||"สร้างรายการ", p.flash_detail||"", p.flash_updated_at ? new Date(p.flash_updated_at).toLocaleString("th-TH") : "", p.status, p.cod_enabled?"ใช่":"ไม่", p.cod_amount||0, shop?.name||"", p.receiver_address, p.receiver_subdistrict, p.receiver_district, p.receiver_province, p.receiver_postal, p.remark||""];
            });
            const csv = bom + [headers, ...rows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `flash-status-${rptFilter === "ALL" ? "ทั้งหมด" : rptFilter}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
          }} style={{ padding: "10px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>📤 Export ({filtered.length})</button>
        </div>

        {/* Table */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
          {!rptPaged.length ? (
            <div style={{ padding: 50, textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontSize: 36 }}>📭</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>ไม่พบพัสดุในสถานะนี้</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                    {["#", "วันที่", "ลูกค้า", "เบอร์โทร", "เลข Tracking", "Sort Code", "สถานะ Flash", "รายละเอียดล่าสุด", "อัพเดต", "สถานะระบบ", ...(perm.viewCOD ? ["COD"] : []), "ร้านค้า"].map((h, i) => (
                      <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#6b7280", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rptPaged.map((p, i) => {
                    const fs = p.flash_status || "สร้างรายการ";
                    const fStyle = getStatusStyle(fs);
                    const sysStatus = { draft: "📝 เตรียม", created: "✅ สร้างเลข", printed: "🖨️ ปริ้น", cancelled: "❌ ยกเลิก" }[p.status] || p.status;
                    const shop = shops?.find(s => s.id === p.shop_id);
                    const d = new Date(p.created_at);
                    return (
                      <tr key={p.id} style={{ borderBottom: "1px solid #f3f4f6", background: i % 2 ? "#fafafa" : "#fff" }} onClick={() => setViewParcel(p)}>
                        <td style={{ padding: "9px 12px", color: "#9ca3af", fontSize: 11 }}>{rptPage * RPT_PER + i + 1}</td>
                        <td style={{ padding: "9px 12px", fontSize: 12, whiteSpace: "nowrap" }}>{d.toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</td>
                        <td style={{ padding: "9px 12px", fontWeight: 600, cursor: "pointer", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.receiver_name}</td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 12 }}>{p.receiver_phone}</td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 12, color: "#0ea5e9", fontWeight: 600 }}>{p.flash_pno}</td>
                        <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>{p.flash_sort_code || "—"}</td>
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: fStyle.bg, color: fStyle.color, whiteSpace: "nowrap" }}>{fs}</span>
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 11, color: "#374151", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.flash_detail || ""}>{p.flash_detail || "—"}</td>
                        <td style={{ padding: "9px 12px", fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>{p.flash_updated_at ? new Date(p.flash_updated_at).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                        <td style={{ padding: "9px 12px", fontSize: 12 }}>{sysStatus}</td>
                        {perm.viewCOD && <td style={{ padding: "9px 12px", fontWeight: 700, color: p.cod_enabled ? "#b45309" : "#d1d5db" }}>{p.cod_enabled ? `฿${Number(p.cod_amount || 0).toLocaleString()}` : "—"}</td>}
                        <td style={{ padding: "9px 12px", fontSize: 12, color: "#6b7280" }}>{shop?.name || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {rptTotalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, padding: 12, borderTop: "1px solid #f3f4f6" }}>
              <button disabled={!rptPage} onClick={() => setRptPage(p => p - 1)} style={{ padding: "6px 14px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: !rptPage ? "not-allowed" : "pointer", opacity: !rptPage ? .4 : 1, fontSize: 13 }}>◀</button>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{rptPage + 1}/{rptTotalPages} ({filtered.length})</span>
              <button disabled={rptPage >= rptTotalPages - 1} onClick={() => setRptPage(p => p + 1)} style={{ padding: "6px 14px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", cursor: rptPage >= rptTotalPages - 1 ? "not-allowed" : "pointer", opacity: rptPage >= rptTotalPages - 1 ? .4 : 1, fontSize: 13 }}>▶</button>
              <select value={rptPerPage} onChange={e => { setRptPerPage(Number(e.target.value)); setRptPage(0); }} style={{ padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, fontFamily: "inherit", color: "#6b7280" }}>
                <option value={100}>100 / หน้า</option>
                <option value={300}>300 / หน้า</option>
                <option value={500}>500 / หน้า</option>
              </select>
            </div>
          )}
        </div>

        {/* Summary Footer */}
        <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ background: "#ecfdf5", borderRadius: 10, padding: "12px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 11, color: "#065f46", marginBottom: 2 }}>✅ จัดส่งสำเร็จ</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#059669" }}>{statusCounts["เซ็นรับแล้ว"]}</div>
          </div>
          <div style={{ background: "#dbeafe", borderRadius: 10, padding: "12px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 11, color: "#1e40af", marginBottom: 2 }}>🚛 อยู่ระหว่างจัดส่ง</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#2563eb" }}>{statusCounts["รับพัสดุแล้ว"] + statusCounts["ขนส่ง"] + statusCounts["กำลังจัดส่ง"]}</div>
          </div>
          <div style={{ background: "#fee2e2", borderRadius: 10, padding: "12px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 11, color: "#991b1b", marginBottom: 2 }}>↩️ ส่งคืน/คืนสำเร็จ</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#dc2626" }}>{statusCounts["ส่งคืน"] + statusCounts["คืนสำเร็จ"]}</div>
          </div>
          <div style={{ background: "#fef3c7", borderRadius: 10, padding: "12px 20px", flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 11, color: "#92400e", marginBottom: 2 }}>📝 รอดำเนินการ</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#d97706" }}>{statusCounts["สร้างรายการ"]}</div>
          </div>
        </div>
      </div>
    );
  };

  // ═══ DASHBOARD PAGE ═══
  const DashboardPage = () => {
    const [prodPeriod, setProdPeriod] = useState("today");
    const today = new Date().toISOString().slice(0, 10);
    const todayParcels = parcels.filter(p => p.created_at?.slice(0, 10) === today);
    const todayStats = {
      total: todayParcels.length,
      draft: todayParcels.filter(p => p.status === "draft").length,
      created: todayParcels.filter(p => p.status === "created").length,
      printed: todayParcels.filter(p => p.status === "printed").length,
      cancelled: todayParcels.filter(p => p.status === "cancelled").length,
      cod: todayParcels.filter(p => p.cod_enabled).reduce((s, p) => s + Number(p.cod_amount || 0), 0),
    };
    // Flash status summary
    const flashStats = {
      noTracking: parcels.filter(p => !p.flash_pno && p.status !== "cancelled").length,
      waiting: parcels.filter(p => p.flash_status === "รับพัสดุแล้ว" || p.flash_status === "อยู่ในระบบขนส่ง" || p.flash_status === "กำลังจัดส่ง").length,
      delivered: parcels.filter(p => p.flash_status === "เซ็นรับแล้ว").length,
      returned: parcels.filter(p => p.flash_status === "ส่งคืน" || p.flash_status === "คืนสำเร็จ").length,
    };
    // Per-shop stats
    const shopStats = shops?.filter(s => s.is_active).map(s => {
      const sp = parcels.filter(p => p.shop_id === s.id);
      return { name: s.name, total: sp.length, cod: sp.filter(p => p.cod_enabled).reduce((a, p) => a + Number(p.cod_amount || 0), 0), draft: sp.filter(p => p.status === "draft").length, created: sp.filter(p => p.status === "created").length, printed: sp.filter(p => p.status === "printed").length };
    }) || [];
    const recentParcels = [...parcels].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
    const cardStyle = { background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "20px 24px" };
    const numStyle = (color) => ({ fontSize: 32, fontWeight: 800, color, lineHeight: 1 });
    const labelStyle = { fontSize: 13, color: "#6b7280", marginTop: 6, fontWeight: 500 };

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#111" }}>📊 Dashboard</h2>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#6b7280" }}>สรุปภาพรวมระบบจัดการพัสดุ — {new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>

        {/* 🔔 แจ้งเตือน: พัสดุยังไม่เข้าระบบ Flash */}
        {notInFlash.length > 0 && (
          <div style={{ marginBottom: 20, background: "linear-gradient(135deg,#fef2f2,#fff7ed)", border: "1.5px solid #fca5a5", borderRadius: 14, padding: "16px 20px", cursor: "pointer" }} onClick={() => setShowNotifDetail(v => !v)}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 24 }}>🔔</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#dc2626" }}>พัสดุยังไม่เข้าระบบ Flash {notInFlash.length} รายการ</div>
                  <div style={{ fontSize: 12, color: "#92400e", marginTop: 2 }}>มีเลข Tracking แล้วแต่ Flash ยังไม่ได้รับ (ยังไม่ได้ยิง) — กดเพื่อดูรายละเอียด</div>
                </div>
              </div>
              <span style={{ fontSize: 18, color: "#dc2626", transition: "transform .2s", transform: showNotifDetail ? "rotate(180deg)" : "" }}>▼</span>
            </div>
            {showNotifDetail && (
              <div style={{ marginTop: 14, maxHeight: 320, overflowY: "auto" }} onClick={e => e.stopPropagation()}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#fde6e6" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>#</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>ชื่อผู้รับ</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>เบอร์</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>Tracking</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>ร้านค้า</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>สร้างเมื่อ</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>ค้างมา</th>
                  </tr></thead>
                  <tbody>{notInFlash.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((p, i) => {
                    const days = Math.floor((Date.now() - new Date(p.created_at)) / 86400000);
                    const shop = shops?.find(s => s.id === p.shop_id);
                    return (
                      <tr key={p.id} style={{ borderBottom: "1px solid #fde6e6", background: days >= 3 ? "#fff1f1" : i % 2 ? "#fffbfa" : "#fff" }} onClick={() => setViewParcel(p)}>
                        <td style={{ padding: "7px 10px", color: "#9ca3af" }}>{i + 1}</td>
                        <td style={{ padding: "7px 10px", fontWeight: 600 }}>{p.receiver_name}</td>
                        <td style={{ padding: "7px 10px" }}>{p.receiver_phone}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: 11, color: "#4f46e5" }}>{p.flash_pno}</td>
                        <td style={{ padding: "7px 10px" }}>{shop?.name || "—"}</td>
                        <td style={{ padding: "7px 10px" }}>{new Date(p.created_at).toLocaleDateString("th-TH")}</td>
                        <td style={{ padding: "7px 10px" }}>{days >= 3 ? <span style={{ background: "#dc2626", color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>{days} วัน ⚠️</span> : days >= 1 ? <span style={{ background: "#f59e0b", color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>{days} วัน</span> : <span style={{ color: "#9ca3af" }}>วันนี้</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ROW 1 — Today Summary */}
        <div style={{ marginBottom: 12, fontSize: 15, fontWeight: 700, color: "#374151" }}>📅 วันนี้</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
          {[
            { label: "ทั้งหมด", value: todayStats.total, color: "#4f46e5", bg: "#eef2ff" },
            { label: "เตรียมส่ง", value: todayStats.draft, color: "#d97706", bg: "#fffbeb" },
            { label: "สร้างเลขแล้ว", value: todayStats.created, color: "#059669", bg: "#ecfdf5" },
            { label: "ปริ้นแล้ว", value: todayStats.printed, color: "#7c3aed", bg: "#f5f3ff" },
            { label: "ยกเลิก", value: todayStats.cancelled, color: "#dc2626", bg: "#fef2f2" },
            ...(perm.viewCOD ? [{ label: "COD วันนี้", value: `฿${todayStats.cod.toLocaleString()}`, color: "#b45309", bg: "#fffbeb" }] : []),
          ].map((c, i) => (
            <div key={i} style={{ ...cardStyle, background: c.bg, borderColor: "transparent" }}>
              <div style={numStyle(c.color)}>{c.value}</div>
              <div style={labelStyle}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* ROW 2 — All Time + Flash Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
          {/* All Stats */}
          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: "#111" }}>📦 พัสดุทั้งหมด</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div><div style={numStyle("#111")}>{stats.total}</div><div style={labelStyle}>ทั้งหมด</div></div>
              <div><div style={numStyle("#059669")}>{stats.created + stats.printed}</div><div style={labelStyle}>สร้างเลขแล้ว</div></div>
              <div><div style={numStyle("#d97706")}>{stats.draft}</div><div style={labelStyle}>รอสร้างเลข</div></div>
              {perm.viewCOD && <div><div style={numStyle("#7c3aed")}>฿{stats.codTotal.toLocaleString()}</div><div style={labelStyle}>COD รวม</div></div>}
            </div>
          </div>

          {/* Flash Tracking Status */}
          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: "#111" }}>🚚 สถานะขนส่ง Flash</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div><div style={numStyle("#f59e0b")}>{flashStats.noTracking}</div><div style={labelStyle}>ยังไม่มีเลข</div></div>
              <div><div style={numStyle("#3b82f6")}>{flashStats.waiting}</div><div style={labelStyle}>กำลังจัดส่ง</div></div>
              <div><div style={numStyle("#10b981")}>{flashStats.delivered}</div><div style={labelStyle}>เซ็นรับแล้ว</div></div>
              <div><div style={numStyle("#ef4444")}>{flashStats.returned}</div><div style={labelStyle}>ส่งคืน</div></div>
            </div>
          </div>
        </div>

        {/* ROW 3 — Per-shop + Recent */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Per Shop */}
          {shopStats.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: "#111" }}>🏪 แยกตามร้านค้า</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {shopStats.map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#f9fafb", borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{s.total} รายการ | เตรียม {s.draft} | สร้างเลข {s.created} | ปริ้น {s.printed}</div>
                    </div>
                    {perm.viewCOD && <div style={{ fontSize: 15, fontWeight: 800, color: "#b45309" }}>฿{s.cod.toLocaleString()}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Parcels */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>🕐 รายการล่าสุด</div>
              <button onClick={() => setActivePage("parcels")} style={{ fontSize: 12, color: "#4f46e5", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>ดูทั้งหมด →</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentParcels.map((p, i) => {
                const st = { draft: { bg: "#fef3c7", color: "#92400e", text: "เตรียม" }, created: { bg: "#d1fae5", color: "#065f46", text: "สร้างเลข" }, printed: { bg: "#e0e7ff", color: "#3730a3", text: "ปริ้นแล้ว" }, cancelled: { bg: "#fee2e2", color: "#991b1b", text: "ยกเลิก" } }[p.status] || { bg: "#f3f4f6", color: "#374151", text: p.status };
                return (
                  <div key={i} onClick={() => setViewParcel(p)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: i % 2 === 0 ? "#f9fafb" : "#fff" }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{p.receiver_name}</span>
                      <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>{p.receiver_phone}</span>
                    </div>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>{st.text}</span>
                  </div>
                );
              })}
              {!recentParcels.length && <div style={{ textAlign: "center", padding: 20, color: "#9ca3af" }}>ยังไม่มีพัสดุ</div>}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: "#374151" }}>⚡ เข้าถึงด่วน</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {perm.create && <button onClick={() => { setActivePage("parcels"); setTimeout(() => { setEditParcel(null); setShowForm(true); }, 100); }} style={{ padding: "12px 24px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>＋ สร้างพัสดุ</button>}
            <button onClick={() => setActivePage("import")} style={{ padding: "12px 24px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📥 Import ไฟล์</button>
            <button onClick={() => setActivePage("export")} style={{ padding: "12px 24px", background: "#059669", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📤 Export ข้อมูล</button>
            <button onClick={() => setActivePage("parcels")} style={{ padding: "12px 24px", background: "#fff", color: "#374151", border: "1.5px solid #d1d5db", borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📦 ดูรายการทั้งหมด</button>
          </div>
        </div>

        {/* แยก COD / ไม่ COD */}
        {perm.viewCOD && (() => {
          const act = parcels.filter(p => p.status !== "cancelled");
          const cod = act.filter(p => p.cod_enabled && Number(p.cod_amount) > 0);
          const nocod = act.filter(p => !(p.cod_enabled && Number(p.cod_amount) > 0));
          const codSum = cod.reduce((s, p) => s + Number(p.cod_amount || 0), 0);
          const nocodSum = nocod.reduce((s, p) => s + Number(p.sale_price || 0), 0);
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 8 }}>
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", borderTop: "4px solid #f59e0b", padding: "18px 22px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", marginBottom: 8 }}>💰 พัสดุเก็บเงินปลายทาง (COD)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#d97706" }}>฿{codSum.toLocaleString()}</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{cod.length} ใบ</div>
              </div>
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", borderTop: "4px solid #0ea5e9", padding: "18px 22px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0369a1", marginBottom: 8 }}>📦 พัสดุไม่เก็บเงิน (ไม่ COD / โอนแล้ว)</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#0284c7" }}>{nocod.length} ใบ</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>ยอดขายรวม ฿{nocodSum.toLocaleString()}</div>
              </div>
            </div>
          );
        })()}

        {/* ── กราฟ ── */}
        {(() => {
          const CARD = { background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", padding: "16px 18px" };
          const CHTITLE = { fontSize: 13, fontWeight: 800, color: "#334155", marginBottom: 8 };
          const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d.toISOString().slice(0, 10); });
          const dl = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };
          const volByDay = days.map(d => parcels.filter(p => p.created_at?.slice(0, 10) === d).length);
          const codByDay = days.map(d => parcels.filter(p => p.created_at?.slice(0, 10) === d && p.cod_enabled).reduce((s, p) => s + Number(p.cod_amount || 0), 0));
          const isDeliv = (fs) => !!fs && (fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ"));
          const isFail = (fs) => !!fs && (fs.includes("ไม่สำเร็จ") || fs.includes("ตีกลับ") || fs.includes("คืน") || fs.includes("ส่งกลับ"));
          const tracked = parcels.filter(p => p.flash_pno && p.status !== "cancelled");
          const delivered = tracked.filter(p => isDeliv(p.flash_status)).length;
          const failed = tracked.filter(p => isFail(p.flash_status)).length;
          const finished = delivered + failed;
          const successRate = finished > 0 ? Math.round((delivered / finished) * 100) : 0;
          const provCount = {};
          parcels.forEach(p => { if (p.receiver_province) provCount[p.receiver_province] = (provCount[p.receiver_province] || 0) + 1; });
          const topProv = Object.entries(provCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
          const maxVol = Math.max(1, ...volByDay), maxCod = Math.max(1, ...codByDay), maxProv = Math.max(1, ...topProv.map(p => p[1]));
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16, marginTop: 20 }}>
              <div style={CARD}>
                <div style={CHTITLE}>📦 ยอดส่งรายวัน (14 วัน)</div>
                <svg viewBox="0 0 340 140" style={{ width: "100%" }}>
                  {volByDay.map((v, i) => { const bh = (v / maxVol) * 95; return <g key={i}><rect x={6 + i * 24} y={120 - bh} width={16} height={bh} rx={3} fill="#6366f1" /><text x={14 + i * 24} y={134} fontSize="7" fill="#94a3b8" textAnchor="middle">{dl(days[i])}</text>{v > 0 && <text x={14 + i * 24} y={115 - bh} fontSize="7.5" fill="#6366f1" textAnchor="middle" fontWeight="700">{v}</text>}</g>; })}
                </svg>
              </div>
              <div style={CARD}>
                <div style={CHTITLE}>✅ อัตราส่งสำเร็จ</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: "8px 0" }}>
                  <svg viewBox="0 0 100 100" style={{ width: 110, height: 110 }}>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#fee2e2" strokeWidth="13" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="13" strokeDasharray={`${successRate * 2.513} 999`} strokeLinecap="round" transform="rotate(-90 50 50)" />
                    <text x="50" y="52" fontSize="20" fontWeight="800" fill="#10b981" textAnchor="middle">{successRate}%</text>
                    <text x="50" y="65" fontSize="7" fill="#94a3b8" textAnchor="middle">สำเร็จ</text>
                  </svg>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.9 }}>
                    <div>✅ สำเร็จ: <b style={{ color: "#10b981" }}>{delivered}</b></div>
                    <div>❌ มีปัญหา: <b style={{ color: "#dc2626" }}>{failed}</b></div>
                    <div>🚚 กำลังส่ง: <b style={{ color: "#f59e0b" }}>{Math.max(0, tracked.length - finished)}</b></div>
                  </div>
                </div>
              </div>
              <div style={CARD}>
                <div style={CHTITLE}>💰 แนวโน้ม COD (14 วัน)</div>
                <svg viewBox="0 0 340 140" style={{ width: "100%" }}>
                  {codByDay.map((v, i) => { const bh = (v / maxCod) * 100; return <g key={i}><rect x={6 + i * 24} y={120 - bh} width={16} height={bh} rx={3} fill="#10b981" /><text x={14 + i * 24} y={134} fontSize="7" fill="#94a3b8" textAnchor="middle">{dl(days[i])}</text></g>; })}
                </svg>
                <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right" }}>รวม ฿{codByDay.reduce((a, b) => a + b, 0).toLocaleString()}</div>
              </div>
              <div style={CARD}>
                <div style={CHTITLE}>📍 จังหวัดปลายทางยอดนิยม</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                  {topProv.length === 0 && <div style={{ fontSize: 12, color: "#cbd5e1", textAlign: "center", padding: 20 }}>ยังไม่มีข้อมูล</div>}
                  {topProv.map(([prov, cnt], i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 92, fontSize: 12, color: "#475569", textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{prov}</div>
                      <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 6, height: 18, overflow: "hidden" }}><div style={{ width: `${(cnt / maxProv) * 100}%`, height: "100%", background: "#8b5cf6", borderRadius: 6 }} /></div>
                      <div style={{ width: 34, fontSize: 12, fontWeight: 700, color: "#8b5cf6" }}>{cnt}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* สรุปสินค้า จาก Note */}
        {(() => {
          const productType = (remark) => {
            if (!remark) return "(ไม่ระบุ)";
            let s = String(remark).split("ปลายทาง")[0].trim();
            s = s.replace(/[0-9]+\s*$/, "").trim();
            return s || "(ไม่ระบุ)";
          };
          const now2 = new Date();
          const inPeriod = (p) => {
            if (prodPeriod === "all") return true;
            const d = new Date(p.created_at);
            if (prodPeriod === "today") return p.created_at?.slice(0, 10) === today;
            if (prodPeriod === "7days") { const s = new Date(now2); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0); return d >= s; }
            if (prodPeriod === "month") { const s = new Date(now2.getFullYear(), now2.getMonth(), 1); return d >= s; }
            return true;
          };
          const byType = {};
          for (const p of parcels) {
            if (p.status === "cancelled" || !inPeriod(p)) continue;
            const t = productType(p.remark);
            if (!byType[t]) byType[t] = { count: 0, cod: 0, sales: 0 };
            byType[t].count++;
            if (p.cod_enabled) byType[t].cod += Number(p.cod_amount || 0);
            byType[t].sales += Number(p.sale_price || 0);
          }
          const allRows = Object.entries(byType).sort((a, b) => b[1].count - a[1].count);
          const rows = allRows.slice(0, 5);
          const max = Math.max(1, ...rows.map(r => r[1].count));
          const periods = [["today", "วันนี้"], ["7days", "7 วัน"], ["month", "เดือนนี้"], ["all", "ทั้งหมด"]];
          return (
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "20px 24px", marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>📦 สินค้าขายดี <span style={{ fontWeight: 400, fontSize: 12, color: "#9ca3af" }}>Top 5 (จาก Note)</span></div>
                <div style={{ display: "flex", gap: 6 }}>
                  {periods.map(([k, l]) => (
                    <button key={k} onClick={() => setProdPeriod(k)} style={{ padding: "5px 12px", borderRadius: 8, border: prodPeriod === k ? "none" : "1px solid #e2e8f0", background: prodPeriod === k ? "#4f46e5" : "#fff", color: prodPeriod === k ? "#fff" : "#475569", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{l}</button>
                  ))}
                </div>
              </div>
              {rows.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>ไม่มีข้อมูลในช่วงนี้</div>}
              {rows.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#9ca3af", fontWeight: 700 }}>
                    <div style={{ width: 120 }}>สินค้า</div><div style={{ flex: 1 }}></div>
                    <div style={{ width: 44, textAlign: "right" }}>จำนวน</div>
                    <div style={{ width: 92, textAlign: "right" }}>ยอดขาย</div>
                    <div style={{ width: 92, textAlign: "right" }}>COD</div>
                  </div>
                  {rows.map(([t, s], i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 120, fontSize: 13, fontWeight: 700, color: "#374151", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {t}</div>
                      <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 6, height: 20, overflow: "hidden" }}>
                        <div style={{ width: `${(s.count / max) * 100}%`, height: "100%", background: "#6366f1", borderRadius: 6 }} />
                      </div>
                      <div style={{ width: 44, fontSize: 14, fontWeight: 800, color: "#4f46e5", textAlign: "right" }}>{s.count}</div>
                      <div style={{ width: 92, fontSize: 12, color: "#15803d", fontWeight: 700, textAlign: "right" }}>฿{s.sales.toLocaleString()}</div>
                      <div style={{ width: 92, fontSize: 12, color: "#c2410c", textAlign: "right" }}>฿{s.cod.toLocaleString()}</div>
                    </div>
                  ))}
                  {allRows.length > 5 && <div style={{ fontSize: 11, color: "#cbd5e1", textAlign: "center", marginTop: 4 }}>+ อีก {allRows.length - 5} ประเภท (ดูทั้งหมดในหน้าสรุปรายงาน)</div>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Realtime Indicator */}
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
          🟢 Realtime — อัพเดตอัตโนมัติทุก 2 วินาที
        </div>
      </div>
    );
  };

  // ═══ IMPORT PAGE ═══
  const ImportPage = () => (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📥 Import ไฟล์สร้างเลขพัสดุ</h2>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>อัพโหลดไฟล์ CSV / Excel → ตรวจสอบข้อมูล → สร้างออเดอร์ + เลขพัสดุ Flash</p>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <ImportModal user={user} shops={shops} onClose={() => setActivePage("parcels")} onSave={() => { setActivePage("parcels"); loadParcels(); }} inline />
      </div>
    </div>
  );

  // ═══ SHOPS PAGE — inline ═══
  const ShopsPage = () => <div style={{ padding: 24 }}><ShopManagement onClose={() => {}} onUpdate={loadShops} isDemo={isDemo} inline /></div>;

  // ═══ EXPORT PAGE ═══
  // ═══ UPSELL PAGE ═══

  const UpsellPage = () => {

    const TABS = [
      { key: "ALL", label: "ทั้งหมด", icon: "📋", color: "#475569" },
      { key: "pending", label: "รอดำเนินการ", icon: "⏳", color: "#f59e0b" },
      { key: "success", label: "อัพเซลล์สำเร็จ", icon: "✅", color: "#059669" },
      { key: "cancelled", label: "ยกเลิก", icon: "❌", color: "#dc2626" },
    ];

    const filtered = useMemo(() => {
      let list = upsellData.filter(p => !p.parcel_created);
      if (upsellFilter !== "ALL") list = list.filter(p => p.status === upsellFilter);
      if (upsellSearch) { const q = upsellSearch.toLowerCase(); list = list.filter(p => [p.receiver_name, p.receiver_phone, p.remark].some(v => (v || "").toLowerCase().includes(q))); }
      return list;
    }, [upsellData, upsellFilter, upsellSearch]);

    // Import Excel
    const handleFile = async (file) => {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (data.length < 2) { uiAlert("ไม่พบข้อมูลในไฟล์"); return; }
      let headerIdx = 0;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        const filledCols = row.filter((v, j) => j > 0 && v && String(v).trim()).length;
        const rowText = row.map(String).join("|").toLowerCase();
        if (filledCols >= 3 && (rowText.includes("mobile") || rowText.includes("name") || rowText.includes("ชื่อ"))) { headerIdx = i; break; }
      }
      const parsed = [];
      for (let i = headerIdx + 1; i < data.length; i++) {
        const r = data[i];
        if (!r || !r[0]) continue;
        const phone = String(r[0] || "").replace(/[^0-9]/g, "");
        const name = String(r[1] || "");
        const address = String(r[2] || "");
        const subdistrict = String(r[3] || "");
        const district = String(r[4] || "");
        const postal = String(r[5] || "").replace(/[^0-9]/g, "");
        const codAmount = parseFloat(r[10]) || 0;
        const remark = String(r[11] || "");
        if (!phone && !name) continue;
        let province = "";
        let autoDistrict = district;
        let autoSubdistrict = subdistrict;
        if (postal && ADDR_DB[postal]) {
          const addrList = ADDR_DB[postal];
          province = addrList[0]?.p || "";
          if (!autoDistrict && addrList.length === 1) autoDistrict = addrList[0].d;
          if (!autoSubdistrict && addrList.length === 1) autoSubdistrict = addrList[0].s;
          if (district) { const match = addrList.find(a => a.d === district); if (match) { province = match.p; if (!autoSubdistrict) autoSubdistrict = match.s; } }
        }
        parsed.push({
          receiver_phone: phone.startsWith("0") ? phone : "0" + phone,
          receiver_name: name, receiver_address: address,
          receiver_subdistrict: autoSubdistrict, receiver_district: autoDistrict,
          receiver_province: province, receiver_postal: postal,
          customer_fb_line: String(r[6] || ""), item_desc: String(r[7] || ""),
          sale_person: String(r[8] || ""), sale_price: parseFloat(r[9]) || 0,
          cod_enabled: codAmount > 0, cod_amount: codAmount,
          remark: remark, _selected: true,
        });
      }
      // แยกรายชื่อที่ไม่มีชื่อแอดมิน
      const valid = parsed.filter(r => r.sale_person && r.sale_person.trim());
      const rejected = parsed.filter(r => !r.sale_person || !r.sale_person.trim());
      setUpsellRows(valid);
      setUpsellRejected(rejected);
    };

    const handleImport = async () => {
      const selected = upsellRows.filter(r => r._selected);
      if (!selected.length) return;
      setUpsellImporting(true);
      let success = 0;
      for (let i = 0; i < selected.length; i++) {
        const r = selected[i];
        try {
          await sb.insert("fx_upsell", {
            receiver_name: r.receiver_name, receiver_phone: r.receiver_phone,
            receiver_address: r.receiver_address || "-",
            receiver_subdistrict: r.receiver_subdistrict || "",
            receiver_district: r.receiver_district || "",
            receiver_province: r.receiver_province || "",
            receiver_postal: r.receiver_postal || "",
            customer_fb_line: r.customer_fb_line || "",
            item_desc: r.item_desc || "",
            sale_person: r.sale_person || "",
            sale_price: r.sale_price || 0,
            remark: r.remark || "",
            cod_amount: r.cod_amount || 0, status: "pending",
            created_by: user.id, created_by_name: user.display_name,
          });
          success++;
        } catch {}
        setUpsellProgress(Math.round(((i + 1) / selected.length) * 100));
      }
      setUpsellImporting(false);
      setUpsellRows([]);
      showToast(`นำเข้า Upsell สำเร็จ ${success}/${selected.length} รายการ`);
      loadUpsell();
    };

    const updateStatus = async (item, newStatus) => {
      try {
        await sb.update("fx_upsell", item.id, { status: newStatus, upsell_by: user.display_name });
        setUpsellData(prev => prev.map(x => x.id === item.id ? { ...x, status: newStatus, upsell_by: user.display_name } : x));
        showToast(newStatus === "success" ? "อัพเซลล์สำเร็จ ✅" : "ยกเลิกแล้ว");
      } catch (e) { uiAlert(e.message); }
    };

    const createParcelFromUpsell = async (item, shopOverride) => {
      try {
        const shop = shopOverride || (upsellShop ? shops?.find(s => s.id === upsellShop) : null) || shops?.find(s => s.is_default) || shops?.[0];
        if (!shop) { uiAlert("กรุณาเลือกร้านค้าก่อน"); return false; }
        const parcelData = {
          parcel_no: "P" + Date.now().toString(36).toUpperCase(),
          status: "draft",
          sender_name: shop?.name || "", sender_phone: shop?.phone || "", sender_address: shop?.address || "",
          sender_province: shop?.province || "", sender_district: shop?.district || "",
          sender_subdistrict: shop?.subdistrict || "", sender_postal: shop?.postal || "",
          receiver_name: item.receiver_name, receiver_phone: item.receiver_phone,
          receiver_address: item.receiver_address || "-",
          receiver_subdistrict: item.receiver_subdistrict || "",
          receiver_district: item.receiver_district || "",
          receiver_province: item.receiver_province || "",
          receiver_postal: item.receiver_postal || "",
          weight: 1, quantity: 1,
          cod_enabled: Number(item.cod_amount) > 0,
          cod_amount: item.cod_amount || 0,
          remark: item.remark || "",
          customer_fb_line: item.customer_fb_line || "",
          item_desc: item.item_desc || "",
          sale_person: item.sale_person || "",
          sale_price: item.sale_price || 0,
          upsell_by: item.upsell_by || "",
          source: "upsell",
          created_by: user.id, created_by_name: user.display_name,
          shop_id: shop?.id || null,
        };
        await sb.insert("fx_parcels", parcelData);
        await sb.update("fx_upsell", item.id, { parcel_created: true });
        setUpsellData(prev => prev.map(x => x.id === item.id ? { ...x, parcel_created: true } : x));
        try { await sb.broadcastChange(); } catch {}
        showToast(`สร้างพัสดุ ${item.receiver_name} สำเร็จ → ไปหน้าจัดส่ง`);
        return true;
      } catch (e) { uiAlert("สร้างพัสดุไม่ได้: " + e.message); return false; }
    };

    const batchCreateParcels = async () => {
      if (!upsellShop && shops?.length > 1) { uiAlert("กรุณาเลือกร้านค้าก่อนสร้างพัสดุ"); return; }
      const targets = upsellData.filter(p => p.status !== "success" && p.status !== "cancelled" && !p.parcel_created);
      if (!targets.length) { uiAlert("ไม่มีรายการที่ต้องสร้างพัสดุ"); return; }
      const shop = upsellShop ? shops?.find(s => s.id === upsellShop) : shops?.find(s => s.is_default) || shops?.[0];
      if (!await uiConfirm(`สร้างพัสดุ ${targets.length} รายการ?\nร้านค้า: ${shop?.name || "ค่าเริ่มต้น"}`)) return;
      let success = 0;
      for (const item of targets) {
        try { await createParcelFromUpsell(item); success++; } catch {}
      }
      showToast(`สร้างพัสดุสำเร็จ ${success}/${targets.length} รายการ`);
      loadUpsell();
      loadParcels();
    };

    const exportUpsell = () => {
      const data = upsellSelected.size > 0 ? filtered.filter(p => upsellSelected.has(p.id)) : filtered;
      if (!data.length) { uiAlert("ไม่มีข้อมูล — เลือกรายชื่อหรือเปลี่ยนตัวกรอง"); return; }
      const bom = "\uFEFF";
      const headers = ["ลำดับ","ชื่อ","เบอร์","ที่อยู่","หมายเหตุ/สินค้า","ยอด","สถานะ","ดำเนินการโดย","วันที่สร้าง"];
      const rows = data.map((p, i) => {
        const addr = [p.receiver_address, p.receiver_subdistrict, p.receiver_district, p.receiver_province, p.receiver_postal].filter(Boolean).join(" ");
        return [i+1, p.receiver_name, p.receiver_phone, addr, p.remark, p.cod_amount||0, p.status==="success"?"สำเร็จ":p.status==="cancelled"?"ยกเลิก":"รอ", p.upsell_by||"", new Date(p.created_at).toLocaleString("th-TH")];
      });
      const csv = bom + [headers, ...rows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `upsell-${upsellFilter}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    };

    const I = { padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit" };

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>💰 Upsell</h2>
          {/* Popup แจ้งเตือนรายชื่อไม่มีแอดมิน */}
          {upsellRejected.length > 0 && (
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div style={{ background: "#fff", borderRadius: 20, maxWidth: 550, width: "100%", maxHeight: "80vh", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
                <div style={{ padding: "20px 24px", background: "linear-gradient(135deg,#fef2f2,#fff7ed)", borderBottom: "1px solid #fca5a5" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626" }}>⚠️ พบรายชื่อไม่มีชื่อแอดมิน</div>
                  <div style={{ fontSize: 13, color: "#92400e", marginTop: 4 }}>{upsellRejected.length} รายชื่อถูกแยกออก ไม่ import เพราะไม่มี SalesPerson</div>
                </div>
                <div style={{ padding: "16px 24px", maxHeight: 300, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "#fef2f2" }}>
                      {["#","ชื่อ","เบอร์","COD"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{upsellRejected.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #fee2e2" }}>
                        <td style={{ padding: "6px 10px", color: "#9ca3af" }}>{i + 1}</td>
                        <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.receiver_name}</td>
                        <td style={{ padding: "6px 10px" }}>{r.receiver_phone}</td>
                        <td style={{ padding: "6px 10px" }}>{r.cod_amount || 0}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{ padding: "16px 24px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => {
                    const bom = "\uFEFF";
                    const headers = ["MobileNo","Name","Address","SubDistrict","District","ZIP","FB/Line","SalesChannel","SalesPerson","SalePrice","COD","Remark"];
                    const csvRows = upsellRejected.map(r => [r.receiver_phone, r.receiver_name, r.receiver_address, r.receiver_subdistrict, r.receiver_district, r.receiver_postal, r.customer_fb_line, r.item_desc, "", r.sale_price, r.cod_amount, r.remark]);
                    const csv = bom + [headers, ...csvRows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
                    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `no-salesperson-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                  }} style={{ padding: "10px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📥 ดาวน์โหลด {upsellRejected.length} รายชื่อ</button>
                  <button onClick={() => setUpsellRejected([])} style={{ padding: "10px 20px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#64748b" }}>✕ ปิด</button>
                </div>
              </div>
            </div>
          )}
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "#64748b" }}>Import รายชื่อ → เลือกอัพเซลล์ → Export ผลลัพธ์</p>
        </div>

        {/* Import Section */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", marginBottom: 20, overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ padding: "10px 20px", background: "#f59e0b", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📥 Import Excel
              <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; }} />
            </label>
            <button onClick={() => {
              const bom = "\uFEFF";
              const headers = ["Mobile","Name","Address","Sub District","District","Zipcode","FB/LINE","Product","Sale","Sale Price","COD","Remark"];
              const sample = ["0812345678","สมชาย ใจดี","123/4 หมู่ 5","ในเมือง","เมืองพิษณุโลก","65000","fb:somchai","ครีมหน้าขาว","แอดมิน","390","390","ครีม 1 เซรั่ม 1"];
              const csv = bom + [headers.join(","), sample.join(",")].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "upsell-template.csv"; a.click();
            }} style={{ padding: "10px 20px", background: "#fff", color: "#f59e0b", border: "2px solid #f59e0b", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>📄 ดาวน์โหลดตัวอย่าง</button>
            {upsellRows.length > 0 && <span style={{ fontSize: 13, color: "#64748b" }}>พบ {upsellRows.length} รายการ</span>}
            {upsellRejected.length > 0 && <button onClick={() => {
              const bom = "\uFEFF";
              const headers = ["MobileNo","Name","Address","SubDistrict","District","ZIP","FB/Line","SalesChannel","SalesPerson","SalePrice","COD","Remark"];
              const csvRows = upsellRejected.map(r => [r.receiver_phone, r.receiver_name, r.receiver_address, r.receiver_subdistrict, r.receiver_district, r.receiver_postal, r.customer_fb_line, r.item_desc, "", r.sale_price, r.cod_amount, r.remark]);
              const csv = bom + [headers, ...csvRows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
              const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `no-salesperson-${new Date().toISOString().slice(0,10)}.csv`; a.click();
            }} style={{ padding: "8px 14px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>⚠️ ดาวน์โหลด {upsellRejected.length} รายชื่อไม่มีแอดมิน</button>}
            {upsellRows.length > 0 && <button onClick={handleImport} disabled={upsellImporting} style={{ padding: "10px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>{upsellImporting ? `กำลังนำเข้า ${upsellProgress}%` : `✅ นำเข้า ${upsellRows.filter(r => r._selected).length} รายการ`}</button>}
          </div>
          {upsellRows.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  <th style={{ padding: "6px 8px", width: 30 }}><input type="checkbox" checked={upsellRows.every(r => r._selected)} onChange={() => setUpsellRows(prev => { const all = prev.every(r => r._selected); return prev.map(r => ({ ...r, _selected: !all })); })} /></th>
                  {["ชื่อ","เบอร์","อำเภอ","จังหวัด","COD","หมายเหตุ"].map((h,i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700, color: "#64748b" }}>{h}</th>)}
                </tr></thead>
                <tbody>{upsellRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", opacity: r._selected ? 1 : .4 }}>
                    <td style={{ padding: "5px 8px" }}><input type="checkbox" checked={r._selected} onChange={() => setUpsellRows(prev => prev.map((x, idx) => idx === i ? { ...x, _selected: !x._selected } : x))} /></td>
                    <td style={{ padding: "5px 8px", fontWeight: 600 }}>{r.receiver_name}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{r.receiver_phone}</td>
                    <td style={{ padding: "5px 8px" }}>{r.receiver_district}</td>
                    <td style={{ padding: "5px 8px", fontSize: 11 }}>{r.receiver_province}</td>
                    <td style={{ padding: "5px 8px", fontWeight: 600, color: r.cod_amount > 0 ? "#d97706" : "#cbd5e1" }}>{r.cod_amount > 0 ? `฿${r.cod_amount}` : "—"}</td>
                    <td style={{ padding: "5px 8px", fontSize: 11 }}>{r.remark}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tabs + Search */}
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e2e8f0", marginBottom: 16 }}>
          {TABS.map(t => { const base = upsellData.filter(p => !p.parcel_created); const cnt = t.key === "ALL" ? base.length : base.filter(p => p.status === t.key).length; const active = upsellFilter === t.key; return <button key={t.key} onClick={() => setUpsellFilter(t.key)} style={{ padding: "12px 18px", border: "none", borderBottom: active ? `3px solid ${t.color}` : "3px solid transparent", background: "transparent", color: active ? t.color : "#64748b", fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>{t.icon} {t.label}{cnt > 0 && <span style={{ background: active ? t.color : "#e2e8f0", color: active ? "#fff" : "#64748b", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{cnt}</span>}</button>; })}
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input value={upsellSearch} onChange={e => setUpsellSearch(e.target.value)} placeholder="🔍 ค้นหา ชื่อ, เบอร์..." style={{ ...I, flex: 1, minWidth: 150 }} />
          <button onClick={loadUpsell} style={{ ...I, cursor: "pointer" }}>🔄</button>
          <select value={upsellShop} onChange={e => setUpsellShop(e.target.value)} style={{ ...I, minWidth: 140, fontWeight: 600, color: upsellShop ? "#1e293b" : "#94a3b8", background: upsellShop ? "#fef3c7" : "#fff" }}>
            <option value="">🏪 เลือกร้านค้า</option>
            {(shops || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={exportUpsell} style={{ padding: "9px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>📤 Export ({upsellSelected.size > 0 ? `เลือก ${upsellSelected.size}` : filtered.length})</button>
          {upsellData.filter(p => p.status !== "success" && p.status !== "cancelled" && !p.parcel_created).length > 0 && <button onClick={batchCreateParcels} style={{ padding: "9px 16px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>📦 สร้างพัสดุ ({upsellData.filter(p => p.status !== "success" && p.status !== "cancelled" && !p.parcel_created).length})</button>}
        </div>

        {/* Table */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {/* Batch action bar */}
          {upsellSelected.size > 0 && (
            <div style={{ padding: "10px 16px", background: "linear-gradient(135deg,#eef2ff,#faf5ff)", borderBottom: "1px solid #c7d2fe", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#4f46e5" }}>✓ เลือก {upsellSelected.size} รายการ</span>
              <button onClick={async () => { const targets = upsellData.filter(p => upsellSelected.has(p.id) && p.status === "pending"); if (!targets.length) { uiAlert("ไม่มีรายการรอดำเนินการ"); return; } for (const t of targets) await updateStatus(t, "success"); setUpsellSelected(new Set()); }} style={{ padding: "7px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✅ สำเร็จ ({upsellData.filter(p => upsellSelected.has(p.id) && p.status === "pending").length})</button>
              <button onClick={async () => { const targets = upsellData.filter(p => upsellSelected.has(p.id) && p.status === "pending"); if (!targets.length) { uiAlert("ไม่มีรายการรอดำเนินการ"); return; } for (const t of targets) await updateStatus(t, "cancelled"); setUpsellSelected(new Set()); }} style={{ padding: "7px 14px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>❌ ยกเลิก ({upsellData.filter(p => upsellSelected.has(p.id) && p.status === "pending").length})</button>
              <button onClick={async () => { if (!upsellShop && shops?.length > 1) { uiAlert("กรุณาเลือกร้านค้าก่อนสร้างพัสดุ"); return; } const targets = upsellData.filter(p => upsellSelected.has(p.id) && p.status !== "success" && p.status !== "cancelled" && !p.parcel_created); if (!targets.length) { uiAlert("ไม่มีรายการที่สร้างพัสดุได้"); return; } const shop = upsellShop ? shops?.find(s => s.id === upsellShop) : shops?.find(s => s.is_default) || shops?.[0]; if (!await uiConfirm(`สร้างพัสดุ ${targets.length} รายการ?\nร้านค้า: ${shop?.name || "ค่าเริ่มต้น"}`)) return; for (const t of targets) { try { await createParcelFromUpsell(t); } catch {} } setUpsellSelected(new Set()); showToast(`สร้างพัสดุ ${targets.length} รายการ`); loadParcels(); }} style={{ padding: "7px 14px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>📦 สร้างพัสดุ ({upsellData.filter(p => upsellSelected.has(p.id) && p.status !== "success" && p.status !== "cancelled" && !p.parcel_created).length})</button>
              {perm.delete && <button onClick={async () => { const targets = upsellData.filter(p => upsellSelected.has(p.id)); if (!targets.length) return; if (!await uiConfirm(`ลบ ${targets.length} รายการ upsell?\n\n⚠️ ลบถาวร กู้คืนไม่ได้`)) return; let n = 0; for (const t of targets) { try { if (!isDemo) await sb.delete("fx_upsell", t.id); n++; } catch {} } setUpsellSelected(new Set()); await loadUpsell(); showToast(`ลบแล้ว ${n} รายการ`); }} style={{ padding: "7px 14px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🗑️ ลบ ({upsellSelected.size})</button>}
              <button onClick={() => setUpsellSelected(new Set())} style={{ padding: "7px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>✕ ยกเลิก</button>
            </div>
          )}
          {!filtered.length ? <div style={{ padding: 50, textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 36 }}>📭</div><div style={{ marginTop: 8, fontWeight: 600 }}>ไม่มีข้อมูล — Import Excel เพื่อเริ่มต้น</div></div> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ padding: "10px 8px", width: 30 }}><input type="checkbox" checked={filtered.length > 0 && filtered.every(p => upsellSelected.has(p.id))} onChange={() => { const allIds = filtered.map(p => p.id); if (filtered.every(p => upsellSelected.has(p.id))) setUpsellSelected(new Set()); else setUpsellSelected(new Set(allIds)); }} /></th>
                  {["#","ชื่อ","เบอร์","ที่อยู่","หมายเหตุ/สินค้า","ยอด","สถานะ","โดย","วันที่"].map((h,i) => <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>)}
                </tr></thead>
                <tbody>{filtered.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: upsellSelected.has(p.id) ? "#eef2ff" : i % 2 ? "#fafafa" : "#fff" }}>
                    <td style={{ padding: "9px 8px", textAlign: "center" }}><input type="checkbox" checked={upsellSelected.has(p.id)} onChange={() => setUpsellSelected(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })} /></td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "#94a3b8" }}>{i + 1}</td>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>{p.receiver_name}</td>
                    <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 12 }}>{p.receiver_phone}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.receiver_address || "—"}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{p.remark || "—"}</td>
                    <td style={{ padding: "9px 12px", fontWeight: 700, color: "#d97706" }}>{p.cod_amount ? `฿${Number(p.cod_amount).toLocaleString()}` : "—"}</td>
                    <td style={{ padding: "9px 12px" }}><span style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: p.status === "success" ? "#ecfdf5" : p.status === "cancelled" ? "#fef2f2" : "#fef3c7", color: p.status === "success" ? "#059669" : p.status === "cancelled" ? "#dc2626" : "#f59e0b" }}>{p.status === "success" ? "✅ สำเร็จ" : p.status === "cancelled" ? "❌ ยกเลิก" : "⏳ รอ"}</span></td>
                    <td style={{ padding: "9px 12px", fontSize: 11, color: "#64748b" }}>{p.upsell_by || "—"}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11, whiteSpace: "nowrap" }}>{new Date(p.created_at).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const ExportPage = () => {
    const productType = (remark) => {
      if (!remark) return "(ไม่ระบุ)";
      let s = String(remark).split("ปลายทาง")[0].trim();
      s = s.replace(/[0-9]+\s*$/, "").trim();
      return s || "(ไม่ระบุ)";
    };

    const getExportData = () => {
      let list = parcels;
      if (exportShop) list = list.filter(p => p.shop_id === exportShop);
      if (exportStaff) list = list.filter(p => (p.sale_person || p.created_by_name) === exportStaff);
      if (exportProduct) list = list.filter(p => productType(p.remark) === exportProduct);
      if (exportFrom) list = list.filter(p => new Date(p.created_at) >= new Date(exportFrom));
      if (exportTo) list = list.filter(p => new Date(p.created_at) <= new Date(exportTo + "T23:59:59"));
      return list;
    };

    const productNames = useMemo(() => [...new Set(parcels.map(p => productType(p.remark)).filter(Boolean))].sort(), [parcels]);

    // รายชื่อพนักงานทั้งหมด (SalesPerson จากไฟล์)
    const staffNames = useMemo(() => [...new Set(parcels.map(p => p.sale_person || p.created_by_name).filter(Boolean))].sort(), [parcels]);

    // สรุปแยกพนักงาน (preview)
    const previewData = getExportData();
    const staffStats = useMemo(() => {
      const map = {};
      previewData.forEach(p => {
        const name = p.sale_person || p.created_by_name || "ไม่ระบุ";
        if (!map[name]) map[name] = { total: 0, cod: 0, codAmount: 0, created: 0, printed: 0, cancelled: 0, draft: 0 };
        map[name].total++;
        if (p.cod_enabled) { map[name].cod++; map[name].codAmount += Number(p.cod_amount || 0); }
        if (p.status === "draft") map[name].draft++;
        if (p.status === "created") map[name].created++;
        if (p.status === "printed") map[name].printed++;
        if (p.status === "cancelled") map[name].cancelled++;
      });
      return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
    }, [previewData]);

    const doExport = async (format) => {
      const data = getExportData();
      if (!data.length) { uiAlert("ไม่มีข้อมูลที่จะ Export"); return; }
      setExporting(true);

      // ProShip format (ตรงกับไฟล์ Import) + คอลัมน์เพิ่ม
      const headers = [
        "MobileNo* เบอร์มือถือ", "Name ชื่อ", "Address ที่อยู่",
        "SubDistrict ตำบล", "District อำเภอ", "ZIP รหัส ปณ.",
        "Customer FB/Line เฟส/ไลน์ลูกค้า", "SalesChannel ช่องทางจำหน่าย",
        "SalesPerson ชื่อแอดมิน", "SalePrice ราคาขาย",
        "COD* ยอดเก็บเงินปลายทาง", "Remark หมายเหตุ",
        "Tracking", "Sort Code", "สถานะ", "ร้านค้า", "ผู้สร้างรายการ", "วันที่สร้าง", "ประเภทสินค้า",
      ];
      const statusMap = { draft: "เตรียมส่ง", created: "สร้างเลขแล้ว", printed: "ปริ้นแล้ว", cancelled: "ยกเลิก" };
      const rows = data.map(p => {
        const shop = shops?.find(s => s.id === p.shop_id);
        return [
          p.receiver_phone || "", p.receiver_name || "", p.receiver_address || "",
          p.receiver_subdistrict || "", p.receiver_district || "", p.receiver_postal || "",
          p.customer_fb_line || "",
          p.item_desc || "",
          p.sale_person || "",
          p.sale_price || p.cod_amount || 0,
          p.cod_enabled ? (p.cod_amount || 0) : 0,
          p.remark || "",
          p.flash_pno || "", p.flash_sort_code || "",
          statusMap[p.status] || p.status || "",
          shop?.name || "",
          p.created_by_name || "",
          new Date(p.created_at).toLocaleString("th-TH"),
          productType(p.remark),
        ];
      });

      // สรุปแยกพนักงาน (SalesPerson จากไฟล์ Import)
      const staffSummary = {};
      data.forEach(p => {
        const name = p.sale_person || p.created_by_name || "ไม่ระบุ";
        if (!staffSummary[name]) staffSummary[name] = { total: 0, cod: 0, codAmount: 0, created: 0, printed: 0, cancelled: 0 };
        staffSummary[name].total++;
        if (p.cod_enabled) { staffSummary[name].cod++; staffSummary[name].codAmount += Number(p.cod_amount || 0); }
        if (p.status === "created") staffSummary[name].created++;
        if (p.status === "printed") staffSummary[name].printed++;
        if (p.status === "cancelled") staffSummary[name].cancelled++;
      });

      // Staff summary rows
      const summaryHeaders = ["พนักงาน", "จำนวนทั้งหมด", "สร้างเลขแล้ว", "ปริ้นแล้ว", "ยกเลิก", "จำนวน COD", "ยอด COD รวม"];
      const summaryRows = Object.entries(staffSummary).map(([name, s]) => [name, s.total, s.created, s.printed, s.cancelled, s.cod, s.codAmount]);

      // สรุปแยกสินค้า (จาก Note)
      const prodSummary = {};
      data.forEach(p => {
        const t = productType(p.remark);
        if (!prodSummary[t]) prodSummary[t] = { total: 0, cod: 0, codAmount: 0, sales: 0, delivered: 0 };
        prodSummary[t].total++;
        if (p.cod_enabled) { prodSummary[t].cod++; prodSummary[t].codAmount += Number(p.cod_amount || 0); }
        prodSummary[t].sales += Number(p.sale_price || 0);
        const fs = p.flash_status || "";
        if (fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ")) prodSummary[t].delivered++;
      });
      const prodHeaders = ["สินค้า", "จำนวน", "ส่งสำเร็จ", "ยอดขายรวม", "จำนวน COD", "ยอด COD รวม"];
      const prodRows = Object.entries(prodSummary).sort((a, b) => b[1].total - a[1].total).map(([t, s]) => [t, s.total, s.delivered, s.sales, s.cod, s.codAmount]);

      if (format === "csv") {
        const bom = "\uFEFF";
        const mainCsv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const summaryCsv = "\n\n--- สรุปแยกพนักงาน ---\n" + [summaryHeaders, ...summaryRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const prodCsv = "\n\n--- สรุปแยกสินค้า ---\n" + [prodHeaders, ...prodRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([bom + mainCsv + summaryCsv + prodCsv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `flash-export-${new Date().toISOString().slice(0,10)}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
        // Row 1: คำอธิบาย (เหมือนไฟล์ Import)
        const noteRow = ["ช่องสีแดงต้องกรอก ช่องสีขาวไม่จำเป็น", "", "", "", "", "", "", "", "", "", "", "", "— คอลัมน์เพิ่มจากระบบ —"];
        const ws = XLSX.utils.aoa_to_sheet([noteRow, headers, ...rows]);
        // Column widths: MobileNo=14, Name=20, Address=35, SubDist=14, Dist=14, ZIP=8, FB=20, Channel=25, Person=14, Price=10, COD=10, Remark=25, Track=18, Sort=12, Status=12, Shop=16, Creator=16, Date=18
        ws["!cols"] = [14,20,35,14,14,8,20,25,14,10,10,25,18,12,12,16,16,18,14].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "ProShip");
        // Sheet 2: สรุปพนักงาน
        const ws2 = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
        ws2["!cols"] = summaryHeaders.map(() => ({ wch: 18 }));
        XLSX.utils.book_append_sheet(wb, ws2, "สรุปพนักงาน");
        // Sheet 3: สรุปสินค้า
        const ws3 = XLSX.utils.aoa_to_sheet([prodHeaders, ...prodRows]);
        ws3["!cols"] = prodHeaders.map(() => ({ wch: 16 }));
        XLSX.utils.book_append_sheet(wb, ws3, "สรุปสินค้า");
        XLSX.writeFile(wb, `flash-export-${new Date().toISOString().slice(0,10)}.xlsx`);
      }
      setExporting(false);
      showToast(`Export สำเร็จ ${data.length} รายการ`);
    };

    const I = { padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit" };

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📤 Export ข้อมูล</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>ดาวน์โหลดข้อมูลพัสดุเป็น Excel หรือ CSV — แจกแจงตามพนักงาน</p>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {/* Filters */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ร้านค้า</label>
                <select value={exportShop} onChange={e => setExportShop(e.target.value)} style={{ ...I, minWidth: 150 }}>
                  <option value="">ทุกร้าน</option>
                  {shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>พนักงาน</label>
                <select value={exportStaff} onChange={e => setExportStaff(e.target.value)} style={{ ...I, minWidth: 150 }}>
                  <option value="">ทุกคน</option>
                  {staffNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>สินค้า</label>
                <select value={exportProduct} onChange={e => setExportProduct(e.target.value)} style={{ ...I, minWidth: 150 }}>
                  <option value="">ทุกสินค้า</option>
                  {productNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ตั้งแต่วันที่</label>
                <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={I} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ถึงวันที่</label>
                <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} style={I} />
              </div>
            </div>
          </div>

          {/* Staff Summary */}
          {staffStats.length > 0 && (
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>👥 สรุปแยกพนักงาน ({staffStats.length} คน)</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {staffStats.map(([name, s]) => (
                  <div key={name} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>🧑‍💻 {name}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px", fontSize: 12 }}>
                      <span style={{ color: "#64748b" }}>ทั้งหมด</span><span style={{ fontWeight: 700 }}>{s.total}</span>
                      <span style={{ color: "#64748b" }}>เตรียมส่ง</span><span style={{ fontWeight: 600, color: "#f59e0b" }}>{s.draft}</span>
                      <span style={{ color: "#64748b" }}>สร้างเลขแล้ว</span><span style={{ fontWeight: 600, color: "#059669" }}>{s.created}</span>
                      <span style={{ color: "#64748b" }}>ปริ้นแล้ว</span><span style={{ fontWeight: 600, color: "#6366f1" }}>{s.printed}</span>
                      <span style={{ color: "#64748b" }}>ยกเลิก</span><span style={{ fontWeight: 600, color: "#dc2626" }}>{s.cancelled}</span>
                      <span style={{ color: "#64748b" }}>COD รวม</span><span style={{ fontWeight: 700, color: "#d97706" }}>฿{s.codAmount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>พบ {previewData.length} รายการ</div>
            {previewData.length > 0 && (
              <div style={{ overflowX: "auto", maxHeight: 300 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr style={{ background: "#f8fafc" }}>
                    {["ชื่อ","เบอร์","อำเภอ","จังหวัด","Tracking","COD","พนักงาน","หมายเหตุ"].map((h,i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700, color: "#64748b", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{previewData.slice(0, 20).map((p, i) => {
                    return <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "5px 8px", fontWeight: 600 }}>{p.receiver_name}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{p.receiver_phone}</td>
                      <td style={{ padding: "5px 8px" }}>{p.receiver_district}</td>
                      <td style={{ padding: "5px 8px" }}>{p.receiver_province}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10 }}>{p.flash_pno || "—"}</td>
                      <td style={{ padding: "5px 8px", fontWeight: 600, color: "#d97706" }}>{p.cod_enabled ? `฿${p.cod_amount}` : "—"}</td>
                      <td style={{ padding: "5px 8px", fontSize: 11, color: "#4f46e5", fontWeight: 600 }}>{p.sale_person || p.created_by_name || "—"}</td>
                      <td style={{ padding: "5px 8px", fontSize: 10, color: "#64748b", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.remark || "—"}</td>
                    </tr>;
                  })}</tbody>
                </table>
                {previewData.length > 20 && <div style={{ padding: 8, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>... แสดง 20/{previewData.length} รายการ</div>}
              </div>
            )}
          </div>

          {/* Export Buttons */}
          <div style={{ padding: "16px 24px", display: "flex", gap: 12 }}>
            <button onClick={() => doExport("xlsx")} disabled={exporting || !previewData.length} style={{ flex: 1, padding: 14, background: previewData.length ? "#059669" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: previewData.length ? "pointer" : "not-allowed" }}>
              📊 Export Excel (.xlsx)
            </button>
            <button onClick={() => doExport("csv")} disabled={exporting || !previewData.length} style={{ flex: 1, padding: 14, background: previewData.length ? "#4f46e5" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: previewData.length ? "pointer" : "not-allowed" }}>
              📄 Export CSV
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ═══ EXPORT เลขพัสดุ PAGE — รายการเลข Tracking ล้วน ๆ (คัดลอก / ดาวน์โหลด .txt) ═══
  const ExportPnoPage = () => {
    const I = { padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "inherit" };

    // กรองเฉพาะพัสดุที่มีเลข Tracking และไม่ถูกยกเลิก
    const list = useMemo(() => {
      let l = parcels.filter(p => p.flash_pno && p.status !== "cancelled");
      if (pnoShop) l = l.filter(p => p.shop_id === pnoShop);
      if (pnoFrom) l = l.filter(p => new Date(p.created_at) >= new Date(pnoFrom));
      if (pnoTo) l = l.filter(p => new Date(p.created_at) <= new Date(pnoTo + "T23:59:59"));
      return l;
    }, [parcels, pnoShop, pnoFrom, pnoTo]);

    // เลขพัสดุไม่ซ้ำ (เรียงตามลำดับล่าสุดก่อน ตาม parcels ที่ sort created_at.desc แล้ว)
    const pnos = useMemo(() => {
      const seen = new Set(); const out = [];
      for (const p of list) { const n = String(p.flash_pno).trim(); if (n && !seen.has(n)) { seen.add(n); out.push(n); } }
      return out;
    }, [list]);

    const sep = pnoSep === "comma" ? ", " : pnoSep === "space" ? " " : "\n";
    const text = pnos.join(sep);

    const copyText = async () => {
      if (!pnos.length) { uiAlert("ไม่มีเลขพัสดุที่จะคัดลอก"); return; }
      try {
        await navigator.clipboard.writeText(text);
        showToast(`คัดลอก ${pnos.length} เลขพัสดุแล้ว`);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand("copy"); showToast(`คัดลอก ${pnos.length} เลขพัสดุแล้ว`); }
        catch { uiAlert("คัดลอกไม่สำเร็จ — กรุณาเลือกข้อความในกล่องแล้วคัดลอกเอง"); }
        document.body.removeChild(ta);
      }
    };

    const downloadTxt = () => {
      if (!pnos.length) { uiAlert("ไม่มีเลขพัสดุที่จะดาวน์โหลด"); return; }
      const blob = new Blob(["\uFEFF" + pnos.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `tracking-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
      URL.revokeObjectURL(url);
      showToast(`ดาวน์โหลด ${pnos.length} เลขพัสดุแล้ว`);
    };

    // Export ครบทุกคอลัมน์/ทุกแถว เป็น Excel (.xlsx) หรือ CSV
    const exportFull = async (format) => {
      if (!list.length) { uiAlert("ไม่มีข้อมูลที่จะ Export"); return; }
      const productType = (remark) => {
        if (!remark) return "(ไม่ระบุ)";
        let s = String(remark).split("ปลายทาง")[0].trim();
        s = s.replace(/[0-9]+\s*$/, "").trim();
        return s || "(ไม่ระบุ)";
      };
      try {
      const statusMap = { draft: "เตรียมส่ง", created: "สร้างเลขแล้ว", printed: "ปริ้นแล้ว", cancelled: "ยกเลิก" };
      const headers = ["ลำดับ", "เลขพัสดุ (Tracking)", "Sort Code", "ชื่อผู้รับ", "เบอร์โทร", "ที่อยู่", "ตำบล", "อำเภอ", "จังหวัด", "รหัสไปรษณีย์", "COD", "สถานะ", "สถานะแฟลช", "รายละเอียดแฟลช", "อัปเดตแฟลชล่าสุด", "ร้านค้า", "พนักงาน", "ผู้สร้าง", "วันที่สร้าง", "ประเภทสินค้า", "หมายเหตุ"];
      const rows = list.map((p, i) => {
        const shop = shops?.find(s => s.id === p.shop_id);
        return [
          i + 1,
          p.flash_pno || "",
          p.flash_sort_code || "",
          p.receiver_name || "",
          p.receiver_phone || "",
          p.receiver_address || "",
          p.receiver_subdistrict || "",
          p.receiver_district || "",
          p.receiver_province || "",
          p.receiver_postal || "",
          p.cod_enabled ? (p.cod_amount || 0) : 0,
          statusMap[p.status] || p.status || "",
          p.flash_status || "สร้างรายการ",
          p.flash_detail || "",
          p.flash_updated_at ? new Date(p.flash_updated_at).toLocaleString("th-TH") : "",
          shop?.name || "",
          p.sale_person || p.created_by_name || "",
          p.created_by_name || "",
          p.created_at ? new Date(p.created_at).toLocaleString("th-TH") : "",
          productType(p.remark),
          p.remark || "",
        ];
      });
      const fname = `tracking-${new Date().toISOString().slice(0, 10)}`;
      if (format === "csv") {
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `${fname}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws["!cols"] = [6, 18, 12, 20, 14, 35, 14, 14, 14, 10, 10, 12, 18, 32, 18, 16, 14, 16, 18, 14, 25].map(w => ({ wch: w }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "เลขพัสดุ");
        XLSX.writeFile(wb, `${fname}.xlsx`);
      }
      showToast(`Export ${list.length} รายการแล้ว`);
      } catch (err) {
        console.error("Export error:", err);
        uiAlert("Export ไม่สำเร็จ: " + (err?.message || String(err)));
      }
    };

    const SEPS = [{ k: "newline", l: "บรรทัดละเลข" }, { k: "comma", l: "คั่นด้วย ," }, { k: "space", l: "เว้นวรรค" }];

    return (
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🔢 Export เลขพัสดุ</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>ดึงเลขพัสดุ — Export เป็น Excel/CSV ครบทุกคอลัมน์ หรือคัดลอกเลขล้วน ๆ เป็น .txt</p>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>

          {/* Filters */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ร้านค้า</label>
                <select value={pnoShop} onChange={e => setPnoShop(e.target.value)} style={{ ...I, minWidth: 150 }}>
                  <option value="">ทุกร้าน</option>
                  {shops?.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ตั้งแต่วันที่</label>
                <input type="date" value={pnoFrom} onChange={e => setPnoFrom(e.target.value)} style={I} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>ถึงวันที่</label>
                <input type="date" value={pnoTo} onChange={e => setPnoTo(e.target.value)} style={I} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>รูปแบบ</label>
                <select value={pnoSep} onChange={e => setPnoSep(e.target.value)} style={{ ...I, minWidth: 130 }}>
                  {SEPS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Count + Preview */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>พบ {list.length} รายการ · {pnos.length} เลขพัสดุไม่ซ้ำ</div>
            <textarea
              readOnly
              value={text}
              placeholder="ไม่มีเลขพัสดุตามเงื่อนไขที่เลือก"
              onFocus={e => e.target.select()}
              style={{ width: "100%", minHeight: 260, maxHeight: 420, padding: "12px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontFamily: "monospace", lineHeight: 1.6, resize: "vertical", outline: "none", background: "#f8fafc", whiteSpace: pnoSep === "newline" ? "pre" : "pre-wrap" }}
            />
          </div>

          {/* Buttons */}
          <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => exportFull("xlsx")} disabled={!list.length} style={{ flex: 1, padding: 14, background: list.length ? "#059669" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: list.length ? "pointer" : "not-allowed" }}>
                📊 Export Excel (.xlsx) — ครบทุกคอลัมน์
              </button>
              <button onClick={() => exportFull("csv")} disabled={!list.length} style={{ flex: 1, padding: 14, background: list.length ? "#0ea5e9" : "#94a3b8", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: list.length ? "pointer" : "not-allowed" }}>
                📄 Export CSV
              </button>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={copyText} disabled={!pnos.length} style={{ flex: 1, padding: 12, background: "#fff", color: pnos.length ? "#4f46e5" : "#94a3b8", border: `1.5px solid ${pnos.length ? "#4f46e5" : "#cbd5e1"}`, borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: pnos.length ? "pointer" : "not-allowed" }}>
                📋 คัดลอกเลขล้วน ({pnos.length})
              </button>
              <button onClick={downloadTxt} disabled={!pnos.length} style={{ flex: 1, padding: 12, background: "#fff", color: pnos.length ? "#334155" : "#94a3b8", border: `1.5px solid ${pnos.length ? "#cbd5e1" : "#e2e8f0"}`, borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: pnos.length ? "pointer" : "not-allowed" }}>
                📝 ดาวน์โหลด .txt
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ═══ USERS PAGE — inline ═══
  const UsersPage = () => <div style={{ padding: 24 }}><UserManagement onClose={() => {}} isDemo={isDemo} inline /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f0", fontFamily: "'IBM Plex Sans Thai',-apple-system,sans-serif", display: "flex" }}>

      {/* ═══ SIDEBAR ═══ */}
      <div style={{ width: 200, background: "#1a1a2e", color: "#fff", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100, flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={LOGO_SRC} alt="MT" style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 3px 10px rgba(220,38,38,.4))" }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: -0.3 }}>MT <span style={{ color: "#f87171" }}>Track</span></div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,.45)", marginTop: 4 }}>บริษัทเดอะเอ็มที <span style={{ color: "#10b981" }}>● Live</span></div>
            </div>
          </div>
        </div>

        {/* Menu */}
        <div style={{ flex: 1, padding: "12px 8px" }}>
          {MENU.map(m => {
            const badge = m.key === "parcels" ? notInFlash.length : m.key === "notinflash" ? (isDemo ? notInFlash.length : notInFlashAll.length) : 0;
            return (
            <button key={m.key} onClick={() => setActivePage(m.key)} style={{
              width: "100%", padding: "11px 14px", border: "none", borderRadius: 10, marginBottom: 4,
              background: activePage === m.key ? "rgba(239,68,68,.15)" : "transparent",
              color: activePage === m.key ? "#f87171" : "rgba(255,255,255,.6)",
              fontSize: 13, fontWeight: activePage === m.key ? 700 : 500, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10, textAlign: "left", fontFamily: "inherit",
            }}>{m.icon} {m.label}{badge > 0 && <span style={{ marginLeft: "auto", background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 10, lineHeight: "16px", minWidth: 18, textAlign: "center" }}>{badge}</span>}</button>
          );})}
        </div>

        {/* User */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: user.avatar_color || role.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff" }}>{user.display_name?.charAt(0)}</div>
            <div><div style={{ fontSize: 12, fontWeight: 600 }}>{user.display_name}</div><div style={{ fontSize: 10, opacity: .5 }}>{role.icon} {role.label}</div></div>
          </div>
          <button onClick={handleLogout} style={{ width: "100%", padding: "8px 12px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>🚪 ออกจากระบบ</button>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div style={{ flex: 1, marginLeft: 200, minHeight: "100vh" }}>
        {/* TOP BAR */}
        {activePage === "parcels" && (
          <div style={{ background: "#fff", padding: "14px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 50, flexWrap: "wrap" }}>
            {/* ซ้าย: ค้นหา */}
            <div style={{ position: "relative", minWidth: 180, flex: 1 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: .4 }}>🔍</span>
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="ค้นหา..." style={{ width: "100%", padding: "9px 12px 9px 36px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, outline: "none", fontFamily: "inherit" }} />
            </div>
            <button onClick={loadParcels} style={{ padding: "9px 12px", background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, cursor: "pointer", fontSize: 13 }}>🔄</button>
            {/* เลือกเดือน — โหลดเฉพาะเดือนนี้ (ประหยัด egress) */}
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "1px 2px" }}>
              <button onClick={() => shiftMonth(-1)} title="เดือนก่อนหน้า" style={{ padding: "6px 9px", background: "transparent", border: "none", cursor: "pointer", fontSize: 15, color: "#64748b", lineHeight: 1 }}>‹</button>
              <input type="month" value={month} onChange={e => { setMonth(e.target.value); setPage(0); }} style={{ padding: "5px 2px", border: "none", background: "transparent", fontSize: 13, fontFamily: "inherit", fontWeight: 700, color: "#dc2626", outline: "none" }} />
              <button onClick={() => shiftMonth(1)} title="เดือนถัดไป" style={{ padding: "6px 9px", background: "transparent", border: "none", cursor: "pointer", fontSize: 15, color: "#64748b", lineHeight: 1 }}>›</button>
            </div>
            {/* กลาง: กรอง + ปริ้น */}
            {shops?.length > 0 && <select value={selectedShopFilter} onChange={e => { setSelectedShopFilter(e.target.value); setPage(0); }} style={{ padding: "9px 10px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontFamily: "inherit", fontWeight: 600, color: selectedShopFilter ? "#dc2626" : "#64748b" }}>
              <option value="">🏪 ทุกร้าน</option>
              {shops.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>}
            <select value={codFilter} onChange={e => { setCodFilter(e.target.value); setPage(0); }} style={{ padding: "9px 10px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 12, fontFamily: "inherit", fontWeight: 600, color: codFilter ? "#d97706" : "#64748b" }}>
              <option value="">💰 ทุกยอด</option>
              <option value="cod">มี COD</option>
              <option value="nocod">ไม่มี COD</option>
              {[...new Set(parcels.filter(p => Number(p.cod_amount) > 0).map(p => Number(p.cod_amount)))].sort((a, b) => a - b).map(v => <option key={v} value={v}>฿{v.toLocaleString()}</option>)}
            </select>
            {(() => { const printable = filtered.filter(p => p.flash_pno && p.status !== "cancelled"); return printable.length > 0 && <button onClick={() => setPrintPreview(printable.map(p => ({ ...p })))} style={{ padding: "9px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>🖨️ ปริ้น ({printable.length})</button>; })()}
            {/* ขวา: สร้างพัสดุ */}
            {perm.create && <button onClick={() => { setEditParcel(null); setShowForm(true); }} style={{ padding: "9px 18px", background: "#dc2626", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>＋ สร้างพัสดุ</button>}
          </div>
        )}

        <div style={{ padding: activePage === "parcels" ? "0" : "24px" }}>
          {/* ═══ PARCELS PAGE ═══ */}
          {activePage === "parcels" && (<>
            {/* STATUS TABS */}
            <div style={{ borderBottom: "2px solid #e2e8f0", overflowX: "auto", display: "flex" }}>
              {STATUS_TABS.map(s => { const cnt = s.key === "ALL" ? statsData.length : statsData.filter(p => p.status === s.key).length; const active = statusFilter === s.key; return <button key={s.key} onClick={() => { setStatusFilter(s.key); setPage(0); }} style={{ padding: "12px 18px", border: "none", borderBottom: active ? `3px solid ${s.color}` : "3px solid transparent", background: "transparent", color: active ? s.color : "#64748b", fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}><span>{s.icon}</span>{s.label}{cnt > 0 && <span style={{ background: active ? s.color : "#e2e8f0", color: active ? "#fff" : "#64748b", padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{cnt}</span>}</button>; })}
            </div>
            {/* STATS */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${perm.viewCOD ? 6 : 5}, 1fr)`, gap: 12, padding: "12px 24px" }}>
              {[{ l: "ทั้งหมด", v: stats.total, c: "#6366f1", i: "📋", k: "ALL" }, { l: "เตรียมส่ง", v: stats.draft, c: "#f59e0b", i: "📝", k: "draft" }, { l: "สร้างเลขแล้ว", v: stats.created, c: "#059669", i: "✅", k: "created" }, { l: "ปริ้นแล้ว", v: stats.printed, c: "#6366f1", i: "🖨️", k: "printed" }, { l: "ยกเลิก", v: stats.cancelled, c: "#dc2626", i: "❌", k: "cancelled" }, ...(perm.viewCOD ? [{ l: "COD รวม", v: `฿${stats.codTotal.toLocaleString()}`, c: "#7c3aed", i: "💰", k: "COD" }] : [])].map((s, i) => { const active = s.k === "COD" ? codFilter === "cod" : statusFilter === s.k; return <div key={i} onClick={() => { if (s.k === "COD") setCodFilter(codFilter === "cod" ? "" : "cod"); else setStatusFilter(s.k); setPage(0); }} title={s.k === "COD" ? "กดเพื่อกรองเฉพาะ COD" : `กดเพื่อดู "${s.l}"`} style={{ background: active ? `${s.c}14` : "#fff", borderRadius: 12, padding: "14px 16px", border: active ? `2px solid ${s.c}` : "1px solid #e2e8f0", cursor: "pointer", transition: ".15s", boxShadow: active ? `0 2px 10px ${s.c}33` : "none" }}><div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{s.i} {s.l}</div><div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div></div>; })}
            </div>

            {/* 🔔 แจ้งเตือน: พัสดุยังไม่เข้าระบบ Flash */}
            {notInFlash.length > 0 && (
              <div style={{ margin: "0 24px 12px", background: "linear-gradient(135deg,#fef2f2,#fff7ed)", border: "1.5px solid #fca5a5", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => { setShowNotifPanel(v => !v); if (showNotifPanel) setNotifSelected(new Set()); }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🔔</span>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#dc2626" }}>พัสดุยังไม่เข้าระบบ Flash: {notInFlash.length} รายการ</span>
                      <span style={{ fontSize: 12, color: "#92400e", marginLeft: 8 }}>มีเลข Tracking แล้วแต่ Flash ยังไม่ได้ยิงรับ</span>
                      {flashRefreshing && <span style={{ fontSize: 11, color: "#6366f1", marginLeft: 8, fontWeight: 600 }}>⟳ กำลัง sync สถานะ...</span>}
                      {!flashRefreshing && <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 8 }}>อัพเดตอัตโนมัติทุก ~2 นาที (ระบบหลังบ้าน)</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 14, color: "#dc2626", fontWeight: 800, transition: "transform .2s", transform: showNotifPanel ? "rotate(180deg)" : "" }}>▼</span>
                </div>
                {showNotifPanel && (
                  <div style={{ borderTop: "1px solid #fca5a5" }} onClick={e => e.stopPropagation()}>
                    {/* Action bar */}
                    <div style={{ padding: "8px 16px", background: "#fde6e6", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#991b1b", cursor: "pointer" }}>
                        <input type="checkbox" checked={notInFlash.length > 0 && notInFlash.every(p => notifSelected.has(p.id))} onChange={() => { if (notInFlash.every(p => notifSelected.has(p.id))) setNotifSelected(new Set()); else setNotifSelected(new Set(notInFlash.map(p => p.id))); }} />
                        เลือกทั้งหมด
                      </label>
                      {notifSelected.size > 0 && <>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#4f46e5" }}>✓ เลือก {notifSelected.size} รายการ</span>
                        <button onClick={() => { const toPrint = notInFlash.filter(p => notifSelected.has(p.id)); if (toPrint.length) setPrintPreview(toPrint.map(p => ({ ...p }))); }} style={{ padding: "5px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🖨️ ปริ้นที่เลือก ({notifSelected.size})</button>
                        <button onClick={() => setNotifSelected(new Set())} style={{ padding: "5px 10px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, cursor: "pointer" }}>✕ ยกเลิก</button>
                      </>}
                      <button onClick={() => { setPrintPreview(notInFlash.map(p => ({ ...p }))); }} style={{ marginLeft: "auto", padding: "5px 14px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🖨️ ปริ้นทั้งหมด ({notInFlash.length})</button>
                      <button onClick={async (e) => {
                        e.stopPropagation();
                        if (flashRefreshing) return;
                        setFlashRefreshing(true);
                        let updated = 0, still = 0, errors = 0;
                        const details = [];
                        // แยกตาม Flash account
                        const byAccount = {};
                        for (const p of notInFlash) {
                          const acc = getFlashAccount(p);
                          const key = acc.mchId;
                          if (!byAccount[key]) byAccount[key] = { acc, parcels: [] };
                          byAccount[key].parcels.push(p);
                        }
                        for (const [mchId, group] of Object.entries(byAccount)) {
                          for (let i = 0; i < group.parcels.length; i += 20) {
                            const batch = group.parcels.slice(i, i + 20);
                            try {
                              const result = await flashApi.getTracking(batch.map(p => p.flash_pno), group.acc);
                              if (result.code === 1 && result.data) {
                                for (const item of result.data) {
                                  const parcel = batch.find(p => p.flash_pno === item.pno);
                                  if (!parcel) continue;
                                  const lastRoute = item.routes?.[0];
                                  const updates = { flash_status: item.stateText || "", flash_detail: lastRoute?.message || "", flash_updated_at: new Date((item.stateChangeAt || 0) * 1000).toISOString() };
                                  setParcels(prev => prev.map(x => x.id === parcel.id ? { ...x, ...updates, flash_state: item.state } : x));
                                  try { await sb.update("fx_parcels", parcel.id, updates); } catch {}
                                  if (Number(item.state) > 1) { updated++; details.push(`✅ ${item.pno} → ${item.stateText}`); }
                                  else { still++; details.push(`⏳ ${item.pno} → state=${item.state} "${item.stateText || 'ว่าง'}"`); }
                                }
                                // pno ที่ไม่อยู่ใน result.data
                                for (const p of batch) {
                                  if (!result.data.find(d => d.pno === p.flash_pno)) {
                                    errors++; details.push(`❌ ${p.flash_pno} → ไม่พบใน Flash (${mchId})`);
                                  }
                                }
                              } else {
                                errors += batch.length;
                                details.push(`❌ API error (${mchId}): code=${result.code} msg=${result.message || 'ไม่ทราบ'}`);
                              }
                            } catch (err) {
                              errors += batch.length;
                              details.push(`❌ Network error (${mchId}): ${err.message}`);
                            }
                          }
                        }
                        setFlashRefreshing(false);
                        const summary = [];
                        if (updated) summary.push(`✅ เข้าระบบแล้ว: ${updated}`);
                        if (still) summary.push(`⏳ ยังไม่เข้าระบบ: ${still}`);
                        if (errors) summary.push(`❌ ไม่พบ/Error: ${errors}`);
                        uiAlert(`ผล Sync (แยกตาม account):\n${summary.join("\n")}\n\n--- รายละเอียด ---\n${details.join("\n")}`);
                        if (updated) loadParcels();
                      }} disabled={flashRefreshing} style={{ padding: "5px 14px", background: flashRefreshing ? "#94a3b8" : "#4f46e5", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: flashRefreshing ? "wait" : "pointer" }}>{flashRefreshing ? "⟳ กำลัง sync..." : `🔄 Sync ${notInFlash.length} รายการ`}</button>
                    </div>
                    <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: "#fde6e6", position: "sticky", top: 0 }}>
                        <th style={{ padding: "8px 6px", width: 30 }}></th>
                        {["#","ชื่อผู้รับ","เบอร์","Tracking","ร้านค้า","สร้างเมื่อ","ค้างมา"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, fontSize: 11 }}>{h}</th>)}
                      </tr></thead>
                      <tbody>{notInFlash.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((p, i) => {
                        const days = Math.floor((Date.now() - new Date(p.created_at)) / 86400000);
                        const shop = shops?.find(s => s.id === p.shop_id);
                        const sel = notifSelected.has(p.id);
                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid #fee2e2", background: sel ? "#ede9fe" : days >= 3 ? "#fff1f1" : i % 2 ? "#fffbfa" : "#fff", cursor: "pointer" }} onClick={() => setNotifSelected(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}>
                            <td style={{ padding: "6px 6px", textAlign: "center" }}><input type="checkbox" checked={sel} readOnly /></td>
                            <td style={{ padding: "6px 10px", color: "#9ca3af" }}>{i + 1}</td>
                            <td style={{ padding: "6px 10px", fontWeight: 600 }}>{p.receiver_name}</td>
                            <td style={{ padding: "6px 10px" }}>{p.receiver_phone}</td>
                            <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11, color: "#4f46e5" }}>{p.flash_pno}</td>
                            <td style={{ padding: "6px 10px" }}>{shop?.name || "—"}</td>
                            <td style={{ padding: "6px 10px" }}>{new Date(p.created_at).toLocaleDateString("th-TH")}</td>
                            <td style={{ padding: "6px 10px" }}>{days >= 3 ? <span style={{ background: "#dc2626", color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>{days} วัน ⚠️</span> : days >= 1 ? <span style={{ background: "#f59e0b", color: "#fff", padding: "1px 6px", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>{days} วัน</span> : <span style={{ color: "#9ca3af", fontSize: 10 }}>วันนี้</span>}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TABLE */}
            <div style={{ padding: "0 24px 24px" }}>
              {/* กรองยอด + ปริ้น — แสดงเมื่อเลือกแท็บ สร้างเลขพัสดุแล้ว */}
              {statusFilter === "created" && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 16px", background: "#ecfdf5", borderRadius: 12, marginBottom: 12, border: "1px solid #a7f3d0" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>🖨️ ปริ้นตามยอด:</span>
                  <select value={codFilter} onChange={e => { setCodFilter(e.target.value); setPage(0); }} style={{ padding: "8px 12px", border: "1.5px solid #a7f3d0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", fontWeight: 700, color: codFilter ? "#d97706" : "#059669", background: "#fff" }}>
                    <option value="">ทั้งหมด ({filtered.length})</option>
                    <option value="cod">มี COD ({filtered.filter(p => Number(p.cod_amount) > 0).length})</option>
                    <option value="nocod">ไม่มี COD ({filtered.filter(p => !Number(p.cod_amount)).length})</option>
                    {[...new Set(filtered.filter(p => Number(p.cod_amount) > 0).map(p => Number(p.cod_amount)))].sort((a, b) => a - b).map(v => <option key={v} value={v}>฿{v.toLocaleString()} ({filtered.filter(p => Number(p.cod_amount) === v).length})</option>)}
                  </select>
                  {(() => { const printable = filtered.filter(p => p.flash_pno); return printable.length > 0 && <button onClick={() => setPrintPreview(printable.map(p => ({ ...p })))} style={{ padding: "8px 18px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🖨️ ปริ้น ({printable.length})</button>; })()}
                </div>
              )}
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                {/* Batch Action Bar */}
                {selectedIds.size > 0 && perm.status && (
                  <div style={{ padding: "10px 16px", background: "linear-gradient(135deg,#eef2ff,#faf5ff)", borderBottom: "1px solid #c7d2fe", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4f46e5" }}>✓ เลือก {selectedIds.size} รายการ</span>
                    <button onClick={batchCreateFlash} disabled={!!batchProgress} style={{ padding: "7px 16px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>⚡ สร้างเลข Tracking ({selectedCounts.noTracking})</button>
                    <button onClick={batchPrint} style={{ padding: "7px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🖨️ ปริ้น ({selectedCounts.hasTracking})</button>
                    <button onClick={batchMarkPrinted} style={{ padding: "7px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🖨️ เปลี่ยนเป็นปริ้นแล้ว ({selectedCounts.canMarkPrinted})</button>
                    {perm.edit && <button onClick={() => { setAssignName(""); setAssignModal(true); }} style={{ padding: "7px 16px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>👤 โยกให้พนักงาน</button>}
                    {perm.delete && <button onClick={batchDelete} style={{ padding: "7px 16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>🗑️ ลบ ({selectedIds.size})</button>}
                    {perm.cancelFlash && <button onClick={batchCancelFlash} disabled={!!cancelProgress} style={{ padding: "7px 16px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: cancelProgress ? "wait" : "pointer", opacity: cancelProgress ? 0.6 : 1 }}>❌ ยกเลิกที่เลือก ({selectedCounts.canCancel})</button>}
                    <button onClick={() => setSelectedIds(new Set())} style={{ padding: "7px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>✕ ยกเลิก</button>
                    {batchProgress && <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 11, color: "#6366f1", marginBottom: 3 }}>กำลังสร้าง... {batchProgress.done}/{batchProgress.total}</div><div style={{ width: "100%", height: 6, background: "#e2e8f0", borderRadius: 3 }}><div style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%`, height: "100%", background: "#6366f1", borderRadius: 3, transition: ".3s" }} /></div></div>}
                    {cancelProgress && <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 11, color: "#dc2626", marginBottom: 3 }}>กำลังยกเลิก... {cancelProgress.done}/{cancelProgress.total}</div><div style={{ width: "100%", height: 6, background: "#fee2e2", borderRadius: 3 }}><div style={{ width: `${(cancelProgress.done / cancelProgress.total) * 100}%`, height: "100%", background: "#dc2626", borderRadius: 3, transition: ".3s" }} /></div></div>}
                  </div>
                )}
                {loading ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>⏳ กำลังโหลด...</div> : !paged.length ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}><div style={{ fontSize: 40 }}>📭</div><div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>ไม่พบพัสดุ</div></div> : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead><tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                        {perm.status && <th style={{ padding: "10px 8px", width: 36 }}><input type="checkbox" checked={paged.length > 0 && paged.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} style={{ cursor: "pointer" }} /></th>}
                        <th style={{ padding: "10px 8px", width: 30, color: "#64748b", fontSize: 11 }}>🖨️</th>
                        {["วันที่", "เวลา", "ลูกค้า", "เบอร์โทรศัพท์", "ที่อยู่", "สถานะ", "สถานะ Flash", "หมายเลขการติดตาม", ...(perm.viewCOD ? ["COD"] : []), "ร้านค้า", "การปฏิบัติ"].map((h, i) => <th key={i} style={{ padding: "10px 10px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>)}
                      </tr></thead>
                      <tbody>{paged.map((p, i) => { const d = new Date(p.created_at); return (
                        <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: selectedIds.has(p.id) ? "#eef2ff" : i % 2 ? "#fafafa" : "#fff" }}>
                          {perm.status && <td style={{ padding: "8px", textAlign: "center" }}><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ cursor: "pointer" }} /></td>}
                          <td style={{ padding: "8px", textAlign: "center" }}>{p.flash_pno ? <span style={{ cursor: "pointer", display: "inline-flex" }} title={p.status === "printed" ? "ปริ้นแล้ว — กดเพื่อปริ้นซ้ำ" : "กดเพื่อปริ้น"} onClick={() => setPrintPreview([{ ...p }])}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={p.status === "printed" ? "#16a34a" : "#94a3b8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg></span> : <span style={{ color: "#e5e7eb" }}>—</span>}</td>
                          <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap" }}>{d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td style={{ padding: "8px 10px", fontSize: 12, whiteSpace: "nowrap", color: "#64748b" }}>{d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} น.</td>
                          <td style={{ padding: "8px 10px", fontWeight: 600, cursor: "pointer", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => setViewParcel(p)}>{p.receiver_name}</td>
                          <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{p.receiver_phone}</td>
                          <td style={{ padding: "8px 10px", fontSize: 11, color: "#475569", maxWidth: 240, lineHeight: 1.35, whiteSpace: "normal" }} title={`${p.receiver_address || ""} ${p.receiver_subdistrict || ""} ${p.receiver_district || ""} ${p.receiver_province || ""} ${p.receiver_postal || ""}`.replace(/\s+/g, " ").trim()}>{`${p.receiver_address || ""} ${p.receiver_subdistrict || ""} ${p.receiver_district || ""} ${p.receiver_province || ""} ${p.receiver_postal || ""}`.replace(/\s+/g, " ").trim() || "—"}</td>
                          <td style={{ padding: "8px 10px" }}><span style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: p.status === "printed" ? "#eef2ff" : p.status === "created" ? "#ecfdf5" : p.status === "cancelled" ? "#fef2f2" : "#fef3c7", color: p.status === "printed" ? "#6366f1" : p.status === "created" ? "#059669" : p.status === "cancelled" ? "#dc2626" : "#f59e0b" }}>{p.status === "printed" ? "🖨️ ปริ้นแล้ว" : p.status === "created" ? "✅ สร้างเลขแล้ว" : p.status === "cancelled" ? "❌ ยกเลิก" : "📝 เตรียมส่ง"}</span></td>
                          <td style={{ padding: "8px 10px" }}>{p.flash_status ? (() => {
                            const fs = p.flash_status;
                            let bg = "#f3f4f6", color = "#475569";
                            if (fs.includes("เซ็นรับ") || fs.includes("จัดส่งสำเร็จ")) { bg = "#dcfce7"; color = "#166534"; }
                            else if (fs.includes("ไม่สำเร็จ") || fs.includes("คืน") || fs.includes("ตีกลับ") || fs.includes("ส่งกลับ")) { bg = "#fee2e2"; color = "#991b1b"; }
                            else if (fs.includes("ขนส่ง") || fs.includes("จัดส่ง") || fs.includes("นำจ่าย")) { bg = "#dbeafe"; color = "#1e40af"; }
                            else if (fs.includes("รับพัสดุ")) { bg = "#e0f2fe"; color = "#0369a1"; }
                            return <span title={p.flash_detail || ""} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "help", background: bg, color }}>{fs}</span>;
                          })() : <span style={{ color: "#d1d5db", fontSize: 11 }}>—</span>}</td>
                          <td style={{ padding: "8px 10px" }}>{p.flash_pno ? <span style={{ color: "#0ea5e9", fontWeight: 600, fontSize: 12 }}>{p.flash_pno} {p.flash_sort_code ? "📋" : ""}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                          {perm.viewCOD && <td style={{ padding: "8px 10px", fontWeight: 700, fontSize: 13 }}>{p.cod_enabled ? <span style={{ color: "#000" }}>{Number(p.cod_amount || 0).toLocaleString()}</span> : ""}</td>}
                          <td style={{ padding: "8px 10px", fontSize: 11, fontWeight: 600 }}>{p.sender_name || "—"}</td>
                          <td style={{ padding: "8px 6px" }}><div style={{ display: "flex", gap: 2 }}>
                            {p.status === "printed" ? <>
                              <span title="รับเข้าระบบแล้ว — ดูได้อย่างเดียว" style={{ width: 26, height: 26, border: "1px solid #059669", borderRadius: 4, background: "#ecfdf5", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>🔒</span>
                            </> : <>
                              {perm.status && !p.flash_pno && <button title="สร้างเลข" onClick={() => createFlashOrder(p)} disabled={flashLoading === p.id} style={{ width: 26, height: 26, border: "1px solid #fbbf24", borderRadius: 4, background: flashLoading === p.id ? "#fef3c7" : "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{flashLoading === p.id ? "⏳" : "⚡"}</button>}
                              {perm.cancelFlash && p.flash_pno && p.status !== "cancelled" && <button title="ยกเลิกเลขพัสดุ" onClick={() => cancelFlashOrder(p)} disabled={flashLoading === p.id} style={{ width: 26, height: 26, border: "1px solid #dc2626", borderRadius: 4, background: flashLoading === p.id ? "#fef2f2" : "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{flashLoading === p.id ? "⏳" : "❌"}</button>}
                              {perm.status && p.flash_pno && p.status === "created" && <button title="เปลี่ยนเป็นปริ้นแล้ว" onClick={() => markPrinted(p)} style={{ width: 26, height: 26, border: "1px solid #6366f1", borderRadius: 4, background: "#eef2ff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>🖨️</button>}
                              {perm.edit && !p.flash_pno && <button title="แก้ไข" onClick={() => { setEditParcel(p); setShowForm(true); }} style={{ width: 26, height: 26, border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>}
                              {perm.delete && p.status !== "cancelled" && <button title="ลบ" onClick={() => handleDelete(p)} style={{ width: 26, height: 26, border: "1px solid #fca5a5", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>🗑️</button>}
                            </>}
                            <button title="ดูรายละเอียด" onClick={() => setViewParcel(p)} style={{ width: 26, height: 26, border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>👁️</button>
                          </div></td>
                        </tr>); })}</tbody>
                    </table>
                  </div>
                )}
                {totalPages > 1 && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: 12, borderTop: "1px solid #f1f5f9" }}><button disabled={!page} onClick={() => setPage(p => p - 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: !page ? "not-allowed" : "pointer", opacity: !page ? .4 : 1 }}>◀</button><span style={{ fontSize: 12, color: "#64748b" }}>{page + 1}/{totalPages} ({filtered.length})</span><button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: "6px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? .4 : 1 }}>▶</button></div>}
              </div>
            </div>
          </>)}

          {activePage === "dashboard" && <DashboardPage />}
          {activePage === "report" && <ReportPage />}
          {activePage === "problems" && <ProblemPage />}
          {activePage === "notinflash" && <NotInFlashPage />}
          {activePage === "activity" && <ActivityLogPage />}
          {activePage === "summary" && <SummaryReportPage />}
          {activePage === "evaluate" && <EvaluatePage />}
          {activePage === "cod" && <CODReconcilePage />}
          {activePage === "exportpno" && <ExportPnoPage />}
          {activePage === "import" && (
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>📥 Import ไฟล์สร้างเลขพัสดุ</h2>
                <p style={{ margin: "6px 0 0", fontSize: 14, color: "#64748b" }}>อัพโหลดไฟล์ CSV / Excel → ตรวจสอบข้อมูล → สร้างออเดอร์ + เลขพัสดุ Flash</p>
              </div>
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                <ImportModal user={user} shops={shops} onClose={() => setActivePage("parcels")} onSave={() => { setActivePage("parcels"); loadParcels(); }} inline />
              </div>
            </div>
          )}
          {activePage === "upsell" && <UpsellPage />}
          {activePage === "export" && <ExportPage />}
          {activePage === "shops" && <div style={{ padding: 24 }}><ShopManagement onClose={() => {}} onUpdate={loadShops} isDemo={isDemo} inline /></div>}
          {activePage === "users" && <div style={{ padding: 24 }}><UserManagement onClose={() => {}} isDemo={isDemo} inline /></div>}
        </div>
      </div>

      {/* MODAL โยกออเดอร์ให้พนักงาน */}
      {assignModal && (
        <div onClick={() => setAssignModal(false)} style={{ position: "fixed", inset: 0, zIndex: 99000, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800 }}>👤 โยกให้พนักงานขาย</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748b" }}>โยก <b>{selectedIds.size}</b> รายการที่เลือก ให้พนักงาน</p>
            <input list="assignSaleList" value={assignName} onChange={e => setAssignName(e.target.value)} onKeyDown={e => e.key === "Enter" && batchAssignSale()} placeholder="เลือกหรือพิมพ์ชื่อพนักงาน" autoFocus style={{ width: "100%", padding: "11px 14px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", outline: "none" }} />
            <datalist id="assignSaleList">{[...new Set(parcels.map(p => (p.sale_person || "").trim()).filter(Boolean))].sort().map(s => <option key={s} value={s} />)}</datalist>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={() => setAssignModal(false)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#475569" }}>ยกเลิก</button>
              <button onClick={batchAssignSale} style={{ flex: 1, padding: "11px", background: "#0ea5e9", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>✓ ยืนยันโยก</button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM DIALOG (แทน confirm/alert ของเบราว์เซอร์) */}
      {uiDlg && (
        <div onClick={() => { uiDlg.resolve(uiDlg.mode === "confirm" ? false : undefined); setUiDlg(null); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100000, padding: 20, animation: "fadeIn .15s ease" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: "28px 26px 20px", width: "100%", maxWidth: 430, boxShadow: "0 24px 70px rgba(0,0,0,.35)", animation: "popIn .2s ease" }}>
            <div style={{ fontSize: 40, textAlign: "center", marginBottom: 6 }}>{uiDlg.icon || (uiDlg.mode === "confirm" ? (uiDlg.danger ? "⚠️" : "❓") : "ℹ️")}</div>
            {uiDlg.title && <div style={{ fontSize: 18, fontWeight: 800, textAlign: "center", marginBottom: 8, color: "#0f172a" }}>{uiDlg.title}</div>}
            <div style={{ fontSize: 14.5, color: "#475569", textAlign: "center", whiteSpace: "pre-wrap", lineHeight: 1.55, marginBottom: 24, maxHeight: 320, overflowY: "auto" }}>{uiDlg.message}</div>
            <div style={{ display: "flex", gap: 10 }}>
              {uiDlg.mode === "confirm" && <button onClick={() => { uiDlg.resolve(false); setUiDlg(null); }} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "1.5px solid #e2e8f0", background: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#475569", fontFamily: "inherit" }}>{uiDlg.cancelText || "ยกเลิก"}</button>}
              <button autoFocus onClick={() => { uiDlg.resolve(uiDlg.mode === "confirm" ? true : undefined); setUiDlg(null); }} style={{ flex: 1, padding: "12px", borderRadius: 12, border: "none", background: uiDlg.danger ? "#dc2626" : "#4f46e5", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>{uiDlg.okText || (uiDlg.mode === "confirm" ? "ยืนยัน" : "ตกลง")}</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", zIndex: 99999, animation: "slideDown .3s ease" }}>
          <div style={{ background: toast.type === "error" ? "#dc2626" : "#059669", color: "#fff", padding: "14px 28px", borderRadius: 14, fontSize: 15, fontWeight: 700, boxShadow: "0 8px 30px rgba(0,0,0,.25)", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit" }}>
            <span style={{ fontSize: 20 }}>{toast.type === "error" ? "❌" : "✅"}</span>
            {toast.msg}
          </div>
        </div>
      )}
      <style>{`@keyframes slideDown { from{opacity:0;transform:translateX(-50%) translateY(-20px)} to{opacity:1;transform:translateX(-50%) translateY(0)} } @keyframes fadeIn { from{opacity:0} to{opacity:1} } @keyframes popIn { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }`}</style>

      {/* LOADING OVERLAY — เฉพาะ batch operations */}
      {globalLoading?.progress && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9001 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 40px", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,.2)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{globalLoading.msg}</div>
            <div style={{ width: 200, height: 8, background: "#e2e8f0", borderRadius: 4 }}>
              <div style={{ width: `${globalLoading.progress}%`, height: "100%", background: "linear-gradient(90deg,#dc2626,#f59e0b)", borderRadius: 4, transition: ".3s" }} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#dc2626", marginTop: 8 }}>{globalLoading.progress}%</div>
          </div>
        </div>
      )}

      {/* PRINT PREVIEW — กรองราคาก่อนปริ้น */}
      {printPreview && (() => {
        return <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setPrintPreview(null)}>
        <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 600, width: "95%", maxHeight: "85vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🖨️ ปริ้นใบปะหน้า — {printPreview.filter(p => p._print !== false).length} ใบ</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button disabled={!!labelProgress} onClick={async () => {
                const list = printPreview.filter(p => p._print !== false && p.flash_pno);
                if (!list.length) { uiAlert("ไม่มีพัสดุที่มีเลข Flash ให้ปริ้น"); return; }
                setLabelProgress({ done: 0, total: list.length });
                try {
                  const { PDFDocument } = await import("pdf-lib");
                  const merged = await PDFDocument.create();
                  const fails = [];
                  let done = 0;
                  const CONCURRENCY = 8;
                  const results = new Array(list.length);
                  for (let i = 0; i < list.length; i += CONCURRENCY) {
                    const slice = list.slice(i, i + CONCURRENCY);
                    await Promise.all(slice.map(async (p, j) => {
                      try { results[i + j] = await flashApi.fetchLabelBytes(p.flash_pno, getFlashAccount(p), "small"); }
                      catch { fails.push(p.flash_pno); results[i + j] = null; }
                      setLabelProgress({ done: ++done, total: list.length });
                    }));
                  }
                  for (const bytes of results) {
                    if (!bytes) continue;
                    try {
                      const doc = await PDFDocument.load(bytes);
                      const pages = await merged.copyPages(doc, doc.getPageIndices());
                      pages.forEach(pg => merged.addPage(pg));
                    } catch {}
                  }
                  if (merged.getPageCount() === 0) { uiAlert("โหลดใบปะหน้าไม่สำเร็จทั้งหมด"); setLabelProgress(null); return; }
                  const out = await merged.save();
                  const u = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
                  const w = window.open(u, "_blank");
                  if (!w) { const a = document.createElement("a"); a.href = u; a.download = "flash-labels-" + merged.getPageCount() + ".pdf"; a.click(); }
                  if (fails.length) uiAlert("โหลดสำเร็จ " + merged.getPageCount() + " ใบ\nไม่สำเร็จ " + fails.length + " ใบ: " + fails.slice(0, 10).join(", "));
                } catch (e) { uiAlert("เกิดข้อผิดพลาด: " + e.message); }
                setLabelProgress(null);
              }} style={{ padding: "7px 12px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: labelProgress ? "wait" : "pointer", opacity: labelProgress ? 0.6 : 1 }}>🏷️ {labelProgress ? `โหลด ${labelProgress.done}/${labelProgress.total}` : "ใบ Flash (รวมไฟล์เดียว)"}</button>
              <button onClick={async () => {
                const p = printPreview.find(x => x._print !== false) || printPreview[0];
                if (!p) return;
                if (!await uiConfirm("เรียกพนักงาน Flash เข้ารับพัสดุที่ที่อยู่ผู้ส่ง?\n" + (p.sender_name || "") + " " + (p.sender_phone || ""))) return;
                try {
                  const r = await flashApi.notifyCourier({ name: p.sender_name, phone: p.sender_phone, province: p.sender_province, city: p.sender_district, postal: p.sender_postal, address: p.sender_address }, getFlashAccount(p));
                  if (r.code === 1 && r.data) uiAlert("✅ เรียกพนักงานสำเร็จ\nพนักงาน: " + (r.data.staffInfoName || "-") + "\nโทร: " + (r.data.staffInfoPhone || "-") + "\nเวลา: " + (r.data.timeoutAtText || "-") + (r.data.ticketMessage ? "\n\n" + r.data.ticketMessage : ""));
                  else uiAlert("❌ " + (r.message || "เรียกพนักงานไม่สำเร็จ"));
                } catch (e) { uiAlert("❌ " + e.message); }
              }} style={{ padding: "7px 12px", background: "#ea580c", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🛵 เรียกพนักงานเข้ารับ</button>
              <button onClick={() => setPrintPreview(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button>
            </div>
          </div>

          {/* กรองตามยอด */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>กรอง:</span>
            <select onChange={e => {
              const v = e.target.value;
              if (v === "") setPrintPreview(prev => prev.map(p => ({ ...p, _print: true })));
              else if (v === "cod") setPrintPreview(prev => prev.map(p => ({ ...p, _print: Number(p.cod_amount) > 0 })));
              else if (v === "nocod") setPrintPreview(prev => prev.map(p => ({ ...p, _print: !Number(p.cod_amount) })));
              else setPrintPreview(prev => prev.map(p => ({ ...p, _print: Number(p.cod_amount) === Number(v) })));
            }} style={{ padding: "8px 14px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontFamily: "inherit", fontWeight: 700 }}>
              <option value="">ทั้งหมด ({printPreview.length})</option>
              <option value="cod">มี COD ({printPreview.filter(p => Number(p.cod_amount) > 0).length})</option>
              <option value="nocod">ไม่มี COD ({printPreview.filter(p => !Number(p.cod_amount)).length})</option>
              {[...new Set(printPreview.filter(p => Number(p.cod_amount) > 0).map(p => Number(p.cod_amount)))].sort((a, b) => a - b).map(v => <option key={v} value={v}>฿{v.toLocaleString()} ({printPreview.filter(p => Number(p.cod_amount) === v).length})</option>)}
            </select>
            <span style={{ fontSize: 13, color: "#059669", fontWeight: 700 }}>→ ปริ้น {printPreview.filter(p => p._print !== false).length} ใบ</span>
          </div>

          {/* รายการ */}
          <div style={{ maxHeight: 350, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                {["✓", "ลูกค้า", "เบอร์", "COD", "Note"].map((h, i) => <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11, borderBottom: "1px solid #e2e8f0" }}>{h}</th>)}
              </tr></thead>
              <tbody>{printPreview.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", opacity: p._print === false ? 0.35 : 1 }}>
                  <td style={{ padding: "6px 10px" }}><input type="checkbox" checked={p._print !== false} onChange={() => setPrintPreview(prev => prev.map((x, idx) => idx === i ? { ...x, _print: x._print === false ? true : false } : x))} /></td>
                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{p.receiver_name}</td>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12 }}>{p.receiver_phone}</td>
                  <td style={{ padding: "6px 10px", fontWeight: 700, color: p.cod_enabled ? "#d97706" : "#cbd5e1" }}>{p.cod_enabled ? `฿${Number(p.cod_amount || 0).toLocaleString()}` : "—"}</td>
                  <td style={{ padding: "6px 10px", fontSize: 11, color: "#64748b", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.remark || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={async () => {
              const toPrint = printPreview.filter(p => p._print !== false);
              if (!toPrint.length) { uiAlert("เลือกอย่างน้อย 1 รายการ"); return; }
              openPrintPage(toPrint);
              for (const p of toPrint) { markPrinted(p); }
              setSelectedIds(new Set());
              setPrintPreview(null);
            }} style={{ flex: 1, padding: 14, background: "#dc2626", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>🖨️ ปริ้น {printPreview.filter(p => p._print !== false).length} ใบ</button>
            <button onClick={() => setPrintPreview(null)} style={{ padding: "14px 24px", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}>ยกเลิก</button>
          </div>
        </div>
      </div>; })()}

      {/* DETAIL MODAL */}
      {viewParcel && <div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setViewParcel(null)}><div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 520, width: "95%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>📦 รายละเอียด</h3><button onClick={() => setViewParcel(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>✕</button></div>
        {[["Tracking", viewParcel.flash_pno || "—"], ["Sort Code", viewParcel.flash_sort_code || "—"], ["สถานะ Flash", viewParcel.flash_status || "—"], ["รายละเอียดล่าสุด", viewParcel.flash_detail || "—"], ["อัพเดตล่าสุด", viewParcel.flash_updated_at ? new Date(viewParcel.flash_updated_at).toLocaleString("th-TH") : "—"], ["── ผู้ส่ง ──", ""], ["ชื่อ", viewParcel.sender_name], ["เบอร์", viewParcel.sender_phone], ["── ผู้รับ ──", ""], ["ชื่อ", viewParcel.receiver_name], ["เบอร์", viewParcel.receiver_phone], ["ที่อยู่", `${viewParcel.receiver_address || ""} ${viewParcel.receiver_subdistrict || ""} ${viewParcel.receiver_district || ""} ${viewParcel.receiver_province || ""} ${viewParcel.receiver_postal || ""}`], ["── พัสดุ ──", ""], ["น้ำหนัก", `${viewParcel.weight || 1} kg`], ["สินค้า", viewParcel.item_desc || "—"], ...(perm.viewCOD ? [["COD", viewParcel.cod_enabled ? `฿${Number(viewParcel.cod_amount || 0).toLocaleString()}` : "ไม่มี"]] : []), ["หมายเหตุ", viewParcel.remark || "—"], ["ผู้สร้าง", viewParcel.created_by_name || "—"], ["สร้างเมื่อ", new Date(viewParcel.created_at).toLocaleString("th-TH")]].map(([l, v], i) => v === "" ? <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", padding: "10px 0 4px", borderBottom: "1px solid #f1f5f9" }}>{l}</div> : <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f8fafc" }}><span style={{ fontSize: 13, color: "#64748b" }}>{l}</span><span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{v}</span></div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {viewParcel.status === "printed" ? <>
            <div style={{ flex: 1, padding: 11, background: "#ecfdf5", border: "1px solid #059669", borderRadius: 10, textAlign: "center", fontSize: 13, color: "#059669", fontWeight: 700 }}>🔒 รับเข้าระบบแล้ว — ดูได้อย่างเดียว</div>
          </> : <>
            {perm.edit && !viewParcel.flash_pno && <button onClick={() => { setEditParcel(viewParcel); setShowForm(true); setViewParcel(null); }} style={{ flex: 1, padding: 11, background: "#e53e3e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>✏️ แก้ไข</button>}
            {viewParcel.flash_pno && viewParcel.status !== "printed" && <div style={{ flex: 1, padding: 11, background: "#f3f4f6", borderRadius: 10, textAlign: "center", fontSize: 12, color: "#6b7280", fontWeight: 600 }}>🔒 ยกเลิกเลข Tracking ก่อนจึงจะแก้ไขได้</div>}
          </>}
          {perm.print && viewParcel.flash_pno && <button onClick={() => { setPrintPreview([{ ...viewParcel }]); setViewParcel(null); }} style={{ padding: "11px 20px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>🖨️ ปริ้น</button>}
        </div>
      </div></div>}

      {/* MODALS */}
      {showForm && <ParcelForm parcel={editParcel} user={user} shops={shops} salePersons={[...new Set(parcels.map(p => (p.sale_person || "").trim()).filter(Boolean))].sort()} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); loadParcels(); }} />}
    </div>
  );
}
