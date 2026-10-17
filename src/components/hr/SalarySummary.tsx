import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { IndianRupee } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, EmptyState, KV } from '@/components/ui'
import { SERIES } from '@/components/charts'
import { useSettings, useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { currentMonth, daysInMonth, fmtDate, todayISO } from '@/lib/dates'
import { inr, inr2 } from '@/lib/format'
import { annualCtc, computePayslip, monthlyGross, otHourlyRate } from '@/lib/payroll'
import { currentStructure } from '@/services/hr'

const PARTS = [
  ['basic', 'Basic'],
  ['da', 'Dearness allowance'],
  ['hra', 'HRA'],
  ['conveyance', 'Conveyance'],
  ['special_allowance', 'Special allowance'],
  ['other_allowance', 'Other allowance'],
] as const

/** Current salary structure with an estimated full-month take-home. */
export function SalarySummary({ employee, emptyHint }: { employee: Employee; emptyHint?: string }) {
  const settings = useSettings()
  const rows = useTable('salary_structures')
  const today = todayISO()
  const s = useMemo(() => currentStructure(rows, employee.id, today), [rows, employee.id, today])
  const revisions = useMemo(() => rows.filter((r) => r.employee_id === employee.id).length, [rows, employee.id])

  const calc = useMemo(() => {
    if (!s) return null
    const month = currentMonth()
    const dim = daysInMonth(month)
    return computePayslip({
      month, structure: s, regime: employee.tax_regime, declaredDeductions: employee.declared_deductions, daysInMonth: dim, paidDays: dim, otMinutesApproved: 0, config: settings.payroll,
    })
  }, [s, employee.tax_regime, employee.declared_deductions, settings.payroll])

  if (!s || !calc)
    return (
      <Card>
        <CardHeader title="Salary" icon={<IndianRupee className="h-4 w-4" />} />
        <CardBody>
          <EmptyState icon={<IndianRupee className="h-6 w-6" />} title="No salary structure" description={emptyHint ?? 'Add a salary structure in Payroll.'} />
        </CardBody>
      </Card>
    )

  const gross = monthlyGross(s)
  const ctc = s.ctc_annual > 0 ? s.ctc_annual : annualCtc(s, settings.payroll)
  const parts = PARTS.map(([k, label], i) => ({ k, label, v: s[k], color: SERIES[i]! })).filter((p) => p.v > 0)
  const future = s.effective_from > today

  return (
    <Card>
      <CardHeader
        title="Salary structure"
        subtitle={`${future ? 'Takes effect' : 'Effective from'} ${fmtDate(s.effective_from)}${revisions > 1 ? ` · ${revisions} revisions on record` : ''}`}
        icon={<IndianRupee className="h-4 w-4" />}
        actions={future ? <Badge tone="amber">Upcoming</Badge> : undefined}
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['Monthly gross', inr(gross)],
            ['Annual CTC', inr(ctc)],
            ['Est. take-home', inr(calc.net_pay)],
          ].map(([k, v], i) => (
            <motion.div key={k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="min-w-0 rounded-2xl border border-indigo-100/80 bg-gradient-to-br from-white to-indigo-50/50 px-4 py-3">
              <p className="text-[12px] font-semibold text-ink-soft">{k}</p>
              <p className="num font-display text-xl font-bold text-ink">{v}</p>
            </motion.div>
          ))}
        </div>

        {/* composition bar */}
        <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-indigo-50" aria-hidden>
          {parts.map((p, i) => (
            <motion.span key={p.k} initial={{ width: 0 }} animate={{ width: `${(p.v / gross) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }} style={{ background: p.color }} className="h-full" />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Monthly earnings</p>
            {parts.map((p) => (
              <KV
                key={p.k}
                k={
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.label}
                  </span>
                }
                v={inr(p.v)}
              />
            ))}
            <div className="mt-1 border-t border-indigo-100 pt-1">
              <KV k="Gross" v={inr(gross)} strong />
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1 mt-3 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint md:mt-0">Estimated deductions (full month)</p>
            <KV k="Provident fund" v={inr(calc.pf_employee)} />
            <KV k="ESI" v={inr(calc.esi_employee)} />
            <KV k="Professional tax" v={inr(calc.professional_tax)} />
            <KV k={`TDS (${employee.tax_regime} regime)`} v={inr(calc.tds)} />
            <div className="mt-1 border-t border-indigo-100 pt-1">
              <KV k="Take-home" v={inr(calc.net_pay)} strong />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <Badge tone={s.pf_applicable ? 'green' : 'slate'}>PF {s.pf_applicable ? 'on' : 'off'}</Badge>
          <Badge tone={s.esi_applicable && gross <= settings.payroll.esi_wage_threshold ? 'green' : 'slate'}>ESI {s.esi_applicable && gross <= settings.payroll.esi_wage_threshold ? 'covered' : 'not covered'}</Badge>
          <Badge tone={s.pt_applicable ? 'green' : 'slate'}>PT {s.pt_applicable ? 'on' : 'off'}</Badge>
          <Badge tone={s.ot_eligible ? 'cyan' : 'slate'}>{s.ot_eligible ? `OT ${inr2(otHourlyRate(s, settings.payroll))}/hr` : 'No OT'}</Badge>
        </div>
        <p className="mt-3 text-[12px] text-ink-faint">Estimates assume a full month without overtime, advances or loan recoveries. Actual figures are on the payslip.</p>
      </CardBody>
    </Card>
  )
}
