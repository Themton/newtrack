-- ═══════════════════════════════════════════════════════════════════
--  รองรับขนส่งหลายเจ้า (Flash + J&T)
--  ปลอดภัย: ไม่ลบคอลัมน์เดิม ข้อมูลเก่าไม่หาย รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) คอลัมน์กลาง ใช้ร่วมกันทุกขนส่ง ────────────────────────────
ALTER TABLE fx_parcels
  ADD COLUMN IF NOT EXISTS carrier            TEXT DEFAULT 'flash',  -- 'flash' | 'jt'
  ADD COLUMN IF NOT EXISTS tracking_no        TEXT,                  -- เลขพัสดุ (flash_pno / J&T billCode)
  ADD COLUMN IF NOT EXISTS sorting_code       TEXT,                  -- รหัสคัดแยกบนใบปะหน้า
  ADD COLUMN IF NOT EXISTS sorting_code_3     TEXT,                  -- รหัสส่วนที่สาม/สี่ (J&T)
  ADD COLUMN IF NOT EXISTS carrier_status     TEXT,
  ADD COLUMN IF NOT EXISTS carrier_detail     TEXT,
  ADD COLUMN IF NOT EXISTS carrier_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_checked_at TIMESTAMPTZ;

-- ── 2) ย้ายข้อมูล Flash เดิมเข้าคอลัมน์กลาง ──────────────────────
UPDATE fx_parcels SET
  carrier            = COALESCE(carrier, 'flash'),
  tracking_no        = COALESCE(tracking_no, flash_pno),
  sorting_code       = COALESCE(sorting_code, flash_sort_code),
  carrier_status     = COALESCE(carrier_status, flash_status),
  carrier_detail     = COALESCE(carrier_detail, flash_detail),
  carrier_updated_at = COALESCE(carrier_updated_at, flash_updated_at),
  carrier_checked_at = COALESCE(carrier_checked_at, flash_checked_at)
WHERE tracking_no IS NULL OR carrier IS NULL;

-- ── 3) ระหว่างช่วงเปลี่ยนผ่าน: sync flash_* ↔ carrier_* อัตโนมัติ ──
-- ทำให้โค้ดเก่าที่ยังอ่าน flash_* ทำงานต่อได้ ไม่ต้องแก้ UI ทั้ง 89 จุดพร้อมกัน
CREATE OR REPLACE FUNCTION fx_sync_carrier_cols() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.carrier IS NULL THEN NEW.carrier := 'flash'; END IF;

  -- เขียนผ่าน flash_* (โค้ดเก่า) → เติมให้ carrier_*
  IF NEW.flash_pno IS DISTINCT FROM OLD.flash_pno AND NEW.flash_pno IS NOT NULL THEN
    NEW.tracking_no := NEW.flash_pno;
  END IF;
  IF NEW.flash_status IS DISTINCT FROM OLD.flash_status THEN
    NEW.carrier_status := NEW.flash_status;
    NEW.carrier_detail := NEW.flash_detail;
    NEW.carrier_updated_at := NEW.flash_updated_at;
  END IF;

  -- เขียนผ่าน carrier_* (โค้ดใหม่/webhook J&T) → สะท้อนกลับ flash_* ให้ UI เก่าเห็น
  IF NEW.carrier_status IS DISTINCT FROM OLD.carrier_status AND NEW.carrier_status IS NOT NULL THEN
    NEW.flash_status := NEW.carrier_status;
    NEW.flash_detail := NEW.carrier_detail;
    NEW.flash_updated_at := NEW.carrier_updated_at;
  END IF;
  IF NEW.tracking_no IS DISTINCT FROM OLD.tracking_no AND NEW.tracking_no IS NOT NULL THEN
    NEW.flash_pno := NEW.tracking_no;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fx_sync_carrier ON fx_parcels;
CREATE TRIGGER trg_fx_sync_carrier BEFORE UPDATE ON fx_parcels
  FOR EACH ROW EXECUTE FUNCTION fx_sync_carrier_cols();

-- ── 4) ร้านค้า: เก็บรหัสลูกค้า J&T แยกจาก Flash ──────────────────
ALTER TABLE fx_shops
  ADD COLUMN IF NOT EXISTS jt_customer_code TEXT,
  ADD COLUMN IF NOT EXISTS carriers TEXT[] DEFAULT ARRAY['flash'];

-- ── 5) Index ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fx_parcels_tracking_no ON fx_parcels(tracking_no);
CREATE INDEX IF NOT EXISTS idx_fx_parcels_carrier     ON fx_parcels(carrier);

-- ── 6) ตรวจผล ────────────────────────────────────────────────────
-- SELECT carrier, COUNT(*), COUNT(tracking_no) FROM fx_parcels GROUP BY carrier;
