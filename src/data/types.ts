/**
 * Row types for every table in the Melstar ERP.
 *
 * Field names are snake_case on purpose: they are the exact Postgres column names in
 * supabase/migrations/*.sql, so the same objects flow through static mode (IndexedDB)
 * and Supabase mode without any mapping layer.
 *
 * Conventions
 *  - id: uuid string. created_at / updated_at: ISO timestamps (set by the store).
 *  - Dates without time: 'YYYY-MM-DD'. Months: 'YYYY-MM'. Times of day: 'HH:MM'.
 *  - Money: rupees as numbers (2-dp precision at most). Quantities: numbers.
 */

export type ISODate = string // 'YYYY-MM-DD'
export type ISODateTime = string // full ISO timestamp
export type YearMonth = string // 'YYYY-MM'
export type HHMM = string // '09:00'

export interface BaseRow {
  id: string
  created_at: ISODateTime
  updated_at: ISODateTime
}

/* ───────────────────────────── Company / admin ───────────────────────────── */

export interface PtSlab {
  /** Monthly gross salary lower bound (inclusive). */
  min: number
  /** Upper bound (inclusive); null = no upper bound. */
  max: number | null
  /** Monthly tax amount. */
  amount: number
  /** Tax amount charged in February instead of `amount` (Karnataka: ₹300). */
  feb_amount?: number
}

export interface TaxSlab {
  upto: number | null // annual taxable income upper bound; null = above
  rate: number // percent
}

export interface PayrollConfig {
  pf_employee_rate: number // 12
  pf_employer_epf_rate: number // 3.67
  pf_employer_eps_rate: number // 8.33
  pf_edli_rate: number // 0.5
  pf_admin_rate: number // 0.5
  pf_wage_ceiling: number // 15000
  pf_restrict_to_ceiling: boolean // compute employee PF on min(wages, ceiling)
  esi_wage_threshold: number // 21000
  esi_employee_rate: number // 0.75
  esi_employer_rate: number // 3.25
  pt_state: string // 'Karnataka'
  pt_slabs: PtSlab[]
  tds_new_regime_slabs: TaxSlab[]
  tds_new_standard_deduction: number // 75000
  tds_new_rebate_limit: number // 1200000 (87A)
  tds_old_regime_slabs: TaxSlab[]
  tds_old_standard_deduction: number // 50000
  tds_old_rebate_limit: number // 500000
  tds_cess_rate: number // 4
  ot_multiplier: number // 2 (Factories Act s.59)
  ot_base_days: number // 26 working days used for hourly rate
  ot_hours_per_day: number // 8
  pay_day: number // salary credited on this day of next month
}

export interface AttendancePolicy {
  late_marks_per_half_day: number // e.g. 3 late marks = 0.5 day LOP
  min_ot_minutes: number // OT counted only above this many minutes past shift end
  geofence_radius_m: number // check-ins outside this distance get flagged
  auto_absent_after: HHMM // shown as absent on the live board if no punch by this time
  allow_web_checkin: boolean
}

export interface CompanySettings extends BaseRow {
  legal_name: string
  short_name: string
  cin: string
  incorporated_on: ISODate
  roc: string
  company_type: string
  company_category: string
  listing_status: string
  status: string
  authorised_capital: number
  paid_up_capital: number
  sectors: string[]
  business_activity: string
  registered_office: string
  plant_address: string
  plant_lat: number
  plant_lng: number
  plus_code: string
  phone: string
  email: string
  website: string
  gstin: string
  pan: string
  tan: string
  pf_establishment_code: string
  esi_employer_code: string
  pt_registration_no: string
  financial_year_start_month: number // 4 = April
  working_days: number[] // 1..6 = Mon..Sat (0 = Sunday)
  plant_open: HHMM
  plant_close: HHMM
  payroll: PayrollConfig
  attendance: AttendancePolicy
  petty_cash_imprest: number // float the cash box is topped up to
  petty_cash_low_alert: number // alert when balance falls below
  petty_cash_approval_limit: number // vouchers above this need Super Admin approval
  petty_cash_categories: string[]
  currency: string // 'INR'
  timezone: string // 'Asia/Kolkata'
  /** Demo only: simulate biometric punches for days nobody punched (switch off at go-live). */
  demo_autopilot: boolean
  demo_autopilot_through: ISODate | null
}

export interface Director extends BaseRow {
  name: string
  designation: string
  din: string
  appointed_on: ISODate
  other_directorships: string[]
}

export type Permission =
  | 'dashboard.view'
  | 'employees.view' | 'employees.manage'
  | 'attendance.view' | 'attendance.manage'
  | 'leaves.view' | 'leaves.manage'
  | 'payroll.view' | 'payroll.manage'
  | 'petty_cash.view' | 'petty_cash.manage'
  | 'tasks.view' | 'tasks.manage'
  | 'announcements.manage'
  | 'machines.view' | 'machines.manage'
  | 'inventory.view' | 'inventory.manage'
  | 'purchase.view' | 'purchase.manage'
  | 'sales.view' | 'sales.manage'
  | 'quality.view' | 'quality.manage'
  | 'reports.view'
  | 'users.manage'
  | 'audit.view'
  | 'settings.manage'

export interface Role extends BaseRow {
  key: string // 'super_admin' | 'hr_manager' | 'accounts' | 'supervisor' | 'employee' | custom
  name: string
  description: string
  permissions: Permission[]
  /** true → opens the Admin portal; false → Employee self-service portal only. */
  is_admin_portal: boolean
  is_system: boolean
}

export interface AppUser extends BaseRow {
  email: string
  display_name: string
  role_id: string
  employee_id: string | null
  /** Static mode only: SHA-256(salt + password). Supabase mode uses auth.users instead (null). */
  password_hash: string | null
  password_salt: string | null
  active: boolean
  last_login_at: ISODateTime | null
  /** Supabase mode: auth.users.id */
  auth_user_id: string | null
}

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'cancel'
  | 'login' | 'logout' | 'export' | 'process' | 'pay' | 'check_in' | 'check_out' | 'reset'

export interface AuditLog extends BaseRow {
  at: ISODateTime
  user_id: string | null
  user_name: string
  action: AuditAction
  entity: string // table name or module
  entity_id: string | null
  summary: string
  changes: Record<string, { from: unknown; to: unknown }> | null
}

export type NotificationType =
  | 'leave' | 'attendance' | 'task' | 'payroll' | 'petty_cash' | 'announcement'
  | 'maintenance' | 'inventory' | 'purchase' | 'quality' | 'system'

export interface AppNotification extends BaseRow {
  user_id: string
  type: NotificationType
  title: string
  body: string
  link: string | null
  read: boolean
}

/* ───────────────────────────────── HR ───────────────────────────────── */

export interface Department extends BaseRow {
  code: string
  name: string
  description: string
  head_employee_id: string | null
  color: string
}

export interface Designation extends BaseRow {
  title: string
  department_id: string
  grade: string // 'M1', 'E2', 'S1', 'W2' ...
  description: string
}

export type EmploymentType = 'permanent' | 'contract' | 'trainee' | 'apprentice' | 'probation'
export type EmployeeStatus = 'active' | 'on_notice' | 'exited'
export type Gender = 'male' | 'female' | 'other'
export type TaxRegime = 'new' | 'old'

export interface Employee extends BaseRow {
  emp_code: string // 'MMS-1005'
  first_name: string
  last_name: string
  gender: Gender
  dob: ISODate
  phone: string
  email: string // official
  personal_email: string
  address: string
  city: string
  state: string
  pincode: string
  department_id: string
  designation_id: string
  reporting_to: string | null
  employment_type: EmploymentType
  date_of_joining: ISODate
  date_of_exit: ISODate | null
  exit_reason: string
  status: EmployeeStatus
  shift_id: string
  work_centre_id: string | null
  blood_group: string
  marital_status: 'single' | 'married'
  pan: string
  aadhaar_masked: string // 'XXXX-XXXX-1234' — never store the full Aadhaar number
  uan: string
  esic_no: string
  bank_name: string
  bank_account: string
  ifsc: string
  photo: string | null // data URL (static) / storage URL (Supabase)
  skills: string[]
  tax_regime: TaxRegime
  /** Old-regime annual deductions declared (80C, 80D, HRA exemption …). Ignored for new regime. */
  declared_deductions: number
  notes: string
}

export interface EmergencyContact extends BaseRow {
  employee_id: string
  name: string
  relation: string
  phone: string
  address: string
  is_primary: boolean
}

export type DocumentType =
  | 'aadhaar' | 'pan' | 'offer_letter' | 'appointment_letter' | 'education'
  | 'experience' | 'bank_proof' | 'photo' | 'medical' | 'training' | 'other'

export interface EmployeeDocument extends BaseRow {
  employee_id: string
  doc_type: DocumentType
  title: string
  file_name: string
  file_type: string
  file_size: number
  file_data: string | null // data URL in static mode; storage path in Supabase mode
  expiry_date: ISODate | null
  verified: boolean
  uploaded_by: string | null
}

/* ───────────────────────────── Attendance ───────────────────────────── */

export interface Shift extends BaseRow {
  code: string
  name: string
  start_time: HHMM
  end_time: HHMM
  break_minutes: number
  grace_minutes: number
  half_day_minutes: number // worked minutes below this → half day
  full_day_minutes: number // worked minutes for a full day
  weekly_offs: number[] // 0 = Sunday
  color: string
  active: boolean
}

/** Status stored on a punch row. Days without a row are derived (absent/holiday/week-off/leave). */
export type AttendanceStatus = 'present' | 'half_day' | 'absent' | 'on_duty'
export type OtStatus = 'none' | 'pending' | 'approved' | 'rejected'
export type PunchSource = 'web' | 'mobile' | 'biometric' | 'manual' | 'regularised'

export interface AttendanceRecord extends BaseRow {
  employee_id: string
  date: ISODate
  shift_id: string
  check_in: ISODateTime | null
  check_out: ISODateTime | null
  status: AttendanceStatus
  late_minutes: number
  early_exit_minutes: number
  worked_minutes: number
  ot_minutes: number
  ot_status: OtStatus
  source: PunchSource
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_distance_m: number | null
  remarks: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Regularisation extends BaseRow {
  employee_id: string
  date: ISODate
  requested_check_in: HHMM | null
  requested_check_out: HHMM | null
  requested_status: AttendanceStatus
  reason: string
  status: ApprovalStatus
  reviewed_by: string | null
  reviewed_at: ISODateTime | null
  review_note: string
}

/* ──────────────────────────────── Leaves ──────────────────────────────── */

export interface LeaveType extends BaseRow {
  code: string // CL, SL, EL, CO, ML, LOP
  name: string
  annual_quota: number
  paid: boolean
  carry_forward: boolean
  max_carry_forward: number
  allow_half_day: boolean
  /** Requires a supporting document when the leave is longer than this many days (0 = never). */
  document_after_days: number
  gender: Gender | null // null = all
  color: string
  active: boolean
}

export interface LeaveBalance extends BaseRow {
  employee_id: string
  leave_type_id: string
  year: number // financial year start, e.g. 2026 = FY 2026-27
  opening: number // carried forward
  allotted: number // entitlement for the year (pro-rated for mid-year joiners)
  adjustment: number // manual +/- (comp-off credits, encashment …)
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveRequest extends BaseRow {
  employee_id: string
  leave_type_id: string
  from_date: ISODate
  to_date: ISODate
  half_day: boolean
  half_day_session: 'first' | 'second' | null
  days: number // working days counted (week-offs and holidays excluded)
  reason: string
  status: LeaveStatus
  applied_at: ISODateTime
  reviewed_by: string | null
  reviewed_at: ISODateTime | null
  review_note: string
  attachment: string | null
}

export type HolidayType = 'national' | 'festival' | 'optional' | 'company'

export interface Holiday extends BaseRow {
  date: ISODate
  name: string
  type: HolidayType
  description: string
}

/* ──────────────────────────────── Payroll ──────────────────────────────── */

export interface SalaryStructure extends BaseRow {
  employee_id: string
  effective_from: ISODate
  ctc_annual: number
  // monthly components
  basic: number
  da: number
  hra: number
  conveyance: number
  special_allowance: number
  other_allowance: number
  pf_applicable: boolean
  esi_applicable: boolean // auto when gross ≤ threshold, can be forced off
  pt_applicable: boolean
  ot_eligible: boolean
  /** Optional override; otherwise (basic+da)/26/8 × multiplier. */
  ot_rate_per_hour: number | null
  notes: string
}

export type PayrollRunStatus = 'draft' | 'processed' | 'approved' | 'paid'

export interface PayrollRun extends BaseRow {
  month: YearMonth
  status: PayrollRunStatus
  employee_count: number
  total_gross: number
  total_deductions: number
  total_net: number
  total_employer_cost: number
  processed_at: ISODateTime | null
  processed_by: string | null
  approved_at: ISODateTime | null
  approved_by: string | null
  paid_at: ISODateTime | null
  payment_ref: string
  notes: string
}

export interface Payslip extends BaseRow {
  run_id: string
  employee_id: string
  month: YearMonth
  days_in_month: number
  working_days: number
  present_days: number
  paid_leave_days: number
  holidays: number
  week_offs: number
  lop_days: number
  late_marks: number
  paid_days: number
  ot_hours: number
  // earnings
  basic: number
  da: number
  hra: number
  conveyance: number
  special_allowance: number
  other_allowance: number
  ot_pay: number
  bonus: number
  arrears: number
  gross_earnings: number
  // deductions
  pf_employee: number
  esi_employee: number
  professional_tax: number
  tds: number
  advance_recovery: number
  loan_recovery: number
  other_deductions: number
  total_deductions: number
  net_pay: number
  // employer contributions
  pf_employer_epf: number
  pf_employer_eps: number
  pf_edli: number
  pf_admin: number
  esi_employer: number
  employer_cost: number
  pf_wages: number
  esi_wages: number
  tax_regime: TaxRegime
  published: boolean
  remarks: string
}

export type AdvanceType = 'salary_advance' | 'loan'
export type AdvanceStatus = 'pending' | 'approved' | 'rejected' | 'active' | 'closed'

export interface Advance extends BaseRow {
  employee_id: string
  type: AdvanceType
  amount: number
  reason: string
  requested_on: ISODate
  status: AdvanceStatus
  installments: number
  emi_amount: number
  start_month: YearMonth // first month of recovery
  approved_by: string | null
  approved_at: ISODateTime | null
  disbursed_on: ISODate | null
  review_note: string
}

export interface AdvanceRecovery extends BaseRow {
  advance_id: string
  payslip_id: string
  month: YearMonth
  amount: number
}

/* ────────────────────────────── Petty cash ────────────────────────────── */

export interface PettyCashEntry extends BaseRow {
  entry_no: string // PC/2026-27/0001
  date: ISODate
  type: 'in' | 'out'
  amount: number
  category: string // for 'in': 'Imprest top-up' | 'Refund' …
  description: string
  voucher_id: string | null
  created_by: string | null
}

export type VoucherStatus = 'pending' | 'approved' | 'rejected' | 'paid'

export interface PettyCashVoucher extends BaseRow {
  voucher_no: string // PCV/2026-27/0001
  employee_id: string
  date: ISODate
  category: string
  amount: number
  payee: string
  description: string
  bill_no: string
  attachment: string | null
  status: VoucherStatus
  reviewed_by: string | null
  reviewed_at: ISODateTime | null
  review_note: string
  paid_at: ISODateTime | null
  ledger_entry_id: string | null
}

/* ──────────────────────────────── Tasks ──────────────────────────────── */

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Task extends BaseRow {
  task_no: string // T-0001
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee_ids: string[] // employee ids
  created_by: string | null // app user id
  due_date: ISODate | null
  labels: string[]
  work_centre_id: string | null
  checklist: ChecklistItem[]
  sort_order: number
  completed_at: ISODateTime | null
}

export interface TaskComment extends BaseRow {
  task_id: string
  /** Null once the author's login has been deleted (author_name keeps the name). */
  author_user_id: string | null
  author_name: string
  body: string
}

export interface Todo extends BaseRow {
  user_id: string
  text: string
  done: boolean
  due_date: ISODate | null
}

/* ─────────────────────── Announcements / comms ─────────────────────── */

export type AnnouncementCategory = 'general' | 'safety' | 'hr' | 'production' | 'celebration' | 'holiday'

export interface Announcement extends BaseRow {
  title: string
  body: string
  category: AnnouncementCategory
  priority: 'normal' | 'important' | 'urgent'
  /** Empty array = everyone; otherwise department ids. */
  audience_department_ids: string[]
  pinned: boolean
  published_at: ISODateTime
  expires_on: ISODate | null
  created_by: string | null
  author_name: string
}

export interface AnnouncementRead extends BaseRow {
  announcement_id: string
  user_id: string
  read_at: ISODateTime
}

/* ────────────────────── Machines & maintenance ────────────────────── */

export interface WorkCentre extends BaseRow {
  code: string
  name: string
  description: string
  color: string
  supervisor_id: string | null
}

export type MachineStatus = 'running' | 'idle' | 'breakdown' | 'maintenance'

export interface Machine extends BaseRow {
  asset_code: string
  name: string
  make: string
  model: string
  serial_no: string
  work_centre_id: string
  install_date: ISODate
  status: MachineStatus
  criticality: 'A' | 'B' | 'C'
  hour_meter: number
  specs: string
  notes: string
}

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

export interface MaintenanceSchedule extends BaseRow {
  machine_id: string
  title: string
  frequency: Frequency
  last_done: ISODate | null
  next_due: ISODate
  checklist: string[]
  assigned_to: string | null // employee id
  active: boolean
}

export type MaintenanceType = 'preventive' | 'breakdown' | 'corrective' | 'calibration'

export interface SpareUsed {
  item_id: string
  qty: number
}

export interface MaintenanceLog extends BaseRow {
  log_no: string // MNT-0001
  machine_id: string
  type: MaintenanceType
  schedule_id: string | null
  reported_at: ISODateTime
  started_at: ISODateTime | null
  completed_at: ISODateTime | null
  downtime_minutes: number
  problem: string
  action_taken: string
  root_cause: string
  technician_id: string | null
  spares: SpareUsed[]
  cost: number
  status: 'open' | 'in_progress' | 'closed'
}

/* ─────────────────────── Inventory / tools / assets ─────────────────────── */

export type ItemCategory = 'raw_material' | 'consumable' | 'tooling' | 'spare' | 'finished_good' | 'packing'

export interface InventoryItem extends BaseRow {
  sku: string
  name: string
  category: ItemCategory
  uom: string // 'kg' | 'nos' | 'm' | 'ltr' | 'sheet' | 'box'
  stock_qty: number
  reorder_level: number
  unit_cost: number
  location: string
  hsn: string
  preferred_vendor_id: string | null
  active: boolean
}

export type StockMovementType = 'in' | 'out' | 'adjust'

export interface StockMovement extends BaseRow {
  item_id: string
  date: ISODate
  type: StockMovementType
  qty: number // always positive; type gives direction ('adjust' may be +/-)
  balance_after: number
  reference: string // 'PO/2026-27/0004', 'WO-1021', 'MNT-0012'
  reason: string
  by_user_id: string | null
}

export interface ToolIssue extends BaseRow {
  item_id: string
  employee_id: string
  qty: number
  issued_on: ISODate
  due_back: ISODate | null
  returned_on: ISODate | null
  returned_qty: number
  condition: 'good' | 'worn' | 'broken' | null
  status: 'issued' | 'returned' | 'lost'
  remarks: string
}

export type AssetCategory = 'it' | 'gauge' | 'instrument' | 'furniture' | 'vehicle' | 'tool' | 'equipment'

export interface Asset extends BaseRow {
  asset_code: string
  name: string
  category: AssetCategory
  make: string
  serial_no: string
  purchase_date: ISODate | null
  cost: number
  location: string
  custodian_id: string | null
  calibration_required: boolean
  calibration_interval_days: number
  last_calibrated: ISODate | null
  calibration_due: ISODate | null
  certificate_no: string
  status: 'in_use' | 'in_store' | 'repair' | 'disposed'
}

/* ───────────────────── Customers / vendors / purchase / production ───────────────────── */

export interface Customer extends BaseRow {
  code: string
  name: string
  contact_person: string
  phone: string
  email: string
  gstin: string
  address: string
  city: string
  state: string
  payment_terms_days: number
  credit_limit: number
  active: boolean
  notes: string
}

export interface Vendor extends BaseRow {
  code: string
  name: string
  category: string // 'Steel & raw material' | 'Cutting tools' | 'Consumables' | 'Services' …
  contact_person: string
  phone: string
  email: string
  gstin: string
  address: string
  city: string
  state: string
  payment_terms_days: number
  rating: number // 1..5
  active: boolean
  notes: string
}

export type PoStatus = 'draft' | 'approved' | 'sent' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrder extends BaseRow {
  po_no: string // PO/2026-27/0001
  vendor_id: string
  date: ISODate
  expected_date: ISODate | null
  status: PoStatus
  subtotal: number
  tax_total: number
  total: number
  /** true → CGST+SGST (intra-state Karnataka); false → IGST. */
  intra_state: boolean
  notes: string
  created_by: string | null
  approved_by: string | null
  approved_at: ISODateTime | null
}

export interface PurchaseOrderLine extends BaseRow {
  po_id: string
  item_id: string | null
  description: string
  qty: number
  uom: string
  rate: number
  gst_rate: number // percent
  received_qty: number
}

export type WorkOrderStatus = 'planned' | 'in_progress' | 'qc' | 'completed' | 'dispatched' | 'on_hold' | 'cancelled'

export interface WorkOrder extends BaseRow {
  wo_no: string // WO-1001
  customer_id: string
  customer_po_ref: string
  part_no: string
  part_name: string
  drawing_rev: string
  material: string
  qty: number
  completed_qty: number
  rejected_qty: number
  unit_price: number
  route_work_centre_ids: string[]
  start_date: ISODate | null
  due_date: ISODate
  status: WorkOrderStatus
  priority: Priority
  notes: string
  /** Set when the order reaches Completed / Dispatched (on-time delivery KPI). */
  completed_on: ISODate | null
  dispatched_on: ISODate | null
}

/* ──────────────────────────────── Quality ──────────────────────────────── */

export type InspectionType = 'incoming' | 'in_process' | 'final' | 'first_article'
export type InspectionResult = 'pass' | 'fail' | 'conditional'

export interface InspectionParameter {
  name: string
  spec: string // e.g. 'Ø25.00'
  lower: number | null
  upper: number | null
  measured: number | null
  ok: boolean
}

export interface Inspection extends BaseRow {
  insp_no: string // QI-0001
  date: ISODate
  type: InspectionType
  work_order_id: string | null
  po_id: string | null
  part_name: string
  lot_no: string
  lot_qty: number
  sample_size: number
  accepted_qty: number
  rejected_qty: number
  result: InspectionResult
  inspector_id: string | null
  parameters: InspectionParameter[]
  remarks: string
}

export type NcrDisposition = 'rework' | 'scrap' | 'use_as_is' | 'return_to_vendor'

export interface Ncr extends BaseRow {
  ncr_no: string // NCR-0001
  inspection_id: string | null
  date: ISODate
  description: string
  qty_affected: number
  root_cause: string
  corrective_action: string
  disposition: NcrDisposition
  owner_id: string | null
  status: 'open' | 'closed'
  closed_on: ISODate | null
}

/* ──────────────────────────────── Registry ──────────────────────────────── */

export interface Tables {
  company_settings: CompanySettings
  directors: Director
  roles: Role
  app_users: AppUser
  audit_logs: AuditLog
  notifications: AppNotification
  departments: Department
  designations: Designation
  employees: Employee
  emergency_contacts: EmergencyContact
  employee_documents: EmployeeDocument
  shifts: Shift
  attendance: AttendanceRecord
  regularisations: Regularisation
  leave_types: LeaveType
  leave_balances: LeaveBalance
  leave_requests: LeaveRequest
  holidays: Holiday
  salary_structures: SalaryStructure
  payroll_runs: PayrollRun
  payslips: Payslip
  advances: Advance
  advance_recoveries: AdvanceRecovery
  petty_cash_entries: PettyCashEntry
  petty_cash_vouchers: PettyCashVoucher
  tasks: Task
  task_comments: TaskComment
  todos: Todo
  announcements: Announcement
  announcement_reads: AnnouncementRead
  work_centres: WorkCentre
  machines: Machine
  maintenance_schedules: MaintenanceSchedule
  maintenance_logs: MaintenanceLog
  inventory_items: InventoryItem
  stock_movements: StockMovement
  tool_issues: ToolIssue
  assets: Asset
  customers: Customer
  vendors: Vendor
  purchase_orders: PurchaseOrder
  purchase_order_lines: PurchaseOrderLine
  work_orders: WorkOrder
  inspections: Inspection
  ncrs: Ncr
}

export type TableName = keyof Tables
export type Row<T extends TableName> = Tables[T]

/** Load order matters for Supabase foreign keys (parents first). */
export const TABLE_NAMES: TableName[] = [
  'company_settings', 'directors', 'roles', 'departments', 'shifts', 'work_centres',
  'designations', 'employees', 'app_users', 'audit_logs', 'notifications',
  'emergency_contacts', 'employee_documents',
  'attendance', 'regularisations',
  'leave_types', 'leave_balances', 'leave_requests', 'holidays',
  'salary_structures', 'payroll_runs', 'payslips', 'advances', 'advance_recoveries',
  'petty_cash_entries', 'petty_cash_vouchers',
  'tasks', 'task_comments', 'todos',
  'announcements', 'announcement_reads',
  'machines', 'maintenance_schedules', 'maintenance_logs',
  'vendors', 'customers', 'inventory_items', 'stock_movements', 'tool_issues', 'assets',
  'purchase_orders', 'purchase_order_lines', 'work_orders',
  'inspections', 'ncrs',
]

/** Insert payload: id and timestamps are filled in by the store. */
export type NewRow<T extends TableName> = Omit<Tables[T], 'id' | 'created_at' | 'updated_at'> & {
  id?: string
  created_at?: string
  updated_at?: string
}
