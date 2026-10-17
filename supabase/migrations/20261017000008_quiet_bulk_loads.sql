-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — notification triggers fire only for real users
-- Bulk loads (seed scripts, migrations, service role) don't fan out notifications.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists notify_leave on public.leave_requests;
create trigger notify_leave after insert or update of status on public.leave_requests
  for each row when (not public.is_privileged()) execute function public.tg_notify_leave();

drop trigger if exists notify_regularisation on public.regularisations;
create trigger notify_regularisation after insert or update of status on public.regularisations
  for each row when (not public.is_privileged()) execute function public.tg_notify_regularisation();

drop trigger if exists notify_advance on public.advances;
create trigger notify_advance after insert or update of status on public.advances
  for each row when (not public.is_privileged()) execute function public.tg_notify_advance();

drop trigger if exists notify_voucher on public.petty_cash_vouchers;
create trigger notify_voucher after insert or update of status on public.petty_cash_vouchers
  for each row when (not public.is_privileged()) execute function public.tg_notify_voucher();

drop trigger if exists notify_task on public.tasks;
create trigger notify_task after insert or update of assignee_ids on public.tasks
  for each row when (not public.is_privileged()) execute function public.tg_notify_task();

drop trigger if exists notify_task_comment on public.task_comments;
create trigger notify_task_comment after insert on public.task_comments
  for each row when (not public.is_privileged()) execute function public.tg_notify_task_comment();

drop trigger if exists notify_payslip on public.payslips;
create trigger notify_payslip after insert or update of published on public.payslips
  for each row when (not public.is_privileged()) execute function public.tg_notify_payslip();

drop trigger if exists notify_announcement on public.announcements;
create trigger notify_announcement after insert on public.announcements
  for each row when (not public.is_privileged()) execute function public.tg_notify_announcement();
