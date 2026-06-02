-- ───────────────────────────────────────────────────────────
--  แก้ error: Could not find the 'source' column of 'fx_parcels'
--  เติม 2 คอลัมน์ที่ฟีเจอร์ Import/Upsell ต้องใช้ แต่ schema เดิมตกหล่น
--  วาง SQL นี้ใน Supabase SQL Editor (โปรเจกต์ใหม่) → Run  (รันซ้ำได้)
-- ───────────────────────────────────────────────────────────
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS source    TEXT DEFAULT 'manual';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS upsell_by TEXT DEFAULT '';

-- บังคับให้ PostgREST รีโหลด schema cache ทันที (กัน error ค้าง)
NOTIFY pgrst, 'reload schema';
