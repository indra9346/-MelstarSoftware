-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — server-side functions (RPC)
-- Check-in / check-out run on the server so punch times come from the
-- database clock, not the phone, and the late / OT maths cannot be edited.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.attendance_check_in(p_lat double precision default null, p_lng double precision default null, p_source text default 'web')
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.app_employee_id();
  v_e public.employees;
  v_s public.shifts;
  v_set public.company_settings;
  v_now timestamptz := now();
  v_tz text;
  v_date date;
  v_start timestamptz;
  v_late int;
  v_dist int;
  v_row public.attendance;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record.' using errcode = '42501';
  end if;
  select * into v_set from public.company_settings limit 1;
  if not coalesce((v_set.attendance ->> 'allow_web_checkin')::boolean, true) then
    raise exception 'Web check-in is switched off — please use the biometric terminal.';
  end if;
  v_tz := coalesce(nullif(v_set.timezone, ''), 'Asia/Kolkata');
  v_date := (v_now at time zone v_tz)::date;
  select * into v_e from public.employees where id = v_emp;
  if v_e.status = 'exited' then raise exception 'This employee has exited.'; end if;
  select * into v_s from public.shifts where id = v_e.shift_id;

  select * into v_row from public.attendance where employee_id = v_emp and date = v_date;
  if found and v_row.check_in is not null then
    raise exception 'Already checked in today at %.', to_char(v_row.check_in at time zone v_tz, 'HH12:MI AM');
  end if;

  v_start := (v_date + v_s.start_time::time) at time zone v_tz;
  v_late := greatest(0, round(extract(epoch from (v_now - v_start)) / 60)::int);
  if v_late <= v_s.grace_minutes then v_late := 0; end if;

  if p_lat is not null and p_lng is not null then
    v_dist := round(2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - v_set.plant_lat) / 2), 2) +
      cos(radians(v_set.plant_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_set.plant_lng) / 2), 2))));
  end if;

  insert into public.attendance (employee_id, date, shift_id, check_in, status, late_minutes, source, check_in_lat, check_in_lng, check_in_distance_m)
  values (v_emp, v_date, v_s.id, v_now, 'present', v_late, case when p_source in ('web', 'mobile') then p_source else 'web' end, p_lat, p_lng, v_dist)
  on conflict (employee_id, date) do update
    set check_in = excluded.check_in, status = 'present', late_minutes = excluded.late_minutes, source = excluded.source,
        check_in_lat = excluded.check_in_lat, check_in_lng = excluded.check_in_lng, check_in_distance_m = excluded.check_in_distance_m
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.attendance_check_out()
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := public.app_employee_id();
  v_s public.shifts;
  v_set public.company_settings;
  v_now timestamptz := now();
  v_tz text;
  v_row public.attendance;
  v_start timestamptz;
  v_end timestamptz;
  v_span int;
  v_worked int;
  v_beyond int;
  v_ot int;
  v_min_ot int;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record.' using errcode = '42501';
  end if;
  select * into v_set from public.company_settings limit 1;
  v_tz := coalesce(nullif(v_set.timezone, ''), 'Asia/Kolkata');
  v_min_ot := coalesce((v_set.attendance ->> 'min_ot_minutes')::int, 30);

  select * into v_row from public.attendance
  where employee_id = v_emp and check_in is not null and check_out is null and check_in > v_now - interval '20 hours'
  order by check_in desc limit 1;
  if not found then raise exception 'No open check-in found for today.'; end if;

  select * into v_s from public.shifts where id = v_row.shift_id;
  v_start := (v_row.date + v_s.start_time::time) at time zone v_tz;
  v_end := (v_row.date + v_s.end_time::time) at time zone v_tz;
  if v_end <= v_start then v_end := v_end + interval '1 day'; end if;

  v_span := greatest(0, round(extract(epoch from (v_now - v_row.check_in)) / 60)::int);
  v_worked := case when v_span > 300 then v_span - v_s.break_minutes else v_span end;
  v_beyond := greatest(0, round(extract(epoch from (v_now - v_end)) / 60)::int);
  v_ot := case when v_beyond >= v_min_ot then (v_beyond / 15) * 15 else 0 end;

  update public.attendance set
    check_out = v_now,
    worked_minutes = greatest(0, v_worked),
    early_exit_minutes = greatest(0, round(extract(epoch from (v_end - v_now)) / 60)::int),
    ot_minutes = v_ot,
    ot_status = case when v_ot > 0 then 'pending' else 'none' end,
    status = case when v_worked >= v_s.half_day_minutes then 'present' else 'half_day' end
  where id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.touch_last_login() returns void
language sql security definer set search_path = public as $$
  update public.app_users set last_login_at = now() where auth_user_id = auth.uid();
$$;

revoke all on function public.attendance_check_in(double precision, double precision, text), public.attendance_check_out(), public.touch_last_login() from public, anon;
grant execute on function public.attendance_check_in(double precision, double precision, text), public.attendance_check_out(), public.touch_last_login() to authenticated;

-- ── Realtime: every table streams changes (RLS still decides who receives what) ──
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
