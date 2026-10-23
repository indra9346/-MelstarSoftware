/**
 * Payroll engine — pure, unit-tested (payroll.test.ts).
 *
 * Indian statutory rules as configured in Settings → Payroll (defaults below):
 *  - EPF: employee 12% of PF wages (Basic + DA earned), optionally capped at the ₹15,000 ceiling.
 *         Employer 12% split as EPS 8.33% (always on ≤ ₹15,000) + EPF 3.67% (balance), plus
 *         EDLI 0.5% and admin charges 0.5% (on wages up to ₹15,000).
 *  - ESI: when fixed monthly gross ≤ ₹21,000 — employee 0.75% (rounded up), employer 3.25%,
 *         on gross wages earned in the month (OT included).
 *  - Karnataka Professional Tax: ₹200/month when monthly gross ≥ ₹25,000; ₹300 in February
 *         (₹2,500 a year).
 *  - TDS on salary: projected annual tax ÷ 12 under the employee's regime. New regime
 *         (default): ₹75,000 standard deduction, slabs 0-4L nil … >24L 30%, s.87A rebate up to
 *         ₹12L taxable with marginal relief, 4% cess. Old regime supported with declared deductions.
 *  - Overtime: (Basic + DA) ÷ 26 ÷ 8 × 2 per hour (Factories Act s.59), or a per-employee override.
 *
 * Statutory rates change with budgets and notifications — every number is editable in
 * Settings → Payroll and should be confirmed with the company's CA before payroll goes live.
 */
import type { PayrollConfig, PtSlab, SalaryStructure, TaxRegime, TaxSlab, YearMonth } from '@/data/types'
import { round2 } from './format'

export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  pf_employee_rate: 12,
  pf_employer_epf_rate: 3.67,
  pf_employer_eps_rate: 8.33,
  pf_edli_rate: 0.5,
  pf_admin_rate: 0.5,
  pf_wage_ceiling: 15000,
  pf_restrict_to_ceiling: true,
  esi_wage_threshold: 21000,
  esi_employee_rate: 0.75,
  esi_employer_rate: 3.25,
  pt_state: 'Karnataka',
  pt_slabs: [
    { min: 0, max: 24999, amount: 0 },
    { min: 25000, max: null, amount: 200, feb_amount: 300 },
  ],
  tds_new_regime_slabs: [
    { upto: 400000, rate: 0 },
    { upto: 800000, rate: 5 },
    { upto: 1200000, rate: 10 },
    { upto: 1600000, rate: 15 },
    { upto: 2000000, rate: 20 },
    { upto: 2400000, rate: 25 },
    { upto: null, rate: 30 },
  ],
  tds_new_standard_deduction: 75000,
  tds_new_rebate_limit: 1200000,
  tds_old_regime_slabs: [
    { upto: 250000, rate: 0 },
    { upto: 500000, rate: 5 },
    { upto: 1000000, rate: 20 },
    { upto: null, rate: 30 },
  ],
  tds_old_standard_deduction: 50000,
  tds_old_rebate_limit: 500000,
  tds_cess_rate: 4,
  ot_multiplier: 2,
  ot_base_days: 26,
  ot_hours_per_day: 8,
  pay_day: 7,
}

export function monthlyGross(s: Pick<SalaryStructure, 'basic' | 'da' | 'hra' | 'conveyance' | 'special_allowance' | 'other_allowance'>): number {
  return s.basic + s.da + s.hra + s.conveyance + s.special_allowance + s.other_allowance
}

/** Split a target monthly gross into a typical manufacturing-plant structure. */
export function structureFromGross(gross: number): Pick<SalaryStructure, 'basic' | 'da' | 'hra' | 'conveyance' | 'special_allowance' | 'other_allowance'> {
  const basic = Math.round(gross * 0.45)
  const da = Math.round(gross * 0.05)
  const hra = Math.round(basic * 0.4)
  const conveyance = Math.min(1600, Math.max(0, gross - basic - da - hra))
  const special_allowance = Math.max(0, gross - basic - da - hra - conveyance)
  return { basic, da, hra, conveyance, special_allowance, other_allowance: 0 }
}

/** Annual employer cost (CTC) for a structure. */
export function annualCtc(s: SalaryStructure, cfg: PayrollConfig): number {
  const gross = monthlyGross(s)
  const pfBase = Math.min(s.basic + s.da, cfg.pf_restrict_to_ceiling ? cfg.pf_wage_ceiling : Infinity)
  const pfEmployer = s.pf_applicable ? Math.round((pfBase * (cfg.pf_employer_epf_rate + cfg.pf_employer_eps_rate + cfg.pf_edli_rate + cfg.pf_admin_rate)) / 100) : 0
  const esiEmployer = s.esi_applicable && gross <= cfg.esi_wage_threshold ? Math.ceil((gross * cfg.esi_employer_rate) / 100) : 0
  return (gross + pfEmployer + esiEmployer) * 12
}

export function otHourlyRate(s: Pick<SalaryStructure, 'basic' | 'da' | 'ot_rate_per_hour'>, cfg: PayrollConfig): number {
  if (s.ot_rate_per_hour && s.ot_rate_per_hour > 0) return s.ot_rate_per_hour
  return round2(((s.basic + s.da) / cfg.ot_base_days / cfg.ot_hours_per_day) * cfg.ot_multiplier)
}

export function professionalTax(grossEarned: number, month: YearMonth, slabs: PtSlab[]): number {
  const slab = slabs.find((s) => grossEarned >= s.min && (s.max == null || grossEarned <= s.max))
  if (!slab) return 0
  const isFeb = month.endsWith('-02')
  return isFeb && slab.feb_amount != null ? slab.feb_amount : slab.amount
}

/** Slab tax on annual taxable income (before rebate/cess). */
export function slabTax(taxable: number, slabs: TaxSlab[]): number {
  let tax = 0
  let prev = 0
  for (const s of slabs) {
    const top = s.upto ?? Infinity
    if (taxable > prev) tax += ((Math.min(taxable, top) - prev) * s.rate) / 100
    prev = top
    if (taxable <= top) break
  }
  return tax
}

export interface TaxBreakup {
  regime: TaxRegime
  annual_gross: number
  standard_deduction: number
  other_deductions: number
  taxable: number
  slab_tax: number
  rebate: number
  cess: number
  annual_tax: number
  monthly_tds: number
}

/** Projected annual income tax for a salary structure under a regime (a full year at this pay). */
export function annualTax(
  s: Pick<SalaryStructure, 'basic' | 'da' | 'hra' | 'conveyance' | 'special_allowance' | 'other_allowance' | 'pf_applicable'>,
  regime: TaxRegime,
  declaredDeductions: number,
  cfg: PayrollConfig,
): TaxBreakup {
  return taxOnAnnualGross(monthlyGross(s) * 12, monthlyGross(s), regime, declaredDeductions, cfg)
}

/** Income tax on a projected annual gross; `monthlyFixedGross` decides old-regime professional tax. */
export function taxOnAnnualGross(annual_gross: number, monthlyFixedGross: number, regime: TaxRegime, declaredDeductions: number, cfg: PayrollConfig): TaxBreakup {
  const isNew = regime === 'new'
  const standard_deduction = isNew ? cfg.tds_new_standard_deduction : cfg.tds_old_standard_deduction
  let other_deductions = 0
  if (!isNew) {
    // Old regime: declared deductions (80C incl. employee PF, 80D, HRA exemption …) + professional tax u/s 16(iii)
    const ptAnnual = monthlyFixedGross >= 25000 ? 2500 : 0
    other_deductions = Math.max(0, declaredDeductions) + ptAnnual
  }
  const taxable = Math.max(0, Math.round((annual_gross - standard_deduction - other_deductions) / 10) * 10)
  const slab_tax = slabTax(taxable, isNew ? cfg.tds_new_regime_slabs : cfg.tds_old_regime_slabs)
  const limit = isNew ? cfg.tds_new_rebate_limit : cfg.tds_old_rebate_limit
  let rebate = 0
  if (taxable <= limit) rebate = slab_tax
  else if (isNew) rebate = Math.max(0, slab_tax - (taxable - limit)) // marginal relief
  const afterRebate = Math.max(0, slab_tax - rebate)
  const cess = (afterRebate * cfg.tds_cess_rate) / 100
  const annual_tax = Math.round(afterRebate + cess)
  return { regime, annual_gross, standard_deduction, other_deductions, taxable, slab_tax, rebate, cess, annual_tax, monthly_tds: Math.round(annual_tax / 12) }
}

/** Months left in the April–March tax year, counting this one (April → 12 … March → 1). */
export function taxMonthsLeft(month: YearMonth): number {
  const m = Number(month.slice(5, 7))
  return m >= 4 ? 16 - m : 4 - m
}

export interface PayslipInput {
  month: YearMonth
  structure: SalaryStructure
  regime: TaxRegime
  declaredDeductions: number
  daysInMonth: number
  paidDays: number
  otMinutesApproved: number
  advanceRecovery?: number
  loanRecovery?: number
  bonus?: number
  arrears?: number
  otherDeductions?: number
  /**
   * Earnings and TDS already on this tax year's earlier payslips. With it, TDS is the projected
   * year's tax (paid so far + this month + fixed pay for the months left) less TDS already deducted,
   * spread over the months left; without it, a full year at the structure's pay is assumed.
   */
  ytd?: { gross: number; tds: number }
  config: PayrollConfig
}

export interface PayslipCalc {
  basic: number
  da: number
  hra: number
  conveyance: number
  special_allowance: number
  other_allowance: number
  ot_hours: number
  ot_pay: number
  bonus: number
  arrears: number
  gross_earnings: number
  pf_wages: number
  esi_wages: number
  pf_employee: number
  esi_employee: number
  professional_tax: number
  tds: number
  advance_recovery: number
  loan_recovery: number
  other_deductions: number
  total_deductions: number
  net_pay: number
  pf_employer_epf: number
  pf_employer_eps: number
  pf_edli: number
  pf_admin: number
  esi_employer: number
  employer_cost: number
}

export function computePayslip(i: PayslipInput): PayslipCalc {
  const { structure: s, config: cfg } = i
  const ratio = i.daysInMonth > 0 ? Math.max(0, Math.min(1, i.paidDays / i.daysInMonth)) : 0
  const earn = (x: number) => Math.round(x * ratio)
  const basic = earn(s.basic)
  const da = earn(s.da)
  const hra = earn(s.hra)
  const conveyance = earn(s.conveyance)
  const special_allowance = earn(s.special_allowance)
  const other_allowance = earn(s.other_allowance)
  const ot_hours = s.ot_eligible ? round2(i.otMinutesApproved / 60) : 0
  const ot_pay = s.ot_eligible ? Math.round(ot_hours * otHourlyRate(s, cfg)) : 0
  const bonus = Math.round(i.bonus ?? 0)
  const arrears = Math.round(i.arrears ?? 0)
  const gross_earnings = basic + da + hra + conveyance + special_allowance + other_allowance + ot_pay + bonus + arrears

  // EPF
  const pf_wages = basic + da
  const pfBase = cfg.pf_restrict_to_ceiling ? Math.min(pf_wages, cfg.pf_wage_ceiling) : pf_wages
  const epsBase = Math.min(pf_wages, cfg.pf_wage_ceiling)
  let pf_employee = 0, pf_employer_eps = 0, pf_employer_epf = 0, pf_edli = 0, pf_admin = 0
  if (s.pf_applicable && pf_wages > 0) {
    pf_employee = Math.round((pfBase * cfg.pf_employee_rate) / 100)
    pf_employer_eps = Math.round((epsBase * cfg.pf_employer_eps_rate) / 100)
    // Employer share is 12% in total; the part not going to EPS goes to EPF.
    pf_employer_epf = Math.max(0, Math.round((pfBase * cfg.pf_employee_rate) / 100) - pf_employer_eps)
    pf_edli = Math.round((epsBase * cfg.pf_edli_rate) / 100)
    pf_admin = Math.round((epsBase * cfg.pf_admin_rate) / 100)
  }

  // ESI — coverage decided on the fixed monthly gross (OT excluded), contribution on wages earned.
  const fixedGross = monthlyGross(s)
  const esiCovered = s.esi_applicable && fixedGross <= cfg.esi_wage_threshold
  const esi_wages = esiCovered ? gross_earnings - bonus : 0
  const esi_employee = esiCovered && esi_wages > 0 ? Math.ceil((esi_wages * cfg.esi_employee_rate) / 100) : 0
  const esi_employer = esiCovered && esi_wages > 0 ? Math.ceil((esi_wages * cfg.esi_employer_rate) / 100) : 0

  const professional_tax = s.pt_applicable ? professionalTax(gross_earnings, i.month, cfg.pt_slabs) : 0
  let tds = 0
  if (gross_earnings > 0 && i.ytd) {
    const left = taxMonthsLeft(i.month)
    const projected = i.ytd.gross + gross_earnings + fixedGross * (left - 1)
    const tax = taxOnAnnualGross(projected, fixedGross, i.regime, i.declaredDeductions, cfg).annual_tax
    tds = Math.max(0, Math.round((tax - i.ytd.tds) / left))
  } else if (gross_earnings > 0) tds = annualTax(s, i.regime, i.declaredDeductions, cfg).monthly_tds

  // Statutory deductions come first. Advance, loan and other recoveries only take what is left of
  // the month's earnings, so the slip balances and an EMI that could not be recovered stays
  // outstanding (emiDue picks it up next month) instead of being booked as recovered.
  const statutory = pf_employee + esi_employee + professional_tax + tds
  let room = Math.max(0, gross_earnings - statutory)
  const recover = (want: number | undefined) => {
    const amount = Math.min(room, Math.max(0, Math.round(want ?? 0)))
    room -= amount
    return amount
  }
  const advance_recovery = recover(i.advanceRecovery)
  const loan_recovery = recover(i.loanRecovery)
  const other_deductions = recover(i.otherDeductions)
  const total_deductions = statutory + advance_recovery + loan_recovery + other_deductions
  const net_pay = Math.max(0, gross_earnings - total_deductions)
  const employer_cost = gross_earnings + pf_employer_epf + pf_employer_eps + pf_edli + pf_admin + esi_employer

  return {
    basic, da, hra, conveyance, special_allowance, other_allowance, ot_hours, ot_pay, bonus, arrears, gross_earnings,
    pf_wages, esi_wages, pf_employee, esi_employee, professional_tax, tds, advance_recovery, loan_recovery, other_deductions,
    total_deductions, net_pay, pf_employer_epf, pf_employer_eps, pf_edli, pf_admin, esi_employer, employer_cost,
  }
}

/** EMI due for an advance/loan in a month given what has been recovered so far. */
export function emiDue(adv: { amount: number; emi_amount: number; start_month: YearMonth; status: string }, recovered: number, month: YearMonth): number {
  if (adv.status !== 'active' && adv.status !== 'approved') return 0
  if (month < adv.start_month) return 0
  const outstanding = Math.max(0, adv.amount - recovered)
  return Math.min(outstanding, adv.emi_amount)
}
