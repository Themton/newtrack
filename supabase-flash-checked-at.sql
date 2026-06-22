-- ============================================================
--  เพิ่มคอลัมน์ flash_checked_at สำหรับ Auto-Sync v3.0 (round-robin)
--  รันใน Supabase → SQL Editor  ก่อน deploy worker v3.0
-- ============================================================

-- คอลัมน์เก็บ "เวลาที่เช็กสถานะ Flash ครั้งล่าสุด" (ใช้จัดคิวหมุนเช็กให้ครบทุกพัสดุ)
ALTER TABLE fx_parcels
  ADD COLUMN IF NOT EXISTS flash_checked_at timestamptz;

-- index ช่วยให้การเรียง "ค้างเช็กนานสุด/ยังไม่เคยเช็ก ขึ้นก่อน" เร็วแม้มีหลายพันแถว
CREATE INDEX IF NOT EXISTS idx_fx_parcels_flash_checked_at
  ON fx_parcels (flash_checked_at ASC NULLS FIRST);
