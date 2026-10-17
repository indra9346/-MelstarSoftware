-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — schema
-- Melstar Manufacturing Systems Pvt Ltd (CIN U29309KA2011PTC060656)
--
-- Column names match src/data/types.ts exactly (snake_case), so the web app
-- reads and writes these tables without any mapping layer.
-- Dates: date · timestamps: timestamptz · months: text 'YYYY-MM' · times of day: text 'HH:MM'
-- Money: domain inr = numeric(14,2)
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- updated_at maintenance -----------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- helper domains -------------------------------------------------------------
do $$ begin
  create domain public.year_month as text check (value ~ '^\d{4}-(0[1-9]|1[0-2])$');
exception when duplicate_object then null; end $$;
do $$ begin
  create domain public.hhmm as text check (value ~ '^([01]\d|2[0-3]):[0-5]\d$');
exception when duplicate_object then null; end $$;
-- (named "inr", not "money": pg_catalog already has a built-in money type that would shadow it)
do $$ begin
  create domain public.inr as numeric(14,2);
exception when duplicate_object then null; end $$;

-- ═══════════════════════════ Company / admin ═══════════════════════════════

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legal_name text not null,
  short_name text not null,
  cin text not null,
  incorporated_on date not null,
  roc text not null default '',
  company_type text not null default '',
  company_category text not null default '',
  listing_status text not null default '',
  status text not null default 'Active',
  authorised_capital inr not null default 0,
  paid_up_capital inr not null default 0,
  sectors text[] not null default '{}',
  business_activity text not null default '',
  registered_office text not null default '',
  plant_address text not null default '',
  plant_lat double precision not null default 0,
  plant_lng double precision not null default 0,
  plus_code text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  gstin text not null default '',
  pan text not null default '',
  tan text not null default '',
  pf_establishment_code text not null default '',
  esi_employer_code text not null default '',
  pt_registration_no text not null default '',
  financial_year_start_month int not null default 4 check (financial_year_start_month between 1 and 12),
  working_days int[] not null default '{1,2,3,4,5,6}',
  plant_open hhmm not null default '09:00',
  plant_close hhmm not null default '17:00',
  payroll jsonb not null,
  attendance jsonb not null,
  petty_cash_imprest inr not null default 25000 check (petty_cash_imprest >= 0),
  petty_cash_low_alert inr not null default 5000 check (petty_cash_low_alert >= 0),
  petty_cash_approval_limit inr not null default 5000 check (petty_cash_approval_limit >= 0),
  petty_cash_categories text[] not null default '{}',
  currency text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  demo_autopilot boolean not null default false,
  demo_autopilot_through date
);
-- exactly one settings row
create unique index if not exists company_settings_singleton on public.company_settings ((true));

create table if not exists public.directors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  designation text not null,
  din text not null unique check (din ~ '^\d{8}$'),
  appointed_on date not null,
  other_directorships text[] not null default '{}'
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text not null default '',
  permissions text[] not null default '{}',
  is_admin_portal boolean not null default false,
  is_system boolean not null default false
);

-- ═══════════════════════════════ HR ═══════════════════════════════════════

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null unique,
  description text not null default '',
  head_employee_id uuid, -- FK added after employees
  color text not null default '#6366f1'
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null,
  start_time hhmm not null,
  end_time hhmm not null,
  break_minutes int not null default 30 check (break_minutes between 0 and 240),
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  half_day_minutes int not null default 240 check (half_day_minutes > 0),
  full_day_minutes int not null default 450 check (full_day_minutes > 0),
  weekly_offs int[] not null default '{0}',
  color text not null default '#6366f1',
  active boolean not null default true
);

create table if not exists public.work_centres (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null unique,
  description text not null default '',
  color text not null default '#6366f1',
  supervisor_id uuid -- FK added after employees
);

create table if not exists public.designations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  department_id uuid not null references public.departments(id) on delete restrict,
  grade text not null default '',
  description text not null default '',
  unique (title, department_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  emp_code text not null unique,
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null default '',
  gender text not null check (gender in ('male','female','other')),
  dob date not null,
  phone text not null default '',
  email text not null default '',
  personal_email text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default 'Karnataka',
  pincode text not null default '' check (pincode = '' or pincode ~ '^\d{6}$'),
  department_id uuid not null references public.departments(id) on delete restrict,
  designation_id uuid not null references public.designations(id) on delete restrict,
  reporting_to uuid references public.employees(id) on delete set null,
  employment_type text not null check (employment_type in ('permanent','contract','trainee','apprentice','probation')),
  date_of_joining date not null,
  date_of_exit date,
  exit_reason text not null default '',
  status text not null default 'active' check (status in ('active','on_notice','exited')),
  shift_id uuid not null references public.shifts(id) on delete restrict,
  work_centre_id uuid references public.work_centres(id) on delete set null,
  blood_group text not null default '',
  marital_status text not null default 'single' check (marital_status in ('single','married')),
  pan text not null default '' check (pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  aadhaar_masked text not null default '' check (aadhaar_masked = '' or aadhaar_masked ~ '^XXXX-XXXX-\d{4}$'),
  uan text not null default '',
  esic_no text not null default '',
  bank_name text not null default '',
  bank_account text not null default '',
  ifsc text not null default '' check (ifsc = '' or ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  photo text,
  skills text[] not null default '{}',
  tax_regime text not null default 'new' check (tax_regime in ('new','old')),
  declared_deductions inr not null default 0 check (declared_deductions >= 0),
  notes text not null default '',
  check (date_of_exit is null or date_of_exit >= date_of_joining),
  check (dob < date_of_joining)
);
create index if not exists employees_department_idx on public.employees (department_id);
create index if not exists employees_status_idx on public.employees (status);
create index if not exists employees_reporting_idx on public.employees (reporting_to);
create unique index if not exists employees_email_uidx on public.employees (lower(email)) where email <> '';

do $$ begin
  alter table public.departments add constraint departments_head_fk foreign key (head_employee_id) references public.employees(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.work_centres add constraint work_centres_supervisor_fk foreign key (supervisor_id) references public.employees(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null,
  display_name text not null,
  role_id uuid not null references public.roles(id) on delete restrict,
  employee_id uuid references public.employees(id) on delete set null,
  password_hash text, -- static demo mode only; always null in Supabase
  password_salt text,
  active boolean not null default true,
  last_login_at timestamptz,
  auth_user_id uuid unique references auth.users(id) on delete set null
);
create unique index if not exists app_users_email_uidx on public.app_users (lower(email));
create unique index if not exists app_users_employee_uidx on public.app_users (employee_id) where employee_id is not null;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  at timestamptz not null default now(),
  user_id uuid references public.app_users(id) on delete set null,
  user_name text not null default '',
  action text not null check (action in ('create','update','delete','approve','reject','cancel','login','logout','export','process','pay','check_in','check_out','reset')),
  entity text not null,
  entity_id uuid,
  summary text not null default '',
  changes jsonb
);
create index if not exists audit_logs_at_idx on public.audit_logs (at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  type text not null check (type in ('leave','attendance','task','payroll','petty_cash','announcement','maintenance','inventory','purchase','quality','system')),
  title text not null,
  body text not null default '',
  link text,
  read boolean not null default false
);
create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null,
  relation text not null default '',
  phone text not null,
  address text not null default '',
  is_primary boolean not null default false
);
create index if not exists emergency_contacts_emp_idx on public.emergency_contacts (employee_id);

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  doc_type text not null check (doc_type in ('aadhaar','pan','offer_letter','appointment_letter','education','experience','bank_proof','photo','medical','training','other')),
  title text not null,
  file_name text not null default '',
  file_type text not null default '',
  file_size int not null default 0 check (file_size >= 0),
  file_data text, -- Supabase Storage path in bucket "documents" (data URL only in static mode)
  expiry_date date,
  verified boolean not null default false,
  uploaded_by uuid references public.app_users(id) on delete set null
);
create index if not exists employee_documents_emp_idx on public.employee_documents (employee_id);

-- ═══════════════════════════ Attendance ═══════════════════════════════════

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  shift_id uuid not null references public.shifts(id) on delete restrict,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'present' check (status in ('present','half_day','absent','on_duty')),
  late_minutes int not null default 0 check (late_minutes >= 0),
  early_exit_minutes int not null default 0 check (early_exit_minutes >= 0),
  worked_minutes int not null default 0 check (worked_minutes >= 0),
  ot_minutes int not null default 0 check (ot_minutes >= 0),
  ot_status text not null default 'none' check (ot_status in ('none','pending','approved','rejected')),
  source text not null default 'web' check (source in ('web','mobile','biometric','manual','regularised')),
  check_in_lat double precision,
  check_in_lng double precision,
  check_in_distance_m int,
  remarks text not null default '',
  unique (employee_id, date),
  check (check_out is null or check_in is null or check_out >= check_in)
);
create index if not exists attendance_date_idx on public.attendance (date);
create index if not exists attendance_ot_pending_idx on public.attendance (ot_status) where ot_status = 'pending';

create table if not exists public.regularisations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  requested_check_in hhmm,
  requested_check_out hhmm,
  requested_status text not null default 'present' check (requested_status in ('present','half_day','absent','on_duty')),
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default ''
);
create index if not exists regularisations_emp_idx on public.regularisations (employee_id, date);
create index if not exists regularisations_pending_idx on public.regularisations (status) where status = 'pending';

-- ═══════════════════════════════ Leaves ═══════════════════════════════════

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null,
  annual_quota numeric(6,1) not null default 0 check (annual_quota >= 0),
  paid boolean not null default true,
  carry_forward boolean not null default false,
  max_carry_forward numeric(6,1) not null default 0 check (max_carry_forward >= 0),
  allow_half_day boolean not null default true,
  document_after_days int not null default 0 check (document_after_days >= 0),
  gender text check (gender in ('male','female','other')),
  color text not null default '#6366f1',
  active boolean not null default true
);

create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year int not null check (year between 2011 and 2100),
  opening numeric(6,1) not null default 0,
  allotted numeric(6,1) not null default 0,
  adjustment numeric(6,1) not null default 0,
  unique (employee_id, leave_type_id, year)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  from_date date not null,
  to_date date not null,
  half_day boolean not null default false,
  half_day_session text check (half_day_session in ('first','second')),
  days numeric(5,1) not null check (days > 0),
  reason text not null check (length(trim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  applied_at timestamptz not null default now(),
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  attachment text,
  check (to_date >= from_date),
  check (not half_day or from_date = to_date)
);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, from_date);
create index if not exists leave_requests_pending_idx on public.leave_requests (status) where status = 'pending';

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date date not null,
  name text not null,
  type text not null default 'festival' check (type in ('national','festival','optional','company')),
  description text not null default '',
  unique (date, name)
);

-- ═══════════════════════════════ Payroll ══════════════════════════════════

create table if not exists public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  effective_from date not null,
  ctc_annual inr not null default 0 check (ctc_annual >= 0),
  basic inr not null check (basic >= 0),
  da inr not null default 0 check (da >= 0),
  hra inr not null default 0 check (hra >= 0),
  conveyance inr not null default 0 check (conveyance >= 0),
  special_allowance inr not null default 0 check (special_allowance >= 0),
  other_allowance inr not null default 0 check (other_allowance >= 0),
  pf_applicable boolean not null default true,
  esi_applicable boolean not null default false,
  pt_applicable boolean not null default true,
  ot_eligible boolean not null default false,
  ot_rate_per_hour inr check (ot_rate_per_hour is null or ot_rate_per_hour >= 0),
  notes text not null default '',
  unique (employee_id, effective_from)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  month year_month not null unique,
  status text not null default 'draft' check (status in ('draft','processed','approved','paid')),
  employee_count int not null default 0,
  total_gross inr not null default 0,
  total_deductions inr not null default 0,
  total_net inr not null default 0,
  total_employer_cost inr not null default 0,
  processed_at timestamptz,
  processed_by uuid references public.app_users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.app_users(id) on delete set null,
  paid_at timestamptz,
  payment_ref text not null default '',
  notes text not null default ''
);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  month year_month not null,
  days_in_month int not null check (days_in_month between 28 and 31),
  working_days numeric(5,1) not null default 0,
  present_days numeric(5,1) not null default 0,
  paid_leave_days numeric(5,1) not null default 0,
  holidays numeric(5,1) not null default 0,
  week_offs numeric(5,1) not null default 0,
  lop_days numeric(5,1) not null default 0,
  late_marks int not null default 0,
  paid_days numeric(5,1) not null default 0,
  ot_hours numeric(6,2) not null default 0,
  basic inr not null default 0,
  da inr not null default 0,
  hra inr not null default 0,
  conveyance inr not null default 0,
  special_allowance inr not null default 0,
  other_allowance inr not null default 0,
  ot_pay inr not null default 0,
  bonus inr not null default 0,
  arrears inr not null default 0,
  gross_earnings inr not null default 0,
  pf_employee inr not null default 0,
  esi_employee inr not null default 0,
  professional_tax inr not null default 0,
  tds inr not null default 0,
  advance_recovery inr not null default 0,
  loan_recovery inr not null default 0,
  other_deductions inr not null default 0,
  total_deductions inr not null default 0,
  net_pay inr not null default 0,
  pf_employer_epf inr not null default 0,
  pf_employer_eps inr not null default 0,
  pf_edli inr not null default 0,
  pf_admin inr not null default 0,
  esi_employer inr not null default 0,
  employer_cost inr not null default 0,
  pf_wages inr not null default 0,
  esi_wages inr not null default 0,
  tax_regime text not null default 'new' check (tax_regime in ('new','old')),
  published boolean not null default false,
  remarks text not null default '',
  unique (run_id, employee_id),
  check (net_pay = gross_earnings - total_deductions or net_pay = 0)
);
create index if not exists payslips_emp_month_idx on public.payslips (employee_id, month);

create table if not exists public.advances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text not null check (type in ('salary_advance','loan')),
  amount inr not null check (amount > 0),
  reason text not null check (length(trim(reason)) >= 3),
  requested_on date not null default current_date,
  status text not null default 'pending' check (status in ('pending','approved','rejected','active','closed')),
  installments int not null default 1 check (installments between 1 and 60),
  emi_amount inr not null check (emi_amount > 0),
  start_month year_month not null,
  approved_by uuid references public.app_users(id) on delete set null,
  approved_at timestamptz,
  disbursed_on date,
  review_note text not null default ''
);
create index if not exists advances_emp_idx on public.advances (employee_id);

create table if not exists public.advance_recoveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  advance_id uuid not null references public.advances(id) on delete cascade,
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  month year_month not null,
  amount inr not null check (amount > 0),
  unique (advance_id, payslip_id)
);

-- ═══════════════════════════════ Petty cash ═══════════════════════════════

create table if not exists public.petty_cash_vouchers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voucher_no text not null unique,
  employee_id uuid not null references public.employees(id) on delete restrict,
  date date not null,
  category text not null,
  amount inr not null check (amount > 0),
  payee text not null default '',
  description text not null check (length(trim(description)) >= 3),
  bill_no text not null default '',
  attachment text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '',
  paid_at timestamptz,
  ledger_entry_id uuid
);
create index if not exists petty_cash_vouchers_emp_idx on public.petty_cash_vouchers (employee_id, date);

create table if not exists public.petty_cash_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entry_no text not null unique,
  date date not null,
  type text not null check (type in ('in','out')),
  amount inr not null check (amount > 0),
  category text not null,
  description text not null default '',
  voucher_id uuid unique references public.petty_cash_vouchers(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null
);
create index if not exists petty_cash_entries_date_idx on public.petty_cash_entries (date);
do $$ begin
  alter table public.petty_cash_vouchers add constraint petty_cash_vouchers_ledger_fk foreign key (ledger_entry_id) references public.petty_cash_entries(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ═══════════════════════════════ Tasks ════════════════════════════════════

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  task_no text not null unique,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status text not null default 'todo' check (status in ('todo','in_progress','review','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assignee_ids uuid[] not null default '{}',
  created_by uuid references public.app_users(id) on delete set null,
  due_date date,
  labels text[] not null default '{}',
  work_centre_id uuid references public.work_centres(id) on delete set null,
  checklist jsonb not null default '[]',
  sort_order double precision not null default 0,
  completed_at timestamptz
);
create index if not exists tasks_assignees_idx on public.tasks using gin (assignee_ids);
create index if not exists tasks_status_idx on public.tasks (status);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_user_id uuid not null references public.app_users(id) on delete cascade,
  author_name text not null,
  body text not null check (length(trim(body)) > 0)
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  text text not null check (length(trim(text)) > 0),
  done boolean not null default false,
  due_date date
);
create index if not exists todos_user_idx on public.todos (user_id);

-- ═══════════════════════ Announcements ═══════════════════════════════════

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  category text not null default 'general' check (category in ('general','safety','hr','production','celebration','holiday')),
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  audience_department_ids uuid[] not null default '{}',
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  expires_on date,
  created_by uuid references public.app_users(id) on delete set null,
  author_name text not null default ''
);
create index if not exists announcements_published_idx on public.announcements (published_at desc);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

-- ═════════════════════ Machines & maintenance ════════════════════════════

create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  asset_code text not null unique,
  name text not null,
  make text not null default '',
  model text not null default '',
  serial_no text not null default '',
  work_centre_id uuid not null references public.work_centres(id) on delete restrict,
  install_date date not null,
  status text not null default 'idle' check (status in ('running','idle','breakdown','maintenance')),
  criticality text not null default 'B' check (criticality in ('A','B','C')),
  hour_meter numeric(10,1) not null default 0 check (hour_meter >= 0),
  specs text not null default '',
  notes text not null default ''
);

create table if not exists public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  title text not null,
  frequency text not null check (frequency in ('daily','weekly','monthly','quarterly','half_yearly','yearly')),
  last_done date,
  next_due date not null,
  checklist text[] not null default '{}',
  assigned_to uuid references public.employees(id) on delete set null,
  active boolean not null default true
);
create index if not exists maintenance_schedules_due_idx on public.maintenance_schedules (next_due) where active;

create table if not exists public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  log_no text not null unique,
  machine_id uuid not null references public.machines(id) on delete cascade,
  type text not null check (type in ('preventive','breakdown','corrective','calibration')),
  schedule_id uuid references public.maintenance_schedules(id) on delete set null,
  reported_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  downtime_minutes int not null default 0 check (downtime_minutes >= 0),
  problem text not null,
  action_taken text not null default '',
  root_cause text not null default '',
  technician_id uuid references public.employees(id) on delete set null,
  spares jsonb not null default '[]',
  cost inr not null default 0 check (cost >= 0),
  status text not null default 'open' check (status in ('open','in_progress','closed'))
);
create index if not exists maintenance_logs_machine_idx on public.maintenance_logs (machine_id, reported_at desc);

-- ═════════════════════ Inventory / tools / assets ════════════════════════

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null,
  category text not null default '',
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  gstin text not null default '' check (gstin = '' or gstin ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address text not null default '',
  city text not null default '',
  state text not null default 'Karnataka',
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  rating int not null default 3 check (rating between 1 and 5),
  active boolean not null default true,
  notes text not null default ''
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  name text not null,
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  gstin text not null default '' check (gstin = '' or gstin ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address text not null default '',
  city text not null default '',
  state text not null default 'Karnataka',
  payment_terms_days int not null default 30 check (payment_terms_days >= 0),
  credit_limit inr not null default 0 check (credit_limit >= 0),
  active boolean not null default true,
  notes text not null default ''
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sku text not null unique,
  name text not null,
  category text not null check (category in ('raw_material','consumable','tooling','spare','finished_good','packing')),
  uom text not null,
  stock_qty numeric(14,3) not null default 0 check (stock_qty >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  unit_cost inr not null default 0 check (unit_cost >= 0),
  location text not null default '',
  hsn text not null default '',
  preferred_vendor_id uuid references public.vendors(id) on delete set null,
  active boolean not null default true
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  date date not null default current_date,
  type text not null check (type in ('in','out','adjust')),
  qty numeric(14,3) not null,
  balance_after numeric(14,3) not null check (balance_after >= 0),
  reference text not null default '',
  reason text not null default '',
  by_user_id uuid references public.app_users(id) on delete set null
);
create index if not exists stock_movements_item_idx on public.stock_movements (item_id, date);

create table if not exists public.tool_issues (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  qty numeric(10,2) not null check (qty > 0),
  issued_on date not null default current_date,
  due_back date,
  returned_on date,
  returned_qty numeric(10,2) not null default 0 check (returned_qty >= 0),
  condition text check (condition in ('good','worn','broken')),
  status text not null default 'issued' check (status in ('issued','returned','lost')),
  remarks text not null default ''
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  asset_code text not null unique,
  name text not null,
  category text not null check (category in ('it','gauge','instrument','furniture','vehicle','tool','equipment')),
  make text not null default '',
  serial_no text not null default '',
  purchase_date date,
  cost inr not null default 0 check (cost >= 0),
  location text not null default '',
  custodian_id uuid references public.employees(id) on delete set null,
  calibration_required boolean not null default false,
  calibration_interval_days int not null default 0 check (calibration_interval_days >= 0),
  last_calibrated date,
  calibration_due date,
  certificate_no text not null default '',
  status text not null default 'in_use' check (status in ('in_use','in_store','repair','disposed'))
);
create index if not exists assets_calibration_idx on public.assets (calibration_due) where calibration_required;

-- ═════════════════ Purchase / production ═════════════════════════════════

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  po_no text not null unique,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  date date not null default current_date,
  expected_date date,
  status text not null default 'draft' check (status in ('draft','approved','sent','partial','received','cancelled')),
  subtotal inr not null default 0,
  tax_total inr not null default 0,
  total inr not null default 0,
  intra_state boolean not null default true,
  notes text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  approved_by uuid references public.app_users(id) on delete set null,
  approved_at timestamptz
);
create index if not exists purchase_orders_vendor_idx on public.purchase_orders (vendor_id, date desc);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete set null,
  description text not null,
  qty numeric(14,3) not null check (qty > 0),
  uom text not null default 'nos',
  rate inr not null check (rate >= 0),
  gst_rate numeric(5,2) not null default 18 check (gst_rate between 0 and 40),
  received_qty numeric(14,3) not null default 0 check (received_qty >= 0)
);
create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines (po_id);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  wo_no text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_po_ref text not null default '',
  part_no text not null,
  part_name text not null,
  drawing_rev text not null default '',
  material text not null default '',
  qty int not null check (qty > 0),
  completed_qty int not null default 0 check (completed_qty >= 0),
  rejected_qty int not null default 0 check (rejected_qty >= 0),
  unit_price inr not null default 0 check (unit_price >= 0),
  route_work_centre_ids uuid[] not null default '{}',
  start_date date,
  due_date date not null,
  status text not null default 'planned' check (status in ('planned','in_progress','qc','completed','dispatched','on_hold','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  notes text not null default ''
);
create index if not exists work_orders_status_idx on public.work_orders (status, due_date);

-- ═══════════════════════════════ Quality ══════════════════════════════════

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  insp_no text not null unique,
  date date not null default current_date,
  type text not null check (type in ('incoming','in_process','final','first_article')),
  work_order_id uuid references public.work_orders(id) on delete set null,
  po_id uuid references public.purchase_orders(id) on delete set null,
  part_name text not null,
  lot_no text not null default '',
  lot_qty int not null default 0 check (lot_qty >= 0),
  sample_size int not null default 0 check (sample_size >= 0),
  accepted_qty int not null default 0 check (accepted_qty >= 0),
  rejected_qty int not null default 0 check (rejected_qty >= 0),
  result text not null check (result in ('pass','fail','conditional')),
  inspector_id uuid references public.employees(id) on delete set null,
  parameters jsonb not null default '[]',
  remarks text not null default '',
  check (accepted_qty + rejected_qty <= lot_qty or lot_qty = 0)
);
create index if not exists inspections_date_idx on public.inspections (date desc);

create table if not exists public.ncrs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ncr_no text not null unique,
  inspection_id uuid references public.inspections(id) on delete set null,
  date date not null default current_date,
  description text not null,
  qty_affected int not null default 0 check (qty_affected >= 0),
  root_cause text not null default '',
  corrective_action text not null default '',
  disposition text not null check (disposition in ('rework','scrap','use_as_is','return_to_vendor')),
  owner_id uuid references public.employees(id) on delete set null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_on date
);

-- updated_at triggers on every table ------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'company_settings','directors','roles','departments','shifts','work_centres','designations','employees','app_users',
    'audit_logs','notifications','emergency_contacts','employee_documents','attendance','regularisations','leave_types',
    'leave_balances','leave_requests','holidays','salary_structures','payroll_runs','payslips','advances','advance_recoveries',
    'petty_cash_vouchers','petty_cash_entries','tasks','task_comments','todos','announcements','announcement_reads','machines',
    'maintenance_schedules','maintenance_logs','vendors','customers','inventory_items','stock_movements','tool_issues','assets',
    'purchase_orders','purchase_order_lines','work_orders','inspections','ncrs'])
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;
