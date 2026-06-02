-- ═══════════════════════════════════════════════════════════════
-- FIX RLS — จำกัดสิทธิ์ anon role ให้ปลอดภัย
-- ═══════════════════════════════════════════════════════════════

-- 1. fx_parcels — อ่าน/เขียน/แก้ได้ แต่ลบได้เฉพาะ status = draft
DROP POLICY IF EXISTS "fx_parcels_all" ON fx_parcels;
CREATE POLICY "fx_parcels_select" ON fx_parcels FOR SELECT USING (true);
CREATE POLICY "fx_parcels_insert" ON fx_parcels FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_parcels_update" ON fx_parcels FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_parcels_delete" ON fx_parcels FOR DELETE USING (status IN ('draft', 'cancelled'));

-- 2. fx_users — อ่านได้ แก้ได้ แต่ห้ามลบ admin
DROP POLICY IF EXISTS "fx_users_all" ON fx_users;
CREATE POLICY "fx_users_select" ON fx_users FOR SELECT USING (true);
CREATE POLICY "fx_users_insert" ON fx_users FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_users_update" ON fx_users FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_users_delete" ON fx_users FOR DELETE USING (role != 'admin');

-- 3. fx_shops — อ่าน/เขียน/แก้/ลบ ได้ทั้งหมด (ร้านค้าจำกัดน้อย)
DROP POLICY IF EXISTS "fx_shops_all" ON fx_shops;
ALTER TABLE fx_shops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fx_shops_select" ON fx_shops FOR SELECT USING (true);
CREATE POLICY "fx_shops_insert" ON fx_shops FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_shops_update" ON fx_shops FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_shops_delete" ON fx_shops FOR DELETE USING (true);

-- 4. fx_login_logs — เขียนได้ อ่านได้ ลบไม่ได้
DROP POLICY IF EXISTS "fx_login_logs_all" ON fx_login_logs;
CREATE POLICY "fx_login_logs_select" ON fx_login_logs FOR SELECT USING (true);
CREATE POLICY "fx_login_logs_insert" ON fx_login_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_login_logs_delete" ON fx_login_logs FOR DELETE USING (false);

-- 5. fx_settings — อ่าน/เขียนได้ ลบไม่ได้
DROP POLICY IF EXISTS "fx_settings_all" ON fx_settings;
CREATE POLICY "fx_settings_select" ON fx_settings FOR SELECT USING (true);
CREATE POLICY "fx_settings_insert" ON fx_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_settings_update" ON fx_settings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "fx_settings_delete" ON fx_settings FOR DELETE USING (false);

-- 6. fx_status_history — อ่าน/เขียนได้ ลบไม่ได้
DROP POLICY IF EXISTS "fx_status_history_all" ON fx_status_history;
CREATE POLICY "fx_status_history_select" ON fx_status_history FOR SELECT USING (true);
CREATE POLICY "fx_status_history_insert" ON fx_status_history FOR INSERT WITH CHECK (true);
CREATE POLICY "fx_status_history_delete" ON fx_status_history FOR DELETE USING (false);
