import test from 'node:test';
import assert from 'node:assert/strict';
import { publicTrackingQuery } from './publicTrackingSearch.js';
test('public lookup permits production J&T, excludes only test shipments', () => {
  const p = new URLSearchParams(publicTrackingQuery('864890856793'));
  assert.equal(p.get('and'), '(or(source.is.null,source.neq.jnt_uat))');
  assert.equal(p.get('or'), '(flash_pno.eq.864890856793,receiver_phone.eq.864890856793)');
  assert.ok(!p.get('select').includes('receiver_address'));
});
test('supports phone, Flash and pasted numeric tracking', () => {
  assert.match(new URLSearchParams(publicTrackingQuery('+66 812345678')).get('or'), /receiver_phone.eq.0812345678/);
  assert.match(new URLSearchParams(publicTrackingQuery('TH123456789')).get('or'), /flash_pno.eq.TH123456789/);
  assert.match(new URLSearchParams(publicTrackingQuery('864 890 856793')).get('or'), /flash_pno.eq.864890856793/);
});
test('rejects short searches and filter syntax', () => {
  for (const q of ['', '123', 'foo,receiver_phone.not.is.null']) assert.throws(() => publicTrackingQuery(q));
});
