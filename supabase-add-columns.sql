-- เพิ่มคอลัมน์ SalesPerson, FB/Line, SalePrice ในตาราง fx_parcels
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS customer_fb_line TEXT DEFAULT '';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS sale_person TEXT DEFAULT '';
ALTER TABLE fx_parcels ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10,2) DEFAULT 0;
