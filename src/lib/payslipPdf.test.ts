import { describe, expect, it } from 'vitest'
import type { Employee, Payslip } from '@/data/types'
import { employerContributions, payslipData, payslipLines, payslipsDocument, pdfInr } from './payslipPdf'

const slip: Payslip = {
  id: 'p1', created_at: '', updated_at: '', run_id: 'r1', employee_id: 'e1', month: '2026-09', days_in_month: 30, working_days: 26, present_days: 24,
  paid_leave_days: 1, holidays: 0, week_offs: 4, lop_days: 1, late_marks: 2, paid_days: 29, ot_hours: 3.5,
  basic: 13920, da: 1547, hra: 5568, conveyance: 1547, special_allowance: 8352, other_allowance: 0, ot_pay: 523, bonus: 0, arrears: 0, gross_earnings: 31457,
  pf_employee: 1800, esi_employee: 0, professional_tax: 200, tds: 0, advance_recovery: 4000, loan_recovery: 0, other_deductions: 0, total_deductions: 6000, net_pay: 25457,
  pf_employer_epf: 550, pf_employer_eps: 1250, pf_edli: 75, pf_admin: 75, esi_employer: 0, employer_cost: 33407, pf_wages: 15467, esi_wages: 0,
  tax_regime: 'new', published: true, remarks: 'Diwali bonus next month',
}

const emp = {
  id: 'e1', first_name: 'Ravi', last_name: 'Kumar M', emp_code: 'MMS-1005', date_of_joining: '2019-06-03', pan: 'ABCPK1234F', uan: '100912345678',
  esic_no: '', bank_name: 'Canara Bank', bank_account: '0461101012345', ifsc: 'CNRB0000461',
} as Employee

const settings = { legal_name: 'Melstar Manufacturing Systems Private Limited', registered_office: 'Rajajinagar, Bengaluru', cin: 'U29309KA2011PTC060656', pf_establishment_code: '', esi_employer_code: '' }

describe('payslip lines', () => {
  it('keeps Basic always and drops zero rows', () => {
    const { earnings, deductions } = payslipLines({ ...slip, basic: 0 })
    expect(earnings[0]).toMatchObject({ label: 'Basic', amount: 0 })
    expect(earnings.map((l) => l.label)).not.toContain('Other allowance')
    expect(earnings.map((l) => l.label)).not.toContain('Bonus')
    expect(earnings.find((l) => l.label === 'Overtime')?.note).toBe('3.5 h')
    expect(deductions.map((l) => l.label)).toEqual(['Provident fund (EPF)', 'Professional tax', 'Salary advance recovery'])
  })
  it('earnings and deductions add up to the slip totals', () => {
    const { earnings, deductions } = payslipLines(slip)
    expect(earnings.reduce((t, l) => t + l.amount, 0)).toBe(slip.gross_earnings)
    expect(deductions.reduce((t, l) => t + l.amount, 0)).toBe(slip.total_deductions)
  })
  it('sums employer contributions', () => {
    const er = employerContributions(slip)
    expect(er.pf).toBe(550 + 1250 + 75 + 75)
    expect(er.total).toBe(er.pf)
  })
})

describe('payslip data', () => {
  it('masks the bank account and fills blanks', () => {
    const d = payslipData(slip, emp, { designation: 'CNC Operator', department: 'Machining', settings })
    expect(d.employee.account).toBe('XXXXXXXX2345')
    expect(d.employee.esic).toBe('—')
    expect(d.employee.name).toBe('Ravi Kumar M')
    expect(d.company.name).toBe(settings.legal_name)
  })
  it('formats PDF amounts without the rupee glyph', () => {
    expect(pdfInr(130250)).toBe('Rs. 1,30,250')
  })
})

describe('payslip PDF', () => {
  it('draws one A4 page per payslip with net pay and amount in words', async () => {
    const d = payslipData(slip, emp, { designation: 'CNC Operator', department: 'Machining', settings })
    const doc = await payslipsDocument([d, { ...d, slip: { ...slip, id: 'p2', month: '2026-08' } }])
    expect(doc.getNumberOfPages()).toBe(2)
    const out = doc.output()
    expect(out).toContain('NET PAY')
    expect(out).toContain('Rs. 25,457')
    expect(out).toContain('Twenty Five Thousand Four Hundred Fifty Seven')
    expect(out).toContain('computer-generated payslip')
    expect(out).not.toContain('0461101012345')
  })
})
