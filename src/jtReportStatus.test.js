import test from 'node:test';
import assert from 'node:assert/strict';
import { jtReportStatus, matchesJtReport, reportParcels } from './jtReportStatus.js';

test('unknown is not evidence of waiting for pickup', () => {
  assert.equal(jtReportStatus(null), 'UNKNOWN');
  assert.equal(matchesJtReport('', 'สร้างรายการ'), false);
  assert.equal(matchesJtReport('ยังไม่พบการเข้ารับ', 'สร้างรายการ'), true);
});
test('carrier scan labels map to report filters', () => {
  for (const [raw, group] of Object.entries({
    'รับพัสดุ': 'รับพัสดุแล้ว', 'จัดสั่งพัสดุ': 'ขนส่ง', 'มาถึง': 'ขนส่ง',
    'สแกนนำจ่ายพัสดุ': 'กำลังจัดส่ง', 'เซ็นรับพัสดุ': 'เซ็นรับแล้ว',
    'สแกนพัสดุมีปัญหา': 'มีปัญหา', 'สแกนพัสดุตีกลับ': 'ส่งคืน',
    'เซ็นรับพัสดุตีกลับ': 'คืนสำเร็จ', 'นำส่งไม่สำเร็จ': 'นำส่งไม่สำเร็จ',
    'สถานะใหม่': 'OTHER',
  })) {
    assert.equal(jtReportStatus(raw), group);
    assert.equal(matchesJtReport(raw, group), true);
    assert.equal(matchesJtReport(raw, 'ALL'), true);
  }
});
test('returns are not successful delivery and failed attempts are not returns', () => {
  assert.equal(matchesJtReport('เซ็นรับพัสดุตีกลับ', 'เซ็นรับแล้ว'), false);
  assert.equal(matchesJtReport('เซ็นรับพัสดุตีกลับ', 'RETURN_ALL'), true);
  assert.equal(matchesJtReport('สแกนพัสดุตีกลับ', 'RETURN_ALL'), true);
  assert.equal(matchesJtReport('นำส่งไม่สำเร็จ', 'RETURN_ALL'), false);
});
test('reports separate carriers and exclude cancelled, UAT and untracked parcels', () => {
  const parcels = [
    {id: 1, source: 'jnt', flash_pno: 'J1', status: 'printed'},
    {id: 2, source: 'flash', flash_pno: 'F1'},
    {id: 3, flash_pno: 'F2'},
    {id: 4, source: 'jnt_uat', flash_pno: 'U1'},
    {id: 5, source: 'jnt', flash_pno: 'J2', status: 'cancelled'},
    {id: 6, source: 'jnt'},
  ];
  assert.deepEqual(reportParcels(parcels, 'jnt').map(p => p.id), [1]);
  assert.deepEqual(reportParcels(parcels, 'flash').map(p => p.id), [2, 3]);
});
