import test from 'node:test';
import assert from 'node:assert/strict';
import { hasConfirmedJtPickup } from './jtPickupEligibility.js';

test('persisted carrier scan confirms pickup across page reloads', () => {
  for (const flash_status of ['รับพัสดุ', 'Picked Up', 'สแกนนำส่งพัสดุ', 'เซ็นรับพัสดุ']) {
    assert.equal(hasConfirmedJtPickup({ source: 'jnt', flash_status, flash_updated_at: '2026-10-16T03:00:00.000Z' }), true);
  }
});
test('printed, waiting, unknown, missing date and other carriers remain unconfirmed', () => {
  for (const parcel of [
    { status: 'printed' },
    { flash_status: 'ยังไม่พบการเข้ารับ' },
    { flash_status: 'unknown' },
    { flash_status: 'รับพัสดุ', flash_updated_at: null },
    { flash_status: 'รับพัสดุ', source: 'flash' },
  ]) assert.equal(hasConfirmedJtPickup({ source: 'jnt', flash_updated_at: '2026-10-16T03:00:00.000Z', ...parcel }), false);
});
