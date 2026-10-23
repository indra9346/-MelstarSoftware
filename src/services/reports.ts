/**
 * Reports hub — catalogue and pure computations.
 *
 * Every function takes plain rows (no store access) so the numbers are reproducible and match the
 * modules: attendance via summariseMonth (same policy as payroll), leave via leaveBalances, payroll
 * from stored payslip rows, stock value = Σ stock_qty × unit_cost.
 */
import type {
  Asset, AttendancePolicy, AuditLog, Customer, Department, Employee, EmploymentType, Frequency, Gender, InspectionResult, Inspection,
  InventoryItem, ISODate, ItemCategory, LeaveBalance, LeaveRequest, LeaveType, Machine, MaintenanceLog, MaintenanceSchedule, Ncr,
  Payslip, PayrollRun, PayrollRunStatus, PettyCashEntry, Permission, PurchaseOrder, PurchaseOrderLine, ToolIssue, Vendor,
  WorkOrder, WorkOrderStatus, YearMonth,
} from '@/data/types'
import { summariseMonth, type AttendanceContext, type DayInfo, type MonthSummary } from '@/lib/attendance'
import { leaveBalances, type BalanceView } from '@/lib/leaves'
import {
  addDays, addMonths, ageInYears, diffDays, eachDay, fmtDate, fmtDateShort, fmtMonth, fyLabel, fyMonths, fyOf, fyRange, minutesBetween, monthEnd, monthOf,
  monthStart, toISODate,
} from '@/lib/dates'
import { round2 } from '@/lib/format'

/* ═══════════════════════════════ catalogue ═══════════════════════════════ */

export type ReportGroupId = 'people' | 'payroll' | 'finance' | 'operations'
export type ReportId =
  | 'headcount' | 'attendance' | 'late-ot' | 'leave' | 'celebrations'
  | 'salary-register' | 'statutory' | 'payroll-trend' | 'dept-cost'
  | 'petty-statement' | 'petty-category'
  | 'downtime' | 'pm-compliance' | 'inventory' | 'tool-crib' | 'calibration' | 'purchase-vendor' | 'work-orders' | 'quality'

export interface ReportGroup {
  id: ReportGroupId
  label: string
  /** The group is listed when the user can view any of these modules. */
  perms: Permission[]
}

export interface ReportDef {
  id: ReportId
  group: ReportGroupId
  title: string
  /** One line for the catalogue. */
  short: string
  description: string
  perms: Permission[]
}

export const REPORT_GROUPS: ReportGroup[] = [
  { id: 'people', label: 'People', perms: ['employees.view', 'attendance.view', 'leaves.view'] },
  { id: 'payroll', label: 'Payroll', perms: ['payroll.view', 'payroll.manage'] },
  { id: 'finance', label: 'Finance', perms: ['petty_cash.view', 'petty_cash.manage'] },
  { id: 'operations', label: 'Operations', perms: ['machines.view', 'inventory.view', 'purchase.view', 'sales.view', 'quality.view'] },
]

const EMP: Permission[] = ['employees.view', 'employees.manage']
const ATT: Permission[] = ['attendance.view', 'attendance.manage']
const LEAVE: Permission[] = ['leaves.view', 'leaves.manage']
const PAY: Permission[] = ['payroll.view', 'payroll.manage']
const PETTY: Permission[] = ['petty_cash.view', 'petty_cash.manage']
const MACH: Permission[] = ['machines.view', 'machines.manage']
const INV: Permission[] = ['inventory.view', 'inventory.manage']
const PUR: Permission[] = ['purchase.view', 'purchase.manage']
const SALES: Permission[] = ['sales.view', 'sales.manage']
const QUAL: Permission[] = ['quality.view', 'quality.manage']

export const REPORTS: ReportDef[] = [
  { id: 'headcount', group: 'people', title: 'Headcount & attrition', short: 'Joiners, leavers, attrition %', perms: EMP, description: 'Headcount by department, employment type and gender, with joiners and leavers in the financial year. Attrition % = leavers ÷ average headcount.' },
  { id: 'attendance', group: 'people', title: 'Attendance summary', short: 'Monthly P / L / A, paid days, LOP', perms: ATT, description: 'Per-employee month roll-up — present, half days, leave, LWP, absent, holidays, week-offs, late marks, OT, paid days and LOP — computed exactly as payroll does.' },
  { id: 'late-ot', group: 'people', title: 'Late coming & overtime', short: 'Late marks, OT hours by day', perms: ATT, description: 'Late marks with late minutes and the resulting penalty days, plus approved, pending and rejected overtime hours for the month.' },
  { id: 'leave', group: 'people', title: 'Leave utilisation', short: 'Used vs entitled by leave type', perms: LEAVE, description: 'Leave used against entitlement (opening + allotted + adjustments) for each employee and leave type in the financial year.' },
  { id: 'celebrations', group: 'people', title: 'Birthdays & work anniversaries', short: 'Next 30 days', perms: EMP, description: 'Upcoming birthdays and service anniversaries over the next 30 days for employees on the rolls.' },
  { id: 'salary-register', group: 'payroll', title: 'Salary register', short: 'Earnings, deductions, net pay', perms: PAY, description: 'Month-wise salary register from the payroll run: earnings, statutory and other deductions, net pay and employer cost, with totals.' },
  { id: 'statutory', group: 'payroll', title: 'Statutory summary', short: 'PF, ESI, PT and TDS', perms: PAY, description: 'PF (employee and employer split), ESI, Karnataka professional tax and TDS for the month, with remittance due dates and a per-employee break-up.' },
  { id: 'payroll-trend', group: 'payroll', title: 'Payroll cost trend', short: 'Month-wise gross, net, cost', perms: PAY, description: 'Gross earnings, net pay and total employer cost for each processed month of the financial year.' },
  { id: 'dept-cost', group: 'payroll', title: 'Department-wise cost', short: 'Employer cost by department', perms: PAY, description: 'Payroll cost split by department for a month or the whole financial year, with cost per employee-month.' },
  { id: 'petty-statement', group: 'finance', title: 'Petty cash statement', short: 'Cash book with running balance', perms: PETTY, description: 'Opening balance, receipts, payments and closing balance for the period, with the running balance after every entry.' },
  { id: 'petty-category', group: 'finance', title: 'Spend by category', short: 'Petty-cash spend mix', perms: PETTY, description: 'Petty-cash payments for the financial year grouped by expense category, with the monthly trend.' },
  { id: 'downtime', group: 'operations', title: 'Machine downtime & MTTR', short: 'Breakdown vs preventive', perms: MACH, description: 'Downtime per machine split into breakdown, preventive and other maintenance, with mean time to repair (MTTR) for breakdowns.' },
  { id: 'pm-compliance', group: 'operations', title: 'PM compliance', short: 'On track vs overdue', perms: MACH, description: 'Preventive-maintenance schedules that are on track, due within 7 days or overdue, and PMs completed on time this financial year.' },
  { id: 'inventory', group: 'operations', title: 'Inventory valuation & low stock', short: 'Stock value, reorder alerts', perms: INV, description: 'Stock value (quantity × unit cost) by category and item, with items at or below their reorder level.' },
  { id: 'tool-crib', group: 'operations', title: 'Tool crib', short: 'Open, overdue, lost / broken', perms: INV, description: 'Tools issued from the crib — open issues, overdue returns, and tools lost or returned broken.' },
  { id: 'calibration', group: 'operations', title: 'Calibration due list', short: 'Overdue + next 60 days', perms: INV, description: 'Gauges and instruments whose calibration is overdue or falls due within the next 60 days.' },
  { id: 'purchase-vendor', group: 'operations', title: 'Purchase summary by vendor', short: 'PO value incl. GST, received %', perms: PUR, description: 'Purchase orders placed in the financial year by vendor — value including GST, value received and open balance.' },
  { id: 'work-orders', group: 'operations', title: 'Work orders', short: 'Status, OTD %, order book', perms: SALES, description: 'Work-order status, on-time delivery against due dates and the value of the open order book.' },
  { id: 'quality', group: 'operations', title: 'Quality', short: 'Pass rate, rejections, NCRs', perms: QUAL, description: 'Inspection pass rate by month, rejection by part and the non-conformance (NCR) register for the financial year.' },
]

export interface VisibleGroup extends ReportGroup {
  reports: ReportDef[]
}

/** Groups and reports this user can open (groups with no visible report are dropped). */
export function visibleCatalogue(canAny: (ps: Permission[]) => boolean): VisibleGroup[] {
  return REPORT_GROUPS.filter((g) => canAny(g.perms))
    .map((g) => ({ ...g, reports: REPORTS.filter((r) => r.group === g.id && canAny(r.perms)) }))
    .filter((g) => g.reports.length > 0)
}

/* ═══════════════════════════════ shared helpers ═══════════════════════════════ */

export const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)
const h2 = (minutes: number) => round2(minutes / 60)
/** Local calendar date of an ISO timestamp. */
export const dateOfTs = (ts: string) => toISODate(new Date(ts))

export function employedDuring(e: Pick<Employee, 'date_of_joining' | 'date_of_exit'>, from: ISODate, to: ISODate) {
  return e.date_of_joining <= to && (!e.date_of_exit || e.date_of_exit >= from)
}

/** Months to offer in month pickers: newest first, `count` months ending with the current one. */
export function recentMonths(today: ISODate, count = 13): YearMonth[] {
  const cur = monthOf(today)
  return Array.from({ length: count }, (_, i) => addMonths(cur, -i))
}

/** Financial years to offer: current FY and the previous `back` years. */
export function recentFys(today: ISODate, fyStartMonth = 4, back = 2): number[] {
  const cur = fyOf(today, fyStartMonth)
  return Array.from({ length: back + 1 }, (_, i) => cur - i)
}

/** FY window clipped to today for "year to date" figures. */
export function fyWindow(fy: number, today: ISODate, fyStartMonth = 4) {
  const { from, to } = fyRange(fy, fyStartMonth)
  return { from, to, asOf: today < to ? (today < from ? from : today) : to, current: today >= from && today <= to }
}

export type RangePreset = 'this_month' | 'last_month' | 'quarter' | 'fy' | 'custom'
export interface DateRange {
  from: ISODate
  to: ISODate
}

export function presetRange(p: Exclude<RangePreset, 'custom'>, today: ISODate, fyStartMonth = 4): DateRange {
  const cur = monthOf(today)
  if (p === 'this_month') return { from: monthStart(cur), to: today }
  if (p === 'last_month') {
    const m = addMonths(cur, -1)
    return { from: monthStart(m), to: monthEnd(m) }
  }
  const fy = fyOf(today, fyStartMonth)
  const { from } = fyRange(fy, fyStartMonth)
  if (p === 'fy') return { from, to: today }
  // FY quarter containing today
  const months = fyMonths(fy, fyStartMonth)
  const qi = Math.floor(months.indexOf(cur) / 3)
  return { from: monthStart(months[qi * 3]!), to: today }
}

export function rangeLabel(r: DateRange) {
  return `${fmtDate(r.from)} – ${fmtDate(r.to)}`
}

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  permanent: 'Permanent', probation: 'Probation', contract: 'Contract', trainee: 'Trainee', apprentice: 'Apprentice',
}
export const GENDER_LABEL: Record<Gender, string> = { male: 'Male', female: 'Female', other: 'Other' }

/* ═══════════════════════════════ People ═══════════════════════════════ */

export interface HeadcountDeptRow {
  id: string
  name: string
  color: string
  opening: number
  joiners: number
  leavers: number
  closing: number
  male: number
  female: number
  other: number
  average: number
  attrition: number
}

export interface HeadcountMovement {
  id: string
  employee_id: string
  event: 'joined' | 'left'
  date: ISODate
  department_id: string
  employment_type: EmploymentType
  note: string
}

export interface HeadcountReport {
  from: ISODate
  asOf: ISODate
  opening: number
  joiners: number
  leavers: number
  closing: number
  average: number
  attrition: number
  /** Attrition scaled to 12 months when the FY is still running. */
  annualised: number
  monthsElapsed: number
  byDept: HeadcountDeptRow[]
  byType: { key: EmploymentType; label: string; count: number }[]
  byGender: { key: Gender; label: string; count: number }[]
  monthly: { month: YearMonth; label: string; headcount: number; joiners: number; leavers: number }[]
  movements: HeadcountMovement[]
}

/**
 * Opening = on the rolls before day one of the FY; joiners/leavers = joined/left between FY start and
 * the as-of date; closing = opening + joiners − leavers (an employee leaving on the as-of date is a leaver).
 */
export function headcountReport(employees: Employee[], departments: Department[], fy: number, today: ISODate, fyStartMonth = 4): HeadcountReport {
  const { from, asOf } = fyWindow(fy, today, fyStartMonth)
  const isOpening = (e: Employee) => e.date_of_joining < from && (!e.date_of_exit || e.date_of_exit >= from)
  const joined = (e: Employee) => e.date_of_joining >= from && e.date_of_joining <= asOf
  const left = (e: Employee) => !!e.date_of_exit && e.date_of_exit >= from && e.date_of_exit <= asOf && e.date_of_joining <= e.date_of_exit
  const onRollsAfter = (e: Employee, d: ISODate) => e.date_of_joining <= d && (!e.date_of_exit || e.date_of_exit > d)

  const closingSet = employees.filter((e) => onRollsAfter(e, asOf))
  const opening = employees.filter(isOpening).length
  const joiners = employees.filter(joined).length
  const leavers = employees.filter(left).length
  const closing = closingSet.length
  const average = (opening + closing) / 2
  const attrition = pctOf(leavers, average)
  const monthsElapsed = Math.max(1, fyMonths(fy, fyStartMonth).filter((m) => monthStart(m) <= asOf).length)

  const byDept: HeadcountDeptRow[] = departments
    .map((d) => {
      const mine = employees.filter((e) => e.department_id === d.id)
      const close = mine.filter((e) => onRollsAfter(e, asOf))
      const o = mine.filter(isOpening).length
      const l = mine.filter(left).length
      const avg = (o + close.length) / 2
      return {
        id: d.id, name: d.name, color: d.color, opening: o, joiners: mine.filter(joined).length, leavers: l, closing: close.length,
        male: close.filter((e) => e.gender === 'male').length, female: close.filter((e) => e.gender === 'female').length,
        other: close.filter((e) => e.gender === 'other').length, average: avg, attrition: pctOf(l, avg),
      }
    })
    .filter((r) => r.opening || r.closing || r.joiners || r.leavers)
    .sort((a, b) => b.closing - a.closing || a.name.localeCompare(b.name))

  const byType = (Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[])
    .map((key) => ({ key, label: EMPLOYMENT_TYPE_LABEL[key], count: closingSet.filter((e) => e.employment_type === key).length }))
    .filter((t) => t.count > 0)
  const byGender = (Object.keys(GENDER_LABEL) as Gender[])
    .map((key) => ({ key, label: GENDER_LABEL[key], count: closingSet.filter((e) => e.gender === key).length }))
    .filter((t) => t.count > 0)

  const monthly = fyMonths(fy, fyStartMonth)
    .filter((m) => monthStart(m) <= asOf)
    .map((m) => {
      const s = monthStart(m)
      const e = monthEnd(m) < asOf ? monthEnd(m) : asOf
      return {
        month: m,
        label: fmtMonth(m, true).slice(0, 3),
        headcount: employees.filter((x) => onRollsAfter(x, e)).length,
        joiners: employees.filter((x) => x.date_of_joining >= s && x.date_of_joining <= e).length,
        leavers: employees.filter((x) => !!x.date_of_exit && x.date_of_exit >= s && x.date_of_exit <= e).length,
      }
    })

  const movements: HeadcountMovement[] = []
  for (const e of employees) {
    if (joined(e)) movements.push({ id: `${e.id}-j`, employee_id: e.id, event: 'joined', date: e.date_of_joining, department_id: e.department_id, employment_type: e.employment_type, note: '' })
    if (left(e)) movements.push({ id: `${e.id}-l`, employee_id: e.id, event: 'left', date: e.date_of_exit!, department_id: e.department_id, employment_type: e.employment_type, note: e.exit_reason })
  }
  movements.sort((a, b) => b.date.localeCompare(a.date))

  return { from, asOf, opening, joiners, leavers, closing, average, attrition, annualised: (attrition * 12) / monthsElapsed, monthsElapsed, byDept, byType, byGender, monthly, movements }
}

/* ── attendance ── */

export interface AttendanceRow {
  id: string
  emp: Employee
  department_id: string
  s: MonthSummary
  ot_hours: number
  ot_pending_hours: number
  /** Working days that have already happened (for the attendance rate). */
  elapsed_working: number
}

export interface DailyAttendance {
  date: ISODate
  day: string
  present: number
  leave: number
  absent: number
  late: number
  ot_approved: number
  ot_pending: number
}

const PRESENTISH = new Set<DayInfo['status']>(['present', 'on_duty', 'half_day'])
const LEAVEISH = new Set<DayInfo['status']>(['leave', 'half_leave', 'unpaid_leave'])
const NOT_WORKING = new Set<DayInfo['status']>(['holiday', 'week_off', 'not_employed', 'upcoming', 'today'])

export function attendanceSummary(
  employees: Employee[],
  month: YearMonth,
  ctx: AttendanceContext,
  policy: Pick<AttendancePolicy, 'late_marks_per_half_day'>,
  deptId = '',
): { rows: AttendanceRow[]; daily: DailyAttendance[]; inProgress: boolean } {
  const from = monthStart(month)
  const to = monthEnd(month)
  const rows = employees
    .filter((e) => employedDuring(e, from, to) && (!deptId || e.department_id === deptId))
    .map((emp) => {
      const s = summariseMonth(emp, month, ctx, policy)
      const elapsed = s.days.filter((d) => !NOT_WORKING.has(d.status) && d.date <= ctx.today).length
      return { id: emp.id, emp, department_id: emp.department_id, s, ot_hours: h2(s.ot_minutes_approved), ot_pending_hours: h2(s.ot_minutes_pending), elapsed_working: elapsed }
    })

  const daily: DailyAttendance[] = eachDay(from, to < ctx.today ? to : ctx.today).map((date, i) => {
    const out: DailyAttendance = { date, day: String(i + 1), present: 0, leave: 0, absent: 0, late: 0, ot_approved: 0, ot_pending: 0 }
    for (const r of rows) {
      const d = r.s.days[i]
      if (!d) continue
      if (PRESENTISH.has(d.status)) out.present++
      else if (LEAVEISH.has(d.status)) out.leave++
      else if (d.status === 'absent') out.absent++
      if (d.late) out.late++
      if (d.record?.ot_status === 'approved') out.ot_approved += d.record.ot_minutes
      if (d.record?.ot_status === 'pending') out.ot_pending += d.record.ot_minutes
    }
    out.ot_approved = h2(out.ot_approved)
    out.ot_pending = h2(out.ot_pending)
    return out
  })
  return { rows, daily, inProgress: ctx.today >= from && ctx.today <= to }
}

export interface LateOtRow {
  id: string
  emp: Employee
  department_id: string
  late_marks: number
  late_minutes: number
  avg_late: number
  max_late: number
  penalty_days: number
  ot_days: number
  ot_approved: number
  ot_pending: number
  ot_rejected: number
}

export function lateOvertime(rows: AttendanceRow[]): LateOtRow[] {
  return rows
    .map(({ emp, s }) => {
      let late_minutes = 0, max_late = 0, ot_days = 0, rejected = 0
      for (const d of s.days) {
        const r = d.record
        if (!r) continue
        if (d.late) {
          late_minutes += r.late_minutes
          max_late = Math.max(max_late, r.late_minutes)
        }
        if (r.ot_minutes > 0 && r.ot_status !== 'none') ot_days++
        if (r.ot_status === 'rejected') rejected += r.ot_minutes
      }
      return {
        id: emp.id, emp, department_id: emp.department_id, late_marks: s.late_marks, late_minutes, avg_late: s.late_marks ? Math.round(late_minutes / s.late_marks) : 0,
        max_late, penalty_days: s.late_penalty_days, ot_days, ot_approved: h2(s.ot_minutes_approved), ot_pending: h2(s.ot_minutes_pending), ot_rejected: h2(rejected),
      }
    })
    .filter((r) => r.late_marks > 0 || r.ot_approved > 0 || r.ot_pending > 0 || r.ot_rejected > 0)
}

/* ── leave ── */

export interface LeaveUtilRow {
  id: string
  emp: Employee
  department_id: string
  balances: Record<string, BalanceView | undefined>
  used: number
  /** Used / entitled over annual paid leave types (see countsForUtilisation). */
  paidUsed: number
  entitled: number
  pending: number
  lop: number
}

export interface LeaveTypeTotal {
  type: LeaveType
  /** Gender-specific statutory leave (e.g. maternity) — an event entitlement, kept out of utilisation %. */
  eventBased: boolean
  used: number
  entitled: number
  pending: number
  available: number
  employees: number
}

const LEAVE_ORDER = ['CL', 'SL', 'EL', 'PL', 'CO', 'ML', 'PTL', 'LOP']

/** Annual paid entitlements only: LOP and gender-specific statutory leave (maternity …) are excluded. */
export const countsForUtilisation = (t: Pick<LeaveType, 'code' | 'gender'>) => t.code !== 'LOP' && !t.gender

export function leaveUtilisation(
  employees: Employee[],
  fy: number,
  types: LeaveType[],
  balances: LeaveBalance[],
  requests: LeaveRequest[],
  fyStartMonth = 4,
  deptId = '',
): { types: LeaveType[]; rows: LeaveUtilRow[]; byType: LeaveTypeTotal[] } {
  const { from, to } = fyRange(fy, fyStartMonth)
  const rank = (t: LeaveType) => {
    const i = LEAVE_ORDER.indexOf(t.code)
    return i < 0 ? LEAVE_ORDER.length - 1.5 : i // unknown codes sit just before LOP
  }
  const active = types.filter((t) => t.active).sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
  const rows: LeaveUtilRow[] = employees
    .filter((e) => employedDuring(e, from, to) && (!deptId || e.department_id === deptId))
    .map((emp) => {
      const views = leaveBalances(emp, fy, types, balances, requests)
      const map: Record<string, BalanceView | undefined> = {}
      for (const v of views) map[v.type.id] = v
      const paid = views.filter((v) => countsForUtilisation(v.type))
      const lop = views.filter((v) => v.type.code === 'LOP').reduce((s, v) => s + v.used, 0)
      return {
        id: emp.id, emp, department_id: emp.department_id, balances: map,
        used: views.reduce((s, v) => s + v.used, 0), paidUsed: paid.reduce((s, v) => s + v.used, 0),
        entitled: paid.reduce((s, v) => s + v.entitled, 0), pending: views.reduce((s, v) => s + v.pending, 0), lop,
      }
    })
  const byType = active.map((type) => {
    const vs = rows.map((r) => r.balances[type.id]).filter((v): v is BalanceView => !!v)
    return {
      type,
      eventBased: !!type.gender,
      used: vs.reduce((s, v) => s + v.used, 0),
      entitled: type.code === 'LOP' ? 0 : vs.reduce((s, v) => s + v.entitled, 0),
      pending: vs.reduce((s, v) => s + v.pending, 0),
      available: type.code === 'LOP' ? 0 : vs.reduce((s, v) => s + Math.max(0, v.available), 0),
      employees: vs.filter((v) => v.used > 0).length,
    }
  })
  return { types: active, rows, byType }
}

/* ── birthdays & anniversaries ── */

export interface Celebration {
  id: string
  employee_id: string
  department_id: string
  kind: 'birthday' | 'anniversary'
  date: ISODate
  daysAway: number
  /** Age turning (birthday) or completed years of service (anniversary). */
  years: number
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** Next date on/after `today` that falls on the month-day of `base` (29 Feb → 28 Feb in common years). */
function nextOccurrence(base: ISODate, today: ISODate): ISODate {
  const [, m, d] = base.split('-')
  const ty = Number(today.slice(0, 4))
  for (const y of [ty, ty + 1]) {
    const day = m === '02' && d === '29' && !isLeap(y) ? '28' : d
    const cand = `${y}-${m}-${day}`
    if (cand >= today) return cand
  }
  return `${ty + 1}-${m}-${d}`
}

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/

export function celebrations(employees: Employee[], today: ISODate, days = 30): Celebration[] {
  const until = addDays(today, days)
  const out: Celebration[] = []
  for (const e of employees) {
    if (e.status === 'exited') continue
    if (e.dob && VALID_DATE.test(e.dob)) {
      const date = nextOccurrence(e.dob, today)
      if (date <= until) out.push({ id: `${e.id}-b`, employee_id: e.id, department_id: e.department_id, kind: 'birthday', date, daysAway: diffDays(today, date), years: ageInYears(e.dob, date) })
    }
    if (e.date_of_joining && VALID_DATE.test(e.date_of_joining)) {
      const date = nextOccurrence(e.date_of_joining, today)
      const years = Number(date.slice(0, 4)) - Number(e.date_of_joining.slice(0, 4))
      if (years >= 1 && date <= until) out.push({ id: `${e.id}-a`, employee_id: e.id, department_id: e.department_id, kind: 'anniversary', date, daysAway: diffDays(today, date), years })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
}

/* ═══════════════════════════════ Payroll ═══════════════════════════════ */

export const SLIP_KEYS = [
  'paid_days', 'lop_days', 'ot_hours', 'basic', 'da', 'hra', 'conveyance', 'special_allowance', 'other_allowance', 'ot_pay', 'bonus', 'arrears',
  'gross_earnings', 'pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'loan_recovery', 'other_deductions',
  'total_deductions', 'net_pay', 'pf_employer_epf', 'pf_employer_eps', 'pf_edli', 'pf_admin', 'esi_employer', 'employer_cost', 'pf_wages', 'esi_wages',
] as const
export type SlipKey = (typeof SLIP_KEYS)[number]

export type SlipRow = Record<SlipKey, number> & {
  id: string
  employee_id: string
  department_id: string
  month: YearMonth
  /** EPF + EPS + EDLI + admin charges */
  pf_employer: number
  /** Advance + loan recovery */
  recoveries: number
  /** Bonus + arrears */
  extras: number
  /** PF + ESI employer contributions */
  employer_contrib: number
}

export function slipRow(p: Payslip, departmentId: string): SlipRow {
  const nums = {} as Record<SlipKey, number>
  for (const k of SLIP_KEYS) nums[k] = Number(p[k]) || 0
  const pf_employer = nums.pf_employer_epf + nums.pf_employer_eps + nums.pf_edli + nums.pf_admin
  return {
    ...nums, id: p.id, employee_id: p.employee_id, department_id: departmentId, month: p.month,
    pf_employer, recoveries: nums.advance_recovery + nums.loan_recovery, extras: nums.bonus + nums.arrears, employer_contrib: pf_employer + nums.esi_employer,
  }
}

export function slipRows(payslips: Payslip[], employees: Map<string, Employee>, filter: (p: Payslip) => boolean, deptId = ''): SlipRow[] {
  return payslips
    .filter(filter)
    .map((p) => slipRow(p, employees.get(p.employee_id)?.department_id ?? ''))
    .filter((r) => !deptId || r.department_id === deptId)
}

/** Column-wise totals of slip rows (identity fields blank). */
export function sumSlips(rows: SlipRow[]): SlipRow {
  const t = { id: 'total', employee_id: '', department_id: '', month: '' } as SlipRow
  const keys: (SlipKey | 'pf_employer' | 'recoveries' | 'extras' | 'employer_contrib')[] = [...SLIP_KEYS, 'pf_employer', 'recoveries', 'extras', 'employer_contrib']
  for (const k of keys) t[k] = round2(rows.reduce((s, r) => s + r[k], 0))
  return t
}

/** Months that have payslips, newest first. */
export function payslipMonths(payslips: Payslip[]): YearMonth[] {
  return [...new Set(payslips.map((p) => p.month))].sort().reverse()
}

export interface StatutoryDue {
  head: string
  detail: string
  amount: number
  due: ISODate
}

/** Remittance heads and statutory due dates for a wage month (EPF/ESI 15th, Karnataka PT 20th, TDS 7th; March TDS 30 April). */
export function statutoryDues(month: YearMonth, t: SlipRow): StatutoryDue[] {
  const next = addMonths(month, 1)
  const tdsDue = month.endsWith('-03') ? `${next.slice(0, 4)}-04-30` : `${next}-07`
  return [
    { head: 'EPF — A/c 1', detail: 'Employee 12% + employer EPF share', amount: t.pf_employee + t.pf_employer_epf, due: `${next}-15` },
    { head: 'EPS — A/c 10', detail: 'Employer pension share (8.33%)', amount: t.pf_employer_eps, due: `${next}-15` },
    { head: 'EDLI — A/c 21', detail: 'Employer insurance contribution', amount: t.pf_edli, due: `${next}-15` },
    { head: 'PF admin — A/c 2', detail: 'Administration charges', amount: t.pf_admin, due: `${next}-15` },
    { head: 'ESI', detail: 'Employee 0.75% + employer 3.25%', amount: t.esi_employee + t.esi_employer, due: `${next}-15` },
    { head: 'Professional tax', detail: 'Karnataka PT deducted', amount: t.professional_tax, due: `${next}-20` },
    { head: 'TDS on salary (24Q)', detail: 'Income tax deducted at source', amount: t.tds, due: tdsDue },
  ]
}

export interface TrendRow {
  id: string
  month: YearMonth
  label: string
  status: PayrollRunStatus | null
  employees: number
  gross: number
  deductions: number
  net: number
  employer_pf: number
  employer_esi: number
  employer_cost: number
  ot_pay: number
}

export function payrollTrend(payslips: Payslip[], runs: PayrollRun[], fy: number, fyStartMonth = 4): TrendRow[] {
  return fyMonths(fy, fyStartMonth)
    .map((m) => {
      const ps = payslips.filter((p) => p.month === m)
      const t = sumSlips(ps.map((p) => slipRow(p, '')))
      const run = runs.find((r) => r.month === m) ?? null
      return {
        id: m, month: m, label: fmtMonth(m, true), status: run?.status ?? null, employees: new Set(ps.map((p) => p.employee_id)).size,
        gross: t.gross_earnings, deductions: t.total_deductions, net: t.net_pay, employer_pf: t.pf_employer, employer_esi: t.esi_employer,
        employer_cost: t.employer_cost, ot_pay: t.ot_pay,
      }
    })
    .filter((r) => r.employees > 0)
}

export interface DeptCostRow {
  id: string
  name: string
  color: string
  employees: number
  slips: number
  gross: number
  employer_contrib: number
  employer_cost: number
  net: number
  ot_pay: number
  share: number
  per_head: number
}

export function departmentCost(rows: SlipRow[], departments: Department[]): DeptCostRow[] {
  const total = rows.reduce((s, r) => s + r.employer_cost, 0)
  const ids = [...new Set(rows.map((r) => r.department_id))]
  return ids
    .map((id) => {
      const d = departments.find((x) => x.id === id)
      const mine = rows.filter((r) => r.department_id === id)
      const t = sumSlips(mine)
      return {
        id: id || 'none', name: d?.name ?? 'Unassigned', color: d?.color ?? '#94a3b8', employees: new Set(mine.map((r) => r.employee_id)).size, slips: mine.length,
        gross: t.gross_earnings, employer_contrib: t.employer_contrib, employer_cost: t.employer_cost, net: t.net_pay, ot_pay: t.ot_pay,
        share: pctOf(t.employer_cost, total), per_head: mine.length ? Math.round(t.employer_cost / mine.length) : 0,
      }
    })
    .sort((a, b) => b.employer_cost - a.employer_cost)
}

/* ═══════════════════════════════ Finance ═══════════════════════════════ */

export interface LedgerRow {
  id: string
  kind: 'opening' | 'entry'
  date: ISODate
  entry_no: string
  description: string
  category: string
  receipt: number
  payment: number
  balance: number
}

const ledgerOrder = (a: PettyCashEntry, b: PettyCashEntry) =>
  a.date.localeCompare(b.date) || a.entry_no.localeCompare(b.entry_no, 'en', { numeric: true }) || a.created_at.localeCompare(b.created_at)

export function pettyCashStatement(entries: PettyCashEntry[], range: DateRange, today: ISODate) {
  const sorted = [...entries].sort(ledgerOrder)
  const signed = (e: PettyCashEntry) => (e.type === 'in' ? e.amount : -e.amount)
  const opening = round2(sorted.filter((e) => e.date < range.from).reduce((s, e) => s + signed(e), 0))
  const inRange = sorted.filter((e) => e.date >= range.from && e.date <= range.to)
  let bal = opening
  const rows: LedgerRow[] = [{ id: 'opening', kind: 'opening', date: range.from, entry_no: '', description: 'Opening balance b/f', category: '', receipt: 0, payment: 0, balance: opening }]
  for (const e of inRange) {
    bal = round2(bal + signed(e))
    rows.push({ id: e.id, kind: 'entry', date: e.date, entry_no: e.entry_no, description: e.description, category: e.category, receipt: e.type === 'in' ? e.amount : 0, payment: e.type === 'out' ? e.amount : 0, balance: bal })
  }
  const receipts = round2(inRange.filter((e) => e.type === 'in').reduce((s, e) => s + e.amount, 0))
  const payments = round2(inRange.filter((e) => e.type === 'out').reduce((s, e) => s + e.amount, 0))
  // end-of-day balance for the chart
  const end = range.to < today ? range.to : today
  const daily: { date: ISODate; label: string; balance: number }[] = []
  if (range.from <= end) {
    let b = opening
    let i = 0
    for (const d of eachDay(range.from, end)) {
      while (i < inRange.length && inRange[i]!.date === d) b = round2(b + signed(inRange[i++]!))
      daily.push({ date: d, label: fmtDateShort(d), balance: b })
    }
  }
  return { opening, receipts, payments, closing: round2(opening + receipts - payments), rows, daily, count: inRange.length }
}

export interface CategorySpend {
  id: string
  category: string
  count: number
  amount: number
  share: number
  avg: number
  max: number
}

export function spendByCategory(entries: PettyCashEntry[], range: DateRange, fy: number, fyStartMonth = 4) {
  const outs = entries.filter((e) => e.type === 'out' && e.date >= range.from && e.date <= range.to)
  const total = round2(outs.reduce((s, e) => s + e.amount, 0))
  const cats = [...new Set(outs.map((e) => e.category || 'Uncategorised'))]
  const categories: CategorySpend[] = cats
    .map((category) => {
      const mine = outs.filter((e) => (e.category || 'Uncategorised') === category)
      const amount = round2(mine.reduce((s, e) => s + e.amount, 0))
      return { id: category, category, count: mine.length, amount, share: pctOf(amount, total), avg: mine.length ? Math.round(amount / mine.length) : 0, max: Math.max(0, ...mine.map((e) => e.amount)) }
    })
    .sort((a, b) => b.amount - a.amount)
  const monthly = fyMonths(fy, fyStartMonth)
    .filter((m) => monthStart(m) <= range.to)
    .map((m) => ({ month: m, label: fmtMonth(m, true).slice(0, 3), amount: round2(outs.filter((e) => monthOf(e.date) === m).reduce((s, e) => s + e.amount, 0)) }))
  return { total, count: outs.length, categories, monthly }
}

/* ═══════════════════════════════ Operations ═══════════════════════════════ */

export interface DowntimeRow {
  id: string
  machine: Machine
  breakdowns: number
  breakdown_min: number
  closed_breakdowns: number
  mttr_min: number | null
  preventive: number
  preventive_min: number
  other: number
  other_min: number
  total_min: number
  cost: number
  open: number
}

/** Recorded downtime of a log; closed logs without a figure fall back to reported → completed. */
function logDowntime(l: MaintenanceLog): number {
  if (l.downtime_minutes > 0) return l.downtime_minutes
  if (l.completed_at) return Math.max(0, minutesBetween(l.reported_at, l.completed_at))
  return 0
}

export function downtimeByMachine(logs: MaintenanceLog[], machines: Machine[], range: DateRange) {
  const inRange = logs.filter((l) => {
    const d = dateOfTs(l.reported_at)
    return d >= range.from && d <= range.to
  })
  const rows: DowntimeRow[] = machines.map((m) => {
    const mine = inRange.filter((l) => l.machine_id === m.id)
    const closed = (l: MaintenanceLog) => l.status === 'closed' || !!l.completed_at
    const bd = mine.filter((l) => l.type === 'breakdown')
    const bdClosed = bd.filter(closed)
    const pm = mine.filter((l) => l.type === 'preventive')
    const other = mine.filter((l) => l.type !== 'breakdown' && l.type !== 'preventive')
    const mins = (ls: MaintenanceLog[]) => ls.filter(closed).reduce((s, l) => s + logDowntime(l), 0)
    const breakdown_min = mins(bd)
    const preventive_min = mins(pm)
    const other_min = mins(other)
    return {
      id: m.id, machine: m, breakdowns: bd.length, breakdown_min, closed_breakdowns: bdClosed.length,
      mttr_min: bdClosed.length ? Math.round(breakdown_min / bdClosed.length) : null,
      preventive: pm.length, preventive_min, other: other.length, other_min, total_min: breakdown_min + preventive_min + other_min,
      cost: mine.reduce((s, l) => s + (l.cost || 0), 0), open: mine.filter((l) => !closed(l)).length,
    }
  })
  const sumK = (k: 'breakdowns' | 'breakdown_min' | 'closed_breakdowns' | 'preventive' | 'preventive_min' | 'other' | 'other_min' | 'total_min' | 'cost' | 'open') => rows.reduce((s, r) => s + r[k], 0)
  const totals = {
    breakdowns: sumK('breakdowns'), breakdown_min: sumK('breakdown_min'), closed_breakdowns: sumK('closed_breakdowns'), preventive: sumK('preventive'),
    preventive_min: sumK('preventive_min'), other: sumK('other'), other_min: sumK('other_min'), total_min: sumK('total_min'), cost: sumK('cost'), open: sumK('open'),
  }
  return { rows, totals: { ...totals, mttr_min: totals.closed_breakdowns ? Math.round(totals.breakdown_min / totals.closed_breakdowns) : null } }
}

export const FREQUENCY_DAYS: Record<Frequency, number> = { daily: 1, weekly: 7, monthly: 30, quarterly: 91, half_yearly: 182, yearly: 365 }
/** Grace allowed when judging whether a PM was done on time. */
export const FREQUENCY_GRACE: Record<Frequency, number> = { daily: 0, weekly: 1, monthly: 3, quarterly: 7, half_yearly: 14, yearly: 30 }

export type PmState = 'overdue' | 'due_soon' | 'on_track'

export interface PmRow {
  id: string
  schedule: MaintenanceSchedule
  machine: Machine | undefined
  state: PmState
  /** next_due − today (negative = overdue by). */
  days: number
  done: number
  onTime: number
  late: number
}

export function pmCompliance(schedules: MaintenanceSchedule[], logs: MaintenanceLog[], machines: Machine[], today: ISODate, fyFrom: ISODate) {
  const mById = new Map(machines.map((m) => [m.id, m]))
  const rows: PmRow[] = schedules
    .filter((s) => s.active)
    .map((s) => {
      const days = diffDays(today, s.next_due)
      const state: PmState = s.next_due < today ? 'overdue' : days <= 7 ? 'due_soon' : 'on_track'
      const done = logs
        .filter((l) => l.type === 'preventive' && l.schedule_id === s.id && (l.status === 'closed' || !!l.completed_at))
        .map((l) => dateOfTs(l.completed_at ?? l.reported_at))
        .sort()
      const period = FREQUENCY_DAYS[s.frequency] + FREQUENCY_GRACE[s.frequency]
      let n = 0, onTime = 0, late = 0
      done.forEach((d, i) => {
        if (d < fyFrom || d > today) return
        n++
        if (i === 0 || diffDays(done[i - 1]!, d) <= period) onTime++
        else late++
      })
      return { id: s.id, schedule: s, machine: mById.get(s.machine_id), state, days, done: n, onTime, late }
    })
    .sort((a, b) => a.schedule.next_due.localeCompare(b.schedule.next_due))
  const overdue = rows.filter((r) => r.state === 'overdue').length
  const dueSoon = rows.filter((r) => r.state === 'due_soon').length
  const done = rows.reduce((s, r) => s + r.done, 0)
  const onTime = rows.reduce((s, r) => s + r.onTime, 0)
  return { rows, active: rows.length, overdue, dueSoon, onTrack: rows.length - overdue - dueSoon, compliance: pctOf(rows.length - overdue, rows.length), done, onTime, onTimePct: pctOf(onTime, done) }
}

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  raw_material: 'Raw material', consumable: 'Consumables', tooling: 'Tooling', spare: 'Spares', finished_good: 'Finished goods', packing: 'Packing',
}

export type StockState = 'out' | 'low' | 'ok'
export interface StockRow {
  id: string
  item: InventoryItem
  value: number
  state: StockState
  shortfall: number
}

export function stockState(i: Pick<InventoryItem, 'stock_qty' | 'reorder_level'>): StockState {
  if (i.stock_qty <= 0) return 'out'
  if (i.reorder_level > 0 && i.stock_qty <= i.reorder_level) return 'low'
  return 'ok'
}

export function inventoryValuation(items: InventoryItem[]) {
  const rows: StockRow[] = items
    .filter((i) => i.active)
    .map((item) => {
      const state = stockState(item)
      return { id: item.id, item, value: round2(item.stock_qty * item.unit_cost), state, shortfall: state === 'ok' ? 0 : Math.max(0, item.reorder_level - item.stock_qty) }
    })
  const total = round2(rows.reduce((s, r) => s + r.value, 0))
  const byCategory = (Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[])
    .map((c) => {
      const mine = rows.filter((r) => r.item.category === c)
      const value = round2(mine.reduce((s, r) => s + r.value, 0))
      return { id: c, category: c, label: ITEM_CATEGORY_LABEL[c], items: mine.length, value, share: pctOf(value, total), alerts: mine.filter((r) => r.state !== 'ok').length }
    })
    .filter((c) => c.items > 0)
    .sort((a, b) => b.value - a.value)
  return { rows, total, low: rows.filter((r) => r.state === 'low').length, out: rows.filter((r) => r.state === 'out').length, byCategory }
}

export type ToolState = 'open' | 'overdue' | 'returned' | 'lost'
export interface ToolRow {
  id: string
  issue: ToolIssue
  item: InventoryItem | undefined
  state: ToolState
  daysOut: number
  overdueDays: number
  value: number
  broken: boolean
}

export function toolCrib(issues: ToolIssue[], items: InventoryItem[], today: ISODate) {
  const iById = new Map(items.map((i) => [i.id, i]))
  const rows: ToolRow[] = issues
    .map((issue) => {
      const item = iById.get(issue.item_id)
      const state: ToolState =
        issue.status === 'lost' ? 'lost' : issue.status === 'returned' ? 'returned' : issue.due_back && issue.due_back < today ? 'overdue' : 'open'
      const end = issue.returned_on ?? today
      const unit = item?.unit_cost ?? 0
      // open or lost → what has not come back; returned → the value of the tools on this issue
      const qtyAtRisk = state === 'returned' ? issue.qty : Math.max(0, issue.qty - issue.returned_qty)
      return {
        id: issue.id, issue, item, state, daysOut: Math.max(0, diffDays(issue.issued_on, end)),
        overdueDays: state === 'overdue' && issue.due_back ? diffDays(issue.due_back, today) : 0,
        value: round2(qtyAtRisk * unit), broken: issue.condition === 'broken',
      }
    })
    .sort((a, b) => b.issue.issued_on.localeCompare(a.issue.issued_on))
  const isOpen = (r: ToolRow) => r.state === 'open' || r.state === 'overdue'
  const loss = rows.filter((r) => r.state === 'lost' || r.broken)
  return {
    rows,
    open: rows.filter(isOpen).length,
    openQty: rows.filter(isOpen).reduce((s, r) => s + r.issue.qty, 0),
    openValue: round2(rows.filter(isOpen).reduce((s, r) => s + r.value, 0)),
    overdue: rows.filter((r) => r.state === 'overdue').length,
    lost: rows.filter((r) => r.state === 'lost').length,
    broken: rows.filter((r) => r.broken).length,
    lossValue: round2(loss.reduce((s, r) => s + r.value, 0)),
  }
}

export type CalState = 'overdue' | 'due30' | 'due60' | 'later' | 'unscheduled'
export interface CalRow {
  id: string
  asset: Asset
  days: number | null
  state: CalState
}

export function calibrationDue(assets: Asset[], today: ISODate, horizon = 60) {
  const rows: CalRow[] = assets
    .filter((a) => a.calibration_required && a.status !== 'disposed')
    .map((asset) => {
      const days = asset.calibration_due ? diffDays(today, asset.calibration_due) : null
      const state: CalState = days == null ? 'unscheduled' : days < 0 ? 'overdue' : days <= 30 ? 'due30' : days <= horizon ? 'due60' : 'later'
      return { id: asset.id, asset, days, state }
    })
    .sort((a, b) => (a.days ?? -99999) - (b.days ?? -99999))
  const count = (s: CalState) => rows.filter((r) => r.state === s).length
  const buckets = [
    { key: 'Overdue', count: count('overdue'), color: '#c94a4a' },
    { key: '0–15 d', count: rows.filter((r) => r.days != null && r.days >= 0 && r.days <= 15).length, color: '#d08c1e' },
    { key: '16–30 d', count: rows.filter((r) => r.days != null && r.days > 15 && r.days <= 30).length, color: '#fbbf24' },
    { key: '31–45 d', count: rows.filter((r) => r.days != null && r.days > 30 && r.days <= 45).length, color: '#2f8f83' },
    { key: '46–60 d', count: rows.filter((r) => r.days != null && r.days > 45 && r.days <= horizon).length, color: '#2a56a1' },
  ]
  return { rows, total: rows.length, overdue: count('overdue'), due30: count('due30'), due60: count('due60'), later: count('later'), unscheduled: count('unscheduled'), buckets }
}

export interface VendorRow {
  id: string
  vendor: Vendor | undefined
  name: string
  pos: number
  subtotal: number
  tax: number
  total: number
  received: number
  receivedPct: number
  open: number
  lastPo: ISODate
}

/** Value received on a PO = Σ min(received, ordered) × rate incl. GST. */
export function poReceivedValue(lines: PurchaseOrderLine[]): number {
  return round2(lines.reduce((s, l) => s + Math.min(l.received_qty, l.qty) * l.rate * (1 + l.gst_rate / 100), 0))
}

export function purchaseByVendor(pos: PurchaseOrder[], lines: PurchaseOrderLine[], vendors: Vendor[], range: DateRange) {
  const inRange = pos.filter((p) => p.date >= range.from && p.date <= range.to)
  const counted = inRange.filter((p) => p.status !== 'draft' && p.status !== 'cancelled')
  const linesByPo = new Map<string, PurchaseOrderLine[]>()
  for (const l of lines) {
    const arr = linesByPo.get(l.po_id)
    if (arr) arr.push(l)
    else linesByPo.set(l.po_id, [l])
  }
  const received = (p: PurchaseOrder) => Math.min(p.total, poReceivedValue(linesByPo.get(p.id) ?? []))
  const rows: VendorRow[] = [...new Set(counted.map((p) => p.vendor_id))]
    .map((vid) => {
      const mine = counted.filter((p) => p.vendor_id === vid)
      const vendor = vendors.find((v) => v.id === vid)
      const total = round2(mine.reduce((s, p) => s + p.total, 0))
      const rec = round2(mine.reduce((s, p) => s + received(p), 0))
      return {
        id: vid, vendor, name: vendor?.name ?? 'Unknown vendor', pos: mine.length, subtotal: round2(mine.reduce((s, p) => s + p.subtotal, 0)),
        tax: round2(mine.reduce((s, p) => s + p.tax_total, 0)), total, received: rec, receivedPct: pctOf(rec, total), open: round2(total - rec),
        lastPo: mine.map((p) => p.date).sort().reverse()[0] ?? '',
      }
    })
    .sort((a, b) => b.total - a.total)
  const t = (k: 'pos' | 'subtotal' | 'tax' | 'total' | 'received' | 'open') => round2(rows.reduce((s, r) => s + r[k], 0))
  const drafts = inRange.filter((p) => p.status === 'draft')
  return {
    rows,
    totals: { pos: t('pos'), subtotal: t('subtotal'), tax: t('tax'), total: t('total'), received: t('received'), open: t('open'), receivedPct: pctOf(t('received'), t('total')) },
    drafts: drafts.length,
    draftValue: round2(drafts.reduce((s, p) => s + p.total, 0)),
    cancelled: inRange.filter((p) => p.status === 'cancelled').length,
  }
}

export type DeliveryState = 'on_time' | 'late' | 'overdue' | 'open' | 'cancelled'
export interface WoRow {
  id: string
  wo: WorkOrder
  customer: Customer | undefined
  value: number
  balanceQty: number
  balanceValue: number
  deliveredOn: ISODate | null
  delivery: DeliveryState
  /** Days past due (late deliveries and overdue open orders). */
  daysLate: number
}

const CLOSED_WO: WorkOrderStatus[] = ['dispatched', 'cancelled']

/**
 * Delivery date = when the work order moved to "dispatched" in the audit trail; falls back to the
 * row's last update when no audit entry is available.
 */
export function workOrderReport(wos: WorkOrder[], customers: Customer[], audits: AuditLog[], today: ISODate) {
  const cById = new Map(customers.map((c) => [c.id, c]))
  const dispatchedAt = new Map<string, ISODate>()
  for (const a of audits) {
    if (a.entity !== 'work_orders' || !a.entity_id) continue
    const st = a.changes?.status as { to?: unknown } | undefined
    if (st?.to !== 'dispatched') continue
    const d = dateOfTs(a.at)
    const prev = dispatchedAt.get(a.entity_id)
    if (!prev || d < prev) dispatchedAt.set(a.entity_id, d)
  }
  const rows: WoRow[] = wos
    .map((wo) => {
      const value = round2(wo.qty * wo.unit_price)
      const balanceQty = CLOSED_WO.includes(wo.status) ? 0 : Math.max(0, wo.qty - wo.completed_qty)
      let deliveredOn: ISODate | null = null
      let delivery: DeliveryState
      let daysLate = 0
      if (wo.status === 'cancelled') delivery = 'cancelled'
      else if (wo.status === 'dispatched') {
        deliveredOn = wo.dispatched_on ?? dispatchedAt.get(wo.id) ?? dateOfTs(wo.updated_at)
        daysLate = Math.max(0, diffDays(wo.due_date, deliveredOn))
        delivery = daysLate > 0 ? 'late' : 'on_time'
      } else if (wo.due_date < today) {
        delivery = 'overdue'
        daysLate = diffDays(wo.due_date, today)
      } else delivery = 'open'
      return { id: wo.id, wo, customer: cById.get(wo.customer_id), value, balanceQty, balanceValue: round2(balanceQty * wo.unit_price), deliveredOn, delivery, daysLate }
    })
    .sort((a, b) => a.wo.due_date.localeCompare(b.wo.due_date))
  const open = rows.filter((r) => !CLOSED_WO.includes(r.wo.status))
  const delivered = rows.filter((r) => r.delivery === 'on_time' || r.delivery === 'late')
  const onTime = delivered.filter((r) => r.delivery === 'on_time').length
  const made = rows.reduce((s, r) => s + r.wo.completed_qty + r.wo.rejected_qty, 0)
  const rejected = rows.reduce((s, r) => s + r.wo.rejected_qty, 0)
  const byCustomer = [...new Set(open.map((r) => r.wo.customer_id))]
    .map((cid) => ({ id: cid, name: cById.get(cid)?.name ?? '—', value: round2(open.filter((r) => r.wo.customer_id === cid).reduce((s, r) => s + r.value, 0)) }))
    .sort((a, b) => b.value - a.value)
  const statuses: WorkOrderStatus[] = ['planned', 'in_progress', 'qc', 'on_hold', 'completed', 'dispatched', 'cancelled']
  return {
    rows,
    open: open.length,
    orderBook: round2(open.reduce((s, r) => s + r.value, 0)),
    balanceValue: round2(open.reduce((s, r) => s + r.balanceValue, 0)),
    delivered: delivered.length,
    onTime,
    otd: pctOf(onTime, delivered.length),
    overdue: rows.filter((r) => r.delivery === 'overdue').length,
    rejectionPct: pctOf(rejected, made),
    byCustomer,
    byStatus: statuses.map((s) => ({ status: s, count: rows.filter((r) => r.wo.status === s).length })).filter((s) => s.count > 0),
  }
}

export interface QualityMonth {
  id: string
  month: YearMonth
  label: string
  total: number
  pass: number
  fail: number
  conditional: number
  passRate: number
  lot: number
  rejected: number
  rejPct: number
}

export interface PartQuality {
  id: string
  part: string
  inspections: number
  fails: number
  lot: number
  accepted: number
  rejected: number
  rejPct: number
}

export interface NcrRow {
  id: string
  ncr: Ncr
  ageDays: number
}

export function qualityReport(inspections: Inspection[], ncrs: Ncr[], fy: number, today: ISODate, fyStartMonth = 4) {
  const { from, to } = fyRange(fy, fyStartMonth)
  const ins = inspections.filter((i) => i.date >= from && i.date <= to)
  const count = (xs: Inspection[], r: InspectionResult) => xs.filter((x) => x.result === r).length
  const months: QualityMonth[] = fyMonths(fy, fyStartMonth)
    .filter((m) => monthStart(m) <= today)
    .map((m) => {
      const xs = ins.filter((i) => monthOf(i.date) === m)
      const lot = xs.reduce((s, i) => s + i.lot_qty, 0)
      const rejected = xs.reduce((s, i) => s + i.rejected_qty, 0)
      return {
        id: m, month: m, label: fmtMonth(m, true), total: xs.length, pass: count(xs, 'pass'), fail: count(xs, 'fail'), conditional: count(xs, 'conditional'),
        passRate: pctOf(count(xs, 'pass'), xs.length), lot, rejected, rejPct: pctOf(rejected, lot),
      }
    })
  const parts: PartQuality[] = [...new Set(ins.map((i) => i.part_name))]
    .map((part) => {
      const xs = ins.filter((i) => i.part_name === part)
      const lot = xs.reduce((s, i) => s + i.lot_qty, 0)
      const rejected = xs.reduce((s, i) => s + i.rejected_qty, 0)
      return { id: part, part, inspections: xs.length, fails: count(xs, 'fail'), lot, accepted: xs.reduce((s, i) => s + i.accepted_qty, 0), rejected, rejPct: pctOf(rejected, lot) }
    })
    .sort((a, b) => b.rejected - a.rejected || b.rejPct - a.rejPct || a.part.localeCompare(b.part))
  const ncrRows: NcrRow[] = ncrs
    .filter((n) => (n.date >= from && n.date <= to) || (n.status === 'open' && n.date <= to))
    .map((ncr) => ({ id: ncr.id, ncr, ageDays: Math.max(0, diffDays(ncr.date, ncr.status === 'closed' && ncr.closed_on ? ncr.closed_on : today)) }))
    .sort((a, b) => b.ncr.date.localeCompare(a.ncr.date))
  const lot = ins.reduce((s, i) => s + i.lot_qty, 0)
  const rejected = ins.reduce((s, i) => s + i.rejected_qty, 0)
  return {
    months, parts, ncrs: ncrRows,
    total: ins.length, pass: count(ins, 'pass'), fail: count(ins, 'fail'), conditional: count(ins, 'conditional'),
    passRate: pctOf(count(ins, 'pass'), ins.length), lot, rejected, rejPct: pctOf(rejected, lot),
    openNcrs: ncrRows.filter((n) => n.ncr.status === 'open').length,
  }
}

/** 'FY 2026-27' */
export const fyText = (fy: number) => `FY ${fyLabel(fy)}`
