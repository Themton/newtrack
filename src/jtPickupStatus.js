const RECEIVED = new Set(["รับพัสดุ", "Picked Up", "สแกนเข้าคลัง", "สแกนนำส่งพัสดุ", "สแกนพัสดุถึง", "สแกนนำจ่ายพัสดุ", "เซ็นรับพัสดุ", "สแกนพัสดุมีปัญหา", "สแกนพัสดุตีกลับ", "เซ็นรับพัสดุตีกลับ"]);
const WAITING = new Set(["รอเข้ารับ", "สร้างรายการ", "สร้างออเดอร์", "Order Created"]);

export function jtPickupStatus(response) {
  const traces = jtTraces(response);
  if (traces.some(t => t?.scanTime && RECEIVED.has(t.scanType))) return "received";
  if (!traces.length || traces.every(t => WAITING.has(t?.scanType))) return "waiting";
  throw new Error("พบสถานะ J&T ที่ยังยืนยันการเข้ารับไม่ได้");
}

function jtTraces(response) {
  if (String(response?.code) !== "1") throw new Error(response?.msg || "ตรวจสถานะ J&T ไม่สำเร็จ");
  const data = response.data;
  const traces = Array.isArray(data) ? data : data?.tracesList ?? data?.details ?? data?.traces;
  if (!Array.isArray(traces)) throw new Error("ยังไม่รองรับรูปแบบสถานะที่ J&T ส่งกลับ");
  // Production trace uses lowercase keys; webhook/older responses use camelCase.
  return traces.map(t => t && typeof t === "object" ? {
    ...t,
    scanType: t.scantype ?? t.scanType,
    scanTime: t.scantime ?? t.scanTime,
  } : t);
}

// J&T timestamps without an offset are Thailand local time, not browser local time.
function scanDate(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(normalized)) return null;
  const time = Date.parse(normalized + (/(Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? "" : "+07:00"));
  return Number.isFinite(time) ? time : null;
}

export function jtTrackingUpdate(response, previous = {}) {
  const traces = jtTraces(response);
  if (!traces.length) return previous.flash_status ? null : {
    flash_status: "ยังไม่พบการเข้ารับ", flash_detail: "J&T ยังไม่มีประวัติการสแกนพัสดุ", flash_updated_at: null,
  };
  const scans = traces.filter(t => typeof t?.scanType === "string" && t.scanType.trim() && scanDate(t.scanTime) !== null);
  if (scans.length !== traces.length) throw new Error("ข้อมูลสถานะ J&T ไม่ครบ: ต้องมีชื่อสถานะและเวลาสแกนที่ถูกต้อง");
  const latest = scans.reduce((a, b) => scanDate(a.scanTime) >= scanDate(b.scanTime) ? a : b);
  const timestamp = scanDate(latest.scanTime);
  if (previous.flash_updated_at && Date.parse(previous.flash_updated_at) > timestamp) return null;
  return {
    flash_status: latest.scanType.trim(),
    flash_detail: [latest.scanType, latest.scanNetwork || latest.entrySiteName, latest.city].filter(v => typeof v === "string" && v.trim()).join(" · "),
    flash_updated_at: new Date(timestamp).toISOString(),
  };
}
