import { jtReportStatus } from './jtReportStatus.js';

export function codParcels(parcels, carrier, shop = '') {
  return parcels.filter(p => (carrier === 'jnt' ? p.source === 'jnt' : !['jnt', 'jnt_uat'].includes(p.source))
    && p.cod_enabled && Number.isFinite(Number(p.cod_amount)) && Number(p.cod_amount) > 0
    && p.status !== 'cancelled' && (!shop || p.shop_id === shop));
}

export function codDelivered(status, carrier) {
  if (carrier === 'jnt') return jtReportStatus(status) === 'เซ็นรับแล้ว';
  const s = String(status || '');
  return !/ไม่สำเร็จ|ตีกลับ|ส่งคืน|ส่งกลับ|คืนสำเร็จ/.test(s) && /เซ็นรับ|จัดส่งสำเร็จ/.test(s);
}
