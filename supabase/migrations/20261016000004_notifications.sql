-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — notifications raised by the database
-- Employees cannot see who the approvers are (RLS), so the server fans out
-- "needs approval" and "your request was decided" notifications.
-- The static demo mode runs the same rules in src/services/notificationRules.ts.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.notify_users_with_perm(p_perm text, p_type text, p_title text, p_body text, p_link text, p_except uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link)
  select u.id, p_type, p_title, p_body, p_link
  from public.app_users u join public.roles r on r.id = u.role_id
  where u.active and p_perm = any (r.permissions) and (p_except is null or u.id <> p_except);
$$;

create or replace function public.notify_employee(p_employee uuid, p_type text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, link)
  select u.id, p_type, p_title, p_body, p_link from public.app_users u where u.active and u.employee_id = p_employee;
$$;

create or replace function public.emp_name(p_employee uuid) returns text
language sql stable security definer set search_path = public as $$
  select trim(first_name || ' ' || last_name) from public.employees where id = p_employee
$$;

create or replace function public.fmt_d(d date) returns text language sql immutable as $$ select to_char(d, 'DD Mon') $$;

-- leave ------------------------------------------------------------------------
create or replace function public.tg_notify_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  select name into v_type from public.leave_types where id = new.leave_type_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_users_with_perm('leaves.manage', 'leave', 'Leave request — ' || public.emp_name(new.employee_id),
      v_type || ' · ' || public.fmt_d(new.from_date) || case when new.to_date <> new.from_date then ' – ' || public.fmt_d(new.to_date) else '' end || ' (' || new.days || ' d)',
      '/admin/approvals', public.app_user_id());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify_employee(new.employee_id, 'leave', 'Leave ' || new.status,
      v_type || ' · ' || public.fmt_d(new.from_date) || coalesce(nullif(' — ' || new.review_note, ' — '), ''), '/me/leaves');
  end if;
  return new;
end $$;
drop trigger if exists notify_leave on public.leave_requests;
create trigger notify_leave after insert or update of status on public.leave_requests for each row execute function public.tg_notify_leave();

-- regularisation -----------------------------------------------------------------
create or replace function public.tg_notify_regularisation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_users_with_perm('attendance.manage', 'attendance', 'Attendance correction — ' || public.emp_name(new.employee_id),
      public.fmt_d(new.date) || ': ' || left(new.reason, 80), '/admin/approvals', public.app_user_id());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify_employee(new.employee_id, 'attendance', 'Attendance correction ' || new.status, public.fmt_d(new.date), '/me/attendance');
  end if;
  return new;
end $$;
drop trigger if exists notify_regularisation on public.regularisations;
create trigger notify_regularisation after insert or update of status on public.regularisations for each row execute function public.tg_notify_regularisation();

-- advances ------------------------------------------------------------------------
create or replace function public.tg_notify_advance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_users_with_perm('payroll.manage', 'payroll', 'Advance request — ' || public.emp_name(new.employee_id),
      '₹' || to_char(new.amount, 'FM99,99,99,999') || ' · ' || left(new.reason, 60), '/admin/approvals', public.app_user_id());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('active', 'rejected') then
    perform public.notify_employee(new.employee_id, 'payroll',
      case when new.status = 'active' then 'Advance approved' else 'Advance rejected' end,
      '₹' || to_char(new.amount, 'FM99,99,99,999') || coalesce(nullif(' — ' || new.review_note, ' — '), ''), '/me/payslips');
  end if;
  return new;
end $$;
drop trigger if exists notify_advance on public.advances;
create trigger notify_advance after insert or update of status on public.advances for each row execute function public.tg_notify_advance();

-- petty cash ----------------------------------------------------------------------
create or replace function public.tg_notify_voucher() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_users_with_perm('petty_cash.manage', 'petty_cash', 'Petty-cash claim — ' || public.emp_name(new.employee_id),
      new.voucher_no || ' · ₹' || to_char(new.amount, 'FM99,99,999') || ' · ' || new.category, '/admin/approvals', public.app_user_id());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected', 'paid') then
    perform public.notify_employee(new.employee_id, 'petty_cash', 'Claim ' || new.status || ' · ' || new.voucher_no,
      '₹' || to_char(new.amount, 'FM99,99,999') || coalesce(nullif(' — ' || new.review_note, ' — '), ''), '/me/claims');
  end if;
  return new;
end $$;
drop trigger if exists notify_voucher on public.petty_cash_vouchers;
create trigger notify_voucher after insert or update of status on public.petty_cash_vouchers for each row execute function public.tg_notify_voucher();

-- tasks ---------------------------------------------------------------------------
create or replace function public.tg_notify_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_new uuid[];
begin
  if tg_op = 'INSERT' then v_new := new.assignee_ids;
  else v_new := array(select unnest(new.assignee_ids) except select unnest(old.assignee_ids));
  end if;
  if cardinality(v_new) > 0 then
    insert into public.notifications (user_id, type, title, body, link)
    select u.id, 'task', 'New task assigned · ' || new.task_no, new.title || coalesce(' · due ' || public.fmt_d(new.due_date), ''), '/me/tasks'
    from public.app_users u where u.active and u.employee_id = any (v_new) and u.id is distinct from public.app_user_id();
  end if;
  return new;
end $$;
drop trigger if exists notify_task on public.tasks;
create trigger notify_task after insert or update of assignee_ids on public.tasks for each row execute function public.tg_notify_task();

create or replace function public.tg_notify_task_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  insert into public.notifications (user_id, type, title, body, link)
  select distinct u.id, 'task', new.author_name || ' commented · ' || t.task_no, left(new.body, 120), '/me/tasks'
  from public.app_users u
  where u.active and u.id <> new.author_user_id and (u.employee_id = any (t.assignee_ids) or u.id = t.created_by);
  return new;
end $$;
drop trigger if exists notify_task_comment on public.task_comments;
create trigger notify_task_comment after insert on public.task_comments for each row execute function public.tg_notify_task_comment();

-- payslips ------------------------------------------------------------------------
create or replace function public.tg_notify_payslip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    perform public.notify_employee(new.employee_id, 'payroll', 'Payslip published',
      'Your payslip for ' || to_char(to_date(new.month || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY') || ' is ready.', '/me/payslips');
  end if;
  return new;
end $$;
drop trigger if exists notify_payslip on public.payslips;
create trigger notify_payslip after insert or update of published on public.payslips for each row execute function public.tg_notify_payslip();

-- announcements -------------------------------------------------------------------
create or replace function public.tg_notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select u.id, 'announcement', new.title, left(new.body, 140),
    case when r.is_admin_portal then '/admin/announcements' else '/me/announcements' end
  from public.app_users u join public.roles r on r.id = u.role_id left join public.employees e on e.id = u.employee_id
  where u.active and u.id is distinct from new.created_by
    and (cardinality(new.audience_department_ids) = 0 or e.department_id = any (new.audience_department_ids));
  return new;
end $$;
drop trigger if exists notify_announcement on public.announcements;
create trigger notify_announcement after insert on public.announcements for each row execute function public.tg_notify_announcement();

revoke all on function public.notify_users_with_perm(text, text, text, text, text, uuid), public.notify_employee(uuid, text, text, text, text) from public, anon, authenticated;
