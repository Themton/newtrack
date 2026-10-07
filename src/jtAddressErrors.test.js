import test from 'node:test';
import assert from 'node:assert/strict';
import { jtAddressErrors } from './jtAddressErrors.js';
test('reports missing province and unknown postal without guessing replacements', () => {
  const p = { receiver_postal: '65761' };
  const errors = jtAddressErrors(p, 'ข้อมูลไม่ครบ');
  assert.ok(errors.some(e => e.includes('จังหวัดผู้รับ: ยังไม่ได้กรอก')));
  assert.ok(errors.some(e => e.includes('ไม่พบ 65761')));
  assert.deepEqual(p, { receiver_postal: '65761' });
});
test('generic carrier rejection is not attributed to a definite field', () => {
  assert.match(jtAddressErrors({}, 'Illegal receiver address info')[0], /ไม่ได้ระบุว่าช่องใดผิด/);
});
test('district mismatch is advisory and full matching address is accepted', () => {
  const p = { receiver_province: 'นครสวรรค์', receiver_district: 'เมือง', receiver_subdistrict: 'หนองกรด', receiver_postal: '60180' };
  assert.ok(jtAddressErrors(p, 'error').some(e => e.startsWith('ควรตรวจที่อยู่ผู้รับ')));
  Object.assign(p, { receiver_province: 'กรุงเทพมหานคร', receiver_district: 'คลองเตย', receiver_subdistrict: 'คลองเตย', receiver_postal: '10110' });
  assert.ok(!jtAddressErrors(p, 'error').some(e => e.startsWith('ควรตรวจที่อยู่ผู้รับ')));
});
