/**
 * Overtime approvals. Only approved OT reaches payroll (summariseMonth → ot_minutes_approved).
 */
import { useMemo, useState } from 'react'
import { Check, Search, Timer, X } from 'lucide-react'
import { useTable } from '@/data/store'
import type { AttendanceRecord } from '@/data/types'
import { addDays, fmtDay, fmtDuration, fmtHHMM, fmtTime } from '@/lib/dates'
import { fullName, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { decideOvertime } from '@/services/attendance'
import { Badge, Button, Checkbox, confirm, DataTable, guard, Segmented, Select, type Column } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { OtBadge, useToday } from '../shared'

type View = 'pending' | 'approved' | 'rejected'

export function OvertimeTab() {
  const s = useSession()
  const L = useLookups()
  const today = useToday()
  const attendance = useTable('attendance')
  const departments = useTable('departments')
  const [view, setView] = useState<View>('pending')
  const [dept, setDept] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const manage = s.can('attendance.manage')
  const since = addDays(today, -60)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return attendance
      .filter((a) => a.ot_minutes > 0 && a.ot_status === view && (view === 'pending' || a.date >= since))
      .filter((a) => {
        const e = L.emp.get(a.employee_id)
        return (!dept || e?.department_id === dept) && (!needle || `${fullName(e)} ${e?.emp_code ?? ''}`.toLowerCase().includes(needle))
      })
      .sort((a, b) => b.date.localeCompare(a.date) || L.empName(a.employee_id).localeCompare(L.empName(b.employee_id)))
  }, [attendance, view, since, dept, q, L])

  const pendingAll = attendance.filter((a) => a.ot_status === 'pending' && a.ot_minutes > 0)
  const selected = rows.filter((r) => sel.has(r.id))
  const allOn = rows.length > 0 && selected.length === rows.length
  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const hours = (recs: AttendanceRecord[]) => recs.reduce((t, r) => t + r.ot_minutes, 0) / 60

  const decide = async (recs: AttendanceRecord[], decision: 'approved' | 'rejected') => {
    if (!recs.length) return
    if (recs.length > 1 || decision === 'rejected') {
      const ok = await confirm({
        title: `${decision === 'approved' ? 'Approve' : 'Reject'} ${recs.length} OT record${recs.length === 1 ? '' : 's'}?`,
        message: `${num(hours(recs))} h in total. ${decision === 'approved' ? 'Approved OT is paid in the month’s payroll.' : 'Rejected OT is not paid.'}`,
        confirmLabel: decision === 'approved' ? 'Approve' : 'Reject',
        danger: decision === 'rejected',
      })
      if (!ok) return
    }
    const done = await guard(() => decideOvertime(recs, decision), `${recs.length} OT record${recs.length === 1 ? '' : 's'} ${decision}`)
    if (done) setSel(new Set())
  }

  const columns: Column<AttendanceRecord>[] = [
    ...(manage && view === 'pending'
      ? [
          {
            key: 'sel',
            header: '',
            export: false,
            sortable: false,
            className: 'w-10',
            cell: (r: AttendanceRecord) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
              </span>
            ),
          } satisfies Column<AttendanceRecord>,
        ]
      : []),
    { key: 'emp', header: 'Employee', cell: (r) => <EmployeeCell id={r.employee_id} sub="code" />, value: (r) => L.empName(r.employee_id) },
    { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDay(r.date)}</span>, value: (r) => r.date },
    { key: 'end', header: 'Shift end', cell: (r) => <span className="num">{fmtHHMM(L.shift.get(r.shift_id)?.end_time)}</span>, value: (r) => L.shift.get(r.shift_id)?.end_time ?? '' },
    { key: 'out', header: 'Out time', cell: (r) => <span className="num">{fmtTime(r.check_out)}</span>, value: (r) => r.check_out ?? '', exportValue: (r) => fmtTime(r.check_out) },
    { key: 'worked', header: 'Worked', align: 'right', value: (r) => r.worked_minutes, cell: (r) => fmtDuration(r.worked_minutes), exportValue: (r) => fmtDuration(r.worked_minutes), hideOnMobile: true },
    { key: 'ot', header: 'OT h', align: 'right', value: (r) => r.ot_minutes, cell: (r) => <span className="num font-semibold text-ink">{num(r.ot_minutes / 60)} h</span>, exportValue: (r) => num(r.ot_minutes / 60) },
    ...(view !== 'pending' ? [{ key: 'st', header: 'Status', cell: (r: AttendanceRecord) => <OtBadge minutes={r.ot_minutes} status={r.ot_status} />, value: (r: AttendanceRecord) => r.ot_status } satisfies Column<AttendanceRecord>] : []),
    ...(manage && view === 'pending'
      ? [
          {
            key: 'act',
            header: '',
            export: false,
            sortable: false,
            cell: (r: AttendanceRecord) => (
              <div className="flex justify-end gap-1.5">
                <Button size="icon-sm" variant="secondary" onClick={() => void decide([r], 'rejected')} aria-label="Reject OT" title="Reject">
                  <X className="h-4 w-4" />
                </Button>
                <Button size="icon-sm" variant="success" onClick={() => void decide([r], 'approved')} aria-label="Approve OT" title="Approve">
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ),
          } satisfies Column<AttendanceRecord>,
        ]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary label="Pending records" value={String(pendingAll.length)} />
        <Summary label="Pending OT hours" value={`${num(hours(pendingAll))} h`} />
        <Summary label="Employees waiting" value={String(new Set(pendingAll.map((a) => a.employee_id)).size)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View>
          size="sm"
          value={view}
          onChange={(v) => {
            setView(v)
            setSel(new Set())
          }}
          options={[
            { value: 'pending', label: `Pending · ${pendingAll.length}` },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="field-input h-10 py-0 pl-9 text-sm" type="search" />
        </div>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[160px] py-0 text-sm" aria-label="Department" />
      </div>

      {manage && view === 'pending' && rows.length > 0 && (
        <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors', selected.length ? 'border-brand-200 bg-slate-50' : 'border-line bg-white')}>
          <Checkbox checked={allOn} onChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())} label={selected.length ? `${selected.length} selected · ${num(hours(selected))} h` : `Select all ${rows.length}`} />
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="secondary" disabled={!selected.length} icon={<X className="h-4 w-4" />} onClick={() => void decide(selected, 'rejected')}>
              Reject
            </Button>
            <Button size="sm" variant="success" disabled={!selected.length} icon={<Check className="h-4 w-4" />} onClick={() => void decide(selected, 'approved')}>
              Approve selected
            </Button>
          </div>
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        exportName={`overtime-${view}`}
        pageSize={50}
        empty={
          <div className="rounded-lg border border-dashed border-brand-200 bg-white px-6 py-10 text-center">
            <Timer className="mx-auto mb-2 h-6 w-6 text-brand-600" />
            <p className="text-[15px] font-semibold text-ink">{view === 'pending' ? 'No overtime waiting' : `No ${view} overtime in the last 60 days`}</p>
            <p className="mt-1 text-[13px] text-ink-soft">OT is recorded when someone checks out past their shift end (in 15-minute blocks).</p>
          </div>
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start gap-2.5">
              {manage && view === 'pending' && <Checkbox checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}
              <div className="min-w-0 flex-1">
                <EmployeeCell id={r.employee_id} sub="code" />
              </div>
              <Badge tone="cyan">{num(r.ot_minutes / 60)} h</Badge>
            </div>
            <p className="text-[12.5px] text-ink-soft">
              {fmtDay(r.date)} · shift ends {fmtHHMM(L.shift.get(r.shift_id)?.end_time)} · out {fmtTime(r.check_out)}
            </p>
            {manage && view === 'pending' ? (
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => void decide([r], 'rejected')}>
                  Reject
                </Button>
                <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => void decide([r], 'approved')}>
                  Approve
                </Button>
              </div>
            ) : (
              <OtBadge minutes={r.ot_minutes} status={r.ot_status} />
            )}
          </div>
        )}
      />
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="card min-w-0 px-4 py-3">
      <p className="text-[12px] font-medium text-ink-soft">{label}</p>
      <p className="num mt-0.5 text-[22px] font-semibold text-ink">{value}</p>
    </div>
  )
}
