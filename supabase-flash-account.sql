-- เพิ่มคอลัมน์ flash_mch_id ในตาราง fx_shops
DO $$ BEGIN
  ALTER TABLE fx_shops ADD COLUMN flash_mch_id TEXT DEFAULT 'CBC9351';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
