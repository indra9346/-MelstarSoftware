/**
 * Leave balances per financial year — available / entitled per employee and type (lib/leaves.leaveBalances),
 * manual adjustments and the year-end carry forward.
 */
import { useEffect, useMemo, useState } from 'react'
import { Download, RefreshCcw, Search } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Employee, LeaveType } from '@/data/types'
import { leaveBalances, type BalanceView } from '@/lib/leaves'
import { fyLabel, fyOf } from '@/lib/dates'
import { fullName, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { exportCsv } from '@/lib/export'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { audit } from '@/services/audit'
import { adjustBalance, carryForward, employeesInFy, isUnlimited, planCarryForward, validateBalance, type BalanceValues } from '@/services/leaves'
import { Button, confirm, EmptyState, Field, Input, Modal, Select, Textarea, toast } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useToday } from '../shared'

interface Target {
  emp: Employee
  type: LeaveType
  view: BalanceView
}

export function BalancesTab() {
  const s = useSession()
  const L = useLookups()
  const today = useToday()
  const mobile = useIsMobile()
  const employees = useTable('employees')
  const types = useTable('leave_types')
  const balances = useTable('leave_balances')
  const requests = useTable('leave_requests')
  const departments = useTable('departments')
  const currentFy = fyOf(today)
  const [fy, setFy] = useState(currentFy)
  const [dept, setDept] = useState('')
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const manage = s.can('leaves.manage')

  const years = useMemo(() => [...new Set([currentFy - 1, currentFy, currentFy + 1, ...balances.map((b) => b.year)])].sort((a, b) => b - a), [balances, currentFy])
  const cols = useMemo(() => types.filter((t) => t.active && !isUnlimited(t)).sort((a, b) => a.code.localeCompare(b.code)), [types])
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      employeesInFy(fy, employees)
        .filter((e) => (fy < currentFy || e.status !== 'exited') && (!dept || e.department_id === dept) && (!needle || `${fullName(e)} ${e.emp_code}`.toLowerCase().includes(needle)))
        .sort((a, b) => fullName(a).localeCompare(fullName(b)))
        .map((emp) => ({ emp, views: leaveBalances(emp, fy, types, balances, requests) })),
    [fy, employees, dept, needle, types, balances, requests, currentFy],
  )

  const runCarryForward = async () => {
    const plan = planCarryForward(fy)
    const carried = plan.rows.reduce((t, r) => t + r.opening, 0)
    const existing = plan.rows.filter((r) => r.existing).length
    const ok = await confirm({
      title: `Carry forward FY ${fyLabel(fy)} → ${fyLabel(fy + 1)}?`,
      message: `${plan.rows.length} balances for ${plan.employees} employees. Carry-forward types roll over the unused balance (capped at each type’s maximum) — ${num(carried)} days in total; other types start at 0. Allotted = annual quota (pro-rated for joiners).${existing ? ` ${existing} FY ${fyLabel(fy + 1)} rows already exist and will be updated (adjustments kept).` : ''}`,
      confirmLabel: 'Carry forward',
    })
    if (!ok) return
    try {
      const n = carryForward(fy)
      toast.success('Carry forward done', `${n} balances written for FY ${fyLabel(fy + 1)}.`)
      setFy(fy + 1)
    } catch (e) {
      toast.error('Could not carry forward', e instanceof Error ? e.message : String(e))
    }
  }

  const csv = () => {
    exportCsv(`leave-balances-FY${fyLabel(fy)}`, rows, [
      { header: 'Emp code', value: (r) => r.emp.emp_code },
      { header: 'Name', value: (r) => fullName(r.emp) },
      { header: 'Department', value: (r) => L.deptName(r.emp.department_id) },
      ...cols.flatMap((t) => [
        { header: `${t.code} entitled`, value: (r: (typeof rows)[number]) => r.views.find((v) => v.type.id === t.id)?.entitled ?? '' },
        { header: `${t.code} used`, value: (r: (typeof rows)[number]) => r.views.find((v) => v.type.id === t.id)?.used ?? '' },
        { header: `${t.code} pending`, value: (r: (typeof rows)[number]) => r.views.find((v) => v.type.id === t.id)?.pending ?? '' },
        { header: `${t.code} available`, value: (r: (typeof rows)[number]) => r.views.find((v) => v.type.id === t.id)?.available ?? '' },
      ]),
    ])
    audit('export', 'leave_balances', null, `Exported leave balances FY ${fyLabel(fy)} (CSV)`)
  }

  const cell = (emp: Employee, t: LeaveType, v: BalanceView | undefined, compact?: boolean) => {
    if (!v) return <span className="text-ink-faint">—</span>
    const pctUsed = v.entitled > 0 ? Math.min(1, (v.used + v.pending) / v.entitled) : 0
    return (
      <button
        type="button"
        disabled={!manage}
        onClick={() => setTarget({ emp, type: t, view: v })}
        title={`${t.name}: opening ${num(v.opening)} + allotted ${num(v.allotted)} + adj ${num(v.adjustment)} · used ${num(v.used)} · pending ${num(v.pending)}`}
        className={cn('group w-full rounded-md px-2 py-1 text-left transition', manage && 'hover:bg-brand-50', compact && 'px-0')}
      >
        <span className="num block whitespace-nowrap text-[13px]">
          <b className={cn(v.available < 0 ? 'text-rose-600' : v.available === 0 ? 'text-ink-faint' : 'text-ink')}>{num(v.available)}</b>
          <span className="text-ink-faint"> / {num(v.entitled)}</span>
        </span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-200/80">
          <span className="block h-full rounded-full" style={{ background: t.color, width: `${pctUsed * 100}%` }} />
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(fy)} onChange={(e) => setFy(Number(e.target.value))} options={years.map((y) => ({ value: String(y), label: `FY ${fyLabel(y)}${y === currentFy ? ' (current)' : ''}` }))} className="h-10 w-auto min-w-[150px] py-0 text-sm" aria-label="Financial year" />
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="field-input h-10 py-0 pl-9 text-sm" type="search" />
        </div>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[150px] py-0 text-sm" aria-label="Department" />
        <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={csv} disabled={!rows.length}>
          CSV
        </Button>
        {manage && (
          <Button size="sm" variant="outline" icon={<RefreshCcw className="h-4 w-4" />} onClick={() => void runCarryForward()}>
            Year-end carry forward
          </Button>
        )}
      </div>
      <p className="text-[12.5px] text-ink-soft">
        Shows <b>available</b> / entitled (opening + allotted + adjustment). Available already deducts approved and pending leave. {manage && 'Click a cell to adjust.'} Leave without pay has no balance.
      </p>

      {!rows.length ? (
        <EmptyState title="No employees" description="Nobody matches these filters for this financial year." />
      ) : mobile ? (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.emp.id} className="rounded-lg border border-line bg-white p-3.5 shadow-sm">
              <EmployeeCell id={r.emp.id} sub="code" />
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 xs:grid-cols-3">
                {cols.map((t) => {
                  const v = r.views.find((x) => x.type.id === t.id)
                  if (!v) return null
                  return (
                    <div key={t.id} className="min-w-0">
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: t.color }}>
                        {t.code}
                      </p>
                      {cell(r.emp, t, v, true)}
                    </div>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white scroll-thin">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[220px] border-b border-r border-line bg-brand-50 px-3.5 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">Employee</th>
                {cols.map((t) => (
                  <th key={t.id} className="min-w-[96px] border-b border-line bg-slate-50 px-2 py-2.5 text-left text-[11.5px] font-semibold text-ink-soft" title={t.name}>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                      {t.code}
                      {t.carry_forward && <span className="font-normal normal-case text-ink-faint">CF {num(t.max_carry_forward)}</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.emp.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-line bg-white px-3.5 py-2 group-hover:bg-slate-50">
                    <EmployeeCell id={r.emp.id} sub="code" size={28} />
                  </td>
                  {cols.map((t) => (
                    <td key={t.id} className="border-b border-line px-1 py-1.5">
                      {cell(r.emp, t, r.views.find((x) => x.type.id === t.id))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AdjustModal target={target} fy={fy} onClose={() => setTarget(null)} />
    </div>
  )
}

function AdjustModal({ target, fy, onClose }: { target: Target | null; fy: number; onClose: () => void }) {
  const [v, setV] = useState<BalanceValues>({ opening: 0, allotted: 0, adjustment: 0 })
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!target) return
    setV({ opening: target.view.opening, allotted: target.view.allotted, adjustment: target.view.adjustment })
    setReason('')
    setTouched(false)
  }, [target])
  const errors = validateBalance(v, reason)
  const ok = Object.keys(errors).length === 0
  const entitled = (v.opening || 0) + (v.allotted || 0) + (v.adjustment || 0)
  const available = target ? entitled - target.view.used - target.view.pending : 0
  const numField = (k: keyof BalanceValues, label: string, hint: string) => (
    <Field label={label} error={errors[k]} hint={hint}>
      <Input type="number" step={0.5} inputMode="decimal" value={Number.isFinite(v[k]) ? v[k] : ''} onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value === '' ? NaN : Number(e.target.value) }))} invalid={!!errors[k]} />
    </Field>
  )

  const save = () => {
    setTouched(true)
    if (!target || !ok) return
    try {
      adjustBalance(target.emp.id, target.type.id, fy, v, reason)
      toast.success('Balance updated', `${target.type.code} · ${fullName(target.emp)} · FY ${fyLabel(fy)}`)
      onClose()
    } catch (e) {
      toast.error('Could not update balance', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      size="sm"
      title={target ? `Adjust ${target.type.code} balance` : ''}
      subtitle={target ? `${fullName(target.emp)} · FY ${fyLabel(fy)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ok}>
            Save balance
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-3">
            {numField('opening', 'Opening', 'Carried in')}
            {numField('allotted', 'Allotted', 'This year')}
            {numField('adjustment', 'Adjustment', '+ credit / − debit')}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-slate-50 p-3 text-[13px] sm:grid-cols-4">
            <Stat k="Entitled" v={num(entitled)} />
            <Stat k="Used" v={num(target.view.used)} />
            <Stat k="Pending" v={num(target.view.pending)} />
            <Stat k="Available" v={num(available)} warn={available < 0} />
          </div>
          <Field label="Reason" required error={touched || reason ? errors.reason : undefined} hint="Recorded in the audit trail, e.g. comp-off for Sunday dispatch on 4 Oct">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{k}</p>
      <p className={cn('num text-[16px] font-semibold', warn ? 'text-rose-600' : 'text-ink')}>{v}</p>
    </div>
  )
}
