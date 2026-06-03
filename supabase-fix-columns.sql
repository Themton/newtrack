-- ───────────────────────────────────────────────────────────
--  แก้ schema/RLS/constraint drift ทั้งหมด (รันใน Supabase SQL Editor → Run, รันซ้ำได้)
-- ───────────────────────────────────────────────────────────

-- 1) คอลัมน์ที่ตกหล่น
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS source    TEXT DEFAULT 'manual';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS upsell_by TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS customer_fb_line TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS item_desc        TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS sale_person      TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS sale_price       NUMERIC DEFAULT 0;

-- 2) ถอด CHECK ของ status (แอปใช้ printed/pending + ข้อความ Flash ไทย)
ALTER TABLE fx_parcels DROP CONSTRAINT IF EXISTS fx_parcels_status_check;

-- 3) ลบ fx_upsell ได้ทุกสถานะ
DROP POLICY IF EXISTS "fx_upsell_delete" ON fx_upsell;
CREATE POLICY "fx_upsell_delete" ON fx_upsell FOR DELETE USING (true);

-- 4) ลบ fx_parcels ได้ทุกสถานะ (เดิมลบได้แค่ draft/cancelled → ลบใบที่สร้างเลข/ปริ้นแล้วไม่ออก)
DROP POLICY IF EXISTS "fx_parcels_delete" ON fx_parcels;
CREATE POLICY "fx_parcels_delete" ON fx_parcels FOR DELETE USING (true);

-- 5) อนุญาต role 'tracking' (เมนูสร้าง user มีให้เลือก แต่ DB เดิมบล็อก)
ALTER TABLE fx_users DROP CONSTRAINT IF EXISTS fx_users_role_check;
ALTER TABLE fx_users ADD CONSTRAINT fx_users_role_check CHECK (role IN ('admin','shipping','accounting','tracking'));

-- 6) กระทบยอด COD
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS cod_received    BOOLEAN DEFAULT false;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS cod_received_at TIMESTAMPTZ;

-- 7) ตารางบันทึกกิจกรรม (Activity Log)
CREATE TABLE IF NOT EXISTS fx_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID, actor_name TEXT, action TEXT, detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE fx_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fx_activity_log_select" ON fx_activity_log;
CREATE POLICY "fx_activity_log_select" ON fx_activity_log FOR SELECT USING (true);
DROP POLICY IF EXISTS "fx_activity_log_insert" ON fx_activity_log;
CREATE POLICY "fx_activity_log_insert" ON fx_activity_log FOR INSERT WITH CHECK (true);

-- รีโหลด schema cache
NOTIFY pgrst, 'reload schema';
