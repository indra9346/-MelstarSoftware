/**
 * Attendance actions. Check-in/out go through the database (server clock) in Supabase mode;
 * static mode computes the same thing locally with lib/attendance.computePunch.
 *
 * Manual marks, regularisations, overtime decisions and shift maintenance live here too, so the
 * pages stay thin and every write is validated + audited in one place.
 */
import { db } from '@/data/store'
import type { AttendanceRecord, AttendanceStatus, Employee, HHMM, ISODate, NewRow, OtStatus, PayrollRun, Regularisation, Shift } from '@/data/types'
import { computePunch, DAY_STATUS_META } from '@/lib/attendance'
import { addDays, combine, fmtDate, fmtHHMM, hhmmToMinutes, minuteOfDay, minutesToHHMM, todayISO } from '@/lib/dates'
import { distanceMeters } from '@/lib/misc'
import { fullName } from '@/lib/format'
import { audit, diff } from './audit'
import { currentSession, selfApprovalBlock } from './session'

export interface GeoFix {
  lat: number
  lng: number
  accuracy: number
}

/** Best-effort location for the check-in geofence (never blocks the punch). */
export function getLocation(timeoutMs = 6000): Promise<GeoFix | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    const timer = setTimeout(() => resolve(null), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer)
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy })
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

export function todayRecord(employeeId: string): AttendanceRecord | undefined {
  const today = todayISO()
  return db.find('attendance', (a) => a.employee_id === employeeId && a.date === today)
}

/** The open punch (checked in, not out) — today, or last night for a night shift. */
export function openRecord(employeeId: string): AttendanceRecord | undefined {
  const cutoff = Date.now() - 20 * 3600_000
  return db
    .where('attendance', (a) => a.employee_id === employeeId && !!a.check_in && !a.check_out && new Date(a.check_in).getTime() > cutoff)
    .sort((a, b) => (b.check_in ?? '').localeCompare(a.check_in ?? ''))[0]
}

export async function checkIn(emp: Employee, geo: GeoFix | null): Promise<AttendanceRecord> {
  const backend = db.backend
  if (backend?.kind === 'supabase' && backend.rpc) {
    const row = await backend.rpc<AttendanceRecord>('attendance_check_in', { p_lat: geo?.lat ?? null, p_lng: geo?.lng ?? null, p_source: isMobile() ? 'mobile' : 'web' })
    db.ingest('attendance', row)
    audit('check_in', 'attendance', row.id, 'Checked in')
    return row
  }
  const s = db.settings()
  const shift = db.get('shifts', emp.shift_id)
  if (!shift) throw new Error('No shift assigned — ask HR to set your shift.')
  if (!s.attendance.allow_web_checkin) throw new Error('Web check-in is switched off — please use the biometric terminal.')
  const today = todayISO()
  const existing = todayRecord(emp.id)
  if (existing?.check_in) throw new Error('You have already checked in today.')
  const now = new Date().toISOString()
  const calc = computePunch(today, shift, now, null, s.attendance)
  const dist = geo ? distanceMeters(geo.lat, geo.lng, s.plant_lat, s.plant_lng) : null
  const fields = {
    check_in: now, check_out: null, status: 'present' as const, late_minutes: calc.late_minutes, early_exit_minutes: 0, worked_minutes: 0, ot_minutes: 0,
    ot_status: 'none' as const, source: isMobile() ? ('mobile' as const) : ('web' as const), check_in_lat: geo?.lat ?? null, check_in_lng: geo?.lng ?? null,
    check_in_distance_m: dist, remarks: '',
  }
  const row = existing ? db.update('attendance', existing.id, fields) : db.insert('attendance', { employee_id: emp.id, date: today, shift_id: shift.id, ...fields })
  audit('check_in', 'attendance', row.id, 'Checked in')
  return row
}

export async function checkOut(emp: Employee): Promise<AttendanceRecord> {
  const backend = db.backend
  if (backend?.kind === 'supabase' && backend.rpc) {
    const row = await backend.rpc<AttendanceRecord>('attendance_check_out')
    db.ingest('attendance', row)
    audit('check_out', 'attendance', row.id, 'Checked out')
    return row
  }
  const rec = openRecord(emp.id)
  if (!rec?.check_in) throw new Error('No open check-in found for today.')
  const shift = db.get('shifts', rec.shift_id)!
  const now = new Date().toISOString()
  const calc = computePunch(rec.date, shift, rec.check_in, now, db.settings().attendance)
  const row = db.update('attendance', rec.id, { check_out: now, ...calc, ot_status: calc.ot_minutes > 0 ? 'pending' : 'none' })
  audit('check_out', 'attendance', row.id, 'Checked out')
  return row
}

function isMobile() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
}

/* ── shared helpers ──────────────────────────────────────────────────────── */

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const isHHMM = (t: string | null | undefined): t is HHMM => !!t && HHMM_RE.test(t)
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'half_day', 'on_duty', 'absent']

/** Local 'HH:MM' of an ISO timestamp (for pre-filling time inputs). */
export function hhmmOf(iso: string | null | undefined): HHMM | '' {
  return iso ? minutesToHHMM(minuteOfDay(iso)) : ''
}

export function isEmployedOn(emp: Pick<Employee, 'date_of_joining' | 'date_of_exit'>, date: ISODate): boolean {
  return date >= emp.date_of_joining && (!emp.date_of_exit || date <= emp.date_of_exit)
}

export function isNightShift(shift: Pick<Shift, 'start_time' | 'end_time'>): boolean {
  return hhmmToMinutes(shift.end_time) <= hhmmToMinutes(shift.start_time)
}

export function recordFor(employeeId: string, date: ISODate): AttendanceRecord | undefined {
  return db.find('attendance', (a) => a.employee_id === employeeId && a.date === date)
}

/** Payroll run that already covers a month (processed / approved / paid) — edits won't reach issued payslips. */
export function payrollLock(month: string): PayrollRun | undefined {
  return db.find('payroll_runs', (r) => r.month === month && r.status !== 'draft')
}

type ShiftTimes = Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'grace_minutes' | 'half_day_minutes'>

export interface ManualPunch {
  check_in: string | null
  check_out: string | null
  late_minutes: number
  early_exit_minutes: number
  worked_minutes: number
  ot_minutes: number
  /** Status the punch times point to (present / half_day) once both times are known. */
  suggested: AttendanceStatus | null
}

const NO_PUNCH: ManualPunch = { check_in: null, check_out: null, late_minutes: 0, early_exit_minutes: 0, worked_minutes: 0, ot_minutes: 0, suggested: null }

/**
 * 'HH:MM' times on a date → punch timestamps + late / worked / OT via computePunch (the same maths as
 * biometric punches, so the register and payroll agree). Throws a friendly error for bad input.
 * On-duty days carry no late / early-exit marks (the employee was working elsewhere).
 */
export function punchFromTimes(date: ISODate, shift: ShiftTimes, inTime: string | null, outTime: string | null, status: AttendanceStatus): ManualPunch {
  if (status === 'absent') return NO_PUNCH
  if (inTime && !isHHMM(inTime)) throw new Error('Check-in must be a time like 09:05.')
  if (outTime && !isHHMM(outTime)) throw new Error('Check-out must be a time like 17:30.')
  if (outTime && !inTime) throw new Error('Enter the check-in time as well.')
  if (!inTime) return NO_PUNCH
  const ci = combine(date, inTime)
  let co = outTime ? combine(date, outTime) : null
  if (co && co < ci) {
    if (!isNightShift(shift)) throw new Error('Check-out must be at or after check-in.')
    co = combine(addDays(date, 1), outTime!)
  }
  const check_in = ci.toISOString()
  const check_out = co ? co.toISOString() : null
  const calc = computePunch(date, shift, check_in, check_out, db.settings().attendance)
  const onDuty = status === 'on_duty'
  return {
    check_in,
    check_out,
    late_minutes: onDuty ? 0 : calc.late_minutes,
    early_exit_minutes: onDuty ? 0 : calc.early_exit_minutes,
    worked_minutes: calc.worked_minutes,
    ot_minutes: calc.ot_minutes,
    suggested: check_out ? calc.status : null,
  }
}

/** Keep an existing OT decision when the OT minutes did not change; otherwise new OT waits for approval. */
function otStatusFor(existing: AttendanceRecord | undefined, otMinutes: number): OtStatus {
  if (otMinutes <= 0) return 'none'
  if (existing && existing.ot_minutes === otMinutes && existing.ot_status !== 'none') return existing.ot_status
  return 'pending'
}

const statusLabel = (s: AttendanceStatus) => DAY_STATUS_META[s].label

function shiftForDay(emp: Employee, existing?: AttendanceRecord): Shift {
  const shift = (existing && db.get('shifts', existing.shift_id)) || db.get('shifts', emp.shift_id)
  if (!shift) throw new Error(`${fullName(emp)} has no shift assigned — set it in Employees first.`)
  return shift
}

/* ── manual mark / edit ──────────────────────────────────────────────────── */

export interface MarkInput {
  employeeId: string
  date: ISODate
  status: AttendanceStatus
  checkIn: string
  checkOut: string
  remarks: string
}

/** Insert or update the unique (employee, date) row from the admin's mark / edit form. */
export function markAttendance(input: MarkInput): AttendanceRecord {
  const emp = db.get('employees', input.employeeId)
  if (!emp) throw new Error('Employee not found.')
  if (!input.date) throw new Error('Choose a date.')
  if (input.date > todayISO()) throw new Error('Attendance can be marked only for today or earlier.')
  if (!isEmployedOn(emp, input.date)) throw new Error(`${fullName(emp)} was not on rolls on ${fmtDate(input.date)}.`)
  if (!ATTENDANCE_STATUSES.includes(input.status)) throw new Error('Choose a valid status.')
  if ((input.status === 'present' || input.status === 'half_day') && !input.checkIn) throw new Error('Enter the check-in time for a present or half-day mark.')
  const remarks = input.remarks.trim()
  if (remarks.length > 300) throw new Error('Keep remarks under 300 characters.')

  const existing = recordFor(emp.id, input.date)
  const shift = shiftForDay(emp, existing)
  const p = punchFromTimes(input.date, shift, input.checkIn || null, input.checkOut || null, input.status)
  const fields = {
    shift_id: shift.id,
    check_in: p.check_in,
    check_out: p.check_out,
    status: input.status,
    late_minutes: p.late_minutes,
    early_exit_minutes: p.early_exit_minutes,
    worked_minutes: p.worked_minutes,
    ot_minutes: p.ot_minutes,
    ot_status: otStatusFor(existing, p.ot_minutes),
    source: 'manual' as const,
    remarks,
  }
  const what = `${fullName(emp)} · ${fmtDate(input.date)} → ${statusLabel(input.status)}`
  if (existing) {
    const changes = diff(existing, fields)
    const row = db.update('attendance', existing.id, fields)
    audit('update', 'attendance', row.id, `Edited attendance: ${what}`, changes)
    return row
  }
  const row = db.insert('attendance', { employee_id: emp.id, date: input.date, ...fields, check_in_lat: null, check_in_lng: null, check_in_distance_m: null })
  audit('create', 'attendance', row.id, `Marked attendance: ${what}`)
  return row
}

export function deleteAttendance(rec: AttendanceRecord) {
  const emp = db.get('employees', rec.employee_id)
  db.remove('attendance', rec.id)
  audit('delete', 'attendance', rec.id, `Deleted attendance record of ${fullName(emp)} for ${fmtDate(rec.date)} (${statusLabel(rec.status)}, ${rec.source})`)
}

/* ── regularisations ─────────────────────────────────────────────────────── */

export const REGULARISATION_WINDOW_DAYS = 30

export interface RegularisationInput {
  date: ISODate
  checkIn: string
  checkOut: string
  status: AttendanceStatus
  reason: string
}

export type RegularisationErrors = Partial<Record<'date' | 'checkIn' | 'checkOut' | 'status' | 'reason', string>>

export function validateRegularisation(emp: Employee, input: RegularisationInput, today = todayISO()): RegularisationErrors {
  const e: RegularisationErrors = {}
  const minDate = addDays(today, -REGULARISATION_WINDOW_DAYS)
  if (!input.date) e.date = 'Choose the date to correct.'
  else if (input.date > today) e.date = 'You can’t regularise a future date.'
  else if (input.date < minDate) e.date = `Only the last ${REGULARISATION_WINDOW_DAYS} days can be regularised — please contact HR.`
  else if (!isEmployedOn(emp, input.date)) e.date = 'You were not on rolls on this date.'
  else if (db.find('regularisations', (r) => r.employee_id === emp.id && r.date === input.date && r.status === 'pending'))
    e.date = 'You already have a pending request for this date.'
  if (!ATTENDANCE_STATUSES.includes(input.status)) e.status = 'Choose the correct status.'
  if (input.checkIn && !isHHMM(input.checkIn)) e.checkIn = 'Use a time like 09:05.'
  if (input.checkOut && !isHHMM(input.checkOut)) e.checkOut = 'Use a time like 17:30.'
  const existing = input.date ? recordFor(emp.id, input.date) : undefined
  if (input.status !== 'absent' && input.status !== 'on_duty' && !input.checkIn && !existing?.check_in) e.checkIn = 'Enter your check-in time.'
  if (input.status !== 'absent' && input.status !== 'on_duty' && !input.checkIn && !input.checkOut) e.checkIn ??= 'Enter the corrected check-in and/or check-out time.'
  const effectiveIn = input.checkIn || hhmmOf(existing?.check_in)
  if (isHHMM(effectiveIn) && isHHMM(input.checkOut) && input.checkOut < effectiveIn) {
    const shift = db.get('shifts', existing?.shift_id ?? emp.shift_id)
    if (!shift || !isNightShift(shift)) e.checkOut = input.checkIn ? 'Check-out must be after check-in.' : `Check-out must be after your recorded check-in (${fmtHHMM(effectiveIn)}).`
  }
  const reason = input.reason.trim()
  if (reason.length < 5) e.reason = 'Explain what happened (at least 5 characters).'
  else if (reason.length > 500) e.reason = 'Keep it under 500 characters.'
  return e
}

export function requestRegularisation(emp: Employee, input: RegularisationInput): Regularisation {
  const errors = validateRegularisation(emp, input)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const row = db.insert('regularisations', {
    employee_id: emp.id,
    date: input.date,
    requested_check_in: input.checkIn || null,
    requested_check_out: input.checkOut || null,
    requested_status: input.status,
    reason: input.reason.trim(),
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    review_note: '',
  })
  audit('create', 'regularisations', row.id, `Requested attendance correction for ${fmtDate(input.date)} (${statusLabel(input.status)})`)
  return row
}

export function withdrawRegularisation(reg: Regularisation) {
  if (reg.status !== 'pending') throw new Error('Only a pending request can be withdrawn.')
  db.remove('regularisations', reg.id)
  audit('delete', 'regularisations', reg.id, `Withdrew attendance correction request for ${fmtDate(reg.date)}`)
}

/** What approving a request will write (for the confirmation message). */
export function describeRegularisation(reg: Regularisation): string {
  const existing = recordFor(reg.employee_id, reg.date)
  const inT = reg.requested_check_in ?? (hhmmOf(existing?.check_in) || null)
  const outT = reg.requested_check_out ?? (hhmmOf(existing?.check_out) || null)
  const times = inT ? `${fmtHHMM(inT)}${outT ? ` – ${fmtHHMM(outT)}` : ' (no check-out)'}` : 'no punch times'
  return `${statusLabel(reg.requested_status)}, ${times}`
}

/**
 * Approve: create or update that day's attendance row from the requested times (missing side taken from
 * the existing punch), recompute with computePunch, mark it 'regularised', then close the request.
 */
export function approveRegularisation(reg: Regularisation, note = ''): AttendanceRecord {
  if (reg.status !== 'pending') throw new Error('This request has already been decided.')
  const emp = db.get('employees', reg.employee_id)
  if (!emp) throw new Error('Employee not found.')
  const own = selfApprovalBlock(emp.id)
  if (own) throw new Error(own)
  if (reg.date > todayISO()) throw new Error('This request is for a future date.')
  const existing = recordFor(emp.id, reg.date)
  const shift = shiftForDay(emp, existing)
  const inT = reg.requested_check_in ?? (hhmmOf(existing?.check_in) || null)
  const outT = reg.requested_check_out ?? (hhmmOf(existing?.check_out) || null)
  if (!inT && outT) throw new Error('The request has only a check-out time and there is no check-in for that day — reject it or mark the day manually.')
  const p = punchFromTimes(reg.date, shift, inT, outT, reg.requested_status)
  const fields = {
    shift_id: shift.id,
    check_in: p.check_in,
    check_out: p.check_out,
    status: reg.requested_status,
    late_minutes: p.late_minutes,
    early_exit_minutes: p.early_exit_minutes,
    worked_minutes: p.worked_minutes,
    ot_minutes: p.ot_minutes,
    ot_status: otStatusFor(existing, p.ot_minutes),
    source: 'regularised' as const,
    remarks: `Regularised: ${reg.reason}`.slice(0, 300),
  }
  const s = currentSession()
  const now = new Date().toISOString()
  const name = fullName(emp)
  return db.batch(() => {
    let row: AttendanceRecord
    if (existing) {
      const changes = diff(existing, fields)
      row = db.update('attendance', existing.id, fields)
      audit('update', 'attendance', row.id, `Regularised attendance of ${name} for ${fmtDate(reg.date)}`, changes)
    } else {
      row = db.insert('attendance', { employee_id: emp.id, date: reg.date, ...fields, check_in_lat: null, check_in_lng: null, check_in_distance_m: null })
      audit('create', 'attendance', row.id, `Regularised attendance of ${name} for ${fmtDate(reg.date)}`)
    }
    db.update('regularisations', reg.id, { status: 'approved', reviewed_by: s?.user.id ?? null, reviewed_at: now, review_note: note.trim() })
    audit('approve', 'regularisations', reg.id, `Approved attendance correction of ${name} for ${fmtDate(reg.date)} (${describeRegularisation(reg)})`)
    return row
  })
}

export function rejectRegularisation(reg: Regularisation, note: string) {
  if (reg.status !== 'pending') throw new Error('This request has already been decided.')
  const why = note.trim()
  if (!why) throw new Error('Give a reason for rejecting.')
  const emp = db.get('employees', reg.employee_id)
  db.update('regularisations', reg.id, { status: 'rejected', reviewed_by: currentSession()?.user.id ?? null, reviewed_at: new Date().toISOString(), review_note: why })
  audit('reject', 'regularisations', reg.id, `Rejected attendance correction of ${fullName(emp)} for ${fmtDate(reg.date)}: ${why}`)
}

/* ── overtime ────────────────────────────────────────────────────────────── */

/** Approve / reject pending OT. Approved minutes flow into payroll through summariseMonth. */
export function decideOvertime(records: AttendanceRecord[], decision: 'approved' | 'rejected'): number {
  const pending = records.filter((r) => r.ot_status === 'pending' && r.ot_minutes > 0)
  if (!pending.length) throw new Error('Nothing pending to decide.')
  const own = pending.map((r) => selfApprovalBlock(r.employee_id)).find(Boolean)
  if (own) throw new Error(own)
  db.batch(() => {
    for (const r of pending) {
      const emp = db.get('employees', r.employee_id)
      db.update('attendance', r.id, { ot_status: decision })
      audit(decision === 'approved' ? 'approve' : 'reject', 'attendance', r.id, `${decision === 'approved' ? 'Approved' : 'Rejected'} ${(r.ot_minutes / 60).toFixed(2)} h OT of ${fullName(emp)} on ${fmtDate(r.date)}`, {
        ot_status: { from: 'pending', to: decision },
      })
    }
  })
  return pending.length
}

/* ── shifts ──────────────────────────────────────────────────────────────── */

export type ShiftInput = Omit<NewRow<'shifts'>, 'id' | 'created_at' | 'updated_at'>
export type ShiftErrors = Partial<Record<keyof ShiftInput, string>>

export function validateShift(input: ShiftInput, id?: string): ShiftErrors {
  const e: ShiftErrors = {}
  const code = input.code.trim().toUpperCase()
  if (!code) e.code = 'Enter a short code, e.g. GEN.'
  else if (!/^[A-Z0-9_-]{2,12}$/.test(code)) e.code = '2–12 letters, digits, - or _.'
  else if (db.find('shifts', (s) => s.code.toUpperCase() === code && s.id !== id)) e.code = `Shift ${code} already exists.`
  if (input.name.trim().length < 3) e.name = 'Enter the shift name.'
  if (!isHHMM(input.start_time)) e.start_time = 'Use HH:MM.'
  if (!isHHMM(input.end_time)) e.end_time = 'Use HH:MM.'
  else if (input.end_time === input.start_time) e.end_time = 'End must differ from start.'
  const int = (n: number) => Number.isInteger(n)
  if (!int(input.break_minutes) || input.break_minutes < 0 || input.break_minutes > 240) e.break_minutes = '0–240 minutes.'
  if (!int(input.grace_minutes) || input.grace_minutes < 0 || input.grace_minutes > 120) e.grace_minutes = '0–120 minutes.'
  if (!int(input.half_day_minutes) || input.half_day_minutes <= 0) e.half_day_minutes = 'Must be more than 0.'
  if (!int(input.full_day_minutes) || input.full_day_minutes <= 0) e.full_day_minutes = 'Must be more than 0.'
  else if (input.half_day_minutes >= input.full_day_minutes) e.half_day_minutes = 'Must be less than the full-day minutes.'
  if (isHHMM(input.start_time) && isHHMM(input.end_time) && !e.full_day_minutes) {
    let span = hhmmToMinutes(input.end_time) - hhmmToMinutes(input.start_time)
    if (span <= 0) span += 1440
    if (input.full_day_minutes > span) e.full_day_minutes = `Can’t exceed the shift span (${span} min).`
  }
  if (input.weekly_offs.some((d) => !int(d) || d < 0 || d > 6)) e.weekly_offs = 'Invalid weekday.'
  else if (input.weekly_offs.length > 3) e.weekly_offs = 'At most 3 weekly offs.'
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) e.color = 'Pick a colour.'
  return e
}

export function saveShift(input: ShiftInput, existing?: Shift): Shift {
  const errors = validateShift(input, existing?.id)
  const first = Object.values(errors)[0]
  if (first) throw new Error(first)
  const clean: ShiftInput = { ...input, code: input.code.trim().toUpperCase(), name: input.name.trim(), weekly_offs: [...new Set(input.weekly_offs)].sort() }
  if (existing) {
    if (!clean.active && db.count('employees', (e) => e.shift_id === existing.id && e.status !== 'exited'))
      throw new Error('Employees are still on this shift — move them before deactivating it.')
    const changes = diff(existing, clean)
    const row = db.update('shifts', existing.id, clean)
    audit('update', 'shifts', row.id, `Updated shift ${row.code} (${row.name})`, changes)
    return row
  }
  const row = db.insert('shifts', clean)
  audit('create', 'shifts', row.id, `Created shift ${row.code} (${row.name}, ${row.start_time}–${row.end_time})`)
  return row
}

export function deleteShift(shift: Shift) {
  const assigned = db.count('employees', (e) => e.shift_id === shift.id)
  if (assigned) throw new Error(`${assigned} employee${assigned === 1 ? ' is' : 's are'} assigned to ${shift.code} — reassign them first.`)
  if (db.find('attendance', (a) => a.shift_id === shift.id)) throw new Error(`${shift.code} has attendance history — deactivate it instead of deleting.`)
  db.remove('shifts', shift.id)
  audit('delete', 'shifts', shift.id, `Deleted shift ${shift.code} (${shift.name})`)
}

/* ── older data (Supabase loads a rolling window of attendance) ──────────── */

const fetchedRanges = new Set<string>()

export function earliestAttendanceDate(): ISODate | null {
  let min: ISODate | null = null
  for (const a of db.all('attendance')) if (!min || a.date < min) min = a.date
  return min
}

/** True when the backend can fetch older rows and `from` is before what is in memory. */
export function needsAttendanceRange(from: ISODate, to: ISODate): boolean {
  if (!db.backend?.loadRange || fetchedRanges.has(`${from}|${to}`)) return false
  const earliest = earliestAttendanceDate()
  return !earliest || from < earliest
}

/** Fetch an older slice of attendance into the store (no-op when already loaded). */
export async function ensureAttendanceRange(from: ISODate, to: ISODate): Promise<number> {
  const backend = db.backend
  if (!backend?.loadRange || !needsAttendanceRange(from, to)) return 0
  const rows = await backend.loadRange('attendance', 'date', from, to)
  db.batch(() => rows.forEach((r) => db.ingest('attendance', r)))
  fetchedRanges.add(`${from}|${to}`)
  return rows.length
}
