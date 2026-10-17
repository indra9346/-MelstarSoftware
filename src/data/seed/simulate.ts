/**
 * Deterministic "biometric" punch simulator used by the demo seed and by the static-mode
 * autopilot (which back-fills punches for days the demo was not opened).
 */
import type { AttendancePolicy, Employee, ISODate, NewRow, Shift } from '../types'
import { computePunch } from '@/lib/attendance'
import { combine } from '@/lib/dates'
import { hashString, seededRandom } from '@/lib/ids'

export interface SimOptions {
  /** Only produce punches that happened before this moment (for "today"). */
  cutoff?: Date
  /** Half-day leave: leave at lunch. */
  halfDay?: boolean
  otStatus: 'approved' | 'pending'
  otEligible: boolean
}

export function simulateDay(emp: Employee, date: ISODate, shift: Shift, policy: AttendancePolicy, opts: SimOptions): NewRow<'attendance'> | null {
  const r = seededRandom(hashString(`${emp.emp_code}|${date}`))
  const tendency = (hashString(emp.emp_code) % 100) / 100 // 0..1 per person
  const absentP = 0.006 + tendency * 0.018
  const lateP = 0.03 + tendency * 0.1
  if (!opts.halfDay && r.chance(absentP)) return null

  const start = combine(date, shift.start_time).getTime()
  let end = combine(date, shift.end_time).getTime()
  if (end <= start) end += 86_400_000

  let inOffset = r.int(-24, 7)
  if (r.chance(lateP)) inOffset = r.int(shift.grace_minutes + 1, 48)
  const checkIn = new Date(start + inOffset * 60_000 + r.int(0, 59) * 1000)

  let outOffset = r.int(-2, 16)
  if (opts.halfDay || r.chance(0.01)) outOffset = -Math.round((end - start) / 60_000 / 2) + r.int(-10, 15)
  else if (opts.otEligible && r.chance(0.17)) outOffset = r.int(45, 150)
  else if (r.chance(0.03)) outOffset = -r.int(20, 60) // left early
  let checkOut: Date | null = new Date(end + outOffset * 60_000 + r.int(0, 59) * 1000)

  if (opts.cutoff) {
    if (checkIn > opts.cutoff) return null
    if (checkOut > opts.cutoff) checkOut = null
  }
  const calc = computePunch(date, shift, checkIn.toISOString(), checkOut?.toISOString() ?? null, policy)
  return {
    employee_id: emp.id,
    date,
    shift_id: shift.id,
    check_in: checkIn.toISOString(),
    check_out: checkOut?.toISOString() ?? null,
    status: calc.status,
    late_minutes: calc.late_minutes,
    early_exit_minutes: calc.early_exit_minutes,
    worked_minutes: calc.worked_minutes,
    ot_minutes: calc.ot_minutes,
    ot_status: calc.ot_minutes > 0 ? opts.otStatus : 'none',
    source: 'biometric',
    check_in_lat: null,
    check_in_lng: null,
    check_in_distance_m: null,
    remarks: '',
    created_at: checkIn.toISOString(),
    updated_at: (checkOut ?? checkIn).toISOString(),
  }
}
