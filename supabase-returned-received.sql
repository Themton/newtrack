-- ============================================================
--  เพิ่มคอลัมน์สำหรับฟีเจอร์ "สแกนรับพัสดุตีกลับ"
--  รันใน Supabase → SQL Editor  ก่อนใช้งานเมนูใหม่
-- ============================================================

ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS returned_received boolean DEFAULT false;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS returned_received_at timestamptz;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS returned_received_by text;

-- index ช่วยให้นับ/ค้น "ตีกลับที่ยังไม่รับ" เร็ว
CREATE INDEX IF NOT EXISTS idx_fx_parcels_returned_received
  ON fx_parcels (returned_received);
