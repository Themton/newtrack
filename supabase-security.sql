-- ═══ SECURITY UPGRADE ═══
-- 1. fx_shops — เพิ่ม RLS
ALTER TABLE fx_shops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fx_shops_all" ON fx_shops;
CREATE POLICY "fx_shops_all" ON fx_shops FOR ALL USING (true) WITH CHECK (true);

-- 2. Password hashing — ตรวจว่า password เป็น SHA-256 hash (64 chars hex)
-- ถ้ายังเป็น plaintext ให้ update:
-- UPDATE fx_users SET password = encode(sha256(password::bytea), 'hex') WHERE length(password) < 64;

-- 3. เพิ่ม index สำหรับ login query
CREATE INDEX IF NOT EXISTS idx_fx_users_login ON fx_users(username, password, is_active);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_shop ON fx_parcels(shop_id);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_status ON fx_parcels(status);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_created ON fx_parcels(created_at DESC);
