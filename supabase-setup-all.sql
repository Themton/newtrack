-- ═══════════════════════════════════════════════════════════════════════
-- ⚡ FLASH BACKEND (trackmt) — SETUP รวมทุกอย่าง รันครั้งเดียวจบ
-- วาง SQL นี้ทั้งหมดใน Supabase SQL Editor ของโปรเจกต์ใหม่ → กด Run
-- รันซ้ำได้ ไม่พัง (idempotent) — ตาราง prefix fx_
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════════════════════════════
-- PART 1) ตารางหลัก: พัสดุ / ประวัติสถานะ / การตั้งค่า
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fx_parcels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parcel_no TEXT NOT NULL UNIQUE,
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  sender_address TEXT,
  sender_province TEXT,
  sender_district TEXT,
  sender_subdistrict TEXT,
  sender_postal TEXT,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  receiver_address TEXT NOT NULL,
  receiver_province TEXT,
  receiver_district TEXT,
  receiver_subdistrict TEXT,
  receiver_postal TEXT,
  weight NUMERIC(10,2) DEFAULT 1,
  width NUMERIC(10,2),
  length NUMERIC(10,2),
  height NUMERIC(10,2),
  item_desc TEXT,
  quantity INTEGER DEFAULT 1,
  declared_value NUMERIC(10,2) DEFAULT 0,
  shipping_fee NUMERIC(10,2) DEFAULT 0,
  cod_enabled BOOLEAN DEFAULT false,
  cod_amount NUMERIC(10,2) DEFAULT 0,
  flash_pno TEXT,
  flash_sort_code TEXT,
  flash_dst_code TEXT,
  flash_api_response JSONB,
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft','created','waiting_pickup','picked_up','in_transit',
    'out_for_delivery','delivered','returned','cancelled','failed'
  )),
  label_printed BOOLEAN DEFAULT false,
  label_printed_at TIMESTAMPTZ,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_status_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parcel_id UUID NOT NULL REFERENCES fx_parcels(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- PART 2) Functions + Triggers
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fx_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fx_parcels_updated ON fx_parcels;
CREATE TRIGGER fx_parcels_updated
  BEFORE UPDATE ON fx_parcels
  FOR EACH ROW EXECUTE FUNCTION fx_update_timestamp();

CREATE OR REPLACE FUNCTION fx_log_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO fx_status_history (parcel_id, old_status, new_status)
    VALUES (NEW.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fx_parcels_status_log ON fx_parcels;
CREATE TRIGGER fx_parcels_status_log
  AFTER UPDATE ON fx_parcels
  FOR EACH ROW EXECUTE FUNCTION fx_log_status_change();

-- ═══════════════════════════════════════════════════════════════════════
-- PART 3) ผู้ใช้ (Login) + Login logs
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fx_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,                    -- SHA-256 hash (ฝั่ง client)
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'shipping' CHECK (role IN ('admin','shipping','accounting')),
  avatar_color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_login_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES fx_users(id),
  username TEXT,
  action TEXT DEFAULT 'login' CHECK (action IN ('login','logout','failed')),
  ip_info TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS fx_users_updated ON fx_users;
CREATE TRIGGER fx_users_updated
  BEFORE UPDATE ON fx_users
  FOR EACH ROW EXECUTE FUNCTION fx_update_timestamp();

-- บัญชีเริ่มต้น (รหัสผ่านเป็น SHA-256)  admin/admin1234 · shipping1/ship1234 · accounting1/acc1234
INSERT INTO fx_users (username, password, display_name, role, avatar_color) VALUES
  ('admin',       'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270', 'แอดมิน',          'admin',      '#dc2626'),
  ('shipping1',   'cbd453740429deef820351bbabb46442adb771f5b875fe40f6904200faccd0f4', 'พนักงานจัดส่ง 1', 'shipping',   '#0284c7'),
  ('accounting1', 'c1448fcada3456ad36fd4a729e83672213b06252144755fbba34fa7fcbde7f01', 'พนักงานบัญชี 1',  'accounting', '#059669')
ON CONFLICT (username) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- PART 4) ร้านค้า (Shops)
-- ═══════════════════════════════════════════════════════════════════════
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

ALTER TABLE fx_shops ADD COLUMN IF NOT EXISTS flash_mch_id TEXT DEFAULT 'CBC9351';

DROP TRIGGER IF EXISTS fx_shops_updated ON fx_shops;
CREATE TRIGGER fx_shops_updated
  BEFORE UPDATE ON fx_shops FOR EACH ROW EXECUTE FUNCTION fx_update_timestamp();

INSERT INTO fx_shops (name, phone, address, province, is_default) VALUES
  ('ร้านค้าหลัก', '0812345678', '123 ถ.สุขุมวิท', 'กรุงเทพมหานคร', true)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- PART 5) Upsell
-- ═══════════════════════════════════════════════════════════════════════
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
  parcel_created BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- PART 6) คอลัมน์เสริมใน fx_parcels (รวมจากทุกไฟล์อัปเดต)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES fx_users(id);
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES fx_shops(id);
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS flash_state INT;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS flash_status TEXT DEFAULT '';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS flash_detail TEXT DEFAULT '';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS flash_updated_at TIMESTAMPTZ;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS customer_fb_line TEXT DEFAULT '';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS sale_person TEXT DEFAULT '';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS upsell_by TEXT DEFAULT '';

-- ═══════════════════════════════════════════════════════════════════════
-- PART 7) ค่าตั้งต้น (Settings)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO fx_settings (key, value) VALUES
  ('default_sender', '{"name":"ร้านค้าตัวอย่าง","phone":"0812345678","address":"123 ถ.สุขุมวิท","province":"กรุงเทพมหานคร","district":"วัฒนา","subdistrict":"คลองเตยเหนือ","postal":"10110"}'::jsonb),
  ('parcel_counter', '{"date":"2026-04-04","counter":0}'::jsonb),
  ('last_updated', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- PART 8) INDEXES
-- ═══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_fx_parcels_no ON fx_parcels(parcel_no);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_flash_pno ON fx_parcels(flash_pno);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_status ON fx_parcels(status);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_created ON fx_parcels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_receiver_phone ON fx_parcels(receiver_phone);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_shop ON fx_parcels(shop_id);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_flash_status ON fx_parcels(flash_status);
CREATE INDEX IF NOT EXISTS idx_fx_status_history_parcel ON fx_status_history(parcel_id);
CREATE INDEX IF NOT EXISTS idx_fx_users_username ON fx_users(username);
CREATE INDEX IF NOT EXISTS idx_fx_users_role ON fx_users(role);
CREATE INDEX IF NOT EXISTS idx_fx_users_login ON fx_users(username, password, is_active);
CREATE INDEX IF NOT EXISTS idx_fx_login_logs_user ON fx_login_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_fx_shops_active ON fx_shops(is_active);

-- ═══════════════════════════════════════════════════════════════════════
-- PART 9) Row Level Security (granular — ปลอดภัยกว่าแบบเปิดหมด)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE fx_parcels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_login_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_shops          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_upsell         ENABLE ROW LEVEL SECURITY;

-- fx_parcels: ลบได้เฉพาะ draft/cancelled
DROP POLICY IF EXISTS "fx_parcels_all" ON fx_parcels;
DROP POLICY IF EXISTS "fx_parcels_select" ON fx_parcels;
DROP POLICY IF EXISTS "fx_parcels_insert" ON fx_parcels;
DROP POLICY IF EXISTS "fx_parcels_update" ON fx_parcels;
DROP POLICY IF EXISTS "fx_parcels_delete" ON fx_parcels;
CREATE POLICY "fx_parcels_select" ON fx_parcels FOR SELECT USING (true);
CREATE POLICY "fx_parcels_insert" ON fx_parcels FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_parcels_update" ON fx_parcels FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_parcels_delete" ON fx_parcels FOR DELETE USING (status IN ('draft','cancelled'));

-- fx_users: ลบ admin ไม่ได้
DROP POLICY IF EXISTS "fx_users_all" ON fx_users;
DROP POLICY IF EXISTS "fx_users_select" ON fx_users;
DROP POLICY IF EXISTS "fx_users_insert" ON fx_users;
DROP POLICY IF EXISTS "fx_users_update" ON fx_users;
DROP POLICY IF EXISTS "fx_users_delete" ON fx_users;
CREATE POLICY "fx_users_select" ON fx_users FOR SELECT USING (true);
CREATE POLICY "fx_users_insert" ON fx_users FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_users_update" ON fx_users FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_users_delete" ON fx_users FOR DELETE USING (role != 'admin');

-- fx_shops: เต็มสิทธิ์
DROP POLICY IF EXISTS "fx_shops_all" ON fx_shops;
DROP POLICY IF EXISTS "fx_shops_select" ON fx_shops;
DROP POLICY IF EXISTS "fx_shops_insert" ON fx_shops;
DROP POLICY IF EXISTS "fx_shops_update" ON fx_shops;
DROP POLICY IF EXISTS "fx_shops_delete" ON fx_shops;
CREATE POLICY "fx_shops_select" ON fx_shops FOR SELECT USING (true);
CREATE POLICY "fx_shops_insert" ON fx_shops FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_shops_update" ON fx_shops FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_shops_delete" ON fx_shops FOR DELETE USING (true);

-- fx_login_logs: ลบไม่ได้
DROP POLICY IF EXISTS "fx_login_logs_all" ON fx_login_logs;
DROP POLICY IF EXISTS "fx_login_logs_select" ON fx_login_logs;
DROP POLICY IF EXISTS "fx_login_logs_insert" ON fx_login_logs;
DROP POLICY IF EXISTS "fx_login_logs_delete" ON fx_login_logs;
CREATE POLICY "fx_login_logs_select" ON fx_login_logs FOR SELECT USING (true);
CREATE POLICY "fx_login_logs_insert" ON fx_login_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_login_logs_delete" ON fx_login_logs FOR DELETE USING (false);

-- fx_settings: ลบไม่ได้
DROP POLICY IF EXISTS "fx_settings_all" ON fx_settings;
DROP POLICY IF EXISTS "fx_settings_select" ON fx_settings;
DROP POLICY IF EXISTS "fx_settings_insert" ON fx_settings;
DROP POLICY IF EXISTS "fx_settings_update" ON fx_settings;
DROP POLICY IF EXISTS "fx_settings_delete" ON fx_settings;
CREATE POLICY "fx_settings_select" ON fx_settings FOR SELECT USING (true);
CREATE POLICY "fx_settings_insert" ON fx_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_settings_update" ON fx_settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_settings_delete" ON fx_settings FOR DELETE USING (false);

-- fx_status_history: ลบไม่ได้
DROP POLICY IF EXISTS "fx_status_history_all" ON fx_status_history;
DROP POLICY IF EXISTS "fx_status_history_select" ON fx_status_history;
DROP POLICY IF EXISTS "fx_status_history_insert" ON fx_status_history;
DROP POLICY IF EXISTS "fx_status_history_delete" ON fx_status_history;
CREATE POLICY "fx_status_history_select" ON fx_status_history FOR SELECT USING (true);
CREATE POLICY "fx_status_history_insert" ON fx_status_history FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_status_history_delete" ON fx_status_history FOR DELETE USING (false);

-- fx_upsell: ลบได้เฉพาะ pending/cancelled
DROP POLICY IF EXISTS "fx_upsell_select" ON fx_upsell;
DROP POLICY IF EXISTS "fx_upsell_insert" ON fx_upsell;
DROP POLICY IF EXISTS "fx_upsell_update" ON fx_upsell;
DROP POLICY IF EXISTS "fx_upsell_delete" ON fx_upsell;
CREATE POLICY "fx_upsell_select" ON fx_upsell FOR SELECT USING (true);
CREATE POLICY "fx_upsell_insert" ON fx_upsell FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_upsell_update" ON fx_upsell FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_upsell_delete" ON fx_upsell FOR DELETE USING (status IN ('pending','cancelled'));

-- ═══════════════════════════════════════════════════════════════════════
-- PART 10) Realtime (เพิ่มตารางเข้า publication — ข้ามถ้าเพิ่มแล้ว/ไม่มี publication)
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['fx_parcels','fx_users','fx_shops','fx_upsell'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- เสร็จสิ้น ✅  ล็อกอินด้วย  admin / admin1234  (เปลี่ยนรหัสทันทีหลังใช้งานจริง)
-- ═══════════════════════════════════════════════════════════════════════
