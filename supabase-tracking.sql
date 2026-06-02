-- เพิ่มคอลัมน์สถานะ Flash จริง
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN flash_state INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN flash_status TEXT DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN flash_detail TEXT DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN flash_updated_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
