-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — GO-LIVE: remove the demo data
--
-- Run once in Supabase → SQL editor when the client is ready to start using the
-- system for real. It KEEPS: company settings, directors, roles & permissions,
-- departments, designations, shifts, work centres, leave types, holidays and the
-- administrator logins that are not linked to an employee (e.g. admin@…).
-- It DELETES: all demo employees and their logins, attendance, leave, payroll,
-- petty cash, tasks, announcements, notifications, machines, maintenance,
-- inventory, assets, vendors, customers, purchase/work orders, inspections, NCRs
-- and the demo audit trail. This cannot be undone — take a backup first
-- (Database → Backups) if in doubt.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

update public.company_settings set demo_autopilot = false, demo_autopilot_through = null;

-- logins of demo employees (Supabase Auth accounts first, then the app rows)
delete from auth.users
where id in (select auth_user_id from public.app_users where employee_id is not null and auth_user_id is not null);

delete from public.notifications;
delete from public.audit_logs;
delete from public.announcement_reads;
delete from public.announcements;
delete from public.task_comments;
delete from public.tasks;
delete from public.todos;

update public.petty_cash_vouchers set ledger_entry_id = null;
delete from public.petty_cash_entries;
delete from public.petty_cash_vouchers;

delete from public.advance_recoveries;
delete from public.payslips;
delete from public.payroll_runs;
delete from public.advances;
delete from public.salary_structures;

delete from public.leave_requests;
delete from public.leave_balances;
delete from public.regularisations;
delete from public.attendance;

delete from public.employee_documents;
delete from public.emergency_contacts;

delete from public.tool_issues;
delete from public.stock_movements;
delete from public.maintenance_logs;
delete from public.maintenance_schedules;
delete from public.ncrs;
delete from public.inspections;
delete from public.purchase_order_lines;
delete from public.purchase_orders;
delete from public.work_orders;
delete from public.assets;
delete from public.inventory_items;
delete from public.machines;
delete from public.vendors;
delete from public.customers;

update public.departments set head_employee_id = null;
update public.work_centres set supervisor_id = null;
delete from public.app_users where employee_id is not null;
delete from public.employees;

commit;

-- Afterwards: Settings → Company (GSTIN, PAN, TAN, PF/ESI codes), add employees,
-- salary structures and logins (Users & roles), then start attendance.
-- Uploaded files (if any) can be removed from Storage → erp-files in the dashboard.
