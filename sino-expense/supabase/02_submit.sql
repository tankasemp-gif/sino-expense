-- =====================================================================
-- SINO โปรแกรมทำเบิกออนไลน์ — ส่วนที่ 2: การยื่นเบิก
-- วิธีใช้: Supabase > SQL Editor > New query > วางทั้งไฟล์ > Run (รันครั้งเดียว)
-- ต้องรัน 01_schema.sql ก่อน
-- =====================================================================

-- 1) คอลัมน์เพิ่ม: ต้องมี Memo หรือไม่ + หมายเหตุที่ระบบตรวจพบตอนยื่น
alter table public.claims add column memo_required boolean not null default false;
alter table public.claims add column check_notes text;

-- 2) ผู้ใช้ที่ถูกปิด (active = false) สร้างใบเบิกไม่ได้
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false)
$$;

drop policy "insert claims" on public.claims;
create policy "insert claims" on public.claims for insert to authenticated
  with check (public.is_active_user());

-- 3) ป้องกันการแก้คอลัมน์ใหม่โดยตรง (อัปเดตฟังก์ชันเดิม)
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
    new.memo_required := false;
    new.check_notes := null;
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

create or replace function public.claims_guard_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if coalesce(current_setting('app.bypass', true), '') = 'on' then
    return new;
  end if;
  new.ref_no := old.ref_no;
  new.employee_id := old.employee_id;
  new.route := old.route;
  new.status := old.status;
  new.total_amount := old.total_amount;
  new.max_item_amount := old.max_item_amount;
  new.memo_required := old.memo_required;
  new.check_notes := old.check_notes;
  new.return_note := old.return_note;
  new.submitted_at := old.submitted_at;
  new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  new.ceo_by := old.ceo_by;           new.ceo_at := old.ceo_at;
  new.hr_by := old.hr_by;             new.hr_at := old.hr_at;
  new.checked_by := old.checked_by;   new.checked_at := old.checked_at;
  new.paid_by := old.paid_by;         new.paid_at := old.paid_at;
  return new;
end $$;

-- 4) ยื่นเบิก: ตรวจเงื่อนไข แล้วเปลี่ยนสถานะเป็น "รอ SVP อนุมัติ"
--    - ต้องมีรายการ, ทุกรายการมี GL, วันที่ใบเสร็จ และไฟล์แนบ
--    - วันที่ใบเสร็จต้องอยู่ในเดือนที่เบิก (ยกเว้นรายการต่างประเทศ)
--    - ยื่นครั้งแรกได้ถึงวันที่ 2 ของเดือนถัดไป (ยกเว้นมีรายการต่างประเทศ)
--    - เกินงบ / เกินสิทธิ์สวัสดิการ / ประเภทที่ต้องมี Memo -> ยื่นได้ แต่ติดธง "ต้องแนบ Memo"
create or replace function public.submit_claim(p_claim uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  c          public.claims%rowtype;
  p          public.profiles%rowtype;
  v_today    date := (now() at time zone 'Asia/Bangkok')::date;
  v_deadline date;
  v_bad      int;
  v_memo     boolean := false;
  v_notes    text[] := '{}';
  v_limit    numeric;
  v_used     numeric;
  r          record;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found or c.employee_id <> auth.uid() then
    raise exception 'ไม่พบใบเบิก หรือไม่ใช่ใบเบิกของคุณ';
  end if;
  if c.status not in ('draft','returned') then
    raise exception 'ใบเบิกนี้ยื่นไปแล้ว';
  end if;

  select * into p from public.profiles where id = auth.uid();
  if not p.active then
    raise exception 'บัญชีนี้ถูกปิดใช้งาน';
  end if;
  if p.supervisor_id is null then
    raise exception 'ยังไม่ได้กำหนดผู้อนุมัติ (SVP) ของคุณ กรุณาแจ้ง admin';
  end if;

  select count(*) into v_bad from public.claim_items where claim_id = p_claim;
  if v_bad = 0 then
    raise exception 'ยังไม่มีรายการในใบเบิก';
  end if;

  select count(*) into v_bad from public.claim_items where claim_id = p_claim and gl_code is null;
  if v_bad > 0 then
    raise exception 'มี % รายการที่ยังไม่ได้เลือก GL Code', v_bad;
  end if;

  select count(*) into v_bad from public.claim_items where claim_id = p_claim and receipt_date is null;
  if v_bad > 0 then
    raise exception 'มี % รายการที่ยังไม่ได้ใส่วันที่ใบเสร็จ', v_bad;
  end if;

  select count(*) into v_bad from public.claim_items i
   where i.claim_id = p_claim
     and not exists (select 1 from public.attachments a where a.item_id = i.id);
  if v_bad > 0 then
    raise exception 'มี % รายการที่ยังไม่ได้แนบไฟล์ใบเสร็จ', v_bad;
  end if;

  select count(*) into v_bad from public.claim_items
   where claim_id = p_claim and not is_overseas
     and date_trunc('month', receipt_date)::date <> c.claim_month;
  if v_bad > 0 then
    raise exception 'มี % รายการที่วันที่ใบเสร็จไม่อยู่ในเดือนที่เบิก (ต้องเบิกในเดือนของใบเสร็จ)', v_bad;
  end if;

  v_deadline := (c.claim_month + interval '1 month')::date + 1;   -- วันที่ 2 ของเดือนถัดไป
  if c.status = 'draft' and v_today > v_deadline
     and not exists (select 1 from public.claim_items where claim_id = p_claim and is_overseas) then
    raise exception 'เลยกำหนดยื่นเบิกของเดือนนี้แล้ว (ต้องยื่นภายใน %)', to_char(v_deadline, 'DD/MM/YYYY');
  end if;

  -- งบรายเดือน (Entertain/Gas/Phone/Parking)
  for r in
    select ec.budget_type, bt.name, sum(i.amount_thb) as amt
      from public.claim_items i
      join public.expense_categories ec on ec.code = i.category_code
      join public.budget_types bt on bt.code = ec.budget_type
     where i.claim_id = p_claim
     group by ec.budget_type, bt.name
  loop
    select coalesce((select monthly_amount from public.budget_rules
                      where level_code = p.level_code and budget_type = r.budget_type), 0)
         + coalesce((select sum(amount_requested) from public.memos
                      where employee_id = p.id and claim_month = c.claim_month
                        and budget_type = r.budget_type and status = 'approved'), 0)
      into v_limit;
    select coalesce(sum(i.amount_thb), 0) into v_used
      from public.claim_items i
      join public.claims c2 on c2.id = i.claim_id
      join public.expense_categories ec on ec.code = i.category_code
     where c2.employee_id = p.id and c2.claim_month = c.claim_month and c2.id <> p_claim
       and c2.status not in ('draft','rejected','cancelled')
       and ec.budget_type = r.budget_type;
    if v_used + r.amt > v_limit then
      v_memo := true;
      v_notes := v_notes || format('เกินงบ %s %s บาท', r.name,
                                   to_char(v_used + r.amt - v_limit, 'FM999,999,990.00'));
    end if;
  end loop;

  -- สิทธิ์สวัสดิการ (ฟิตเนสต่อเดือน / แว่นต่อปี)
  for r in
    select ec.code, ec.name, ec.welfare_limit, ec.welfare_period, sum(i.amount_thb) as amt
      from public.claim_items i
      join public.expense_categories ec on ec.code = i.category_code
     where i.claim_id = p_claim and ec.welfare_limit is not null
     group by ec.code, ec.name, ec.welfare_limit, ec.welfare_period
  loop
    select coalesce(sum(i.amount_thb), 0) into v_used
      from public.claim_items i
      join public.claims c2 on c2.id = i.claim_id
     where c2.employee_id = p.id and c2.id <> p_claim
       and c2.status not in ('draft','rejected','cancelled')
       and i.category_code = r.code
       and case when r.welfare_period = 'year'
                then date_trunc('year', c2.claim_month) = date_trunc('year', c.claim_month)
                else c2.claim_month = c.claim_month end;
    if v_used + r.amt > r.welfare_limit then
      v_memo := true;
      v_notes := v_notes || format('เกินสิทธิ์ %s %s บาท', r.name,
                                   to_char(v_used + r.amt - r.welfare_limit, 'FM999,999,990.00'));
    end if;
  end loop;

  -- ประเภทที่ต้องมี Memo ทุกครั้ง (เช่น ค่าทางด่วน)
  for r in
    select distinct ec.name
      from public.claim_items i
      join public.expense_categories ec on ec.code = i.category_code
     where i.claim_id = p_claim and ec.requires_memo
  loop
    v_memo := true;
    v_notes := v_notes || format('%s ต้องแนบ Memo', r.name);
  end loop;

  -- เดินทางต่างประเทศต้องมี Memo
  if exists (select 1 from public.claim_items where claim_id = p_claim and is_overseas) then
    v_memo := true;
    v_notes := v_notes || 'ค่าใช้จ่ายต่างประเทศ ต้องแนบ Memo';
  end if;

  perform set_config('app.bypass', 'on', true);
  update public.claims
     set status = 'pending_approval',
         submitted_at = now(),
         memo_required = v_memo,
         check_notes = nullif(array_to_string(v_notes, E'\n'), ''),
         return_note = null
   where id = p_claim;
  perform set_config('app.bypass', 'off', true);

  return json_build_object('status', 'pending_approval',
                           'memo_required', v_memo,
                           'notes', to_json(v_notes));
end $$;

revoke all on function public.submit_claim(uuid) from public, anon;
grant execute on function public.submit_claim(uuid) to authenticated;

-- จบส่วนที่ 2
