/**
 * Customers and work orders: numbering, the planned → in_progress → qc → completed → dispatched
 * flow (plus on_hold / cancelled), progress reporting and the order-book KPIs.
 */
import { db } from '@/data/store'
import type { Customer, Priority, WorkOrder, WorkOrderStatus } from '@/data/types'
import { addDays, todayISO, toISODate } from '@/lib/dates'
import { nextNumber } from '@/lib/ids'
import { round2 } from '@/lib/format'
import { audit, diff } from './audit'
import { requirePerm } from './inventory'
import { cleanParty, partyErrors, type PartyInput } from './purchase'

export const WO_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  planned: 'Planned', in_progress: 'In progress', qc: 'QC', completed: 'Completed', dispatched: 'Dispatched', on_hold: 'On hold', cancelled: 'Cancelled',
}
export const WO_BOARD: WorkOrderStatus[] = ['planned', 'in_progress', 'qc', 'completed', 'dispatched', 'on_hold']
export const OPEN_WO: WorkOrderStatus[] = ['planned', 'in_progress', 'qc', 'on_hold']
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']

/** Allowed next statuses. */
export const WO_NEXT: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  planned: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['qc', 'on_hold', 'cancelled'],
  qc: ['completed', 'in_progress'],
  completed: ['dispatched'],
  on_hold: ['planned', 'in_progress', 'cancelled'],
  dispatched: [],
  cancelled: [],
}

const firstError = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean)

/* ─────────────────────────── customers ─────────────────────────── */

export interface CustomerInput extends PartyInput {
  credit_limit: number | null
  active: boolean
  notes: string
}

export const nextCustomerCode = () => nextNumber('C', db.all('customers').map((c) => c.code), 3)

export function customerErrors(v: CustomerInput): Partial<Record<keyof CustomerInput, string>> {
  const e: Partial<Record<keyof CustomerInput, string>> = partyErrors(v)
  if (v.credit_limit == null) e.credit_limit = 'Required (0 = no credit)'
  else if (v.credit_limit < 0) e.credit_limit = 'Cannot be negative'
  return e
}

export function saveCustomer(existing: Customer | null, v: CustomerInput): Customer {
  requirePerm('sales.manage')
  const err = firstError(customerErrors(v))
  if (err) throw new Error(err)
  const row = { ...cleanParty(v), credit_limit: round2(v.credit_limit ?? 0), active: v.active, notes: v.notes.trim() }
  if (!existing) {
    const c = db.insert('customers', { ...row, code: nextCustomerCode() })
    audit('create', 'customers', c.id, `Added customer ${c.code} — ${c.name}`)
    return c
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const c = db.update('customers', existing.id, row)
  audit('update', 'customers', c.id, `Updated customer ${c.code} — ${c.name}`, changes)
  return c
}

export function deleteCustomer(c: Customer) {
  requirePerm('sales.manage')
  const n = db.count('work_orders', (w) => w.customer_id === c.id)
  if (n) throw new Error(`${c.name} has ${n} work order${n === 1 ? '' : 's'} — mark the customer inactive instead.`)
  db.remove('customers', c.id)
  audit('delete', 'customers', c.id, `Deleted customer ${c.code} — ${c.name}`)
}

/* ─────────────────────────── work orders ─────────────────────────── */

export interface WoInput {
  customer_id: string
  customer_po_ref: string
  part_no: string
  part_name: string
  drawing_rev: string
  material: string
  qty: number | null
  unit_price: number | null
  route_work_centre_ids: string[]
  start_date: string
  due_date: string
  priority: Priority
  notes: string
}

export const nextWoNo = () => nextNumber('WO-', db.all('work_orders').map((w) => w.wo_no))

export function woErrors(v: WoInput, existing?: WorkOrder | null): Partial<Record<keyof WoInput, string>> {
  const e: Partial<Record<keyof WoInput, string>> = {}
  const c = db.get('customers', v.customer_id)
  if (!c) e.customer_id = 'Choose a customer'
  else if (!c.active && c.id !== existing?.customer_id) e.customer_id = 'This customer is inactive'
  if (!v.part_no.trim()) e.part_no = 'Part number is required'
  if (!v.part_name.trim()) e.part_name = 'Part name is required'
  if (v.qty == null) e.qty = 'Quantity is required'
  else if (!Number.isInteger(v.qty) || v.qty <= 0) e.qty = 'Whole number above zero'
  else if (existing && v.qty < existing.completed_qty) e.qty = `${existing.completed_qty} already completed`
  if (v.unit_price == null) e.unit_price = 'Required (0 if free)'
  else if (v.unit_price < 0) e.unit_price = 'Cannot be negative'
  if (!v.route_work_centre_ids.length) e.route_work_centre_ids = 'Add at least one work centre'
  else if (v.route_work_centre_ids.some((id) => !db.get('work_centres', id))) e.route_work_centre_ids = 'A work centre in the route no longer exists'
  if (!v.start_date) e.start_date = 'Start date is required'
  if (!v.due_date) e.due_date = 'Due date is required'
  else if (v.start_date && v.due_date < v.start_date) e.due_date = 'Cannot be before the start date'
  return e
}

export function saveWo(existing: WorkOrder | null, v: WoInput): WorkOrder {
  requirePerm('sales.manage')
  if (existing && (existing.status === 'dispatched' || existing.status === 'cancelled')) throw new Error(`${existing.wo_no} is ${existing.status} and cannot be edited.`)
  const err = firstError(woErrors(v, existing))
  if (err) throw new Error(err)
  const row = {
    customer_id: v.customer_id, customer_po_ref: v.customer_po_ref.trim(), part_no: v.part_no.trim().toUpperCase(), part_name: v.part_name.trim(),
    drawing_rev: v.drawing_rev.trim().toUpperCase(), material: v.material.trim(), qty: v.qty!, unit_price: round2(v.unit_price!),
    route_work_centre_ids: [...v.route_work_centre_ids], start_date: v.start_date, due_date: v.due_date, priority: v.priority, notes: v.notes.trim(),
  }
  if (!existing) {
    const wo = db.insert('work_orders', { ...row, wo_no: nextWoNo(), completed_qty: 0, rejected_qty: 0, status: 'planned', completed_on: null, dispatched_on: null })
    audit('create', 'work_orders', wo.id, `Work order ${wo.wo_no} — ${wo.part_name} × ${wo.qty} for ${db.get('customers', wo.customer_id)?.name ?? ''}`)
    return wo
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const wo = db.update('work_orders', existing.id, row)
  audit('update', 'work_orders', wo.id, `Updated ${wo.wo_no}`, changes)
  return wo
}

export function deleteWo(wo: WorkOrder) {
  requirePerm('sales.manage')
  if (wo.status !== 'planned' || wo.completed_qty > 0 || wo.rejected_qty > 0) throw new Error('Only planned work orders with nothing produced can be deleted — cancel it instead.')
  if (db.count('inspections', (i) => i.work_order_id === wo.id)) throw new Error('Inspections are linked to this work order — cancel it instead.')
  db.remove('work_orders', wo.id)
  audit('delete', 'work_orders', wo.id, `Deleted ${wo.wo_no} — ${wo.part_name}`)
}

export function setWoStatus(wo: WorkOrder, to: WorkOrderStatus, note = ''): WorkOrder {
  requirePerm('sales.manage')
  if (!WO_NEXT[wo.status].includes(to)) throw new Error(`${wo.wo_no} cannot move from ${WO_STATUS_LABEL[wo.status]} to ${WO_STATUS_LABEL[to]}.`)
  if (to === 'dispatched' && wo.completed_qty <= 0) throw new Error('Nothing has been completed to dispatch.')
  if ((to === 'cancelled' || to === 'on_hold') && !note.trim()) throw new Error('Give a reason.')
  const patch: Partial<WorkOrder> = { status: to }
  // delivery dates (the database stamps the same in Supabase mode)
  if ((to === 'completed' || to === 'dispatched') && !wo.completed_on) patch.completed_on = todayISO()
  if (to === 'dispatched') patch.dispatched_on = todayISO()
  if (to !== 'completed' && to !== 'dispatched') Object.assign(patch, { completed_on: null, dispatched_on: null })
  if (note.trim()) patch.notes = [wo.notes, `${WO_STATUS_LABEL[to]} ${todayISO()}: ${note.trim()}`].filter(Boolean).join('\n')
  const row = db.update('work_orders', wo.id, patch)
  audit(to === 'cancelled' ? 'cancel' : 'update', 'work_orders', wo.id, `${wo.wo_no}: ${WO_STATUS_LABEL[wo.status]} → ${WO_STATUS_LABEL[to]}${note.trim() ? ` — ${note.trim()}` : ''}`, { status: { from: wo.status, to } })
  return row
}

export function progressErrors(wo: WorkOrder, completed: number | null, rejected: number | null) {
  const e: { completed?: string; rejected?: string } = {}
  if (completed == null) e.completed = 'Required'
  else if (!Number.isInteger(completed) || completed < 0) e.completed = 'Whole number, 0 or more'
  else if (completed > wo.qty) e.completed = `Cannot exceed the order qty (${wo.qty})`
  if (rejected == null) e.rejected = 'Required'
  else if (!Number.isInteger(rejected) || rejected < 0) e.rejected = 'Whole number, 0 or more'
  return e
}

export function updateProgress(wo: WorkOrder, completed: number, rejected: number, moveToQc: boolean): WorkOrder {
  requirePerm('sales.manage')
  if (!['planned', 'in_progress', 'qc', 'on_hold'].includes(wo.status)) throw new Error(`${wo.wo_no} is ${WO_STATUS_LABEL[wo.status].toLowerCase()} — progress is locked.`)
  const err = Object.values(progressErrors(wo, completed, rejected)).find(Boolean)
  if (err) throw new Error(err)
  const patch: Partial<WorkOrder> = { completed_qty: completed, rejected_qty: rejected }
  if (wo.status === 'planned' && completed + rejected > 0) patch.status = 'in_progress'
  if (moveToQc && completed >= wo.qty && (wo.status === 'in_progress' || patch.status === 'in_progress')) patch.status = 'qc'
  const changes = diff(wo, patch)
  if (!changes) return wo
  const row = db.update('work_orders', wo.id, patch)
  audit('update', 'work_orders', wo.id, `${wo.wo_no} progress: ${completed}/${wo.qty} done, ${rejected} rejected`, changes)
  return row
}

/* ─────────────────────────── KPIs ─────────────────────────── */

export const isOpenWo = (w: WorkOrder) => OPEN_WO.includes(w.status)
export const woValue = (w: WorkOrder) => round2(w.qty * w.unit_price)
export const woBalanceValue = (w: WorkOrder) => round2(Math.max(0, w.qty - w.completed_qty) * w.unit_price)
/**
 * Completion date proxy: the schema has no completed_on column, so the last update of a
 * completed / dispatched order stands in for it.
 */
export const woFinishedOn = (w: WorkOrder) => w.dispatched_on ?? w.completed_on ?? toISODate(new Date(w.updated_at))
export const isWoLate = (w: WorkOrder, today = todayISO()) => isOpenWo(w) && w.due_date < today

export function woKpis(wos: WorkOrder[], today = todayISO()) {
  const open = wos.filter(isOpenWo)
  const week = addDays(today, 7)
  const done = wos.filter((w) => w.status === 'completed' || w.status === 'dispatched')
  const onTime = done.filter((w) => woFinishedOn(w) <= w.due_date).length
  return {
    open: open.length,
    dueThisWeek: open.filter((w) => w.due_date >= today && w.due_date <= week).length,
    overdue: open.filter((w) => w.due_date < today).length,
    onTimePct: done.length ? (onTime / done.length) * 100 : 100,
    doneCount: done.length,
    orderBook: round2(open.reduce((s, w) => s + woBalanceValue(w), 0)),
  }
}

export function customerOrderValue(customerId: string, wos: WorkOrder[]) {
  const mine = wos.filter((w) => w.customer_id === customerId && w.status !== 'cancelled')
  return { count: mine.length, value: round2(mine.reduce((s, w) => s + woValue(w), 0)), open: mine.filter(isOpenWo).length }
}
