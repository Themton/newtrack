// ═══════════════════════════════════════════════════════════════════
//  J&T Express Thailand — Open Platform Integration
//  เพิ่มเข้าไปใน cloudflare-worker.js (วางต่อจากส่วน Flash)
// ═══════════════════════════════════════════════════════════════════

// ── ตั้งค่า ────────────────────────────────────────────────────────
// "demo" = sandbox (ไม่สร้างพัสดุจริง), "production" = ของจริง
const JT_ENV = "demo";

const JT_BASE = JT_ENV === "demo"
  ? "https://demoopenapi.jtexpress.co.th/webopenplatformapi/api"
  : "https://ylopenapi.jtexpress.co.th/webopenplatformapi/api";

// credential จากเอกสาร (ชุด demo เปิดเผยในเอกสารอยู่แล้ว)
// ⚠️ production ต้องเปลี่ยนเป็นของจริงที่ได้จากศูนย์ควบคุม J&T
const JT_API_ACCOUNT = JT_ENV === "demo" ? "679256380346990601" : "ใส่_apiAccount_จริง";
const JT_PRIVATE_KEY = JT_ENV === "demo" ? "9e31bd78258642da89fa8880aa2d678f" : "ใส่_privateKey_จริง";
const JT_CUSTOMER_CODE = JT_ENV === "demo" ? "J0086474299" : "ใส่_customerCode_จริง";

// ⚠️⚠️ password ของ "Business parameters" คนละตัวกับที่ใช้ทำ digest
//    สูตร: MD5(รหัสผ่านในโปรไฟล์ลูกค้า + "jadada236t2") → ตัวพิมพ์ใหญ่ 32 หลัก
//    ยืนยันแล้ว: MD5("H5CD3zE6" + "jadada236t2") = 6A272C3DD1F3CD2F92BF567C37040910 ✓
//    ถ้าไม่ใส่ salt นี้ J&T จะปฏิเสธทุก request
const JT_PASSWORD_SALT = "jadada236t2";

// ใส่ได้ 2 แบบ: รหัสผ่านดิบ (เช่น "H5CD3zE6") หรือค่าที่ hash มาแล้ว (hex 32 ตัว)
const JT_PASSWORD = JT_ENV === "demo" ? "6A272C3DD1F3CD2F92BF567C37040910" : "ใส่รหัสผ่านของบัญชีจริง";

const jtPassword = () =>
  /^[0-9a-fA-F]{32}$/.test(JT_PASSWORD)
    ? JT_PASSWORD.toUpperCase()                              // hash มาแล้ว ใช้ตรงๆ
    : jtMd5Hex(JT_PASSWORD + JT_PASSWORD_SALT).toUpperCase(); // รหัสดิบ → เติม salt แล้ว md5

// payType: ไม่ใช่ COD ใช้ PP_PM / ถ้าเป็น COD ต้องใช้ค่าที่ J&T อนุมัติให้บัญชีนี้
const JT_PAYTYPE      = "PP_PM";
const JT_PAYTYPE_COD  = "PP_PM";   // ⚠️ ถาม J&T ว่าบัญชีคุณใช้ค่าอะไรสำหรับ COD

// ── MD5 (Workers ไม่มีใน crypto.subtle) ───────────────────────────
function jtMd5Raw(bytes) {
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22, 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23, 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const ml = bytes.length;
  const buf = new Uint8Array((((ml + 8) >> 6) + 1) << 6);
  buf.set(bytes); buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = ml * 8;
  dv.setUint32(buf.length - 8, bitLen >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(bitLen / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < buf.length; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16)      { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D;          g = (3 * i + 5) % 16; }
      else             { F = C ^ (B | ~D);       g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  return out;
}
const jtMd5Hex = (s) => Array.from(jtMd5Raw(new TextEncoder().encode(s))).map(b => b.toString(16).padStart(2, "0")).join("");
const jtMd5B64 = (s) => btoa(String.fromCharCode(...jtMd5Raw(new TextEncoder().encode(s))));

// digest = base64( md5( bizContent + privateKey ) )
const jtDigest = (bizContent) => jtMd5B64(bizContent + JT_PRIVATE_KEY);

// ── เรียก J&T API ─────────────────────────────────────────────────
// ✅ ยืนยันจากการเทส UAT แล้ว: auth ต้องอยู่ใน HEADERS เท่านั้น
//    ถ้าส่งใน form body J&T ตอบ "digest is empty!" (code 145003052)
async function callJT(path, biz) {
  const bizContent = JSON.stringify(biz);   // ต้องเป็น string เดียวกับที่ใช้เซ็น ห้ามแก้หลังจากนี้
  const res = await fetch(`${JT_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      apiAccount: JT_API_ACCOUNT,
      digest: jtDigest(bizContent),
      timestamp: String(Date.now()),
    },
    body: new URLSearchParams({ bizContent }).toString(),
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { code: "0", msg: "ตอบกลับไม่ใช่ JSON: " + text.slice(0, 300) }; }
}

// ── แปลงสถานะ J&T → สถานะไทยที่ระบบใช้อยู่ (ชุดเดียวกับ Flash) ──
const JT_STATUS_MAP = {
  "รับพัสดุ": "รับพัสดุแล้ว",
  "Picked Up": "รับพัสดุแล้ว",
  "สแกนเข้าคลัง": "อยู่ในระบบขนส่ง",
  "สแกนนำส่งพัสดุ": "อยู่ในระบบขนส่ง",
  "สแกนพัสดุถึง": "อยู่ในระบบขนส่ง",
  "สแกนนำจ่ายพัสดุ": "กำลังจัดส่ง",
  "เซ็นรับพัสดุ": "เซ็นรับแล้ว",
  "สแกนพัสดุมีปัญหา": "พัสดุมีปัญหา",
  "สแกนพัสดุตีกลับ": "ส่งคืน",
  "เซ็นรับพัสดุตีกลับ": "คืนสำเร็จ",
};

// ── สร้างออเดอร์ J&T ──────────────────────────────────────────────
// p = แถวจาก fx_parcels (ใช้ชื่อฟิลด์เดิมของระบบ)
function buildJTOrder(p) {
  const now = new Date(Date.now() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 19); // เวลาไทย
  const end = new Date(Date.now() + 7 * 3600e3 + 86400e3).toISOString().replace("T", " ").slice(0, 19);
  const isCod = !!(p.cod_enabled && Number(p.cod_amount) > 0);
  const biz = {
    actionType: "add",
    customerCode: JT_CUSTOMER_CODE,
    password: jtPassword(),
    txlogisticId: p.parcel_no,          // เลขคำสั่งซื้อฝั่งเรา ต้องไม่ซ้ำ
    orderType: "1",                      // 1 = คำสั่งซื้อปกติ
    serviceType: "1",                    // 1 = Pick-up, 6 = Drop-off, 7 = เข้ารับที่คลัง
    payType: isCod ? JT_PAYTYPE_COD : JT_PAYTYPE,
    expressType: "EZ",                   // EZ = พัสดุทั่วไป
    deliveryType: 1,                     // 1 = จัดส่งปกติ
    createOrderTime: now,
    sendStartTime: now,
    sendEndTime: end,
    sender: {
      name: p.sender_name, mobile: p.sender_phone,
      postCode: p.sender_postal, prov: p.sender_province,
      city: p.sender_district, area: p.sender_subdistrict || "",
      address: p.sender_address, countryCode: "THA",
    },
    receiver: {
      name: p.receiver_name, mobile: p.receiver_phone,
      postCode: p.receiver_postal, prov: p.receiver_province,
      city: p.receiver_district, area: p.receiver_subdistrict || "",
      address: p.receiver_address, countryCode: "THA",
    },
    packageInfo: {
      packageQuantity: String(p.quantity || 1),
      weight: String(p.weight || 1),
      ...(p.width  ? { width:  String(p.width)  } : {}),
      ...(p.length ? { length: String(p.length) } : {}),
      ...(p.height ? { height: String(p.height) } : {}),
    },
    ...(p.item_desc ? {
      items: [{ itemName: String(p.item_desc).slice(0, 80), number: p.quantity || 1, itemValue: Number(p.declared_value || 1) }]
    } : {}),
    ...(p.declared_value ? { goodsValue: Number(p.declared_value).toFixed(2) } : {}),
    ...(isCod ? { codInfo: { codValue: Number(p.cod_amount).toFixed(2) } } : {}),  // ไม่ใช่ COD → ไม่ส่ง codInfo
    ...(p.remark ? { remark: String(p.remark).slice(0, 200) } : {}),
  };
  return biz;
}

async function jtCreateOrder(p) {
  const r = await callJT("/order/addOrder", buildJTOrder(p));
  if (String(r.code) !== "1" || !r.data) {
    return { ok: false, error: r.msg || "สร้างออเดอร์ J&T ไม่สำเร็จ", raw: r };
  }
  return {
    ok: true,
    billCode: r.data.billCode,                 // เลขพัสดุ (AWB)
    sortingCode: r.data.sortingCode,           // รหัสคัดแยก เช่น 02-C51-PRK309
    thirdSortingCode: r.data.thirdSortingCode || r.data.streetSortingNo || "",
    raw: r,
  };
}

// ── ยกเลิกออเดอร์ ─────────────────────────────────────────────────
async function jtCancelOrder(p, reason = "ลูกค้ายกเลิกคำสั่งซื้อ") {
  const r = await callJT("/order/cancelOrder", {
    customerCode: JT_CUSTOMER_CODE,
    password: jtPassword(),
    txlogisticId: p.parcel_no,
    ...(p.tracking_no ? { billCode: p.tracking_no } : {}),  // ไม่บังคับ แต่ส่งไปดีกว่า
    reason,
  });
  if (String(r.code) !== "1") return { ok: false, error: r.msg || "ยกเลิกไม่สำเร็จ", raw: r };
  return { ok: true, billCode: r.data?.billCode, raw: r };
}

// ── ใบปะหน้า (J&T สร้าง PDF ให้เลย ไม่ต้องออกแบบเอง) ─────────────
// type: 1=150×100mm  2=100×75  3=100×80  4=100×100  5=76×100
const JT_LABEL_TYPE = 1;

async function jtPrintOrder(p, type = JT_LABEL_TYPE) {
  const r = await callJT("/order/printOrder", {
    customerCode: JT_CUSTOMER_CODE,
    password: jtPassword(),
    txlogisticId: p.parcel_no,
    ...(p.tracking_no ? { billCode: p.tracking_no } : {}),
    type,
  });
  if (String(r.code) !== "1" || !r.data) return { ok: false, error: r.msg || "ขอใบปะหน้าไม่สำเร็จ", raw: r };

  // ตอบกลับได้ 2 แบบ ต้องรองรับทั้งคู่
  const d = r.data;
  if (d.base64EncodeContent) return { ok: true, kind: "base64", pdf: d.base64EncodeContent, billCode: d.billCode };
  if (d.urlContent)          return { ok: true, kind: "url",    url: d.urlContent,          billCode: d.billCode };
  return { ok: false, error: "ไม่พบทั้ง base64EncodeContent และ urlContent", raw: r };
}

// ── Webhook: J&T ยิงสถานะเข้ามา (push — ไม่ต้อง poll → ประหยัด egress) ──
// ตั้ง URL นี้ในศูนย์ควบคุม J&T:  https://<worker>/jt-webhook
async function handleJTWebhook(req, sbQuery) {
  // 1) ตรวจ digest ว่ามาจาก J&T จริง
  const form = new URLSearchParams(await req.text());
  const bizContent = form.get("bizContent") || "";
  const got = req.headers.get("digest") || "";
  if (got !== jtDigest(bizContent)) {
    return new Response(JSON.stringify({ code: 0, msg: "invalid digest" }), { status: 401 });
  }

  let body;
  try { body = JSON.parse(bizContent); }
  catch { return new Response(JSON.stringify({ code: 0, msg: "bad json" }), { status: 400 }); }

  const billCode = body.billCode;
  const details = body.details || body.traces || [];
  if (!billCode || !details.length) {
    return new Response(JSON.stringify({ code: 1, msg: "success", data: { billCode } }));
  }

  // 2) เอา scan ล่าสุด
  const latest = details.slice().sort((a, b) => String(a.scanTime).localeCompare(String(b.scanTime))).pop();
  const mapped = JT_STATUS_MAP[latest.scanType] || latest.scanType;
  const detail = [latest.entrySiteName, latest.city].filter(Boolean).join(" ");

  // 3) อัปเดตลง Supabase (return=minimal → ไม่กิน egress)
  try {
    await sbQuery(`fx_parcels?tracking_no=eq.${encodeURIComponent(billCode)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        carrier_status: mapped,
        carrier_detail: detail,
        carrier_updated_at: new Date().toISOString(),
        carrier_checked_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 0, msg: e.message }), { status: 500 });
  }

  // 4) ตอบกลับตามรูปแบบที่ J&T ต้องการ
  return new Response(JSON.stringify({ code: 1, msg: "success", data: { billCode }, succ: true, fail: false }),
    { headers: { "Content-Type": "application/json" } });
}

export { JT_BASE, callJT, jtCreateOrder, jtCancelOrder, jtPrintOrder,
         jtMd5Hex, jtDigest, JT_STATUS_MAP, handleJTWebhook, buildJTOrder };
