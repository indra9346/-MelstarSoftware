-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — server-side petty-cash rules + staff directory of logins
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Admin-portal staff may see who the logins are (names for reviewers, read receipts).
--    app_users holds no secrets in Supabase mode (passwords live in auth.users).
drop policy if exists "read" on public.app_users;
create policy "read" on public.app_users for select to authenticated using (
  auth_user_id = (select auth.uid())
  or (select public.has_any_perm('{users.manage,dashboard.view,announcements.manage}'::text[]))
);

-- 2) Vouchers above the approval limit need a Super Admin (settings.manage).
create or replace function public.guard_voucher_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_limit numeric;
begin
  if public.is_privileged() then return new; end if;
  if new.status in ('approved', 'paid') and old.status = 'pending' then
    select petty_cash_approval_limit into v_limit from public.company_settings limit 1;
    if new.amount > coalesce(v_limit, 0) and not public.has_perm('settings.manage') then
      raise exception 'Vouchers above ₹% need Super Admin approval.', to_char(v_limit, 'FM99,99,999') using errcode = '42501';
    end if;
  end if;
  if new.status = 'paid' and old.status <> 'paid' and new.ledger_entry_id is null then
    raise exception 'Pay vouchers with petty_cash_pay() so the cash book is posted.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_voucher_approval on public.petty_cash_vouchers;
create trigger guard_voucher_approval before update on public.petty_cash_vouchers for each row execute function public.guard_voucher_approval();

-- 3) Pay an approved voucher atomically: checks cash in hand, posts the cash-book entry,
--    marks the voucher paid — all in one transaction with the server's date.
create or replace function public.petty_cash_pay(p_voucher uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.petty_cash_vouchers;
  e public.petty_cash_entries;
  v_balance numeric;
  v_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.has_perm('petty_cash.manage') then
    raise exception 'You do not have petty-cash rights.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('petty_cash_book'));
  select * into v from public.petty_cash_vouchers where id = p_voucher for update;
  if not found then raise exception 'Voucher not found.'; end if;
  if v.status <> 'approved' or v.ledger_entry_id is not null then
    raise exception 'Only an approved, unpaid voucher can be paid (this one is %).', v.status;
  end if;
  select coalesce(sum(case when type = 'in' then amount else -amount end), 0) into v_balance from public.petty_cash_entries;
  if v.amount > v_balance then
    raise exception 'Not enough cash in hand (₹%). Top up the cash box first.', to_char(v_balance, 'FM99,99,990');
  end if;
  insert into public.petty_cash_entries (entry_no, date, type, amount, category, description, voucher_id, created_by)
  values (public.next_doc_no('petty_cash_entries', 'entry_no', 'PC/' || public.fy_label(v_date) || '/', 4), v_date, 'out', v.amount, v.category,
          v.voucher_no || ' · ' || v.description, v.id, public.app_user_id())
  returning * into e;
  update public.petty_cash_vouchers set status = 'paid', paid_at = now(), ledger_entry_id = e.id where id = v.id returning * into v;
  return jsonb_build_object('voucher', to_jsonb(v), 'entry', to_jsonb(e));
end $$;
revoke all on function public.petty_cash_pay(uuid) from public, anon;
grant execute on function public.petty_cash_pay(uuid) to authenticated;
