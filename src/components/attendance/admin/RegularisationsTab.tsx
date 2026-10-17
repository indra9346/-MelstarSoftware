/**
 * Attendance corrections requested by employees — pending first. Approving rewrites that day's
 * attendance row (source 'regularised') with computePunch.
 */
import { useMemo, useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import { useTable } from '@/data/store'
import type { ApprovalStatus, Regularisation } from '@/data/types'
import { DAY_STATUS_META } from '@/lib/attendance'
import { fmtDay, fmtHHMM, fmtTime, relativeTime } from '@/lib/dates'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { approveRegularisation, describeRegularisation, rejectRegularisation } from '@/services/attendance'
import { Button, confirmWithNote, DataTable, guard, Segmented, Select, StatusBadge, type Column } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'

type Filter = ApprovalStatus | 'all'

export function RegularisationsTab() {
  const s = useSession()
  const L = useLookups()
  const regs = useTable('regularisations')
  const attendance = useTable('attendance')
  const departments = useTable('departments')
  const [filter, setFilter] = useState<Filter>('pending')
  const [dept, setDept] = useState('')
  const manage = s.can('attendance.manage')

  const recordOf = useMemo(() => new Map(attendance.map((a) => [`${a.employee_id}|${a.date}`, a])), [attendance])
  const counts = useMemo(() => ({ pending: regs.filter((r) => r.status === 'pending').length, approved: regs.filter((r) => r.status === 'approved').length, rejected: regs.filter((r) => r.status === 'rejected').length }), [regs])
  const rows = useMemo(() => {
    const rank = (r: Regularisation) => (r.status === 'pending' ? 0 : 1)
    return regs
      .filter((r) => (filter === 'all' || r.status === filter) && (!dept || L.emp.get(r.employee_id)?.department_id === dept))
      .sort((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
  }, [regs, filter, dept, L])

  const approve = async (r: Regularisation) => {
    const res = await confirmWithNote({
      title: 'Approve correction',
      message: `${L.empName(r.employee_id)} · ${fmtDay(r.date)} will be set to ${describeRegularisation(r)}. Late, worked hours and OT are recalculated with the shift rules.`,
      input: { label: 'Note to employee (optional)' },
      confirmLabel: 'Approve',
    })
    if (res.ok) await guard(() => approveRegularisation(r, res.note), 'Correction approved — attendance updated')
  }
  const reject = async (r: Regularisation) => {
    const res = await confirmWithNote({ title: 'Reject correction', message: `${L.empName(r.employee_id)} · ${fmtDay(r.date)}`, input: { label: 'Reason (shown to the employee)', required: true }, confirmLabel: 'Reject', danger: true })
    if (res.ok) await guard(() => rejectRegularisation(r, res.note), 'Correction rejected')
  }

  const actions = (r: Regularisation) =>
    manage && r.status === 'pending' ? (
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => void reject(r)}>
          Reject
        </Button>
        <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => void approve(r)}>
          Approve
        </Button>
      </div>
    ) : null

  const recorded = (r: Regularisation) => {
    const rec = recordOf.get(`${r.employee_id}|${r.date}`)
    if (!rec) return <span className="text-ink-faint">No punch</span>
    return (
      <span className="num whitespace-nowrap text-ink-soft">
        {fmtTime(rec.check_in)} – {fmtTime(rec.check_out)}
      </span>
    )
  }
  const requested = (r: Regularisation) => (
    <span className="whitespace-nowrap">
      <span className="font-semibold" style={{ color: DAY_STATUS_META[r.requested_status].color }}>
        {DAY_STATUS_META[r.requested_status].label}
      </span>
      <span className="num text-ink">
        {' '}
        · {r.requested_check_in ? fmtHHMM(r.requested_check_in) : 'keep'} – {r.requested_check_out ? fmtHHMM(r.requested_check_out) : 'keep'}
      </span>
    </span>
  )

  const columns: Column<Regularisation>[] = [
    { key: 'emp', header: 'Employee', cell: (r) => <EmployeeCell id={r.employee_id} sub="code" />, value: (r) => L.empName(r.employee_id) },
    { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDay(r.date)}</span>, value: (r) => r.date },
    { key: 'rec', header: 'Recorded', cell: recorded, exportValue: (r) => { const rec = recordOf.get(`${r.employee_id}|${r.date}`); return rec ? `${fmtTime(rec.check_in)} – ${fmtTime(rec.check_out)}` : 'No punch' }, sortable: false },
    { key: 'req', header: 'Requested', cell: requested, exportValue: (r) => describeRegularisation(r), sortable: false },
    { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-2 max-w-[260px] text-[13px] text-ink-soft" title={r.reason}>{r.reason}</span>, value: (r) => r.reason },
    { key: 'sub', header: 'Submitted', cell: (r) => <span className="whitespace-nowrap text-[12.5px] text-ink-soft">{relativeTime(r.created_at)}</span>, value: (r) => r.created_at, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <div className="min-w-0">
          <StatusBadge status={r.status} />
          {r.status !== 'pending' && (
            <p className="mt-0.5 max-w-[200px] truncate text-[11.5px] text-ink-faint" title={r.review_note}>
              {L.userName(r.reviewed_by) !== '—' ? L.userName(r.reviewed_by) : 'HR'}
              {r.review_note ? ` · ${r.review_note}` : ''}
            </p>
          )}
        </div>
      ),
      value: (r) => r.status,
    },
    ...(manage ? [{ key: 'act', header: '', export: false, sortable: false, cell: actions } satisfies Column<Regularisation>] : []),
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      searchText={(r) => `${L.empName(r.employee_id)} ${L.emp.get(r.employee_id)?.emp_code ?? ''} ${r.reason}`}
      searchPlaceholder="Search employee or reason…"
      exportName="attendance-corrections"
      toolbar={
        <>
          <Segmented<Filter>
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'pending', label: `Pending · ${counts.pending}` },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[160px] py-0 text-sm" aria-label="Department" />
        </>
      }
      empty={
        <div className="rounded-2xl border border-dashed border-indigo-200 bg-white/60 px-6 py-10 text-center">
          <p className="font-display text-[15px] font-semibold text-ink">{filter === 'pending' ? 'No pending corrections' : 'Nothing here'}</p>
          <p className="mt-1 text-[13px] text-ink-soft">Employees request corrections from My attendance when a punch is missing or wrong.</p>
        </div>
      }
      mobileCard={(r) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <EmployeeCell id={r.employee_id} sub="code" />
            </div>
            <StatusBadge status={r.status} />
          </div>
          <p className="text-[13px] font-semibold text-ink">{fmtDay(r.date)}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {recorded(r)}
            <ArrowRight className="h-3.5 w-3.5 text-ink-faint" />
            {requested(r)}
          </div>
          <p className="text-[13px] text-ink-soft">“{r.reason}”</p>
          {r.status !== 'pending' && r.review_note && <p className="text-[12px] text-ink-faint">HR: {r.review_note}</p>}
          {actions(r)}
        </div>
      )}
    />
  )
}
