import { describe, expect, it } from 'vitest'
import type { SalaryStructure } from '@/data/types'
import { DEFAULT_PAYROLL_CONFIG as cfg, annualTax, computePayslip, otHourlyRate, professionalTax, slabTax } from './payroll'
import { amountInWords } from './format'

const base: SalaryStructure = {
  id: 's', created_at: '', updated_at: '', employee_id: 'e', effective_from: '2026-04-01', ctc_annual: 0,
  basic: 14400, da: 1600, hra: 5760, conveyance: 1600, special_allowance: 8640, other_allowance: 0,
  pf_applicable: true, esi_applicable: true, pt_applicable: true, ot_eligible: true, ot_rate_per_hour: null, notes: '',
}

describe('professional tax (Karnataka)', () => {
  it('is nil below ₹25,000 and ₹200 from ₹25,000', () => {
    expect(professionalTax(24999, '2026-10', cfg.pt_slabs)).toBe(0)
    expect(professionalTax(25000, '2026-10', cfg.pt_slabs)).toBe(200)
  })
  it('is ₹300 in February', () => {
    expect(professionalTax(40000, '2027-02', cfg.pt_slabs)).toBe(300)
  })
})

describe('income tax', () => {
  it('slab tax new regime ₹16L = ₹1.2L', () => {
    // 4-8L 5% = 20k, 8-12L 10% = 40k, 12-16L 15% = 60k
    expect(slabTax(1600000, cfg.tds_new_regime_slabs)).toBe(120000)
  })
  it('full 87A rebate up to ₹12L taxable (new regime)', () => {
    const s = { ...base, basic: 45000, da: 5000, hra: 18000, conveyance: 1600, special_allowance: 32650 } // ₹1,02,250 pm = 12.27L
    const t = annualTax(s, 'new', 0, cfg)
    expect(t.taxable).toBe(1227000 - 75000)
    expect(t.annual_tax).toBe(0)
  })
  it('marginal relief just above ₹12L taxable', () => {
    const s = { ...base, basic: 50000, da: 0, hra: 20000, conveyance: 0, special_allowance: 37500, other_allowance: 0 } // 12.9L gross → 12.15L taxable
    const t = annualTax(s, 'new', 0, cfg)
    expect(t.taxable).toBe(1215000)
    // slab tax 61,500 but liability capped at income above 12L = 15,000 (+4% cess)
    expect(t.annual_tax).toBe(Math.round(15000 * 1.04))
  })
  it('old regime with deductions', () => {
    const s = { ...base, basic: 40000, da: 0, hra: 16000, conveyance: 1600, special_allowance: 25733, other_allowance: 0 } // 83,333 pm ≈ 10L
    const t = annualTax(s, 'old', 150000, cfg)
    // taxable = 999996 - 50000 - 150000 - 2500 = 797496 → rounded to 797500
    expect(t.taxable).toBe(797500)
    // 12,500 + 20% of 2,97,500 = 59,500 → 72,000 + 4% = 74,880
    expect(t.annual_tax).toBe(74880)
  })
})

describe('payslip', () => {
  it('full month, PF capped at ₹15,000, ESI not applicable above ₹21,000', () => {
    const p = computePayslip({ month: '2026-09', structure: base, regime: 'new', declaredDeductions: 0, daysInMonth: 30, paidDays: 30, otMinutesApproved: 0, config: cfg })
    expect(p.gross_earnings).toBe(32000)
    expect(p.pf_wages).toBe(16000)
    expect(p.pf_employee).toBe(1800) // 12% of 15,000
    expect(p.pf_employer_eps).toBe(1250) // 8.33% of 15,000 → 1249.5 → 1250
    expect(p.pf_employer_epf).toBe(550)
    expect(p.esi_employee).toBe(0)
    expect(p.professional_tax).toBe(200)
    expect(p.tds).toBe(0)
    expect(p.net_pay).toBe(32000 - 1800 - 200)
  })
  it('LOP pro-rates earnings and ESI applies under ₹21,000', () => {
    const s = { ...base, basic: 8000, da: 1000, hra: 3200, conveyance: 1600, special_allowance: 2200 } // 16,000
    const p = computePayslip({ month: '2026-09', structure: s, regime: 'new', declaredDeductions: 0, daysInMonth: 30, paidDays: 27, otMinutesApproved: 120, config: cfg })
    expect(p.basic).toBe(7200)
    expect(p.ot_hours).toBe(2)
    expect(p.ot_pay).toBe(Math.round(2 * otHourlyRate(s, cfg)))
    expect(p.esi_employee).toBe(Math.ceil(p.esi_wages * 0.0075))
    expect(p.professional_tax).toBe(0)
    expect(p.pf_employee).toBe(Math.round((7200 + 900) * 0.12))
  })
  it('recoveries reduce net pay', () => {
    const p = computePayslip({ month: '2026-09', structure: base, regime: 'new', declaredDeductions: 0, daysInMonth: 30, paidDays: 30, otMinutesApproved: 0, advanceRecovery: 2000, loanRecovery: 1500, config: cfg })
    expect(p.total_deductions).toBe(1800 + 200 + 2000 + 1500)
  })
})

describe('amount in words', () => {
  it('uses lakh / thousand grouping', () => {
    expect(amountInWords(130250)).toBe('Rupees One Lakh Thirty Thousand Two Hundred Fifty Only')
    expect(amountInWords(30000)).toBe('Rupees Thirty Thousand Only')
  })
})
