#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  สคริปต์ทดสอบ J&T UAT — รันด้วย:  node jt-test.mjs
//  ทดสอบครบวงจร: สร้างออเดอร์ → ขอใบปะหน้า → ยกเลิก
//  ยิงไปที่ UAT เท่านั้น ไม่สร้างพัสดุจริง
// ═══════════════════════════════════════════════════════════════════
import crypto from "crypto";
import fs from "fs";

// ── กรอกค่าตรงนี้ ────────────────────────────────────────────────
const API_ACCOUNT  = process.env.JT_API_ACCOUNT  || "679256380346990601";
const PRIVATE_KEY  = process.env.JT_PRIVATE_KEY  || "9e31bd78258642da89fa8880aa2d678f";
const CUSTOMER_CODE= process.env.JT_CUSTOMER_CODE|| "J0086474299";                       // sandbox
const PASSWORD     = process.env.JT_PASSWORD     || "6A272C3DD1F3CD2F92BF567C37040910"; // sandbox (hash แล้ว)
const SALT         = "jadada236t2";  // salt ของ J&T — ห้ามเปลี่ยน
const PAYTYPE      = process.env.JT_PAYTYPE      || "PP_PM";

const BASE = "https://demoopenapi.jtexpress.co.th/webopenplatformapi/api";

// ตรวจสูตร password ก่อนเริ่ม
{
  const chk = crypto.createHash("md5").update("H5CD3zE6" + SALT).digest("hex").toUpperCase();
  console.log("ตรวจสูตร password:", chk === "6A272C3DD1F3CD2F92BF567C37040910" ? "✅ ถูกต้อง" : "❌ ผิด");
}

const digest = (biz) => crypto.createHash("md5").update(biz + PRIVATE_KEY).digest("base64");
// password = MD5(รหัสผ่านดิบ + salt) ตัวพิมพ์ใหญ่ / ถ้าใส่ค่า hash มาแล้วใช้ตรงๆ
const pwd = () => /^[0-9a-f]{32}$/i.test(PASSWORD)
  ? PASSWORD.toUpperCase()
  : crypto.createHash("md5").update(PASSWORD + SALT).digest("hex").toUpperCase();

// ── ยิง API โดยส่ง auth ทั้งใน header และ body (เอกสารขัดแย้งกัน) ──
async function call(path, biz, mode = "both") {
  const bizContent = JSON.stringify(biz);
  const dg = digest(bizContent), ts = String(Date.now());
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const form = new URLSearchParams({ bizContent });
  if (mode === "both" || mode === "header") Object.assign(headers, { apiAccount: API_ACCOUNT, digest: dg, timestamp: ts });
  if (mode === "both" || mode === "body")   { form.set("apiAccount", API_ACCOUNT); form.set("digest", dg); form.set("timestamp", ts); }

  const res = await fetch(BASE + path, { method: "POST", headers, body: form.toString() });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { code: "0", msg: "ไม่ใช่ JSON: " + text.slice(0, 300) }; }
}

const now = () => new Date(Date.now() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const later = (h) => new Date(Date.now() + 7 * 3600e3 + h * 3600e3).toISOString().replace("T", " ").slice(0, 19);

const txId = "MTTEST" + Date.now();

const order = {
  actionType: "add", customerCode: CUSTOMER_CODE, password: pwd(),
  txlogisticId: txId, orderType: "1", serviceType: "1", payType: PAYTYPE,
  expressType: "EZ", deliveryType: 1,
  createOrderTime: now(), sendStartTime: now(), sendEndTime: later(24),
  sender: { name: "ร้านเอ็มที", mobile: "0812345678", postCode: "65000",
            prov: "พิษณุโลก", city: "เมืองพิษณุโลก", area: "ในเมือง",
            address: "123 ถ.พิชัยสงคราม", countryCode: "THA" },
  receiver: { name: "ทดสอบ ระบบ", mobile: "0898765432", postCode: "10240",
              prov: "กรุงเทพมหานคร", city: "บางกะปิ", area: "หัวหมาก",
              address: "88/9 ซ.รามคำแหง 24", countryCode: "THA" },
  packageInfo: { packageQuantity: "1", weight: "1.5", length: "30", width: "20", height: "10" },
  items: [{ itemName: "สินค้าทดสอบ", number: 1, itemValue: 100 }],
  goodsValue: "100.00",
};

console.log("═══ ทดสอบ J&T UAT ═══");
console.log("txlogisticId:", txId, "\n");

// ── ขั้นที่ 0: หา auth mode ที่ถูก ──────────────────────────────
console.log("【0】ทดสอบว่า auth ต้องอยู่ที่ header หรือ body");
let mode = "both";
for (const m of ["both", "header", "body"]) {
  const r = await call("/order/addOrder", { ...order, txlogisticId: txId + "_" + m }, m);
  const ok = String(r.code) === "1";
  console.log(`   ${ok ? "✅" : "❌"} ${m.padEnd(7)} → code=${r.code} ${r.msg || ""}`);
  if (ok && mode === "both") mode = m;
}
console.log(`   → ใช้โหมด: ${mode}\n`);

// ── ขั้นที่ 1: สร้างออเดอร์ ─────────────────────────────────────
console.log("【1】สร้างออเดอร์");
const created = await call("/order/addOrder", order, mode);
if (String(created.code) !== "1") {
  console.log("   ❌ ล้มเหลว:", created.code, created.msg);
  console.log(JSON.stringify(created, null, 2));
  process.exit(1);
}
const billCode = created.data.billCode;
console.log("   ✅ billCode    :", billCode);
console.log("   ✅ sortingCode :", created.data.sortingCode);
console.log("   ✅ thirdSorting:", created.data.thirdSortingCode || "-", "\n");

// ── ขั้นที่ 2: ใบปะหน้า ─────────────────────────────────────────
console.log("【2】ขอใบปะหน้า (type 1 = 150×100mm)");
const label = await call("/order/printOrder",
  { customerCode: CUSTOMER_CODE, password: pwd(), txlogisticId: txId, billCode, type: 1 }, mode);
if (String(label.code) === "1" && label.data) {
  if (label.data.base64EncodeContent) {
    fs.writeFileSync("jt-label.pdf", Buffer.from(label.data.base64EncodeContent, "base64"));
    console.log("   ✅ ได้ PDF base64 → บันทึกเป็น jt-label.pdf");
  } else if (label.data.urlContent) {
    console.log("   ✅ ได้ลิงก์ PDF:", label.data.urlContent);
  } else {
    console.log("   ⚠️  ไม่พบทั้ง base64EncodeContent และ urlContent:", JSON.stringify(label.data));
  }
} else console.log("   ❌", label.code, label.msg);
console.log();

// ── ขั้นที่ 3: ยกเลิก ───────────────────────────────────────────
console.log("【3】ยกเลิกออเดอร์");
const cancelled = await call("/order/cancelOrder",
  { customerCode: CUSTOMER_CODE, password: pwd(), txlogisticId: txId, billCode, reason: "ทดสอบระบบ" }, mode);
console.log(String(cancelled.code) === "1" ? "   ✅ ยกเลิกสำเร็จ" : `   ❌ ${cancelled.code} ${cancelled.msg}`);

console.log("\n═══ สรุป ═══");
console.log("auth mode ที่ใช้ได้ :", mode);
console.log("→ ถ้าเป็น 'header' หรือ 'body' อย่างเดียว บอกผมเพื่อแก้ jt-module.js ให้ตรง");
