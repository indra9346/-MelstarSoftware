/**
 * Leave requests — review queue with balance-aware approval, rejection with a reason,
 * cancellation of approved future leave and "apply on behalf".
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, Check, Paperclip, Plus, X } from 'lucide-react'
import { useTable } from '@/data/store'
import type { LeaveRequest, LeaveStatus } from '@/data/types'
import { fmtDate, fyLabel, fyOf, relativeTime } from '@/lib/dates'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { openFile } from '@/services/files'
import { approvalPreview, approveLeave, canCancelLeave, cancelLeave, fmtLeaveDates, rejectLeave } from '@/services/leaves'
import { Button, Checkbox, confirmWithNote, DataTable, Field, guard, Modal, Segmented, Select, StatusBadge, Textarea, type Column } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { LeaveApplyModal } from '../LeaveApplyModal'
import { LeaveTypeChip, useToday } from '../shared'

type Filter = LeaveStatus | 'all'

export function LeaveRequestsTab() {
  const s = useSession()
  const L = useLookups()
  const today = useToday()
  const requests = useTable('leave_requests')
  const types = useTable('leave_types')
  const departments = useTable('departments')
  const [filter, setFilter] = useState<Filter>('pending')
  const [type, setType] = useState('')
  const [dept, setDept] = useState('')
  const [applying, setApplying] = useState(false)
  const [approving, setApproving] = useState<LeaveRequest | null>(null)
  const manage = s.can('leaves.manage')
  const typeOf = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of requests) m[r.status] = (m[r.status] ?? 0) + 1
    return m
  }, [requests])

  const rows = useMemo(
    () =>
      requests
        .filter((r) => (filter === 'all' || r.status === filter) && (!type || r.leave_type_id === type) && (!dept || L.emp.get(r.employee_id)?.department_id === dept))
        .sort((a, b) => (filter === 'pending' ? a.from_date.localeCompare(b.from_date) : b.applied_at.localeCompare(a.applied_at))),
    [requests, filter, type, dept, L],
  )

  const reject = async (r: LeaveRequest) => {
    const res = await confirmWithNote({ title: `Reject leave — ${L.empName(r.employee_id)}`, message: `${typeOf.get(r.leave_type_id)?.name ?? 'Leave'} · ${fmtLeaveDates(r)} (${num(r.days)} d)`, input: { label: 'Reason (shown to the employee)', required: true }, confirmLabel: 'Reject', danger: true })
    if (res.ok) await guard(() => rejectLeave(r, res.note), 'Leave rejected')
  }
  const cancel = async (r: LeaveRequest) => {
    const res = await confirmWithNote({
      title: `Cancel approved leave — ${L.empName(r.employee_id)}`,
      message: `${typeOf.get(r.leave_type_id)?.name ?? 'Leave'} · ${fmtLeaveDates(r)}. The ${num(r.days)} day${r.days === 1 ? '' : 's'} return to the balance and the employee is notified.`,
      input: { label: 'Reason', required: true },
      confirmLabel: 'Cancel leave',
      danger: true,
    })
    if (res.ok) await guard(() => cancelLeave(r, res.note), 'Leave cancelled')
  }

  const actions = (r: LeaveRequest) => {
    if (!manage) return null
    if (r.status === 'pending')
      return (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => void reject(r)}>
            Reject
          </Button>
          <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setApproving(r)}>
            Approve
          </Button>
        </div>
      )
    if (r.status === 'approved' && canCancelLeave(r, today))
      return (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => void cancel(r)}>
            Cancel
          </Button>
        </div>
      )
    return null
  }

  const statusCell = (r: LeaveRequest) => (
    <div className="min-w-0">
      <StatusBadge status={r.status} />
      {r.review_note && (
        <p className="mt-0.5 max-w-[200px] truncate text-[11.5px] text-ink-faint" title={r.review_note}>
          {r.review_note}
        </p>
      )}
    </div>
  )

  const columns: Column<LeaveRequest>[] = [
    { key: 'emp', header: 'Employee', cell: (r) => <EmployeeCell id={r.employee_id} sub="department" />, value: (r) => L.empName(r.employee_id) },
    { key: 'type', header: 'Type', cell: (r) => <LeaveTypeChip type={typeOf.get(r.leave_type_id)} />, value: (r) => typeOf.get(r.leave_type_id)?.code ?? '' },
    { key: 'dates', header: 'Dates', cell: (r) => <span className="whitespace-nowrap">{fmtLeaveDates(r)}</span>, value: (r) => r.from_date, exportValue: (r) => fmtLeaveDates(r) },
    { key: 'days', header: 'Days', align: 'right', value: (r) => r.days, cell: (r) => <span className="num font-semibold">{num(r.days)}</span> },
    {
      key: 'reason',
      header: 'Reason',
      cell: (r) => (
        <span className="flex min-w-0 items-start gap-1.5">
          <span className="line-clamp-2 max-w-[240px] text-[13px] text-ink-soft" title={r.reason}>
            {r.reason}
          </span>
          {r.attachment && (
            <button type="button" onClick={() => void guard(() => openFile(r.attachment))} className="shrink-0 text-brand-indigo hover:text-indigo-700" title="View attachment" aria-label="View attachment">
              <Paperclip className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
      value: (r) => r.reason,
    },
    { key: 'applied', header: 'Applied', cell: (r) => <span className="whitespace-nowrap text-[12.5px] text-ink-soft" title={fmtDate(r.applied_at.slice(0, 10))}>{relativeTime(r.applied_at)}</span>, value: (r) => r.applied_at, exportValue: (r) => fmtDate(r.applied_at.slice(0, 10)), hideOnMobile: true },
    { key: 'status', header: 'Status', cell: statusCell, value: (r) => r.status },
    ...(manage ? [{ key: 'act', header: '', export: false, sortable: false, cell: actions } satisfies Column<LeaveRequest>] : []),
  ]

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchText={(r) => `${L.empName(r.employee_id)} ${L.emp.get(r.employee_id)?.emp_code ?? ''} ${r.reason} ${typeOf.get(r.leave_type_id)?.name ?? ''}`}
        searchPlaceholder="Search employee, reason…"
        exportName={`leave-requests-${filter}`}
        toolbar={
          <>
            <Segmented<Filter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'pending', label: `Pending${counts.pending ? ` · ${counts.pending}` : ''}` },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'cancelled', label: 'Cancelled' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Select value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} placeholder="All types" className="h-10 w-auto min-w-[140px] py-0 text-sm" aria-label="Leave type" />
            <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[150px] py-0 text-sm" aria-label="Department" />
            {manage && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setApplying(true)}>
                Apply on behalf
              </Button>
            )}
          </>
        }
        empty={
          <div className="rounded-2xl border border-dashed border-indigo-200 bg-white/60 px-6 py-10 text-center">
            <p className="font-display text-[15px] font-semibold text-ink">{filter === 'pending' ? 'No pending leave requests' : 'No requests match'}</p>
            <p className="mt-1 text-[13px] text-ink-soft">Requests from My leaves land here for review.</p>
          </div>
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <EmployeeCell id={r.employee_id} sub="department" />
              </div>
              {statusCell(r)}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <LeaveTypeChip type={typeOf.get(r.leave_type_id)} />
              <span className="font-semibold text-ink">{fmtLeaveDates(r)}</span>
              <span className="num text-ink-soft">· {num(r.days)} d</span>
            </div>
            <p className="text-[13px] text-ink-soft">“{r.reason}”</p>
            {actions(r)}
          </div>
        )}
      />
      <LeaveApplyModal open={applying} onClose={() => setApplying(false)} onBehalf />
      <ApproveLeaveModal req={approving} onClose={() => setApproving(null)} />
    </>
  )
}

function ApproveLeaveModal({ req, onClose }: { req: LeaveRequest | null; onClose: () => void }) {
  const L = useLookups()
  // re-evaluate when balances / requests change
  const requests = useTable('leave_requests')
  const balances = useTable('leave_balances')
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const p = useMemo(() => (req ? approvalPreview(req) : null), [req, requests, balances]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNote('')
    setAck(false)
  }, [req?.id])

  const approve = async () => {
    if (!req || !p) return
    setBusy(true)
    const ok = await guard(() => approveLeave(req, note, { allowNegative: ack }), `Leave approved for ${L.empName(req.employee_id)}`)
    setBusy(false)
    if (ok) onClose()
  }
  const blocked = !!p?.clash || (!!p?.goesNegative && !ack)

  return (
    <Modal
      open={!!req}
      onClose={onClose}
      size="sm"
      title="Approve leave"
      subtitle={req ? `${L.empName(req.employee_id)} · ${fmtLeaveDates(req)}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={approve} loading={busy} disabled={blocked}>
            Approve
          </Button>
        </>
      }
    >
      {req && p && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LeaveTypeChip type={p.type} label={p.type ? `${p.type.code} · ${p.type.name}` : undefined} />
            <span className="num text-sm font-semibold text-ink">{num(req.days)} day{req.days === 1 ? '' : 's'}</span>
            <span className="text-[12.5px] text-ink-soft">FY {fyLabel(fyOf(req.from_date))}</span>
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-ink-soft">“{req.reason}”</p>
          {p.unlimited ? (
            <p className="text-[13px] text-ink-soft">Leave without pay has no balance — these days are deducted as LOP in payroll.</p>
          ) : (
            <div className="rounded-2xl border border-indigo-100 bg-white">
              {[
                ['Entitled (opening + allotted + adjustment)', num(p.entitled)],
                ['Already used', num(p.used)],
                ['Available now', num(p.before)],
                ['This request', `− ${num(req.days)}`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-indigo-50 px-3.5 py-2 text-[13px]">
                  <span className="text-ink-soft">{k}</span>
                  <span className="num font-semibold text-ink">{v}</span>
                </div>
              ))}
              <div className={cn('flex items-center justify-between gap-3 rounded-b-2xl px-3.5 py-2.5', p.goesNegative ? 'bg-rose-50' : 'bg-emerald-50/70')}>
                <span className="text-[13px] font-semibold text-ink">Balance after approval</span>
                <span className={cn('num font-display text-[18px] font-bold', p.goesNegative ? 'text-rose-600' : 'text-emerald-700')}>{num(p.after)}</span>
              </div>
            </div>
          )}
          {!p.unlimited && p.otherPending > 0 && (
            <p className="text-[12.5px] text-ink-soft">
              {num(p.otherPending)} more day{p.otherPending === 1 ? ' is' : 's are'} pending in other requests{p.afterAllPending < 0 ? ' — approving all of them would exceed the balance.' : '.'}
            </p>
          )}
          {p.clash && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[12.5px] font-medium text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Overlaps an approved leave ({fmtLeaveDates(p.clash)}). Cancel that one first.
            </p>
          )}
          {p.goesNegative && !p.clash && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-start gap-2 text-[12.5px] font-medium text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> The {p.type?.code} balance goes negative ({num(p.after)}). It will be adjusted against next year’s credit or treated as LOP by HR.
              </p>
              <Checkbox className="mt-2.5" checked={ack} onChange={setAck} label="I understand — approve anyway" />
            </div>
          )}
          <Field label="Note to employee (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Enjoy the break!" />
          </Field>
        </div>
      )}
    </Modal>
  )
}
