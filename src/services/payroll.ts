/**
 * Payroll actions — run lifecycle (draft → processed → approved → paid), salary structures and
 * advances / loans.
 *
 * Every payslip number comes from lib/payroll.computePayslip fed by lib/attendance.summariseMonth,
 * exactly as the demo seed computes its paid runs (see computeSlipFields). EMIs are applied per
 * employee in recoveryOrder(); when a run is paid the deducted amounts are split back onto the
 * individual advances in that same order and written to advance_recoveries.
 */
import { db } from '@/data/store'
import type {
  Advance, AdvanceRecovery, AdvanceType, CompanySettings, Employee, ISODate, NewRow, Payslip, PayrollRun, PayrollRunStatus,
  SalaryStructure, YearMonth,
} from '@/data/types'
import { buildAttendanceContext, summariseMonth, type AttendanceContext } from '@/lib/attendance'
import { addMonths, currentMonth, fmtDate, fmtMonth, fyOf, fyRange, monthEnd, monthStart, todayISO } from '@/lib/dates'
import { fullName, inr, round2 } from '@/lib/format'
import { annualCtc, computePayslip, emiDue, monthlyGross } from '@/lib/payroll'
import { audit, diff } from './audit'
import { currentSession, selfApprovalBlock } from './session'

/** Thrown when the store already rolled back and toasted a failed write (callers should not toast again). */
export class SaveFailed extends Error {
  constructor() {
    super('The change could not be saved.')
    this.name = 'SaveFailed'
  }
}

async function flushOrFail() {
  try {
    await db.flushed()
  } catch {
    throw new SaveFailed()
  }
}

const nowIso = () => new Date().toISOString()
const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

function requireManage() {
  const s = currentSession()
  if (!s?.can('payroll.manage')) throw new Error('You do not have permission to manage payroll.')
  return s
}

function empLabel(id: string) {
  const e = db.get('employees', id)
  return e ? `${fullName(e)} (${e.emp_code})` : 'employee'
}

export const advanceLabel = (t: AdvanceType) => (t === 'loan' ? 'loan' : 'salary advance')
export const ADVANCE_TYPE_LABEL: Record<AdvanceType, string> = { salary_advance: 'Salary advance', loan: 'Loan' }

/* ───────────────────────────── lookups ───────────────────────────── */

/** On the rolls for at least one day of the month. */
export function isEmployedIn(e: Pick<Employee, 'date_of_joining' | 'date_of_exit'>, month: YearMonth): boolean {
  return e.date_of_joining <= monthEnd(month) && (!e.date_of_exit || e.date_of_exit >= monthStart(month))
}

/** Salary structure that applies to a month: latest effective_from on or before the month end. */
export function structureFor(employeeId: string, month: YearMonth, rows: SalaryStructure[] = db.all('salary_structures')): SalaryStructure | undefined {
  const end = monthEnd(month)
  let best: SalaryStructure | undefined
  for (const s of rows) if (s.employee_id === employeeId && s.effective_from <= end && (!best || s.effective_from > best.effective_from)) best = s
  return best
}

/** Structure in force today (or, for someone whose first structure starts later, that upcoming one). */
export function currentStructure(employeeId: string, rows: SalaryStructure[] = db.all('salary_structures'), today: ISODate = todayISO()): SalaryStructure | undefined {
  const own = rows.filter((s) => s.employee_id === employeeId).sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  const past = own.filter((s) => s.effective_from <= today)
  return past[past.length - 1] ?? own[0]
}

export function attendanceContext(today: ISODate = todayISO()): AttendanceContext {
  return buildAttendanceContext({
    holidays: db.all('holidays'),
    attendance: db.all('attendance'),
    leaveRequests: db.all('leave_requests'),
    leaveTypes: db.all('leave_types'),
    shifts: db.all('shifts'),
    today,
  })
}

export function runSlips(runId: string): Payslip[] {
  return db.where('payslips', (p) => p.run_id === runId)
}

export function runTotals(slips: Payslip[]) {
  let total_gross = 0, total_deductions = 0, total_net = 0, total_employer_cost = 0
  for (const p of slips) {
    total_gross += p.gross_earnings
    total_deductions += p.total_deductions
    total_net += p.net_pay
    total_employer_cost += p.employer_cost
  }
  return {
    employee_count: slips.length,
    total_gross: round2(total_gross),
    total_deductions: round2(total_deductions),
    total_net: round2(total_net),
    total_employer_cost: round2(total_employer_cost),
  }
}

function syncTotals(runId: string) {
  const run = db.get('payroll_runs', runId)
  if (!run) return
  const t = runTotals(runSlips(runId))
  const changed = (Object.keys(t) as (keyof typeof t)[]).some((k) => run[k] !== t[k])
  if (changed) db.update('payroll_runs', runId, t)
}

function getRun(id: string): PayrollRun {
  const r = db.get('payroll_runs', id)
  if (!r) throw new Error('Payroll run not found — it may have been deleted.')
  return r
}

function requireStatus(run: PayrollRun, ...allowed: PayrollRunStatus[]) {
  if (!allowed.includes(run.status)) throw new Error(`${fmtMonth(run.month)} payroll is ${run.status} — this action is not available any more.`)
}

/* ───────────────────────────── advances & recoveries ───────────────────────────── */

export const emiFor = (amount: number, installments: number) => (installments > 0 ? Math.ceil(amount / installments) : 0)

/** Oldest first — the order EMIs are applied (and split back when a run is paid). */
export function recoveryOrder(list: Advance[]): Advance[] {
  return [...list].sort(
    (a, b) =>
      a.start_month.localeCompare(b.start_month) ||
      a.requested_on.localeCompare(b.requested_on) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  )
}

/** An employee's advances/loans currently being recovered (status 'active'), in recovery order. */
export function activeAdvancesOf(employeeId: string, rows: Advance[] = db.all('advances')): Advance[] {
  return recoveryOrder(rows.filter((a) => a.employee_id === employeeId && a.status === 'active'))
}

/** Σ advance_recoveries for an advance. */
export function recoveredSoFar(advanceId: string, rows: AdvanceRecovery[] = db.all('advance_recoveries')): number {
  let t = 0
  for (const r of rows) if (r.advance_id === advanceId) t += r.amount
  return round2(t)
}

/**
 * Split a payslip's advance + loan recovery across the employee's advances: first the EMI each
 * one was due (emiDue, in recovery order — how the slip was computed), then any remainder
 * against outstanding balances in the same order.
 */
export function splitRecoveries(
  slip: Pick<Payslip, 'month' | 'advance_recovery' | 'loan_recovery'>,
  advances: Advance[],
  recovered: Map<string, number>,
): [Advance, number][] {
  const ordered = recoveryOrder(advances)
  const left: Record<AdvanceType, number> = { salary_advance: slip.advance_recovery, loan: slip.loan_recovery }
  const out = new Map<string, [Advance, number]>()
  const add = (a: Advance, amt: number) => {
    const cur = out.get(a.id)
    out.set(a.id, [a, round2((cur?.[1] ?? 0) + amt)])
    left[a.type] = round2(left[a.type] - amt)
  }
  for (const a of ordered) {
    if (left[a.type] <= 0) continue
    const due = Math.min(emiDue(a, recovered.get(a.id) ?? 0, slip.month), left[a.type])
    if (due > 0) add(a, due)
  }
  for (const a of ordered) {
    if (left[a.type] <= 0) continue
    const outstanding = a.amount - (recovered.get(a.id) ?? 0) - (out.get(a.id)?.[1] ?? 0)
    const extra = Math.min(outstanding, left[a.type])
    if (extra > 0) add(a, extra)
  }
  return [...out.values()]
}

/**
 * What has been recovered on each advance before a month: paid recoveries plus EMIs already
 * deducted in earlier runs that are not paid yet (so two open runs never double-count).
 * `excludeRunId` = the run being (re)computed.
 */
export class RecoveryLedger {
  private paid = new Map<string, number>()
  private pending: Payslip[]

  constructor(month: YearMonth, excludeRunId?: string) {
    const excluded = excludeRunId ? new Set(runSlips(excludeRunId).map((p) => p.id)) : null
    for (const r of db.all('advance_recoveries')) {
      if (excluded?.has(r.payslip_id)) continue
      this.paid.set(r.advance_id, (this.paid.get(r.advance_id) ?? 0) + r.amount)
    }
    const open = new Set(db.all('payroll_runs').filter((r) => r.status !== 'paid' && r.month < month && r.id !== excludeRunId).map((r) => r.id))
    this.pending = db
      .where('payslips', (p) => open.has(p.run_id) && (p.advance_recovery > 0 || p.loan_recovery > 0))
      .sort((a, b) => a.month.localeCompare(b.month))
  }

  forEmployee(employeeId: string, advances: Advance[]): Map<string, number> {
    const m = new Map<string, number>()
    for (const a of advances) m.set(a.id, this.paid.get(a.id) ?? 0)
    for (const p of this.pending) {
      if (p.employee_id !== employeeId) continue
      for (const [a, amt] of splitRecoveries(p, advances, m)) m.set(a.id, (m.get(a.id) ?? 0) + amt)
    }
    return m
  }
}

export interface AdvanceProgress {
  recoveries: AdvanceRecovery[]
  recovered: number
  /** amount − recovered (what was never recovered through payroll). */
  balance: number
  /** Still to be recovered through payroll (0 unless active/approved). */
  outstanding: number
  next: YearMonth | null
  schedule: { month: YearMonth; amount: number }[]
  pct: number
}

/** Recoveries so far, outstanding balance and the projected EMI schedule of one advance. */
export function advanceProgress(a: Advance, recoveries: AdvanceRecovery[], paidRunMonths: Set<YearMonth> = new Set()): AdvanceProgress {
  const own = recoveries.filter((r) => r.advance_id === a.id).sort((x, y) => x.month.localeCompare(y.month))
  const recovered = round2(own.reduce((t, r) => t + r.amount, 0))
  const balance = Math.max(0, round2(a.amount - recovered))
  const running = a.status === 'active' || a.status === 'approved'
  const outstanding = running ? balance : 0
  let next: YearMonth | null = null
  const schedule: { month: YearMonth; amount: number }[] = []
  if (running && outstanding > 0 && a.emi_amount > 0) {
    const last = own[own.length - 1]?.month
    let m = last && addMonths(last, 1) > a.start_month ? addMonths(last, 1) : a.start_month
    for (let i = 0; paidRunMonths.has(m) && i < 24; i++) m = addMonths(m, 1)
    next = m
    let left = outstanding
    for (let i = 0; left > 0 && i < 120; i++) {
      const amt = Math.min(a.emi_amount, left)
      schedule.push({ month: addMonths(m, i), amount: amt })
      left = round2(left - amt)
    }
  }
  return { recoveries: own, recovered, balance, outstanding, next, schedule, pct: a.amount > 0 ? Math.min(100, (recovered / a.amount) * 100) : 0 }
}

/* ───────────────────────────── payslip computation ───────────────────────────── */

export interface SlipAdjustments {
  bonus: number
  arrears: number
  other_deductions: number
  remarks: string
}
export const NO_ADJUSTMENTS: SlipAdjustments = { bonus: 0, arrears: 0, other_deductions: 0, remarks: '' }

export type SlipFields = Omit<NewRow<'payslips'>, 'run_id' | 'employee_id' | 'published'>

/**
 * One employee's payslip for a month — the same steps the seed uses for its paid runs:
 * summariseMonth → EMIs via emiDue (active advances, recovery order) → computePayslip, with TDS
 * projected from the tax year's earlier payslips (taxYearToDate).
 */
export function computeSlipFields(input: {
  employee: Employee
  month: YearMonth
  structure: SalaryStructure
  ctx: AttendanceContext
  settings: Pick<CompanySettings, 'payroll' | 'attendance'>
  /** The employee's 'active' advances in recovery order. */
  advances: Advance[]
  /** Recovered so far per advance id. */
  recovered: Map<string, number>
  adjustments?: SlipAdjustments
  /** Earnings and TDS on the tax year's earlier payslips (see taxYearToDate). */
  ytd?: { gross: number; tds: number }
}): SlipFields {
  const { employee: e, month, structure, ctx, settings } = input
  const adj = input.adjustments ?? NO_ADJUSTMENTS
  const sum = summariseMonth(e, month, ctx, settings.attendance)
  let advanceRecovery = 0
  let loanRecovery = 0
  for (const a of input.advances) {
    const due = emiDue(a, input.recovered.get(a.id) ?? 0, month)
    if (!due) continue
    if (a.type === 'loan') loanRecovery += due
    else advanceRecovery += due
  }
  const calc = computePayslip({
    month,
    structure,
    regime: e.tax_regime,
    declaredDeductions: e.declared_deductions,
    daysInMonth: sum.days_in_month,
    paidDays: sum.paid_days,
    otMinutesApproved: sum.ot_minutes_approved,
    advanceRecovery,
    loanRecovery,
    bonus: adj.bonus,
    arrears: adj.arrears,
    otherDeductions: adj.other_deductions,
    ytd: input.ytd,
    config: settings.payroll,
  })
  return {
    month,
    days_in_month: sum.days_in_month,
    working_days: sum.working_days,
    present_days: sum.present,
    paid_leave_days: sum.paid_leave,
    holidays: sum.holidays,
    week_offs: sum.week_offs,
    lop_days: sum.lop_days,
    late_marks: sum.late_marks,
    paid_days: sum.paid_days,
    ...calc,
    tax_regime: e.tax_regime,
    remarks: adj.remarks,
  }
}

export interface RunPlan {
  month: YearMonth
  eligible: { employee: Employee; structure: SalaryStructure }[]
  /** On the rolls in the month but without a salary structure effective by month end. */
  skipped: Employee[]
  /** Current month: days after today are counted as paid (projected). */
  projected: boolean
}

/** Who a run for this month pays (employees on the rolls during the month with a structure). */
export function planRun(month: YearMonth): RunPlan {
  const structures = db.all('salary_structures')
  const eligible: RunPlan['eligible'] = []
  const skipped: Employee[] = []
  const emps = db.all('employees').filter((e) => isEmployedIn(e, month)).sort((a, b) => a.emp_code.localeCompare(b.emp_code, 'en-IN', { numeric: true }))
  for (const e of emps) {
    const s = structureFor(e.id, month, structures)
    if (s) eligible.push({ employee: e, structure: s })
    else skipped.push(e)
  }
  return { month, eligible, skipped, projected: month >= currentMonth() }
}

function adjustmentsOf(p: Payslip | undefined): SlipAdjustments {
  return p ? { bonus: p.bonus, arrears: p.arrears, other_deductions: p.other_deductions, remarks: p.remarks } : NO_ADJUSTMENTS
}

function slipFor(run: PayrollRun, e: Employee, s: SalaryStructure, ctx: AttendanceContext, ledger: RecoveryLedger, adj: SlipAdjustments): SlipFields {
  // Without employees access the server only returns directory rows, whose tax regime and
  // declarations are placeholders, so the TDS would be wrong.
  if (!currentSession()?.canAny(['employees.view', 'employees.manage'])) throw new Error('Computing payslips needs Employees (view) access for tax regime and declarations. Add it to this role in Users & roles.')
  const advances = activeAdvancesOf(e.id)
  return computeSlipFields({ employee: e, month: run.month, structure: s, ctx, settings: db.settings(), advances, recovered: ledger.forEmployee(e.id, advances), adjustments: adj, ytd: taxYearToDate(e.id, run.month) })
}

/** Earnings and TDS on an employee's payslips earlier in the same April–March tax year. */
export function taxYearToDate(employeeId: string, month: YearMonth, slips: Payslip[] = db.all('payslips')): { gross: number; tds: number } {
  const from = `${fyOf(`${month}-01`)}-04`
  let gross = 0
  let tds = 0
  for (const p of slips) {
    if (p.employee_id !== employeeId || p.month < from || p.month >= month) continue
    gross += p.gross_earnings
    tds += p.tds
  }
  return { gross, tds }
}

/* ───────────────────────────── run lifecycle ───────────────────────────── */

export interface CreateRunResult {
  run: PayrollRun
  created: number
  skipped: Employee[]
}

/** Draft run + one unpublished payslip per eligible employee. */
export async function createRun(month: YearMonth): Promise<CreateRunResult> {
  requireManage()
  if (!isMonth(month)) throw new Error('Pick a valid month.')
  if (month > currentMonth()) throw new Error('Payroll cannot be run for a future month.')
  if (db.find('payroll_runs', (r) => r.month === month)) throw new Error(`Payroll for ${fmtMonth(month)} has already been run.`)
  const plan = planRun(month)
  if (!plan.eligible.length) throw new Error(`Nobody with a salary structure was on the rolls in ${fmtMonth(month)}.`)

  const run = db.insert('payroll_runs', {
    month, status: 'draft', employee_count: 0, total_gross: 0, total_deductions: 0, total_net: 0, total_employer_cost: 0,
    processed_at: null, processed_by: null, approved_at: null, approved_by: null, paid_at: null, payment_ref: '', notes: '',
  })
  // the run must exist on the server before its payslips reference it
  await flushOrFail()

  const ctx = attendanceContext()
  const ledger = new RecoveryLedger(month, run.id)
  db.batch(() => {
    for (const { employee, structure } of plan.eligible) {
      db.insert('payslips', { run_id: run.id, employee_id: employee.id, ...slipFor(run, employee, structure, ctx, ledger, NO_ADJUSTMENTS), published: false })
    }
    syncTotals(run.id)
  })
  const fresh = db.get('payroll_runs', run.id) ?? run
  audit('create', 'payroll_runs', run.id, `Created draft payroll for ${fmtMonth(month)} · ${plan.eligible.length} employees · net ${inr(fresh.total_net)}`)
  return { run: fresh, created: plan.eligible.length, skipped: plan.skipped }
}

/** Recompute every slip of a draft run (manual bonus/arrears/other deductions/remarks are kept). */
export function recalcRun(runId: string): { updated: number; added: number; removed: number; skipped: Employee[] } {
  requireManage()
  const run = getRun(runId)
  requireStatus(run, 'draft')
  const plan = planRun(run.month)
  const existing = new Map(runSlips(runId).map((p) => [p.employee_id, p]))
  const ctx = attendanceContext()
  const ledger = new RecoveryLedger(run.month, run.id)
  let updated = 0, added = 0, removed = 0
  db.batch(() => {
    const keep = new Set<string>()
    for (const { employee, structure } of plan.eligible) {
      const prev = existing.get(employee.id)
      const fields = slipFor(run, employee, structure, ctx, ledger, adjustmentsOf(prev))
      keep.add(employee.id)
      if (prev) {
        db.update('payslips', prev.id, fields)
        updated++
      } else {
        db.insert('payslips', { run_id: run.id, employee_id: employee.id, ...fields, published: false })
        added++
      }
    }
    for (const [empId, p] of existing) {
      if (keep.has(empId)) continue
      db.remove('payslips', p.id)
      removed++
    }
    syncTotals(run.id)
  })
  const t = db.get('payroll_runs', runId)
  audit('update', 'payroll_runs', runId, `Recalculated ${fmtMonth(run.month)} payroll · ${updated + added} payslips${added ? ` (+${added})` : ''}${removed ? ` (−${removed})` : ''} · net ${inr(t?.total_net ?? 0)}`)
  return { updated, added, removed, skipped: plan.skipped }
}

function cleanAdjustments(slip: Payslip, adj: Partial<SlipAdjustments>): SlipAdjustments {
  const out = { ...adjustmentsOf(slip), ...adj }
  for (const k of ['bonus', 'arrears', 'other_deductions'] as const) {
    const v = Number(out[k])
    if (!Number.isFinite(v) || v < 0) throw new Error('Bonus, arrears and other deductions must be zero or more.')
    out[k] = round2(v)
  }
  out.remarks = String(out.remarks ?? '').trim().slice(0, 300)
  return out
}

/** Payslip fields with these adjustments, without saving (live preview in the editor). */
export function previewSlip(slipId: string, adj: Partial<SlipAdjustments>): SlipFields {
  const slip = db.get('payslips', slipId)
  if (!slip) throw new Error('Payslip not found.')
  const run = getRun(slip.run_id)
  const e = db.get('employees', slip.employee_id)
  const s = structureFor(slip.employee_id, run.month)
  if (!e || !s) throw new Error('Employee or salary structure missing.')
  return slipFor(run, e, s, attendanceContext(), new RecoveryLedger(run.month, run.id), cleanAdjustments(slip, adj))
}

/** Recompute one slip of a draft run, optionally with new manual adjustments. */
export function recalcSlip(slipId: string, adj: Partial<SlipAdjustments> = {}): Payslip {
  requireManage()
  const slip = db.get('payslips', slipId)
  if (!slip) throw new Error('Payslip not found.')
  const run = getRun(slip.run_id)
  requireStatus(run, 'draft')
  const e = db.get('employees', slip.employee_id)
  if (!e) throw new Error('Employee not found.')
  const s = structureFor(e.id, run.month)
  if (!s) throw new Error(`${fullName(e)} has no salary structure effective by ${fmtDate(monthEnd(run.month))}.`)
  const clean = cleanAdjustments(slip, adj)
  const fields = slipFor(run, e, s, attendanceContext(), new RecoveryLedger(run.month, run.id), clean)
  const row = db.batch(() => {
    const r = db.update('payslips', slip.id, fields)
    syncTotals(run.id)
    return r
  })
  audit(
    'update', 'payslips', slip.id,
    `Updated payslip — ${empLabel(e.id)} · ${fmtMonth(run.month)} · net ${inr(row.net_pay)}`,
    diff(slip, { bonus: row.bonus, arrears: row.arrears, other_deductions: row.other_deductions, remarks: row.remarks, net_pay: row.net_pay }),
  )
  return row
}

/** Lock a draft run for approval. */
export function processRun(runId: string): PayrollRun {
  const s = requireManage()
  const run = getRun(runId)
  requireStatus(run, 'draft')
  const slips = runSlips(runId)
  if (!slips.length) throw new Error('This run has no payslips — recalculate it first.')
  const row = db.update('payroll_runs', runId, { ...runTotals(slips), status: 'processed', processed_at: nowIso(), processed_by: s.user.id })
  audit('process', 'payroll_runs', runId, `Processed ${fmtMonth(run.month)} payroll · ${slips.length} employees · net ${inr(row.total_net)}`)
  return row
}

export function unprocessRun(runId: string): PayrollRun {
  requireManage()
  const run = getRun(runId)
  requireStatus(run, 'processed')
  const row = db.update('payroll_runs', runId, { status: 'draft', processed_at: null, processed_by: null })
  audit('update', 'payroll_runs', runId, `Moved ${fmtMonth(run.month)} payroll back to draft`)
  return row
}

export function approveRun(runId: string): PayrollRun {
  const s = requireManage()
  const run = getRun(runId)
  requireStatus(run, 'processed')
  const row = db.update('payroll_runs', runId, { status: 'approved', approved_at: nowIso(), approved_by: s.user.id })
  audit('approve', 'payroll_runs', runId, `Approved ${fmtMonth(run.month)} payroll · net ${inr(row.total_net)}`)
  return row
}

/**
 * Mark an approved run paid: publish every payslip, record each EMI against its advance
 * (split in recovery order) and close advances that are fully recovered.
 */
export function payRun(runId: string, paymentRef: string): { published: number; recoveries: number; closed: number } {
  requireManage()
  const run = getRun(runId)
  requireStatus(run, 'approved')
  const ref = paymentRef.trim()
  if (ref.length < 3) throw new Error('Enter the bank / NEFT payment reference.')
  const slips = runSlips(runId)
  const ids = new Set(slips.map((p) => p.id))
  const alreadyRecorded = new Set(db.where('advance_recoveries', (r) => ids.has(r.payslip_id)).map((r) => r.payslip_id))
  const ledger = new RecoveryLedger(run.month, runId)
  let published = 0, recoveries = 0, closed = 0
  db.batch(() => {
    for (const p of slips) {
      if ((p.advance_recovery > 0 || p.loan_recovery > 0) && !alreadyRecorded.has(p.id)) {
        const advances = activeAdvancesOf(p.employee_id)
        const recovered = ledger.forEmployee(p.employee_id, advances)
        for (const [a, amount] of splitRecoveries(p, advances, recovered)) {
          db.insert('advance_recoveries', { advance_id: a.id, payslip_id: p.id, month: p.month, amount })
          recoveries++
          if (recoveredSoFar(a.id) >= a.amount) {
            db.update('advances', a.id, { status: 'closed' })
            closed++
          }
        }
      }
      if (!p.published) {
        db.update('payslips', p.id, { published: true })
        published++
      }
    }
    db.update('payroll_runs', runId, { ...runTotals(slips), status: 'paid', paid_at: nowIso(), payment_ref: ref })
  })
  audit('pay', 'payroll_runs', runId, `Paid ${fmtMonth(run.month)} payroll · net ${inr(runTotals(slips).total_net)} · ref ${ref} · ${published} payslips published${recoveries ? ` · ${recoveries} EMI recoveries` : ''}`)
  return { published, recoveries, closed }
}

export function deleteDraftRun(runId: string) {
  requireManage()
  const run = getRun(runId)
  requireStatus(run, 'draft')
  const slips = runSlips(runId)
  db.batch(() => {
    for (const p of slips) db.remove('payslips', p.id)
    db.remove('payroll_runs', runId)
  })
  audit('delete', 'payroll_runs', runId, `Deleted draft payroll for ${fmtMonth(run.month)} (${slips.length} payslips)`)
}

/* ───────────────────────────── salary structures ───────────────────────────── */

export interface StructureInput {
  effective_from: ISODate
  basic: number
  da: number
  hra: number
  conveyance: number
  special_allowance: number
  other_allowance: number
  pf_applicable: boolean
  esi_applicable: boolean
  pt_applicable: boolean
  ot_eligible: boolean
  ot_rate_per_hour: number | null
  notes: string
}

export const STRUCTURE_COMPONENTS = ['basic', 'da', 'hra', 'conveyance', 'special_allowance', 'other_allowance'] as const

export function structureErrors(i: StructureInput): Partial<Record<keyof StructureInput, string>> {
  const e: Partial<Record<keyof StructureInput, string>> = {}
  if (!isDate(i.effective_from)) e.effective_from = 'Pick the date this structure applies from.'
  for (const k of STRUCTURE_COMPONENTS) if (!Number.isFinite(i[k]) || i[k] < 0) e[k] = 'Zero or more'
  if (!(i.basic > 0)) e.basic = 'Basic is required'
  if (i.ot_rate_per_hour != null && (!Number.isFinite(i.ot_rate_per_hour) || i.ot_rate_per_hour < 0)) e.ot_rate_per_hour = 'Zero or more'
  return e
}

/**
 * Save a structure. Same effective date as an existing revision → update it; a new date → new
 * row (the older revision stays as history). ctc_annual is always recomputed.
 */
export function saveStructure(employeeId: string, input: StructureInput): { row: SalaryStructure; created: boolean } {
  requireManage()
  const emp = db.get('employees', employeeId)
  if (!emp) throw new Error('Employee not found.')
  const errs = structureErrors(input)
  const first = Object.values(errs)[0]
  if (first) throw new Error(first)
  const cfg = db.settings().payroll
  const fields = {
    effective_from: input.effective_from,
    basic: round2(input.basic),
    da: round2(input.da),
    hra: round2(input.hra),
    conveyance: round2(input.conveyance),
    special_allowance: round2(input.special_allowance),
    other_allowance: round2(input.other_allowance),
    pf_applicable: input.pf_applicable,
    esi_applicable: input.esi_applicable,
    pt_applicable: input.pt_applicable,
    ot_eligible: input.ot_eligible,
    ot_rate_per_hour: input.ot_rate_per_hour != null && input.ot_rate_per_hour > 0 ? round2(input.ot_rate_per_hour) : null,
    notes: input.notes.trim(),
  }
  const ctc_annual = round2(annualCtc({ id: '', created_at: '', updated_at: '', employee_id: employeeId, ctc_annual: 0, ...fields }, cfg))
  const gross = monthlyGross(fields)
  const existing = db.find('salary_structures', (s) => s.employee_id === employeeId && s.effective_from === input.effective_from)
  if (existing) {
    const patch = { ...fields, ctc_annual }
    const row = db.update('salary_structures', existing.id, patch)
    audit('update', 'salary_structures', row.id, `Updated salary structure — ${empLabel(employeeId)} · ${inr(gross)}/month from ${fmtDate(input.effective_from)}`, diff(existing, patch))
    return { row, created: false }
  }
  const row = db.insert('salary_structures', { employee_id: employeeId, ...fields, ctc_annual })
  audit('create', 'salary_structures', row.id, `New salary structure — ${empLabel(employeeId)} · ${inr(gross)}/month (CTC ${inr(ctc_annual)}) from ${fmtDate(input.effective_from)}`)
  return { row, created: true }
}

/** Default effective date for someone's first structure: joining date or the start of this FY. */
export function defaultEffectiveFrom(emp: Employee, startMonth = 4): ISODate {
  const fyStart = fyRange(fyOf(todayISO(), startMonth), startMonth).from
  return emp.date_of_joining > fyStart ? emp.date_of_joining : fyStart
}

/* ───────────────────────────── advances & loans ───────────────────────────── */

export interface ApproveAdvanceInput {
  installments: number
  start_month: YearMonth
  disbursed_on: ISODate
  note?: string
}

const advanceOf = (ref: Advance | string) => {
  const a = db.get('advances', typeof ref === 'string' ? ref : ref.id)
  if (!a) throw new Error('Advance not found — it may have been withdrawn.')
  return a
}

/** Defaults when approving straight from the inbox: requested installments, requested start (not before this month), disbursed today. */
export function defaultApproval(a: Advance): ApproveAdvanceInput {
  const cm = currentMonth()
  return { installments: Math.min(60, Math.max(1, a.installments || 1)), start_month: a.start_month > cm ? a.start_month : cm, disbursed_on: todayISO(), note: '' }
}

export function approveAdvance(ref: Advance | string, overrides: Partial<ApproveAdvanceInput> = {}): Advance {
  const s = requireManage()
  const a = advanceOf(ref)
  const id = a.id
  if (a.status !== 'pending') throw new Error('Only pending requests can be approved.')
  const own = selfApprovalBlock(a.employee_id, s)
  if (own) throw new Error(own)
  const input = { ...defaultApproval(a), ...overrides }
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 60) throw new Error('Installments must be a whole number from 1 to 60.')
  if (!isMonth(input.start_month) || input.start_month < currentMonth()) throw new Error('Recovery cannot start before the current month.')
  if (!isDate(input.disbursed_on)) throw new Error('Enter the disbursement date.')
  const patch = {
    status: 'active' as const,
    installments: input.installments,
    emi_amount: emiFor(a.amount, input.installments),
    start_month: input.start_month,
    approved_by: s.user.id,
    approved_at: nowIso(),
    disbursed_on: input.disbursed_on,
    review_note: (input.note ?? '').trim(),
  }
  const row = db.update('advances', id, patch)
  audit('approve', 'advances', id, `Approved ${advanceLabel(a.type)} — ${empLabel(a.employee_id)} · ${inr(a.amount)} in ${patch.installments} × ${inr(patch.emi_amount)} from ${fmtMonth(patch.start_month)}`, diff(a, patch))
  return row
}

export function rejectAdvance(ref: Advance | string, note: string): Advance {
  const s = requireManage()
  const a = advanceOf(ref)
  const id = a.id
  if (a.status !== 'pending') throw new Error('Only pending requests can be rejected.')
  const reason = note.trim()
  if (!reason) throw new Error('Give a reason for rejecting.')
  const row = db.update('advances', id, { status: 'rejected', review_note: reason, approved_by: s.user.id, approved_at: nowIso() })
  audit('reject', 'advances', id, `Rejected ${advanceLabel(a.type)} — ${empLabel(a.employee_id)} · ${inr(a.amount)}: ${reason}`)
  return row
}

export interface AdvanceRequestInput {
  type: AdvanceType
  amount: number
  installments: number
  start_month: YearMonth
  reason: string
}

/** Self-service request rules (also used for inline validation in the form). */
export function advanceRequestErrors(i: AdvanceRequestInput, ctx: { monthlyGross: number | null; minStart: YearMonth; maxInstallments: number }): Partial<Record<keyof AdvanceRequestInput, string>> {
  const e: Partial<Record<keyof AdvanceRequestInput, string>> = {}
  if (!Number.isFinite(i.amount) || i.amount <= 0) e.amount = 'Enter an amount above zero.'
  else if (i.type === 'salary_advance') {
    if (ctx.monthlyGross == null) e.amount = 'No salary structure on file — please contact HR.'
    else if (i.amount > ctx.monthlyGross * 3) e.amount = `A salary advance can be at most 3 months’ gross (${inr(ctx.monthlyGross * 3)}).`
  }
  if (!Number.isInteger(i.installments) || i.installments < 1 || i.installments > ctx.maxInstallments) e.installments = `Whole number from 1 to ${ctx.maxInstallments}.`
  if (!isMonth(i.start_month) || i.start_month < ctx.minStart) e.start_month = `Recovery can start from ${fmtMonth(ctx.minStart)}.`
  if (i.reason.trim().length < 3) e.reason = 'Tell HR what it is for (at least 3 characters).'
  return e
}

/** Employee self-service: request an advance or loan for yourself (status pending). */
export function requestAdvance(input: AdvanceRequestInput): Advance {
  const s = currentSession()
  const me = s?.employee
  if (!me) throw new Error('Your login is not linked to an employee record.')
  const st = currentStructure(me.id)
  const errs = advanceRequestErrors(input, { monthlyGross: st ? monthlyGross(st) : null, minStart: addMonths(currentMonth(), 1), maxInstallments: 24 })
  const first = Object.values(errs)[0]
  if (first) throw new Error(first)
  const amount = round2(input.amount)
  const row = db.insert('advances', {
    employee_id: me.id,
    type: input.type,
    amount,
    reason: input.reason.trim(),
    requested_on: todayISO(),
    status: 'pending',
    installments: input.installments,
    emi_amount: emiFor(amount, input.installments),
    start_month: input.start_month,
    approved_by: null,
    approved_at: null,
    disbursed_on: null,
    review_note: '',
  })
  audit('create', 'advances', row.id, `Requested ${advanceLabel(input.type)} of ${inr(amount)} in ${input.installments} EMIs`)
  return row
}

/** Withdraw your own pending request. */
export function withdrawAdvance(id: string) {
  const me = currentSession()?.employee
  const a = db.get('advances', id)
  if (!a) throw new Error('Request not found.')
  if (!me || a.employee_id !== me.id) throw new Error('You can only withdraw your own requests.')
  if (a.status !== 'pending') throw new Error('Only pending requests can be withdrawn.')
  db.remove('advances', id)
  audit('delete', 'advances', id, `Withdrew ${advanceLabel(a.type)} request of ${inr(a.amount)}`)
}

export interface CreateAdvanceInput extends AdvanceRequestInput {
  employee_id: string
  /** true → approved and disbursed at once (status active). */
  approve: boolean
  disbursed_on: ISODate
}

/** HR records an advance/loan on an employee's behalf. */
export function createAdvance(input: CreateAdvanceInput): Advance {
  const s = requireManage()
  const emp = db.get('employees', input.employee_id)
  if (!emp) throw new Error('Pick an employee.')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero.')
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 60) throw new Error('Installments must be a whole number from 1 to 60.')
  if (!isMonth(input.start_month) || input.start_month < currentMonth()) throw new Error('Recovery cannot start before the current month.')
  if (input.reason.trim().length < 3) throw new Error('Enter a reason (at least 3 characters).')
  if (input.approve && !isDate(input.disbursed_on)) throw new Error('Enter the disbursement date.')
  const amount = round2(input.amount)
  const row = db.insert('advances', {
    employee_id: emp.id,
    type: input.type,
    amount,
    reason: input.reason.trim(),
    requested_on: todayISO(),
    status: input.approve ? 'active' : 'pending',
    installments: input.installments,
    emi_amount: emiFor(amount, input.installments),
    start_month: input.start_month,
    approved_by: input.approve ? s.user.id : null,
    approved_at: input.approve ? nowIso() : null,
    disbursed_on: input.approve ? input.disbursed_on : null,
    review_note: input.approve ? 'Recorded by HR' : '',
  })
  audit('create', 'advances', row.id, `Recorded ${advanceLabel(input.type)} for ${empLabel(emp.id)} · ${inr(amount)} in ${input.installments} × ${inr(row.emi_amount)}${input.approve ? ' (approved)' : ' (pending)'}`)
  return row
}

/**
 * Close an advance early (balance settled outside payroll). Blocked while a locked run still
 * deducts this employee's EMI; open draft runs are recomputed so the EMI drops off.
 */
export function closeAdvance(ref: Advance | string, note = ''): Advance {
  requireManage()
  const a = advanceOf(ref)
  const id = a.id
  if (a.status !== 'active' && a.status !== 'approved') throw new Error('Only running advances can be closed.')
  const field = a.type === 'loan' ? 'loan_recovery' : 'advance_recovery'
  const runs = db.all('payroll_runs').filter((r) => r.status !== 'paid')
  const slipOf = (r: PayrollRun) => db.find('payslips', (p) => p.run_id === r.id && p.employee_id === a.employee_id)
  for (const r of runs) {
    if (r.status === 'draft') continue
    const p = slipOf(r)
    if (p && p[field] > 0) throw new Error(`${fmtMonth(r.month)} payroll (${r.status}) already deducts this EMI — pay it or move it back to draft first.`)
  }
  const balance = Math.max(0, a.amount - recoveredSoFar(a.id))
  const text = note.trim()
  const row = db.update('advances', id, { status: 'closed', review_note: text ? (a.review_note ? `${a.review_note} · ${text}` : text) : a.review_note })
  for (const r of runs) {
    if (r.status !== 'draft') continue
    const p = slipOf(r)
    if (p && p[field] > 0 && structureFor(a.employee_id, r.month)) recalcSlip(p.id)
  }
  audit('update', 'advances', id, `Closed ${advanceLabel(a.type)} early — ${empLabel(a.employee_id)} · balance ${inr(balance)} settled outside payroll${text ? ` (${text})` : ''}`)
  return row
}
