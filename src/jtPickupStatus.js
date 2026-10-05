const RECEIVED = new Set(["รับพัสดุ", "Picked Up", "สแกนเข้าคลัง", "สแกนนำส่งพัสดุ", "สแกนพัสดุถึง", "สแกนนำจ่ายพัสดุ", "เซ็นรับพัสดุ", "สแกนพัสดุมีปัญหา", "สแกนพัสดุตีกลับ", "เซ็นรับพัสดุตีกลับ"]);
const WAITING = new Set(["รอเข้ารับ", "สร้างรายการ", "สร้างออเดอร์", "Order Created"]);

export function jtPickupStatus(response) {
  if (String(response?.code) !== "1") throw new Error(response?.msg || "ตรวจสถานะ J&T ไม่สำเร็จ");
  const data = response.data;
  const traces = Array.isArray(data) ? data : data?.tracesList ?? data?.details ?? data?.traces;
  if (!Array.isArray(traces)) throw new Error("ยังไม่รองรับรูปแบบสถานะที่ J&T ส่งกลับ");
  if (traces.some(t => t?.scanTime && RECEIVED.has(t.scanType))) return "received";
  if (!traces.length || traces.every(t => WAITING.has(t?.scanType))) return "waiting";
  throw new Error("พบสถานะ J&T ที่ยังยืนยันการเข้ารับไม่ได้");
}
