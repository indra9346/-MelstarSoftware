-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — security: identity helpers, Row Level Security, guards, storage
--
-- Model
--  · Every signed-in person has a row in app_users (linked to auth.users by
--    auth_user_id, auto-linked by e-mail on sign-up) with one role.
--  · A role holds a list of permission keys (e.g. 'payroll.manage').
--  · Employee self-service: rows whose employee_id is the caller's own are
--    readable (and, for requests, creatable) without any permission.
--  · Guard triggers stop self-service users from changing anything beyond
--    what the UI allows (e.g. approving their own leave).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── identity helpers (security definer so they can read app_users under RLS) ──
create or replace function public.app_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.app_users where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.app_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.app_users where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.app_department_id() returns uuid
language sql stable security definer set search_path = public as $$
  select e.department_id from public.app_users u join public.employees e on e.id = u.employee_id
  where u.auth_user_id = auth.uid() and u.active limit 1
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where auth_user_id = auth.uid() and active)
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u join public.roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid() and u.active and p = any (r.permissions)
  )
$$;

create or replace function public.has_any_perm(ps text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u join public.roles r on r.id = u.role_id
    where u.auth_user_id = auth.uid() and u.active and r.permissions && ps
  )
$$;

-- true for the service role and direct database sessions (migrations, seed scripts, SQL editor)
create or replace function public.is_privileged() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'none') in ('service_role', 'none')
$$;

revoke all on function public.app_user_id(), public.app_employee_id(), public.app_department_id(), public.is_staff(),
  public.has_perm(text), public.has_any_perm(text[]) from public, anon;
grant execute on function public.app_user_id(), public.app_employee_id(), public.app_department_id(), public.is_staff(),
  public.has_perm(text), public.has_any_perm(text[]) to authenticated;

-- ── link auth.users ↔ app_users by e-mail ────────────────────────────────────
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.app_users set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created_link_app_user on auth.users;
create trigger on_auth_user_created_link_app_user
  after insert on auth.users for each row execute function public.link_auth_user();

-- ── employee directory: names/departments for everyone, no salary/ID/bank data ──
create or replace view public.employee_directory as
  select id, created_at, updated_at, emp_code, first_name, last_name, gender, email, phone, department_id, designation_id,
         reporting_to, employment_type, date_of_joining, date_of_exit, status, shift_id, work_centre_id, photo, skills
  from public.employees
  where public.is_staff();
revoke all on public.employee_directory from anon, public;
grant select on public.employee_directory to authenticated;

-- ── enable RLS everywhere ────────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- helper to (re)create policies idempotently
create or replace function pg_temp.policy(p_table text, p_name text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', p_name, p_table, p_cmd,
    case when p_using is not null then 'using (' || p_using || ')' else '' end,
    case when p_check is not null then 'with check (' || p_check || ')' else '' end);
end $$;

-- ── reference tables: every staff member reads; one permission writes ────────
do $$
declare r record;
begin
  for r in select * from (values
    ('company_settings', 'settings.manage'), ('directors', 'settings.manage'), ('roles', 'users.manage'),
    ('departments', 'employees.manage'), ('designations', 'employees.manage'), ('shifts', 'attendance.manage'),
    ('work_centres', 'machines.manage'), ('leave_types', 'leaves.manage'), ('holidays', 'leaves.manage')
  ) as v(t, perm) loop
    perform pg_temp.policy(r.t, 'staff read', 'select', '(select public.is_staff())');
    perform pg_temp.policy(r.t, 'manage', 'all', format('(select public.has_perm(%L))', r.perm), format('(select public.has_perm(%L))', r.perm));
  end loop;
end $$;

-- ── module tables: read with any of the read perms, write with manage perm ───
do $$
declare r record;
begin
  for r in select * from (values
    ('machines',              '{machines.view,machines.manage,tasks.manage}',                         'machines.manage'),
    ('maintenance_schedules', '{machines.view,machines.manage}',                                      'machines.manage'),
    ('maintenance_logs',      '{machines.view,machines.manage}',                                      'machines.manage'),
    ('inventory_items',       '{inventory.view,inventory.manage,purchase.view,purchase.manage,machines.view,machines.manage}', 'inventory.manage'),
    ('stock_movements',       '{inventory.view,inventory.manage,purchase.view,purchase.manage,machines.manage}', 'inventory.manage'),
    ('assets',                '{inventory.view,inventory.manage,quality.view,quality.manage}',         'inventory.manage'),
    ('vendors',               '{purchase.view,purchase.manage,inventory.view,inventory.manage}',       'purchase.manage'),
    ('purchase_orders',       '{purchase.view,purchase.manage,quality.view,quality.manage,inventory.manage}', 'purchase.manage'),
    ('purchase_order_lines',  '{purchase.view,purchase.manage,quality.view,quality.manage,inventory.manage}', 'purchase.manage'),
    ('customers',             '{sales.view,sales.manage,quality.view,quality.manage}',                 'sales.manage'),
    ('work_orders',           '{sales.view,sales.manage,quality.view,quality.manage,machines.view,tasks.manage}', 'sales.manage'),
    ('inspections',           '{quality.view,quality.manage}',                                         'quality.manage'),
    ('ncrs',                  '{quality.view,quality.manage}',                                         'quality.manage'),
    ('payroll_runs',          '{payroll.view,payroll.manage}',                                         'payroll.manage'),
    ('petty_cash_entries',    '{petty_cash.view,petty_cash.manage}',                                   'petty_cash.manage')
  ) as v(t, readers, perm) loop
    perform pg_temp.policy(r.t, 'module read', 'select', format('(select public.has_any_perm(%L::text[]))', r.readers));
    perform pg_temp.policy(r.t, 'manage', 'all', format('(select public.has_perm(%L))', r.perm), format('(select public.has_perm(%L))', r.perm));
  end loop;
end $$;

-- stock changes also come from goods receipts (purchase) and spares used (maintenance)
select pg_temp.policy('inventory_items', 'stock update by purchase/maintenance', 'update',
  '(select public.has_any_perm(''{purchase.manage,machines.manage}''::text[]))', '(select public.has_any_perm(''{purchase.manage,machines.manage}''::text[]))');
select pg_temp.policy('stock_movements', 'stock insert by purchase/maintenance', 'insert', null,
  '(select public.has_any_perm(''{purchase.manage,machines.manage}''::text[]))');
-- calibration updates by QA
select pg_temp.policy('assets', 'calibration update by quality', 'update',
  '(select public.has_perm(''quality.manage''))', '(select public.has_perm(''quality.manage''))');

-- ── personal tables: own rows + permission holders ───────────────────────────
do $$
declare r record;
begin
  for r in select * from (values
    ('employees',          'id',          '{employees.view,employees.manage}',        'employees.manage'),
    ('emergency_contacts', 'employee_id', '{employees.view,employees.manage}',        'employees.manage'),
    ('employee_documents', 'employee_id', '{employees.view,employees.manage}',        'employees.manage'),
    ('attendance',         'employee_id', '{attendance.view,attendance.manage}',      'attendance.manage'),
    ('regularisations',    'employee_id', '{attendance.view,attendance.manage}',      'attendance.manage'),
    ('leave_balances',     'employee_id', '{leaves.view,leaves.manage}',              'leaves.manage'),
    ('leave_requests',     'employee_id', '{leaves.view,leaves.manage,attendance.view,payroll.manage}', 'leaves.manage'),
    ('salary_structures',  'employee_id', '{payroll.view,payroll.manage}',            'payroll.manage'),
    ('advances',           'employee_id', '{payroll.view,payroll.manage}',            'payroll.manage'),
    ('petty_cash_vouchers','employee_id', '{petty_cash.view,petty_cash.manage}',      'petty_cash.manage'),
    ('tool_issues',        'employee_id', '{inventory.view,inventory.manage}',        'inventory.manage')
  ) as v(t, col, readers, perm) loop
    perform pg_temp.policy(r.t, 'read own or permitted', 'select',
      format('%I = (select public.app_employee_id()) or (select public.has_any_perm(%L::text[]))', r.col, r.readers));
    perform pg_temp.policy(r.t, 'manage', 'all', format('(select public.has_perm(%L))', r.perm), format('(select public.has_perm(%L))', r.perm));
  end loop;
end $$;

-- payroll data other modules need (attendance managers see leave; payroll sees attendance)
select pg_temp.policy('attendance', 'payroll reads attendance', 'select', '(select public.has_any_perm(''{payroll.view,payroll.manage,leaves.manage}''::text[]))');

-- self-service writes (guard triggers below enforce the details)
select pg_temp.policy('employees', 'update own contact details', 'update', 'id = (select public.app_employee_id())', 'id = (select public.app_employee_id())');
select pg_temp.policy('emergency_contacts', 'own contacts', 'all', 'employee_id = (select public.app_employee_id())', 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('employee_documents', 'upload own documents', 'insert', null, 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('regularisations', 'request own', 'insert', null, 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('regularisations', 'withdraw own pending', 'delete', 'employee_id = (select public.app_employee_id()) and status = ''pending''');
select pg_temp.policy('leave_requests', 'apply own', 'insert', null, 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('leave_requests', 'cancel own', 'update', 'employee_id = (select public.app_employee_id())', 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('advances', 'request own', 'insert', null, 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('advances', 'withdraw own pending', 'delete', 'employee_id = (select public.app_employee_id()) and status = ''pending''');
select pg_temp.policy('petty_cash_vouchers', 'claim own', 'insert', null, 'employee_id = (select public.app_employee_id())');
select pg_temp.policy('petty_cash_vouchers', 'withdraw own pending', 'delete', 'employee_id = (select public.app_employee_id()) and status = ''pending''');

-- payslips: own only once published
select pg_temp.policy('payslips', 'read own published or permitted', 'select',
  '(employee_id = (select public.app_employee_id()) and published) or (select public.has_any_perm(''{payroll.view,payroll.manage}''::text[]))');
select pg_temp.policy('payslips', 'manage', 'all', '(select public.has_perm(''payroll.manage''))', '(select public.has_perm(''payroll.manage''))');

select pg_temp.policy('advance_recoveries', 'read own or permitted', 'select',
  '(select public.has_any_perm(''{payroll.view,payroll.manage}''::text[])) or exists (select 1 from public.advances a where a.id = advance_id and a.employee_id = (select public.app_employee_id()))');
select pg_temp.policy('advance_recoveries', 'manage', 'all', '(select public.has_perm(''payroll.manage''))', '(select public.has_perm(''payroll.manage''))');

-- tasks: managers; assignees and creators see theirs; assignees move cards
select pg_temp.policy('tasks', 'read assigned or permitted', 'select',
  '(select public.app_employee_id()) = any (assignee_ids) or created_by = (select public.app_user_id()) or (select public.has_any_perm(''{tasks.view,tasks.manage}''::text[]))');
select pg_temp.policy('tasks', 'manage', 'all', '(select public.has_perm(''tasks.manage''))', '(select public.has_perm(''tasks.manage''))');
select pg_temp.policy('tasks', 'assignee update', 'update', '(select public.app_employee_id()) = any (assignee_ids)', '(select public.app_employee_id()) = any (assignee_ids)');

select pg_temp.policy('task_comments', 'read on visible tasks', 'select', 'exists (select 1 from public.tasks t where t.id = task_id)');
select pg_temp.policy('task_comments', 'comment on visible tasks', 'insert', null,
  'author_user_id = (select public.app_user_id()) and exists (select 1 from public.tasks t where t.id = task_id)');
select pg_temp.policy('task_comments', 'delete own or manage', 'delete', 'author_user_id = (select public.app_user_id()) or (select public.has_perm(''tasks.manage''))');

select pg_temp.policy('todos', 'own todos', 'all', 'user_id = (select public.app_user_id())', 'user_id = (select public.app_user_id())');

-- announcements: audience = everyone or the reader's department
select pg_temp.policy('announcements', 'read for audience', 'select',
  '(select public.is_staff()) and (cardinality(audience_department_ids) = 0 or (select public.app_department_id()) = any (audience_department_ids) or (select public.has_perm(''announcements.manage'')))');
select pg_temp.policy('announcements', 'manage', 'all', '(select public.has_perm(''announcements.manage''))', '(select public.has_perm(''announcements.manage''))');
select pg_temp.policy('announcement_reads', 'read own or manager', 'select', 'user_id = (select public.app_user_id()) or (select public.has_perm(''announcements.manage''))');
select pg_temp.policy('announcement_reads', 'mark own read', 'insert', null, 'user_id = (select public.app_user_id())');

-- notifications: own inbox; any staff member may notify another
select pg_temp.policy('notifications', 'read own', 'select', 'user_id = (select public.app_user_id())');
select pg_temp.policy('notifications', 'update own', 'update', 'user_id = (select public.app_user_id())', 'user_id = (select public.app_user_id())');
select pg_temp.policy('notifications', 'delete own', 'delete', 'user_id = (select public.app_user_id())');
select pg_temp.policy('notifications', 'staff notify', 'insert', null, '(select public.is_staff())');

-- users: own row; user managers everything
select pg_temp.policy('app_users', 'read own or manager', 'select', 'auth_user_id = (select auth.uid()) or (select public.has_perm(''users.manage''))');
select pg_temp.policy('app_users', 'manage', 'all', '(select public.has_perm(''users.manage''))', '(select public.has_perm(''users.manage''))');

-- audit: append-only
select pg_temp.policy('audit_logs', 'read', 'select', '(select public.has_perm(''audit.view''))');
select pg_temp.policy('audit_logs', 'append', 'insert', null, '(select public.is_staff()) and (user_id is null or user_id = (select public.app_user_id()))');

-- ── guard triggers ───────────────────────────────────────────────────────────
-- jsonb diff helper: true when any column outside p_allowed changed
create or replace function public.changed_outside(p_old jsonb, p_new jsonb, p_allowed text[]) returns boolean
language sql immutable as $$
  select (p_old - p_allowed) is distinct from (p_new - p_allowed)
$$;

create or replace function public.guard_employees() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged() then return new; end if;
  if not public.has_perm('employees.manage') then
    if public.changed_outside(to_jsonb(old), to_jsonb(new),
      array['phone','personal_email','address','city','pincode','photo','blood_group','marital_status','updated_at']) then
      raise exception 'You can update only your contact details. Ask HR to change other fields.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_employees on public.employees;
create trigger guard_employees before update on public.employees for each row execute function public.guard_employees();

create or replace function public.guard_leave_requests() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged() or public.has_perm('leaves.manage') then return new; end if;
  if tg_op = 'INSERT' then
    new.employee_id := public.app_employee_id();
    new.status := 'pending';
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := '';
    new.applied_at := now();
    return new;
  end if;
  -- self-service update: cancel only
  if new.status <> 'cancelled' or old.status not in ('pending', 'approved')
     or (old.status = 'approved' and old.from_date <= (now() at time zone 'Asia/Kolkata')::date)
     or public.changed_outside(to_jsonb(old), to_jsonb(new), array['status','updated_at']) then
    raise exception 'You can only cancel a pending leave, or an approved leave that has not started.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_leave_requests on public.leave_requests;
create trigger guard_leave_requests before insert or update on public.leave_requests for each row execute function public.guard_leave_requests();

create or replace function public.guard_regularisations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_privileged() and not public.has_perm('attendance.manage') then
    new.employee_id := public.app_employee_id();
    new.status := 'pending';
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := '';
  end if;
  return new;
end $$;
drop trigger if exists guard_regularisations on public.regularisations;
create trigger guard_regularisations before insert on public.regularisations for each row execute function public.guard_regularisations();

create or replace function public.guard_advances() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_privileged() and not public.has_perm('payroll.manage') then
    new.employee_id := public.app_employee_id();
    new.status := 'pending';
    new.approved_by := null; new.approved_at := null; new.disbursed_on := null; new.review_note := '';
  end if;
  return new;
end $$;
drop trigger if exists guard_advances on public.advances;
create trigger guard_advances before insert on public.advances for each row execute function public.guard_advances();

create or replace function public.fy_label(d date) returns text
language sql immutable as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0') end
$$;

-- next number in a series, e.g. next_doc_no('petty_cash_vouchers','voucher_no','PCV/2026-27/', 4) → 'PCV/2026-27/0123'
create or replace function public.next_doc_no(p_table text, p_column text, p_prefix text, p_width int default 4) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_table || ':' || p_prefix));
  execute format('select coalesce(max(nullif(substring(%I from ''(\d+)$''), '''')::int), 0) from public.%I where %I like $1', p_column, p_table, p_column)
    into n using p_prefix || '%';
  return p_prefix || lpad((n + 1)::text, p_width, '0');
end $$;
revoke all on function public.next_doc_no(text, text, text, int) from public, anon;
grant execute on function public.next_doc_no(text, text, text, int) to authenticated;

create or replace function public.guard_petty_cash_vouchers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_privileged() and coalesce(new.voucher_no, '') <> '' then return new; end if;
  if not public.is_privileged() and not public.has_perm('petty_cash.manage') then
    new.employee_id := public.app_employee_id();
    new.status := 'pending';
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := ''; new.paid_at := null; new.ledger_entry_id := null;
  end if;
  -- the server owns the voucher series (employees cannot see each other's numbers)
  new.voucher_no := public.next_doc_no('petty_cash_vouchers', 'voucher_no', 'PCV/' || public.fy_label(new.date) || '/', 4);
  return new;
end $$;
drop trigger if exists guard_petty_cash_vouchers on public.petty_cash_vouchers;
create trigger guard_petty_cash_vouchers before insert on public.petty_cash_vouchers for each row execute function public.guard_petty_cash_vouchers();

create or replace function public.guard_employee_documents() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_privileged() and not public.has_perm('employees.manage') then
    new.employee_id := public.app_employee_id();
    new.verified := false;
    new.uploaded_by := public.app_user_id();
  end if;
  return new;
end $$;
drop trigger if exists guard_employee_documents on public.employee_documents;
create trigger guard_employee_documents before insert on public.employee_documents for each row execute function public.guard_employee_documents();

create or replace function public.guard_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_privileged() and not public.has_perm('tasks.manage')
     and public.changed_outside(to_jsonb(old), to_jsonb(new), array['status','checklist','sort_order','completed_at','updated_at']) then
    raise exception 'Assignees can move the task and tick the checklist; ask your supervisor to change other details.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_tasks on public.tasks;
create trigger guard_tasks before update on public.tasks for each row execute function public.guard_tasks();

create or replace function public.guard_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_privileged() and public.changed_outside(to_jsonb(old), to_jsonb(new), array['read','updated_at']) then
    raise exception 'Only the read flag of a notification can change.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_notifications on public.notifications;
create trigger guard_notifications before update on public.notifications for each row execute function public.guard_notifications();

-- ── storage: private bucket for employee documents, bills and attachments ────
insert into storage.buckets (id, name, public, file_size_limit)
values ('erp-files', 'erp-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- object path convention: <employee_id>/<area>/<uuid>-<file name>
drop policy if exists "erp-files read" on storage.objects;
create policy "erp-files read" on storage.objects for select to authenticated using (
  bucket_id = 'erp-files' and (
    (storage.foldername(name))[1] = (select public.app_employee_id())::text
    or (select public.has_any_perm('{employees.view,employees.manage,petty_cash.view,petty_cash.manage,leaves.view,leaves.manage}'::text[]))
  )
);
drop policy if exists "erp-files upload" on storage.objects;
create policy "erp-files upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'erp-files' and (select public.is_staff()) and (
    (storage.foldername(name))[1] = (select public.app_employee_id())::text
    or (select public.has_any_perm('{employees.manage,petty_cash.manage,leaves.manage}'::text[]))
  )
);
drop policy if exists "erp-files delete" on storage.objects;
create policy "erp-files delete" on storage.objects for delete to authenticated using (
  bucket_id = 'erp-files' and (select public.has_perm('employees.manage'))
);
