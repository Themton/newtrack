import { useEffect, useRef, useState } from "react";
import { jtPickupStatus, jtTrackingUpdate } from "./jtPickupStatus.js";

export default function JtPickupAlert({ parcels, shops, api, visible = true, onWaitingCount, onStatus, onError, sessionRevision = 0, onReauthenticate }) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [authError, setAuthError] = useState("");
  const current = useRef({ parcels, shops, onStatus, onError });
  current.current = { parcels, shops, onStatus, onError };
  const targets = parcels.filter(p => p.source === "jnt" && p.flash_pno && !["cancelled", "delivered", "returned"].includes(p.status));
  const identity = JSON.stringify(targets.map(p => [p.id, p.flash_pno, p.parcel_no, shops.find(s => s.id === p.shop_id)?.jt_app]));

  useEffect(() => {
    let stopped = false;
    let timer;
    const controller = new AbortController();
    async function check() {
      if (document.hidden) { timer = setTimeout(check, 120000); return; }
      setBusy(true);
      setAuthError("");
      const { parcels: rows, shops: senders } = current.current;
      for (const [id, billCode, parcelNo, account] of JSON.parse(identity)) {
        if (stopped) break;
        const row = rows.find(p => p.id === id);
        const key = JSON.stringify([billCode, parcelNo, account]);
        try {
          if (!row || !senders.some(s => s.id === row.shop_id && s.carrier === "jnt" && s.jt_app)) throw new Error("ไม่พบบัญชี J&T ของร้าน");
          const response = await api.tracking({ customerCode: account, txlogisticId: parcelNo, billCode }, controller.signal);
          if (stopped) break;
          const latestRow = current.current.parcels.find(p => p.id === id) || row;
          const updates = jtTrackingUpdate(response, latestRow);
          if (updates) await current.current.onStatus?.(latestRow, updates);
          if (stopped) break;
          current.current.onError?.(latestRow, "");
          const state = jtPickupStatus(response);
          if (!stopped) setResults(prev => ({ ...prev, [id]: { key, state, checkedAt: new Date().toLocaleTimeString("th-TH") } }));
        } catch (error) {
          if (!stopped) {
            current.current.onError?.(row, error.message);
            setResults(prev => ({ ...prev, [id]: { key, state: "error", message: error.message } }));
            // A shared authorization failure affects the entire round. Do not send hundreds of failing requests.
            if (error.status === 401 || error.status === 403 || /เซสชัน|เข้าสู่ระบบ/.test(error.message)) {
              setAuthError(error.message);
              const blocked = {};
              for (const [pid, bill, order, app] of JSON.parse(identity)) {
                blocked[pid] = { key: JSON.stringify([bill, order, app]), state: "error", message: error.message };
                current.current.onError?.(rows.find(p => p.id === pid), error.message);
              }
              setResults(blocked);
              setBusy(false);
              return;
            }
          }
        }
      }
      if (!stopped) { setBusy(false); timer = setTimeout(check, 120000); }
    }
    check();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [identity, revision, api, sessionRevision]);

  const stateFor = p => {
    const key = JSON.stringify([p.flash_pno, p.parcel_no, shops.find(s => s.id === p.shop_id)?.jt_app]);
    return results[p.id]?.key === key ? results[p.id] : null;
  };
  const pending = targets.filter(p => stateFor(p)?.state !== "received");
  const waiting = pending.filter(p => stateFor(p)?.state === "waiting").length;
  useEffect(() => { onWaitingCount?.(waiting); }, [waiting, onWaitingCount]);
  if (!visible || !targets.length) return null;
  return <section style={{ margin: "0 24px 12px", padding: 16, background: "#fff7ed", border: "1.5px solid #fdba74", borderRadius: 12 }}>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={() => setExpanded(v => !v)} aria-expanded={expanded} style={{ background: "none", border: 0, fontSize: 16, fontWeight: 800, color: "#9a3412", cursor: "pointer" }}>🔔 J&T ยังไม่พบการเข้ารับ: {waiting} รายการ · รอตรวจสอบ/ตรวจไม่ได้: {pending.length - waiting} รายการ {expanded ? "▲" : "▼"}</button>
      <button disabled={busy} onClick={() => setRevision(v => v + 1)}>{busy ? "กำลังตรวจสถานะ…" : "ตรวจสถานะอีกครั้ง"}</button>
    </div>
    {authError && <p role="alert" style={{ color: "#9a3412" }}>{authError} · หยุดตรวจอัตโนมัติชั่วคราว <button onClick={onReauthenticate}>ยืนยันตัวตนในหน้านี้</button></p>}
    <p style={{ fontSize: 13, color: "#92400e", margin: "8px 0 0" }}>เฉพาะเดือนที่เปิดอยู่ · ตรวจซ้ำประมาณทุก 2 นาทีหลังจบรอบ ขณะเปิดเว็บ · สถานะปริ้นแล้วไม่ถือว่าขนส่งเข้ารับ</p>
    {expanded && <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", fontSize: 14 }}><thead><tr><th>เลขพัสดุ</th><th>ผู้รับ</th><th>ผลการตรวจ</th></tr></thead><tbody>{pending.map(p => { const result = stateFor(p); return <tr key={p.id}><td>{p.flash_pno}</td><td>{p.receiver_name}</td><td>{result?.state === "waiting" ? `ยังไม่พบการเข้ารับ · ตรวจเมื่อ ${result.checkedAt}` : result?.message || "รอตรวจสอบ"}</td></tr>; })}</tbody></table>{!pending.length && <p>ทุกรายการพบสถานะการรับหรือเคลื่อนย้ายพัสดุแล้ว</p>}</div>}
  </section>;
}
