import test from "node:test";
import assert from "node:assert/strict";
import { shopSenderLocation } from "./shopSenderLocation.js";

test("fills sender location from the saved Wang Thong shop address", () => {
  assert.deepEqual(shopSenderLocation({
    address: "888/11 ม6 วังทอง วังทอง พิษณุโลก 65130 พิษณุโลก 65130",
    province: "พิษณุโลก", postal: "65130",
  }), { district: "วังทอง", subdistrict: "วังทอง" });
});

test("does not guess subdistrict from postcode alone", () => {
  assert.deepEqual(shopSenderLocation({ address: "888/11 ม6", province: "พิษณุโลก", postal: "65130" }),
    { district: "วังทอง", subdistrict: "" });
});

test("keeps explicitly saved location and rejects mismatched postcode", () => {
  assert.deepEqual(shopSenderLocation({ district: "วังทอง", subdistrict: "พันชาลี", postal: "65130" }),
    { district: "วังทอง", subdistrict: "พันชาลี" });
  assert.deepEqual(shopSenderLocation({ address: "วังทอง วังทอง", province: "พิษณุโลก", postal: "99999" }),
    { district: "", subdistrict: "" });
});
