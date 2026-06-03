-- ───────────────────────────────────────────────────────────
--  แก้ schema drift: เติมคอลัมน์ที่ DB เก่ามีแต่ไฟล์ .sql ตกหล่น
--  (แก้ทั้ง error import พัสดุ และ "รายชื่อ upsell ไม่ขึ้น")
--  วางใน Supabase SQL Editor (โปรเจกต์ใหม่) → Run  (รันซ้ำได้ ปลอดภัย)
-- ───────────────────────────────────────────────────────────

-- fx_parcels: ฟีเจอร์ Import / Upsell ต้องใช้
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS source    TEXT DEFAULT 'manual';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS upsell_by TEXT DEFAULT '';

-- fx_upsell: ฟอร์ม Import upsell เขียนคอลัมน์เหล่านี้
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS customer_fb_line TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS item_desc        TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS sale_person      TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS sale_price       NUMERIC DEFAULT 0;

-- บังคับ PostgREST รีโหลด schema cache ทันที
NOTIFY pgrst, 'reload schema';
