// Fail closed: only an explicit successful trace with no physical scan is eligible.
export function canCancelJt(response) {
  if (String(response?.code) !== '1') return false;
  const data = response.data;
  const traces = Array.isArray(data) ? data : data?.tracesList ?? data?.details ?? data?.traces;
  if (!Array.isArray(traces)) return false;
  const prePickup = new Set(['รอเข้ารับ', 'สร้างรายการ', 'สร้างออเดอร์', 'Order Created']);
  return traces.every(t => t && prePickup.has(t.scantype ?? t.scanType));
}
