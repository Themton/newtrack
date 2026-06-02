-- ═══════════════════════════════════════════════════════════════════════
-- ⚡ Flash Backend — FULL SETUP (รันครั้งเดียวจบ)
-- วาง SQL นี้ทั้งหมดใน Supabase SQL Editor → กด Run
-- 
-- ตาราง prefix fx_ ทั้งหมด ไม่ชนกับ mt_* หรือ orders/shops/staff
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- Flash Express Backend — Supabase Schema
-- PREFIX: fx_ (ไม่ชนกับ mt_ / orders / shops / staff ที่มีอยู่)
-- ═══════════════════════════════════════════════════════════════════════

-- 1) พัสดุ (Parcels) — ตารางหลัก
CREATE TABLE IF NOT EXISTS fx_parcels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- เลขพัสดุภายใน
  parcel_no TEXT NOT NULL UNIQUE,           -- FX-250404-0001
  
  -- ข้อมูลผู้ส่ง
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  sender_address TEXT,
  sender_province TEXT,
  sender_district TEXT,
  sender_subdistrict TEXT,
  sender_postal TEXT,
  
  -- ข้อมูลผู้รับ
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT NOT NULL,
  receiver_address TEXT NOT NULL,
  receiver_province TEXT,
  receiver_district TEXT,
  receiver_subdistrict TEXT,
  receiver_postal TEXT,
  
  -- ข้อมูลพัสดุ
  weight NUMERIC(10,2) DEFAULT 1,           -- กิโลกรัม
  width NUMERIC(10,2),                      -- cm
  length NUMERIC(10,2),                     -- cm
  height NUMERIC(10,2),                     -- cm
  item_desc TEXT,                           -- รายละเอียดสินค้า
  quantity INTEGER DEFAULT 1,
  
  -- ราคา / COD
  declared_value NUMERIC(10,2) DEFAULT 0,   -- มูลค่าสินค้า
  shipping_fee NUMERIC(10,2) DEFAULT 0,     -- ค่าส่ง
  cod_enabled BOOLEAN DEFAULT false,
  cod_amount NUMERIC(10,2) DEFAULT 0,
  
  -- Flash Express
  flash_pno TEXT,                            -- เลข Tracking จาก Flash (TH...)
  flash_sort_code TEXT,                      -- Sort code
  flash_dst_code TEXT,                       -- Destination code
  flash_api_response JSONB,                  -- Raw API response
  
  -- สถานะ
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft',            -- ร่าง
    'created',          -- สร้างเลขแล้ว
    'waiting_pickup',   -- รอเข้ารับ
    'picked_up',        -- รับพัสดุแล้ว
    'in_transit',       -- กำลังขนส่ง
    'out_for_delivery', -- กำลังนำจ่าย
    'delivered',        -- จัดส่งสำเร็จ
    'returned',         -- ตีกลับ
    'cancelled',        -- ยกเลิก
    'failed'            -- จัดส่งไม่สำเร็จ
  )),
  
  label_printed BOOLEAN DEFAULT false,
  label_printed_at TIMESTAMPTZ,
  remark TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2) ประวัติสถานะ (Status History)
CREATE TABLE IF NOT EXISTS fx_status_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parcel_id UUID NOT NULL REFERENCES fx_parcels(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- 3) การตั้งค่า (Settings)
CREATE TABLE IF NOT EXISTS fx_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_fx_parcels_no ON fx_parcels(parcel_no);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_flash_pno ON fx_parcels(flash_pno);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_status ON fx_parcels(status);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_created ON fx_parcels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_receiver_phone ON fx_parcels(receiver_phone);
CREATE INDEX IF NOT EXISTS idx_fx_status_history_parcel ON fx_status_history(parcel_id);

-- ═══ AUTO-UPDATE updated_at ═══
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

-- ═══ AUTO-LOG STATUS CHANGES ═══
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

-- ═══ Realtime ═══
ALTER PUBLICATION supabase_realtime ADD TABLE fx_parcels;

-- ═══ RLS (Row Level Security) ═══
ALTER TABLE fx_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_settings ENABLE ROW LEVEL SECURITY;

-- Allow all for anon key (adjust for your auth setup)
DO $$ BEGIN
  CREATE POLICY "fx_parcels_all" ON fx_parcels FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fx_status_history_all" ON fx_status_history FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fx_settings_all" ON fx_settings FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══ DEFAULT SETTINGS ═══
INSERT INTO fx_settings (key, value) VALUES 
  ('default_sender', '{"name":"ร้านค้าตัวอย่าง","phone":"0812345678","address":"123 ถ.สุขุมวิท","province":"กรุงเทพมหานคร","district":"วัฒนา","subdistrict":"คลองเตยเหนือ","postal":"10110"}'::jsonb),
  ('parcel_counter', '{"date":"2026-04-04","counter":0}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- PART 2: ระบบ Login + Users
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- Flash Backend — เพิ่มระบบ Login (fx_users)
-- รันเพิ่มจาก schema เดิม — ไม่กระทบตารางที่มีอยู่
-- ═══════════════════════════════════════════════════════════════════════

-- 1) ตารางผู้ใช้ (Users)
CREATE TABLE IF NOT EXISTS fx_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,                    -- hash ฝั่ง client (SHA-256)
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'shipping' CHECK (role IN ('admin', 'shipping', 'accounting')),
  avatar_color TEXT DEFAULT '#6366f1',       -- สีประจำตัว
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2) บันทึกการล็อคอิน (Login Logs)
CREATE TABLE IF NOT EXISTS fx_login_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES fx_users(id),
  username TEXT,
  action TEXT DEFAULT 'login' CHECK (action IN ('login', 'logout', 'failed')),
  ip_info TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══ INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_fx_users_username ON fx_users(username);
CREATE INDEX IF NOT EXISTS idx_fx_users_role ON fx_users(role);
CREATE INDEX IF NOT EXISTS idx_fx_login_logs_user ON fx_login_logs(user_id);

-- ═══ เพิ่ม created_by ใน fx_parcels (เชื่อมว่าใครสร้าง) ═══
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN created_by UUID REFERENCES fx_users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN created_by_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ═══ AUTO-UPDATE updated_at สำหรับ fx_users ═══
DROP TRIGGER IF EXISTS fx_users_updated ON fx_users;
CREATE TRIGGER fx_users_updated
  BEFORE UPDATE ON fx_users
  FOR EACH ROW EXECUTE FUNCTION fx_update_timestamp();

-- ═══ RLS ═══
ALTER TABLE fx_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_login_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "fx_users_all" ON fx_users FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fx_login_logs_all" ON fx_login_logs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══ DEFAULT ACCOUNTS (password = SHA-256 hash) ═══
-- admin / admin1234  → SHA-256
-- shipping1 / ship1234
-- accounting1 / acc1234
INSERT INTO fx_users (username, password, display_name, role, avatar_color) VALUES
  ('admin', 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270', 'แอดมิน', 'admin', '#dc2626'),
  ('shipping1', 'cbd453740429deef820351bbabb46442adb771f5b875fe40f6904200faccd0f4', 'พนักงานจัดส่ง 1', 'shipping', '#0284c7'),
  ('accounting1', 'c1448fcada3456ad36fd4a729e83672213b06252144755fbba34fa7fcbde7f01', 'พนักงานบัญชี 1', 'accounting', '#059669')
ON CONFLICT (username) DO NOTHING;

-- ═══ Realtime ═══
ALTER PUBLICATION supabase_realtime ADD TABLE fx_users;
