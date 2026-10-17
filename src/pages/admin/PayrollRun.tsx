import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, BadgeCheck, Banknote, CheckCircle2, Download, Factory, FileSpreadsheet, FileStack, FileText, Info, Landmark, Lock, PencilLine,
  RefreshCw, Trash2, Undo2, Users, Wallet, MinusCircle,
} from 'lucide-react'
import { useRow, useTable } from '@/data/store'
import type { Payslip } from '@/data/types'
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Input, Menu, Modal, PageHeader, StatCard, Textarea, confirm, toast, type Column,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { RunStepper } from '@/components/payroll/RunStepper'
import { PayslipModal, usePayslipData } from '@/components/payroll/PayslipView'
import { commit, exportTableCsv, exportTablePdf, rs, toNum, useSticky, type XCol } from '@/components/payroll/utils'
import { useLookups } from '@/hooks/useLookups'
import { currentMonth, fmtDate, fmtDateTime, fmtMonth, todayISO } from '@/lib/dates'
import { exportCsv } from '@/lib/export'
import { fullName, inr, inrCompact, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { downloadPayslips } from '@/lib/payslipPdf'
import { audit } from '@/services/audit'
import {
  approveRun, deleteDraftRun, payRun, planRun, previewSlip, processRun, recalcRun, recalcSlip, unprocessRun, type SlipFields,
} from '@/services/payroll'
import { useSession } from '@/services/session'

const hasAdjustments = (p: Payslip) => p.bonus > 0 || p.arrears > 0 || p.other_deductions > 0 || !!p.remarks
const recoveries = (p: Payslip) => p.advance_recovery + p.loan_recovery

export default function PayrollRunPage() {
  const { runId } = useParams()
  const run = useRow('payroll_runs', runId)
  const allSlips = useTable('payslips')
  const employees = useTable('employees')
  const structures = useTable('salary_structures')
  const L = useLookups()
  const s = useSession()
  const nav = useNavigate()
  const toData = usePayslipData()
  const canManage = s.can('payroll.manage')
  const [viewId, setViewId] = useState<string | null>(null)
  const [adjustId, setAdjustId] = useState<string | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const slips = useMemo(
    () =>
      run
        ? allSlips
            .filter((p) => p.run_id === run.id)
            .sort((a, b) => (L.emp.get(a.employee_id)?.emp_code ?? '').localeCompare(L.emp.get(b.employee_id)?.emp_code ?? '', 'en-IN', { numeric: true }))
        : [],
    [allSlips, run, L.emp],
  )
  const t = useMemo(() => {
    const z = { paid: 0, lop: 0, ot: 0, gross: 0, pf: 0, esi: 0, pt: 0, tds: 0, rec: 0, other: 0, ded: 0, net: 0, cost: 0 }
    for (const p of slips) {
      z.paid += p.paid_days
      z.lop += p.lop_days
      z.ot += p.ot_hours
      z.gross += p.gross_earnings
      z.pf += p.pf_employee
      z.esi += p.esi_employee
      z.pt += p.professional_tax
      z.tds += p.tds
      z.rec += recoveries(p)
      z.other += p.other_deductions
      z.ded += p.total_deductions
      z.net += p.net_pay
      z.cost += p.employer_cost
    }
    return z
  }, [slips])
  // follows new structures / joiners live
  const plan = useMemo(() => (run?.status === 'draft' ? planRun(run.month) : null), [run?.status, run?.month, employees, structures])
  const missingFromRun = plan ? plan.eligible.filter((x) => !slips.some((p) => p.employee_id === x.employee.id)).map((x) => x.employee) : []

  if (!run) {
    return (
      <div>
        <PageHeader kicker="Payroll run" title="Run not found" />
        <EmptyState
          title="This payroll run does not exist"
          description="It may have been deleted (only draft runs can be deleted)."
          action={
            <Link to="/admin/payroll">
              <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />}>
                Back to payroll
              </Button>
            </Link>
          }
        />
      </div>
    )
  }

  const month = fmtMonth(run.month)
  const projected = run.status === 'draft' && run.month >= currentMonth()
  const viewing = slips.find((p) => p.id === viewId) ?? null
  const adjusting = slips.find((p) => p.id === adjustId) ?? null

  /* ── actions ── */
  const doRecalc = async () => {
    setBusy('recalc')
    await commit(() => recalcRun(run.id), 'Payroll recalculated', (r) => `${r.updated + r.added} payslips${r.added ? ` · ${r.added} added` : ''}${r.removed ? ` · ${r.removed} removed` : ''}${r.skipped.length ? ` · ${r.skipped.length} without a structure` : ''}`)
    setBusy(null)
  }
  const doProcess = async () => {
    const ok = await confirm({ title: `Process ${month} payroll?`, message: `${slips.length} payslips (net ${inr(t.net)}) will be locked for approval. Move it back to draft if anything needs to change.`, confirmLabel: 'Process & lock' })
    if (!ok) return
    setBusy('process')
    await commit(() => processRun(run.id), `${month} payroll processed`, 'Waiting for approval')
    setBusy(null)
  }
  const doUnprocess = async () => {
    const ok = await confirm({ title: 'Move back to draft?', message: 'Payslips become editable again and can be recalculated.', confirmLabel: 'Back to draft' })
    if (!ok) return
    setBusy('unprocess')
    await commit(() => unprocessRun(run.id), 'Moved back to draft')
    setBusy(null)
  }
  const doApprove = async () => {
    const ok = await confirm({ title: `Approve ${month} payroll?`, message: `Net pay ${inr(t.net)} to ${slips.length} employees · employer cost ${inr(t.cost)}.`, confirmLabel: 'Approve' })
    if (!ok) return
    setBusy('approve')
    await commit(() => approveRun(run.id), `${month} payroll approved`, 'Ready to pay')
    setBusy(null)
  }
  const doDelete = async () => {
    const ok = await confirm({ title: `Delete the ${month} draft?`, message: `The run and its ${slips.length} draft payslips will be removed. You can run payroll for ${month} again afterwards.`, confirmLabel: 'Delete run', danger: true })
    if (!ok) return
    setBusy('delete')
    const res = await commit(() => deleteDraftRun(run.id), 'Draft run deleted')
    setBusy(null)
    if (res.ok) nav('/admin/payroll')
  }

  /* ── exports ── */
  const downloadAll = async () => {
    setBusy('pdf')
    try {
      await downloadPayslips(slips.map(toData), `Payslips_${run.month}.pdf`)
      audit('export', 'payroll_runs', run.id, `Downloaded all ${slips.length} payslips for ${month}`)
    } catch (e) {
      toast.error('Could not create the PDF', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const bankFile = () => {
    const rows = slips.filter((p) => p.net_pay > 0).map((p) => ({ p, e: L.emp.get(p.employee_id) }))
    const missing = rows.filter((r) => !r.e?.bank_account || !r.e?.ifsc)
    exportCsv(`bank-transfer-${run.month}`, rows, [
      { header: 'Employee code', value: (r) => r.e?.emp_code ?? '' },
      { header: 'Employee', value: (r) => fullName(r.e) },
      { header: 'Bank', value: (r) => r.e?.bank_name ?? '' },
      { header: 'Account number', value: (r) => r.e?.bank_account ?? '' },
      { header: 'IFSC', value: (r) => r.e?.ifsc ?? '' },
      { header: 'Amount', value: (r) => r.p.net_pay },
      { header: 'Narration', value: () => `Salary ${fmtMonth(run.month, true)}` },
    ])
    audit('export', 'payroll_runs', run.id, `Exported bank transfer file for ${month} · ${rows.length} credits · ${inr(rows.reduce((x, r) => x + r.p.net_pay, 0))}`)
    if (missing.length) toast.warning(`${missing.length} employee${missing.length === 1 ? ' has' : 's have'} no bank account / IFSC on file`, missing.map((r) => fullName(r.e)).join(', '))
    else toast.success('Bank transfer file downloaded', `${rows.length} credits · ${inr(rows.reduce((x, r) => x + r.p.net_pay, 0))}`)
  }
  type RegRow = { code: string; name: string; dept: string; p: Payslip }
  const regRows: RegRow[] = slips.map((p) => {
    const e = L.emp.get(p.employee_id)
    return { code: e?.emp_code ?? '', name: fullName(e), dept: e ? L.deptName(e.department_id) : '', p }
  })
  const sumOf = (f: (p: Payslip) => number) => slips.reduce((x, p) => x + f(p), 0)
  const regTotal: RegRow = {
    code: '', name: 'Total', dept: '',
    p: Object.fromEntries(
      (['days_in_month', 'paid_days', 'lop_days', 'ot_hours', 'basic', 'da', 'hra', 'conveyance', 'special_allowance', 'other_allowance', 'ot_pay', 'bonus', 'arrears', 'gross_earnings', 'pf_employee', 'esi_employee', 'professional_tax', 'tds', 'advance_recovery', 'loan_recovery', 'other_deductions', 'total_deductions', 'net_pay', 'pf_employer_epf', 'pf_employer_eps', 'pf_edli', 'pf_admin', 'esi_employer', 'employer_cost'] as const).map((k) => [k, sumOf((p) => p[k])]),
    ) as unknown as Payslip,
  }
  const m = (header: string, f: (p: Payslip) => number): XCol<RegRow> => ({ header, value: (r) => f(r.p), money: true, align: 'right' })
  const regCsv: XCol<RegRow>[] = [
    { header: 'Code', value: (r) => r.code },
    { header: 'Employee', value: (r) => r.name },
    { header: 'Department', value: (r) => r.dept },
    { header: 'Days in month', value: (r) => (r.name === 'Total' ? '' : r.p.days_in_month) },
    { header: 'Paid days', value: (r) => r.p.paid_days },
    { header: 'LOP days', value: (r) => r.p.lop_days },
    { header: 'OT hours', value: (r) => r.p.ot_hours },
    m('Basic', (p) => p.basic), m('DA', (p) => p.da), m('HRA', (p) => p.hra), m('Conveyance', (p) => p.conveyance), m('Special', (p) => p.special_allowance), m('Other allowance', (p) => p.other_allowance),
    m('OT pay', (p) => p.ot_pay), m('Bonus', (p) => p.bonus), m('Arrears', (p) => p.arrears), m('Gross', (p) => p.gross_earnings),
    m('PF', (p) => p.pf_employee), m('ESI', (p) => p.esi_employee), m('PT', (p) => p.professional_tax), m('TDS', (p) => p.tds),
    m('Advance recovery', (p) => p.advance_recovery), m('Loan recovery', (p) => p.loan_recovery), m('Other deductions', (p) => p.other_deductions),
    m('Total deductions', (p) => p.total_deductions), m('Net pay', (p) => p.net_pay),
    m('Employer PF', (p) => p.pf_employer_epf + p.pf_employer_eps + p.pf_edli + p.pf_admin), m('Employer ESI', (p) => p.esi_employer), m('Employer cost', (p) => p.employer_cost),
  ]
  const regPdf: XCol<RegRow>[] = [
    { header: 'Code', value: (r) => r.code },
    { header: 'Employee', value: (r) => r.name },
    { header: 'Paid days', value: (r) => r.p.paid_days, align: 'right' },
    { header: 'LOP', value: (r) => r.p.lop_days, align: 'right' },
    m('Gross', (p) => p.gross_earnings), m('PF', (p) => p.pf_employee), m('ESI', (p) => p.esi_employee), m('PT', (p) => p.professional_tax), m('TDS', (p) => p.tds),
    m('Recoveries', (p) => recoveries(p) + p.other_deductions), m('Net pay', (p) => p.net_pay), m('Employer cost', (p) => p.employer_cost),
  ]
  const registerPdf = async () => {
    setBusy('register')
    await commit(() =>
      exportTablePdf({
        file: `payroll-register-${run.month}`,
        title: `Payroll register - ${month}`,
        subtitle: `${slips.length} employees · status ${run.status}`,
        rows: regRows,
        cols: regPdf,
        totals: regTotal,
        landscape: true,
        entity: 'payroll_runs',
        summary: [['Gross', rs(t.gross)], ['Deductions', rs(t.ded)], ['Net pay', rs(t.net)], ['Employer cost', rs(t.cost)]],
      }),
    )
    setBusy(null)
  }

  /* ── table ── */
  const columns: Column<Payslip>[] = [
    {
      key: 'emp', header: 'Employee', value: (p) => L.empName(p.employee_id),
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          <EmployeeCell id={p.employee_id} sub="code" />
          {hasAdjustments(p) && <Badge tone="pink" className="shrink-0">adj.</Badge>}
        </span>
      ),
    },
    { key: 'paid', header: 'Paid days', align: 'right', value: (p) => p.paid_days, cell: (p) => `${num(p.paid_days)}/${p.days_in_month}` },
    { key: 'lop', header: 'LOP', align: 'right', value: (p) => p.lop_days, cell: (p) => (p.lop_days ? <span className="font-semibold text-rose-600">{num(p.lop_days)}</span> : <span className="text-ink-faint">0</span>) },
    { key: 'ot', header: 'OT h', align: 'right', value: (p) => p.ot_hours, cell: (p) => (p.ot_hours ? num(p.ot_hours) : <span className="text-ink-faint">—</span>) },
    { key: 'gross', header: 'Gross', align: 'right', value: (p) => p.gross_earnings, cell: (p) => inr(p.gross_earnings) },
    { key: 'pf', header: 'PF', align: 'right', value: (p) => p.pf_employee, cell: (p) => inr(p.pf_employee) },
    { key: 'esi', header: 'ESI', align: 'right', value: (p) => p.esi_employee, cell: (p) => inr(p.esi_employee) },
    { key: 'pt', header: 'PT', align: 'right', value: (p) => p.professional_tax, cell: (p) => inr(p.professional_tax) },
    { key: 'tds', header: 'TDS', align: 'right', value: (p) => p.tds, cell: (p) => inr(p.tds) },
    { key: 'rec', header: 'Recoveries', align: 'right', value: (p) => recoveries(p) + p.other_deductions, cell: (p) => (recoveries(p) + p.other_deductions ? inr(recoveries(p) + p.other_deductions) : <span className="text-ink-faint">—</span>) },
    { key: 'net', header: 'Net pay', align: 'right', value: (p) => p.net_pay, cell: (p) => <span className="font-semibold text-ink">{inr(p.net_pay)}</span> },
  ]
  const footer = (
    <tr className="border-t-2 border-indigo-100 bg-indigo-50/60 text-[13px] font-semibold text-ink">
      <td className="px-3.5 py-2.5">Total · {slips.length}</td>
      <td className="num px-3.5 py-2.5 text-right">{num(t.paid)}</td>
      <td className="num px-3.5 py-2.5 text-right">{num(t.lop)}</td>
      <td className="num px-3.5 py-2.5 text-right">{num(t.ot)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.gross)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.pf)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.esi)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.pt)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.tds)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.rec + t.other)}</td>
      <td className="num px-3.5 py-2.5 text-right">{inr(t.net)}</td>
    </tr>
  )

  const statusActions = canManage && (
    <>
      {run.status === 'draft' && (
        <>
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'recalc'} onClick={doRecalc}>
            Recalculate
          </Button>
          <Button icon={<Lock className="h-4 w-4" />} loading={busy === 'process'} onClick={doProcess} disabled={!slips.length}>
            Process
          </Button>
          <Menu items={[{ label: 'Delete draft run', icon: <Trash2 />, danger: true, onClick: doDelete }]} />
        </>
      )}
      {run.status === 'processed' && (
        <>
          <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} loading={busy === 'unprocess'} onClick={doUnprocess}>
            Back to draft
          </Button>
          <Button variant="success" icon={<BadgeCheck className="h-4 w-4" />} loading={busy === 'approve'} onClick={doApprove}>
            Approve
          </Button>
        </>
      )}
      {run.status === 'approved' && (
        <Button icon={<Banknote className="h-4 w-4" />} onClick={() => setPayOpen(true)}>
          Mark paid
        </Button>
      )}
    </>
  )

  return (
    <div className="space-y-5">
      <div>
        <Link to="/admin/payroll" className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft transition hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Payroll
        </Link>
        <PageHeader
          kicker="Payroll run"
          title={month}
          subtitle={`${slips.length} employees · ${run.status === 'paid' ? `paid ${fmtDateTime(run.paid_at)}` : run.status === 'draft' ? 'draft — editable' : run.status}`}
          actions={statusActions}
        />
      </div>

      <Card>
        <CardBody>
          <RunStepper run={run} userName={(id) => (id ? L.user.get(id)?.display_name ?? 'HR' : '—')} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Employees" value={run.employee_count} icon={<Users className="h-4 w-4" />} accent="indigo" hint={`${num(t.lop)} LOP days in all`} />
        <StatCard label="Gross" value={run.total_gross} format={inrCompact} icon={<Wallet className="h-4 w-4" />} accent="cyan" hint={inr(run.total_gross)} />
        <StatCard label="Deductions" value={run.total_deductions} format={inrCompact} icon={<MinusCircle className="h-4 w-4" />} accent="amber" hint={inr(run.total_deductions)} />
        <StatCard label="Net pay" value={run.total_net} format={inrCompact} icon={<Banknote className="h-4 w-4" />} accent="green" hint={inr(run.total_net)} />
        <StatCard label="Employer cost" value={run.total_employer_cost} format={inrCompact} icon={<Factory className="h-4 w-4" />} accent="pink" hint={inr(run.total_employer_cost)} className="xs:col-span-2 lg:col-span-1" />
      </div>

      <AnimatePresence initial={false}>
        {projected && (
          <Notice key="proj" tone="sky" icon={<Info className="h-4 w-4" />}>
            {month} is still in progress — days after today ({fmtDate(todayISO())}) are counted as paid (projected). Recalculate after month end, once attendance and leave are final, before processing.
          </Notice>
        )}
        {run.status === 'draft' && (missingFromRun.length > 0 || (plan?.skipped.length ?? 0) > 0) && (
          <Notice key="miss" tone="amber" icon={<AlertTriangle className="h-4 w-4" />}>
            {missingFromRun.length > 0 && (
              <span className="block">
                <b>Not in this run yet:</b> {missingFromRun.map((e) => fullName(e)).join(', ')} — recalculate to add {missingFromRun.length === 1 ? 'them' : 'them all'}.
              </span>
            )}
            {(plan?.skipped.length ?? 0) > 0 && (
              <span className="block">
                <b>No salary structure:</b> {plan!.skipped.map((e) => `${fullName(e)} (${e.emp_code})`).join(', ')} — add one under{' '}
                <Link to="/admin/payroll?tab=structures" className="font-semibold underline">
                  Salary structures
                </Link>
                , then recalculate.
              </span>
            )}
          </Notice>
        )}
        {run.status === 'paid' && (
          <Notice key="paid" tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>
            Paid {fmtDateTime(run.paid_at)}
            {run.payment_ref ? ` · ref ${run.payment_ref}` : ''} · payslips are published to employees.
          </Notice>
        )}
      </AnimatePresence>

      <Card>
        <CardHeader
          title="Payslips"
          subtitle={run.status === 'draft' && canManage ? 'Open a payslip to preview it or add bonus, arrears and other deductions' : 'Open a payslip to preview or download it'}
          icon={<FileStack className="h-4 w-4" />}
          actions={
            <>
              <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'pdf'} disabled={!slips.length} onClick={downloadAll}>
                All payslips
              </Button>
              <Button size="sm" variant="secondary" icon={<Landmark className="h-4 w-4" />} disabled={!slips.length} onClick={bankFile}>
                Bank file
              </Button>
              <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!slips.length} onClick={() => exportTableCsv(`payroll-register-${run.month}`, regRows, regCsv, regTotal, 'payroll_runs')}>
                Register CSV
              </Button>
              <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} disabled={!slips.length} loading={busy === 'register'} onClick={() => void registerPdf()}>
                Register PDF
              </Button>
            </>
          }
        />
        <CardBody>
          <DataTable
            rows={slips}
            columns={columns}
            rowKey={(p) => p.id}
            searchText={(p) => `${L.empName(p.employee_id)} ${L.emp.get(p.employee_id)?.emp_code ?? ''}`}
            searchPlaceholder="Search employee…"
            onRowClick={(p) => setViewId(p.id)}
            pageSize={50}
            dense
            footer={slips.length ? footer : undefined}
            empty={<EmptyState title="No payslips in this run" description={run.status === 'draft' && canManage ? 'Recalculate to add everyone on the rolls with a salary structure.' : undefined} />}
            mobileCard={(p) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <EmployeeCell id={p.employee_id} sub="code" />
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num font-display text-[17px] font-bold text-ink">{inr(p.net_pay)}</p>
                    {hasAdjustments(p) && <Badge tone="pink">adj.</Badge>}
                  </div>
                </div>
                <p className="text-[12px] text-ink-soft">
                  Gross {inr(p.gross_earnings)} · deductions {inr(p.total_deductions)} · paid {num(p.paid_days)}/{p.days_in_month} d{p.lop_days ? ` · LOP ${num(p.lop_days)}` : ''}
                  {p.ot_hours ? ` · OT ${num(p.ot_hours)} h` : ''}
                </p>
              </div>
            )}
          />
          {slips.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-indigo-50/60 p-3 text-[12.5px] md:hidden">
              <span className="text-ink-soft">Gross</span>
              <span className="num text-right font-semibold text-ink">{inr(t.gross)}</span>
              <span className="text-ink-soft">Deductions</span>
              <span className="num text-right font-semibold text-ink">{inr(t.ded)}</span>
              <span className="text-ink-soft">Net pay</span>
              <span className="num text-right font-semibold text-ink">{inr(t.net)}</span>
            </div>
          )}
        </CardBody>
      </Card>

      <PayslipModal
        slip={viewing}
        onClose={() => setViewId(null)}
        banner={
          viewing && run.status !== 'paid' ? (
            <p className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2 text-[12.5px] text-amber-800">
              <Info className="h-4 w-4 shrink-0" /> {run.status === 'draft' ? 'Draft — figures change on recalculation.' : `Run ${run.status}.`} Not yet visible to the employee.
            </p>
          ) : null
        }
        actions={
          viewing && run.status === 'draft' && canManage ? (
            <Button
              variant="outline"
              icon={<PencilLine className="h-4 w-4" />}
              onClick={() => {
                setAdjustId(viewing.id)
                setViewId(null)
              }}
            >
              Edit adjustments
            </Button>
          ) : null
        }
      />
      <AdjustModal slip={adjusting} onClose={() => setAdjustId(null)} />
      <PayModal open={payOpen} onClose={() => setPayOpen(false)} runId={run.id} month={month} slips={slips} net={t.net} />
    </div>
  )
}

function Notice({ tone, icon, children }: { tone: 'sky' | 'amber' | 'green'; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = { sky: 'bg-sky-50 text-sky-900', amber: 'bg-amber-50 text-amber-900', green: 'bg-emerald-50 text-emerald-900' }
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className={cn('flex gap-2.5 overflow-hidden rounded-2xl px-4 py-3 text-[13px] leading-relaxed', tones[tone])}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </motion.div>
  )
}

/* ───────────────────────────── adjustments ───────────────────────────── */

function AdjustModal({ slip, onClose }: { slip: Payslip | null; onClose: () => void }) {
  const p = useSticky(slip)
  const L = useLookups()
  const [f, setF] = useState({ bonus: '', arrears: '', other: '', remarks: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!slip) return
    setF({ bonus: String(slip.bonus || ''), arrears: String(slip.arrears || ''), other: String(slip.other_deductions || ''), remarks: slip.remarks })
  }, [slip?.id])

  const vals = { bonus: f.bonus.trim() === '' ? 0 : toNum(f.bonus), arrears: f.arrears.trim() === '' ? 0 : toNum(f.arrears), other_deductions: f.other.trim() === '' ? 0 : toNum(f.other) }
  const err = (v: number) => (!Number.isFinite(v) || v < 0 ? 'Zero or more' : null)
  const errs = { bonus: err(vals.bonus), arrears: err(vals.arrears), other: err(vals.other_deductions) }
  const valid = !errs.bonus && !errs.arrears && !errs.other
  const preview = useMemo<SlipFields | null>(() => {
    if (!p || !valid) return null
    try {
      return previewSlip(p.id, { ...vals, remarks: f.remarks })
    } catch {
      return null
    }
  }, [p?.id, vals.bonus, vals.arrears, vals.other_deductions, valid]) // remarks don't change figures

  const save = async () => {
    if (!p || !valid) return
    setBusy(true)
    const res = await commit(() => recalcSlip(p.id, { ...vals, remarks: f.remarks }), 'Payslip updated', (r) => `${L.empName(r.employee_id)} · net ${inr(r.net_pay)}`)
    setBusy(false)
    if (res.ok) onClose()
  }

  const row = (label: string, from: number, to: number | undefined) => (
    <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
      <span className="text-ink-soft">{label}</span>
      <span className="num text-right">
        {to !== undefined && to !== from ? (
          <>
            <span className="text-ink-faint line-through">{inr(from)}</span> <b className="text-ink">{inr(to)}</b>
          </>
        ) : (
          <span className="text-ink">{inr(from)}</span>
        )}
      </span>
    </div>
  )

  return (
    <Modal
      open={!!slip}
      onClose={onClose}
      title="Payslip adjustments"
      subtitle={p ? `${L.empName(p.employee_id)} · ${fmtMonth(p.month)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!valid}>
            Save & recalculate
          </Button>
        </>
      }
    >
      {p && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Bonus (₹)" error={errs.bonus} hint="Excluded from ESI wages">
              <Input type="number" inputMode="decimal" min={0} value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} placeholder="0" invalid={!!errs.bonus} />
            </Field>
            <Field label="Arrears (₹)" error={errs.arrears}>
              <Input type="number" inputMode="decimal" min={0} value={f.arrears} onChange={(e) => setF({ ...f, arrears: e.target.value })} placeholder="0" invalid={!!errs.arrears} />
            </Field>
            <Field label="Other deductions (₹)" error={errs.other} hint="Canteen, uniform, damages…">
              <Input type="number" inputMode="decimal" min={0} value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} placeholder="0" invalid={!!errs.other} />
            </Field>
          </div>
          <Field label="Remarks" hint="Printed on the payslip">
            <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} maxLength={300} placeholder="e.g. Diwali bonus · arrears for Sep increment" />
          </Field>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Recalculated</p>
            {row('Gross earnings', p.gross_earnings, preview?.gross_earnings)}
            {row('ESI', p.esi_employee, preview?.esi_employee)}
            {row('Professional tax', p.professional_tax, preview?.professional_tax)}
            {row('Total deductions', p.total_deductions, preview?.total_deductions)}
            <div className="mt-1 border-t border-indigo-100 pt-1">{row('Net pay', p.net_pay, preview?.net_pay)}</div>
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ───────────────────────────── pay ───────────────────────────── */

function PayModal({ open, onClose, runId, month, slips, net }: { open: boolean; onClose: () => void; runId: string; month: string; slips: Payslip[]; net: number }) {
  const [ref, setRef] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setRef('')
      setTried(false)
    }
  }, [open])
  const err = ref.trim().length < 3 ? 'Enter the NEFT / bank batch reference' : null
  const emis = slips.filter((p) => recoveries(p) > 0)
  const credits = slips.filter((p) => p.net_pay > 0).length

  const submit = async () => {
    setTried(true)
    if (err) return
    setBusy(true)
    const res = await commit(() => payRun(runId, ref), `${month} payroll paid`, (r) => `${r.published} payslips published${r.recoveries ? ` · ${r.recoveries} EMIs recorded` : ''}${r.closed ? ` · ${r.closed} advance${r.closed === 1 ? '' : 's'} closed` : ''}`)
    setBusy(false)
    if (res.ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mark ${month} payroll paid`}
      subtitle="Do this after the bank has processed the salary transfer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={tried && !!err} icon={<Banknote className="h-4 w-4" />}>
            Mark paid & publish
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl bg-grad p-4 text-white shadow-btn">
          <p className="text-[11.5px] font-semibold uppercase tracking-[.14em] text-white/80">Net salary transferred</p>
          <p className="num font-display text-[28px] font-bold leading-tight">{inr(net)}</p>
          <p className="text-[12.5px] text-white/85">
            {credits} bank credit{credits === 1 ? '' : 's'} · {slips.length} payslips
          </p>
        </div>
        <Field label="Payment reference" required error={tried ? err : null} hint="NEFT / RTGS batch number or bank upload reference">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. NEFT bulk upload 2026-27/10" invalid={tried && !!err} autoFocus />
        </Field>
        <ul className="space-y-1.5 text-[13px] text-ink-soft">
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> All {slips.length} payslips are published — employees are notified and can download them.
          </li>
          <li className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            {emis.length ? `${emis.length} advance/loan EMI${emis.length === 1 ? '' : 's'} (${inr(emis.reduce((x, p) => x + recoveries(p), 0))}) are recorded; fully recovered advances close automatically.` : 'No advance or loan EMIs in this run.'}
          </li>
          <li className="flex gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" /> A paid run cannot be changed.
          </li>
        </ul>
      </div>
    </Modal>
  )
}
