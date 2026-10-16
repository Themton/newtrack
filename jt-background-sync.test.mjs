import test from 'node:test';
import assert from 'node:assert/strict';
import { syncJt } from './jt-background-sync.js';

test('bounded production queue saves scans, skips terminal and preserves errors', async () => {
  const patches = []; let calls = 0; let broadcasts = 0;
  const rows = [
    { id: 1, shop_id: 1, parcel_no: 'order1', flash_pno: 'bill1' },
    { id: 2, shop_id: 1, parcel_no: 'order2', flash_pno: 'bill2', flash_status: 'เซ็นรับพัสดุ' },
    { id: 3, shop_id: 1, parcel_no: 'order3', flash_pno: 'bill3', flash_status: 'รับพัสดุ' },
  ];
  const result = await syncJt({
    now: Date.parse('2026-10-16T06:00:00Z'),
    query: async (path, opts) => {
      if (opts) { patches.push({ path, ...opts }); return; }
      if (path.startsWith('fx_shops')) return [{ id: 1, jt_app: 'VIP8530310124' }];
      assert.ok(path.includes('source=eq.jnt'));
      assert.ok(path.includes('limit=10'));
      assert.ok(path.includes('2026-10-16T05:00:00.000Z'));
      return rows;
    },
    trace: async body => {
      calls++;
      assert.equal(body.customerCode, 'VIP8530310124');
      if (body.billCode === 'bill3') throw new Error('timeout');
      return { code: 1, data: { traces: [{ scanType: 'รับพัสดุ', scanTime: '2026-10-16 12:00:00' }] } };
    },
    broadcast: async () => { broadcasts++; },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { checked: 2, updated: 1, errors: 1 });
  assert.equal(patches[0].body.flash_status, 'รับพัสดุ');
  assert.equal(patches[2].body.flash_status, undefined);
  assert.ok(patches[0].path.includes('flash_updated_at=is.null'));
  assert.equal(broadcasts, 1);
});

test('empty queue makes no carrier calls', async () => {
  assert.deepEqual(await syncJt({ query: async () => [], trace: () => assert.fail(), broadcast: () => assert.fail() }), { checked: 0, updated: 0, errors: 0 });
});
