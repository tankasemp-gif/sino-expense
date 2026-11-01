-- =====================================================================
-- SINO โปรแกรมทำเบิกออนไลน์ — ส่วนที่ 1: ฐานข้อมูล (Supabase)
-- วิธีใช้: Supabase > SQL Editor > New query > วางทั้งไฟล์ > Run
-- ไฟล์นี้ไม่มีรหัสผ่าน / secret key / ข้อมูลพนักงาน จึงเก็บใน GitHub ได้
-- รันซ้ำไม่ได้ (ถ้าจะรันใหม่ ต้องลบตารางเดิมก่อน)
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. ตารางอ้างอิง (ตั้งค่า แก้ได้ภายหลังใน Table Editor)
-- ---------------------------------------------------------------------

-- ระดับตำแหน่ง + อัตราตามระเบียบค่าพาหนะ/เบี้ยเลี้ยง/ที่พัก (ประกาศ 1 ส.ค. 2565)
create table public.position_levels (
  code               text primary key,
  name               text not null,
  per_diem_domestic  numeric(12,2) not null,   -- บาท/วัน
  per_diem_overseas  numeric(12,2) not null,   -- บาท/วัน
  hotel_domestic     numeric(12,2),            -- บาท/คืน (null = ไม่จำกัด/N/A)
  hotel_overseas     numeric(12,2),            -- บาท/คืน
  sort_order         int not null default 0
);

insert into public.position_levels values
  ('SE',  'Sales Executive (Senior/Supervisor)', 500,  2100, 2000, 3500, 1),
  ('SM',  'Sales Manager (Assistant/Senior)',    500,  2100, 2000, 3500, 2),
  ('VP',  'Vice President (Assistant)',          1000, 3000, 2000, 3500, 3),
  ('SVP', 'Senior Vice President/MD ICL',        1000, 3000, 3500, 7000, 4),
  ('C',   'C-Level (CEO, CFO, COO)',             1000, 3500, null, null, 5);

-- ประเภทวงเงินรายเดือน (Sales Budget)
create table public.budget_types (
  code  text primary key,
  name  text not null
);

insert into public.budget_types values
  ('ENTERTAIN', 'Entertain'),
  ('GAS',       'Gas'),
  ('PHONE',     'Phone'),
  ('PARKING',   'Parking');

-- วงเงินต่อเดือนตามระดับ (ไม่ทบเดือน)
create table public.budget_rules (
  level_code      text references public.position_levels(code),
  budget_type     text references public.budget_types(code),
  monthly_amount  numeric(12,2) not null,
  primary key (level_code, budget_type)
);

insert into public.budget_rules values
  ('SE','ENTERTAIN',4000),  ('SE','GAS',4000),  ('SE','PHONE',1000), ('SE','PARKING',1500),
  ('SM','ENTERTAIN',6000),  ('SM','GAS',6000),  ('SM','PHONE',2000), ('SM','PARKING',1500),
  ('VP','ENTERTAIN',8000),  ('VP','GAS',8000),  ('VP','PHONE',2000), ('VP','PARKING',1500),
  ('SVP','ENTERTAIN',12000),('SVP','GAS',12000),('SVP','PHONE',2000),('SVP','PARKING',1500);

-- GL Code (พนักงานเลือกเองตอนยื่น)
create table public.gl_codes (
  code    text primary key,
  name    text not null,
  active  boolean not null default true
);

insert into public.gl_codes (code, name) values
  ('610010007', 'ค่าโฆษณา'),
  ('610010006', 'ค่ารับรอง และของกำนัล'),
  ('520010001', 'ค่ารับรอง - สำหรับลูกค้า'),
  ('610010008', 'ค่าส่งเสริมการขาย'),
  ('710020022', 'ค่าเดินทางต่างประเทศ'),
  ('710020023', 'ค่าสมาชิก'),
  ('710020019', 'ค่าใช้จ่ายอื่นๆ');

-- ประเภทค่าใช้จ่าย
--   route: general = SVP/CEO > บัญชี ; welfare = SVP > HR > บัญชี
--   requires_memo: ต้องแนบ Memo ทุกครั้ง (นอกเหนือจากกรณีเกินงบ)
--   max_per_receipt: เพดานต่อใบเสร็จ (ใช้เตือน)
create table public.expense_categories (
  code             text primary key,
  name             text not null,
  budget_type      text references public.budget_types(code),
  route            text not null default 'general' check (route in ('general','welfare')),
  welfare_limit    numeric(12,2),
  welfare_period   text check (welfare_period in ('month','year')),
  requires_memo    boolean not null default false,
  max_per_receipt  numeric(12,2),
  default_gl       text references public.gl_codes(code),
  sort_order       int not null default 0,
  active           boolean not null default true
);

insert into public.expense_categories
  (code, name, budget_type, route, welfare_limit, welfare_period, requires_memo, max_per_receipt, default_gl, sort_order) values
  ('ENTERTAIN',  'ค่าเลี้ยงรับรองลูกค้า',          'ENTERTAIN', 'general', null, null,   false, null, '520010001', 1),
  ('GIFT',       'ค่าของขวัญลูกค้า',               'ENTERTAIN', 'general', null, null,   false, 2000, '610010006', 2),
  ('GAS',        'ค่าน้ำมันส่วนเกิน (เกิน Fleet Card)', 'GAS',   'general', null, null,   false, null, null,        3),
  ('PHONE',      'ค่าโทรศัพท์',                    'PHONE',     'general', null, null,   false, null, null,        4),
  ('PARKING',    'ค่าที่จอดรถ',                     'PARKING',   'general', null, null,   false, null, null,        5),
  ('EXPRESSWAY', 'ค่าทางด่วน',                     null,        'general', null, null,   true,  null, null,        6),
  ('TRANSPORT',  'ค่าพาหนะ / ค่าเดินทาง',           null,        'general', null, null,   false, null, null,        7),
  ('PER_DIEM',   'เบี้ยเลี้ยง',                     null,        'general', null, null,   false, null, null,        8),
  ('HOTEL',      'ค่าที่พัก',                       null,        'general', null, null,   false, null, null,        9),
  ('TRAVEL_FOOD','ค่าอาหาร (เดินทาง)',             null,        'general', null, null,   false, null, null,        10),
  ('OTHER',      'ค่าใช้จ่ายอื่นๆ',                 null,        'general', null, null,   false, null, '710020019', 11),
  ('FITNESS',    'สวัสดิการฟิตเนส',                 null,        'welfare', 1200, 'month', false, null, null,        20),
  ('GLASSES',    'สวัสดิการตัดแว่น',                null,        'welfare', 1500, 'year',  false, null, null,        21);


-- ---------------------------------------------------------------------
-- B. ข้อมูลพนักงาน
-- ---------------------------------------------------------------------

-- 1 แถวต่อ 1 user (สร้างอัตโนมัติเมื่อ admin เพิ่ม user ใน Authentication)
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  emp_code        text unique,
  full_name       text,
  position_title  text,
  level_code      text references public.position_levels(code),
  role            text not null default 'employee'
                  check (role in ('employee','svp','ceo','hr','accounting','admin')),
  supervisor_id   uuid references public.profiles(id),   -- ผู้อนุมัติขั้นแรก (SVP ของทีม)
  department      text default 'Sales',
  cost_center     text default '01SALESC',
  company         text default 'SINO Logistics Corporation PLC',
  car_plate       text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- บัญชีธนาคาร แยกตารางไว้ ให้เห็นเฉพาะเจ้าของ + บัญชี + admin
create table public.employee_bank (
  employee_id   uuid primary key references public.profiles(id) on delete cascade,
  bank_name     text not null,
  account_no    text not null,
  account_name  text not null,
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- C. Memo (ขออนุมัติเกินงบ / ทางด่วน / ต่างประเทศ)
--    Memo ที่ approved จะเพิ่มวงเงินของเดือนนั้นตามยอดที่ขอ
-- ---------------------------------------------------------------------
create table public.memos (
  id                uuid primary key default gen_random_uuid(),
  memo_no           text,
  employee_id       uuid not null default auth.uid() references public.profiles(id),
  subject           text not null,
  budget_type       text references public.budget_types(code),
  claim_month       date not null check (extract(day from claim_month) = 1),
  amount_requested  numeric(12,2) not null check (amount_requested >= 0),
  status            text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_date     date,
  file_path         text,           -- ไฟล์ Memo ที่เซนครบแล้ว (ใน Storage)
  verified_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- D. ใบเบิก
-- ---------------------------------------------------------------------
create sequence public.claim_ref_seq;
grant usage, select on sequence public.claim_ref_seq to authenticated;

create table public.claims (
  id               uuid primary key default gen_random_uuid(),
  ref_no           text unique,
  employee_id      uuid not null default auth.uid() references public.profiles(id),
  claim_month      date not null
                   default (date_trunc('month', now() at time zone 'Asia/Bangkok'))::date
                   check (extract(day from claim_month) = 1),
  route            text not null default 'general' check (route in ('general','welfare')),
  pay_to           text,
  project          text,
  cost_center      text not null default '01SALESC',
  status           text not null default 'draft' check (status in (
                     'draft',              -- ร่าง
                     'pending_approval',   -- รอ SVP
                     'pending_ceo',        -- รอ CEO (มีรายการเกิน 10,000)
                     'pending_hr',         -- รอ HR (สวัสดิการ)
                     'pending_accounting', -- รอบัญชีตรวจ
                     'pending_payment',    -- บัญชีรับแล้ว รอโอน
                     'paid',               -- จ่ายแล้ว
                     'returned',           -- ส่งกลับแก้ไข
                     'rejected',           -- ไม่อนุมัติ
                     'cancelled')),        -- ยกเลิก
  total_amount     numeric(12,2) not null default 0,
  max_item_amount  numeric(12,2) not null default 0,
  return_note      text,
  submitted_at     timestamptz,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  ceo_by           uuid references public.profiles(id),
  ceo_at           timestamptz,
  hr_by            uuid references public.profiles(id),
  hr_at            timestamptz,
  checked_by       uuid references public.profiles(id),
  checked_at       timestamptz,
  paid_by          uuid references public.profiles(id),
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index claims_employee_month_idx on public.claims (employee_id, claim_month);
create index claims_status_idx on public.claims (status);

create table public.claim_items (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null references public.claims(id) on delete cascade,
  line_no         int not null default 1,
  category_code   text not null references public.expense_categories(code),
  gl_code         text references public.gl_codes(code),
  cost_center     text not null default '01SALESC',
  description     text not null,
  receipt_date    date,
  receipt_no      text,
  receipt_type    text check (receipt_type in ('tax_invoice','receipt','cash_bill','substitute')),
  is_overseas     boolean not null default false,
  currency        text not null default 'THB',
  amount_foreign  numeric(14,2),
  fx_rate         numeric(14,6),
  fx_source       text check (fx_source in ('BOT','CARD')),
  amount_thb      numeric(12,2) not null check (amount_thb > 0),
  memo_id         uuid references public.memos(id),
  details         jsonb not null default '{}'::jsonb,  -- ข้อมูลเฉพาะประเภท (Entertain, เที่ยวรถ, ฯลฯ)
  created_at      timestamptz not null default now(),
  check (currency = 'THB' or (amount_foreign is not null and fx_rate is not null and fx_source is not null))
);

create index claim_items_claim_idx on public.claim_items (claim_id);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims(id) on delete cascade,
  item_id      uuid references public.claim_items(id) on delete cascade,
  kind         text not null check (kind in ('receipt','memo','map','statement','entertain_form','substitute_form','other')),
  file_path    text not null,
  file_name    text,
  uploaded_by  uuid not null default auth.uid() references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table public.claim_logs (
  id           bigserial primary key,
  claim_id     uuid not null references public.claims(id) on delete cascade,
  actor        uuid references public.profiles(id),
  action       text not null,
  from_status  text,
  to_status    text,
  note         text,
  created_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- E. ฟังก์ชันช่วยเรื่องสิทธิ์
-- ---------------------------------------------------------------------
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_privileged()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('ceo','hr','accounting','admin')
                   from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_view_employee(emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select emp = auth.uid()
      or public.is_privileged()
      or exists (select 1 from public.profiles p
                 where p.id = emp and p.supervisor_id = auth.uid())
$$;

-- เจ้าของแก้ใบเบิกได้เฉพาะตอน draft / returned
create or replace function public.can_edit_claim(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.claims c
                 where c.id = cid and c.employee_id = auth.uid()
                   and c.status in ('draft','returned'))
$$;

create or replace function public.can_view_claim(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.claims c
                 where c.id = cid and public.can_view_employee(c.employee_id))
$$;


-- ---------------------------------------------------------------------
-- F. Triggers (เลข Ref, ยอดรวม, ป้องกันการแก้ข้อมูลที่ไม่ควรแก้, log)
--    การเปลี่ยนสถานะ (ยื่น/อนุมัติ/ส่งกลับ) จะทำผ่านฟังก์ชันในส่วนถัดไป
--    ซึ่งตั้งค่า app.bypass = 'on' ชั่วคราว
-- ---------------------------------------------------------------------
create or replace function public.claims_before_insert()
returns trigger language plpgsql as $$
begin
  new.ref_no := 'EXP' || to_char(now() at time zone 'Asia/Bangkok', 'YYMM')
                || '-' || lpad(nextval('public.claim_ref_seq')::text, 5, '0');
  if coalesce(current_setting('app.bypass', true), '') <> 'on' then
    new.employee_id := auth.uid();
    new.status := 'draft';
    new.total_amount := 0;
    new.max_item_amount := 0;
    new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    new.ceo_by := null;      new.ceo_at := null;
    new.hr_by := null;       new.hr_at := null;
    new.checked_by := null;  new.checked_at := null;
    new.paid_by := null;     new.paid_at := null;
    new.return_note := null;
  end if;
  return new;
end $$;

create trigger claims_before_insert
  before insert on public.claims
  for each row execute function public.claims_before_insert();

create or replace function public.claims_guard_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if coalesce(current_setting('app.bypass', true), '') = 'on' then
    return new;
  end if;
  -- เจ้าของแก้ได้เฉพาะ pay_to, project, claim_month, cost_center
  new.ref_no := old.ref_no;
  new.employee_id := old.employee_id;
  new.route := old.route;
  new.status := old.status;
  new.total_amount := old.total_amount;
  new.max_item_amount := old.max_item_amount;
  new.return_note := old.return_note;
  new.submitted_at := old.submitted_at;
  new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  new.ceo_by := old.ceo_by;           new.ceo_at := old.ceo_at;
  new.hr_by := old.hr_by;             new.hr_at := old.hr_at;
  new.checked_by := old.checked_by;   new.checked_at := old.checked_at;
  new.paid_by := old.paid_by;         new.paid_at := old.paid_at;
  return new;
end $$;

create trigger claims_guard_update
  before update on public.claims
  for each row execute function public.claims_guard_update();

-- รายการต้องเป็นสายอนุมัติเดียวกับใบเบิก (สวัสดิการแยกใบ)
create or replace function public.claim_items_check_route()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_claim_route text;
  v_cat_route   text;
begin
  select route into v_claim_route from public.claims where id = new.claim_id;
  select route into v_cat_route from public.expense_categories where code = new.category_code;
  if v_claim_route is distinct from v_cat_route then
    raise exception 'ประเภทค่าใช้จ่ายนี้ต้องเบิกแยกใบ (สวัสดิการ กับ ค่าใช้จ่ายทั่วไป ใช้คนละใบเบิก)';
  end if;
  return new;
end $$;

create trigger claim_items_check_route
  before insert or update on public.claim_items
  for each row execute function public.claim_items_check_route();

-- อัปเดตยอดรวม และยอดรายการสูงสุด (ใช้ตัดสินว่าต้องให้ CEO เซนหรือไม่)
create or replace function public.claim_items_refresh_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  perform set_config('app.bypass', 'on', true);
  update public.claims c
     set total_amount    = coalesce((select sum(amount_thb) from public.claim_items where claim_id = v_claim), 0),
         max_item_amount = coalesce((select max(amount_thb) from public.claim_items where claim_id = v_claim), 0)
   where c.id = v_claim;
  perform set_config('app.bypass', 'off', true);
  return null;
end $$;

create trigger claim_items_refresh_totals
  after insert or update or delete on public.claim_items
  for each row execute function public.claim_items_refresh_totals();

-- บันทึกประวัติทุกครั้งที่สถานะเปลี่ยน
create or replace function public.claims_log_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.claim_logs (claim_id, actor, action, to_status)
    values (new.id, auth.uid(), 'create', new.status);
  elsif new.status is distinct from old.status then
    insert into public.claim_logs (claim_id, actor, action, from_status, to_status, note)
    values (new.id, auth.uid(), 'status_change', old.status, new.status, new.return_note);
  end if;
  return null;
end $$;

create trigger claims_log_status
  after insert or update on public.claims
  for each row execute function public.claims_log_status();


-- ---------------------------------------------------------------------
-- G. สรุปวงเงินคงเหลือ (นับตามเดือนที่ยื่นเบิก, ไม่ทบเดือน,
--    บวกยอด Memo ที่ approved ของเดือนนั้น)
--    ใช้: select * from budget_summary('<employee uuid>', '2026-11-01');
-- ---------------------------------------------------------------------
create or replace function public.budget_summary(p_employee uuid, p_month date)
returns table (budget_type text, base_budget numeric, memo_extra numeric, used numeric, remaining numeric)
language sql stable security invoker set search_path = public as $$
  with m as (select date_trunc('month', p_month)::date as mon),
  base as (
    select bt.code as budget_type, coalesce(br.monthly_amount, 0) as base_budget
    from public.budget_types bt
    left join public.profiles p on p.id = p_employee
    left join public.budget_rules br on br.budget_type = bt.code and br.level_code = p.level_code
  ),
  extra as (
    select mo.budget_type, sum(mo.amount_requested) as memo_extra
    from public.memos mo, m
    where mo.employee_id = p_employee and mo.claim_month = m.mon and mo.status = 'approved'
    group by mo.budget_type
  ),
  usage as (
    select ec.budget_type, sum(ci.amount_thb) as used
    from public.claim_items ci
    join public.claims c on c.id = ci.claim_id
    join public.expense_categories ec on ec.code = ci.category_code, m
    where c.employee_id = p_employee and c.claim_month = m.mon
      and c.status not in ('draft','rejected','cancelled')
      and ec.budget_type is not null
    group by ec.budget_type
  )
  select b.budget_type,
         b.base_budget,
         coalesce(e.memo_extra, 0),
         coalesce(u.used, 0),
         b.base_budget + coalesce(e.memo_extra, 0) - coalesce(u.used, 0)
  from base b
  left join extra e on e.budget_type = b.budget_type
  left join usage u on u.budget_type = b.budget_type
  order by b.budget_type
$$;


-- ---------------------------------------------------------------------
-- H. Row Level Security (ใครเห็น/แก้อะไรได้)
-- ---------------------------------------------------------------------
alter table public.position_levels    enable row level security;
alter table public.budget_types       enable row level security;
alter table public.budget_rules       enable row level security;
alter table public.gl_codes           enable row level security;
alter table public.expense_categories enable row level security;
alter table public.profiles           enable row level security;
alter table public.employee_bank      enable row level security;
alter table public.memos              enable row level security;
alter table public.claims             enable row level security;
alter table public.claim_items        enable row level security;
alter table public.attachments        enable row level security;
alter table public.claim_logs         enable row level security;

-- ตารางอ้างอิง: ทุกคนที่ล็อกอินอ่านได้, admin แก้ได้
create policy "read ref" on public.position_levels    for select to authenticated using (true);
create policy "read ref" on public.budget_types       for select to authenticated using (true);
create policy "read ref" on public.budget_rules       for select to authenticated using (true);
create policy "read ref" on public.gl_codes           for select to authenticated using (true);
create policy "read ref" on public.expense_categories for select to authenticated using (true);
create policy "admin ref" on public.position_levels    for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin ref" on public.budget_types       for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin ref" on public.budget_rules       for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin ref" on public.gl_codes           for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin ref" on public.expense_categories for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- profiles: เห็นตัวเอง / SVP เห็นทีม / CEO-HR-บัญชี-admin เห็นทั้งหมด; แก้ได้เฉพาะ admin
create policy "view profiles" on public.profiles for select to authenticated
  using (public.can_view_employee(id));
create policy "admin profiles" on public.profiles for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- บัญชีธนาคาร: เจ้าของ + บัญชี + admin
create policy "view bank" on public.employee_bank for select to authenticated
  using (employee_id = auth.uid() or public.app_role() in ('accounting','admin'));
create policy "insert bank" on public.employee_bank for insert to authenticated
  with check (employee_id = auth.uid() or public.app_role() = 'admin');
create policy "update bank" on public.employee_bank for update to authenticated
  using (employee_id = auth.uid() or public.app_role() = 'admin')
  with check (employee_id = auth.uid() or public.app_role() = 'admin');

-- memos
create policy "view memos" on public.memos for select to authenticated
  using (public.can_view_employee(employee_id));
create policy "insert memos" on public.memos for insert to authenticated
  with check (employee_id = auth.uid() and status = 'pending');
create policy "owner update memos" on public.memos for update to authenticated
  using (employee_id = auth.uid() and status = 'pending')
  with check (employee_id = auth.uid() and status = 'pending');
create policy "owner delete memos" on public.memos for delete to authenticated
  using (employee_id = auth.uid() and status = 'pending');
create policy "acc update memos" on public.memos for update to authenticated
  using (public.app_role() in ('accounting','admin'))
  with check (public.app_role() in ('accounting','admin'));

-- claims (การเปลี่ยนสถานะทำผ่านฟังก์ชันในส่วนถัดไป)
create policy "view claims" on public.claims for select to authenticated
  using (public.can_view_employee(employee_id));
create policy "insert claims" on public.claims for insert to authenticated
  with check (auth.uid() is not null);
create policy "owner update claims" on public.claims for update to authenticated
  using (employee_id = auth.uid() and status in ('draft','returned'))
  with check (employee_id = auth.uid());
create policy "owner delete draft" on public.claims for delete to authenticated
  using (employee_id = auth.uid() and status = 'draft');

-- claim_items
create policy "view items" on public.claim_items for select to authenticated
  using (public.can_view_claim(claim_id));
create policy "insert items" on public.claim_items for insert to authenticated
  with check (public.can_edit_claim(claim_id));
create policy "update items" on public.claim_items for update to authenticated
  using (public.can_edit_claim(claim_id)) with check (public.can_edit_claim(claim_id));
create policy "delete items" on public.claim_items for delete to authenticated
  using (public.can_edit_claim(claim_id));

-- attachments
create policy "view att" on public.attachments for select to authenticated
  using (public.can_view_claim(claim_id));
create policy "insert att" on public.attachments for insert to authenticated
  with check (public.can_edit_claim(claim_id) and uploaded_by = auth.uid());
create policy "delete att" on public.attachments for delete to authenticated
  using (public.can_edit_claim(claim_id));

-- logs: อ่านได้ถ้าเห็นใบเบิก (เขียนโดย trigger เท่านั้น)
create policy "view logs" on public.claim_logs for select to authenticated
  using (public.can_view_claim(claim_id));


-- ---------------------------------------------------------------------
-- I. ที่เก็บไฟล์ใบเสร็จ (Storage) — ไม่เปิดสาธารณะ
--    path ของไฟล์: <user id>/<claim id>/<ชื่อไฟล์>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

create policy "receipts upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and public.can_view_employee(((storage.foldername(name))[1])::uuid));

create policy "receipts delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- จบส่วนที่ 1
