-- ═══════════════════════════════════════════════════════════════
-- ล้างสถานะ "ระหว่างการขนส่ง" ปลอม ที่เกิดจาก default เก่าของ worker
-- (พัสดุที่ Flash ยังไม่มีข้อมูลจริง แต่โดนแปะ "ระหว่างการขนส่ง" ให้เอง)
--
-- เงื่อนไขจับเฉพาะ "ของปลอม" เท่านั้น:
--   - สถานะ = "ระหว่างการขนส่ง"
--   - ไม่มี route detail (ว่าง)
--   - ไม่มีเวลาอัพเดตจริง (ว่าง หรือ เป็นค่า epoch ปี 1970)
-- ของจริงที่ขนส่งอยู่จริงจะมี detail หรือเวลาจริง → ไม่โดนแตะ
--
-- รันใน Supabase → SQL Editor → วาง → Run
-- ═══════════════════════════════════════════════════════════════

-- 1) ดูก่อนว่าจะโดนกี่ใบ (รันอันนี้ก่อนเพื่อเช็ค)
SELECT COUNT(*) AS phantom_count
FROM fx_parcels
WHERE flash_status = 'ระหว่างการขนส่ง'
  AND COALESCE(flash_detail, '') = ''
  AND (flash_updated_at IS NULL OR flash_updated_at < '2000-01-01');

-- 2) ล้างของปลอม → กลับเป็น "ยังไม่เข้ารับ" (สถานะว่าง) + ให้ worker เช็กใหม่รอบแรก
UPDATE fx_parcels
SET flash_status = '',
    flash_detail = '',
    flash_updated_at = NULL,
    flash_checked_at = NULL
WHERE flash_status = 'ระหว่างการขนส่ง'
  AND COALESCE(flash_detail, '') = ''
  AND (flash_updated_at IS NULL OR flash_updated_at < '2000-01-01');
