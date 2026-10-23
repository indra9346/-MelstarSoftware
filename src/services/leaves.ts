/**
 * Leave actions: apply / approve / reject / cancel, balance adjustments, year-end carry forward,
 * holidays and leave types. All arithmetic goes through lib/leaves so balances, the attendance
 * register and payroll agree. Notifications for submit / decide are created by the database
 * (or notificationRules in static mode) — never insert them here.
 */
import { db } from '@/data/store'
import type { Employee, Holiday, HolidayType, ISODate, LeaveBalance, LeaveRequest, LeaveType, NewRow } from '@/data/types'
import { countLeaveDays, leaveBalances, overlaps, proratedQuota, weeklyOffsFor, type BalanceView } from '@/lib/leaves'
import { addDays, fmtDate, fmtDateShort, fyLabel, fyOf, fyRange, todayISO } from '@/lib/dates'
import { fullName, num } from '@/lib/format'
import { audit, diff } from './audit'
import { storeFile } from './files'
import { currentSession, selfApprovalBlock } from './session'

export const SICK_LEAVE_BACKDATE_DAYS = 7
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

/** Plant closures (optional holidays are not closures). */
export function plantHolidaySet(holidays: Holiday[] = db.all('holidays')): Set<ISODate> {
  return new Set(holidays.filter((h) => h.type !== 'optional').map((h) => h.date))
}

export function isTypeApplicable(t: LeaveType, emp: Pick<Employee, 'gender'>): boolean {
  return t.active && (!t.gender || t.gender === emp.gender)
}

export function applicableLeaveTypes(emp: Pick<Employee, 'gender'>, types: LeaveType[] = db.all('leave_types')): LeaveType[] {
  return types.filter((t) => isTypeApplicable(t, emp)).sort((a, b) => a.code.localeCompare(b.code))
}

export const isUnlimited = (t: Pick<LeaveType, 'code'>) => t.code === 'LOP'

export function fmtLeaveDates(r: Pick<LeaveRequest, 'from_date' | 'to_date' | 'half_day' | 'half_day_session'>): string {
  if (r.half_day) return `${fmtDate(r.from_date)} · ${r.half_day_session === 'first' ? 'first' : 'second'} half`
  if (r.from_date === r.to_date) return fmtDate(r.from_date)
  return `${fmtDateShort(r.from_date)} – ${fmtDate(r.to_date)}`
}

/* ── apply ───────────────────────────────────────────────────────────────── */

export interface LeaveDraft {
  employeeId: string
  leaveTypeId: string
  from: ISODate
  to: ISODate
  halfDay: boolean
  session: 'first' | 'second'
  reason: string
}

export type LeaveField = 'employee' | 'type' | 'from' | 'to' | 'halfDay' | 'days' | 'reason' | 'attachment'
export type LeaveErrors = Partial<Record<LeaveField, string>>

export interface LeaveCheck {
  ok: boolean
  errors: LeaveErrors
  days: number
  type?: LeaveType
  employee?: Employee
  balance?: BalanceView
  needsDocument: boolean
  /** Earliest allowed start date for the chosen type. */
  minFrom: ISODate
}

/**
 * The single validation used by the employee form and HR's "apply on behalf":
 * dates (SL back-dated ≤ 7 days, others today+), half-day rules, working-day count, balance,
 * overlap with own pending/approved leave, reason and supporting document.
 */
export function checkLeave(draft: LeaveDraft, opts: { hasAttachment: boolean; ignoreId?: string; today?: ISODate } = { hasAttachment: false }): LeaveCheck {
  const today = opts.today ?? todayISO()
  const errors: LeaveErrors = {}
  const emp = db.get('employees', draft.employeeId)
  const type = db.get('leave_types', draft.leaveTypeId)
  const minFrom = type?.code === 'SL' ? addDays(today, -SICK_LEAVE_BACKDATE_DAYS) : today
  if (!emp) errors.employee = 'Choose the employee.'
  else if (emp.status === 'exited') errors.employee = 'This employee has exited.'
  if (!type) errors.type = 'Choose a leave type.'
  else if (emp && !isTypeApplicable(type, emp)) errors.type = `${type.name} is not available for this employee.`

  const from = ISO_RE.test(draft.from) ? draft.from : ''
  const to = ISO_RE.test(draft.to) ? draft.to : ''
  if (!from) errors.from = 'Choose the start date.'
  else if (from < minFrom)
    errors.from = type?.code === 'SL' ? `Sick leave can be back-dated up to ${SICK_LEAVE_BACKDATE_DAYS} days only.` : 'Leave must start today or later (only sick leave can be back-dated).'
  else if (emp && from < emp.date_of_joining) errors.from = 'Starts before the date of joining.'
  if (!to) errors.to = 'Choose the end date.'
  else if (from && to < from) errors.to = 'End date can’t be before the start date.'
  else if (emp?.date_of_exit && to > emp.date_of_exit) errors.to = `Ends after the last working day (${fmtDate(emp.date_of_exit)}).`
  else if (from && fyOf(from) !== fyOf(to)) errors.to = `Split the leave at 31 Mar — it can’t span two financial years.`

  if (draft.halfDay) {
    if (type && !type.allow_half_day) errors.halfDay = `${type.name} can’t be taken as a half day.`
    else if (from && to && from !== to) errors.halfDay = 'A half day must start and end on the same date.'
  }

  let days = 0
  let balance: BalanceView | undefined
  if (emp && from && to && to >= from) {
    const shifts = db.all('shifts')
    days = countLeaveDays(from, to, { halfDay: draft.halfDay && from === to, weeklyOffs: weeklyOffsFor(emp, shifts), holidays: plantHolidaySet() })
    if (days <= 0) errors.days = 'Those dates are all week-offs or plant holidays — nothing to apply for.'
    if (type) {
      const requests = db.all('leave_requests').filter((r) => r.id !== opts.ignoreId)
      balance = leaveBalances(emp, fyOf(from), db.all('leave_types'), db.all('leave_balances'), requests).find((b) => b.type.id === type.id)
      if (balance && !isUnlimited(type) && days > 0 && days > balance.available)
        errors.days = balance.available <= 0 ? `No ${type.name} balance left.` : `Only ${num(balance.available)} day${balance.available === 1 ? '' : 's'} of ${type.name} available.`
    }
    const clash = db.find(
      'leave_requests',
      (r) => r.employee_id === emp.id && r.id !== opts.ignoreId && (r.status === 'pending' || r.status === 'approved') && overlaps(r, { from_date: from, to_date: to }),
    )
    if (clash) errors.from ??= `Overlaps a ${clash.status} leave (${fmtLeaveDates(clash)}).`
  }

  const reason = draft.reason.trim()
  if (reason.length < 3) errors.reason = 'Give a short reason (at least 3 characters).'
  else if (reason.length > 500) errors.reason = 'Keep the reason under 500 characters.'

  const needsDocument = !!type && type.document_after_days > 0 && days > type.document_after_days
  if (needsDocument && !opts.hasAttachment) errors.attachment = `Attach a supporting document — required for ${type!.name} longer than ${type!.document_after_days} day${type!.document_after_days === 1 ? '' : 's'}.`

  return { ok: Object.keys(errors).length === 0, errors, days, type, employee: emp, balance, needsDocument, minFrom }
}

export async function applyLeave(draft: LeaveDraft, file: File | null): Promise<LeaveRequest> {
  const check = checkLeave(draft, { hasAttachment: !!file })
  if (!check.ok) throw new Error(Object.values(check.errors)[0])
  const emp = check.employee!
  const type = check.type!
  const attachment = file ? await storeFile(file, emp.id, 'leave') : null
  const s = currentSession()
  const onBehalf = s?.employee?.id !== emp.id
  const row = db.insert('leave_requests', {
    employee_id: emp.id,
    leave_type_id: type.id,
    from_date: draft.from,
    to_date: draft.to,
    half_day: draft.halfDay,
    half_day_session: draft.halfDay ? draft.session : null,
    days: check.days,
    reason: draft.reason.trim(),
    status: 'pending',
    applied_at: new Date().toISOString(),
    reviewed_by: null,
    reviewed_at: null,
    review_note: '',
    attachment,
  })
  audit('create', 'leave_requests', row.id, `${onBehalf ? `Applied on behalf of ${fullName(emp)}:` : 'Applied for'} ${type.code} · ${fmtLeaveDates(row)} (${num(check.days)} d)`)
  return row
}

/* ── decide ──────────────────────────────────────────────────────────────── */

export interface ApprovalPreview {
  type: LeaveType | undefined
  unlimited: boolean
  entitled: number
  used: number
  otherPending: number
  /** entitled − used (before this request). */
  before: number
  /** entitled − used − this request. */
  after: number
  /** after − other pending requests. */
  afterAllPending: number
  goesNegative: boolean
  clash?: LeaveRequest
}

export function approvalPreview(req: LeaveRequest): ApprovalPreview {
  const emp = db.get('employees', req.employee_id)
  const type = db.get('leave_types', req.leave_type_id)
  const others = db.all('leave_requests').filter((r) => r.id !== req.id)
  const view = emp && type ? leaveBalances(emp, fyOf(req.from_date), db.all('leave_types').map((t) => (t.id === type.id ? { ...t, active: true, gender: null } : t)), db.all('leave_balances'), others).find((b) => b.type.id === type.id) : undefined
  const unlimited = !type || isUnlimited(type)
  const entitled = view?.entitled ?? 0
  const used = view?.used ?? 0
  const otherPending = view?.pending ?? 0
  const before = entitled - used
  const after = before - req.days
  const clash = others.find((r) => r.employee_id === req.employee_id && r.status === 'approved' && overlaps(r, req))
  return { type, unlimited, entitled, used, otherPending, before, after, afterAllPending: after - otherPending, goesNegative: !unlimited && after < 0, clash }
}

export function approveLeave(req: LeaveRequest, note = '', opts: { allowNegative?: boolean } = {}): LeaveRequest {
  if (req.status !== 'pending') throw new Error('Only a pending request can be approved.')
  const own = selfApprovalBlock(req.employee_id)
  if (own) throw new Error(own)
  const p = approvalPreview(req)
  if (p.clash) throw new Error(`Overlaps an approved leave (${fmtLeaveDates(p.clash)}).`)
  if (p.goesNegative && !opts.allowNegative) throw new Error(`Approving takes the ${p.type?.code ?? ''} balance to ${num(p.after)} — confirm to continue.`)
  const emp = db.get('employees', req.employee_id)
  const row = db.update('leave_requests', req.id, { status: 'approved', reviewed_by: currentSession()?.user.id ?? null, reviewed_at: new Date().toISOString(), review_note: note.trim() })
  audit('approve', 'leave_requests', req.id, `Approved ${p.type?.code ?? 'leave'} for ${fullName(emp)} · ${fmtLeaveDates(req)} (${num(req.days)} d)${p.goesNegative ? ` — balance now ${num(p.after)}` : ''}`)
  return row
}

export function rejectLeave(req: LeaveRequest, note: string): LeaveRequest {
  if (req.status !== 'pending') throw new Error('Only a pending request can be rejected.')
  const why = note.trim()
  if (!why) throw new Error('Give a reason for rejecting.')
  const emp = db.get('employees', req.employee_id)
  const type = db.get('leave_types', req.leave_type_id)
  const row = db.update('leave_requests', req.id, { status: 'rejected', reviewed_by: currentSession()?.user.id ?? null, reviewed_at: new Date().toISOString(), review_note: why })
  audit('reject', 'leave_requests', req.id, `Rejected ${type?.code ?? 'leave'} for ${fullName(emp)} · ${fmtLeaveDates(req)}: ${why}`)
  return row
}

export function canCancelLeave(req: Pick<LeaveRequest, 'status' | 'from_date'>, today = todayISO()): boolean {
  return req.status === 'pending' || (req.status === 'approved' && req.from_date > today)
}

/** Cancel a pending leave, or an approved one that has not started (employee or HR). */
export function cancelLeave(req: LeaveRequest, note = ''): LeaveRequest {
  if (!canCancelLeave(req)) throw new Error('Only a pending leave, or an approved leave that has not started, can be cancelled.')
  const s = currentSession()
  const manager = !!s?.can('leaves.manage')
  const emp = db.get('employees', req.employee_id)
  const type = db.get('leave_types', req.leave_type_id)
  const why = note.trim()
  // Self-service may change the status only (enforced by the database guard as well).
  const patch: Partial<LeaveRequest> = manager
    ? { status: 'cancelled', reviewed_by: s!.user.id, reviewed_at: new Date().toISOString(), review_note: why ? `Cancelled: ${why}` : req.review_note }
    : { status: 'cancelled' }
  const row = db.update('leave_requests', req.id, patch)
  const own = s?.employee?.id === req.employee_id
  audit('cancel', 'leave_requests', req.id, `Cancelled ${type?.code ?? 'leave'} ${own ? '' : `of ${fullName(emp)} `}· ${fmtLeaveDates(req)}${why ? `: ${why}` : ''}`)
  return row
}

/* ── balances ────────────────────────────────────────────────────────────── */

export interface BalanceValues {
  opening: number
  allotted: number
  adjustment: number
}

export function findBalance(employeeId: string, typeId: string, year: number): LeaveBalance | undefined {
  return db.find('leave_balances', (b) => b.employee_id === employeeId && b.leave_type_id === typeId && b.year === year)
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function validateBalance(v: BalanceValues, reason: string): Partial<Record<keyof BalanceValues | 'reason', string>> {
  const e: Partial<Record<keyof BalanceValues | 'reason', string>> = {}
  const ok = (n: number) => Number.isFinite(n) && Math.abs(n) < 1000
  if (!ok(v.opening) || v.opening < 0) e.opening = 'Enter 0 or more.'
  if (!ok(v.allotted) || v.allotted < 0) e.allotted = 'Enter 0 or more.'
  if (!ok(v.adjustment)) e.adjustment = 'Enter a number (negative to deduct).'
  if (reason.trim().length < 3) e.reason = 'Say why (at least 3 characters) — it goes to the audit trail.'
  return e
}

/** Upsert the unique (employee, type, FY) balance row. */
export function adjustBalance(employeeId: string, typeId: string, year: number, values: BalanceValues, reason: string): LeaveBalance {
  const errors = validateBalance(values, reason)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const emp = db.get('employees', employeeId)
  const type = db.get('leave_types', typeId)
  if (!emp || !type) throw new Error('Employee or leave type not found.')
  if (isUnlimited(type)) throw new Error(`${type.name} has no balance to adjust.`)
  const clean = { opening: r1(values.opening), allotted: r1(values.allotted), adjustment: r1(values.adjustment) }
  const existing = findBalance(employeeId, typeId, year)
  const label = `${type.code} balance of ${fullName(emp)} (FY ${fyLabel(year)}): ${reason.trim()}`
  if (existing) {
    const changes = diff(existing, clean)
    if (!changes) return existing
    const row = db.update('leave_balances', existing.id, clean)
    audit('update', 'leave_balances', row.id, `Adjusted ${label}`, changes)
    return row
  }
  const row = db.insert('leave_balances', { employee_id: employeeId, leave_type_id: typeId, year, ...clean })
  audit('create', 'leave_balances', row.id, `Set ${label}`, { opening: { from: null, to: clean.opening }, allotted: { from: null, to: clean.allotted }, adjustment: { from: null, to: clean.adjustment } })
  return row
}

/** Employees on rolls at some point in a financial year. */
export function employeesInFy(fy: number, employees: Employee[] = db.all('employees')): Employee[] {
  const { from, to } = fyRange(fy)
  return employees.filter((e) => e.date_of_joining <= to && (!e.date_of_exit || e.date_of_exit >= from))
}

export interface CarryForwardPlan {
  rows: { employee: Employee; type: LeaveType; opening: number; allotted: number; existing?: LeaveBalance }[]
  employees: number
}

/** What a year-end carry forward from `fy` into `fy + 1` would write. */
export function planCarryForward(fy: number): CarryForwardPlan {
  const next = fy + 1
  const { from: nFrom } = fyRange(next)
  const types = db.all('leave_types').filter((t) => t.active && !isUnlimited(t))
  const allTypes = db.all('leave_types')
  const balances = db.all('leave_balances')
  const requests = db.all('leave_requests')
  const emps = db.all('employees').filter((e) => e.status !== 'exited' && (!e.date_of_exit || e.date_of_exit >= nFrom))
  const rows: CarryForwardPlan['rows'] = []
  for (const emp of emps) {
    const views = leaveBalances(emp, fy, allTypes, balances, requests)
    for (const type of types) {
      if (type.gender && type.gender !== emp.gender) continue
      const view = views.find((v) => v.type.id === type.id)
      const available = view && Number.isFinite(view.available) ? view.available : 0
      const opening = type.carry_forward ? r1(Math.min(Math.max(available, 0), type.max_carry_forward)) : 0
      const allotted = proratedQuota(type.annual_quota, emp.date_of_joining, next)
      const existing = findBalance(emp.id, type.id, next)
      if (!existing && opening === 0 && allotted === 0) continue
      rows.push({ employee: emp, type, opening, allotted, existing })
    }
  }
  return { rows, employees: emps.length }
}

/** Year-end: create / update FY+1 balances (opening = capped carry forward, allotted = pro-rated quota). Adjustments are kept. */
export function carryForward(fy: number): number {
  const plan = planCarryForward(fy)
  if (!plan.rows.length) throw new Error('Nothing to carry forward.')
  const next = fy + 1
  db.batch(() => {
    for (const r of plan.rows) {
      if (r.existing) db.update('leave_balances', r.existing.id, { opening: r.opening, allotted: r.allotted })
      else db.insert('leave_balances', { employee_id: r.employee.id, leave_type_id: r.type.id, year: next, opening: r.opening, allotted: r.allotted, adjustment: 0 })
    }
    const carried = plan.rows.reduce((s, r) => s + r.opening, 0)
    audit('process', 'leave_balances', null, `Year-end carry forward FY ${fyLabel(fy)} → ${fyLabel(next)}: ${plan.rows.length} balances for ${plan.employees} employees (${num(carried)} days carried)`)
  })
  return plan.rows.length
}

/* ── holidays ────────────────────────────────────────────────────────────── */

export type HolidayInput = Omit<NewRow<'holidays'>, 'id' | 'created_at' | 'updated_at'>
export const HOLIDAY_TYPES: { value: HolidayType; label: string }[] = [
  { value: 'national', label: 'National' },
  { value: 'festival', label: 'Festival' },
  { value: 'company', label: 'Company' },
  { value: 'optional', label: 'Optional (not a closure)' },
]

export function validateHoliday(input: HolidayInput, id?: string): Partial<Record<keyof HolidayInput, string>> {
  const e: Partial<Record<keyof HolidayInput, string>> = {}
  if (!ISO_RE.test(input.date)) e.date = 'Choose the date.'
  const name = input.name.trim()
  if (name.length < 2) e.name = 'Enter the holiday name.'
  else if (name.length > 80) e.name = 'Keep it under 80 characters.'
  else if (db.find('holidays', (h) => h.id !== id && h.date === input.date && h.name.trim().toLowerCase() === name.toLowerCase())) e.name = 'This holiday is already on the list.'
  if (!HOLIDAY_TYPES.some((t) => t.value === input.type)) e.type = 'Choose a type.'
  if (input.description.length > 200) e.description = 'Keep it under 200 characters.'
  return e
}

export function saveHoliday(input: HolidayInput, existing?: Holiday): Holiday {
  const errors = validateHoliday(input, existing?.id)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const clean = { ...input, name: input.name.trim(), description: input.description.trim() }
  if (existing) {
    const changes = diff(existing, clean)
    const row = db.update('holidays', existing.id, clean)
    audit('update', 'holidays', row.id, `Updated holiday ${row.name} (${fmtDate(row.date)})`, changes)
    return row
  }
  const row = db.insert('holidays', clean)
  audit('create', 'holidays', row.id, `Added holiday ${row.name} (${fmtDate(row.date)}, ${row.type})`)
  return row
}

export function deleteHoliday(h: Holiday) {
  db.remove('holidays', h.id)
  audit('delete', 'holidays', h.id, `Deleted holiday ${h.name} (${fmtDate(h.date)})`)
}

/* ── leave types ─────────────────────────────────────────────────────────── */

export type LeaveTypeInput = Omit<NewRow<'leave_types'>, 'id' | 'created_at' | 'updated_at'>

export function validateLeaveType(input: LeaveTypeInput, id?: string): Partial<Record<keyof LeaveTypeInput, string>> {
  const e: Partial<Record<keyof LeaveTypeInput, string>> = {}
  const code = input.code.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(code)) e.code = '2–6 letters/digits, e.g. CL.'
  else if (db.find('leave_types', (t) => t.id !== id && t.code.toUpperCase() === code)) e.code = `${code} already exists.`
  if (input.name.trim().length < 3) e.name = 'Enter the leave name.'
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 400
  if (!ok(input.annual_quota)) e.annual_quota = '0–400 days.'
  if (input.carry_forward && (!ok(input.max_carry_forward) || input.max_carry_forward <= 0)) e.max_carry_forward = 'Set the maximum days that can roll over.'
  if (!Number.isInteger(input.document_after_days) || input.document_after_days < 0 || input.document_after_days > 365) e.document_after_days = 'Whole days, 0 = never.'
  if (input.gender && !['male', 'female', 'other'].includes(input.gender)) e.gender = 'Choose who it applies to.'
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) e.color = 'Pick a colour.'
  return e
}

export function saveLeaveType(input: LeaveTypeInput, existing?: LeaveType): LeaveType {
  const errors = validateLeaveType(input, existing?.id)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const clean: LeaveTypeInput = {
    ...input,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    annual_quota: r1(input.annual_quota),
    max_carry_forward: input.carry_forward ? r1(input.max_carry_forward) : 0,
  }
  if (existing) {
    const changes = diff(existing, clean)
    const row = db.update('leave_types', existing.id, clean)
    audit('update', 'leave_types', row.id, `Updated leave type ${row.code} (${row.name})`, changes)
    return row
  }
  const row = db.insert('leave_types', clean)
  audit('create', 'leave_types', row.id, `Created leave type ${row.code} (${row.name}, ${num(row.annual_quota)} d/yr)`)
  return row
}

export function deleteLeaveType(t: LeaveType) {
  const used = db.count('leave_requests', (r) => r.leave_type_id === t.id)
  if (used) throw new Error(`${t.code} is used by ${used} leave request${used === 1 ? '' : 's'} — deactivate it instead.`)
  db.batch(() => {
    for (const b of db.where('leave_balances', (x) => x.leave_type_id === t.id)) db.remove('leave_balances', b.id)
    db.remove('leave_types', t.id)
  })
  audit('delete', 'leave_types', t.id, `Deleted leave type ${t.code} (${t.name})`)
}
