import test from "node:test";
import assert from "node:assert/strict";
import { jtPickupStatus } from "./jtPickupStatus.js";

test("empty successful traces are waiting, not API errors", () => {
  assert.equal(jtPickupStatus({ code: 1, data: { details: [] } }), "waiting");
  assert.throws(() => jtPickupStatus({ code: 0, msg: "timeout" }));
  assert.throws(() => jtPickupStatus({ code: 1, data: {} }));
});
test("actual pickup and downstream scans remove the alert", () => {
  for (const scanType of ["Picked Up", "รับพัสดุ", "เซ็นรับพัสดุ", "สแกนเข้าคลัง"]) {
    assert.equal(jtPickupStatus({ code: "1", data: { traces: [{ scanType, scanTime: "2026-10-05 12:00:00" }] } }), "received");
  }
});
test("unknown and incomplete scans cannot establish pickup", () => {
  assert.throws(() => jtPickupStatus({ code: 1, data: [{ scanType: "new-status" }] }));
  assert.throws(() => jtPickupStatus({ code: 1, data: [{ scanType: "Picked Up" }] }));
  assert.equal(jtPickupStatus({ code: 1, data: [{ scanType: "Order Created" }] }), "waiting");
});
