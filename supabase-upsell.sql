-- ═══ ตาราง Upsell ═══
CREATE TABLE IF NOT EXISTS fx_upsell (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  receiver_address TEXT DEFAULT '-',
  receiver_subdistrict TEXT DEFAULT '',
  receiver_district TEXT DEFAULT '',
  receiver_province TEXT DEFAULT '',
  receiver_postal TEXT DEFAULT '',
  original_product TEXT DEFAULT '',
  upsell_product TEXT DEFAULT '',
  upsell_price NUMERIC DEFAULT 0,
  cod_amount NUMERIC DEFAULT 0,
  remark TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  upsell_by TEXT DEFAULT '',
  upsell_note TEXT DEFAULT '',
  shop_id UUID,
  created_by UUID,
  created_by_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fx_upsell ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fx_upsell_select" ON fx_upsell FOR SELECT USING (true);
CREATE POLICY "fx_upsell_insert" ON fx_upsell FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_upsell_update" ON fx_upsell FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_upsell_delete" ON fx_upsell FOR DELETE USING (status IN ('pending', 'cancelled'));

-- เพิ่มคอลัมน์ parcel_created
DO $$ BEGIN
  ALTER TABLE fx_upsell ADD COLUMN parcel_created BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
