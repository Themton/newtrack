-- ═══ เพิ่มคอลัมน์ flash_status สำหรับ Auto-Sync ═══
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS flash_status TEXT DEFAULT '';

-- เพิ่ม last_updated สำหรับ Realtime (ถ้ายังไม่มี)
INSERT INTO fx_settings (key, value) VALUES ('last_updated', '0')
ON CONFLICT (key) DO NOTHING;

-- Index สำหรับ sync query
CREATE INDEX IF NOT EXISTS idx_fx_parcels_flash_status ON fx_parcels(flash_status);
