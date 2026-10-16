import { jtTrackingUpdate } from './src/jtPickupStatus.js';
import { jtReportStatus } from './src/jtReportStatus.js';

// Shared queue, independent of how many browsers are open. At most 10 traces/run.
export async function syncJt({ query, trace, broadcast, now = Date.now() }) {
  const checkedAt = new Date(now).toISOString();
  const stale = new Date(now - 60 * 60000).toISOString();
  const rows = await query('fx_parcels?select=id,shop_id,parcel_no,flash_pno,flash_status,flash_detail,flash_updated_at&source=eq.jnt&status=not.in.(cancelled,delivered,returned)&flash_pno=not.is.null&flash_pno=neq.&and=(or(flash_status.is.null,flash_status.not.in.(เซ็นรับพัสดุ,เซ็นรับแล้ว,จัดส่งสำเร็จ,คืนสำเร็จ,เซ็นรับพัสดุตีกลับ)),or(flash_checked_at.is.null,flash_checked_at.lt.' + stale + '))&order=flash_checked_at.asc.nullsfirst&limit=10') || [];
  if (!rows.length) return { checked: 0, updated: 0, errors: 0 };
  const shops = await query('fx_shops?select=id,jt_app&carrier=eq.jnt') || [];
  const result = { checked: 0, updated: 0, errors: 0 };
  for (const row of rows) {
    const match = 'fx_parcels?id=eq.' + encodeURIComponent(row.id) + '&source=eq.jnt&flash_pno=eq.' + encodeURIComponent(row.flash_pno);
    if (['เซ็นรับแล้ว', 'คืนสำเร็จ'].includes(jtReportStatus(row.flash_status))) {
      // Also recognize terminal variants without contacting the carrier.
      await query(match, { method: 'PATCH', body: { flash_checked_at: checkedAt }, prefer: 'return=minimal' });
      continue;
    }
    let updates = null;
    try {
      const account = shops.find(s => s.id === row.shop_id)?.jt_app;
      if (!account || !row.parcel_no) throw new Error('Missing J&T account/order');
      result.checked++;
      updates = jtTrackingUpdate(await trace({ customerCode: account, txlogisticId: row.parcel_no, billCode: row.flash_pno, lang: 'th' }), row);
    } catch { result.errors++; }
    const changed = updates && Object.keys(updates).some(k => updates[k] !== row[k]);
    // Avoid overwriting a newer browser update while this request was in flight.
    const guard = row.flash_updated_at ? '&flash_updated_at=eq.' + encodeURIComponent(row.flash_updated_at) : '&flash_updated_at=is.null';
    await query(match + guard, { method: 'PATCH', body: { ...(changed ? updates : {}), flash_checked_at: checkedAt }, prefer: 'return=minimal' });
    if (changed) result.updated++;
  }
  if (result.updated) await broadcast();
  return result;
}
