import ADDR_DB from './addr.js';
import { jtAddress } from './jtAddress.js';

export function jtAddressErrors(parcel, message) {
  const issues = [/Illegal receiver address info/i.test(message) ? 'J&T ไม่ยอมรับที่อยู่ผู้รับ แต่ไม่ได้ระบุว่าช่องใดผิด กรุณาตรวจจังหวัด อำเภอ/เขต ตำบล/แขวง และรหัสไปรษณีย์' : message || 'สร้างเลขไม่สำเร็จ'];
  for (const [prefix, who] of [['receiver', 'ผู้รับ'], ['sender', 'ผู้ส่ง']]) {
    const a = jtAddress(parcel, prefix);
    for (const [key, label] of [['name','ชื่อ'], ['mobile','เบอร์โทร'], ['address','ที่อยู่'], ['prov','จังหวัด'], ['city','อำเภอ/เขต'], ['area','ตำบล/แขวง'], ['postCode','รหัสไปรษณีย์']]) {
      if (!a[key]) issues.push(`${label}${who}: ยังไม่ได้กรอก`);
    }
    if (a.postCode && !/^\d{5}$/.test(a.postCode)) issues.push(`รหัสไปรษณีย์${who}: ต้องเป็นตัวเลข 5 หลัก (ปัจจุบัน: ${a.postCode})`);
    const rows = ADDR_DB[a.postCode];
    if (a.postCode && /^\d{5}$/.test(a.postCode) && !rows) issues.push(`รหัสไปรษณีย์${who}: ไม่พบ ${a.postCode} ในฐานข้อมูลที่อยู่ของระบบ กรุณาตรวจต้นฉบับ`);
    if (rows && a.prov && a.city && a.area) {
      const province = a.prov === 'กรุงเทพมหานคร' ? 'กรุงเทพ' : a.prov;
      if (!rows.some(r => r.p === province && r.d === a.city && r.s === a.area)) issues.push(`ควรตรวจที่อยู่${who}: ${a.area} / ${a.city} / ${a.prov} / ${a.postCode} ไม่ตรงกับชุดข้อมูลที่อยู่ในระบบ (ยังไม่ใช่การยืนยันจาก J&T)`);
    }
  }
  return [...new Set(issues)];
}
