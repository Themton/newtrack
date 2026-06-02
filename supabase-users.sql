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
