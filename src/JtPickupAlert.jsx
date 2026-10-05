import { useEffect, useRef, useState } from "react";
import { jtPickupStatus } from "./jtPickupStatus.js";

export default function JtPickupAlert({ parcels, shops, api, visible = true, onWaitingCount }) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const current = useRef({ parcels, shops });
  current.current = { parcels, shops };
  const targets = parcels.filter(p => p.source === "jnt" && p.flash_pno && !["cancelled", "delivered", "returned"].includes(p.status));
  const identity = JSON.stringify(targets.map(p => [p.id, p.flash_pno, p.parcel_no, shops.find(s => s.id === p.shop_id)?.jt_app]));

  useEffect(() => {
    let stopped = false;
    let timer;
    const controller = new AbortController();
    async function check() {
      if (document.hidden) { timer = setTimeout(check, 120000); return; }
      setBusy(true);
      const { parcels: rows, shops: senders } = current.current;
      for (const [id, billCode, parcelNo, account] of JSON.parse(identity)) {
        if (stopped) break;
        const row = rows.find(p => p.id === id);
        const key = JSON.stringify([billCode, parcelNo, account]);
        try {
          if (!row || !senders.some(s => s.id === row.shop_id && s.carrier === "jnt" && s.jt_app)) throw new Error("ไม่พบบัญชี J&T ของร้าน");
          const response = await api.tracking({ customerCode: account, txlogisticId: parcelNo, billCode }, controller.signal);
          const state = jtPickupStatus(response);
          if (!stopped) setResults(prev => ({ ...prev, [id]: { key, state, checkedAt: new Date().toLocaleTimeString("th-TH") } }));
        } catch (error) {
          if (!stopped) setResults(prev => ({ ...prev, [id]: { key, state: "error", message: error.message } }));
        }
      }
      if (!stopped) { setBusy(false); timer = setTimeout(check, 120000); }
    }
    check();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [identity, revision, api]);

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
    <p style={{ fontSize: 13, color: "#92400e", margin: "8px 0 0" }}>เฉพาะเดือนที่เปิดอยู่ · ตรวจซ้ำประมาณทุก 2 นาทีหลังจบรอบ ขณะเปิดเว็บ · สถานะปริ้นแล้วไม่ถือว่าขนส่งเข้ารับ</p>
    {expanded && <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", fontSize: 14 }}><thead><tr><th>เลขพัสดุ</th><th>ผู้รับ</th><th>ผลการตรวจ</th></tr></thead><tbody>{pending.map(p => { const result = stateFor(p); return <tr key={p.id}><td>{p.flash_pno}</td><td>{p.receiver_name}</td><td>{result?.state === "waiting" ? `ยังไม่พบการเข้ารับ · ตรวจเมื่อ ${result.checkedAt}` : result?.message || "รอตรวจสอบ"}</td></tr>; })}</tbody></table>{!pending.length && <p>ทุกรายการพบสถานะการรับหรือเคลื่อนย้ายพัสดุแล้ว</p>}</div>}
  </section>;
}
