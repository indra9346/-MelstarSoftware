-- ═══════════════════════════════════════════════════════════════════════════
-- Melstar ERP — atomic stock posting, work-order delivery dates, small fixes
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Stock: every movement is applied by the database under a row lock.
--    The insert computes balance_after from the item's real stock and updates the item in the
--    same statement, so two people posting at once can never leave a wrong balance.
--    Direct edits to inventory_items.stock_qty are ignored — stock moves only via stock_movements.
create or replace function public.tg_stock_movement_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur numeric;
begin
  if public.is_privileged() then return new; end if;
  select stock_qty into cur from public.inventory_items where id = new.item_id for update;
  if not found then raise exception 'Inventory item not found.'; end if;
  if new.type = 'adjust' then
    if new.balance_after < 0 then raise exception 'Counted quantity cannot be negative.' using errcode = '23514'; end if;
    new.qty := new.balance_after - cur;
  elsif new.type = 'in' then
    if new.qty <= 0 then raise exception 'Quantity must be greater than zero.' using errcode = '23514'; end if;
    new.balance_after := cur + new.qty;
  else
    if new.qty <= 0 then raise exception 'Quantity must be greater than zero.' using errcode = '23514'; end if;
    new.balance_after := cur - new.qty;
    if new.balance_after < 0 then
      raise exception 'Only % in stock — cannot issue %.', trim_scale(cur), trim_scale(new.qty) using errcode = '23514';
    end if;
  end if;
  perform set_config('melstar.stock_posting', 'on', true);
  update public.inventory_items set stock_qty = new.balance_after where id = new.item_id;
  perform set_config('melstar.stock_posting', 'off', true);
  return new;
end $$;
drop trigger if exists post_stock_movement on public.stock_movements;
create trigger post_stock_movement before insert on public.stock_movements for each row execute function public.tg_stock_movement_post();

create or replace function public.tg_inventory_stock_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_privileged() or coalesce(current_setting('melstar.stock_posting', true), '') = 'on' then return new; end if;
  new.stock_qty := old.stock_qty;
  return new;
end $$;
drop trigger if exists guard_inventory_stock on public.inventory_items;
create trigger guard_inventory_stock before update on public.inventory_items for each row execute function public.tg_inventory_stock_guard();

-- 2) Work orders: completion and dispatch dates (on-time delivery KPI)
alter table public.work_orders add column if not exists completed_on date;
alter table public.work_orders add column if not exists dispatched_on date;

update public.work_orders set completed_on = (updated_at at time zone 'Asia/Kolkata')::date
  where status in ('completed', 'dispatched') and completed_on is null;
update public.work_orders set dispatched_on = (updated_at at time zone 'Asia/Kolkata')::date
  where status = 'dispatched' and dispatched_on is null;

create or replace function public.tg_work_order_dates() returns trigger
language plpgsql set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status in ('completed', 'dispatched') and new.completed_on is null then new.completed_on := d; end if;
  if new.status = 'dispatched' and new.dispatched_on is null then new.dispatched_on := d; end if;
  if new.status not in ('completed', 'dispatched') then new.completed_on := null; new.dispatched_on := null; end if;
  return new;
end $$;
drop trigger if exists work_order_dates on public.work_orders;
create trigger work_order_dates before insert or update of status on public.work_orders for each row execute function public.tg_work_order_dates();

-- 3) Notification text: "6 d" instead of "6.0 d"
create or replace function public.tg_notify_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  select name into v_type from public.leave_types where id = new.leave_type_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_users_with_perm('leaves.manage', 'leave', 'Leave request — ' || public.emp_name(new.employee_id),
      v_type || ' · ' || public.fmt_d(new.from_date) || case when new.to_date <> new.from_date then ' – ' || public.fmt_d(new.to_date) else '' end || ' (' || trim_scale(new.days) || ' d)',
      '/admin/approvals', public.app_user_id());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify_employee(new.employee_id, 'leave', 'Leave ' || new.status,
      v_type || ' · ' || public.fmt_d(new.from_date) || coalesce(nullif(' — ' || new.review_note, ' — '), ''), '/me/leaves');
  end if;
  return new;
end $$;

-- 4) lock down the new trigger functions like the others
revoke all on function public.tg_stock_movement_post(), public.tg_inventory_stock_guard(), public.tg_work_order_dates() from public, anon, authenticated;
