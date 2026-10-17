/**
 * HR & administration services — employees, org structure (departments / designations),
 * emergency contacts, documents, roles, directors and company settings.
 *
 * Validators mirror the CHECK / UNIQUE constraints in supabase/migrations/…_schema.sql, so a form
 * never sends something the database would reject. Writers apply the change through `db`
 * (optimistic) and append an audit entry; pages stay thin.
 */
import { getSupabase } from '@/data/boot'
import { db } from '@/data/store'
import type {
  CompanySettings, Department, Designation, Director, DocumentType, EmergencyContact, Employee, EmployeeDocument, EmploymentType,
  Gender, Permission, Role, SalaryStructure, TaxRegime,
} from '@/data/types'
import { addDays, ageInYears, diffDays, fmtDate, fyLabel, fyOf, todayISO } from '@/lib/dates'
import { fullName, maskTail, round2 } from '@/lib/format'
import { nextNumber, uuid } from '@/lib/ids'
import { proratedQuota } from '@/lib/leaves'
import { audit, diff } from './audit'
import { MAX_FILE_BYTES, storeFile } from './files'
import { currentSession } from './session'

export type Errors<T> = Partial<Record<keyof T & string, string>>
type Changes = Record<string, { from: unknown; to: unknown }>

/* ───────────────────────────── formats & options ───────────────────────────── */

export const RE = {
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  pincode: /^[1-9][0-9]{5}$/,
  uan: /^\d{12}$/,
  esic: /^\d{10}$/,
  account: /^\d{9,18}$/,
  din: /^\d{8}$/,
  roleKey: /^[a-z][a-z0-9_]*$/,
  cin: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  tan: /^[A-Z]{4}\d{5}[A-Z]$/,
  hhmm: /^([01]\d|2[0-3]):[0-5]\d$/,
  esiEmployer: /^\d{17}$/,
  color: /^#[0-9a-fA-F]{6}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
}

export const isDate = (s: string | null | undefined): s is string => !!s && RE.date.test(s) && !Number.isNaN(new Date(s).getTime())

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]
export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'probation', label: 'Probation' },
  { value: 'contract', label: 'Contract' },
  { value: 'trainee', label: 'Trainee' },
  { value: 'apprentice', label: 'Apprentice' },
]
export const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar card (masked)' },
  { value: 'pan', label: 'PAN card' },
  { value: 'offer_letter', label: 'Offer letter' },
  { value: 'appointment_letter', label: 'Appointment letter' },
  { value: 'education', label: 'Education certificate' },
  { value: 'experience', label: 'Experience / relieving letter' },
  { value: 'bank_proof', label: 'Bank proof (cancelled cheque)' },
  { value: 'photo', label: 'Photograph' },
  { value: 'medical', label: 'Medical / fitness certificate' },
  { value: 'training', label: 'Training / apprenticeship' },
  { value: 'other', label: 'Other' },
]
export const docTypeLabel = (t: DocumentType) => DOC_TYPES.find((d) => d.value === t)?.label ?? t
export const RELATIONS = ['Spouse', 'Father', 'Mother', 'Brother', 'Sister', 'Son', 'Daughter', 'Guardian', 'Friend', 'Other']
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]
/** Department / chip palette (brand-compatible). */
export const SWATCHES = ['#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#64748b']

/** 10-digit Indian number (mobile or STD landline), optional +91 / leading 0. */
export function phoneError(v: string, required = false): string | null {
  const t = v.trim()
  if (!t) return required ? 'Phone number is required' : null
  if (!/^\+?[\d\s()-]+$/.test(t)) return 'Use digits only, e.g. +91 98450 12345'
  const digits = t.replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits
  if (local.length !== 10) return 'Enter a 10-digit phone number'
  return null
}

/** '+91 98450 12345' for mobiles; anything else is kept as typed (trimmed). */
export function normalisePhone(v: string): string {
  const t = v.trim().replace(/\s+/g, ' ')
  const digits = t.replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : null
  if (local && /^[6-9]/.test(local)) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
  return t
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ')
const can = (p: Permission) => currentSession()?.can(p) ?? false

/** Waits for pending writes; false when the server rejected one (the store already toasted it). */
async function settled(): Promise<boolean> {
  try {
    await db.flushed()
    return true
  } catch {
    return false
  }
}

/** Remove a Supabase Storage object (best effort — the row is what matters). */
async function removeStored(stored: string | null | undefined) {
  if (!stored?.startsWith('storage:') || db.backend?.kind !== 'supabase') return
  try {
    const sb = await getSupabase()
    await sb.storage.from('erp-files').remove([stored.slice('storage:'.length)])
  } catch {
    /* orphaned file is harmless */
  }
}

/** Keeps photos / bank numbers out of the audit trail. */
function redact(changes: Changes | null): Changes | null {
  if (!changes) return null
  const out = { ...changes }
  if (out.photo) out.photo = { from: out.photo.from ? '(photo)' : null, to: out.photo.to ? '(new photo)' : null }
  if (out.bank_account) out.bank_account = { from: maskTail(String(out.bank_account.from ?? '')), to: maskTail(String(out.bank_account.to ?? '')) }
  if (out.file_data) delete out.file_data
  return out
}

/** One level deeper than diff(): payroll.pf_employee_rate instead of the whole payroll object. */
export function deepDiff<T extends object>(before: T, after: Partial<T>): Changes | null {
  const out: Changes = {}
  for (const [k, v] of Object.entries(after)) {
    if (k === 'updated_at' || k === 'created_at') continue
    const prev = (before as Record<string, unknown>)[k]
    const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x)
    if (isObj(prev) && isObj(v)) {
      const inner = diff(prev as Record<string, unknown>, v as Record<string, unknown>)
      if (inner) for (const [ik, iv] of Object.entries(inner)) out[`${k}.${ik}`] = iv
    } else if (JSON.stringify(prev) !== JSON.stringify(v)) out[k] = { from: prev, to: v }
  }
  return Object.keys(out).length ? out : null
}

/* ──────────────────────────────── employees ──────────────────────────────── */

export const EMPLOYEE_FIELD_LABELS: Record<string, string> = {
  emp_code: 'employee code', first_name: 'first name', last_name: 'last name', gender: 'gender', dob: 'date of birth', phone: 'phone',
  email: 'official e-mail', personal_email: 'personal e-mail', address: 'address', city: 'city', state: 'state', pincode: 'pincode',
  department_id: 'department', designation_id: 'designation', reporting_to: 'reporting manager', employment_type: 'employment type',
  date_of_joining: 'date of joining', date_of_exit: 'exit date', exit_reason: 'exit reason', status: 'status', shift_id: 'shift',
  work_centre_id: 'work centre', blood_group: 'blood group', marital_status: 'marital status', pan: 'PAN', aadhaar_masked: 'Aadhaar',
  uan: 'UAN', esic_no: 'ESIC no.', bank_name: 'bank', bank_account: 'bank account', ifsc: 'IFSC', photo: 'photo', skills: 'skills',
  tax_regime: 'tax regime', declared_deductions: 'declared deductions', notes: 'notes',
}

export interface EmployeeFormValues {
  first_name: string
  last_name: string
  gender: Gender | ''
  dob: string
  blood_group: string
  marital_status: 'single' | 'married'
  email: string
  personal_email: string
  phone: string
  address: string
  city: string
  state: string
  pincode: string
  emp_code: string
  department_id: string
  designation_id: string
  reporting_to: string
  employment_type: EmploymentType | ''
  date_of_joining: string
  shift_id: string
  work_centre_id: string
  pan: string
  aadhaar_last4: string
  uan: string
  esic_no: string
  bank_name: string
  bank_account: string
  ifsc: string
  tax_regime: TaxRegime
  declared_deductions: string
  skills: string[]
  notes: string
}

export type EmployeeSection = 'personal' | 'contact' | 'job' | 'statutory' | 'tax'
export const EMPLOYEE_SECTIONS: { key: EmployeeSection; label: string; fields: (keyof EmployeeFormValues)[] }[] = [
  { key: 'personal', label: 'Personal', fields: ['first_name', 'last_name', 'gender', 'dob', 'blood_group', 'marital_status'] },
  { key: 'contact', label: 'Contact', fields: ['email', 'personal_email', 'phone', 'address', 'city', 'state', 'pincode'] },
  { key: 'job', label: 'Job', fields: ['emp_code', 'department_id', 'designation_id', 'reporting_to', 'employment_type', 'date_of_joining', 'shift_id', 'work_centre_id'] },
  { key: 'statutory', label: 'Statutory & bank', fields: ['pan', 'aadhaar_last4', 'uan', 'esic_no', 'bank_name', 'bank_account', 'ifsc'] },
  { key: 'tax', label: 'Tax & skills', fields: ['tax_regime', 'declared_deductions', 'skills', 'notes'] },
]

export function nextEmpCode(): string {
  return nextNumber('MMS-', db.all('employees').map((e) => e.emp_code.toUpperCase()))
}

export function emptyEmployeeForm(): EmployeeFormValues {
  const shifts = db.all('shifts').filter((s) => s.active)
  const shift = shifts.find((s) => s.code === 'GEN') ?? shifts[0]
  return {
    first_name: '', last_name: '', gender: '', dob: '', blood_group: '', marital_status: 'single',
    email: '', personal_email: '', phone: '', address: '', city: '', state: 'Karnataka', pincode: '',
    emp_code: nextEmpCode(), department_id: '', designation_id: '', reporting_to: '', employment_type: 'probation',
    date_of_joining: todayISO(), shift_id: shift?.id ?? '', work_centre_id: '',
    pan: '', aadhaar_last4: '', uan: '', esic_no: '', bank_name: '', bank_account: '', ifsc: '',
    tax_regime: 'new', declared_deductions: '0', skills: [], notes: '',
  }
}

export function employeeToForm(e: Employee): EmployeeFormValues {
  return {
    first_name: e.first_name, last_name: e.last_name, gender: e.gender, dob: e.dob, blood_group: e.blood_group, marital_status: e.marital_status,
    email: e.email, personal_email: e.personal_email, phone: e.phone, address: e.address, city: e.city, state: e.state || 'Karnataka', pincode: e.pincode,
    emp_code: e.emp_code, department_id: e.department_id, designation_id: e.designation_id, reporting_to: e.reporting_to ?? '',
    employment_type: e.employment_type, date_of_joining: e.date_of_joining, shift_id: e.shift_id, work_centre_id: e.work_centre_id ?? '',
    pan: e.pan, aadhaar_last4: e.aadhaar_masked ? e.aadhaar_masked.slice(-4) : '', uan: e.uan, esic_no: e.esic_no, bank_name: e.bank_name,
    bank_account: e.bank_account, ifsc: e.ifsc, tax_regime: e.tax_regime, declared_deductions: String(e.declared_deductions ?? 0),
    skills: [...e.skills], notes: e.notes,
  }
}

/** true when `managerId`'s reporting chain reaches `targetId` (would create a loop). */
function reportsUpTo(managerId: string, targetId: string): boolean {
  const seen = new Set<string>()
  let cur: string | null = managerId
  while (cur && !seen.has(cur)) {
    if (cur === targetId) return true
    seen.add(cur)
    cur = db.get('employees', cur)?.reporting_to ?? null
  }
  return false
}

export function validateEmployee(f: EmployeeFormValues, existing?: Employee): Errors<EmployeeFormValues> {
  const e: Errors<EmployeeFormValues> = {}
  const today = todayISO()
  const others = db.all('employees').filter((x) => x.id !== existing?.id)
  const dojOk = isDate(f.date_of_joining)

  // personal
  if (!f.first_name.trim()) e.first_name = 'First name is required'
  else if (f.first_name.trim().length > 60) e.first_name = 'Keep it under 60 characters'
  if (f.last_name.trim().length > 60) e.last_name = 'Keep it under 60 characters'
  if (!f.gender) e.gender = 'Select a gender'
  if (!isDate(f.dob)) e.dob = 'Date of birth is required'
  else if (f.dob > today) e.dob = 'Date of birth cannot be in the future'
  else if (dojOk && f.dob >= f.date_of_joining) e.dob = 'Must be before the date of joining'
  else {
    const age = ageInYears(f.dob, dojOk ? f.date_of_joining : today)
    if (age < 18) e.dob = dojOk ? `Must be 18 or older on the joining date (would be ${age})` : 'Must be at least 18 years old'
    else if (ageInYears(f.dob, today) > 80) e.dob = 'Please check the year of birth'
  }
  if (f.blood_group && !BLOOD_GROUPS.includes(f.blood_group)) e.blood_group = 'Pick a blood group from the list'

  // contact
  const email = f.email.trim().toLowerCase()
  if (email) {
    if (!RE.email.test(email)) e.email = 'Enter a valid e-mail address'
    else {
      const clash = others.find((x) => x.email && x.email.toLowerCase() === email)
      if (clash) e.email = `Already used by ${fullName(clash)} (${clash.emp_code})`
    }
  }
  if (f.personal_email.trim() && !RE.email.test(f.personal_email.trim())) e.personal_email = 'Enter a valid e-mail address'
  const pe = phoneError(f.phone, true)
  if (pe) e.phone = pe
  if (f.address.length > 300) e.address = 'Keep the address under 300 characters'
  if (f.city.trim().length > 60) e.city = 'Keep it under 60 characters'
  if (!f.state.trim()) e.state = 'Select a state'
  if (f.pincode.trim() && !RE.pincode.test(f.pincode.trim())) e.pincode = 'Pincode is 6 digits, e.g. 561203'

  // job
  const code = f.emp_code.trim().toUpperCase()
  if (!code) e.emp_code = 'Employee code is required'
  else if (!/^[A-Z0-9][A-Z0-9/-]{1,19}$/.test(code)) e.emp_code = 'Letters, digits, - and / only (e.g. MMS-1037)'
  else if (others.some((x) => x.emp_code.toUpperCase() === code)) e.emp_code = `${code} is taken — next free code is ${nextEmpCode()}`
  if (!f.department_id) e.department_id = 'Select a department'
  if (!f.designation_id) e.designation_id = 'Select a designation'
  else if (f.department_id && db.get('designations', f.designation_id)?.department_id !== f.department_id) e.designation_id = 'This designation belongs to another department'
  if (f.reporting_to) {
    const m = db.get('employees', f.reporting_to)
    if (existing && f.reporting_to === existing.id) e.reporting_to = 'An employee cannot report to themselves'
    else if (existing && reportsUpTo(f.reporting_to, existing.id)) e.reporting_to = 'This would create a reporting loop'
    else if (!m) e.reporting_to = 'Manager not found'
    else if (m.status === 'exited' && m.id !== existing?.reporting_to) e.reporting_to = `${fullName(m)} has exited`
  }
  if (!f.employment_type) e.employment_type = 'Select the employment type'
  if (!dojOk) e.date_of_joining = 'Date of joining is required'
  else if (f.date_of_joining > addDays(today, 183)) e.date_of_joining = 'Joining date is more than 6 months ahead'
  else if (existing?.date_of_exit && f.date_of_joining > existing.date_of_exit) e.date_of_joining = `Must be on or before the exit date (${fmtDate(existing.date_of_exit)})`
  if (!f.shift_id) e.shift_id = 'Select a shift'
  else if (!db.get('shifts', f.shift_id)) e.shift_id = 'Shift not found'

  // statutory & bank
  const pan = f.pan.trim().toUpperCase()
  if (pan && !RE.pan.test(pan)) e.pan = 'PAN format is ABCPE1234F'
  else if (pan && pan[3] !== 'P') e.pan = 'An individual’s PAN has P as the 4th letter'
  if (f.aadhaar_last4 && !/^\d{4}$/.test(f.aadhaar_last4)) e.aadhaar_last4 = 'Enter only the last 4 digits'
  if (f.uan.trim() && !RE.uan.test(f.uan.trim())) e.uan = 'UAN is 12 digits'
  if (f.esic_no.trim() && !RE.esic.test(f.esic_no.trim())) e.esic_no = 'ESIC IP number is 10 digits'
  const acct = f.bank_account.replace(/\s/g, '')
  const ifsc = f.ifsc.trim().toUpperCase()
  const bank = f.bank_name.trim()
  if (bank || acct || ifsc) {
    if (!bank) e.bank_name = 'Bank name is required with an account'
    if (!acct) e.bank_account = 'Account number is required'
    else if (!RE.account.test(acct)) e.bank_account = 'Account number is 9–18 digits'
    if (!ifsc) e.ifsc = 'IFSC is required'
    else if (!RE.ifsc.test(ifsc)) e.ifsc = 'IFSC format is ABCD0123456 (5th character is zero)'
  }

  // tax & skills
  if (f.tax_regime === 'old') {
    const d = Number(f.declared_deductions)
    if (f.declared_deductions.trim() === '' || !Number.isFinite(d)) e.declared_deductions = 'Enter an amount (0 if none)'
    else if (d < 0) e.declared_deductions = 'Cannot be negative'
    else if (d > 10_000_000) e.declared_deductions = 'That amount looks too large'
  }
  if (f.skills.length > 25) e.skills = 'Up to 25 skills'
  if (f.notes.length > 1000) e.notes = 'Keep notes under 1,000 characters'
  return e
}

type EmployeeCore = Omit<Employee, 'id' | 'created_at' | 'updated_at' | 'status' | 'date_of_exit' | 'exit_reason' | 'photo'>

function formToEmployee(f: EmployeeFormValues): EmployeeCore {
  return {
    emp_code: f.emp_code.trim().toUpperCase(),
    first_name: clean(f.first_name),
    last_name: clean(f.last_name),
    gender: f.gender as Gender,
    dob: f.dob,
    phone: normalisePhone(f.phone),
    email: f.email.trim().toLowerCase(),
    personal_email: f.personal_email.trim().toLowerCase(),
    address: f.address.trim(),
    city: clean(f.city),
    state: clean(f.state) || 'Karnataka',
    pincode: f.pincode.trim(),
    department_id: f.department_id,
    designation_id: f.designation_id,
    reporting_to: f.reporting_to || null,
    employment_type: f.employment_type as EmploymentType,
    date_of_joining: f.date_of_joining,
    shift_id: f.shift_id,
    work_centre_id: f.work_centre_id || null,
    blood_group: f.blood_group,
    marital_status: f.marital_status,
    pan: f.pan.trim().toUpperCase(),
    aadhaar_masked: f.aadhaar_last4 ? `XXXX-XXXX-${f.aadhaar_last4}` : '',
    uan: f.uan.trim(),
    esic_no: f.esic_no.trim(),
    bank_name: clean(f.bank_name),
    bank_account: f.bank_account.replace(/\s/g, ''),
    ifsc: f.ifsc.trim().toUpperCase(),
    skills: normaliseList(f.skills, 40),
    tax_regime: f.tax_regime,
    declared_deductions: f.tax_regime === 'old' ? round2(Math.max(0, Number(f.declared_deductions) || 0)) : 0,
    notes: f.notes.trim(),
  }
}

/** Trim, drop empties and case-insensitive duplicates. */
export function normaliseList(items: string[], maxLen = 80): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const v = clean(raw).slice(0, maxLen)
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

export interface CreatedEmployee {
  employee: Employee
  /** Leave-balance rows opened for the current FY (0 when the user lacks leaves.manage). */
  balances: number
}

/** Insert a new employee (+ current-FY leave balances). Resolves null when the server rejected it. */
export async function createEmployee(f: EmployeeFormValues, photo: File | null): Promise<CreatedEmployee | null> {
  const id = uuid()
  const stored = photo ? await storeFile(photo, id, 'photo') : null
  const employee = db.insert('employees', { id, ...formToEmployee(f), status: 'active', date_of_exit: null, exit_reason: '', photo: stored })
  if (!(await settled())) return null
  const name = fullName(employee)
  audit('create', 'employees', id, `Added employee ${name} (${employee.emp_code})`)

  let balances = 0
  if (can('leaves.manage')) {
    const fy = fyOf(todayISO())
    const types = db.all('leave_types').filter((t) => t.active && (!t.gender || t.gender === employee.gender) && t.code !== 'LOP' && t.code !== 'ML')
    const opened: string[] = []
    db.batch(() => {
      for (const t of types) {
        if (db.find('leave_balances', (b) => b.employee_id === id && b.leave_type_id === t.id && b.year === fy)) continue
        const allotted = proratedQuota(t.annual_quota, employee.date_of_joining, fy)
        db.insert('leave_balances', { employee_id: id, leave_type_id: t.id, year: fy, opening: 0, allotted, adjustment: 0 })
        opened.push(`${t.code} ${allotted}`)
      }
    })
    balances = opened.length
    if (balances) audit('create', 'leave_balances', id, `Opened FY ${fyLabel(fy)} leave balances for ${name}: ${opened.join(', ')}`)
  }
  return { employee, balances }
}

export async function updateEmployee(emp: Employee, f: EmployeeFormValues, photo: { file: File | null; remove: boolean }): Promise<Employee> {
  const patch: Partial<Employee> = formToEmployee(f)
  if (photo.file) patch.photo = await storeFile(photo.file, emp.id, 'photo')
  else if (photo.remove) patch.photo = null
  const changes = diff(emp, patch)
  if (!changes) return emp
  const row = db.update('employees', emp.id, patch)
  if (changes.photo && emp.photo) void removeStored(emp.photo)
  const fields = Object.keys(changes).map((k) => EMPLOYEE_FIELD_LABELS[k] ?? k)
  audit('update', 'employees', emp.id, `Updated ${fullName(row)} (${row.emp_code}): ${fields.join(', ')}`, redact(changes))
  return row
}

/** Photo only — allowed for HR and for the employee themself (self-service contact field). */
export async function setEmployeePhoto(emp: Employee, file: File | null) {
  if (file && !file.type.startsWith('image/')) throw new Error('Choose an image file (JPG, PNG or WebP).')
  const photo = file ? await storeFile(file, emp.id, 'photo') : null
  db.update('employees', emp.id, { photo })
  if (emp.photo && emp.photo !== photo) void removeStored(emp.photo)
  const self = currentSession()?.employee?.id === emp.id
  audit('update', 'employees', emp.id, `${file ? 'Updated' : 'Removed'} ${self ? 'own' : fullName(emp) + '’s'} photo`, redact({ photo: { from: emp.photo, to: photo } }))
}

export type SeparationStatus = 'on_notice' | 'exited'

export function validateSeparation(emp: Employee, status: SeparationStatus, date: string, reason: string): { date?: string; reason?: string } {
  const out: { date?: string; reason?: string } = {}
  const today = todayISO()
  if (!isDate(date)) out.date = status === 'exited' ? 'Exit date is required' : 'Last working day is required'
  else if (date < emp.date_of_joining) out.date = `Must be on or after the joining date (${fmtDate(emp.date_of_joining)})`
  else if (status === 'on_notice' && date < today) out.date = 'Last working day has passed — mark the employee as exited instead'
  else if (status === 'exited' && date > today) out.date = 'Exit date is in the future — use “On notice” until then'
  if (reason.trim().length < 3) out.reason = 'Give a short reason (at least 3 characters)'
  else if (reason.length > 300) out.reason = 'Keep it under 300 characters'
  return out
}

export function markSeparation(emp: Employee, status: SeparationStatus, date: string, reason: string) {
  const patch: Partial<Employee> = { status, date_of_exit: date, exit_reason: reason.trim() }
  const changes = diff(emp, patch)
  db.update('employees', emp.id, patch)
  const name = `${fullName(emp)} (${emp.emp_code})`
  audit('update', 'employees', emp.id, status === 'exited' ? `Marked ${name} as exited on ${fmtDate(date)}` : `${name} is serving notice — last working day ${fmtDate(date)}`, changes)
}

export function reactivateEmployee(emp: Employee) {
  const patch: Partial<Employee> = { status: 'active', date_of_exit: null, exit_reason: '' }
  const changes = diff(emp, patch)
  db.update('employees', emp.id, patch)
  audit('update', 'employees', emp.id, `Re-activated ${fullName(emp)} (${emp.emp_code})`, changes)
}

/* ─────────────────────────── self-service contact ─────────────────────────── */

/** The only employee columns a self-service user may change (enforced by guard_employees). */
export interface SelfContactValues {
  phone: string
  personal_email: string
  address: string
  city: string
  pincode: string
  blood_group: string
  marital_status: 'single' | 'married'
}

export const selfContactOf = (e: Employee): SelfContactValues => ({
  phone: e.phone, personal_email: e.personal_email, address: e.address, city: e.city, pincode: e.pincode, blood_group: e.blood_group, marital_status: e.marital_status,
})

export function validateSelfContact(f: SelfContactValues): Errors<SelfContactValues> {
  const e: Errors<SelfContactValues> = {}
  const pe = phoneError(f.phone, true)
  if (pe) e.phone = pe
  if (f.personal_email.trim() && !RE.email.test(f.personal_email.trim())) e.personal_email = 'Enter a valid e-mail address'
  if (f.address.length > 300) e.address = 'Keep the address under 300 characters'
  if (f.city.trim().length > 60) e.city = 'Keep it under 60 characters'
  if (f.pincode.trim() && !RE.pincode.test(f.pincode.trim())) e.pincode = 'Pincode is 6 digits, e.g. 561203'
  if (f.blood_group && !BLOOD_GROUPS.includes(f.blood_group)) e.blood_group = 'Pick a blood group from the list'
  if (f.marital_status !== 'single' && f.marital_status !== 'married') e.marital_status = 'Select one'
  return e
}

export function updateOwnContact(emp: Employee, f: SelfContactValues): boolean {
  const patch: Partial<Employee> = {
    phone: normalisePhone(f.phone),
    personal_email: f.personal_email.trim().toLowerCase(),
    address: f.address.trim(),
    city: clean(f.city),
    pincode: f.pincode.trim(),
    blood_group: f.blood_group,
    marital_status: f.marital_status,
  }
  const changes = diff(emp, patch)
  if (!changes) return false
  db.update('employees', emp.id, patch)
  audit('update', 'employees', emp.id, `Updated own contact details: ${Object.keys(changes).map((k) => EMPLOYEE_FIELD_LABELS[k] ?? k).join(', ')}`, changes)
  return true
}

/* ─────────────────────────────── departments ─────────────────────────────── */

export interface DepartmentFormValues {
  code: string
  name: string
  description: string
  head_employee_id: string
  color: string
}

export const departmentToForm = (d?: Department): DepartmentFormValues =>
  d ? { code: d.code, name: d.name, description: d.description, head_employee_id: d.head_employee_id ?? '', color: d.color } : { code: '', name: '', description: '', head_employee_id: '', color: SWATCHES[0]! }

export function validateDepartment(f: DepartmentFormValues, existing?: Department): Errors<DepartmentFormValues> {
  const e: Errors<DepartmentFormValues> = {}
  const others = db.all('departments').filter((d) => d.id !== existing?.id)
  const code = f.code.trim().toUpperCase()
  if (!code) e.code = 'Code is required'
  else if (!/^[A-Z][A-Z0-9]{1,7}$/.test(code)) e.code = '2–8 letters/digits, starting with a letter'
  else if (others.some((d) => d.code.toUpperCase() === code)) e.code = 'Another department uses this code'
  const name = clean(f.name)
  if (!name) e.name = 'Name is required'
  else if (name.length > 60) e.name = 'Keep it under 60 characters'
  else if (others.some((d) => d.name.toLowerCase() === name.toLowerCase())) e.name = 'A department with this name exists'
  if (f.description.length > 300) e.description = 'Keep it under 300 characters'
  if (f.head_employee_id) {
    const h = db.get('employees', f.head_employee_id)
    if (!h) e.head_employee_id = 'Employee not found'
    else if (h.status === 'exited' && h.id !== existing?.head_employee_id) e.head_employee_id = `${fullName(h)} has exited`
  }
  if (!RE.color.test(f.color)) e.color = 'Pick a colour'
  return e
}

export function saveDepartment(f: DepartmentFormValues, existing?: Department): Department {
  const row = { code: f.code.trim().toUpperCase(), name: clean(f.name), description: f.description.trim(), head_employee_id: f.head_employee_id || null, color: f.color.toLowerCase() }
  if (existing) {
    const changes = diff(existing, row)
    if (!changes) return existing
    const d = db.update('departments', existing.id, row)
    audit('update', 'departments', d.id, `Updated department ${d.name} (${d.code})`, changes)
    return d
  }
  const d = db.insert('departments', row)
  audit('create', 'departments', d.id, `Created department ${d.name} (${d.code})`)
  return d
}

export function departmentUsage(id: string) {
  return {
    employees: db.count('employees', (e) => e.department_id === id),
    designations: db.count('designations', (d) => d.department_id === id),
  }
}

export function deleteDepartment(d: Department) {
  const u = departmentUsage(d.id)
  if (u.employees) throw new Error(`${u.employees} employee record${u.employees === 1 ? '' : 's'} (incl. exited) belong to ${d.name}. Move them first.`)
  if (u.designations) throw new Error(`${d.name} still has ${u.designations} designation${u.designations === 1 ? '' : 's'}. Delete or move them first.`)
  db.remove('departments', d.id)
  audit('delete', 'departments', d.id, `Deleted department ${d.name} (${d.code})`)
}

/* ─────────────────────────────── designations ─────────────────────────────── */

export interface DesignationFormValues {
  title: string
  department_id: string
  grade: string
  description: string
}

export const designationToForm = (d?: Designation, departmentId = ''): DesignationFormValues =>
  d ? { title: d.title, department_id: d.department_id, grade: d.grade, description: d.description } : { title: '', department_id: departmentId, grade: '', description: '' }

export function validateDesignation(f: DesignationFormValues, existing?: Designation): Errors<DesignationFormValues> {
  const e: Errors<DesignationFormValues> = {}
  const title = clean(f.title)
  if (!title) e.title = 'Title is required'
  else if (title.length > 80) e.title = 'Keep it under 80 characters'
  if (!f.department_id) e.department_id = 'Select a department'
  else if (!db.get('departments', f.department_id)) e.department_id = 'Department not found'
  if (title && f.department_id && db.find('designations', (d) => d.id !== existing?.id && d.department_id === f.department_id && d.title.toLowerCase() === title.toLowerCase()))
    e.title = 'This department already has that designation'
  if (existing && f.department_id && f.department_id !== existing.department_id) {
    const n = db.count('employees', (x) => x.designation_id === existing.id)
    if (n) e.department_id = `${n} employee${n === 1 ? ' holds' : 's hold'} this designation — move them before changing its department`
  }
  if (f.grade.trim() && !/^[A-Z0-9-]{1,6}$/i.test(f.grade.trim())) e.grade = 'Up to 6 letters/digits, e.g. W2 or M1'
  if (f.description.length > 300) e.description = 'Keep it under 300 characters'
  return e
}

export function saveDesignation(f: DesignationFormValues, existing?: Designation): Designation {
  const row = { title: clean(f.title), department_id: f.department_id, grade: f.grade.trim().toUpperCase(), description: f.description.trim() }
  if (existing) {
    const changes = diff(existing, row)
    if (!changes) return existing
    const d = db.update('designations', existing.id, row)
    audit('update', 'designations', d.id, `Updated designation ${d.title}`, changes)
    return d
  }
  const d = db.insert('designations', row)
  audit('create', 'designations', d.id, `Created designation ${d.title} (${db.get('departments', d.department_id)?.name ?? '—'})`)
  return d
}

export function deleteDesignation(d: Designation) {
  const n = db.count('employees', (e) => e.designation_id === d.id)
  if (n) throw new Error(`${n} employee record${n === 1 ? '' : 's'} (incl. exited) use “${d.title}”. Change their designation first.`)
  db.remove('designations', d.id)
  audit('delete', 'designations', d.id, `Deleted designation ${d.title}`)
}

/* ──────────────────────────── emergency contacts ──────────────────────────── */

export interface ContactFormValues {
  name: string
  relation: string
  phone: string
  address: string
  is_primary: boolean
}

export const contactToForm = (c?: EmergencyContact, first = false): ContactFormValues =>
  c ? { name: c.name, relation: c.relation, phone: c.phone, address: c.address, is_primary: c.is_primary } : { name: '', relation: '', phone: '', address: '', is_primary: first }

export function validateContact(f: ContactFormValues): Errors<ContactFormValues> {
  const e: Errors<ContactFormValues> = {}
  const name = clean(f.name)
  if (name.length < 2) e.name = 'Name is required'
  else if (name.length > 80) e.name = 'Keep it under 80 characters'
  if (!f.relation.trim()) e.relation = 'Select the relation'
  const pe = phoneError(f.phone, true)
  if (pe) e.phone = pe
  if (f.address.length > 300) e.address = 'Keep it under 300 characters'
  return e
}

/** Insert/update a contact, keeping exactly one primary per employee. */
export function saveContact(employeeId: string, f: ContactFormValues, existing?: EmergencyContact): EmergencyContact {
  const others = db.where('emergency_contacts', (c) => c.employee_id === employeeId && c.id !== existing?.id)
  const primary = f.is_primary || !!existing?.is_primary || !others.some((c) => c.is_primary)
  const row = { name: clean(f.name), relation: f.relation.trim(), phone: normalisePhone(f.phone), address: f.address.trim(), is_primary: primary }
  const who = fullName(db.get('employees', employeeId))
  return db.batch(() => {
    if (primary) for (const o of others.filter((c) => c.is_primary)) db.update('emergency_contacts', o.id, { is_primary: false })
    if (existing) {
      const changes = diff(existing, row)
      const c = db.update('emergency_contacts', existing.id, row)
      if (changes) audit('update', 'emergency_contacts', c.id, `Updated emergency contact ${c.name} for ${who}`, changes)
      return c
    }
    const c = db.insert('emergency_contacts', { employee_id: employeeId, ...row })
    audit('create', 'emergency_contacts', c.id, `Added emergency contact ${c.name} (${c.relation}) for ${who}`)
    return c
  })
}

export function setPrimaryContact(c: EmergencyContact) {
  if (c.is_primary) return
  db.batch(() => {
    for (const o of db.where('emergency_contacts', (x) => x.employee_id === c.employee_id && x.is_primary)) db.update('emergency_contacts', o.id, { is_primary: false })
    db.update('emergency_contacts', c.id, { is_primary: true })
  })
  audit('update', 'emergency_contacts', c.id, `Made ${c.name} the primary emergency contact for ${fullName(db.get('employees', c.employee_id))}`, { is_primary: { from: false, to: true } })
}

export function deleteContact(c: EmergencyContact) {
  const rest = db.where('emergency_contacts', (x) => x.employee_id === c.employee_id && x.id !== c.id)
  db.batch(() => {
    db.remove('emergency_contacts', c.id)
    if (c.is_primary && rest.length && !rest.some((x) => x.is_primary)) db.update('emergency_contacts', rest[0]!.id, { is_primary: true })
  })
  audit('delete', 'emergency_contacts', c.id, `Removed emergency contact ${c.name} for ${fullName(db.get('employees', c.employee_id))}`)
}

/* ─────────────────────────────── documents ─────────────────────────────── */

export interface DocumentFormValues {
  doc_type: DocumentType
  title: string
  expiry_date: string
  file: File | null
}

export const ACCEPTED_DOCS = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx'

export function validateDocument(f: DocumentFormValues): Errors<DocumentFormValues> {
  const e: Errors<DocumentFormValues> = {}
  if (!DOC_TYPES.some((d) => d.value === f.doc_type)) e.doc_type = 'Select a document type'
  const title = clean(f.title)
  if (!title) e.title = 'Title is required'
  else if (title.length > 120) e.title = 'Keep it under 120 characters'
  if (f.expiry_date && !isDate(f.expiry_date)) e.expiry_date = 'Enter a valid date'
  if (!f.file) e.file = 'Choose a file to upload'
  else if (f.file.size > MAX_FILE_BYTES) e.file = 'File is larger than 10 MB'
  else if (f.file.size === 0) e.file = 'This file is empty'
  else if (!/\.(pdf|jpe?g|png|webp|docx?)$/i.test(f.file.name)) e.file = 'Upload a PDF, image or Word document'
  return e
}

export async function uploadDocument(employeeId: string, f: DocumentFormValues): Promise<EmployeeDocument> {
  const file = f.file!
  const stored = await storeFile(file, employeeId, 'documents')
  const row = db.insert('employee_documents', {
    employee_id: employeeId,
    doc_type: f.doc_type,
    title: clean(f.title),
    file_name: file.name.slice(-120),
    file_type: file.type || 'application/octet-stream',
    file_size: file.size,
    file_data: stored,
    expiry_date: f.expiry_date || null,
    verified: false,
    uploaded_by: currentSession()?.user.id ?? null,
  })
  const self = currentSession()?.employee?.id === employeeId
  audit('create', 'employee_documents', row.id, `Uploaded ${row.title}${self ? '' : ` for ${fullName(db.get('employees', employeeId))}`}`)
  return row
}

export function setDocumentVerified(doc: EmployeeDocument, verified: boolean) {
  db.update('employee_documents', doc.id, { verified })
  audit('update', 'employee_documents', doc.id, `${verified ? 'Verified' : 'Un-verified'} ${doc.title} of ${fullName(db.get('employees', doc.employee_id))}`, { verified: { from: doc.verified, to: verified } })
}

export function deleteDocument(doc: EmployeeDocument) {
  db.remove('employee_documents', doc.id)
  void removeStored(doc.file_data)
  audit('delete', 'employee_documents', doc.id, `Deleted ${doc.title} of ${fullName(db.get('employees', doc.employee_id))}`)
}

export function documentExpiry(doc: Pick<EmployeeDocument, 'expiry_date'>, today = todayISO()): 'expired' | 'soon' | null {
  if (!doc.expiry_date) return null
  if (doc.expiry_date < today) return 'expired'
  return diffDays(today, doc.expiry_date) <= 30 ? 'soon' : null
}

/* ──────────────────────────────── salary ──────────────────────────────── */

/** Structure in force today (else the earliest future one), newest first among rows. */
export function currentStructure(rows: SalaryStructure[], employeeId: string, today = todayISO()): SalaryStructure | null {
  const mine = rows.filter((s) => s.employee_id === employeeId).sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  return mine.find((s) => s.effective_from <= today) ?? mine[mine.length - 1] ?? null
}

/* ──────────────────────────────── settings ──────────────────────────────── */

/** Save one tab of company settings. Returns false when nothing changed. */
export function saveSettings(patch: Partial<CompanySettings>, what: string): boolean {
  const before = db.settings()
  const changes = deepDiff(before, patch)
  if (!changes) return false
  db.update('company_settings', before.id, patch)
  audit('update', 'company_settings', before.id, `Updated ${what} settings (${Object.keys(changes).length} field${Object.keys(changes).length === 1 ? '' : 's'})`, changes)
  return true
}

/* ──────────────────────────────── directors ──────────────────────────────── */

export const DIRECTOR_DESIGNATIONS = ['Director', 'Managing Director', 'Whole-time Director', 'Additional Director', 'Independent Director', 'Nominee Director']

export interface DirectorFormValues {
  name: string
  designation: string
  din: string
  appointed_on: string
  other_directorships: string[]
}

export const directorToForm = (d?: Director): DirectorFormValues =>
  d ? { name: d.name, designation: d.designation, din: d.din, appointed_on: d.appointed_on, other_directorships: [...d.other_directorships] } : { name: '', designation: 'Director', din: '', appointed_on: '', other_directorships: [] }

export function validateDirector(f: DirectorFormValues, existing?: Director): Errors<DirectorFormValues> {
  const e: Errors<DirectorFormValues> = {}
  const name = clean(f.name)
  if (name.length < 3) e.name = 'Full name is required'
  else if (name.length > 100) e.name = 'Keep it under 100 characters'
  if (!f.designation.trim()) e.designation = 'Designation is required'
  const din = f.din.trim()
  if (!din) e.din = 'DIN is required'
  else if (!RE.din.test(din)) e.din = 'DIN is exactly 8 digits'
  else if (db.find('directors', (d) => d.id !== existing?.id && d.din === din)) e.din = 'Another director has this DIN'
  const inc = db.settings().incorporated_on
  if (!isDate(f.appointed_on)) e.appointed_on = 'Appointment date is required'
  else if (f.appointed_on > todayISO()) e.appointed_on = 'Cannot be in the future'
  else if (inc && f.appointed_on < inc) e.appointed_on = `Must be on or after incorporation (${fmtDate(inc)})`
  if (f.other_directorships.length > 30) e.other_directorships = 'Up to 30 companies'
  return e
}

export function saveDirector(f: DirectorFormValues, existing?: Director): Director {
  const row = { name: clean(f.name), designation: clean(f.designation), din: f.din.trim(), appointed_on: f.appointed_on, other_directorships: normaliseList(f.other_directorships, 120) }
  if (existing) {
    const changes = diff(existing, row)
    if (!changes) return existing
    const d = db.update('directors', existing.id, row)
    audit('update', 'directors', d.id, `Updated director ${d.name} (DIN ${d.din})`, changes)
    return d
  }
  const d = db.insert('directors', row)
  audit('create', 'directors', d.id, `Added director ${d.name} (DIN ${d.din})`)
  return d
}

export function deleteDirector(d: Director) {
  db.remove('directors', d.id)
  audit('delete', 'directors', d.id, `Removed director ${d.name} (DIN ${d.din})`)
}

/* ──────────────────────────────── roles ──────────────────────────────── */

export interface PermissionModule {
  key: string
  label: string
  view?: Permission
  manage?: Permission
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'dashboard', label: 'Dashboard', view: 'dashboard.view' },
  { key: 'employees', label: 'Employees', view: 'employees.view', manage: 'employees.manage' },
  { key: 'attendance', label: 'Attendance', view: 'attendance.view', manage: 'attendance.manage' },
  { key: 'leaves', label: 'Leaves & holidays', view: 'leaves.view', manage: 'leaves.manage' },
  { key: 'payroll', label: 'Payroll', view: 'payroll.view', manage: 'payroll.manage' },
  { key: 'petty_cash', label: 'Petty cash', view: 'petty_cash.view', manage: 'petty_cash.manage' },
  { key: 'tasks', label: 'Tasks', view: 'tasks.view', manage: 'tasks.manage' },
  { key: 'announcements', label: 'Announcements', manage: 'announcements.manage' },
  { key: 'machines', label: 'Machines & maintenance', view: 'machines.view', manage: 'machines.manage' },
  { key: 'inventory', label: 'Inventory & assets', view: 'inventory.view', manage: 'inventory.manage' },
  { key: 'purchase', label: 'Vendors & purchase', view: 'purchase.view', manage: 'purchase.manage' },
  { key: 'sales', label: 'Customers & work orders', view: 'sales.view', manage: 'sales.manage' },
  { key: 'quality', label: 'Quality', view: 'quality.view', manage: 'quality.manage' },
  { key: 'reports', label: 'Reports', view: 'reports.view' },
  { key: 'users', label: 'Users & roles', manage: 'users.manage' },
  { key: 'audit', label: 'Audit log', view: 'audit.view' },
  { key: 'settings', label: 'Settings', manage: 'settings.manage' },
]

export const ALL_PERMISSIONS: Permission[] = PERMISSION_MODULES.flatMap((m) => [m.view, m.manage].filter((p): p is Permission => !!p))

export interface RoleFormValues {
  key: string
  name: string
  description: string
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40)

export function validateRole(f: RoleFormValues, existing?: Role): Errors<RoleFormValues> {
  const e: Errors<RoleFormValues> = {}
  const roles = db.all('roles').filter((r) => r.id !== existing?.id)
  if (!existing) {
    const key = f.key.trim()
    if (!key) e.key = 'Key is required'
    else if (!RE.roleKey.test(key)) e.key = 'Lowercase letters, digits and _ ; start with a letter'
    else if (key.length > 40) e.key = 'Keep it under 40 characters'
    else if (roles.some((r) => r.key === key)) e.key = 'This key is already used'
  }
  const name = clean(f.name)
  if (!name) e.name = 'Name is required'
  else if (name.length > 60) e.name = 'Keep it under 60 characters'
  else if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase())) e.name = 'Another role has this name'
  if (f.description.length > 240) e.description = 'Keep it under 240 characters'
  return e
}

export function createRole(f: RoleFormValues, permissions: Permission[], isAdminPortal: boolean): Role {
  const r = db.insert('roles', { key: f.key.trim(), name: clean(f.name), description: f.description.trim(), permissions: sortPerms(permissions), is_admin_portal: isAdminPortal, is_system: false })
  audit('create', 'roles', r.id, `Created role ${r.name} (${r.key}) with ${r.permissions.length} permissions`)
  return r
}

const sortPerms = (ps: Permission[]) => ALL_PERMISSIONS.filter((p) => ps.includes(p))

/** Update a role's name/description/permissions/portal. Guards against locking yourself out. */
export function updateRole(role: Role, patch: { name: string; description: string; permissions: Permission[]; is_admin_portal: boolean }): Role {
  const s = currentSession()
  const isSuper = role.key === 'super_admin'
  const next = {
    name: clean(patch.name),
    description: patch.description.trim(),
    permissions: isSuper ? [...ALL_PERMISSIONS] : sortPerms(patch.permissions),
    is_admin_portal: isSuper ? true : patch.is_admin_portal,
  }
  if (s && s.role.id === role.id) {
    if (!next.permissions.includes('users.manage')) throw new Error('You would lose access to Users & roles. Give this permission to another role first.')
    if (!next.is_admin_portal) throw new Error('Your own role must keep the Admin portal.')
  }
  if (role.is_admin_portal && !next.is_admin_portal) {
    const unlinked = db.count('app_users', (u) => u.role_id === role.id && !u.employee_id)
    if (unlinked) throw new Error(`${unlinked} login${unlinked === 1 ? '' : 's'} on this role ${unlinked === 1 ? 'has' : 'have'} no linked employee and could not open My space. Link them first.`)
  }
  if (role.permissions.includes('users.manage') && !next.permissions.includes('users.manage') && userManagersExcept(null, role.id) === 0)
    throw new Error('At least one active login must keep “Users & roles — manage”.')
  const changes = diff(role, next)
  if (!changes) return role
  const r = db.update('roles', role.id, next)
  const added = next.permissions.filter((p) => !role.permissions.includes(p))
  const removed = role.permissions.filter((p) => !next.permissions.includes(p))
  const bits = [added.length && `+${added.length}`, removed.length && `−${removed.length}`].filter(Boolean).join(' / ')
  audit('update', 'roles', r.id, `Updated role ${r.name}${bits ? ` (permissions ${bits})` : ''}`, changes)
  return r
}

export function deleteRole(role: Role) {
  if (role.is_system) throw new Error('System roles cannot be deleted.')
  const n = db.count('app_users', (u) => u.role_id === role.id)
  if (n) throw new Error(`${n} login${n === 1 ? ' uses' : 's use'} this role. Move them to another role first.`)
  db.remove('roles', role.id)
  audit('delete', 'roles', role.id, `Deleted role ${role.name} (${role.key})`)
}

/**
 * Active logins holding users.manage, ignoring `excludeUserId` and (optionally) everyone on
 * `excludeRoleId`. Used to stop the last user administrator being removed.
 */
export function userManagersExcept(excludeUserId: string | null, excludeRoleId?: string): number {
  const roles = new Set(db.all('roles').filter((r) => r.id !== excludeRoleId && r.permissions.includes('users.manage')).map((r) => r.id))
  return db.count('app_users', (u) => u.active && u.id !== excludeUserId && roles.has(u.role_id))
}

/* ──────────────────────────────── passwords ──────────────────────────────── */

/** Random password without look-alike characters; always has upper, lower, digit and symbol. */
export function generatePassword(length = 14): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_']
  const all = sets.join('')
  const rand = (n: number) => {
    const b = new Uint32Array(1)
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b)
    else b[0] = Math.floor(Math.random() * 2 ** 32)
    return b[0]! % n
  }
  const chars = sets.map((s) => s[rand(s.length)]!)
  while (chars.length < Math.max(8, length)) chars.push(all[rand(all.length)]!)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  color: string
}

export function passwordStrength(pw: string): Strength {
  const labels: [string, string][] = [['Too short', '#e11d48'], ['Weak', '#f97316'], ['Fair', '#f59e0b'], ['Good', '#10b981'], ['Strong', '#059669']]
  let score = 0
  if (pw.length >= 8) {
    score = 1
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
    if (pw.length >= 12) score++
    if (classes >= 3) score++
    if (classes === 4 && pw.length >= 10) score++
    if (/^(password|melstar|qwerty|admin|welcome|12345)/i.test(pw) || /(.)\1{3,}/.test(pw) || classes === 1) score = Math.min(score, 1)
  }
  const s = Math.max(0, Math.min(4, score)) as Strength['score']
  return { score: s, label: labels[s]![0], color: labels[s]![1] }
}
