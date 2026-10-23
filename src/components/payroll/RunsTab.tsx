import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Banknote, CalendarClock, Factory, Info, IndianRupee, Play, Users, Wallet } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { PayrollRun, YearMonth } from '@/data/types'
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Modal, Select, StatCard, type Column } from '@/components/ui'
import { ChartBox, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { addMonths, currentMonth, fmtDate, fmtMonth, fyLabel, fyMonths, todayISO } from '@/lib/dates'
import { fullName, inr, inrCompact, num } from '@/lib/format'
import { planRun, createRun } from '@/services/payroll'
import { useSession } from '@/services/session'
import { RunStepBadge } from './RunStepper'
import { commit, fyOfMonth, fyOptions, monthOption, monthRange } from './utils'

export function RunsTab({ runOpen, setRunOpen }: { runOpen: boolean; setRunOpen: (v: boolean) => void }) {
  const runs = useTable('payroll_runs')
  const settings = useSettings()
  const nav = useNavigate()
  const s = useSession()
  const startMonth = settings.financial_year_start_month || 4
  const thisFy = fyOfMonth(currentMonth(), startMonth)
  const years = useMemo(() => fyOptions([thisFy, ...runs.map((r) => fyOfMonth(r.month, startMonth))]), [runs, thisFy, startMonth])
  const [fy, setFy] = useState(String(thisFy))

  const fyRuns = useMemo(() => runs.filter((r) => fyOfMonth(r.month, startMonth) === Number(fy)).sort((a, b) => b.month.localeCompare(a.month)), [runs, fy, startMonth])
  const stats = useMemo(() => {
    const t = { gross: 0, net: 0, cost: 0, heads: 0 }
    for (const r of fyRuns) {
      t.gross += r.total_gross
      t.net += r.total_net
      t.cost += r.total_employer_cost
      t.heads += r.employee_count
    }
    return { ...t, avgHeads: fyRuns.length ? t.heads / fyRuns.length : 0, paid: fyRuns.filter((r) => r.status === 'paid').length }
  }, [fyRuns])
  const chart = useMemo(() => {
    const byMonth = new Map(fyRuns.map((r) => [r.month, r]))
    return fyMonths(Number(fy), startMonth).map((m) => {
      const r = byMonth.get(m)
      return { month: fmtMonth(m, true).slice(0, 3), full: fmtMonth(m), gross: r?.total_gross ?? 0, net: r?.total_net ?? 0, cost: r?.total_employer_cost ?? 0 }
    })
  }, [fyRuns, fy, startMonth])

  const columns: Column<PayrollRun>[] = [
    { key: 'month', header: 'Month', value: (r) => r.month, exportValue: (r) => fmtMonth(r.month), cell: (r) => <span className="font-semibold text-ink">{fmtMonth(r.month)}</span> },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <RunStepBadge status={r.status} /> },
    { key: 'emps', header: 'Employees', align: 'right', value: (r) => r.employee_count },
    { key: 'gross', header: 'Gross', align: 'right', value: (r) => r.total_gross, cell: (r) => inr(r.total_gross) },
    { key: 'ded', header: 'Deductions', align: 'right', value: (r) => r.total_deductions, cell: (r) => inr(r.total_deductions), hideOnMobile: true },
    { key: 'net', header: 'Net pay', align: 'right', value: (r) => r.total_net, cell: (r) => <span className="font-semibold">{inr(r.total_net)}</span> },
    { key: 'cost', header: 'Employer cost', align: 'right', value: (r) => r.total_employer_cost, cell: (r) => inr(r.total_employer_cost), hideOnMobile: true },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full xs:w-48">
          <Select aria-label="Financial year" options={years} value={fy} onChange={(e) => setFy(e.target.value)} />
        </div>
        <p className="text-[12.5px] text-ink-soft">
          {fyRuns.length} run{fyRuns.length === 1 ? '' : 's'} · {stats.paid} paid
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="YTD gross" value={stats.gross} format={inrCompact} icon={<IndianRupee className="h-4 w-4" />} accent="indigo" hint={inr(stats.gross)} />
        <StatCard label="YTD net pay" value={stats.net} format={inrCompact} icon={<Wallet className="h-4 w-4" />} accent="cyan" hint={inr(stats.net)} />
        <StatCard label="YTD employer cost" value={stats.cost} format={inrCompact} icon={<Factory className="h-4 w-4" />} accent="pink" hint={inr(stats.cost)} />
        <StatCard label="Average headcount" value={stats.avgHeads} format={(n) => num(Math.round(n * 10) / 10, 1)} icon={<Users className="h-4 w-4" />} accent="green" hint="employees paid per run" />
      </div>

      <Card>
        <CardHeader title="Month-wise payroll cost" subtitle={`FY ${fyLabel(Number(fy))} · gross vs net vs employer cost`} icon={<Banknote className="h-4 w-4" />} />
        <CardBody className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-soft">
            {[
              ['Gross', SERIES[0]],
              ['Net pay', SERIES[1]],
              ['Employer cost', SERIES[2]],
            ].map(([l, c]) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
          <ChartBox height={250}>
            <BarChart data={chart} margin={{ top: 6, right: 4, left: -6, bottom: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 10.5 }} />
              <YAxis {...axisProps} tickFormatter={(v) => inrCompact(Number(v))} width={52} />
              <Tooltip {...tooltipProps} formatter={(v) => inr(Number(v))} labelFormatter={(_, p) => (p?.[0]?.payload as { full?: string } | undefined)?.full ?? ''} />
              <Bar dataKey="gross" name="Gross" fill={SERIES[0]} radius={[2, 2, 0, 0]} maxBarSize={18} />
              <Bar dataKey="net" name="Net pay" fill={SERIES[1]} radius={[2, 2, 0, 0]} maxBarSize={18} />
              <Bar dataKey="cost" name="Employer cost" fill={SERIES[2]} radius={[2, 2, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ChartBox>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Payroll runs"
          subtitle="Open a run to review payslips, approve and pay"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <CardBody>
          <DataTable
            rows={fyRuns}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => nav(`/admin/payroll/${r.id}`)}
            exportName={`payroll-runs-FY${fyLabel(Number(fy))}`}
            exportSubtitle={`FY ${fyLabel(Number(fy))}`}
            empty={
              <EmptyState
                title="No payroll runs in this year"
                description={s.can('payroll.manage') ? 'Run payroll for a month to create a draft with every employee’s payslip.' : 'Runs appear here once HR processes payroll.'}
                action={
                  s.can('payroll.manage') && (
                    <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={() => setRunOpen(true)}>
                      Run payroll
                    </Button>
                  )
                }
              />
            }
            mobileCard={(r) => (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{fmtMonth(r.month)}</p>
                  <p className="mt-0.5 text-[12px] text-ink-soft">
                    {r.employee_count} employees · gross {inr(r.total_gross)}
                  </p>
                  <RunStepBadge status={r.status} className="mt-2" />
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Net</p>
                  <p className="num text-lg font-semibold text-ink">{inr(r.total_net)}</p>
                </div>
              </div>
            )}
          />
        </CardBody>
      </Card>

      <RunPayrollModal open={runOpen} onClose={() => setRunOpen(false)} onCreated={(id) => nav(`/admin/payroll/${id}`)} />
    </div>
  )
}

function RunPayrollModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (runId: string) => void }) {
  const runs = useTable('payroll_runs')
  const employees = useTable('employees')
  const structures = useTable('salary_structures')
  const cm = currentMonth()
  const taken = useMemo(() => new Set(runs.map((r) => r.month)), [runs])
  const months = useMemo(() => monthRange(addMonths(cm, -12), 13).reverse(), [cm])
  const firstFree = months.find((m) => !taken.has(m)) ?? ''
  const [month, setMonth] = useState<YearMonth>(firstFree)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setMonth(firstFree)
  }, [open])

  // employees / structures are deps so the preview follows live edits
  const plan = useMemo(() => (month ? planRun(month) : null), [month, employees, structures])
  const monthError = !month ? 'Pick a month.' : month > cm ? 'Payroll cannot be run for a future month.' : taken.has(month) ? `Payroll for ${fmtMonth(month)} has already been run.` : null
  const planError = !monthError && plan && !plan.eligible.length ? 'Nobody with a salary structure was on the rolls that month.' : null
  const error = monthError ?? planError

  const submit = async () => {
    if (error) return
    setBusy(true)
    const res = await commit(() => createRun(month), `Draft payroll created for ${fmtMonth(month)}`, (r) => `${r.created} payslips${r.skipped.length ? ` · ${r.skipped.length} skipped (no salary structure)` : ''}`)
    setBusy(false)
    if (res.ok) {
      onClose()
      onCreated(res.value.run.id)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run payroll"
      subtitle="Creates a draft run with a payslip for everyone on the rolls that month"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!!error} icon={<Play className="h-4 w-4" />}>
            Create draft run
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Month" required error={monthError} hint="Months already run are disabled.">
          <Select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="Select month"
            options={months.map((m) => ({ ...monthOption(m), label: taken.has(m) ? `${fmtMonth(m)} — already run` : m === cm ? `${fmtMonth(m)} — current month` : fmtMonth(m), disabled: taken.has(m) }))}
          />
        </Field>

        {plan && !taken.has(month) && (
          <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
            <div className="rounded-lg border border-line bg-slate-50 p-3.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Payslips</p>
              <p className="num text-2xl font-semibold text-ink">{plan.eligible.length}</p>
              <p className="text-[12px] text-ink-soft">employees on the rolls with a structure</p>
            </div>
            <div className="rounded-lg border border-line bg-slate-50 p-3.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Fixed monthly gross</p>
              <p className="num text-2xl font-semibold text-ink">
                {inr(plan.eligible.reduce((t, x) => t + x.structure.basic + x.structure.da + x.structure.hra + x.structure.conveyance + x.structure.special_allowance + x.structure.other_allowance, 0))}
              </p>
              <p className="text-[12px] text-ink-soft">before LOP, OT and deductions</p>
            </div>
          </div>
        )}

        {planError && (
          <p className="flex gap-2.5 rounded-md bg-amber-50 px-3.5 py-3 text-[13px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {planError}
          </p>
        )}

        <AnimatePresence initial={false}>
          {plan?.projected && !taken.has(month) && (
            <motion.p key="proj" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2.5 overflow-hidden rounded-md bg-sky-50 px-3.5 py-3 text-[13px] text-sky-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {fmtMonth(month)} is still running: days after today ({fmtDate(todayISO())}) are counted as paid (projected). Recalculate the draft after month end before processing.
              </span>
            </motion.p>
          )}
          {plan && plan.skipped.length > 0 && !taken.has(month) && (
            <motion.div key="skip" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-md bg-amber-50 px-3.5 py-3 text-[13px] text-amber-800">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {plan.skipped.length} employee{plan.skipped.length === 1 ? '' : 's'} will be skipped — no salary structure
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {plan.skipped.map((e) => (
                  <Badge key={e.id} tone="amber">
                    {fullName(e)} · {e.emp_code}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[12px]">Add their structures under Salary structures, then recalculate the draft.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
