-- ═══════════════════════════════════════════════════════════════
-- Flash Backend — เพิ่มร้านค้า (fx_shops)
-- รันเพิ่มจาก schema เดิม
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fx_shops (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  province TEXT,
  district TEXT,
  subdistrict TEXT,
  postal TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_shops_active ON fx_shops(is_active);

ALTER TABLE fx_shops ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "fx_shops_all" ON fx_shops FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS fx_shops_updated ON fx_shops;
CREATE TRIGGER fx_shops_updated
  BEFORE UPDATE ON fx_shops FOR EACH ROW EXECUTE FUNCTION fx_update_timestamp();

-- เพิ่มคอลัมน์ shop_id ใน fx_parcels
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN shop_id UUID REFERENCES fx_shops(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ร้านค้าเริ่มต้น
INSERT INTO fx_shops (name, phone, address, province, is_default) VALUES
  ('ร้านค้าหลัก', '0812345678', '123 ถ.สุขุมวิท', 'กรุงเทพมหานคร', true)
ON CONFLICT DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE fx_shops;
