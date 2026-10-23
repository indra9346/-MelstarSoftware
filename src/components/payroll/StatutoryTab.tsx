import { useMemo, useState, type ReactNode } from 'react'
import { Download, FileText, Info, Landmark, ShieldCheck, Stethoscope, Receipt } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { PayrollRun, Payslip } from '@/data/types'
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Segmented, Select, type Column } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { fmtMonth } from '@/lib/dates'
import { fullName, inr, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { commit, exportTableCsv, exportTablePdf, rs, type XCol } from './utils'

type Section = 'pf' | 'esi' | 'pt' | 'tds'

interface SCol<T> extends XCol<T> {
  key: string
  /** Optional rich cell for screen. */
  cell?: (r: T) => ReactNode
  hideOnMobile?: boolean
}

interface Base {
  id: string
  code: string
  name: string
}

export function StatutoryTab() {
  const runs = useTable('payroll_runs')
  const slips = useTable('payslips')
  const settings = useSettings()
  const L = useLookups()
  const cfg = settings.payroll
  const eligible = useMemo(() => runs.filter((r) => r.status === 'approved' || r.status === 'paid').sort((a, b) => b.month.localeCompare(a.month)), [runs])
  const [runId, setRunId] = useState('')
  const [section, setSection] = useState<Section>('pf')
  const [onlyTds, setOnlyTds] = useState(true)
  const run: PayrollRun | undefined = eligible.find((r) => r.id === runId) ?? eligible[0]

  const list = useMemo(
    () =>
      run
        ? slips
            .filter((p) => p.run_id === run.id)
            .map((p) => ({ p, e: L.emp.get(p.employee_id) }))
            .sort((a, b) => (a.e?.emp_code ?? '').localeCompare(b.e?.emp_code ?? '', 'en-IN', { numeric: true }))
        : [],
    [slips, run, L.emp],
  )

  if (!run) {
    return (
      <EmptyState
        icon={<Landmark className="h-6 w-6" />}
        title="No approved payroll yet"
        description="PF, ESI, professional tax and TDS registers are built from approved or paid payroll runs."
      />
    )
  }

  const month = fmtMonth(run.month)
  const base = (p: Payslip): Base => {
    const e = L.emp.get(p.employee_id)
    return { id: p.id, code: e?.emp_code ?? '', name: e ? fullName(e) : '—' }
  }
  const ceiling = cfg.pf_wage_ceiling

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full xs:w-56">
          <Select aria-label="Payroll month" value={run.id} onChange={(e) => setRunId(e.target.value)} options={eligible.map((r) => ({ value: r.id, label: `${fmtMonth(r.month)} · ${r.status}` }))} />
        </div>
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'pf', label: 'PF (ECR)' },
            { value: 'esi', label: 'ESI' },
            { value: 'pt', label: 'Professional tax' },
            { value: 'tds', label: 'TDS' },
          ]}
        />
      </div>

      <div key={`${run.id}-${section}`}>
        {section === 'pf' &&
          (() => {
            type R = Base & { uan: string; gross: number; epf: number; eps_w: number; edli_w: number; ee: number; eps: number; er: number; ncp: number; edli: number; admin: number }
            const rows: R[] = list
              .filter(({ p }) => p.pf_employee > 0 || p.pf_employer_eps > 0)
              .map(({ p, e }) => ({
                ...base(p),
                uan: e?.uan || '',
                gross: p.gross_earnings,
                epf: cfg.pf_restrict_to_ceiling ? Math.min(p.pf_wages, ceiling) : p.pf_wages,
                eps_w: Math.min(p.pf_wages, ceiling),
                edli_w: Math.min(p.pf_wages, ceiling),
                ee: p.pf_employee,
                eps: p.pf_employer_eps,
                er: p.pf_employer_epf,
                ncp: p.lop_days,
                edli: p.pf_edli,
                admin: p.pf_admin,
              }))
            const t = totalsOf(rows, ['gross', 'epf', 'eps_w', 'edli_w', 'ee', 'eps', 'er', 'ncp', 'edli', 'admin'], { id: 'total', code: '', name: 'Total', uan: '' })
            const cols: SCol<R>[] = [
              { key: 'uan', header: 'UAN', value: (r) => r.uan, cell: (r) => r.uan || <span className="text-amber-600">missing</span> },
              { key: 'name', header: 'Member name', value: (r) => r.name, cell: (r) => <Name r={r} /> },
              { key: 'gross', header: 'Gross wages', value: (r) => r.gross, money: true, align: 'right', hideOnMobile: true },
              { key: 'epf', header: 'EPF wages', value: (r) => r.epf, money: true, align: 'right' },
              { key: 'eps_w', header: 'EPS wages', value: (r) => r.eps_w, money: true, align: 'right', hideOnMobile: true },
              { key: 'edli_w', header: 'EDLI wages', value: (r) => r.edli_w, money: true, align: 'right', hideOnMobile: true },
              { key: 'ee', header: `EE share ${cfg.pf_employee_rate}%`, value: (r) => r.ee, money: true, align: 'right' },
              { key: 'eps', header: `EPS ${cfg.pf_employer_eps_rate}%`, value: (r) => r.eps, money: true, align: 'right' },
              { key: 'er', header: `ER EPF ${cfg.pf_employer_epf_rate}%`, value: (r) => r.er, money: true, align: 'right' },
              { key: 'ncp', header: 'NCP days', value: (r) => r.ncp, align: 'right' },
            ]
            const remit = t.ee + t.eps + t.er + t.edli + t.admin
            return (
              <StatTable
                icon={<ShieldCheck className="h-4 w-4" />}
                title={`PF ECR · ${month}`}
                subtitle={`Establishment ${settings.pf_establishment_code || '— (set in Settings)'} · wage ceiling ${inr(ceiling)}${cfg.pf_restrict_to_ceiling ? ' (EE share capped)' : ''}`}
                file={`PF-ECR-${run.month}`}
                rows={rows}
                totals={t}
                cols={cols}
                summary={[
                  ['Members', String(rows.length)],
                  ['EE share', rs(t.ee)],
                  ['ER share (EPS + EPF)', rs(t.eps + t.er)],
                  ['EDLI', rs(t.edli)],
                  ['Admin charges', rs(t.admin)],
                  ['Total remittance', rs(remit)],
                ]}
                chips={[
                  ['Members', num(rows.length)],
                  ['EE share', inr(t.ee)],
                  ['ER share', inr(t.eps + t.er)],
                  ['EDLI + admin', inr(t.edli + t.admin)],
                  ['Total remittance', inr(remit)],
                ]}
                empty="Nobody had PF deducted this month."
              />
            )
          })()}

        {section === 'esi' &&
          (() => {
            type R = Base & { esic: string; days: number; wages: number; ee: number; er: number }
            const rows: R[] = list
              .filter(({ p }) => p.esi_wages > 0)
              .map(({ p, e }) => ({ ...base(p), esic: e?.esic_no || '', days: p.paid_days, wages: p.esi_wages, ee: p.esi_employee, er: p.esi_employer }))
            const t = totalsOf(rows, ['days', 'wages', 'ee', 'er'], { id: 'total', code: '', name: 'Total', esic: '' })
            const cols: SCol<R>[] = [
              { key: 'esic', header: 'ESIC no.', value: (r) => r.esic, cell: (r) => r.esic || <span className="text-amber-600">missing</span> },
              { key: 'name', header: 'Name', value: (r) => r.name, cell: (r) => <Name r={r} /> },
              { key: 'days', header: 'Days paid', value: (r) => r.days, align: 'right' },
              { key: 'wages', header: 'ESI wages', value: (r) => r.wages, money: true, align: 'right' },
              { key: 'ee', header: `EE ${cfg.esi_employee_rate}%`, value: (r) => r.ee, money: true, align: 'right' },
              { key: 'er', header: `ER ${cfg.esi_employer_rate}%`, value: (r) => r.er, money: true, align: 'right' },
            ]
            return (
              <StatTable
                icon={<Stethoscope className="h-4 w-4" />}
                title={`ESI contributions · ${month}`}
                subtitle={`Employer code ${settings.esi_employer_code || '— (set in Settings)'} · covered when fixed gross ≤ ${inr(cfg.esi_wage_threshold)}`}
                file={`ESI-${run.month}`}
                rows={rows}
                totals={t}
                cols={cols}
                summary={[
                  ['Insured persons', String(rows.length)],
                  ['ESI wages', rs(t.wages)],
                  ['EE share', rs(t.ee)],
                  ['ER share', rs(t.er)],
                  ['Total contribution', rs(t.ee + t.er)],
                ]}
                chips={[
                  ['Insured persons', num(rows.length)],
                  ['ESI wages', inr(t.wages)],
                  ['EE share', inr(t.ee)],
                  ['ER share', inr(t.er)],
                  ['Total', inr(t.ee + t.er)],
                ]}
                empty="Nobody was covered by ESI this month."
              />
            )
          })()}

        {section === 'pt' &&
          (() => {
            type R = Base & { gross: number; pt: number }
            const rows: R[] = list.filter(({ p }) => p.gross_earnings > 0).map(({ p }) => ({ ...base(p), gross: p.gross_earnings, pt: p.professional_tax }))
            const t = totalsOf(rows, ['gross', 'pt'], { id: 'total', code: '', name: 'Total' })
            const cols: SCol<R>[] = [
              { key: 'code', header: 'Code', value: (r) => r.code, hideOnMobile: true },
              { key: 'name', header: 'Employee', value: (r) => r.name, cell: (r) => <Name r={r} /> },
              { key: 'gross', header: 'Gross', value: (r) => r.gross, money: true, align: 'right' },
              { key: 'pt', header: 'PT', value: (r) => r.pt, money: true, align: 'right', cell: (r) => (r.pt ? inr(r.pt) : <span className="text-ink-faint">nil</span>) },
            ]
            const slabs = cfg.pt_slabs
              .map((s) => `${inr(s.min)}${s.max != null ? `–${inr(s.max)}` : ' and above'}: ${s.amount ? `${inr(s.amount)}/month` : 'nil'}${s.feb_amount != null ? ` (${inr(s.feb_amount)} in February)` : ''}`)
              .join(' · ')
            return (
              <StatTable
                icon={<Receipt className="h-4 w-4" />}
                title={`Professional tax · ${month}`}
                subtitle={`${cfg.pt_state} · registration ${settings.pt_registration_no || '— (set in Settings)'}`}
                note={
                  <>
                    <b>{cfg.pt_state} slabs on monthly gross:</b> {slabs}.{run.month.endsWith('-02') && <b className="ml-1">February: the higher amount (₹300) applies this month.</b>}
                  </>
                }
                file={`Professional-Tax-${run.month}`}
                rows={rows}
                totals={t}
                cols={cols}
                summary={[
                  ['Employees', String(rows.length)],
                  ['Liable', String(rows.filter((r) => r.pt > 0).length)],
                  ['PT payable', rs(t.pt)],
                ]}
                chips={[
                  ['Employees', num(rows.length)],
                  ['Liable', num(rows.filter((r) => r.pt > 0).length)],
                  ['PT payable', inr(t.pt)],
                ]}
                empty="No payslips in this run."
              />
            )
          })()}

        {section === 'tds' &&
          (() => {
            type R = Base & { pan: string; regime: string; gross: number; tds: number }
            const all: R[] = list.map(({ p, e }) => ({ ...base(p), pan: e?.pan || '', regime: p.tax_regime === 'old' ? 'Old' : 'New', gross: p.gross_earnings, tds: p.tds }))
            const rows = (onlyTds ? all.filter((r) => r.tds > 0) : all).sort((a, b) => b.tds - a.tds)
            const t = totalsOf(rows, ['gross', 'tds'], { id: 'total', code: '', name: 'Total', pan: '', regime: '' })
            const cols: SCol<R>[] = [
              { key: 'name', header: 'Employee', value: (r) => r.name, cell: (r) => <Name r={r} /> },
              { key: 'pan', header: 'PAN', value: (r) => r.pan, cell: (r) => r.pan || <span className="text-amber-600">missing</span> },
              { key: 'regime', header: 'Regime', value: (r) => r.regime, cell: (r) => <Badge tone={r.regime === 'Old' ? 'violet' : 'cyan'}>{r.regime}</Badge> },
              { key: 'gross', header: 'Gross', value: (r) => r.gross, money: true, align: 'right' },
              { key: 'tds', header: 'TDS', value: (r) => r.tds, money: true, align: 'right' },
            ]
            return (
              <StatTable
                icon={<Landmark className="h-4 w-4" />}
                title={`TDS on salary · ${month}`}
                subtitle={`TAN ${settings.tan || '— (set in Settings)'} · section 192 · projected annual tax ÷ 12`}
                file={`TDS-${run.month}`}
                rows={rows}
                totals={t}
                cols={cols}
                toolbar={<Checkbox checked={onlyTds} onChange={setOnlyTds} label="Only employees with TDS" />}
                summary={[
                  ['Employees with TDS', String(all.filter((r) => r.tds > 0).length)],
                  ['TDS deducted', rs(all.reduce((s, r) => s + r.tds, 0))],
                ]}
                chips={[
                  ['With TDS', `${all.filter((r) => r.tds > 0).length} of ${all.length}`],
                  ['TDS deducted', inr(all.reduce((s, r) => s + r.tds, 0))],
                ]}
                empty={onlyTds ? 'No TDS was deducted this month (income within the rebate limit).' : 'No payslips in this run.'}
              />
            )
          })()}
      </div>
    </div>
  )
}

function Name({ r }: { r: Base }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-semibold text-ink">{r.name}</span>
      <span className="block text-[12px] text-ink-soft">{r.code}</span>
    </span>
  )
}

function totalsOf<T extends Base>(rows: T[], keys: (keyof T)[], seed: Partial<T>): T {
  const t = { ...seed } as Record<string, unknown>
  for (const k of keys) t[k as string] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  return t as T
}

function StatTable<T extends Base>(props: {
  icon: ReactNode
  title: string
  subtitle: string
  note?: ReactNode
  file: string
  rows: T[]
  totals: T
  cols: SCol<T>[]
  summary: [string, string][]
  chips: [string, string][]
  toolbar?: ReactNode
  empty: string
}) {
  const { rows, totals, cols } = props
  const [busy, setBusy] = useState(false)
  const columns: Column<T>[] = cols.map((c) => ({
    key: c.key,
    header: c.header,
    value: c.value,
    align: c.align,
    hideOnMobile: c.hideOnMobile,
    cell: c.cell ?? (c.money ? (r: T) => inr(Number(c.value(r))) : undefined),
  }))
  const pdf = async () => {
    setBusy(true)
    await commit(() => exportTablePdf({ file: props.file, title: props.title.replace(' · ', ' - '), subtitle: props.subtitle.replace(/₹/g, 'Rs. ').replace(/[—–]/g, '-'), rows, cols, totals, summary: props.summary, entity: 'payroll_runs' }))
    setBusy(false)
  }
  return (
    <Card>
      <CardHeader
        icon={props.icon}
        title={props.title}
        subtitle={props.subtitle}
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!rows.length} onClick={() => exportTableCsv(props.file, rows, cols, totals, 'payroll_runs')}>
              CSV
            </Button>
            <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} disabled={!rows.length} loading={busy} onClick={pdf}>
              PDF
            </Button>
          </>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 lg:grid-cols-5">
          {props.chips.map(([k, v], i) => (
            <div key={k} className={cn('min-w-0 rounded-lg border px-3.5 py-2.5', i === props.chips.length - 1 ? 'border-transparent bg-brand-600 text-white' : 'border-line bg-slate-50')}>
              <p className={cn('truncate text-[11px] font-semibold uppercase tracking-wider', i === props.chips.length - 1 ? 'text-white/80' : 'text-ink-faint')}>{k}</p>
              <p className={cn('num truncate text-lg font-semibold', i === props.chips.length - 1 ? 'text-white' : 'text-ink')}>{v}</p>
            </div>
          ))}
        </div>
        {props.note && (
          <p className="flex gap-2.5 rounded-md bg-sky-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-sky-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{props.note}</span>
          </p>
        )}
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.name} ${r.code}`}
          searchPlaceholder="Search employee…"
          toolbar={props.toolbar}
          pageSize={50}
          dense
          empty={<EmptyState title="Nothing to file" description={props.empty} />}
          footer={
            rows.length ? (
              <tr className="border-t-2 border-line bg-slate-50">
                {cols.map((c, i) => (
                  <td key={c.key} className={cn('whitespace-nowrap px-3.5 py-2.5 text-[13px] font-medium text-ink', c.align === 'right' ? 'num text-right' : 'text-left')}>
                    {i === 0 ? 'Total' : c.money ? inr(Number(c.value(totals))) : c.align === 'right' ? num(Number(c.value(totals))) : ''}
                  </td>
                ))}
              </tr>
            ) : undefined
          }
        />
      </CardBody>
    </Card>
  )
}
