import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelJt } from './jt-cancel-guard.js';
test('only confirmed pre-pickup traces can cancel', () => {
  assert.equal(canCancelJt({code: 1, data: {tracesList: []}}), true);
  assert.equal(canCancelJt({code: 1, data: [{scanType: 'Order Created'}]}), true);
  for (const scanType of ['Picked Up', 'รับพัสดุ', 'Arrival', 'เซ็นรับพัสดุ', 'unknown', undefined]) {
    assert.equal(canCancelJt({code: 1, data: [{scanType}]}), false);
  }
  for (const value of [null, {code: 0, data: []}, {code: 1, data: {}}, {code: 1, data: [null]}]) assert.equal(canCancelJt(value), false);
});
