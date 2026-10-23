-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — approval controls
-- 1) Petty-cash vouchers: approval limit also on insert, no direct 'paid' insert, and the amount /
--    claimant cannot change once a voucher has been decided.
-- 2) Maker-checker: approvers cannot approve their own leave, claims, advances, corrections or OT
--    (Super Admin — settings.manage — has nobody above them and is exempt).
-- 3) Storage: reading another employee's files is scoped to the area (documents need employees
--    rights, bills need petty-cash rights, leave proofs need leave rights).
-- 4) Task comments survive the deletion of their author's login.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) petty-cash vouchers ─────────────────────────────────────────────────────
create or replace function public.guard_voucher_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_limit numeric;
begin
  if public.is_privileged() then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'pending'
     and (new.amount, new.employee_id) is distinct from (old.amount, old.employee_id) then
    raise exception 'A voucher that has been decided cannot change its amount or claimant.' using errcode = '42501';
  end if;
  if new.status in ('approved', 'paid') and (tg_op = 'INSERT' or old.status = 'pending') then
    select petty_cash_approval_limit into v_limit from public.company_settings limit 1;
    if new.amount > coalesce(v_limit, 0) and not public.has_perm('settings.manage') then
      raise exception 'Vouchers above ₹% need Super Admin approval.', to_char(v_limit, 'FM99,99,999') using errcode = '42501';
    end if;
    if new.employee_id = public.app_employee_id() and not public.has_perm('settings.manage') then
      raise exception 'You cannot approve your own claim. Another approver has to decide it.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') and new.ledger_entry_id is null then
    raise exception 'Pay vouchers with petty_cash_pay() so the cash book is posted.' using errcode = '22023';
  end if;
  return new;
end $$;
-- fires after guard_petty_cash_vouchers on insert (triggers run in name order)
drop trigger if exists guard_voucher_approval on public.petty_cash_vouchers;
create trigger guard_voucher_approval before insert or update on public.petty_cash_vouchers
  for each row execute function public.guard_voucher_approval();

-- 2) maker-checker ───────────────────────────────────────────────────────────
create or replace function public.guard_self_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged() or public.has_perm('settings.manage') then return new; end if;
  if new.employee_id is distinct from public.app_employee_id() then return new; end if;
  if new.status in ('approved', 'active') and (tg_op = 'INSERT' or old.status = 'pending') then
    raise exception 'You cannot approve your own request. Another approver has to decide it.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_self_approval on public.leave_requests;
create trigger guard_self_approval before insert or update of status on public.leave_requests
  for each row execute function public.guard_self_approval();
drop trigger if exists guard_self_approval on public.advances;
create trigger guard_self_approval before insert or update of status on public.advances
  for each row execute function public.guard_self_approval();
drop trigger if exists guard_self_approval on public.regularisations;
create trigger guard_self_approval before insert or update of status on public.regularisations
  for each row execute function public.guard_self_approval();

create or replace function public.guard_self_overtime() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged() or public.has_perm('settings.manage') then return new; end if;
  if new.ot_status = 'approved' and old.ot_status is distinct from 'approved' and new.employee_id = public.app_employee_id() then
    raise exception 'You cannot approve your own overtime. Another approver has to decide it.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_self_overtime on public.attendance;
create trigger guard_self_overtime before update of ot_status on public.attendance
  for each row execute function public.guard_self_overtime();

-- 3) storage read scope ──────────────────────────────────────────────────────
-- object path convention: <employee_id>/<area>/<uuid>-<file name>; areas: photo, documents, petty-cash, leave
drop policy if exists "erp-files read" on storage.objects;
create policy "erp-files read" on storage.objects for select to authenticated using (
  bucket_id = 'erp-files' and (
    (storage.foldername(name))[1] = (select public.app_employee_id())::text
    or ((storage.foldername(name))[2] = 'photo'
        and (select public.has_any_perm('{employees.view,employees.manage,petty_cash.view,petty_cash.manage,leaves.view,leaves.manage}'::text[])))
    or ((storage.foldername(name))[2] = 'documents' and (select public.has_any_perm('{employees.view,employees.manage}'::text[])))
    or ((storage.foldername(name))[2] = 'petty-cash' and (select public.has_any_perm('{petty_cash.view,petty_cash.manage}'::text[])))
    or ((storage.foldername(name))[2] = 'leave' and (select public.has_any_perm('{leaves.view,leaves.manage}'::text[])))
  )
);

-- 4) task comments keep their author name when the login is deleted ──────────
alter table public.task_comments alter column author_user_id drop not null;
alter table public.task_comments drop constraint if exists task_comments_author_user_id_fkey;
alter table public.task_comments add constraint task_comments_author_user_id_fkey
  foreign key (author_user_id) references public.app_users(id) on delete set null;
