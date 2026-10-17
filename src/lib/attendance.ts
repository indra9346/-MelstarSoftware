/**
 * Attendance rules — pure functions shared by the seed, services, dashboards and payroll.
 *
 * Only punches (and manual marks) are stored. Every other day is *derived*:
 * holiday → week-off → approved leave → future/today → absent. That keeps the register,
 * the live board and payroll in agreement without nightly jobs.
 */
import type {
  AttendancePolicy, AttendanceRecord, AttendanceStatus, Employee, Holiday, ISODate, LeaveRequest, LeaveType, Shift, YearMonth,
} from '@/data/types'
import { addDays, combine, dayOfWeek, minutesBetween, monthDates, todayISO } from './dates'

export interface PunchCalc {
  late_minutes: number
  early_exit_minutes: number
  worked_minutes: number
  ot_minutes: number
  status: AttendanceStatus
}

/** Compute late / worked / OT / status for one punch pair against a shift. */
export function computePunch(
  date: ISODate,
  shift: Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'grace_minutes' | 'half_day_minutes'>,
  checkIn: string | null,
  checkOut: string | null,
  policy: Pick<AttendancePolicy, 'min_ot_minutes'>,
): PunchCalc {
  if (!checkIn) return { late_minutes: 0, early_exit_minutes: 0, worked_minutes: 0, ot_minutes: 0, status: 'absent' }
  const start = combine(date, shift.start_time)
  let end = combine(date, shift.end_time)
  if (end <= start) end = new Date(end.getTime() + 86_400_000) // night shift
  const lateBy = minutesBetween(start, checkIn)
  const late_minutes = lateBy > shift.grace_minutes ? lateBy : 0
  if (!checkOut) return { late_minutes, early_exit_minutes: 0, worked_minutes: 0, ot_minutes: 0, status: 'present' }
  const span = Math.max(0, minutesBetween(checkIn, checkOut))
  const worked_minutes = span > 300 ? span - shift.break_minutes : span
  const early_exit_minutes = Math.max(0, minutesBetween(checkOut, end))
  const beyond = Math.max(0, minutesBetween(end, checkOut))
  // OT counted in 15-minute blocks once past the policy threshold.
  const ot_minutes = beyond >= policy.min_ot_minutes ? Math.floor(beyond / 15) * 15 : 0
  const status: AttendanceStatus = worked_minutes >= shift.half_day_minutes ? 'present' : 'half_day'
  return { late_minutes, early_exit_minutes, worked_minutes, ot_minutes, status }
}

export type DayStatus =
  | 'present' | 'half_day' | 'absent' | 'on_duty'
  | 'leave' | 'half_leave' | 'unpaid_leave'
  | 'holiday' | 'week_off'
  | 'today' | 'upcoming' | 'not_employed'

export interface DayInfo {
  date: ISODate
  status: DayStatus
  record?: AttendanceRecord
  leave?: LeaveRequest
  leaveType?: LeaveType
  holiday?: Holiday
  late: boolean
  /** Fraction of the day that is paid (1, 0.5 or 0). Future/today days count as paid (projected). */
  paid: number
}

export const DAY_STATUS_META: Record<DayStatus, { label: string; short: string; color: string; bg: string }> = {
  present: { label: 'Present', short: 'P', color: '#047857', bg: '#d1fae5' },
  on_duty: { label: 'On duty', short: 'OD', color: '#0e7490', bg: '#cffafe' },
  half_day: { label: 'Half day', short: 'HD', color: '#b45309', bg: '#fef3c7' },
  absent: { label: 'Absent', short: 'A', color: '#be123c', bg: '#ffe4e6' },
  leave: { label: 'On leave', short: 'L', color: '#6d28d9', bg: '#ede9fe' },
  half_leave: { label: 'Half-day leave', short: 'HL', color: '#7c3aed', bg: '#f3e8ff' },
  unpaid_leave: { label: 'Leave without pay', short: 'LWP', color: '#9f1239', bg: '#fce7f3' },
  holiday: { label: 'Holiday', short: 'H', color: '#0369a1', bg: '#e0f2fe' },
  week_off: { label: 'Week off', short: 'WO', color: '#64748b', bg: '#f1f5f9' },
  today: { label: 'Not punched yet', short: '·', color: '#4f46e5', bg: '#eef2ff' },
  upcoming: { label: 'Upcoming', short: '', color: '#94a3b8', bg: 'transparent' },
  not_employed: { label: 'Not on rolls', short: '', color: '#cbd5e1', bg: 'transparent' },
}

/** Pre-indexed lookups so resolving a whole month for 40 people stays fast. */
export interface AttendanceContext {
  holidays: Map<ISODate, Holiday>
  records: Map<string, AttendanceRecord> // key `${employee_id}|${date}`
  leaves: Map<string, LeaveRequest[]> // approved leaves by employee
  leaveTypes: Map<string, LeaveType>
  shifts: Map<string, Shift>
  today: ISODate
}

export function buildAttendanceContext(input: {
  holidays: Holiday[]
  attendance: AttendanceRecord[]
  leaveRequests: LeaveRequest[]
  leaveTypes: LeaveType[]
  shifts: Shift[]
  today?: ISODate
}): AttendanceContext {
  // Optional holidays are employee-chosen leave days, not plant closures.
  const holidays = new Map(input.holidays.filter((h) => h.type !== 'optional').map((h) => [h.date, h]))
  const records = new Map(input.attendance.map((r) => [`${r.employee_id}|${r.date}`, r]))
  const leaves = new Map<string, LeaveRequest[]>()
  for (const l of input.leaveRequests) {
    if (l.status !== 'approved') continue
    const arr = leaves.get(l.employee_id)
    if (arr) arr.push(l)
    else leaves.set(l.employee_id, [l])
  }
  return {
    holidays,
    records,
    leaves,
    leaveTypes: new Map(input.leaveTypes.map((t) => [t.id, t])),
    shifts: new Map(input.shifts.map((s) => [s.id, s])),
    today: input.today ?? todayISO(),
  }
}

export function isWeekOff(emp: Pick<Employee, 'shift_id'>, date: ISODate, ctx: AttendanceContext): boolean {
  const shift = ctx.shifts.get(emp.shift_id)
  return (shift?.weekly_offs ?? [0]).includes(dayOfWeek(date))
}

export function resolveDay(emp: Employee, date: ISODate, ctx: AttendanceContext): DayInfo {
  const base = { date, late: false }
  if (date < emp.date_of_joining || (emp.date_of_exit && date > emp.date_of_exit)) {
    return { ...base, status: 'not_employed', paid: 0 }
  }
  const record = ctx.records.get(`${emp.id}|${date}`)
  const holiday = ctx.holidays.get(date)
  const leave = ctx.leaves.get(emp.id)?.find((l) => l.from_date <= date && l.to_date >= date)
  const leaveType = leave ? ctx.leaveTypes.get(leave.leave_type_id) : undefined
  const leavePaid = leaveType ? leaveType.paid : true

  if (record && record.status !== 'absent') {
    const late = record.late_minutes > 0
    if (record.status === 'half_day') {
      // half day worked + half-day leave = fully covered
      if (leave?.half_day) return { ...base, status: 'half_day', record, leave, leaveType, late, paid: leavePaid ? 1 : 0.5 }
      return { ...base, status: 'half_day', record, late, paid: 0.5 }
    }
    return { ...base, status: record.status, record, holiday, late, paid: 1 }
  }
  if (holiday) return { ...base, status: 'holiday', holiday, paid: 1 }
  if (isWeekOff(emp, date, ctx)) return { ...base, status: 'week_off', paid: 1 }
  if (leave) {
    if (leave.half_day) {
      // half-day leave with no punch: the other half is absent unless the day hasn't happened yet
      const otherHalf = date >= ctx.today ? 0.5 : 0
      return { ...base, status: 'half_leave', leave, leaveType, paid: (leavePaid ? 0.5 : 0) + otherHalf }
    }
    return { ...base, status: leavePaid ? 'leave' : 'unpaid_leave', leave, leaveType, paid: leavePaid ? 1 : 0 }
  }
  if (record?.status === 'absent') return { ...base, status: 'absent', record, paid: 0 }
  if (date > ctx.today) return { ...base, status: 'upcoming', paid: 1 }
  if (date === ctx.today) return { ...base, status: 'today', paid: 1 }
  return { ...base, status: 'absent', paid: 0 }
}

export interface MonthSummary {
  month: YearMonth
  days_in_month: number
  employed_days: number
  working_days: number
  present: number // half days count 0.5
  half_days: number
  paid_leave: number
  unpaid_leave: number
  absent: number
  holidays: number
  week_offs: number
  upcoming: number
  late_marks: number
  late_penalty_days: number
  ot_minutes_approved: number
  ot_minutes_pending: number
  worked_minutes: number
  lop_days: number
  paid_days: number
  days: DayInfo[]
}

/** Month roll-up used by the register and by payroll (paid days / LOP). */
export function summariseMonth(emp: Employee, month: YearMonth, ctx: AttendanceContext, policy: Pick<AttendancePolicy, 'late_marks_per_half_day'>): MonthSummary {
  const dates = monthDates(month)
  const days = dates.map((d) => resolveDay(emp, d, ctx))
  const s: MonthSummary = {
    month, days_in_month: dates.length, employed_days: 0, working_days: 0, present: 0, half_days: 0, paid_leave: 0, unpaid_leave: 0,
    absent: 0, holidays: 0, week_offs: 0, upcoming: 0, late_marks: 0, late_penalty_days: 0, ot_minutes_approved: 0,
    ot_minutes_pending: 0, worked_minutes: 0, lop_days: 0, paid_days: 0, days,
  }
  let notEmployed = 0
  let paidFraction = 0
  for (const d of days) {
    if (d.status === 'not_employed') {
      notEmployed++
      continue
    }
    paidFraction += d.paid
    if (d.status !== 'holiday' && d.status !== 'week_off') s.working_days++
    switch (d.status) {
      case 'present':
      case 'on_duty':
        s.present += 1
        break
      case 'half_day':
        s.present += 0.5
        s.half_days++
        if (d.leave) s.paid_leave += d.leaveType?.paid === false ? 0 : 0.5
        break
      case 'leave':
        s.paid_leave += 1
        break
      case 'half_leave':
        s.paid_leave += d.leaveType?.paid === false ? 0 : 0.5
        if (d.leaveType?.paid === false) s.unpaid_leave += 0.5
        if (d.paid < 1 && d.date < ctx.today) s.absent += 0.5
        break
      case 'unpaid_leave':
        s.unpaid_leave += 1
        break
      case 'absent':
        s.absent += 1
        break
      case 'holiday':
        s.holidays++
        break
      case 'week_off':
        s.week_offs++
        break
      case 'today':
      case 'upcoming':
        s.upcoming++
        break
    }
    if (d.record) {
      if (d.late) s.late_marks++
      s.worked_minutes += d.record.worked_minutes
      if (d.record.ot_status === 'approved') s.ot_minutes_approved += d.record.ot_minutes
      if (d.record.ot_status === 'pending') s.ot_minutes_pending += d.record.ot_minutes
    }
  }
  s.employed_days = dates.length - notEmployed
  s.late_penalty_days = policy.late_marks_per_half_day > 0 ? Math.floor(s.late_marks / policy.late_marks_per_half_day) * 0.5 : 0
  const paid = Math.max(0, paidFraction - s.late_penalty_days)
  s.paid_days = round1(paid)
  s.lop_days = round1(s.employed_days - s.paid_days)
  return s
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Today's live status for the dashboards. */
export function liveStatus(emp: Employee, ctx: AttendanceContext): 'in' | 'out' | 'not_in' | 'leave' | 'off' | 'holiday' {
  const d = resolveDay(emp, ctx.today, ctx)
  if (d.status === 'holiday') return 'holiday'
  if (d.status === 'week_off') return 'off'
  if (d.status === 'leave' || d.status === 'unpaid_leave') return 'leave'
  if (d.record?.check_in && !d.record.check_out) return 'in'
  if (d.record?.check_out) return 'out'
  if (d.status === 'half_leave') return 'leave'
  return 'not_in'
}

/** Consecutive present-day streak ending today/yesterday (employee dashboard flourish). */
export function presentStreak(emp: Employee, ctx: AttendanceContext): number {
  let n = 0
  let d = ctx.records.get(`${emp.id}|${ctx.today}`)?.check_in ? ctx.today : addDays(ctx.today, -1)
  for (let i = 0; i < 120; i++) {
    const info = resolveDay(emp, d, ctx)
    if (info.status === 'present' || info.status === 'on_duty') n++
    else if (info.status !== 'week_off' && info.status !== 'holiday') break
    d = addDays(d, -1)
  }
  return n
}
