/**
 * Demo data generator — used by static mode (IndexedDB) and by scripts/seed-supabase.ts.
 *
 * Everything is generated relative to "now", so the demo always shows the current financial
 * year: attendance from 1 April to today, paid payroll for every completed month (computed by
 * the real payroll engine from that attendance), live petty cash, tasks, maintenance and more.
 * Randomness is seeded per employee/day, so the same day always produces the same punches.
 */
import type { AnyRow, BackendMeta, TableSnapshot } from '../backend'
import type {
  Advance, AppUser, Employee, Holiday, InventoryItem, LeaveRequest, LeaveType, Machine, NewRow, Payslip, PurchaseOrder,
  Row, SalaryStructure, Shift, TableName, Vendor, WorkCentre, WorkOrder, Customer,
} from '../types'
import { COMPANY } from '@/config/company'
import { DEMO_CREDENTIALS, DEMO_DEFAULT_EMPLOYEE_PASSWORD } from '@/config/demoCredentials'
import { buildAttendanceContext, summariseMonth } from '@/lib/attendance'
import {
  addDays, addMonths, combine, dayOfWeek, eachDay, fyLabel, fyOf, fyRange, monthEnd, monthOf, monthStart, toISODate,
} from '@/lib/dates'
import { hashString, seededRandom, uuid } from '@/lib/ids'
import { countLeaveDays, proratedQuota } from '@/lib/leaves'
import { sha256 } from '@/lib/misc'
import { DEFAULT_PAYROLL_CONFIG, annualCtc, computePayslip, emiDue, structureFromGross } from '@/lib/payroll'
import {
  BANKS, DEMO_EMPLOYEE_CODE, DEPARTMENTS, DESIGNATIONS, FIRST_NAMES_FAMILY, HOLIDAYS, LOCALITIES, PETTY_CATEGORIES,
  RELATIONS_MARRIED, RELATIONS_SINGLE, ROLES, ROSTER, WORK_CENTRES,
} from './roster'
import { simulateDay } from './simulate'
import { seedOperations } from './operations'

export const SEED_VERSION = 3

export class SeedBuilder {
  tables: TableSnapshot = {}
  constructor(public nowIso: string) {}
  add<T extends TableName>(table: T, row: NewRow<T>, at?: string): Row<T> {
    const ts = at ?? row.created_at ?? this.nowIso
    const full = { ...row, id: row.id ?? uuid(), created_at: row.created_at ?? ts, updated_at: row.updated_at ?? ts } as unknown as AnyRow
    const list = (this.tables[table as TableName] ??= []) as AnyRow[]
    list.push(full)
    return full as unknown as Row<T>
  }
  all<T extends TableName>(table: T): Row<T>[] {
    return (this.tables[table] ?? []) as unknown as Row<T>[]
  }
}

const at = (date: string, time = '10:00') => combine(date, time).toISOString()

export async function generateSeed(now = new Date()): Promise<{ tables: TableSnapshot; meta: BackendMeta }> {
  const today = toISODate(now)
  const nowIso = now.toISOString()
  const fy = fyOf(today)
  const { from: fyStart } = fyRange(fy)
  const b = new SeedBuilder(nowIso)

  /* ── company ─────────────────────────────────────────────────────────── */
  const settings = b.add('company_settings', {
    legal_name: COMPANY.legal_name,
    short_name: COMPANY.short_name,
    cin: COMPANY.cin,
    incorporated_on: COMPANY.incorporated_on,
    roc: COMPANY.roc,
    company_type: COMPANY.company_type,
    company_category: COMPANY.company_category,
    listing_status: COMPANY.listing_status,
    status: COMPANY.status,
    authorised_capital: COMPANY.authorised_capital,
    paid_up_capital: COMPANY.paid_up_capital,
    sectors: [...COMPANY.sectors],
    business_activity: COMPANY.business_activity,
    registered_office: COMPANY.registered_office,
    plant_address: COMPANY.plant_address,
    plant_lat: COMPANY.plant_lat,
    plant_lng: COMPANY.plant_lng,
    plus_code: COMPANY.plus_code,
    phone: '',
    email: '',
    website: COMPANY.website,
    gstin: '',
    pan: '',
    tan: '',
    pf_establishment_code: '',
    esi_employer_code: '',
    pt_registration_no: '',
    financial_year_start_month: 4,
    working_days: [1, 2, 3, 4, 5, 6],
    plant_open: '09:00',
    plant_close: '17:00',
    payroll: DEFAULT_PAYROLL_CONFIG,
    attendance: { late_marks_per_half_day: 3, min_ot_minutes: 30, geofence_radius_m: 300, auto_absent_after: '11:00', allow_web_checkin: true },
    petty_cash_imprest: 25000,
    petty_cash_low_alert: 6000,
    petty_cash_approval_limit: 5000,
    petty_cash_categories: PETTY_CATEGORIES,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    demo_autopilot: true,
    demo_autopilot_through: today,
  }, at('2011-10-04'))
  const policy = settings.attendance
  const cfg = settings.payroll

  for (const d of COMPANY.directors) b.add('directors', { ...d, other_directorships: [...d.other_directorships] })

  /* ── roles / org structure ───────────────────────────────────────────── */
  const roles = Object.fromEntries(ROLES.map((r) => [r.key, b.add('roles', { ...r, is_system: true })]))
  const depts = Object.fromEntries(DEPARTMENTS.map((d) => [d.code, b.add('departments', { ...d, head_employee_id: null })]))
  const desigs = Object.fromEntries(
    DESIGNATIONS.map(([title, dept, grade]) => [title, b.add('designations', { title, department_id: depts[dept]!.id, grade, description: '' })]),
  )
  const shifts: Record<string, Shift> = {
    GEN: b.add('shifts', { code: 'GEN', name: 'General Shift', start_time: '09:00', end_time: '17:00', break_minutes: 30, grace_minutes: 10, half_day_minutes: 240, full_day_minutes: 450, weekly_offs: [0], color: '#6366f1', active: true }),
    EARLY: b.add('shifts', { code: 'EARLY', name: 'Early Shift (Maintenance)', start_time: '08:00', end_time: '16:00', break_minutes: 30, grace_minutes: 10, half_day_minutes: 240, full_day_minutes: 450, weekly_offs: [0], color: '#f97316', active: true }),
  }
  b.add('shifts', { code: 'SECOND', name: 'Second Shift (planned)', start_time: '17:00', end_time: '01:00', break_minutes: 30, grace_minutes: 10, half_day_minutes: 240, full_day_minutes: 450, weekly_offs: [0], color: '#ec4899', active: false })
  const wcs: Record<string, WorkCentre> = Object.fromEntries(WORK_CENTRES.map((w) => [w.code, b.add('work_centres', { ...w, supervisor_id: null })]))

  /* ── employees ───────────────────────────────────────────────────────── */
  const byCode: Record<string, Employee> = {}
  ROSTER.forEach((e, i) => {
    const r = seededRandom(hashString(e.code))
    const [city, pin] = LOCALITIES[i % LOCALITIES.length]!
    const [bank, ifsc] = BANKS[i % BANKS.length]!
    const local = `${e.first.toLowerCase()}.${e.last.toLowerCase().split(' ')[0]}`.replace(/[^a-z.]/g, '')
    const emp = b.add('employees', {
      emp_code: e.code,
      first_name: e.first,
      last_name: e.last,
      gender: e.gender,
      dob: e.dob,
      phone: `+91 9${r.int(100000000, 999999999)}`.replace(/(\d{5})(\d{5})$/, '$1 $2'),
      email: e.code === DEMO_EMPLOYEE_CODE ? DEMO_CREDENTIALS.employee.email : `${local}@melstarmanufacturing.in`,
      personal_email: `${local}${r.int(10, 99)}@gmail.com`,
      address: `#${r.int(12, 480)}, ${r.pick(['2nd Cross', '4th Main', '1st Cross', 'Temple Road', 'KHB Colony', 'Ward No. 7', 'Railway Station Road'])}, ${city}`,
      city: e.city ?? (city.includes(',') ? city.split(',')[1]!.trim() : city),
      state: 'Karnataka',
      pincode: pin,
      department_id: depts[e.dept]!.id,
      designation_id: desigs[e.desig]!.id,
      reporting_to: null,
      employment_type: e.type,
      date_of_joining: e.doj,
      date_of_exit: e.exit?.date ?? (e.notice ? addDays(today, 30) : null),
      exit_reason: e.exit?.reason ?? (e.notice ? 'Resigned — pursuing higher studies (serving notice)' : ''),
      status: e.exit ? 'exited' : e.notice ? 'on_notice' : 'active',
      shift_id: shifts[e.shift]!.id,
      work_centre_id: e.wc ? wcs[e.wc]!.id : null,
      blood_group: e.blood,
      marital_status: e.married ? 'married' : 'single',
      pan: `${'ABCDEFGHJKLMNPQRSTUVWXYZ'[r.int(0, 23)]}${'ABCDEFGHJKLMNPQRSTUVWXYZ'[r.int(0, 23)]}${'ABCDEFGHJKLMNPQRSTUVWXYZ'[r.int(0, 23)]}P${e.last[0]!.toUpperCase()}${r.int(1000, 9999)}${'ABCDEFGHJKLMNPQRSTUVWXYZ'[r.int(0, 23)]}`,
      aadhaar_masked: `XXXX-XXXX-${r.int(1000, 9999)}`,
      uan: `10${r.int(10000000, 99999999)}${r.int(10, 99)}`,
      esic_no: e.gross <= 21000 ? `53${r.int(10000000, 99999999)}` : '',
      bank_name: bank,
      bank_account: `${r.int(10000000, 99999999)}${r.int(1000, 9999)}`,
      ifsc,
      photo: null,
      skills: e.skills,
      tax_regime: e.regime ?? 'new',
      declared_deductions: e.declared ?? 0,
      notes: '',
    }, at(e.doj))
    byCode[e.code] = emp
  })
  // reporting lines, department heads, work-centre supervisors
  for (const e of ROSTER) {
    if (e.reports) Object.assign(byCode[e.code]!, { reporting_to: byCode[e.reports]!.id })
  }
  const heads: Record<string, string> = { MGT: 'MMS-1001', ENG: 'MMS-1002', PPC: 'MMS-1004', MCH: 'MMS-1005', FAB: 'MMS-1013', ASM: 'MMS-1018', QA: 'MMS-1022', MNT: 'MMS-1025', SCM: 'MMS-1028', HRA: 'MMS-1030', ACC: 'MMS-1032' }
  for (const [code, emp] of Object.entries(heads)) Object.assign(depts[code]!, { head_employee_id: byCode[emp]!.id })
  const wcSup: Record<string, string> = { CNC: 'MMS-1005', VMC: 'MMS-1010', PRB: 'MMS-1013', WLD: 'MMS-1013', SAL: 'MMS-1018', QAI: 'MMS-1022' }
  for (const [code, emp] of Object.entries(wcSup)) Object.assign(wcs[code]!, { supervisor_id: byCode[emp]!.id })

  const employees = Object.values(byCode)
  const demoEmp = byCode[DEMO_EMPLOYEE_CODE]!

  // emergency contacts + documents
  for (const [i, e] of ROSTER.entries()) {
    const emp = byCode[e.code]!
    const r = seededRandom(hashString(e.code + 'ec'))
    const rel = r.pick(e.married ? RELATIONS_MARRIED : RELATIONS_SINGLE)
    b.add('emergency_contacts', { employee_id: emp.id, name: `${FIRST_NAMES_FAMILY[i % FIRST_NAMES_FAMILY.length]} ${e.last.split(' ')[0]}`, relation: rel, phone: `+91 9${r.int(1000, 9999)} ${r.int(10000, 99999)}`, address: emp.address, is_primary: true })
    if (r.chance(0.5)) b.add('emergency_contacts', { employee_id: emp.id, name: `${FIRST_NAMES_FAMILY[(i + 5) % FIRST_NAMES_FAMILY.length]} ${e.last.split(' ')[0]}`, relation: rel === 'Father' ? 'Brother' : 'Father', phone: `+91 8${r.int(1000, 9999)} ${r.int(10000, 99999)}`, address: '', is_primary: false })
    const docs: [string, string][] = [['aadhaar', 'Aadhaar card (masked)'], ['pan', 'PAN card'], ['appointment_letter', 'Appointment letter'], ['bank_proof', 'Cancelled cheque']]
    if (e.type === 'apprentice') docs.push(['training', 'NAPS apprenticeship contract'])
    if (['QA', 'ENG'].includes(e.dept)) docs.push(['education', 'Diploma / degree certificate'])
    for (const [type, title] of docs) {
      b.add('employee_documents', {
        employee_id: emp.id, doc_type: type as never, title, file_name: `${e.code}_${type}.pdf`, file_type: 'application/pdf',
        file_size: r.int(80, 900) * 1024, file_data: null, expiry_date: type === 'training' ? addDays(e.doj, 365) : null,
        verified: r.chance(0.85), uploaded_by: null,
      }, at(e.doj, '15:00'))
    }
  }

  /* ── salary structures ───────────────────────────────────────────────── */
  const structures = new Map<string, SalaryStructure>()
  for (const e of ROSTER) {
    const emp = byCode[e.code]!
    const parts = structureFromGross(e.gross)
    const isTrainee = e.type === 'trainee' || e.type === 'apprentice'
    const s = {
      employee_id: emp.id,
      effective_from: e.doj > fyStart ? e.doj : fyStart,
      ctc_annual: 0,
      ...parts,
      pf_applicable: e.type !== 'apprentice',
      esi_applicable: e.gross <= cfg.esi_wage_threshold,
      pt_applicable: true,
      ot_eligible: ['MCH', 'FAB', 'ASM', 'QA', 'MNT', 'SCM'].includes(e.dept) && e.gross < 40000 && !isTrainee,
      ot_rate_per_hour: null,
      notes: e.code === DEMO_EMPLOYEE_CODE ? 'Annual revision FY 2026-27 — 8% increment' : '',
    } as NewRow<'salary_structures'>
    const row = b.add('salary_structures', s, at(s.effective_from))
    Object.assign(row, { ctc_annual: annualCtc(row, cfg) })
    structures.set(emp.id, row)
  }

  /* ── holidays, leave types & balances ────────────────────────────────── */
  const holidays: Holiday[] = HOLIDAYS.map(([date, name, type, description]) => b.add('holidays', { date, name, type, description }))
  const plantHolidays = new Set(holidays.filter((h) => h.type !== 'optional').map((h) => h.date))
  const lt: Record<string, LeaveType> = {}
  const LT: [string, string, number, boolean, boolean, number, boolean, number, 'female' | null, string][] = [
    ['CL', 'Casual Leave', 10, true, false, 0, true, 0, null, '#06b6d4'],
    ['SL', 'Sick Leave', 10, true, false, 0, true, 2, null, '#ec4899'],
    ['EL', 'Earned Leave', 15, true, true, 30, false, 0, null, '#6366f1'],
    ['CO', 'Compensatory Off', 0, true, false, 0, true, 0, null, '#10b981'],
    ['ML', 'Maternity Leave', 182, true, false, 0, false, 1, 'female', '#a855f7'],
    ['LOP', 'Leave Without Pay', 0, false, false, 0, true, 0, null, '#94a3b8'],
  ]
  for (const [code, name, quota, paid, cf, maxCf, half, doc, gender, color] of LT) {
    lt[code] = b.add('leave_types', { code, name, annual_quota: quota, paid, carry_forward: cf, max_carry_forward: maxCf, allow_half_day: half, document_after_days: doc, gender, color, active: true })
  }

  /* ── app users ───────────────────────────────────────────────────────── */
  const users: Record<string, AppUser> = {}
  const mkUser = async (email: string, name: string, role: string, empId: string | null, password: string) => {
    const salt = uuid().slice(0, 8)
    users[email] = b.add('app_users', {
      email, display_name: name, role_id: roles[role]!.id, employee_id: empId, password_hash: await sha256(salt + password), password_salt: salt,
      active: true, last_login_at: null, auth_user_id: null,
    })
    return users[email]!
  }
  const admin = await mkUser(DEMO_CREDENTIALS.admin.email, DEMO_CREDENTIALS.admin.displayName, 'super_admin', null, DEMO_CREDENTIALS.admin.password)
  const raviUser = await mkUser(DEMO_CREDENTIALS.employee.email, DEMO_CREDENTIALS.employee.displayName, 'employee', demoEmp.id, DEMO_CREDENTIALS.employee.password)
  const extra: [string, string][] = [['MMS-1030', 'hr_manager'], ['MMS-1032', 'accounts'], ['MMS-1013', 'supervisor'], ['MMS-1001', 'super_admin']]
  for (const [code, role] of extra) {
    const e = byCode[code]!
    await mkUser(e.email, `${e.first_name} ${e.last_name}`, role, e.id, DEMO_DEFAULT_EMPLOYEE_PASSWORD)
  }
  const hrUser = users[byCode['MMS-1030']!.email]!

  /* ── leave requests (before attendance, so punches skip leave days) ──── */
  const leaveRequests: LeaveRequest[] = []
  const shiftOf = (e: Employee) => (e.shift_id === shifts.EARLY!.id ? shifts.EARLY! : shifts.GEN!)
  const isWorking = (e: Employee, d: string) => !plantHolidays.has(d) && !shiftOf(e).weekly_offs.includes(dayOfWeek(d))
  const addLeave = (e: Employee, code: string, from: string, to: string, status: LeaveRequest['status'], reason: string, half = false, appliedDaysBefore = 3) => {
    const days = countLeaveDays(from, to, { halfDay: half, weeklyOffs: shiftOf(e).weekly_offs, holidays: plantHolidays })
    if (!days) return
    const appliedAt = at(addDays(from, -appliedDaysBefore), '11:20')
    const req = b.add('leave_requests', {
      employee_id: e.id, leave_type_id: lt[code]!.id, from_date: from, to_date: to, half_day: half, half_day_session: half ? 'second' : null, days, reason, status,
      applied_at: appliedAt, reviewed_by: status === 'pending' ? null : hrUser.id, reviewed_at: status === 'pending' ? null : at(addDays(from, -appliedDaysBefore + 1), '10:05'),
      review_note: status === 'rejected' ? 'Peak dispatch week — please reschedule' : status === 'approved' ? 'Approved' : '', attachment: null,
    }, appliedAt)
    leaveRequests.push(req)
  }
  const reasons: Record<string, string[]> = {
    CL: ['Family function', 'Personal work at bank', 'House shifting', 'Child’s school event', 'Village festival', 'Attending a wedding'],
    SL: ['Fever and cold', 'Viral fever', 'Back pain — doctor advised rest', 'Stomach infection', 'Dental treatment'],
    EL: ['Family trip to Dharmasthala', 'Native place visit', 'Sister’s wedding', 'Annual vacation'],
  }
  for (const e of employees) {
    if (e.emp_code === DEMO_EMPLOYEE_CODE) continue
    const r = seededRandom(hashString(e.emp_code + 'leave'))
    const start = e.date_of_joining > fyStart ? e.date_of_joining : fyStart
    const end = e.date_of_exit && e.date_of_exit < today ? e.date_of_exit : addDays(today, -1)
    const span = eachDay(start, end).filter((d) => isWorking(e, d))
    const used = new Set<string>()
    const n = r.int(2, 5)
    for (let k = 0; k < n && span.length > 10; k++) {
      const code = r.chance(0.55) ? 'CL' : r.chance(0.65) ? 'SL' : 'EL'
      const len = code === 'CL' ? 1 : code === 'SL' ? r.int(1, 2) : r.int(2, 4)
      const from = span[r.int(0, span.length - 1)]!
      const to = addDays(from, len - 1 + (code === 'EL' ? 1 : 0))
      if (eachDay(from, to).some((d) => used.has(d))) continue
      eachDay(from, to).forEach((d) => used.add(d))
      const half = code === 'CL' && r.chance(0.2)
      addLeave(e, code, from, half ? from : to, r.chance(0.94) ? 'approved' : 'rejected', r.pick(reasons[code]!), half, code === 'SL' ? 0 : r.int(2, 9))
    }
  }
  // Ravi (demo employee): approved history + one pending request the admin can action
  addLeave(demoEmp, 'CL', '2026-06-12', '2026-06-12', 'approved', 'Daughter’s school admission', false, 4)
  addLeave(demoEmp, 'SL', '2026-08-04', '2026-08-05', 'approved', 'Viral fever', false, 0)
  addLeave(demoEmp, 'CL', '2026-09-26', '2026-09-26', 'rejected', 'Personal work', false, 2)
  const nextWorking = (e: Employee, from: string, skip = 0) => {
    let d = from
    let s = skip
    for (;;) {
      d = addDays(d, 1)
      if (isWorking(e, d) && s-- <= 0) return d
    }
  }
  addLeave(demoEmp, 'CL', nextWorking(demoEmp, today, 8), nextWorking(demoEmp, today, 8), 'pending', 'Family function at Tumakuru', false, 0)
  // other upcoming requests to approve
  const pend: [string, string, number, number, string][] = [
    ['MMS-1014', 'EL', 3, 3, 'Native place visit for Deepavali'], ['MMS-1024', 'CL', 2, 1, 'Personal work'],
    ['MMS-1019', 'SL', 0, 1, 'Fever since last night'], ['MMS-1003', 'EL', 12, 4, 'Family trip'],
  ]
  for (const [code, t, skip, len, why] of pend) {
    const e = byCode[code]!
    const from = t === 'SL' ? today : nextWorking(e, today, skip)
    addLeave(e, t, from, addDays(from, len - 1), 'pending', why, false, t === 'SL' ? 0 : 1)
  }
  addLeave(byCode['MMS-1016']!, 'CL', nextWorking(byCode['MMS-1016']!, today, 4), nextWorking(byCode['MMS-1016']!, today, 4), 'approved', 'Bank loan documentation', false, 2)
  // Fix "applied_at" for requests created today so they aren't in the future
  for (const l of leaveRequests) if (l.applied_at > nowIso) Object.assign(l, { applied_at: nowIso, created_at: nowIso, updated_at: nowIso })

  // balances
  for (const e of employees) {
    const r = seededRandom(hashString(e.emp_code + 'bal'))
    for (const t of Object.values(lt)) {
      if (t.gender && t.gender !== e.gender) continue
      if (t.code === 'LOP' || t.code === 'ML') continue
      const opening = t.carry_forward && e.date_of_joining < fyStart ? r.int(0, 14) : 0
      const adjustment = t.code === 'CO' ? (r.chance(0.25) ? 1 : 0) : 0
      b.add('leave_balances', { employee_id: e.id, leave_type_id: t.id, year: fy, opening, allotted: proratedQuota(t.annual_quota, e.date_of_joining, fy), adjustment })
    }
  }

  /* ── attendance ──────────────────────────────────────────────────────── */
  const curMonth = monthOf(today)
  for (const e of employees) {
    const start = e.date_of_joining > fyStart ? e.date_of_joining : fyStart
    const end = e.date_of_exit && e.date_of_exit < today ? e.date_of_exit : today
    const myLeaves = leaveRequests.filter((l) => l.employee_id === e.id && l.status === 'approved')
    const s = structures.get(e.id)!
    for (const d of eachDay(start, end)) {
      if (!isWorking(e, d)) continue
      const leave = myLeaves.find((l) => l.from_date <= d && l.to_date >= d)
      if (leave && !leave.half_day) continue
      const isToday = d === today
      if (isToday && e.id === demoEmp.id) continue // leave today's check-in for the demo
      const recent = d >= addDays(today, -4) && monthOf(d) === curMonth
      const rec = simulateDay(e, d, shiftOf(e), policy, { cutoff: isToday ? now : undefined, halfDay: !!leave?.half_day, otStatus: recent ? 'pending' : 'approved', otEligible: s.ot_eligible })
      if (rec) b.add('attendance', rec)
    }
  }
  // a couple of regularisation requests
  const att = b.all('attendance')
  const lateOne = att.filter((a) => a.employee_id === byCode['MMS-1011']!.id && a.late_minutes > 0 && a.date < today).pop()
  if (lateOne) b.add('regularisations', { employee_id: lateOne.employee_id, date: lateOne.date, requested_check_in: '09:00', requested_check_out: null, requested_status: 'present', reason: 'Biometric did not read my thumb at 8:55; security can confirm', status: 'pending', reviewed_by: null, reviewed_at: null, review_note: '' }, at(addDays(lateOne.date, 1), '09:40'))
  const missDay = eachDay(addDays(today, -12), addDays(today, -2)).find((d) => isWorking(byCode['MMS-1020']!, d) && !att.some((a) => a.employee_id === byCode['MMS-1020']!.id && a.date === d))
  if (missDay) b.add('regularisations', { employee_id: byCode['MMS-1020']!.id, date: missDay, requested_check_in: '08:56', requested_check_out: '17:05', requested_status: 'present', reason: 'Was on customer-site visit to Vajra Hydraulics with Harish sir', status: 'pending', reviewed_by: null, reviewed_at: null, review_note: '' }, at(addDays(missDay, 1), '10:15'))
  const raviOld = att.filter((a) => a.employee_id === demoEmp.id && a.late_minutes > 0).slice(-1)[0]
  if (raviOld) b.add('regularisations', { employee_id: demoEmp.id, date: raviOld.date, requested_check_in: '09:02', requested_check_out: null, requested_status: 'present', reason: 'Stopped at Vajra Hydraulics gate for sample handover on the way', status: 'approved', reviewed_by: hrUser.id, reviewed_at: at(addDays(raviOld.date, 1), '12:00'), review_note: 'Verified with plant head' }, at(addDays(raviOld.date, 1), '09:20'))

  /* ── advances & loans ────────────────────────────────────────────────── */
  const advances: Advance[] = []
  const adv = (code: string, a: Omit<NewRow<'advances'>, 'employee_id'>) => advances.push(b.add('advances', { employee_id: byCode[code]!.id, ...a }, at(a.requested_on)))
  adv('MMS-1005', { type: 'salary_advance', amount: 12000, reason: 'Two-wheeler repair', requested_on: '2026-04-10', status: 'active', installments: 3, emi_amount: 4000, start_month: '2026-05', approved_by: admin.id, approved_at: at('2026-04-11'), disbursed_on: '2026-04-11', review_note: 'Approved — recover in 3 months' })
  adv('MMS-1007', { type: 'salary_advance', amount: 10000, reason: 'Child’s school fees', requested_on: '2026-06-20', status: 'active', installments: 2, emi_amount: 5000, start_month: '2026-07', approved_by: admin.id, approved_at: at('2026-06-21'), disbursed_on: '2026-06-22', review_note: '' })
  adv('MMS-1014', { type: 'loan', amount: 60000, reason: 'Mother’s surgery at Doddaballapura General Hospital', requested_on: '2026-05-25', status: 'active', installments: 12, emi_amount: 5000, start_month: '2026-06', approved_by: admin.id, approved_at: at('2026-05-26'), disbursed_on: '2026-05-27', review_note: 'Interest-free staff welfare loan' })
  adv('MMS-1011', { type: 'salary_advance', amount: 8000, reason: 'School fees for second term', requested_on: addDays(today, -2), status: 'pending', installments: 2, emi_amount: 4000, start_month: addMonths(curMonth, 1), approved_by: null, approved_at: null, disbursed_on: null, review_note: '' })

  /* ── payroll for every completed month of the FY ─────────────────────── */
  const ctx = buildAttendanceContext({ holidays, attendance: b.all('attendance'), leaveRequests, leaveTypes: Object.values(lt), shifts: Object.values(shifts), today })
  const recovered = new Map<string, number>()
  for (let m = monthOf(fyStart); m < curMonth; m = addMonths(m, 1)) {
    const mStart = monthStart(m)
    const mEnd = monthEnd(m)
    const run = b.add('payroll_runs', {
      month: m, status: 'paid', employee_count: 0, total_gross: 0, total_deductions: 0, total_net: 0, total_employer_cost: 0,
      processed_at: at(addDays(mEnd, 2), '11:30'), processed_by: users[byCode['MMS-1032']!.email]!.id,
      approved_at: at(addDays(mEnd, 3), '16:00'), approved_by: admin.id, paid_at: at(addDays(mEnd, cfg.pay_day), '12:00'),
      payment_ref: `NEFT bulk upload · ${fyLabel(fy)}/${m.slice(5)}`, notes: '',
    }, at(addDays(mEnd, 2), '11:00'))
    const slips: Payslip[] = []
    for (const e of employees) {
      if (e.date_of_joining > mEnd || (e.date_of_exit && e.date_of_exit < mStart)) continue
      const s = structures.get(e.id)!
      const sum = summariseMonth(e, m, ctx, policy)
      let advRec = 0
      let loanRec = 0
      const recs: [Advance, number][] = []
      for (const a of advances.filter((x) => x.employee_id === e.id && x.status === 'active')) {
        const due = emiDue(a, recovered.get(a.id) ?? 0, m)
        if (!due) continue
        if (a.type === 'loan') loanRec += due
        else advRec += due
        recs.push([a, due])
      }
      const calc = computePayslip({ month: m, structure: s, regime: e.tax_regime, declaredDeductions: e.declared_deductions, daysInMonth: sum.days_in_month, paidDays: sum.paid_days, otMinutesApproved: sum.ot_minutes_approved, advanceRecovery: advRec, loanRecovery: loanRec, config: cfg })
      const slip = b.add('payslips', {
        run_id: run.id, employee_id: e.id, month: m, days_in_month: sum.days_in_month, working_days: sum.working_days, present_days: sum.present,
        paid_leave_days: sum.paid_leave, holidays: sum.holidays, week_offs: sum.week_offs, lop_days: sum.lop_days, late_marks: sum.late_marks,
        paid_days: sum.paid_days, ...calc, tax_regime: e.tax_regime, published: true, remarks: '',
      }, run.created_at)
      slips.push(slip)
      for (const [a, amt] of recs) {
        b.add('advance_recoveries', { advance_id: a.id, payslip_id: slip.id, month: m, amount: amt }, run.created_at)
        const tot = (recovered.get(a.id) ?? 0) + amt
        recovered.set(a.id, tot)
        if (tot >= a.amount) Object.assign(a, { status: 'closed' })
      }
    }
    Object.assign(run, {
      employee_count: slips.length,
      total_gross: slips.reduce((t, p) => t + p.gross_earnings, 0),
      total_deductions: slips.reduce((t, p) => t + p.total_deductions, 0),
      total_net: slips.reduce((t, p) => t + p.net_pay, 0),
      total_employer_cost: slips.reduce((t, p) => t + p.employer_cost, 0),
    })
  }

  /* ── petty cash ──────────────────────────────────────────────────────── */
  seedPettyCash(b, { employees: byCode, today, fyStart, fy, admin, raviUser, settings })

  /* ── tasks, announcements, notifications ─────────────────────────────── */
  seedCollaboration(b, { byCode, today, admin, raviUser, wcs, demoEmp, users, fy })

  /* ── operations: machines, maintenance, inventory, purchase, production, quality ── */
  seedOperations(b, { byCode, today, admin, wcs, fy })

  /* ── audit trail ─────────────────────────────────────────────────────── */
  seedAudit(b, { today, admin, users, byCode })

  return {
    tables: b.tables,
    meta: { seed_version: SEED_VERSION, seeded_at: nowIso, autopilot_through: today },
  }
}

/* ═══════════════════════════════ petty cash ═══════════════════════════════ */

function seedPettyCash(
  b: SeedBuilder,
  o: { employees: Record<string, Employee>; today: string; fyStart: string; fy: number; admin: AppUser; raviUser: AppUser; settings: Row<'company_settings'> },
) {
  const r = seededRandom(424242)
  const lbl = fyLabel(o.fy)
  let entryNo = 0
  let vNo = 0
  let balance = 0
  const nextEntry = () => `PC/${lbl}/${String(++entryNo).padStart(4, '0')}`
  const nextVoucher = () => `PCV/${lbl}/${String(++vNo).padStart(4, '0')}`
  const cashIn = (date: string, amount: number, category: string, description: string) => {
    balance += amount
    return b.add('petty_cash_entries', { entry_no: nextEntry(), date, type: 'in', amount, category, description, voucher_id: null, created_by: o.admin.id }, at(date, '10:30'))
  }
  cashIn(o.fyStart, o.settings.petty_cash_imprest, 'Opening balance', `Imprest float for FY ${lbl}`)
  const claimants = ['MMS-1031', 'MMS-1031', 'MMS-1029', 'MMS-1005', 'MMS-1013', 'MMS-1018', 'MMS-1025', 'MMS-1030', 'MMS-1028', 'MMS-1022']
  const spec: Record<string, [number, number, string[], string[]]> = {
    'Tea & Refreshments': [180, 1100, ['Tea & snacks for customer visit', 'Tea and biscuits — shop floor (week)', 'Lunch for auditors', 'Refreshments — safety meeting'], ['Sri Raghavendra Tea Stall', 'Adigas, Doddaballapura', 'Iyengar Bakery']],
    'Courier & Postage': [90, 850, ['Courier — samples to Vajra Hydraulics', 'Speed post — PF documents', 'Courier — drawings to Kaveri Automation', 'DTDC — calibration certificates'], ['DTDC Doddaballapura', 'India Post', 'Professional Couriers']],
    'Shop-floor Consumables': [250, 2400, ['Emery sheets and Scotch-Brite', 'Hand gloves and cotton waste', 'Marker pens and paint markers', 'Hose clips and Teflon tape', 'Allen key set (replacement)'], ['Vinayaka Hardware', 'Sri Sai Industrial Stores', 'KIADB Tools Corner']],
    'Local Conveyance': [120, 900, ['Auto fare — bank and GST office', 'Bus fare — vendor visit, Peenya', 'Fuel — bike, material pickup', 'Cab — urgent spares from Bengaluru'], ['Auto / bus', 'HP petrol bunk', 'Ola']],
    'Minor Repairs': [350, 3600, ['Water purifier service', 'Tube light and choke replacement', 'Door closer repair — QA room', 'Drinking water cooler repair', 'Welding of gate hinge'], ['Aqua Care Services', 'Sri Lakshmi Electricals', 'Local fabricator']],
    'Stationery & Printing': [150, 1500, ['Job-card printing (500)', 'A4 paper and files', 'Inspection report pads', 'Toner refill'], ['Sri Ganesh Xerox', 'Vasavi Stationers']],
    'Housekeeping': [300, 1800, ['Phenyl, brooms and mops', 'Washroom supplies', 'Pest control (monthly)'], ['Sri Sai Housekeeping Supplies', 'HiCare']],
    'First-aid & Medical': [150, 900, ['First-aid box refill', 'Burnol, bandages and Dettol'], ['Apollo Pharmacy', 'MedPlus']],
    'Miscellaneous': [100, 1000, ['Drinking water cans (20 L × 10)', 'Gas cylinder for canteen', 'Key duplication'], ['Bisleri distributor', 'Indane', 'Key maker']],
  }
  const cats = Object.keys(spec)
  const isPlantDay = (d: string) => dayOfWeek(d) !== 0
  for (const d of eachDay(o.fyStart, o.today)) {
    if (!isPlantDay(d)) continue
    let n = r.chance(0.55) ? 1 : 0
    if (r.chance(0.18)) n++
    // festival spends
    if (d === '2026-09-12' || d === '2026-10-17') n = Math.max(n, 1)
    for (let k = 0; k < n; k++) {
      const festival = d === '2026-09-12' ? 'Ganesh Chaturthi' : d === '2026-10-17' ? 'Ayudha Pooja' : null
      const cat = festival ? 'Pooja & Festivals' : r.pick(cats)
      const [lo, hi, descs, payees] = festival ? [3200, 4800, [`${festival} — flowers, fruits and pooja items for the shop floor`], ['KR Market flower vendor']] : spec[cat]!
      const amount = Math.round(r.int(lo, hi) / 10) * 10
      const code = d === o.today && k === 0 ? 'MMS-1005' : r.pick(claimants)
      const emp = o.employees[code]!
      const daysAgo = Math.round((new Date(o.today).getTime() - new Date(d).getTime()) / 86400000)
      let status: 'pending' | 'approved' | 'rejected' | 'paid' = 'paid'
      if (daysAgo <= 1) status = 'pending'
      else if (daysAgo <= 3) status = r.chance(0.5) ? 'approved' : 'pending'
      if (r.chance(0.03) && daysAgo > 3) status = 'rejected'
      const voucherAt = at(d, `${String(r.int(10, 16)).padStart(2, '0')}:${String(r.int(0, 59)).padStart(2, '0')}`)
      const v = b.add('petty_cash_vouchers', {
        voucher_no: nextVoucher(), employee_id: emp.id, date: d, category: cat, amount, payee: r.pick(payees), description: r.pick(descs),
        bill_no: r.chance(0.8) ? `${r.int(100, 9999)}` : '', attachment: null, status,
        reviewed_by: status === 'pending' ? null : o.admin.id, reviewed_at: status === 'pending' ? null : at(addDays(d, 1), '11:00'),
        review_note: status === 'rejected' ? 'No bill attached — personal expense' : '', paid_at: null, ledger_entry_id: null,
      }, voucherAt)
      if (status === 'paid') {
        if (balance - amount < o.settings.petty_cash_low_alert) {
          cashIn(d, o.settings.petty_cash_imprest - balance, 'Imprest top-up', 'Cash withdrawn from current account to restore imprest')
        }
        balance -= amount
        const e = b.add('petty_cash_entries', { entry_no: nextEntry(), date: d, type: 'out', amount, category: cat, description: `${v.voucher_no} · ${v.description}`, voucher_id: v.id, created_by: o.admin.id }, at(addDays(d, 1), '11:05'))
        Object.assign(v, { paid_at: e.created_at, ledger_entry_id: e.id })
      }
    }
  }
}

/* ═══════════════════════ tasks / announcements / notifications ═══════════════════════ */

function seedCollaboration(
  b: SeedBuilder,
  o: { byCode: Record<string, Employee>; today: string; admin: AppUser; raviUser: AppUser; wcs: Record<string, WorkCentre>; demoEmp: Employee; users: Record<string, AppUser>; fy: number },
) {
  const E = (c: string) => o.byCode[c]!.id
  const d = (n: number) => addDays(o.today, n)
  type T = [string, string, Task['status'], Task['priority'], string[], number | null, string[], string | null, [string, boolean][]]
  type Task = Row<'tasks'>
  const tasks: T[] = [
    ['First-article inspection — end caps WO-1042', 'Complete FAI on the first 5 pieces of the hydraulic cylinder end cap (Vajra Hydraulics) and share the report before the batch is released.', 'in_progress', 'high', ['MMS-1022', 'MMS-1024'], 1, ['quality', 'customer'], 'QAI', [['CMM program for bore Ø80 H7', true], ['Thread gauge M64×2', true], ['Surface finish Ra 0.8 check', false], ['Report to customer', false]]],
    ['Prove-out new program — idler shaft (Tunga Conveyors)', 'New turning program for the Ø40 idler shaft on CNC-02. Validate cycle time and first-off dimensions.', 'in_progress', 'high', ['MMS-1005', 'MMS-1006'], 0, ['production'], 'CNC', [['Dry run', true], ['First-off inspection', false], ['Update cycle time in routing', false]]],
    ['Ayudha Pooja shop-floor arrangements', 'Machine cleaning, decoration and pooja on Mon 19 Oct. Coordinate flowers/fruits through petty cash and shut down machines safely on Saturday evening.', 'todo', 'medium', ['MMS-1005', 'MMS-1031', 'MMS-1013'], 1, ['admin', 'festival'], null, [['Machine cleaning list per cell', false], ['Flowers & pooja items', false], ['Sweets for staff', false]]],
    ['Weekly 5S audit — CNC Turning Cell', 'Score the cell on the 5S sheet and close last week’s red tags.', 'todo', 'medium', ['MMS-1005'], 2, ['5S', 'production'], 'CNC', [['Red-tag area review', false], ['Chip tray cleaning', false], ['Tool trolley shadow board', false]]],
    ['Reorder CNMG 120408 inserts', 'Stock below reorder level. Raise PO on Precision Tooling Solutions after confirming grade with Manjunath.', 'review', 'high', ['MMS-1028'], -1, ['purchase'], null, [['Confirm grade', true], ['Raise PO', true], ['Approval', false]]],
    ['Spindle drawbar fault — VMC-02', 'Tool unclamp alarm on BFW VMC. Check drawbar disc springs and air pressure; arrange spares if needed.', 'in_progress', 'urgent', ['MMS-1025', 'MMS-1026'], 0, ['maintenance', 'breakdown'], 'VMC', [['Check air pressure (6 bar)', true], ['Inspect disc springs', false], ['Order spring kit', false]]],
    ['Quotation — pump impeller housing (Karavali Pumpworks)', 'Prepare costing for 200 nos/month: material, VMC hours, fixtures. Share with Prakash sir for review.', 'review', 'medium', ['MMS-1034', 'MMS-1004'], 3, ['sales'], null, [['Material costing', true], ['Machining hours', true], ['Fixture cost', false]]],
    ['Calibrate micrometers due this month', 'Send 0–25 and 25–50 micrometers and bore gauge to the calibration lab; arrange spares from the QA cupboard meanwhile.', 'todo', 'medium', ['MMS-1023'], 6, ['quality', 'calibration'], 'QAI', []],
    ['Safety induction for new trainees', 'PPE, machine guarding, LOTO and emergency exits for Shivakumar and Naveen.', 'done', 'high', ['MMS-1030', 'MMS-1005'], -40, ['safety', 'hr'], null, [['PPE issue', true], ['LOTO demo', true], ['Fire extinguisher drill', true]]],
    ['Update work instruction — valve block sub-assembly', 'Revise WI-SAL-07 for the new O-ring kit and torque values (rev C drawing).', 'todo', 'low', ['MMS-1018'], 8, ['documentation'], 'SAL', []],
    ['Fix air leak at sub-assembly pneumatic press', 'Hissing at FRL unit; replace quick-coupler and check line pressure.', 'done', 'medium', ['MMS-1027'], -6, ['maintenance'], 'SAL', [['Replace coupler', true]]],
    ['Monthly MIS for directors', 'Production, dispatch, rejection %, payroll cost and petty cash summary for the board.', 'todo', 'high', ['MMS-1032'], 4, ['finance', 'MIS'], null, [['Sales & dispatch', false], ['Payroll summary', false], ['Rejection analysis', false]]],
    ['Welding fixture for base frame — Sahyadri', 'Design and fabricate a welding fixture to hold squareness within 1 mm on the 1.2 m base frame.', 'in_progress', 'medium', ['MMS-1002', 'MMS-1013'], 9, ['engineering'], 'WLD', [['Concept sketch', true], ['Detailed drawing', false], ['Fabrication', false]]],
    ['Bend allowance chart for 3 mm MS', 'Measure and publish bend deductions for the 80 T press brake tooling.', 'done', 'low', ['MMS-1016', 'MMS-1003'], -15, ['engineering'], 'PRB', []],
    ['Coolant concentration check — all CNC/VMC', 'Refractometer check and top-up; record readings on the board.', 'todo', 'low', ['MMS-1005', 'MMS-1011'], 1, ['maintenance', 'production'], 'CNC', []],
    ['Customer audit preparation — Vajra Hydraulics (29 Oct)', 'Process audit by customer QA. Keep inspection records, calibration certificates and traceability ready.', 'todo', 'urgent', ['MMS-1022', 'MMS-1001', 'MMS-1005'], 13, ['quality', 'customer'], null, [['Calibration certificates file', false], ['Traceability of last 3 lots', false], ['Shop-floor walk-through', false]]],
    ['Collect Form 11 & nominations from new joiners', 'PF declaration and nomination (Form 2) for June/January joiners.', 'done', 'medium', ['MMS-1030'], -20, ['hr', 'compliance'], null, []],
    ['Stock count — tool crib', 'Physical count of inserts, drills and taps; reconcile with ERP.', 'review', 'medium', ['MMS-1029'], -2, ['stores'], null, [['Count', true], ['Reconcile', true]]],
  ]
  let no = 0
  const created: Task[] = []
  tasks.forEach(([title, description, status, priority, assignees, due, labels, wc, checklist], i) => {
    const createdAt = at(addDays(o.today, -(due != null && due < 0 ? -due + 6 : 3 + (i % 9))), '10:15')
    const t = b.add('tasks', {
      task_no: `T-${String(++no).padStart(4, '0')}`, title, description, status, priority, assignee_ids: assignees.map(E), created_by: o.admin.id,
      due_date: due == null ? null : d(due), labels, work_centre_id: wc ? o.wcs[wc]!.id : null,
      checklist: checklist.map(([text, done]) => ({ id: uuid(), text, done })), sort_order: i,
      completed_at: status === 'done' ? at(d(due ?? -1), '16:40') : null,
    }, createdAt)
    created.push(t)
  })
  const comment = (ti: number, user: AppUser, body: string, daysAgo: number) =>
    b.add('task_comments', { task_id: created[ti]!.id, author_user_id: user.id, author_name: user.display_name, body }, at(d(-daysAgo), '15:20'))
  comment(1, o.raviUser, 'Dry run done. Facing tool chipping at the shoulder — switching to a TNMG insert with a sharper nose.', 0)
  comment(1, o.admin, 'Good. Please share the cycle time once proved — Tunga needs 400 nos by month-end.', 0)
  comment(0, o.admin, 'Customer wants the FAI report with CMM printouts attached.', 1)
  comment(5, o.users[o.byCode['MMS-1013']!.email] ?? o.admin, 'VMC-02 jobs moved to VMC-01 for today.', 0)
  comment(2, o.raviUser, 'Machine-wise cleaning list prepared, will share on the notice board.', 1)

  // personal to-dos for the demo employee and admin
  const todos: [AppUser, string, boolean, number | null][] = [
    [o.raviUser, 'Check insert stock before Saturday', false, 1], [o.raviUser, 'Submit Ayudha Pooja flower bill', false, 1],
    [o.raviUser, 'Call Vajra QA about FAI format', true, null], [o.raviUser, 'Update operator skill matrix', false, 7],
    [o.admin, 'Sign September PF challan', true, null], [o.admin, 'Review Karavali quotation', false, 3], [o.admin, 'Approve pending petty-cash vouchers', false, 0],
  ]
  for (const [u, text, done, due] of todos) b.add('todos', { user_id: u.id, text, done, due_date: due == null ? null : d(due) })

  // announcements
  const ann: [string, string, Row<'announcements'>['category'], Row<'announcements'>['priority'], boolean, number, number | null][] = [
    ['Ayudha Pooja & Vijayadashami holidays — 19 & 20 Oct', 'The plant will remain closed on Monday 19 October (Ayudha Pooja) and Tuesday 20 October (Vijayadashami). Machine pooja will be performed on Saturday 17 October at 3:30 PM — all cells to complete cleaning by 3 PM. Work resumes Wednesday 21 October, General Shift 9:00 AM.', 'holiday', 'important', true, 2, 6],
    ['Customer process audit — Vajra Hydraulics, 29 October', 'Vajra Hydraulics’ supplier quality team will audit our machining and inspection processes on 29 October. Keep work areas 5S-ready, inspection records up to date and gauges within calibration.', 'production', 'important', true, 1, 14],
    ['September salaries credited', 'Salaries for September have been credited to your bank accounts. Payslips are available under My Payslips — please raise any query with HR by 20 October.', 'hr', 'normal', false, 9, null],
    ['PPE is mandatory in the Welding Bay', 'Welding helmet, leather gloves, apron and safety shoes are compulsory inside the yellow line. Supervisors will stop work if PPE is missing.', 'safety', 'urgent', false, 18, null],
    ['Welcome Shivakumar K (Trainee Operator, CNC)', 'Please welcome Shivakumar, who joins the CNC Turning Cell as a trainee operator under Ravi Kumar M.', 'celebration', 'normal', false, 137, 30],
    ['Fire & evacuation drill on 24 October', 'A fire and evacuation drill will be conducted at 11:30 AM on Saturday 24 October. Assemble at the main gate assembly point when the siren sounds.', 'safety', 'normal', false, 0, 8],
  ]
  for (const [title, body, category, priority, pinned, ago, expires] of ann) {
    b.add('announcements', { title, body, category, priority, audience_department_ids: [], pinned, published_at: at(d(-ago), '09:30'), expires_on: expires == null ? null : d(expires), created_by: o.admin.id, author_name: 'HR & Administration' }, at(d(-ago), '09:30'))
  }

  // notifications
  const note = (u: AppUser, type: Row<'notifications'>['type'], title: string, body: string, link: string | null, read: boolean, agoHours: number) =>
    b.add('notifications', { user_id: u.id, type, title, body, link, read }, new Date(Date.now() - agoHours * 3600_000).toISOString())
  note(o.raviUser, 'payroll', 'Payslip published', 'Your payslip for September is ready to download.', '/me/payslips', true, 24 * 9)
  note(o.raviUser, 'task', 'New task assigned', 'Ayudha Pooja shop-floor arrangements', '/me/tasks', false, 30)
  note(o.raviUser, 'task', 'New task assigned', 'Weekly 5S audit — CNC Turning Cell', '/me/tasks', false, 50)
  note(o.raviUser, 'leave', 'Leave request rejected', 'Casual leave on 26 Sep was not approved: peak dispatch week.', '/me/leaves', true, 24 * 22)
  note(o.raviUser, 'announcement', 'Ayudha Pooja & Vijayadashami holidays', 'Plant closed 19 & 20 October.', '/me/announcements', false, 48)
  note(o.admin, 'leave', 'Leave requests waiting', 'New leave requests need your approval.', '/admin/leaves', false, 3)
  note(o.admin, 'maintenance', 'Breakdown reported — VMC-02', 'Spindle tool-unclamp alarm on BFW VMC-02.', '/admin/machines', false, 20)
  note(o.admin, 'inventory', 'Low stock', 'Several items are below their reorder level.', '/admin/inventory', false, 26)
  note(o.admin, 'petty_cash', 'Vouchers pending', 'Petty-cash vouchers are waiting for approval.', '/admin/petty-cash', false, 5)
}

/* ═══════════════════════════════ audit ═══════════════════════════════ */

function seedAudit(b: SeedBuilder, o: { today: string; admin: AppUser; users: Record<string, AppUser>; byCode: Record<string, Employee> }) {
  const r = seededRandom(777)
  const people = Object.values(o.users)
  const items: [Row<'audit_logs'>['action'], string, string][] = [
    ['login', 'auth', 'Signed in'], ['approve', 'leave_requests', 'Approved casual leave'], ['approve', 'petty_cash_vouchers', 'Approved petty-cash voucher'],
    ['update', 'employees', 'Updated employee contact details'], ['create', 'tasks', 'Created task'], ['process', 'payroll_runs', 'Processed payroll'],
    ['create', 'purchase_orders', 'Created purchase order'], ['update', 'machines', 'Changed machine status'], ['export', 'reports', 'Exported attendance register (CSV)'],
    ['create', 'announcements', 'Published announcement'], ['update', 'company_settings', 'Updated attendance policy'], ['create', 'maintenance_logs', 'Logged preventive maintenance'],
  ]
  for (let i = 0; i < 70; i++) {
    const [action, entity, summary] = r.pick(items)
    const u = r.pick(people)
    const ts = new Date(Date.now() - r.int(1, 24 * 21) * 3600_000).toISOString()
    b.add('audit_logs', { at: ts, user_id: u.id, user_name: u.display_name, action, entity, entity_id: null, summary, changes: null }, ts)
  }
}

export type { Customer, InventoryItem, Machine, PurchaseOrder, Vendor, WorkOrder }
