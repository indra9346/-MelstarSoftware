import { beforeAll, describe, expect, it } from 'vitest'
import { generateSeed } from '@/data/seed'
import { db } from '@/data/store'
import type { Advance, Payslip } from '@/data/types'
import {
  RecoveryLedger, advanceProgress, attendanceContext, computeSlipFields, emiFor, isEmployedIn, planRun, recoveryOrder, runSlips, runTotals, splitRecoveries, structureFor, taxYearToDate,
} from './payroll'

// The seed computes its paid runs (Apr → Sep) with the payroll engine; the service must reproduce them exactly.
const NOW = new Date(2026, 9, 16, 12, 0, 0)
const TODAY = '2026-10-16'

beforeAll(async () => {
  const { tables } = await generateSeed(NOW)
  db.hydrate(tables)
}, 60_000)

const adv = (p: Partial<Advance>): Advance => ({
  id: 'a', created_at: '2026-04-01T00:00:00Z', updated_at: '', employee_id: 'e', type: 'salary_advance', amount: 12000, reason: 'x', requested_on: '2026-04-01',
  status: 'active', installments: 3, emi_amount: 4000, start_month: '2026-05', approved_by: null, approved_at: null, disbursed_on: null, review_note: '', ...p,
})

describe('payslip computation matches the seeded runs', () => {
  it('reproduces every paid payslip to the rupee', () => {
    const runs = db.all('payroll_runs').filter((r) => r.status === 'paid')
    expect(runs.length).toBeGreaterThanOrEqual(6)
    const ctx = attendanceContext(TODAY)
    const settings = db.settings()
    let checked = 0
    for (const run of runs) {
      const ledger = new RecoveryLedger(run.month, run.id)
      for (const slip of runSlips(run.id)) {
        const e = db.get('employees', slip.employee_id)!
        const st = structureFor(e.id, run.month)!
        // advances as they stood when the run was made (the seed closes them once recovered)
        const advances = recoveryOrder(db.where('advances', (a) => a.employee_id === e.id && (a.status === 'active' || a.status === 'closed')).map((a) => ({ ...a, status: 'active' as const })))
        const calc = computeSlipFields({ employee: e, month: run.month, structure: st, ctx, settings, advances, recovered: ledger.forEmployee(e.id, advances), ytd: taxYearToDate(e.id, run.month) })
        for (const [k, v] of Object.entries(calc)) expect([run.month, e.emp_code, k, (slip as unknown as Record<string, unknown>)[k]]).toEqual([run.month, e.emp_code, k, v])
        checked++
      }
      const t = runTotals(runSlips(run.id))
      expect(t).toMatchObject({ employee_count: run.employee_count, total_gross: run.total_gross, total_net: run.total_net, total_deductions: run.total_deductions, total_employer_cost: run.total_employer_cost })
    }
    expect(checked).toBeGreaterThan(150)
  })

  it('pays everyone on the rolls with a structure', () => {
    for (const run of db.all('payroll_runs').filter((r) => r.status === 'paid')) {
      const plan = planRun(run.month)
      expect(plan.skipped).toEqual([])
      expect(plan.eligible.map((x) => x.employee.id).sort()).toEqual(runSlips(run.id).map((p) => p.employee_id).sort())
    }
  })

  it('plans the current month as projected', () => {
    const plan = planRun('2026-10')
    expect(plan.projected).toBe(true)
    expect(plan.eligible.length).toBeGreaterThan(20)
    expect(plan.eligible.every((x) => isEmployedIn(x.employee, '2026-10'))).toBe(true)
  })
})

describe('advance recoveries', () => {
  it('EMI is the ceiling of amount ÷ installments', () => {
    expect(emiFor(10000, 3)).toBe(3334)
    expect(emiFor(12000, 3)).toBe(4000)
  })

  it('splits a slip back onto advances in recovery order', () => {
    const older = adv({ id: 'a1', amount: 6000, emi_amount: 3000, start_month: '2026-05' })
    const newer = adv({ id: 'a2', amount: 9000, emi_amount: 3000, start_month: '2026-07' })
    const loan = adv({ id: 'l1', type: 'loan', amount: 60000, emi_amount: 5000, start_month: '2026-06' })
    const slip: Pick<Payslip, 'month' | 'advance_recovery' | 'loan_recovery'> = { month: '2026-07', advance_recovery: 4000, loan_recovery: 5000 }
    const recovered = new Map([['a1', 5000]])
    const split = splitRecoveries(slip, [newer, loan, older], recovered).map(([a, amt]) => [a.id, amt])
    // a1 has only 1,000 outstanding, the rest goes to a2; the loan takes its EMI
    expect(split).toEqual([
      ['a1', 1000],
      ['l1', 5000],
      ['a2', 3000],
    ])
  })

  it('projects the remaining schedule after the last recovery', () => {
    const a = adv({ id: 'a9', amount: 10000, emi_amount: 3334, installments: 3, start_month: '2026-08' })
    const p = advanceProgress(a, [{ id: 'r', created_at: '', updated_at: '', advance_id: 'a9', payslip_id: 'p', month: '2026-08', amount: 3334 }], new Set(['2026-09']))
    expect(p.recovered).toBe(3334)
    expect(p.outstanding).toBe(6666)
    expect(p.next).toBe('2026-10') // September was already paid without this EMI
    expect(p.schedule).toEqual([
      { month: '2026-10', amount: 3334 },
      { month: '2026-11', amount: 3332 },
    ])
  })
})
