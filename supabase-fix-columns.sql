-- ───────────────────────────────────────────────────────────
--  แก้ schema/RLS drift ทั้งหมดที่เจอ (รันใน Supabase SQL Editor → Run, รันซ้ำได้)
-- ───────────────────────────────────────────────────────────

-- 1) คอลัมน์ที่ตกหล่น
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS source    TEXT DEFAULT 'manual';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS upsell_by TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS customer_fb_line TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS item_desc        TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS sale_person      TEXT DEFAULT '';
ALTER TABLE fx_upsell  ADD COLUMN IF NOT EXISTS sale_price       NUMERIC DEFAULT 0;

-- 2) ถอด CHECK constraint ของ status (แอปใช้ค่าเช่น printed/pending และข้อความสถานะ Flash ภาษาไทย)
ALTER TABLE fx_parcels DROP CONSTRAINT IF EXISTS fx_parcels_status_check;

-- 3) แก้ RLS: ให้ลบ fx_upsell ได้ทุกสถานะ (เดิมลบได้แค่ pending/cancelled → ลบ success ไม่ออก)
DROP POLICY IF EXISTS "fx_upsell_delete" ON fx_upsell;
CREATE POLICY "fx_upsell_delete" ON fx_upsell FOR DELETE USING (true);

-- รีโหลด schema cache
NOTIFY pgrst, 'reload schema';
