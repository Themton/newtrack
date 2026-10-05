import React from "react";
import ADDR_DB, { PROVINCES } from "./addr.js";

export default function ShopAddressFields({ form, setForm, inputStyle }) {
  const matches = ADDR_DB[form.postal] || [];
  const change = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const labelStyle = { display: "block", fontSize: 14, fontWeight: 600, color: "#64748b", marginBottom: 5 };
  const style = { ...inputStyle, fontSize: 16 };
  return <>
    <div style={{ gridColumn: "span 2" }}>
      <label htmlFor="shop-address" style={labelStyle}>บ้านเลขที่ / หมู่ / ถนน / ซอย</label>
      <input id="shop-address" value={form.address} onChange={e => change("address", e.target.value)} placeholder="เช่น 888/11 หมู่ 6" style={style} />
    </div>
    <div><label htmlFor="shop-subdistrict" style={labelStyle}>ตำบล / แขวง</label><input id="shop-subdistrict" value={form.subdistrict || ""} onChange={e => change("subdistrict", e.target.value)} placeholder="ตำบล / แขวง" style={style} /></div>
    <div><label htmlFor="shop-district" style={labelStyle}>อำเภอ / เขต</label><input id="shop-district" value={form.district || ""} onChange={e => change("district", e.target.value)} placeholder="อำเภอ / เขต" style={style} /></div>
    <div><label htmlFor="shop-province" style={labelStyle}>จังหวัด</label><select id="shop-province" value={form.province} onChange={e => change("province", e.target.value)} style={{ ...style, background: "#fff" }}><option value="">-- เลือกจังหวัด --</option>{PROVINCES.map(p => <option key={p}>{p}</option>)}</select></div>
    <div><label htmlFor="shop-postal" style={labelStyle}>รหัสไปรษณีย์</label><input id="shop-postal" value={form.postal} onChange={e => change("postal", e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" maxLength={5} placeholder="พิมพ์ 5 หลักเพื่อค้นหาพื้นที่" style={style} /></div>
    <div style={{ gridColumn: "span 2", fontSize: 14, color: "#64748b" }}>
      {matches.length > 0 ? <><label htmlFor="shop-area" style={labelStyle}>เลือกพื้นที่เพื่อเติมตำบล อำเภอ และจังหวัดพร้อมกัน</label><select id="shop-area" value="" style={{ ...style, background: "#fff" }} onChange={e => {
        if (e.target.value === "") return;
        const area = matches[Number(e.target.value)];
        setForm(f => ({ ...f, subdistrict: area.s, district: area.d, province: area.p }));
      }}><option value="">-- เลือกพื้นที่ตามรหัสไปรษณีย์ {form.postal} --</option>{matches.map((a, i) => <option key={i} value={i}>{a.s} · {a.d} · {a.p}</option>)}</select></> : form.postal.length === 5 ? "ไม่พบรหัสไปรษณีย์นี้ กรุณาตรวจสอบ หรือกรอกพื้นที่ด้วยตนเอง" : "พิมพ์รหัสไปรษณีย์ แล้วเลือกพื้นที่เพื่อช่วยกรอกข้อมูล"}
    </div>
  </>;
}
