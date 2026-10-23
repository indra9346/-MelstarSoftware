/** Payroll reports: salary register, statutory summary, cost trend, department-wise cost — all from stored payslips. */
import { useMemo, useState } from 'react'
import { Banknote, Building2, CalendarClock, Coins, IndianRupee, Landmark, ReceiptText, Scale, ShieldCheck, Users, Wallet } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { useSettings, useTable } from '@/data/store'
import type { PayrollRunStatus, YearMonth } from '@/data/types'
import { diffDays, fmtDate, fmtMonth, fyRange, todayISO } from '@/lib/dates'
import { inr, inrCompact, num, pct, plural } from '@/lib/format'
import { useLookups } from '@/hooks/useLookups'
import { EmployeeCell } from '@/components/EmployeeCell'
import { Badge, EmptyState, Segmented, StatusBadge } from '@/components/ui'
import { ChartBox, chartGradients, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'
import {
  departmentCost, fyText, payrollTrend, payslipMonths, recentFys, slipRows, statutoryDues, sumSlips,
  type DeptCostRow, type SlipRow, type StatutoryDue, type TrendRow,
} from '@/services/reports'
import {
  ChartCard, ChartEmpty, DeptFilter, Donut, FilterField, FyFilter, MonthFilter, ReportFrame, ReportTable, SeriesKey, totalOf, useDeptName,
  type RCol, type ReportProps,
} from './ReportKit'

const money = (n: number) => inr(n)
const moneyCol = <T,>(key: string, header: string, get: (r: T) => number, opts: Partial<RCol<T>> = {}): RCol<T> => ({
  key, header, align: 'right', total: true, value: get, cell: (r) => money(get(r)), ...opts,
})

function usePayslipMonths() {
  const payslips = useTable('payslips')
  return useMemo(() => payslipMonths(payslips), [payslips])
}

function NoPayroll(p: ReportProps) {
  return (
    <ReportFrame {...p} period="No payroll processed yet" fileTag="none">
      <EmptyState title="No payslips yet" description="Process a payroll run first — this report reads the stored payslips." icon={<Banknote className="h-6 w-6" />} />
    </ReportFrame>
  )
}

const RUN_LABEL: Record<PayrollRunStatus, string> = { draft: 'Draft', processed: 'Processed', approved: 'Approved', paid: 'Paid' }

/* ═════════════════════════ 6. Salary register ═════════════════════════ */

export function SalaryRegisterView(p: ReportProps) {
  const months = usePayslipMonths()
  if (!months.length) return <NoPayroll {...p} />
  return <SalaryRegister {...p} months={months} />
}

function SalaryRegister({ months, ...p }: ReportProps & { months: YearMonth[] }) {
  const payslips = useTable('payslips')
  const runs = useTable('payroll_runs')
  const L = useLookups()
  const deptName = useDeptName()
  const [month, setMonth] = useState(months[0]!)
  const [dept, setDept] = useState('')
  const rows = useMemo(() => slipRows(payslips, L.emp, (s) => s.month === month, dept), [payslips, L.emp, month, dept])
  const t = useMemo(() => sumSlips(rows), [rows])
  const run = runs.find((r) => r.month === month)

  const cols: RCol<SlipRow>[] = [
    { key: 'emp', header: 'Employee', value: (r) => L.empName(r.employee_id), cell: (r) => <EmployeeCell id={r.employee_id} sub="code" size={28} /> },
    { key: 'code', header: 'Code', value: (r) => L.emp.get(r.employee_id)?.emp_code ?? '', hideOnMobile: true },
    { key: 'dept', header: 'Department', value: (r) => L.deptName(r.department_id), hideOnMobile: true, className: 'max-w-[150px] truncate' },
    { key: 'paid_days', header: 'Paid days', align: 'right', value: (r) => r.paid_days, total: true, cell: (r) => num(r.paid_days, 1) },
    moneyCol('basic', 'Basic', (r) => r.basic, { hideOnMobile: true }),
    moneyCol('da', 'DA', (r) => r.da, { hideOnMobile: true }),
    moneyCol('hra', 'HRA', (r) => r.hra, { hideOnMobile: true }),
    moneyCol('conv', 'Conveyance', (r) => r.conveyance, { hideOnMobile: true }),
    moneyCol('special', 'Special', (r) => r.special_allowance, { hideOnMobile: true }),
    moneyCol('other_allow', 'Other allow.', (r) => r.other_allowance, { hideOnMobile: true }),
    moneyCol('ot', 'OT pay', (r) => r.ot_pay, { hideOnMobile: true }),
    moneyCol('extras', 'Bonus / arrears', (r) => r.extras, { hideOnMobile: true }),
    moneyCol('gross', 'Gross', (r) => r.gross_earnings, { cell: (r) => <b>{money(r.gross_earnings)}</b> }),
    moneyCol('pf', 'PF', (r) => r.pf_employee, { hideOnMobile: true }),
    moneyCol('esi', 'ESI', (r) => r.esi_employee, { hideOnMobile: true }),
    moneyCol('pt', 'PT', (r) => r.professional_tax, { hideOnMobile: true }),
    moneyCol('tds', 'TDS', (r) => r.tds, { hideOnMobile: true }),
    moneyCol('rec', 'Adv./loan', (r) => r.recoveries, { hideOnMobile: true }),
    moneyCol('other_ded', 'Other ded.', (r) => r.other_deductions, { hideOnMobile: true }),
    moneyCol('ded', 'Deductions', (r) => r.total_deductions),
    moneyCol('net', 'Net pay', (r) => r.net_pay, { cell: (r) => <b className="text-emerald-700">{money(r.net_pay)}</b> }),
    moneyCol('er', 'Employer PF + ESI', (r) => r.employer_contrib, { hideOnMobile: true }),
    moneyCol('cost', 'Employer cost', (r) => r.employer_cost),
  ]

  const earnings = [
    { label: 'Basic', value: t.basic, color: SERIES[0]! },
    { label: 'DA', value: t.da, color: SERIES[1]! },
    { label: 'HRA', value: t.hra, color: SERIES[2]! },
    { label: 'Conveyance', value: t.conveyance, color: SERIES[3]! },
    { label: 'Special allowance', value: t.special_allowance, color: SERIES[4]! },
    { label: 'Other allowance', value: t.other_allowance, color: SERIES[5]! },
    { label: 'Overtime', value: t.ot_pay, color: SERIES[6]! },
    { label: 'Bonus / arrears', value: t.extras, color: SERIES[7]! },
  ]
  const split = [
    { label: 'Net pay', value: t.net_pay, color: '#3a8f5c' },
    { label: 'PF (employee)', value: t.pf_employee, color: SERIES[0]! },
    { label: 'ESI (employee)', value: t.esi_employee, color: SERIES[1]! },
    { label: 'Professional tax', value: t.professional_tax, color: SERIES[4]! },
    { label: 'TDS', value: t.tds, color: SERIES[2]! },
    { label: 'Advance / loan recovery', value: t.recoveries, color: SERIES[5]! },
    { label: 'Other deductions', value: t.other_deductions, color: '#94a3b8' },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fmtMonth(month)} · ${deptName(dept)}${run ? ` · Run ${RUN_LABEL[run.status].toLowerCase()}` : ''}`}
      fileTag={month}
      filters={
        <>
          <MonthFilter value={month} onChange={setMonth} months={months} label="Payroll month" />
          <DeptFilter value={dept} onChange={setDept} />
          {run && (
            <div className="pb-2">
              <StatusBadge status={run.status} label={`Run ${RUN_LABEL[run.status].toLowerCase()}`} />
            </div>
          )}
        </>
      }
      kpis={[
        { label: 'Employees paid', value: rows.length, icon: <Users className="h-4 w-4" />, accent: 'indigo', hint: deptName(dept) },
        { label: 'Gross earnings', value: t.gross_earnings, format: inrCompact, text: inr(t.gross_earnings), icon: <IndianRupee className="h-4 w-4" />, accent: 'cyan', hint: inr(t.gross_earnings) },
        { label: 'Deductions', value: t.total_deductions, format: inrCompact, text: inr(t.total_deductions), icon: <Scale className="h-4 w-4" />, accent: 'pink', hint: inr(t.total_deductions) },
        { label: 'Net pay', value: t.net_pay, format: inrCompact, text: inr(t.net_pay), icon: <Wallet className="h-4 w-4" />, accent: 'green', hint: inr(t.net_pay) },
        { label: 'Employer cost', value: t.employer_cost, format: inrCompact, text: inr(t.employer_cost), icon: <Building2 className="h-4 w-4" />, accent: 'amber', hint: inr(t.employer_cost) },
      ]}
      notes={<p>Figures are read from the stored payslips of the {fmtMonth(month)} run. Employer cost = gross earnings + employer PF (EPF, EPS, EDLI, admin) + employer ESI.</p>}
    >
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard title="Earnings mix" subtitle="Components of gross earnings">
          <Donut data={earnings} format={money} center={<div><p className="text-base font-semibold text-ink">{inrCompact(t.gross_earnings)}</p><p className="text-[10.5px] text-ink-soft">gross</p></div>} />
        </ChartCard>
        <ChartCard title="Where the gross goes" subtitle="Net pay and each deduction">
          <Donut data={split} format={money} center={<div><p className="text-base font-semibold text-ink">{pct(t.gross_earnings ? (t.net_pay / t.gross_earnings) * 100 : 0)}</p><p className="text-[10.5px] text-ink-soft">take-home</p></div>} />
        </ChartCard>
      </div>
      <ReportTable
        title="Salary register"
        exportLabel={fmtMonth(month)}
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={rows.length ? t : undefined}
        initialSort={{ key: 'code', dir: 'asc' }}
        searchText={(r) => `${L.empName(r.employee_id)} ${L.emp.get(r.employee_id)?.emp_code ?? ''} ${L.deptName(r.department_id)}`}
        empty={<ChartEmpty text="No payslips for this month and department." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 7. Statutory summary ═════════════════════════ */

export function StatutoryView(p: ReportProps) {
  const months = usePayslipMonths()
  if (!months.length) return <NoPayroll {...p} />
  return <Statutory {...p} months={months} />
}

function Statutory({ months, ...p }: ReportProps & { months: YearMonth[] }) {
  const payslips = useTable('payslips')
  const L = useLookups()
  const today = todayISO()
  const [month, setMonth] = useState(months[0]!)
  const rows = useMemo(() => slipRows(payslips, L.emp, (s) => s.month === month), [payslips, L.emp, month])
  const t = useMemo(() => sumSlips(rows), [rows])
  const dues = useMemo(() => statutoryDues(month, t), [month, t])
  const pfMembers = rows.filter((r) => r.pf_employee > 0).length
  const esiMembers = rows.filter((r) => r.esi_wages > 0).length
  const ptPayers = rows.filter((r) => r.professional_tax > 0).length
  const tdsPayers = rows.filter((r) => r.tds > 0).length

  const dueCols: RCol<StatutoryDue & { id: string }>[] = [
    { key: 'head', header: 'Head', value: (d) => d.head, cell: (d) => <span className="font-semibold">{d.head}</span> },
    { key: 'detail', header: 'Covers', value: (d) => d.detail, hideOnMobile: true },
    moneyCol('amount', 'Amount', (d) => d.amount),
    { key: 'due', header: 'Due by', value: (d) => d.due, cell: (d) => fmtDate(d.due) },
    {
      key: 'when', header: 'Timing', export: false, sortable: false,
      cell: (d) => {
        const n = diffDays(today, d.due)
        return n < 0 ? <Badge tone="slate">Due date passed</Badge> : n <= 5 ? <Badge tone="amber">{n === 0 ? 'Due today' : `${n} day${n === 1 ? '' : 's'} left`}</Badge> : <Badge tone="green">{n} days left</Badge>
      },
    },
  ]
  const dueRows = dues.map((d) => ({ ...d, id: d.head }))
  const dueTotal = { id: 'total', head: 'Total', detail: '', due: '', amount: dues.reduce((s, d) => s + d.amount, 0) }

  const cols: RCol<SlipRow>[] = [
    { key: 'emp', header: 'Employee', value: (r) => L.empName(r.employee_id), cell: (r) => <EmployeeCell id={r.employee_id} sub="code" size={28} /> },
    { key: 'code', header: 'Code', value: (r) => L.emp.get(r.employee_id)?.emp_code ?? '', hideOnMobile: true },
    { key: 'uan', header: 'UAN', value: (r) => L.emp.get(r.employee_id)?.uan || '—', hideOnMobile: true },
    { key: 'esic', header: 'ESIC no.', value: (r) => L.emp.get(r.employee_id)?.esic_no || '—', hideOnMobile: true },
    moneyCol('pf_wages', 'PF wages', (r) => r.pf_wages, { hideOnMobile: true }),
    moneyCol('pf_ee', 'PF (EE)', (r) => r.pf_employee),
    moneyCol('epf_er', 'EPF (ER)', (r) => r.pf_employer_epf, { hideOnMobile: true }),
    moneyCol('eps_er', 'EPS (ER)', (r) => r.pf_employer_eps, { hideOnMobile: true }),
    moneyCol('edli', 'EDLI + admin', (r) => r.pf_edli + r.pf_admin, { hideOnMobile: true }),
    moneyCol('esi_wages', 'ESI wages', (r) => r.esi_wages, { hideOnMobile: true }),
    moneyCol('esi_ee', 'ESI (EE)', (r) => r.esi_employee),
    moneyCol('esi_er', 'ESI (ER)', (r) => r.esi_employer),
    moneyCol('pt', 'PT', (r) => r.professional_tax),
    moneyCol('tds', 'TDS', (r) => r.tds),
  ]
  const chart = [
    { name: 'PF', ee: t.pf_employee, er: t.pf_employer },
    { name: 'ESI', ee: t.esi_employee, er: t.esi_employer },
    { name: 'PT', ee: t.professional_tax, er: 0 },
    { name: 'TDS', ee: t.tds, er: 0 },
  ]

  return (
    <ReportFrame
      {...p}
      period={`Wage month ${fmtMonth(month)}`}
      fileTag={month}
      filters={<MonthFilter value={month} onChange={setMonth} months={months} label="Wage month" />}
      kpis={[
        { label: 'PF — employee', value: t.pf_employee, format: inr, icon: <Landmark className="h-4 w-4" />, accent: 'indigo', hint: `${plural(pfMembers, 'member')}` },
        { label: 'PF — employer', value: t.pf_employer, format: inr, icon: <Landmark className="h-4 w-4" />, accent: 'cyan', hint: `EPF ${inr(t.pf_employer_epf)} · EPS ${inr(t.pf_employer_eps)} · EDLI+admin ${inr(t.pf_edli + t.pf_admin)}` },
        { label: 'ESI (EE + ER)', value: t.esi_employee + t.esi_employer, format: inr, icon: <ShieldCheck className="h-4 w-4" />, accent: 'green', hint: `EE ${inr(t.esi_employee)} · ER ${inr(t.esi_employer)} · ${plural(esiMembers, 'member')}` },
        { label: 'Professional tax', value: t.professional_tax, format: inr, icon: <ReceiptText className="h-4 w-4" />, accent: 'amber', hint: `${plural(ptPayers, 'employee')}` },
        { label: 'TDS', value: t.tds, format: inr, icon: <Coins className="h-4 w-4" />, accent: 'pink', hint: `${plural(tdsPayers, 'employee')}` },
      ]}
      notes={
        <>
          <p>EE = employee share (deducted from salary), ER = employer share. Due dates: EPF & ESI by the 15th, Karnataka PT by the 20th and TDS by the 7th of the following month (TDS for March by 30 April).</p>
          <p>Timing shows the statutory calendar only — record the actual challans in your books.</p>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <ChartCard title="Contributions by head" subtitle="Employee vs employer share">
          <SeriesKey items={[{ label: 'Employee', color: SERIES[0]! }, { label: 'Employer', color: SERIES[1]! }]} />
          <ChartBox height={220}>
            <BarChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v: number) => inrCompact(v)} width={56} />
              <Tooltip {...tooltipProps} formatter={(v) => money(Number(v))} />
              <Bar dataKey="ee" name="Employee" stackId="a" fill={SERIES[0]} maxBarSize={44} />
              <Bar dataKey="er" name="Employer" stackId="a" fill={SERIES[1]} radius={[2, 2, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ChartBox>
        </ChartCard>
        <ReportTable title="Remittance summary" subtitle={<span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Amounts payable for {fmtMonth(month)}</span>} rows={dueRows} columns={dueCols} rowKey={(d) => d.id} totalsRow={dueTotal} />
      </div>
      <ReportTable
        title="Employee-wise contributions"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={rows.length ? t : undefined}
        initialSort={{ key: 'code', dir: 'asc' }}
        searchText={(r) => `${L.empName(r.employee_id)} ${L.emp.get(r.employee_id)?.emp_code ?? ''} ${L.emp.get(r.employee_id)?.uan ?? ''}`}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 8. Payroll cost trend ═════════════════════════ */

const TREND_BASE: TrendRow = { id: 'total', month: '', label: 'Total', status: null, employees: 0, gross: 0, deductions: 0, net: 0, employer_pf: 0, employer_esi: 0, employer_cost: 0, ot_pay: 0 }

export function PayrollTrendView(p: ReportProps) {
  const payslips = useTable('payslips')
  const runs = useTable('payroll_runs')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [fy, setFy] = useState(years[0]!)
  const rows = useMemo(() => payrollTrend(payslips, runs, fy, fyStart), [payslips, runs, fy, fyStart])
  const t = useMemo(() => totalOf(rows, { ...TREND_BASE }, ['gross', 'deductions', 'net', 'employer_pf', 'employer_esi', 'employer_cost', 'ot_pay']), [rows])
  const avgCost = rows.length ? t.employer_cost / rows.length : 0
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  const change = last && prev && prev.employer_cost ? ((last.employer_cost - prev.employer_cost) / prev.employer_cost) * 100 : null

  const cols: RCol<TrendRow>[] = [
    { key: 'month', header: 'Month', value: (r) => r.month, exportValue: (r) => fmtMonth(r.month), cell: (r) => <span className="font-semibold">{fmtMonth(r.month)}</span> },
    { key: 'status', header: 'Run', value: (r) => r.status ?? '—', cell: (r) => (r.status ? <StatusBadge status={r.status} /> : '—'), hideOnMobile: true },
    { key: 'employees', header: 'Employees', align: 'right', value: (r) => r.employees },
    moneyCol('gross', 'Gross', (r) => r.gross),
    moneyCol('ded', 'Deductions', (r) => r.deductions, { hideOnMobile: true }),
    moneyCol('net', 'Net pay', (r) => r.net),
    moneyCol('pf', 'Employer PF', (r) => r.employer_pf, { hideOnMobile: true }),
    moneyCol('esi', 'Employer ESI', (r) => r.employer_esi, { hideOnMobile: true }),
    moneyCol('ot', 'OT pay', (r) => r.ot_pay, { hideOnMobile: true }),
    moneyCol('cost', 'Employer cost', (r) => r.employer_cost, { cell: (r) => <b>{money(r.employer_cost)}</b> }),
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fyText(fy)} · ${plural(rows.length, 'month')} processed`}
      fileTag={`FY${fy}`}
      filters={<FyFilter value={fy} onChange={setFy} years={years} />}
      kpis={[
        { label: 'Gross (YTD)', value: t.gross, format: inrCompact, text: inr(t.gross), icon: <IndianRupee className="h-4 w-4" />, accent: 'indigo', hint: inr(t.gross) },
        { label: 'Net pay (YTD)', value: t.net, format: inrCompact, text: inr(t.net), icon: <Wallet className="h-4 w-4" />, accent: 'green', hint: inr(t.net) },
        { label: 'Employer cost (YTD)', value: t.employer_cost, format: inrCompact, text: inr(t.employer_cost), icon: <Building2 className="h-4 w-4" />, accent: 'pink', hint: inr(t.employer_cost) },
        {
          label: 'Avg monthly cost', value: avgCost, format: inrCompact, text: inr(avgCost), icon: <Coins className="h-4 w-4" />, accent: 'amber',
          hint: change == null ? 'Per processed month' : `${change >= 0 ? '▲' : '▼'} ${pct(Math.abs(change), 1)} last month vs previous`,
        },
      ]}
      notes={<p>One point per processed payroll month of {fyText(fy)}, summed from payslips. Employer cost includes employer PF (EPF, EPS, EDLI, admin) and ESI.</p>}
    >
      <ChartCard title="Month-wise payroll cost" subtitle="Gross earnings, net pay and employer cost">
        {rows.length ? (
          <>
            <SeriesKey items={[{ label: 'Employer cost', color: '#a0627f' }, { label: 'Gross', color: SERIES[0]! }, { label: 'Net pay', color: SERIES[1]! }]} />
            <ChartBox height={260}>
              <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {chartGradients()}
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} tickFormatter={(v: string) => v.slice(0, 3)} />
                <YAxis {...axisProps} tickFormatter={(v: number) => inrCompact(v)} width={58} />
                <Tooltip {...tooltipProps} formatter={(v) => money(Number(v))} />
                <Area type="monotone" dataKey="employer_cost" name="Employer cost" stroke="#a0627f" strokeWidth={2} fill="url(#gPink)" />
                <Area type="monotone" dataKey="gross" name="Gross" stroke={SERIES[0]} strokeWidth={2} fill="url(#gIndigo)" />
                <Area type="monotone" dataKey="net" name="Net pay" stroke={SERIES[1]} strokeWidth={2} fill="url(#gCyan)" />
              </AreaChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text={`No payroll processed in ${fyText(fy)}.`} />
        )}
      </ChartCard>
      <ReportTable title="Monthly payroll" rows={rows} columns={cols} rowKey={(r) => r.id} totalsRow={rows.length ? t : undefined} empty={<ChartEmpty text={`No payroll processed in ${fyText(fy)}.`} />} />
    </ReportFrame>
  )
}

/* ═════════════════════════ 9. Department-wise cost ═════════════════════════ */

const DEPT_BASE: DeptCostRow = { id: 'total', name: 'Total', color: '', employees: 0, slips: 0, gross: 0, employer_contrib: 0, employer_cost: 0, net: 0, ot_pay: 0, share: 100, per_head: 0 }

export function DeptCostView(p: ReportProps) {
  const months = usePayslipMonths()
  if (!months.length) return <NoPayroll {...p} />
  return <DeptCost {...p} months={months} />
}

function DeptCost({ months, ...p }: ReportProps & { months: YearMonth[] }) {
  const payslips = useTable('payslips')
  const departments = useTable('departments')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const L = useLookups()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [scope, setScope] = useState<'month' | 'fy'>('month')
  const [month, setMonth] = useState(months[0]!)
  const [fy, setFy] = useState(years[0]!)
  const { from, to } = fyRange(fy, fyStart)
  const slips = useMemo(
    () => slipRows(payslips, L.emp, scope === 'month' ? (s) => s.month === month : (s) => `${s.month}-01` >= from && `${s.month}-01` <= to),
    [payslips, L.emp, scope, month, from, to],
  )
  const rows = useMemo(() => departmentCost(slips, departments), [slips, departments])
  const t = useMemo(() => {
    const x = totalOf(rows, { ...DEPT_BASE }, ['employees', 'slips', 'gross', 'employer_contrib', 'employer_cost', 'net', 'ot_pay'])
    return { ...x, share: rows.length ? 100 : 0, per_head: x.slips ? Math.round(x.employer_cost / x.slips) : 0 }
  }, [rows])
  const top = rows[0]
  const period = scope === 'month' ? fmtMonth(month) : fyText(fy)

  const cols: RCol<DeptCostRow>[] = [
    { key: 'name', header: 'Department', value: (d) => d.name, cell: (d) => <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} /><span className="truncate font-semibold">{d.name}</span></span> },
    { key: 'employees', header: 'Employees', align: 'right', value: (d) => d.employees, total: true },
    ...(scope === 'fy' ? [{ key: 'slips', header: 'Payslips', align: 'right' as const, value: (d: DeptCostRow) => d.slips, total: true, hideOnMobile: true }] : []),
    moneyCol('gross', 'Gross', (d) => d.gross),
    moneyCol('er', 'Employer PF + ESI', (d) => d.employer_contrib, { hideOnMobile: true }),
    moneyCol('cost', 'Employer cost', (d) => d.employer_cost, { cell: (d) => <b>{money(d.employer_cost)}</b> }),
    moneyCol('net', 'Net pay', (d) => d.net, { hideOnMobile: true }),
    moneyCol('ot', 'OT pay', (d) => d.ot_pay, { hideOnMobile: true }),
    { key: 'share', header: 'Share', align: 'right', value: (d) => Math.round(d.share * 10) / 10, total: true, cell: (d) => pct(d.share, 1) },
    moneyCol('per_head', 'Cost / employee-month', (d) => d.per_head, { total: true }),
  ]

  return (
    <ReportFrame
      {...p}
      period={period}
      fileTag={scope === 'month' ? month : `FY${fy}`}
      filters={
        <>
          <div className="w-full xs:w-auto">
            <span className="label">Scope</span>
            <Segmented value={scope} onChange={setScope} options={[{ value: 'month', label: 'Month' }, { value: 'fy', label: 'Financial year' }]} />
          </div>
          {scope === 'month' ? <MonthFilter value={month} onChange={setMonth} months={months} label="Payroll month" /> : <FyFilter value={fy} onChange={setFy} years={years} />}
          {scope === 'fy' && <FilterField label="Months included"><p className="flex h-10 items-center text-sm font-medium text-ink">{plural(new Set(slips.map((s) => s.month)).size, 'month')}</p></FilterField>}
        </>
      }
      kpis={[
        { label: 'Employer cost', value: t.employer_cost, format: inrCompact, text: inr(t.employer_cost), icon: <Building2 className="h-4 w-4" />, accent: 'indigo', hint: inr(t.employer_cost) },
        { label: 'Departments', value: rows.length, icon: <Users className="h-4 w-4" />, accent: 'cyan', hint: `${plural(t.employees, 'employee')}` },
        { label: 'Largest department', value: top?.employer_cost ?? 0, format: inrCompact, text: top ? `${top.name} ${inr(top.employer_cost)}` : '—', icon: <Banknote className="h-4 w-4" />, accent: 'pink', hint: top ? `${top.name} · ${pct(top.share, 1)}` : '—' },
        { label: 'Cost per employee-month', value: t.per_head, format: inr, icon: <Coins className="h-4 w-4" />, accent: 'amber', hint: 'Employer cost ÷ payslips' },
      ]}
      notes={<p>Payslips are grouped by each employee’s current department. Employer cost = gross + employer PF and ESI.</p>}
    >
      <ChartCard title="Employer cost by department" subtitle={period}>
        {rows.length ? (
          <ChartBox height={Math.max(180, rows.length * 32 + 24)}>
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} tickFormatter={(v: number) => inrCompact(v)} />
              <YAxis type="category" dataKey="name" {...axisProps} width={128} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
              <Tooltip {...tooltipProps} formatter={(v) => money(Number(v))} />
              <Bar dataKey="employer_cost" name="Employer cost" radius={[0, 2, 2, 0]} maxBarSize={20}>
                {rows.map((d) => (
                  <Cell key={d.id} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        ) : (
          <ChartEmpty />
        )}
      </ChartCard>
      <ReportTable title="Department-wise cost" rows={rows} columns={cols} rowKey={(d) => d.id} totalsRow={rows.length ? t : undefined} empty={<ChartEmpty text="No payslips in this period." />} />
    </ReportFrame>
  )
}
