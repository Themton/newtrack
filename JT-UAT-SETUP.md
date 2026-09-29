# J&T UAT setup

ตั้งค่า Secrets ใน Cloudflare Worker `newtrack-proxy`:

```bash
npx wrangler secret put JT_API_ACCOUNT
npx wrangler secret put JT_PRIVATE_KEY
npx wrangler secret put JT_BUSINESS_PASSWORD
npx wrangler secret put JT_CUSTOMER_CODE
npx wrangler secret put JT_ACCESS_TOKEN
```

ใช้ endpoint `/jt-api/create`, `/jt-api/cancel` และ `/jt-api/label` จาก frontend ผ่าน Worker เท่านั้น

ใส่ `--config ./wrangler.toml` ในทุกคำสั่ง Wrangler เพื่อเลือก Worker `newtrack-proxy` ให้ถูกต้อง

`JT_BUSINESS_PASSWORD` คือ MD5(rawPassword + "jadada236t2") เป็น hex ตัวพิมพ์ใหญ่ 32 ตัว
`JT_ACCESS_TOKEN` คือรหัสเข้าใช้งาน UAT ที่ตั้งเอง ใช้กรอกช่อง J&T UAT หลังล็อกอินเว็บ เก็บเฉพาะในหน่วยความจำจนออกจากระบบ/รีโหลด ไม่ใช่ privateKey ของ J&T

## วิธีใช้งาน

1. บันทึกข้อมูลพัสดุให้ครบ รวมอำเภอผู้ส่ง ที่อยู่และไปรษณีย์ น้ำหนัก และ COD
2. กรอกรหัสเข้าใช้งาน UAT ในหน้ารายการพัสดุ
3. กด J&T UAT ในแถวที่ยังไม่มีเลขพัสดุ ระบบขอยืนยันแล้วสร้างเลขทดสอบ
4. กดใบปะหน้า J&T เพื่อดาวน์โหลด PDF เลือกขนาดจากแถบ UAT ได้ 5 ขนาด
5. กดยกเลิกในแถวนั้น ระบบยกเลิก J&T ก่อนปรับสถานะในฐานข้อมูล
6. การปริ้น/ยกเลิกแบบเลือกหลายรายการแยกไป J&T หรือ Flash ตามรายการ

ชุด UAT นี้บันทึก `source=jnt_uat` และใช้คอลัมน์เลขพัสดุเดิมเพื่อรองรับหน้าระบบปัจจุบัน ไม่ต้องรัน migration ใหม่ รายการทดสอบถูกกันออกจาก cron/การค้นหาสาธารณะ/คิว Flash ห้ามใช้ใบปะหน้า UAT ส่งพัสดุจริง

ถ้าสร้างเลขสำเร็จแต่บันทึก Supabase ไม่สำเร็จ ระบบเก็บผลที่ได้ใน localStorage ของเครื่องนี้ กดสร้างซ้ำที่รายการเดิมเพื่อบันทึกผลเดิมโดยไม่สร้างออเดอร์ใหม่

## ตรวจสอบและ deploy

```bash
node jt-worker.test.mjs
npm run build
npx wrangler deploy --dry-run --config ./wrangler.toml
npx wrangler deploy --keep-vars --config ./wrangler.toml
```

ชุดทดสอบจำลองตรวจ headers, MD5 binary/Base64, สิทธิ์เข้าใช้, สร้าง/ยกเลิก/PDF โดยไม่ส่งข้อมูลไป J&T ผลนี้ยังไม่ใช่ผล UAT จริง และตามเจ้าหน้าที่ J&T ต้องผ่านการทดสอบในหน้า API Doc ก่อน approve production

ยังไม่เปิด production หรือ webhook/การซิงก์สถานะ J&T เพราะยังไม่มีผลทดสอบและเอกสารสถานะที่ยืนยันสำหรับบัญชีนี้ โมดูล J&T และ migration ที่มีอยู่บน main ถูกเก็บไว้สำหรับการต่อยอด ไม่ได้เปิด webhook จากตัวอย่างโดยอัตโนมัติ
