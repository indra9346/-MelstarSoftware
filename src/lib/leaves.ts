/** Leave arithmetic — pure functions. */
import type { Employee, ISODate, LeaveBalance, LeaveRequest, LeaveType, Shift } from '@/data/types'
import { dayOfWeek, eachDay, fyOf, fyRange } from './dates'

/** Working days in a leave span: week-offs and holidays are not counted. */
export function countLeaveDays(
  from: ISODate,
  to: ISODate,
  opts: { halfDay: boolean; weeklyOffs: number[]; holidays: Set<ISODate> },
): number {
  if (!from || !to || to < from) return 0
  if (opts.halfDay) return from === to && !opts.weeklyOffs.includes(dayOfWeek(from)) && !opts.holidays.has(from) ? 0.5 : 0
  return eachDay(from, to).filter((d) => !opts.weeklyOffs.includes(dayOfWeek(d)) && !opts.holidays.has(d)).length
}

/** Entitlement pro-rated by months remaining in the FY for mid-year joiners (rounded to 0.5). */
export function proratedQuota(quota: number, joining: ISODate, fyStart: number): number {
  const { from, to } = fyRange(fyStart)
  if (joining <= from) return quota
  if (joining > to) return 0
  const [jy, jm] = joining.split('-').map(Number)
  const monthsLeft = (fyStart + 1 - jy!) * 12 + (4 - jm!) // months from joining month to March inclusive
  return Math.round(((quota * Math.max(0, Math.min(12, monthsLeft))) / 12) * 2) / 2
}

export interface BalanceView {
  type: LeaveType
  opening: number
  allotted: number
  adjustment: number
  entitled: number
  used: number
  pending: number
  available: number
}

export function leaveBalances(
  emp: Employee,
  year: number,
  types: LeaveType[],
  balances: LeaveBalance[],
  requests: LeaveRequest[],
): BalanceView[] {
  const { from, to } = fyRange(year)
  const mine = requests.filter((r) => r.employee_id === emp.id && r.from_date >= from && r.from_date <= to)
  return types
    .filter((t) => t.active && (!t.gender || t.gender === emp.gender))
    .map((type) => {
      const b = balances.find((x) => x.employee_id === emp.id && x.leave_type_id === type.id && x.year === year)
      const opening = b?.opening ?? 0
      const allotted = b?.allotted ?? (type.code === 'LOP' ? 0 : proratedQuota(type.annual_quota, emp.date_of_joining, year))
      const adjustment = b?.adjustment ?? 0
      const used = sumDays(mine.filter((r) => r.leave_type_id === type.id && r.status === 'approved'))
      const pending = sumDays(mine.filter((r) => r.leave_type_id === type.id && r.status === 'pending'))
      const entitled = opening + allotted + adjustment
      const available = type.code === 'LOP' ? Infinity : entitled - used - pending
      return { type, opening, allotted, adjustment, entitled, used, pending, available }
    })
}

const sumDays = (rs: LeaveRequest[]) => rs.reduce((s, r) => s + r.days, 0)

export function overlaps(a: Pick<LeaveRequest, 'from_date' | 'to_date'>, b: Pick<LeaveRequest, 'from_date' | 'to_date'>) {
  return a.from_date <= b.to_date && b.from_date <= a.to_date
}

export function currentFy(date: ISODate) {
  return fyOf(date)
}

export function weeklyOffsFor(emp: Pick<Employee, 'shift_id'>, shifts: Shift[]): number[] {
  return shifts.find((s) => s.id === emp.shift_id)?.weekly_offs ?? [0]
}
