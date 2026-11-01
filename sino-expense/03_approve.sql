-- =====================================================================
-- SINO โปรแกรมทำเบิกออนไลน์ — ส่วนที่ 3: การอนุมัติ / ตรวจ / จ่ายเงิน
-- วิธีใช้: Supabase > SQL Editor > New query > วางทั้งไฟล์ > Run (รันครั้งเดียว)
-- ต้องรัน 01 และ 02 ก่อน
--
-- สายอนุมัติ:
--   ทั่วไป   : พนักงาน > SVP > (CEO ถ้ามีรายการเกิน 10,000) > บัญชีตรวจ > โอนเงิน
--   สวัสดิการ : พนักงาน > SVP > (CEO ถ้ามีรายการเกิน 10,000) > HR > บัญชีตรวจ > โอนเงิน
--   ทุกขั้น "ส่งกลับแก้ไข" ได้ (กลับไปเริ่มที่ SVP ใหม่เมื่อยื่นอีกครั้ง)
-- =====================================================================

-- 1) ประวัติ: เก็บความเห็นของผู้อนุมัติด้วย
create or replace function public.claims_log_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.claim_logs (claim_id, actor, action, to_status)
    values (new.id, auth.uid(), 'create', new.status);
  elsif new.status is distinct from old.status then
    insert into public.claim_logs (claim_id, actor, action, from_status, to_status, note)
    values (new.id, auth.uid(), 'status_change', old.status, new.status,
            coalesce(nullif(current_setting('app.note', true), ''),
                     case when new.status = 'returned' then new.return_note end));
  end if;
  return null;
end $$;

-- 2) เจ้าของใบเบิกแนบไฟล์ Memo เพิ่มได้ แม้ยื่นไปแล้ว (ระหว่างรออนุมัติ/รอบัญชี)
create policy "owner add memo after submit" on public.attachments for insert to authenticated
  with check (
    kind = 'memo' and item_id is null and uploaded_by = auth.uid()
    and exists (select 1 from public.claims c
                where c.id = claim_id and c.employee_id = auth.uid()
                  and c.status in ('pending_approval','pending_ceo','pending_hr','pending_accounting'))
  );

-- 3) ดำเนินการกับใบเบิก
--    p_action: approve | return | reject | mark_paid
--    p_memo_budget_type / p_memo_amount: (บัญชี) บันทึกยอดตาม Memo ให้เพิ่มวงเงินเดือนนั้น
create or replace function public.act_on_claim(
  p_claim uuid,
  p_action text,
  p_note text default null,
  p_memo_budget_type text default null,
  p_memo_amount numeric default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  c      public.claims%rowtype;
  me     public.profiles%rowtype;
  emp    public.profiles%rowtype;
  v_next text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'ไม่พบใบเบิก'; end if;

  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.active then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
  select * into emp from public.profiles where id = c.employee_id;

  if p_action not in ('approve','return','reject','mark_paid') then
    raise exception 'คำสั่งไม่ถูกต้อง';
  end if;
  if c.employee_id = me.id then
    raise exception 'ดำเนินการกับใบเบิกของตัวเองไม่ได้';
  end if;

  -- ใครทำขั้นไหนได้
  if c.status = 'pending_approval' then
    if emp.supervisor_id is distinct from me.id then raise exception 'ใบเบิกนี้ไม่ได้รอคุณอนุมัติ'; end if;
  elsif c.status = 'pending_ceo' then
    if me.role <> 'ceo' then raise exception 'ขั้นนี้ต้องให้ CEO อนุมัติ'; end if;
  elsif c.status = 'pending_hr' then
    if me.role <> 'hr' then raise exception 'ขั้นนี้ต้องให้ HR ดำเนินการ'; end if;
  elsif c.status in ('pending_accounting','pending_payment') then
    if me.role <> 'accounting' then raise exception 'ขั้นนี้ต้องให้ฝ่ายบัญชีดำเนินการ'; end if;
  else
    raise exception 'ใบเบิกนี้ไม่อยู่ในขั้นตอนที่ดำเนินการได้';
  end if;

  if p_action in ('return','reject') and v_note is null then
    raise exception 'กรุณาระบุเหตุผล';
  end if;
  if p_action = 'reject' and c.status not in ('pending_approval','pending_ceo','pending_hr') then
    raise exception 'ขั้นนี้ใช้ "ส่งกลับแก้ไข" แทน';
  end if;
  if p_action = 'mark_paid' and c.status <> 'pending_payment' then
    raise exception 'ยังไม่ถึงขั้นโอนเงิน';
  end if;
  if p_action = 'approve' and c.status = 'pending_payment' then
    raise exception 'ใช้ปุ่ม "บันทึกว่าโอนเงินแล้ว"';
  end if;

  if p_action = 'approve' and c.status = 'pending_accounting' then
    if c.memo_required and not exists (select 1 from public.attachments
                                        where claim_id = p_claim and kind = 'memo') then
      raise exception 'ใบนี้ต้องมีไฟล์ Memo ที่อนุมัติแล้วก่อน จึงจะรับเรื่องได้';
    end if;
    if coalesce(p_memo_amount, 0) > 0 then
      if p_memo_budget_type is null then raise exception 'เลือกประเภทงบของ Memo'; end if;
      insert into public.memos (employee_id, subject, budget_type, claim_month,
                                amount_requested, status, approved_date, verified_by)
      values (c.employee_id, 'Memo แนบใบเบิก ' || c.ref_no, p_memo_budget_type, c.claim_month,
              p_memo_amount, 'approved', (now() at time zone 'Asia/Bangkok')::date, me.id);
    end if;
  end if;

  perform set_config('app.bypass', 'on', true);
  perform set_config('app.note', coalesce(v_note, ''), true);

  if p_action = 'return' then
    v_next := 'returned';
    update public.claims
       set status = v_next, return_note = v_note,
           approved_by = null, approved_at = null, ceo_by = null, ceo_at = null,
           hr_by = null, hr_at = null, checked_by = null, checked_at = null
     where id = p_claim;
  elsif p_action = 'reject' then
    v_next := 'rejected';
    update public.claims set status = v_next, return_note = v_note where id = p_claim;
  elsif p_action = 'mark_paid' then
    v_next := 'paid';
    update public.claims set status = v_next, paid_by = me.id, paid_at = now() where id = p_claim;
  elsif c.status = 'pending_approval' then
    v_next := case when c.max_item_amount > 10000 then 'pending_ceo'
                   when c.route = 'welfare' then 'pending_hr'
                   else 'pending_accounting' end;
    update public.claims set status = v_next, approved_by = me.id, approved_at = now() where id = p_claim;
  elsif c.status = 'pending_ceo' then
    v_next := case when c.route = 'welfare' then 'pending_hr' else 'pending_accounting' end;
    update public.claims set status = v_next, ceo_by = me.id, ceo_at = now() where id = p_claim;
  elsif c.status = 'pending_hr' then
    v_next := 'pending_accounting';
    update public.claims set status = v_next, hr_by = me.id, hr_at = now() where id = p_claim;
  elsif c.status = 'pending_accounting' then
    v_next := 'pending_payment';
    update public.claims set status = v_next, checked_by = me.id, checked_at = now() where id = p_claim;
  end if;

  perform set_config('app.bypass', 'off', true);
  perform set_config('app.note', '', true);

  return json_build_object('status', v_next);
end $$;

revoke all on function public.act_on_claim(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.act_on_claim(uuid, text, text, text, numeric) to authenticated;

-- จบส่วนที่ 3
