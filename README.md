# ⚡ Flash Backend — ระบบจัดการพัสดุขนส่งแฟลช

## ฟีเจอร์
- 📦 สร้างเลขพัสดุอัตโนมัติ (FX-YYMMDD-XXXX)
- ✏️ แก้ไขข้อมูลผู้ส่ง/ผู้รับ
- 🔄 อัพเดตสถานะ 10 สถานะ
- 🖨️ ปริ้นใบลาเบล 100×75mm
- ☁️ Supabase + Cloudflare Worker
- ⚡ Realtime ทุกเครื่อง
- 📱 Responsive มือถือ

## ตั้งค่า
1. รัน `supabase-schema.sql` ใน Supabase SQL Editor
2. Deploy `cloudflare-worker.js` บน Cloudflare Workers
3. แก้ค่า `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BASE_URL` ใน `src/App.jsx`

## ฐานข้อมูล (prefix: fx_)
| ตาราง | คำอธิบาย |
|-------|---------|
| fx_parcels | พัสดุทั้งหมด |
| fx_status_history | ประวัติสถานะ |
| fx_settings | การตั้งค่า |

> ไม่ชนกับ `mt_*` (ระบบยอดขาย) และ `orders/shops` (ระบบจัดส่งเดิม)
