import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Calculator, History, IndianRupee, Layers, Save, Sparkles, Users, Wand2 } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Employee, SalaryStructure } from '@/data/types'
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Modal, Segmented, Select, StatCard, Switch, Textarea, type Column,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, todayISO } from '@/lib/dates'
import { fullName, inr, inrCompact } from '@/lib/format'
import { cn } from '@/lib/misc'
import { annualCtc, annualTax, computePayslip, monthlyGross, structureFromGross, type TaxBreakup } from '@/lib/payroll'
import { currentStructure, defaultEffectiveFrom, saveStructure, structureErrors, type StructureInput } from '@/services/payroll'
import { useSession } from '@/services/session'
import { commit, toNum, useSticky } from './utils'

interface Row {
  emp: Employee
  st: SalaryStructure | undefined
  revisions: number
}

export function StructuresTab() {
  const L = useLookups()
  const structures = useTable('salary_structures')
  const settings = useSettings()
  const s = useSession()
  const [dept, setDept] = useState('')
  const [view, setView] = useState<'all' | 'missing'>('all')
  const [editing, setEditing] = useState<Employee | null>(null)

  const rows = useMemo<Row[]>(() => {
    const today = todayISO()
    return L.activeEmployees
      .map((emp) => ({ emp, st: currentStructure(emp.id, structures, today), revisions: structures.filter((x) => x.employee_id === emp.id).length }))
      .sort((a, b) => a.emp.emp_code.localeCompare(b.emp.emp_code, 'en-IN', { numeric: true }))
  }, [L.activeEmployees, structures])
  const visible = rows.filter((r) => (!dept || r.emp.department_id === dept) && (view === 'all' || !r.st))
  const stats = useMemo(() => {
    const withSt = rows.filter((r) => r.st)
    return {
      covered: withSt.length,
      missing: rows.length - withSt.length,
      gross: withSt.reduce((t, r) => t + monthlyGross(r.st!), 0),
      ctc: withSt.reduce((t, r) => t + annualCtc(r.st!, settings.payroll), 0),
    }
  }, [rows, settings.payroll])

  const deptOptions = useMemo(() => [...L.dept.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name })), [L.dept])

  const flags = (st: SalaryStructure) => (
    <span className="inline-flex flex-wrap gap-1">
      {(['pf_applicable', 'esi_applicable', 'pt_applicable'] as const).map((k) => (
        <span key={k} className={cn('rounded-md px-1.5 py-px text-[11px] font-semibold', st[k] ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400 line-through')}>
          {k === 'pf_applicable' ? 'PF' : k === 'esi_applicable' ? 'ESI' : 'PT'}
        </span>
      ))}
    </span>
  )

  const columns: Column<Row>[] = [
    { key: 'emp', header: 'Employee', value: (r) => fullName(r.emp), exportValue: (r) => `${fullName(r.emp)} (${r.emp.emp_code})`, cell: (r) => <EmployeeCell id={r.emp.id} sub="code" /> },
    { key: 'dept', header: 'Department', value: (r) => L.deptName(r.emp.department_id), hideOnMobile: true },
    {
      key: 'from', header: 'Effective from', value: (r) => r.st?.effective_from ?? '', exportValue: (r) => (r.st ? fmtDate(r.st.effective_from) : 'No structure'),
      cell: (r) => (r.st ? <span>{fmtDate(r.st.effective_from)}{r.st.effective_from > todayISO() && <Badge tone="sky" className="ml-1.5">upcoming</Badge>}</span> : <Badge tone="amber" dot>No structure</Badge>),
    },
    { key: 'gross', header: 'Monthly gross', align: 'right', value: (r) => (r.st ? monthlyGross(r.st) : null), cell: (r) => (r.st ? <span className="font-semibold">{inr(monthlyGross(r.st))}</span> : '—') },
    { key: 'ctc', header: 'Annual CTC', align: 'right', value: (r) => (r.st ? annualCtc(r.st, settings.payroll) : null), cell: (r) => (r.st ? inr(annualCtc(r.st, settings.payroll)) : '—') },
    { key: 'flags', header: 'Statutory', value: (r) => (r.st ? [r.st.pf_applicable && 'PF', r.st.esi_applicable && 'ESI', r.st.pt_applicable && 'PT'].filter(Boolean).join(' ') : ''), cell: (r) => (r.st ? flags(r.st) : '—'), sortable: false },
    { key: 'ot', header: 'OT', value: (r) => (r.st ? (r.st.ot_eligible ? 'Yes' : 'No') : ''), cell: (r) => (r.st ? r.st.ot_eligible ? <Badge tone="green">Eligible</Badge> : <span className="text-ink-faint">No</span> : '—') },
    { key: 'regime', header: 'Regime', value: (r) => (r.emp.tax_regime === 'old' ? 'Old' : 'New'), cell: (r) => <Badge tone={r.emp.tax_regime === 'old' ? 'violet' : 'cyan'}>{r.emp.tax_regime === 'old' ? 'Old' : 'New'}</Badge> },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
        <StatCard label="With a structure" value={stats.covered} icon={<Users className="h-4 w-4" />} accent="indigo" hint={`of ${rows.length} active employees`} />
        <StatCard label="Missing structure" value={stats.missing} icon={<AlertTriangle className="h-4 w-4" />} accent={stats.missing ? 'amber' : 'green'} hint={stats.missing ? 'skipped by payroll runs' : 'everyone is covered'} onClick={stats.missing ? () => setView('missing') : undefined} />
        <StatCard label="Fixed monthly gross" value={stats.gross} format={inrCompact} icon={<IndianRupee className="h-4 w-4" />} accent="cyan" hint={inr(stats.gross)} />
        <StatCard label="Annual CTC" value={stats.ctc} format={inrCompact} icon={<Layers className="h-4 w-4" />} accent="pink" hint="incl. employer PF & ESI" />
      </div>

      <Card>
        <CardHeader title="Salary structures" subtitle={s.can('payroll.manage') ? 'Click an employee to revise their structure' : 'Click an employee to view their structure'} icon={<Layers className="h-4 w-4" />} />
        <CardBody>
          <DataTable
            rows={visible}
            columns={columns}
            rowKey={(r) => r.emp.id}
            searchText={(r) => `${fullName(r.emp)} ${r.emp.emp_code} ${L.deptName(r.emp.department_id)} ${L.desigTitle(r.emp.designation_id)}`}
            searchPlaceholder="Search employee, code, department…"
            onRowClick={(r) => setEditing(r.emp)}
            exportName="salary-structures"
            exportSubtitle={`As on ${fmtDate(todayISO())}`}
            toolbar={
              <>
                <div className="w-full xs:w-48">
                  <Select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={deptOptions} />
                </div>
                <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'missing', label: `Missing (${stats.missing})` }]} />
              </>
            }
            mobileCard={(r) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <EmployeeCell id={r.emp.id} sub="code" />
                  </div>
                  {r.st ? <span className="num shrink-0 font-display font-bold text-ink">{inr(monthlyGross(r.st))}</span> : <Badge tone="amber" dot>No structure</Badge>}
                </div>
                {r.st && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
                    <span>from {fmtDate(r.st.effective_from)}</span>
                    <span>CTC {inr(annualCtc(r.st, settings.payroll))}</span>
                    {flags(r.st)}
                    {r.st.ot_eligible && <Badge tone="green">OT</Badge>}
                  </div>
                )}
              </div>
            )}
          />
        </CardBody>
      </Card>

      <StructureEditor employee={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/* ───────────────────────────── editor ───────────────────────────── */

interface Form {
  effective_from: string
  basic: string
  da: string
  hra: string
  conveyance: string
  special_allowance: string
  other_allowance: string
  pf: boolean
  esi: boolean
  pt: boolean
  ot: boolean
  ot_rate: string
  notes: string
}

const COMPONENTS: [keyof Form & ('basic' | 'da' | 'hra' | 'conveyance' | 'special_allowance' | 'other_allowance'), string][] = [
  ['basic', 'Basic'],
  ['da', 'Dearness allowance (DA)'],
  ['hra', 'House rent allowance'],
  ['conveyance', 'Conveyance'],
  ['special_allowance', 'Special allowance'],
  ['other_allowance', 'Other allowance'],
]

function formFrom(st: SalaryStructure | undefined, emp: Employee, fyStartMonth: number): Form {
  if (!st) {
    return { effective_from: defaultEffectiveFrom(emp, fyStartMonth), basic: '', da: '', hra: '', conveyance: '', special_allowance: '', other_allowance: '0', pf: emp.employment_type !== 'apprentice', esi: true, pt: true, ot: false, ot_rate: '', notes: '' }
  }
  return {
    effective_from: st.effective_from,
    basic: String(st.basic),
    da: String(st.da),
    hra: String(st.hra),
    conveyance: String(st.conveyance),
    special_allowance: String(st.special_allowance),
    other_allowance: String(st.other_allowance),
    pf: st.pf_applicable,
    esi: st.esi_applicable,
    pt: st.pt_applicable,
    ot: st.ot_eligible,
    ot_rate: st.ot_rate_per_hour != null ? String(st.ot_rate_per_hour) : '',
    notes: st.notes,
  }
}

function toInput(f: Form): StructureInput {
  return {
    effective_from: f.effective_from,
    basic: toNum(f.basic),
    da: toNum(f.da || '0'),
    hra: toNum(f.hra || '0'),
    conveyance: toNum(f.conveyance || '0'),
    special_allowance: toNum(f.special_allowance || '0'),
    other_allowance: toNum(f.other_allowance || '0'),
    pf_applicable: f.pf,
    esi_applicable: f.esi,
    pt_applicable: f.pt,
    ot_eligible: f.ot,
    ot_rate_per_hour: f.ot_rate.trim() === '' ? null : toNum(f.ot_rate),
    notes: f.notes,
  }
}

function StructureEditor({ employee: open, onClose }: { employee: Employee | null; onClose: () => void }) {
  // keep the last employee while the dialog animates out
  const employee = useSticky(open)
  const structures = useTable('salary_structures')
  const settings = useSettings()
  const cfg = settings.payroll
  const s = useSession()
  const L = useLookups()
  const canEdit = s.can('payroll.manage')
  const history = useMemo(() => (employee ? structures.filter((x) => x.employee_id === employee.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from)) : []), [structures, employee])
  const current = employee ? currentStructure(employee.id, structures) : undefined
  const [form, setForm] = useState<Form | null>(null)
  const [esiTouched, setEsiTouched] = useState(false)
  const [grossHelper, setGrossHelper] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!employee) return
    setForm(formFrom(current, employee, settings.financial_year_start_month || 4))
    setEsiTouched(!!current)
    setGrossHelper(current ? String(monthlyGross(current)) : '')
    setTried(false)
  }, [open?.id])

  const input = form ? toInput(form) : null
  const errors = input ? structureErrors(input) : {}
  const valid = !Object.keys(errors).length
  const gross = input && valid ? monthlyGross(input) : input ? COMPONENTS.reduce((t, [k]) => t + (Number.isFinite(input[k]) ? input[k] : 0), 0) : 0

  // ESI is suggested from the gross until the user decides
  useEffect(() => {
    if (!form || esiTouched) return
    const suggested = gross > 0 && gross <= cfg.esi_wage_threshold
    if (suggested !== form.esi) setForm({ ...form, esi: suggested })
  }, [gross])

  if (!employee) return null

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const sameDate = history.find((h) => h.effective_from === form?.effective_from)
  const mode: 'update' | 'new' = sameDate ? 'update' : 'new'

  const fillFromGross = () => {
    const g = toNum(grossHelper)
    if (!(g > 0)) return
    const parts = structureFromGross(Math.round(g))
    setForm((f) => (f ? { ...f, ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, String(v)])) } : f))
  }

  const save = async () => {
    setTried(true)
    if (!input || !valid) return
    setBusy(true)
    const res = await commit(() => saveStructure(employee.id, input), (r) => (r.created ? 'New salary revision saved' : 'Salary structure updated'), `${fullName(employee)} · ${inr(monthlyGross(input))}/month from ${fmtDate(input.effective_from)}`)
    setBusy(false)
    if (res.ok) onClose()
  }

  // live preview on a full month
  const st: SalaryStructure | null = input && valid
    ? { id: '', created_at: '', updated_at: '', employee_id: employee.id, ctc_annual: 0, ...input, ot_rate_per_hour: input.ot_rate_per_hour && input.ot_rate_per_hour > 0 ? input.ot_rate_per_hour : null }
    : null
  const calc = st ? computePayslip({ month: `${st.effective_from.slice(0, 4)}-04`, structure: st, regime: employee.tax_regime, declaredDeductions: employee.declared_deductions, daysInMonth: 30, paidDays: 30, otMinutesApproved: 0, config: cfg }) : null
  const taxNew = st ? annualTax(st, 'new', employee.declared_deductions, cfg) : null
  const taxOld = st ? annualTax(st, 'old', employee.declared_deductions, cfg) : null
  const ctc = st ? annualCtc(st, cfg) : 0
  const esiCovered = gross > 0 && gross <= cfg.esi_wage_threshold

  return (
    <Modal
      open={!!open}
      onClose={onClose}
      size="xl"
      title={`Salary structure · ${fullName(employee)}`}
      subtitle={`${employee.emp_code} · ${L.desigTitle(employee.designation_id)} · ${employee.tax_regime === 'old' ? 'old' : 'new'} tax regime`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && (
            <Button onClick={save} loading={busy} disabled={tried && !valid} icon={<Save className="h-4 w-4" />}>
              {mode === 'update' ? 'Update structure' : history.length ? 'Save new revision' : 'Save structure'}
            </Button>
          )}
        </>
      }
    >
      {form && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Effective from"
                required
                error={tried ? errors.effective_from : null}
                hint={mode === 'update' ? `Updates the revision from ${fmtDate(form.effective_from)}` : history.length ? 'A new date adds a revision — older ones stay in history' : 'First structure for this employee'}
              >
                <Input type="date" value={form.effective_from} disabled={!canEdit} onChange={(e) => set('effective_from', e.target.value)} min={employee.date_of_joining} />
              </Field>
              {canEdit && (
                <Field label="Fill from monthly gross" hint="Splits into basic 45%, DA 5%, HRA 40% of basic, conveyance, special">
                  <div className="flex gap-2">
                    <Input type="number" inputMode="decimal" min={0} value={grossHelper} onChange={(e) => setGrossHelper(e.target.value)} placeholder="e.g. 32000" leading={<IndianRupee className="h-4 w-4" />} />
                    <Button variant="secondary" onClick={fillFromGross} disabled={!(toNum(grossHelper) > 0)} icon={<Wand2 className="h-4 w-4" />} aria-label="Fill components">
                      Fill
                    </Button>
                  </div>
                </Field>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-3">
              {COMPONENTS.map(([k, label]) => (
                <Field key={k} label={`${label} / month`} required={k === 'basic'} error={tried ? errors[k] : null}>
                  <Input type="number" inputMode="decimal" min={0} step="1" value={form[k]} disabled={!canEdit} invalid={tried && !!errors[k]} onChange={(e) => set(k, e.target.value)} placeholder="0" />
                </Field>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-indigo-100 bg-white/70 p-4 sm:grid-cols-2">
              <Switch checked={form.pf} disabled={!canEdit} onChange={(v) => set('pf', v)} label="Provident fund" description={`${cfg.pf_employee_rate}% of basic + DA${cfg.pf_restrict_to_ceiling ? `, capped at ${inr(cfg.pf_wage_ceiling)}` : ''}`} />
              <Switch
                checked={form.esi}
                disabled={!canEdit}
                onChange={(v) => {
                  setEsiTouched(true)
                  set('esi', v)
                }}
                label="ESI"
                description={esiCovered ? `Suggested: on (gross ≤ ${inr(cfg.esi_wage_threshold)})` : `Not deducted while gross is above ${inr(cfg.esi_wage_threshold)}`}
              />
              <Switch checked={form.pt} disabled={!canEdit} onChange={(v) => set('pt', v)} label="Professional tax" description={`${settings.payroll.pt_state} slabs`} />
              <Switch checked={form.ot} disabled={!canEdit} onChange={(v) => set('ot', v)} label="Overtime eligible" description={`(basic + DA) ÷ ${cfg.ot_base_days} ÷ ${cfg.ot_hours_per_day} × ${cfg.ot_multiplier}`} />
              <AnimatePresence initial={false}>
                {form.ot && (
                  <motion.div key="otrate" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden sm:col-span-2">
                    <Field label="OT rate override (₹/hour)" error={tried ? errors.ot_rate_per_hour : null} hint={st ? `Leave blank to use the statutory rate (${inr(((st.basic + st.da) / cfg.ot_base_days / cfg.ot_hours_per_day) * cfg.ot_multiplier)}/h)` : 'Leave blank to use the statutory rate'}>
                      <Input type="number" inputMode="decimal" min={0} value={form.ot_rate} disabled={!canEdit} onChange={(e) => set('ot_rate', e.target.value)} placeholder="Statutory rate" />
                    </Field>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <Field label="Notes">
              <Textarea rows={2} value={form.notes} disabled={!canEdit} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Annual revision FY 2026-27 — 8% increment" />
            </Field>

            <div>
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
                <History className="h-4 w-4 text-brand-indigo" /> Revision history
              </p>
              {history.length ? (
                <ul className="space-y-2">
                  {history.map((h) => {
                    const tag = h.id === current?.id ? 'Current' : h.effective_from > todayISO() ? 'Upcoming' : 'Superseded'
                    return (
                      <li key={h.id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5', h.effective_from === form.effective_from ? 'border-brand-indigo/50 bg-indigo-50/60' : 'border-indigo-100 bg-white/80')}>
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-semibold text-ink">
                            From {fmtDate(h.effective_from)} <Badge tone={tag === 'Current' ? 'green' : tag === 'Upcoming' ? 'sky' : 'slate'} className="ml-1">{tag}</Badge>
                          </p>
                          <p className="text-[12px] text-ink-soft">
                            {inr(monthlyGross(h))}/month · CTC {inr(h.ctc_annual || annualCtc(h, cfg))}
                            {h.notes ? ` · ${h.notes}` : ''}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setForm(formFrom(h, employee, settings.financial_year_start_month || 4))}>
                          {canEdit ? 'Load' : 'View'}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">No structure on file yet — this employee is skipped by payroll runs until one is saved.</p>
              )}
            </div>
          </div>

          <aside className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-2xl bg-grad p-4 text-white shadow-btn">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[.14em] text-white/85">
                <Calculator className="h-3.5 w-3.5" /> Live preview
              </p>
              <p className="mt-2 text-[12px] text-white/80">Monthly gross</p>
              <p className="num font-display text-[28px] font-bold leading-tight">{inr(gross)}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <p className="text-white/75">Take-home / month</p>
                  <p className="num text-[15px] font-semibold">{calc ? inr(calc.net_pay) : '—'}</p>
                </div>
                <div>
                  <p className="text-white/75">Annual CTC</p>
                  <p className="num text-[15px] font-semibold">{st ? inr(ctc) : '—'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white p-4">
              <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Employee deductions (full month)</p>
              <Kv k="Provident fund" v={calc ? inr(calc.pf_employee) : '—'} />
              <Kv k="ESI" v={calc ? inr(calc.esi_employee) : '—'} />
              <Kv k="Professional tax" v={calc ? `${inr(calc.professional_tax)}${calc.professional_tax ? ' (Feb ₹300)' : ''}` : '—'} />
              <Kv k="TDS" v={calc ? inr(calc.tds) : '—'} />
              <p className="mb-1 mt-3 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Employer contributions</p>
              <Kv k="PF (EPF + EPS + EDLI + admin)" v={calc ? inr(calc.pf_employer_epf + calc.pf_employer_eps + calc.pf_edli + calc.pf_admin) : '—'} />
              <Kv k="ESI" v={calc ? inr(calc.esi_employer) : '—'} />
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-white p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                <Sparkles className="h-3.5 w-3.5" /> Projected annual tax
              </p>
              <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 lg:grid-cols-1">
                <TaxTile label="New regime" t={taxNew} active={employee.tax_regime === 'new'} />
                <TaxTile label="Old regime" t={taxOld} active={employee.tax_regime === 'old'} />
              </div>
              {employee.tax_regime === 'old' && <p className="mt-2 text-[11.5px] text-ink-faint">Old regime uses declared deductions of {inr(employee.declared_deductions)}.</p>}
            </div>
          </aside>
        </div>
      )}
    </Modal>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
      <span className="min-w-0 text-ink-soft">{k}</span>
      <span className="num shrink-0 font-semibold text-ink">{v}</span>
    </div>
  )
}

function TaxTile({ label, t, active }: { label: string; t: TaxBreakup | null; active: boolean }) {
  return (
    <div className={cn('rounded-xl border p-3 transition-colors', active ? 'border-brand-indigo bg-indigo-50/70 ring-2 ring-brand-indigo/20' : 'border-indigo-100 bg-white')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-ink">{label}</p>
        {active && <Badge tone="indigo">Employee’s regime</Badge>}
      </div>
      <p className="num mt-1 font-display text-lg font-bold text-ink">{t ? inr(t.annual_tax) : '—'}</p>
      <p className="text-[11.5px] text-ink-soft">{t ? `taxable ${inr(t.taxable)} · ${inr(t.monthly_tds)}/month` : 'enter the components'}</p>
    </div>
  )
}
