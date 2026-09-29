#!/usr/bin/env node
// ไล่ลอง customerCode ที่เป็นไปได้ กับ apiAccount/privateKey ชุด sandbox
// auth ส่งทาง header อย่างเดียว (ยืนยันแล้วจากการเทส)
import crypto from "crypto";

const BASE = "https://demoopenapi.jtexpress.co.th/webopenplatformapi/api/order/addOrder";
const SALT = "jadada236t2";

// ชุด apiAccount + privateKey ที่จะลอง
const ACCOUNTS = [
  { name: "doc-test", api: "679256380346990601", key: "9e31bd78258642da89fa8880aa2d678f" },
  { name: "doc-header", api: "670582903876358197", key: "9e31bd78258642da89fa8880aa2d678f" },
];

// customerCode + password ที่จะลอง (hash แล้ว หรือรหัสดิบให้ระบบ hash)
const CUSTOMERS = [
  { code: "J0086474299", pass: "6A272C3DD1F3CD2F92BF567C37040910", note: "จากหมายเหตุ sandbox" },
  { code: "J0086474299", pass: "H5CD3zE6",  note: "รหัสดิบ + salt" },
  { code: "1192903707",  pass: "H5CD3zE6",  note: "จากตัวอย่าง request" },
  { code: "VIP111111101",pass: "H5CD3zE6",  note: "จากตาราง parameter" },
];

const hashPw = (p) => /^[0-9a-f]{32}$/i.test(p) ? p.toUpperCase()
  : crypto.createHash("md5").update(p + SALT).digest("hex").toUpperCase();

const now = () => new Date(Date.now() + 7*3600e3).toISOString().replace("T"," ").slice(0,19);
const later = (h) => new Date(Date.now() + 7*3600e3 + h*3600e3).toISOString().replace("T"," ").slice(0,19);

function order(code, pass) {
  return {
    actionType: "add", customerCode: code, password: hashPw(pass),
    txlogisticId: "MTP" + Date.now() + Math.floor(Math.random()*1000),
    orderType: "1", serviceType: "1", payType: "PP_PM",
    expressType: "EZ", deliveryType: 1,
    createOrderTime: now(), sendStartTime: now(), sendEndTime: later(24),
    sender: { name:"ร้านเอ็มที", mobile:"0812345678", postCode:"65000",
      prov:"พิษณุโลก", city:"เมืองพิษณุโลก", area:"ในเมือง", address:"123 ถ.พิชัยสงคราม", countryCode:"THA" },
    receiver: { name:"ทดสอบ ระบบ", mobile:"0898765432", postCode:"10240",
      prov:"กรุงเทพมหานคร", city:"บางกะปิ", area:"หัวหมาก", address:"88/9 ซ.รามคำแหง 24", countryCode:"THA" },
    packageInfo: { packageQuantity:"1", weight:"1" },
  };
}

async function tryIt(acc, cus) {
  const biz = JSON.stringify(order(cus.code, cus.pass));
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      apiAccount: acc.api,
      digest: crypto.createHash("md5").update(biz + acc.key).digest("base64"),
      timestamp: String(Date.now()),
    },
    body: new URLSearchParams({ bizContent: biz }).toString(),
  });
  try { return JSON.parse(await res.text()); }
  catch { return { code: "?", msg: "ไม่ใช่ JSON" }; }
}

console.log("ไล่ลอง customerCode กับ apiAccount แต่ละชุด\n");
let found = null;
for (const acc of ACCOUNTS) {
  console.log(`── apiAccount: ${acc.api} (${acc.name})`);
  for (const cus of CUSTOMERS) {
    const r = await tryIt(acc, cus);
    const ok = String(r.code) === "1";
    console.log(`   ${ok ? "✅" : "  "} ${cus.code.padEnd(14)} ${cus.note.padEnd(22)} → ${r.code} ${r.msg || ""}`);
    if (ok && !found) { found = { acc, cus, billCode: r.data?.billCode, sortingCode: r.data?.sortingCode }; }
  }
  console.log();
}

if (found) {
  console.log("═══ พบชุดที่ใช้ได้ ═══");
  console.log("apiAccount   :", found.acc.api);
  console.log("privateKey   :", found.acc.key);
  console.log("customerCode :", found.cus.code);
  console.log("password     :", found.cus.pass);
  console.log("billCode     :", found.billCode);
  console.log("sortingCode  :", found.sortingCode);
} else {
  console.log("═══ ไม่มีชุดไหนใช้ได้ ═══");
  console.log("ต้องขอ customerCode + password ของ sandbox ที่ผูกกับ apiAccount นี้จาก J&T");
  console.log("(ถ้า error เป็น 'Customer code is illegal' ทุกชุด แปลว่า digest ผ่านแล้ว เหลือแค่ตัว customerCode)");
}
