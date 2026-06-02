/* นิยามสถานะพัสดุ — ใช้ร่วมกันทุกหน้า */
const PARCEL_STATUSES = [
  { key: 'created',          label: 'รับเข้าระบบ',          icon: '📥', color: '#64748b' },
  { key: 'picked_up',        label: 'เข้ารับพัสดุแล้ว',      icon: '📦', color: '#0ea5e9' },
  { key: 'at_sorting',       label: 'ถึงศูนย์คัดแยกสินค้า',   icon: '🏭', color: '#6366f1' },
  { key: 'in_transit',       label: 'อยู่ระหว่างขนส่ง',       icon: '🚚', color: '#f59e0b' },
  { key: 'out_for_delivery', label: 'พนักงานกำลังนำจ่าย',    icon: '🛵', color: '#fb923c' },
  { key: 'delivered',        label: 'นำส่งสำเร็จ',           icon: '✅', color: '#16a34a' },
  { key: 'failed',           label: 'นำส่งไม่สำเร็จ',         icon: '⚠️', color: '#dc2626' },
  { key: 'returned',         label: 'ตีกลับต้นทาง',          icon: '↩️', color: '#b91c1c' },
];

const STATUS_MAP = Object.fromEntries(PARCEL_STATUSES.map(s => [s.key, s]));

/* ลำดับขั้นปกติ (ใช้วาดแถบความคืบหน้า ไม่รวมเคสล้มเหลว) */
const FLOW_STEPS = ['created', 'picked_up', 'at_sorting', 'in_transit', 'out_for_delivery', 'delivered'];

function statusInfo(key) {
  return STATUS_MAP[key] || { key, label: key, icon: '•', color: '#64748b' };
}

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
