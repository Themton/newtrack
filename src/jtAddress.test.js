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
    assert.equal(result.address, "71/210 ซอย 23 แขวงดอกไม้ เขตประเวศ");
    assert.deepEqual(p, before);
  }
});
test("includes both administrative levels even when they have the same name", () => {
  const p = { receiver_address: "12 หมู่ 3", receiver_subdistrict: "วังทอง", receiver_district: "วังทอง", receiver_province: "พิษณุโลก" };
  const result = jtAddress(p, "receiver");
  assert.equal(result.address, "12 หมู่ 3 ตำบลวังทอง อำเภอวังทอง");
  assert.equal(p.receiver_address, "12 หมู่ 3");
});
test("does not repeat existing labeled areas and preserves detail", () => {
  for (const detail of ["12 ต.วังทอง อ.วังทอง", "12 ตำบลวังทอง อำเภอวังทอง"]) {
    assert.equal(jtAddress({ sender_address: detail, sender_subdistrict: "วังทอง", sender_district: "วังทอง" }, "sender").address, detail);
  }
  assert.equal(jtAddress({ receiver_address: "12", receiver_district: "เมือง" }, "receiver").address, "12 อำเภอเมือง");
  assert.equal(jtAddress({ receiver_address: "12" }, "receiver").address, "12");
});
test("other provinces and missing fields are not guessed", () => {
  const result = jtAddress({ sender_province: "พิษณุโลก", sender_district: "วังทอง", sender_subdistrict: "วังทอง", sender_postal: 65130 }, "sender");
  assert.equal(result.prov, "พิษณุโลก");
  assert.equal(result.city, "วังทอง");
  assert.equal(result.postCode, "65130");
  assert.equal(result.address, "");
});
