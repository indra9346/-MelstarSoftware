-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — hardening (Supabase security & performance advisors)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Fixed search_path on every helper/trigger function
alter function public.tg_set_updated_at() set search_path = public;
alter function public.changed_outside(jsonb, jsonb, text[]) set search_path = public;
alter function public.fy_label(date) set search_path = public;
alter function public.is_privileged() set search_path = public;
alter function public.fmt_d(date) set search_path = public;

-- 2) employee_directory: invoker view over a definer function (instead of a definer view)
create or replace function public.employee_directory_rows()
returns table (
  id uuid, created_at timestamptz, updated_at timestamptz, emp_code text, first_name text, last_name text, gender text, email text, phone text,
  department_id uuid, designation_id uuid, reporting_to uuid, employment_type text, date_of_joining date, date_of_exit date, status text,
  shift_id uuid, work_centre_id uuid, photo text, skills text[]
)
language sql stable security definer set search_path = public as $$
  select id, created_at, updated_at, emp_code, first_name, last_name, gender, email, phone, department_id, designation_id,
         reporting_to, employment_type, date_of_joining, date_of_exit, status, shift_id, work_centre_id, photo, skills
  from public.employees
  where public.is_staff()
$$;

drop view if exists public.employee_directory;
create view public.employee_directory with (security_invoker = true) as
  select * from public.employee_directory_rows();
revoke all on public.employee_directory from anon, public;
grant select on public.employee_directory to authenticated;

-- 3) Definer functions: nobody anonymous may call them; signed-in users only those used by
--    RLS policies and the check-in RPCs. (Trigger functions run regardless of EXECUTE rights.)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('app_user_id', 'app_employee_id', 'app_department_id', 'is_staff', 'has_perm', 'has_any_perm',
                     'attendance_check_in', 'attendance_check_out', 'touch_last_login', 'employee_directory_rows') then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- 4) One permissive policy per table and command (same OR-semantics, fewer policy evaluations)
do $$
declare
  p record;
  t text;
  c text;
  using_expr text;
  check_expr text;
begin
  -- 4a) split FOR ALL policies into per-command policies
  for p in select * from pg_policies where schemaname = 'public' and cmd = 'ALL' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', p.policyname || ' (select)', p.tablename, p.qual);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', p.policyname || ' (insert)', p.tablename, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', p.policyname || ' (update)', p.tablename, p.qual, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', p.policyname || ' (delete)', p.tablename, p.qual);
  end loop;

  -- 4b) merge policies that share a table and command
  for t, c in
    select tablename, cmd from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
    group by tablename, cmd having count(*) > 1
  loop
    select string_agg('(' || qual || ')', ' or '), string_agg('(' || coalesce(with_check, qual) || ')', ' or ')
      into using_expr, check_expr
      from pg_policies where schemaname = 'public' and tablename = t and cmd = c;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd = c loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    if c = 'SELECT' then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', 'read', t, using_expr);
    elsif c = 'INSERT' then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', 'insert', t, check_expr);
    elsif c = 'UPDATE' then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', 'update', t, using_expr, check_expr);
    elsif c = 'DELETE' then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', 'delete', t, using_expr);
    end if;
  end loop;
end $$;
