import test from "node:test";
import assert from "node:assert/strict";
import { jtAddress } from "./jtAddress.js";

test("Bangkok aliases use full province name only in J&T payload", () => {
  for (const province of ["กรุงเทพ", "กรุงเทพฯ", "กรุงเทพมหานคร", "กทม."]) {
    const p = { receiver_province: province, receiver_district: "เขตประเวศ", receiver_subdistrict: "แขวงดอกไม้", receiver_postal: "10250", receiver_address: "71/210 ซอย 23" };
    const before = { ...p };
    const result = jtAddress(p, "receiver");
    assert.equal(result.prov, "กรุงเทพมหานคร");
    assert.equal(result.city, "ประเวศ");
    assert.equal(result.area, "ดอกไม้");
    assert.equal(result.postCode, "10250");
    assert.equal(result.address, p.receiver_address);
    assert.deepEqual(p, before);
  }
});
test("other provinces and missing fields are not guessed", () => {
  const result = jtAddress({ sender_province: "พิษณุโลก", sender_district: "วังทอง", sender_subdistrict: "วังทอง", sender_postal: 65130 }, "sender");
  assert.equal(result.prov, "พิษณุโลก");
  assert.equal(result.city, "วังทอง");
  assert.equal(result.postCode, "65130");
  assert.equal(result.address, "");
});
