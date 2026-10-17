import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, CircleDollarSign, Clock, HandCoins, Plus, ReceiptIndianRupee, X } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Advance, AdvanceType, YearMonth } from '@/data/types'
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, Field, Input, Modal, Segmented, Select, StatCard, StatusBadge, Switch, Textarea, confirmWithNote, type Column,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { currentMonth, fmtDate, fmtMonth, todayISO } from '@/lib/dates'
import { fullName, inr, inrCompact } from '@/lib/format'
import {
  ADVANCE_TYPE_LABEL, advanceProgress, approveAdvance, closeAdvance, createAdvance, defaultApproval, emiFor, rejectAdvance, type AdvanceProgress,
} from '@/services/payroll'
import { useSession } from '@/services/session'
import { AdvanceDetails } from './AdvanceDetails'
import { commit, fyOfMonth, monthOption, monthRange, toNum, useSticky } from './utils'

type StatusFilter = 'pending' | 'active' | 'closed' | 'rejected' | 'all'
interface Row {
  a: Advance
  prog: AdvanceProgress
}

export function AdvancesTab() {
  const advances = useTable('advances')
  const recoveries = useTable('advance_recoveries')
  const runs = useTable('payroll_runs')
  const settings = useSettings()
  const L = useLookups()
  const s = useSession()
  const canManage = s.can('payroll.manage')
  const pendingCount = advances.filter((a) => a.status === 'pending').length
  const [status, setStatus] = useState<StatusFilter>(pendingCount ? 'pending' : 'all')
  const [type, setType] = useState<'' | AdvanceType>('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [approving, setApproving] = useState<Advance | null>(null)
  const [creating, setCreating] = useState(false)

  const rows = useMemo<Row[]>(() => {
    const paid = new Set(runs.filter((r) => r.status === 'paid').map((r) => r.month))
    const rank: Record<string, number> = { pending: 0, active: 1, approved: 1, closed: 2, rejected: 3 }
    return advances
      .map((a) => ({ a, prog: advanceProgress(a, recoveries, paid) }))
      .sort((x, y) => (rank[x.a.status] ?? 9) - (rank[y.a.status] ?? 9) || y.a.requested_on.localeCompare(x.a.requested_on))
  }, [advances, recoveries, runs])

  const visible = rows.filter((r) => (status === 'all' || r.a.status === status || (status === 'active' && r.a.status === 'approved')) && (!type || r.a.type === type))
  const stats = useMemo(() => {
    const fy = fyOfMonth(currentMonth(), settings.financial_year_start_month || 4)
    const pending = rows.filter((r) => r.a.status === 'pending')
    const running = rows.filter((r) => r.a.status === 'active' || r.a.status === 'approved')
    return {
      pending: pending.length,
      pendingAmt: pending.reduce((t, r) => t + r.a.amount, 0),
      running: running.length,
      outstanding: running.reduce((t, r) => t + r.prog.outstanding, 0),
      recoveredFy: recoveries.filter((r) => fyOfMonth(r.month, settings.financial_year_start_month || 4) === fy).reduce((t, r) => t + r.amount, 0),
      loans: running.filter((r) => r.a.type === 'loan').length,
    }
  }, [rows, recoveries, settings.financial_year_start_month])

  const reject = async (a: Advance) => {
    const n = await confirmWithNote({ title: `Reject ${ADVANCE_TYPE_LABEL[a.type].toLowerCase()} request`, message: `${L.empName(a.employee_id)} asked for ${inr(a.amount)}: “${a.reason}”.`, input: { label: 'Reason', required: true, placeholder: 'Shown to the employee' }, confirmLabel: 'Reject', danger: true })
    if (n.ok) await commit(() => rejectAdvance(a, n.note), 'Request rejected')
  }
  const close = async (r: Row) => {
    const n = await confirmWithNote({
      title: 'Close early?',
      message: `${L.empName(r.a.employee_id)}’s ${ADVANCE_TYPE_LABEL[r.a.type].toLowerCase()} has ${inr(r.prog.outstanding)} outstanding. Closing stops further EMIs — record how the balance was settled.`,
      input: { label: 'Note', placeholder: 'e.g. Balance repaid in cash, receipt #42' },
      confirmLabel: 'Close advance',
      danger: true,
    })
    if (n.ok) await commit(() => closeAdvance(r.a, n.note), 'Advance closed')
  }

  const actions = (r: Row, size: 'sm' | 'icon-sm' = 'icon-sm') =>
    canManage && r.a.status === 'pending' ? (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size={size} variant="success" onClick={() => setApproving(r.a)} aria-label="Approve" title="Approve" icon={<Check className="h-4 w-4" />}>
          {size === 'sm' ? 'Approve' : null}
        </Button>
        <Button size={size} variant="secondary" onClick={() => reject(r.a)} aria-label="Reject" title="Reject" icon={<X className="h-4 w-4" />}>
          {size === 'sm' ? 'Reject' : null}
        </Button>
      </div>
    ) : null

  const columns: Column<Row>[] = [
    { key: 'emp', header: 'Employee', value: (r) => L.empName(r.a.employee_id), cell: (r) => <EmployeeCell id={r.a.employee_id} sub="code" /> },
    { key: 'type', header: 'Type', value: (r) => ADVANCE_TYPE_LABEL[r.a.type], cell: (r) => <Badge tone={r.a.type === 'loan' ? 'violet' : 'cyan'}>{ADVANCE_TYPE_LABEL[r.a.type]}</Badge> },
    { key: 'amount', header: 'Amount', align: 'right', value: (r) => r.a.amount, cell: (r) => <span className="font-semibold">{inr(r.a.amount)}</span> },
    { key: 'emi', header: 'EMI', align: 'right', value: (r) => r.a.emi_amount, exportValue: (r) => `${r.a.emi_amount} x ${r.a.installments}`, cell: (r) => `${inr(r.a.emi_amount)} × ${r.a.installments}` },
    { key: 'start', header: 'From', value: (r) => r.a.start_month, exportValue: (r) => fmtMonth(r.a.start_month), cell: (r) => fmtMonth(r.a.start_month, true) },
    { key: 'rec', header: 'Recovered', align: 'right', value: (r) => r.prog.recovered, cell: (r) => inr(r.prog.recovered), hideOnMobile: true },
    { key: 'out', header: 'Outstanding', align: 'right', value: (r) => r.prog.outstanding, cell: (r) => inr(r.prog.outstanding) },
    { key: 'status', header: 'Status', value: (r) => r.a.status, cell: (r) => <StatusBadge status={r.a.status} /> },
    { key: 'req', header: 'Requested', value: (r) => r.a.requested_on, exportValue: (r) => fmtDate(r.a.requested_on), cell: (r) => fmtDate(r.a.requested_on), hideOnMobile: true },
    ...(canManage ? [{ key: 'act', header: '', export: false, sortable: false, hideOnMobile: true, cell: (r: Row) => actions(r) } satisfies Column<Row>] : []),
  ]

  const open = rows.find((r) => r.a.id === openId)?.a ?? null
  const shown = useSticky(open)
  const shownRow = shown ? rows.find((r) => r.a.id === shown.id) : undefined

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending requests" value={stats.pending} icon={<Clock className="h-4 w-4" />} accent="amber" hint={stats.pending ? `${inr(stats.pendingAmt)} requested` : 'nothing waiting'} onClick={stats.pending ? () => setStatus('pending') : undefined} />
        <StatCard label="Outstanding" value={stats.outstanding} format={inrCompact} icon={<CircleDollarSign className="h-4 w-4" />} accent="pink" hint={`${stats.running} running · ${stats.loans} loan${stats.loans === 1 ? '' : 's'}`} onClick={() => setStatus('active')} />
        <StatCard label="Recovered this FY" value={stats.recoveredFy} format={inrCompact} icon={<ReceiptIndianRupee className="h-4 w-4" />} accent="green" hint={inr(stats.recoveredFy)} />
        <StatCard label="All requests" value={rows.length} icon={<HandCoins className="h-4 w-4" />} accent="indigo" hint="advances and loans on record" onClick={() => setStatus('all')} />
      </div>

      <Card>
        <CardHeader
          title="Advances & loans"
          subtitle="Interest-free salary advances and staff loans, recovered as EMIs through payroll"
          icon={<HandCoins className="h-4 w-4" />}
          actions={
            canManage && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New advance
              </Button>
            )
          }
        />
        <CardBody>
          <DataTable
            rows={visible}
            columns={columns}
            rowKey={(r) => r.a.id}
            searchText={(r) => `${L.empName(r.a.employee_id)} ${L.emp.get(r.a.employee_id)?.emp_code ?? ''} ${r.a.reason}`}
            searchPlaceholder="Search employee or reason…"
            onRowClick={(r) => setOpenId(r.a.id)}
            exportName="advances-and-loans"
            toolbar={
              <>
                <Segmented
                  size="sm"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'pending', label: `Pending${stats.pending ? ` (${stats.pending})` : ''}` },
                    { value: 'active', label: 'Active' },
                    { value: 'closed', label: 'Closed' },
                    { value: 'rejected', label: 'Rejected' },
                    { value: 'all', label: 'All' },
                  ]}
                />
                <div className="w-full xs:w-44">
                  <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as '' | AdvanceType)} placeholder="All types" options={[{ value: 'salary_advance', label: 'Salary advances' }, { value: 'loan', label: 'Loans' }]} />
                </div>
              </>
            }
            mobileCard={(r) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <EmployeeCell id={r.a.employee_id} sub="code" />
                  </div>
                  <StatusBadge status={r.a.status} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-soft">
                  <span>
                    <Badge tone={r.a.type === 'loan' ? 'violet' : 'cyan'}>{ADVANCE_TYPE_LABEL[r.a.type]}</Badge> <b className="num text-ink">{inr(r.a.amount)}</b> · {inr(r.a.emi_amount)} × {r.a.installments}
                  </span>
                  {r.prog.outstanding > 0 && <span>Outstanding {inr(r.prog.outstanding)}</span>}
                </div>
                {actions(r, 'sm')}
              </div>
            )}
          />
        </CardBody>
      </Card>

      <Modal
        open={!!open}
        onClose={() => setOpenId(null)}
        side
        size="md"
        title={shown ? `${ADVANCE_TYPE_LABEL[shown.type]} · ${L.empName(shown.employee_id)}` : ''}
        subtitle={shown ? `Requested ${fmtDate(shown.requested_on)}` : undefined}
        footer={
          shown &&
          canManage && (
            <>
              {shown.status === 'pending' && (
                <>
                  <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => reject(shown)}>
                    Reject
                  </Button>
                  <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setApproving(shown)}>
                    Approve
                  </Button>
                </>
              )}
              {(shown.status === 'active' || shown.status === 'approved') && shownRow && (
                <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => close(shownRow)}>
                  Close early
                </Button>
              )}
            </>
          )
        }
      >
        {shown && <AdvanceDetails advance={shown} showEmployee />}
      </Modal>

      <ApproveAdvanceModal advance={approving} onClose={() => setApproving(null)} />
      {canManage && <NewAdvanceModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  )
}

/* ───────────────────────────── approve ───────────────────────────── */

function runHint(month: YearMonth, runs: { month: string; status: string }[]) {
  const r = runs.find((x) => x.month === month)
  if (!r) return null
  if (r.status === 'draft') return `${fmtMonth(month)} payroll is a draft — recalculate it to include this EMI.`
  return `${fmtMonth(month)} payroll is already ${r.status} — the first EMI will be picked up by the next run.`
}

function ApproveAdvanceModal({ advance, onClose }: { advance: Advance | null; onClose: () => void }) {
  const a = useSticky(advance)
  const runs = useTable('payroll_runs')
  const L = useLookups()
  const [n, setN] = useState('')
  const [start, setStart] = useState<YearMonth>(currentMonth())
  const [disbursed, setDisbursed] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!advance) return
    const d = defaultApproval(advance)
    setN(String(d.installments))
    setStart(d.start_month)
    setDisbursed(d.disbursed_on)
    setNote('')
  }, [advance?.id])

  const cm = currentMonth()
  const inst = toNum(n)
  const instErr = !Number.isInteger(inst) || inst < 1 || inst > 60 ? 'Whole number from 1 to 60' : null
  const dateErr = !/^\d{4}-\d{2}-\d{2}$/.test(disbursed) ? 'Pick a date' : null
  const emi = a && !instErr ? emiFor(a.amount, inst) : 0
  const last = a && !instErr ? a.amount - emi * (inst - 1) : 0

  const submit = async () => {
    if (!a || instErr || dateErr) return
    setBusy(true)
    const res = await commit(() => approveAdvance(a, { installments: inst, start_month: start, disbursed_on: disbursed, note }), 'Advance approved', `${inr(emi)} × ${inst} from ${fmtMonth(start)}`)
    setBusy(false)
    if (res.ok) onClose()
  }

  return (
    <Modal
      open={!!advance}
      onClose={onClose}
      title="Approve & schedule recovery"
      subtitle={a ? `${L.empName(a.employee_id)} · ${ADVANCE_TYPE_LABEL[a.type]} of ${inr(a.amount)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" onClick={submit} loading={busy} disabled={!!instErr || !!dateErr} icon={<Check className="h-4 w-4" />}>
            Approve
          </Button>
        </>
      }
    >
      {a && (
        <div className="space-y-4">
          <p className="rounded-xl bg-indigo-50/70 px-3.5 py-2.5 text-[13px] text-ink-soft">
            “{a.reason}” · requested {fmtDate(a.requested_on)} for {a.installments} EMI{a.installments === 1 ? '' : 's'} from {fmtMonth(a.start_month)}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Installments" required error={instErr} hint={!instErr ? `EMI ${inr(emi)}${last !== emi ? ` (last ${inr(last)})` : ''}` : undefined}>
              <Input type="number" inputMode="numeric" min={1} max={60} step={1} value={n} onChange={(e) => setN(e.target.value)} invalid={!!instErr} />
            </Field>
            <Field label="Recovery starts" required hint={runHint(start, runs) ?? 'First EMI is deducted in this month’s payroll'}>
              <Select value={start} onChange={(e) => setStart(e.target.value)} options={monthRange(cm, 13).map(monthOption)} />
            </Field>
            <Field label="Disbursed on" required error={dateErr}>
              <Input type="date" value={disbursed} onChange={(e) => setDisbursed(e.target.value)} />
            </Field>
            <Field label="Note to employee">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
          <div className="rounded-2xl bg-grad p-4 text-white">
            <p className="text-[11.5px] font-semibold uppercase tracking-[.14em] text-white/80">Recovery plan</p>
            <p className="num mt-1 font-display text-2xl font-bold">{instErr ? '—' : `${inr(emi)} × ${inst}`}</p>
            <p className="text-[12.5px] text-white/85">{instErr ? 'Enter installments' : `${fmtMonth(start)} → ${fmtMonth(monthRange(start, inst)[inst - 1]!)}`}</p>
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ───────────────────────────── create on behalf ───────────────────────────── */

function NewAdvanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const L = useLookups()
  const runs = useTable('payroll_runs')
  const cm = currentMonth()
  const blank = { employee_id: '', type: 'salary_advance' as AdvanceType, amount: '', installments: '3', start: cm, reason: '', approve: true, disbursed: todayISO() }
  const [f, setF] = useState(blank)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setF({ ...blank, start: currentMonth(), disbursed: todayISO() })
      setTried(false)
    }
  }, [open])

  const amount = toNum(f.amount)
  const inst = toNum(f.installments)
  const errs = {
    employee_id: !f.employee_id ? 'Pick an employee' : null,
    amount: !(amount > 0) ? 'Enter an amount above zero' : null,
    installments: !Number.isInteger(inst) || inst < 1 || inst > 60 ? 'Whole number from 1 to 60' : null,
    reason: f.reason.trim().length < 3 ? 'At least 3 characters' : null,
    disbursed: f.approve && !/^\d{4}-\d{2}-\d{2}$/.test(f.disbursed) ? 'Pick a date' : null,
  }
  const valid = !Object.values(errs).some(Boolean)
  const emi = amount > 0 && !errs.installments ? emiFor(amount, inst) : 0

  const submit = async () => {
    setTried(true)
    if (!valid) return
    setBusy(true)
    const res = await commit(
      () => createAdvance({ employee_id: f.employee_id, type: f.type, amount, installments: inst, start_month: f.start, reason: f.reason, approve: f.approve, disbursed_on: f.disbursed }),
      f.approve ? 'Advance recorded and approved' : 'Advance request recorded',
      `${L.empName(f.employee_id)} · ${inr(amount)}`,
    )
    setBusy(false)
    if (res.ok) onClose()
  }
  const show = (k: keyof typeof errs) => (tried ? errs[k] : null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New advance or loan"
      subtitle="Record on an employee’s behalf"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={tried && !valid} icon={<Plus className="h-4 w-4" />}>
            {f.approve ? 'Save & approve' : 'Save as pending'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Employee" required error={show('employee_id')}>
          <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} placeholder="Select employee" options={L.employeeOptions()} />
        </Field>
        <Field label="Type">
          <Segmented value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: 'salary_advance', label: 'Salary advance' }, { value: 'loan', label: 'Loan' }]} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount (₹)" required error={show('amount')}>
            <Input type="number" inputMode="decimal" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="e.g. 15000" />
          </Field>
          <Field label="Installments" required error={show('installments')} hint={emi ? `EMI ${inr(emi)}` : undefined}>
            <Input type="number" inputMode="numeric" min={1} max={60} value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} />
          </Field>
          <Field label="Recovery starts" required hint={runHint(f.start, runs) ?? undefined}>
            <Select value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} options={monthRange(cm, 13).map(monthOption)} />
          </Field>
          {f.approve && (
            <Field label="Disbursed on" required error={show('disbursed')}>
              <Input type="date" value={f.disbursed} onChange={(e) => setF({ ...f, disbursed: e.target.value })} />
            </Field>
          )}
        </div>
        <Field label="Reason" required error={show('reason')}>
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Medical emergency" />
        </Field>
        <Switch checked={f.approve} onChange={(v) => setF({ ...f, approve: v })} label="Approve & disburse now" description="Off = saved as a pending request for review" />
        {f.employee_id && <p className="text-[12px] text-ink-faint">{fullName(L.emp.get(f.employee_id))} will see this under My payslips → Advances.</p>}
      </div>
    </Modal>
  )
}
