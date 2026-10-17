import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Calculator, ChevronRight, FileText, HandCoins, Plus, ReceiptIndianRupee, Undo2 } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Advance, Payslip } from '@/data/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal, PageHeader, Progress, Select, StatusBadge, confirm, fadeUp } from '@/components/ui'
import { ChartBox, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { AdvanceDetails } from '@/components/payroll/AdvanceDetails'
import { DownloadPayslipButton, PayslipModal, usePayslipData } from '@/components/payroll/PayslipView'
import { RequestAdvanceModal } from '@/components/payroll/RequestAdvanceModal'
import { commit, fyOfMonth, fyOptions, useSticky } from '@/components/payroll/utils'
import { currentMonth, fmtDate, fmtMonth, fyLabel } from '@/lib/dates'
import { inr, inrCompact, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { annualTax, monthlyGross } from '@/lib/payroll'
import { ADVANCE_TYPE_LABEL, advanceProgress, currentStructure, withdrawAdvance } from '@/services/payroll'
import { useSession } from '@/services/session'

export default function MyPayslipsPage() {
  const s = useSession()
  const me = s.employee
  const allSlips = useTable('payslips')
  const allAdvances = useTable('advances')
  const recoveries = useTable('advance_recoveries')
  const structures = useTable('salary_structures')
  const settings = useSettings()
  const toData = usePayslipData()
  const startMonth = settings.financial_year_start_month || 4
  const thisFy = fyOfMonth(currentMonth(), startMonth)
  const [fy, setFy] = useState(String(thisFy))
  const [viewId, setViewId] = useState<string | null>(null)
  const [advId, setAdvId] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)

  // only my own, published payslips (RLS enforces the same on the server)
  const slips = useMemo(() => (me ? allSlips.filter((p) => p.employee_id === me.id && p.published).sort((a, b) => b.month.localeCompare(a.month)) : []), [allSlips, me])
  const advances = useMemo(() => (me ? allAdvances.filter((a) => a.employee_id === me.id).sort((a, b) => b.requested_on.localeCompare(a.requested_on) || b.created_at.localeCompare(a.created_at)) : []), [allAdvances, me])
  const years = useMemo(() => fyOptions([thisFy, ...slips.map((p) => fyOfMonth(p.month, startMonth))]), [slips, thisFy, startMonth])
  const fySlips = useMemo(() => slips.filter((p) => fyOfMonth(p.month, startMonth) === Number(fy)), [slips, fy, startMonth])
  const ytd = useMemo(() => {
    const t = { gross: 0, pf: 0, pt: 0, tds: 0, net: 0 }
    for (const p of fySlips) {
      t.gross += p.gross_earnings
      t.pf += p.pf_employee
      t.pt += p.professional_tax
      t.tds += p.tds
      t.net += p.net_pay
    }
    return t
  }, [fySlips])
  const chart = useMemo(() => [...fySlips].reverse().map((p) => ({ month: fmtMonth(p.month, true).slice(0, 3), full: fmtMonth(p.month), net: p.net_pay, id: p.id })), [fySlips])
  const structure = me ? currentStructure(me.id, structures) : undefined
  const gross = structure ? monthlyGross(structure) : null
  const tax = structure && me ? annualTax(structure, me.tax_regime, me.declared_deductions, settings.payroll) : null

  const viewing = slips.find((p) => p.id === viewId) ?? null
  const advOpen = advances.find((a) => a.id === advId) ?? null
  const advShown = useSticky(advOpen)

  if (!me) {
    return (
      <div>
        <PageHeader kicker="My space" title="Payslips" />
        <EmptyState title="No employee record linked" description="Your login is not linked to an employee record, so there are no payslips to show. Please contact HR." />
      </div>
    )
  }

  const withdraw = async (a: Advance) => {
    const ok = await confirm({ title: 'Withdraw this request?', message: `${ADVANCE_TYPE_LABEL[a.type]} of ${inr(a.amount)} requested on ${fmtDate(a.requested_on)}.`, confirmLabel: 'Withdraw', danger: true })
    if (!ok) return
    const res = await commit(() => withdrawAdvance(a.id), 'Request withdrawn')
    if (res.ok) setAdvId(null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="My space"
        title="Payslips"
        subtitle="Monthly salary slips, tax projection and advances"
        actions={
          <>
            <div className="w-40">
              <Select aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)} options={years} />
            </div>
            <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setRequesting(true)}>
              Request advance
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0} className="relative min-w-0 overflow-hidden rounded-[20px] bg-grad p-5 text-white shadow-btn sm:p-6">
          <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <p className="text-[11.5px] font-semibold uppercase tracking-[.16em] text-white/80">Net pay · FY {fyLabel(Number(fy))}</p>
          <p className="num mt-1 font-display text-[32px] font-bold leading-tight sm:text-[38px]">{inr(ytd.net)}</p>
          <p className="text-[12.5px] text-white/80">
            {fySlips.length} payslip{fySlips.length === 1 ? '' : 's'}
            {fySlips[0] ? ` · latest ${fmtMonth(fySlips[0].month)}` : ''}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Gross', ytd.gross],
              ['Provident fund', ytd.pf],
              ['Professional tax', ytd.pt],
              ['TDS', ytd.tds],
            ].map(([k, v]) => (
              <div key={k as string} className="min-w-0 rounded-xl bg-white/15 px-3 py-2">
                <p className="truncate text-[11px] font-medium text-white/80">{k}</p>
                <p className="num truncate text-[15px] font-semibold">{inr(v as number)}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <Card className="min-w-0">
          <CardHeader title="Net pay by month" subtitle={`FY ${fyLabel(Number(fy))}`} icon={<ReceiptIndianRupee className="h-4 w-4" />} />
          <CardBody className="min-w-0 pt-2">
            {chart.length ? (
              <ChartBox height={170}>
                <BarChart data={chart} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="myNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#06b6d4" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} interval={0} />
                  <YAxis {...axisProps} tickFormatter={(v) => inrCompact(Number(v))} width={48} />
                  <Tooltip {...tooltipProps} formatter={(v) => [inr(Number(v)), 'Net pay']} labelFormatter={(_, p) => (p?.[0]?.payload as { full?: string } | undefined)?.full ?? ''} />
                  <Bar dataKey="net" fill="url(#myNet)" radius={[6, 6, 0, 0]} maxBarSize={26} cursor="pointer" onClick={(d) => setViewId((d as { payload?: { id?: string } }).payload?.id ?? null)} />
                </BarChart>
              </ChartBox>
            ) : (
              <p className="py-10 text-center text-[13px] text-ink-faint">No payslips in this year yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">
            Payslips <span className="text-ink-faint">· {fySlips.length}</span>
          </h2>
        </div>
        {fySlips.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fySlips.map((p, i) => (
              <SlipCard key={p.id} p={p} i={i} latest={p.id === slips[0]?.id} onOpen={() => setViewId(p.id)} download={<DownloadPayslipButton data={toData(p)} size="sm" variant="secondary" label="PDF" />} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="No payslips yet" description="Your payslip appears here as soon as the month’s salary is paid." />
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader
            title="Income tax projection"
            subtitle={`${me.tax_regime === 'old' ? 'Old' : 'New'} regime · read-only`}
            icon={<Calculator className="h-4 w-4" />}
            actions={<Badge tone={me.tax_regime === 'old' ? 'violet' : 'cyan'}>{me.tax_regime === 'old' ? 'Old regime' : 'New regime'}</Badge>}
          />
          <CardBody>
            {tax && structure ? (
              <>
                <Row k="Annual gross (current structure)" v={inr(tax.annual_gross)} />
                <Row k="Standard deduction" v={`− ${inr(tax.standard_deduction)}`} />
                {me.tax_regime === 'old' && <Row k="Declared deductions + PT" v={`− ${inr(tax.other_deductions)}`} />}
                <Row k="Taxable income" v={inr(tax.taxable)} strong />
                <Row k="Tax on slabs" v={inr(tax.slab_tax)} />
                {tax.rebate > 0 && <Row k="Rebate u/s 87A" v={`− ${inr(tax.rebate)}`} />}
                <Row k={`Health & education cess (${settings.payroll.tds_cess_rate}%)`} v={inr(tax.cess)} />
                <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-indigo-50/70 px-3.5 py-2.5">
                  <span className="text-[13px] font-semibold text-ink">Projected annual tax</span>
                  <span className="num font-display text-lg font-bold text-ink">{inr(tax.annual_tax)}</span>
                </div>
                <p className="mt-2 text-[12.5px] text-ink-soft">
                  Monthly TDS ≈ <b className="num text-ink">{inr(tax.monthly_tds)}</b> · deducted so far in FY {fyLabel(Number(fy))}: <b className="num text-ink">{inr(ytd.tds)}</b>
                </p>
                <p className="mt-2 text-[12px] text-ink-faint">
                  Based on your structure from {fmtDate(structure.effective_from)} ({inr(gross ?? 0)}/month). To change regime or declare investments, please contact HR.
                </p>
              </>
            ) : (
              <EmptyState title="No salary structure on file" description="Your tax projection appears once HR sets up your salary structure." />
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Advances & loans"
            subtitle="Interest-free, recovered from salary"
            icon={<HandCoins className="h-4 w-4" />}
            actions={
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRequesting(true)}>
                Request
              </Button>
            }
          />
          <CardBody>
            {advances.length ? (
              <ul className="space-y-2.5">
                {advances.map((a, i) => {
                  const prog = advanceProgress(a, recoveries)
                  return (
                    <motion.li key={a.id} variants={fadeUp} initial="hidden" animate="show" custom={i}>
                      <button type="button" onClick={() => setAdvId(a.id)} className="w-full rounded-2xl border border-indigo-100 bg-white/90 p-3.5 text-left transition hover:-translate-y-px hover:border-indigo-200 hover:shadow-soft">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge tone={a.type === 'loan' ? 'violet' : 'cyan'}>{ADVANCE_TYPE_LABEL[a.type]}</Badge>
                            <span className="num font-display font-bold text-ink">{inr(a.amount)}</span>
                          </span>
                          <StatusBadge status={a.status} />
                        </div>
                        <p className="mt-1.5 truncate text-[12.5px] text-ink-soft">
                          {inr(a.emi_amount)} × {a.installments} from {fmtMonth(a.start_month, true)} · {a.reason}
                        </p>
                        {(a.status === 'active' || a.status === 'closed' || a.status === 'approved') && (
                          <>
                            <Progress value={prog.recovered} max={a.amount} className="mt-2.5" />
                            <div className="mt-1.5 flex justify-between gap-2 text-[12px] text-ink-soft">
                              <span>Recovered {inr(prog.recovered)}</span>
                              <span>Outstanding {inr(prog.outstanding)}</span>
                            </div>
                          </>
                        )}
                        {a.status === 'rejected' && a.review_note && <p className="mt-1.5 text-[12px] text-rose-600">HR: {a.review_note}</p>}
                      </button>
                    </motion.li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No advances" description={`Need money before payday? You can request up to 3 months’ gross${gross ? ` (${inr(gross * 3)})` : ''} as a salary advance.`} />
            )}
          </CardBody>
        </Card>
      </div>

      <PayslipModal slip={viewing} onClose={() => setViewId(null)} />
      <Modal
        open={!!advOpen}
        onClose={() => setAdvId(null)}
        side
        title={advShown ? `${ADVANCE_TYPE_LABEL[advShown.type]} · ${inr(advShown.amount)}` : ''}
        subtitle={advShown ? `Requested ${fmtDate(advShown.requested_on)}` : undefined}
        footer={
          advShown?.status === 'pending' ? (
            <Button variant="danger" icon={<Undo2 className="h-4 w-4" />} onClick={() => withdraw(advShown)}>
              Withdraw request
            </Button>
          ) : undefined
        }
      >
        {advShown && <AdvanceDetails advance={advShown} />}
      </Modal>
      <RequestAdvanceModal open={requesting} onClose={() => setRequesting(false)} monthlyGross={gross} />
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-indigo-50 py-1.5 text-[13px] last:border-0">
      <span className="min-w-0 text-ink-soft">{k}</span>
      <span className={cn('num shrink-0 text-right', strong ? 'font-semibold text-ink' : 'text-ink')}>{v}</span>
    </div>
  )
}

function SlipCard({ p, i, latest, onOpen, download }: { p: Payslip; i: number; latest: boolean; onOpen: () => void; download: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={i} className="card group relative min-w-0 overflow-hidden p-4 transition-shadow duration-300 hover:shadow-lift">
      <button type="button" onClick={onOpen} className="absolute inset-0 z-0" aria-label={`Open payslip for ${fmtMonth(p.month)}`} />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            {fmtMonth(p.month)}
            {latest && <Badge tone="pink">Latest</Badge>}
          </p>
          <p className="num grad-text mt-1 font-display text-[26px] font-bold leading-tight">{inr(p.net_pay)}</p>
          <p className="text-[12px] text-ink-soft">net pay</p>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="pointer-events-none relative z-10 mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
        <div className="min-w-0 rounded-xl bg-indigo-50/60 px-2.5 py-1.5">
          <p className="text-ink-faint">Gross</p>
          <p className="num truncate font-semibold text-ink">{inr(p.gross_earnings)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-indigo-50/60 px-2.5 py-1.5">
          <p className="text-ink-faint">Deductions</p>
          <p className="num truncate font-semibold text-ink">{inr(p.total_deductions)}</p>
        </div>
      </div>
      <div className="relative z-10 mt-3 flex items-center justify-between gap-2">
        <span className="pointer-events-none text-[12px] text-ink-soft">
          Paid {num(p.paid_days)}/{p.days_in_month} days{p.lop_days ? ` · LOP ${num(p.lop_days)}` : ''}
        </span>
        {download}
      </div>
    </motion.div>
  )
}
