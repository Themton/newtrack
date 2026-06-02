-- ============================================================
--  FLASH TRACK — Supabase schema
--  รันไฟล์นี้ใน Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- ลบของเดิม (ถ้ารันซ้ำ) -- ระวัง: จะลบข้อมูลทั้งหมด
-- drop table if exists public.tracking_events cascade;
-- drop table if exists public.parcels cascade;

-- ------------------------------------------------------------
-- 1) ตารางพัสดุ
-- ------------------------------------------------------------
create table if not exists public.parcels (
  id              uuid primary key default gen_random_uuid(),
  tracking_no     text not null unique,
  sender_name     text,
  sender_phone    text,
  sender_address  text,
  receiver_name   text,
  receiver_phone  text,
  receiver_address text,
  status          text not null default 'created',
  weight          numeric,            -- กิโลกรัม
  cod_amount      numeric default 0,  -- เก็บเงินปลายทาง
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) ตารางประวัติสถานะ (timeline)
-- ------------------------------------------------------------
create table if not exists public.tracking_events (
  id           uuid primary key default gen_random_uuid(),
  parcel_id    uuid not null references public.parcels(id) on delete cascade,
  status       text not null,
  location     text,
  description  text,
  event_time   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_parcels_tracking_no on public.parcels (tracking_no);
create index if not exists idx_events_parcel on public.tracking_events (parcel_id, event_time desc);

-- ------------------------------------------------------------
-- 3) อัปเดต updated_at อัตโนมัติ
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_parcels_updated on public.parcels;
create trigger trg_parcels_updated
  before update on public.parcels
  for each row execute function public.set_updated_at();

-- เมื่อมีการเพิ่ม event ใหม่ ให้อัปเดตสถานะล่าสุดของพัสดุด้วย
create or replace function public.sync_parcel_status()
returns trigger language plpgsql as $$
begin
  update public.parcels
     set status = new.status, updated_at = now()
   where id = new.parcel_id;
  return new;
end;
$$;

drop trigger if exists trg_event_sync_status on public.tracking_events;
create trigger trg_event_sync_status
  after insert on public.tracking_events
  for each row execute function public.sync_parcel_status();

-- ------------------------------------------------------------
-- 4) Row Level Security
--    - บุคคลทั่วไป (anon) อ่านตารางตรง ๆ "ไม่ได้" (กันข้อมูลลูกค้ารั่ว)
--    - แต่เช็คพัสดุได้ผ่านฟังก์ชัน track_parcel() เท่านั้น
--    - ผู้ที่ login (admin) จัดการได้ทุกอย่าง
-- ------------------------------------------------------------
alter table public.parcels enable row level security;
alter table public.tracking_events enable row level security;

drop policy if exists "admin manage parcels" on public.parcels;
create policy "admin manage parcels" on public.parcels
  for all to authenticated using (true) with check (true);

drop policy if exists "admin manage events" on public.tracking_events;
create policy "admin manage events" on public.tracking_events
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 5) ฟังก์ชันเช็คพัสดุสำหรับลูกค้า (ปลอดภัย — คืนเฉพาะข้อมูลที่จำเป็น)
--    เรียกด้วย: supabase.rpc('track_parcel', { p_tracking_no: 'XXXX' })
-- ------------------------------------------------------------
create or replace function public.track_parcel(p_tracking_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcel public.parcels%rowtype;
  v_result jsonb;
begin
  select * into v_parcel
    from public.parcels
   where tracking_no = upper(trim(p_tracking_no));

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'tracking_no',  v_parcel.tracking_no,
    'status',       v_parcel.status,
    'weight',       v_parcel.weight,
    'cod_amount',   v_parcel.cod_amount,
    'receiver_name',v_parcel.receiver_name,
    'created_at',   v_parcel.created_at,
    'updated_at',   v_parcel.updated_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'status',      e.status,
               'location',    e.location,
               'description', e.description,
               'event_time',  e.event_time
             ) order by e.event_time desc)
      from public.tracking_events e
      where e.parcel_id = v_parcel.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.track_parcel(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 6) ข้อมูลตัวอย่าง (ลบออกได้ถ้าไม่ต้องการ)
-- ------------------------------------------------------------
insert into public.parcels (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, status, weight, cod_amount)
values ('FL1234567890', 'ร้านค้าตัวอย่าง', '0812345678', 'คุณสมชาย ใจดี', '0898765432', '123 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.พิษณุโลก 65000', 'in_transit', 1.5, 350)
on conflict (tracking_no) do nothing;

do $$
declare v_id uuid;
begin
  select id into v_id from public.parcels where tracking_no = 'FL1234567890';
  if v_id is not null and not exists (select 1 from public.tracking_events where parcel_id = v_id) then
    insert into public.tracking_events (parcel_id, status, location, description, event_time) values
      (v_id, 'created',     'พิษณุโลก',           'รับเข้าระบบเรียบร้อย',                now() - interval '3 day'),
      (v_id, 'picked_up',   'DC พิษณุโลก',        'พนักงานเข้ารับพัสดุแล้ว',             now() - interval '2 day 20 hour'),
      (v_id, 'at_sorting',  'ศูนย์คัดแยกพิษณุโลก',  'พัสดุถึงศูนย์คัดแยกสินค้า',            now() - interval '2 day'),
      (v_id, 'in_transit',  'ระหว่างทาง',          'พัสดุกำลังเดินทางไปยังศูนย์ปลายทาง',   now() - interval '12 hour');
  end if;
end $$;
