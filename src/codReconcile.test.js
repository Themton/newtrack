import test from 'node:test';
import assert from 'node:assert/strict';
import { codParcels, codDelivered } from './codReconcile.js';

test('COD separates production carriers, excludes UAT, cancelled and invalid amounts', () => {
  const base = { cod_enabled: true, cod_amount: 190, status: 'printed', shop_id: 's' };
  const rows = [null, 'jnt', 'jnt_uat', 'import'].map(source => ({ ...base, source }));
  rows.push({ ...base, source: 'jnt', status: 'cancelled' }, { ...base, source: 'jnt', cod_amount: 'NaN' }, { ...base, source: 'jnt', cod_enabled: false });
  assert.equal(codParcels(rows, 'jnt').length, 1);
  assert.equal(codParcels(rows, 'flash').length, 2);
  assert.equal(codParcels(rows, 'jnt', 'other').length, 0);
});

test('only actual delivery qualifies, never returns, printing or unknown scans', () => {
  for (const carrier of ['jnt', 'flash']) {
    for (const status of ['คืนสำเร็จ', 'เซ็นรับพัสดุตีกลับ', 'นำส่งไม่สำเร็จ', 'ปริ้นแล้ว', '', 'แกะถุง']) assert.equal(codDelivered(status, carrier), false);
    assert.equal(codDelivered('เซ็นรับแล้ว', carrier), true);
    assert.equal(codDelivered('จัดส่งสำเร็จ', carrier), true);
  }
});
