import test from "node:test";
import assert from "node:assert/strict";
import { jtTrackingUpdate, jtPickupStatus } from "./jtPickupStatus.js";

const response = tracesList => ({ code: 1, data: { tracesList } });
const pickup = { scanType: "รับพัสดุ", scanTime: "2026-10-07 10:00:00" };
const delivered = { scanType: "เซ็นรับพัสดุ", scanTime: "2026-10-08 12:00:00", scanNetwork: "ปลายทาง" };
test("production lowercase trace keys observed in Chrome are parsed by both status readers", () => {
  const actualShape = response([
    { scantime: "2026-10-07 15:33:07", scantype: "รับพัสดุ" },
    { scantime: "2026-10-07 18:12:12", scantype: "จัดสั่งพัสดุ" },
    { scantime: "2026-10-07 19:00:35", scantype: "มาถึง" },
    { scantime: "2026-10-07 19:34:22", scantype: "จัดสั่งพัสดุ" },
  ]);
  assert.equal(jtPickupStatus(actualShape), "received");
  assert.deepEqual(jtTrackingUpdate(actualShape), {
    flash_status: "จัดสั่งพัสดุ",
    flash_detail: "จัดสั่งพัสดุ",
    flash_updated_at: "2026-10-07T12:34:22.000Z",
  });
  actualShape.data.tracesList.reverse();
  assert.equal(jtTrackingUpdate(actualShape).flash_status, "จัดสั่งพัสดุ");
  assert.equal(jtPickupStatus(actualShape), "received");
});
test("lowercase incomplete and unknown statuses still do not establish pickup", () => {
  assert.throws(() => jtTrackingUpdate(response([{ scantype: "รับพัสดุ" }])));
  assert.throws(() => jtPickupStatus(response([{ scantype: "unknown", scantime: "2026-10-07 15:33:07" }])));
  assert.equal(jtTrackingUpdate(response([{ scantype: "เซ็นรับพัสดุ", scantime: "2026-10-08 12:00:00" }])).flash_status, "เซ็นรับพัสดุ");
});
test("latest scan is selected regardless of array order, in Thailand timezone", () => {
  for (const traces of [[pickup, delivered], [delivered, pickup]]) {
    const result = jtTrackingUpdate(response(traces));
    assert.equal(result.flash_status, "เซ็นรับพัสดุ");
    assert.equal(result.flash_updated_at, "2026-10-08T05:00:00.000Z");
    assert.match(result.flash_detail, /ปลายทาง/);
    assert.equal(result.status, undefined, "must not change printed/order workflow state");
  }
});
test("empty traces never erase an existing status", () => {
  assert.equal(jtTrackingUpdate(response([]), { flash_status: "รับพัสดุ" }), null);
  assert.equal(jtTrackingUpdate(response([])).flash_status, "ยังไม่พบการเข้ารับ");
});
test("older responses cannot overwrite newer saved scans", () => {
  assert.equal(jtTrackingUpdate(response([pickup]), jtTrackingUpdate(response([delivered]))), null);
});
test("API failures and malformed scans are not pickup or delivery evidence", () => {
  for (const value of [{ code: 0, msg: "unauthorized" }, { code: 1, data: {} }, response([{}]), response([{ scanType: "รับพัสดุ", scanTime: "bad" }])]) {
    assert.throws(() => jtTrackingUpdate(value));
  }
});
test("new carrier status names are displayed verbatim without guessing delivery", () => {
  assert.equal(jtTrackingUpdate(response([{ ...pickup, scanType: "สถานะใหม่" }])).flash_status, "สถานะใหม่");
});
test("explicit timestamp offset is respected", () => {
  assert.equal(jtTrackingUpdate(response([{ ...pickup, scanTime: "2026-10-07T03:00:00Z" }])).flash_updated_at, "2026-10-07T03:00:00.000Z");
});
