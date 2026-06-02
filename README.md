# ⚡ FLASH TRACK — ระบบติดตาม/จัดการพัสดุ (Supabase)

ระบบเช็คสถานะพัสดุสไตล์ขนส่งด่วน ทำงานแบบ static (HTML/CSS/JS) เรียก **Supabase** ตรงจากเบราว์เซอร์ — ขึ้น **GitHub Pages** ได้เลย ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง

```
trackmt/
├── index.html          หน้าเช็คพัสดุ (ลูกค้า)
├── admin.html          หน้าหลังบ้าน: login + จัดการพัสดุ
├── assets/
│   ├── config.js       ⬅️ ใส่ค่า Supabase ตรงนี้
│   ├── style.css
│   ├── statuses.js     นิยามสถานะพัสดุ
│   ├── track.js        logic หน้าลูกค้า
│   └── admin.js        logic หน้า admin
└── database/
    └── schema.sql      ⬅️ รันใน Supabase ครั้งเดียว
```

---

## ขั้นตอนติดตั้ง (5 ขั้น)

### 1) สร้างโปรเจกต์ Supabase
ไปที่ https://supabase.com → New project → ตั้งชื่อ + รหัสผ่านฐานข้อมูล → รอสัก 1–2 นาที

### 2) สร้างตาราง + ฟังก์ชัน
เปิด **SQL Editor → New query** → คัดลอกทั้งหมดจาก `database/schema.sql` ไปวาง → กด **Run**
ระบบจะสร้างตาราง `parcels`, `tracking_events`, ฟังก์ชันเช็คพัสดุ `track_parcel()`, RLS และข้อมูลตัวอย่าง `FL1234567890`

### 3) ใส่ค่าเชื่อมต่อใน `assets/config.js`
หาค่าได้จาก **Project Settings → Data API** (หรือ API)
```js
const SUPABASE_URL = "https://xxxx.supabase.co";   // Project URL
const SUPABASE_ANON_KEY = "eyJhbGciOi...";          // anon public key
```
> anon key เปิดเผยได้ ปลอดภัยเพราะมี RLS คุม — ลูกค้าเข้าถึงข้อมูลได้ผ่านฟังก์ชัน `track_parcel()` เท่านั้น อ่านตารางตรง ๆ ไม่ได้

### 4) สร้างบัญชีพนักงาน (admin)
**Authentication → Users → Add user** → ใส่อีเมล + รหัสผ่าน → ติ๊ก *Auto Confirm User*
ใช้บัญชีนี้ login ที่หน้า `admin.html`

### 5) ทดสอบ
เปิด `index.html` ด้วย Live Server (หรือดูข้อ deploy ด้านล่าง) แล้วลองเช็คเลข `FL1234567890`

> เปิดไฟล์ตรง ๆ แบบ `file://` ระบบ login อาจไม่ทำงานเต็มที่ ควรเปิดผ่าน http — ใช้ส่วนขยาย **Live Server** ของ VS Code หรือรัน `python3 -m http.server`

---

## Deploy ขึ้น GitHub Pages

1. สร้าง repo ใหม่บน GitHub แล้วอัปโหลดไฟล์ทั้งหมด (หรือ push):
   ```bash
   git init
   git add .
   git commit -m "flash track"
   git branch -M main
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
2. ไปที่ **repo → Settings → Pages**
3. **Source:** Deploy from a branch → **Branch:** `main` / `/ (root)` → Save
4. รอสักครู่ เว็บจะอยู่ที่ `https://<user>.github.io/<repo>/`

> อย่าลืม commit `assets/config.js` ที่ใส่ค่าจริงแล้ว — เพราะเป็น static site ที่ต้องใช้ค่านี้ตอนรัน (anon key เปิดเผยได้)

---

## โครงสร้างข้อมูล

**parcels** — ข้อมูลพัสดุ (เลขพัสดุ, ผู้ส่ง/ผู้รับ, สถานะปัจจุบัน, น้ำหนัก, COD ฯลฯ)
**tracking_events** — ประวัติการขนส่งแต่ละสเต็ป (เพิ่ม event ใหม่ → สถานะพัสดุอัปเดตอัตโนมัติด้วย trigger)

### สถานะที่รองรับ
`created` รับเข้าระบบ · `picked_up` เข้ารับแล้ว · `at_sorting` ถึงศูนย์คัดแยก · `in_transit` กำลังขนส่ง · `out_for_delivery` กำลังนำจ่าย · `delivered` ส่งสำเร็จ · `failed` ไม่สำเร็จ · `returned` ตีกลับ

แก้/เพิ่มสถานะได้ที่ `assets/statuses.js` (ปรับ label/ไอคอน/สีได้)

---

## วิธีใช้งานหน้า Admin
- **เพิ่มพัสดุ:** ปุ่ม "+ เพิ่มพัสดุ" → กรอกข้อมูล → ระบบใส่ event แรกให้อัตโนมัติ
- **อัปเดตสถานะ:** กด "แก้ไข" → เลื่อนลงส่วน *ประวัติการขนส่ง* → เพิ่มสถานะใหม่ (สถานะปัจจุบันของพัสดุจะเปลี่ยนตาม event ล่าสุดให้เอง)
- **ลูกค้าเช็คพัสดุ:** ส่งลิงก์ `index.html#FL1234567890` ให้ลูกค้าเปิดดูได้ทันที

---

ตัวอย่างเพื่อการศึกษา — ปรับแต่งต่อได้ตามต้องการ
