// Keep unknown carrier labels visible; never infer delivery from printing.
export function jtReportStatus(value) {
  const status = String(value || "").trim();
  if (!status) return "UNKNOWN";
  if (["ยังไม่พบการเข้ารับ", "รอเข้ารับ", "สร้างรายการ", "สร้างออเดอร์", "Order Created"].includes(status)) return "สร้างรายการ";
  // Return delivery must precede the general signature match.
  if (/เซ็นรับ.*(ตีกลับ|คืน)|คืนสำเร็จ/.test(status)) return "คืนสำเร็จ";
  if (/ตีกลับ|ส่งคืน|ส่งกลับ/.test(status)) return "ส่งคืน";
  if (/ไม่สำเร็จ/.test(status)) return "นำส่งไม่สำเร็จ";
  if (/มีปัญหา/.test(status)) return "มีปัญหา";
  if (["เซ็นรับพัสดุ", "เซ็นรับแล้ว", "จัดส่งสำเร็จ"].includes(status)) return "เซ็นรับแล้ว";
  if (/นำจ่าย|กำลังจัดส่ง/.test(status)) return "กำลังจัดส่ง";
  if (["รับพัสดุ", "รับพัสดุแล้ว", "Picked Up"].includes(status)) return "รับพัสดุแล้ว";
  if (/คงคลัง/.test(status)) return "คงคลัง";
  if (["จัดสั่งพัสดุ", "มาถึง", "สแกนเข้าคลัง", "สแกนนำส่งพัสดุ", "สแกนพัสดุถึง"].includes(status)) return "ขนส่ง";
  return "OTHER";
}

export function reportParcels(parcels, carrier) {
  return parcels.filter(p => p.flash_pno && p.status !== "cancelled" && (carrier === "jnt" ? p.source === "jnt" : !["jnt", "jnt_uat"].includes(p.source)));
}

export function matchesJtReport(status, filter) {
  const group = jtReportStatus(status);
  if (filter === "ALL") return true;
  if (filter === "RETURN_ALL") return ["ส่งคืน", "คืนสำเร็จ"].includes(group);
  return group === filter;
}
