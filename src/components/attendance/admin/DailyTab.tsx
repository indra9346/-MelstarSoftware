/**
 * Daily sheet — everyone employed on a date with the derived day status, punch times, worked, late, OT.
 * attendance.manage can mark / edit / delete the day's record.
 */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { AttendanceRecord, Employee, ISODate } from '@/data/types'
import { DAY_STATUS_META, resolveDay, type DayInfo, type DayStatus } from '@/lib/attendance'
import { addDays, fmtDay, fmtDuration, fmtTime } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { deleteAttendance, isEmployedOn } from '@/services/attendance'
import { Badge, Button, confirm, DataTable, Input, Menu, Select, toast, type Column } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { DayStatusChip, DAY_STATUS_ORDER, OtBadge, SourceBadge, useAttendanceContext, useToday } from '../shared'
import type { MarkTarget } from '../MarkAttendanceModal'

interface Row {
  emp: Employee
  day: DayInfo
  rec?: AttendanceRecord
}

export function DailyTab({ onMark }: { onMark: (t: MarkTarget) => void }) {
  const s = useSession()
  const L = useLookups()
  const today = useToday()
  const ctx = useAttendanceContext(today)
  const employees = useTable('employees')
  const departments = useTable('departments')
  const [date, setDate] = useState<ISODate>(today)
  const [dept, setDept] = useState('')
  const [status, setStatus] = useState<DayStatus | ''>('')
  const manage = s.can('attendance.manage')
  const safeDate = date && date <= today ? date : today

  const all = useMemo<Row[]>(
    () =>
      employees
        .filter((e) => isEmployedOn(e, safeDate))
        .map((emp) => ({ emp, day: resolveDay(emp, safeDate, ctx), rec: ctx.records.get(`${emp.id}|${safeDate}`) }))
        .sort((a, b) => fullName(a.emp).localeCompare(fullName(b.emp))),
    [employees, safeDate, ctx],
  )
  const byDept = dept ? all.filter((r) => r.emp.department_id === dept) : all
  const rows = status ? byDept.filter((r) => r.day.status === status) : byDept
  const counts = useMemo(() => {
    const m = new Map<DayStatus, number>()
    for (const r of byDept) m.set(r.day.status, (m.get(r.day.status) ?? 0) + 1)
    return m
  }, [byDept])

  const remove = async (rec: AttendanceRecord) => {
    const ok = await confirm({ title: 'Delete this record?', message: `${L.empName(rec.employee_id)} · ${fmtDay(rec.date)} (${rec.source}). The day will be re-derived (absent / leave / holiday).`, danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    try {
      deleteAttendance(rec)
      toast.success('Record deleted')
    } catch (e) {
      toast.error('Could not delete', e instanceof Error ? e.message : String(e))
    }
  }

  const actions = (r: Row) =>
    manage ? (
      <Menu
        items={[
          { label: r.rec ? 'Edit record' : 'Mark attendance', icon: <Pencil />, onClick: () => onMark({ employeeId: r.emp.id, date: safeDate }) },
          ...(r.rec ? [{ label: 'Delete record', icon: <Trash2 />, danger: true, onClick: () => void remove(r.rec!) }] : []),
        ]}
      />
    ) : null

  const columns: Column<Row>[] = [
    { key: 'emp', header: 'Employee', cell: (r) => <EmployeeCell id={r.emp.id} sub="code" />, value: (r) => fullName(r.emp), exportValue: (r) => `${fullName(r.emp)} (${r.emp.emp_code})` },
    { key: 'dept', header: 'Department', value: (r) => L.deptName(r.emp.department_id), hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (r) => <DayStatusChip status={r.day.status} />, value: (r) => DAY_STATUS_META[r.day.status].label },
    { key: 'in', header: 'In', cell: (r) => <span className="num">{fmtTime(r.rec?.check_in)}</span>, value: (r) => r.rec?.check_in ?? null, exportValue: (r) => (r.rec?.check_in ? fmtTime(r.rec.check_in) : '') },
    { key: 'out', header: 'Out', cell: (r) => <span className="num">{fmtTime(r.rec?.check_out)}</span>, value: (r) => r.rec?.check_out ?? null, exportValue: (r) => (r.rec?.check_out ? fmtTime(r.rec.check_out) : '') },
    { key: 'worked', header: 'Worked', align: 'right', cell: (r) => (r.rec?.check_out ? fmtDuration(r.rec.worked_minutes) : r.rec?.check_in ? <span className="text-[12px] text-emerald-600">in progress</span> : '—'), value: (r) => r.rec?.worked_minutes ?? 0, exportValue: (r) => (r.rec?.check_out ? fmtDuration(r.rec.worked_minutes) : '') },
    { key: 'late', header: 'Late', align: 'right', cell: (r) => (r.rec?.late_minutes ? <Badge tone="amber">{fmtDuration(r.rec.late_minutes)}</Badge> : <span className="text-ink-faint">—</span>), value: (r) => r.rec?.late_minutes ?? 0 },
    { key: 'ot', header: 'OT', align: 'right', cell: (r) => <OtBadge minutes={r.rec?.ot_minutes ?? 0} status={r.rec?.ot_status ?? 'none'} />, value: (r) => r.rec?.ot_minutes ?? 0, exportValue: (r) => (r.rec?.ot_minutes ? `${fmtDuration(r.rec.ot_minutes)} (${r.rec.ot_status})` : '') },
    { key: 'source', header: 'Source', cell: (r) => (r.rec ? <SourceBadge source={r.rec.source} /> : <span className="text-ink-faint">—</span>), value: (r) => r.rec?.source ?? '', hideOnMobile: true },
    ...(manage ? [{ key: 'act', header: '', export: false, sortable: false, cell: actions, className: 'w-10' } satisfies Column<Row>] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="secondary" onClick={() => setDate(addDays(safeDate, -1))} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input type="date" value={safeDate} max={today} onChange={(e) => setDate(e.target.value || today)} className="h-10 w-[160px] py-0" aria-label="Date" />
          <Button size="icon" variant="secondary" disabled={safeDate >= today} onClick={() => setDate(addDays(safeDate, 1))} aria-label="Next day">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {safeDate !== today && (
          <Button size="sm" variant="ghost" onClick={() => setDate(today)}>
            Today
          </Button>
        )}
        <p className="ml-auto text-[13px] font-medium text-ink-soft">{fmtDay(safeDate)}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {DAY_STATUS_ORDER.filter((st) => counts.get(st)).map((st) => {
          const m = DAY_STATUS_META[st]
          const on = status === st
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatus(on ? '' : st)}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition', on ? 'ring-2' : 'ring-transparent hover:ring-brand-200')}
              style={{ background: m.bg === 'transparent' ? '#f8fafc' : m.bg, color: m.color, ...(on ? { boxShadow: `inset 0 0 0 2px ${m.color}` } : {}) }}
            >
              {m.label}
              <span className="num rounded-full bg-white px-1.5">{counts.get(st)}</span>
            </button>
          )
        })}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.emp.id}
        searchText={(r) => `${fullName(r.emp)} ${r.emp.emp_code} ${L.deptName(r.emp.department_id)}`}
        searchPlaceholder="Search name or code…"
        exportName={`attendance-${safeDate}`}
        exportSubtitle={fmtDay(safeDate)}
        pageSize={50}
        toolbar={
          <>
            <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[160px] py-0 text-sm" aria-label="Department" />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as DayStatus | '')}
              options={DAY_STATUS_ORDER.filter((st) => st !== 'upcoming').map((st) => ({ value: st, label: DAY_STATUS_META[st].label }))}
              placeholder="All statuses"
              className="h-10 w-auto min-w-[140px] py-0 text-sm"
              aria-label="Status"
            />
          </>
        }
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <EmployeeCell id={r.emp.id} sub="code" />
              </div>
              {actions(r)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <DayStatusChip status={r.day.status} />
              {r.rec?.late_minutes ? <Badge tone="amber">Late {fmtDuration(r.rec.late_minutes)}</Badge> : null}
              {r.rec && <SourceBadge source={r.rec.source} />}
              {r.rec?.ot_minutes ? <OtBadge minutes={r.rec.ot_minutes} status={r.rec.ot_status} /> : null}
            </div>
            {r.rec?.check_in && (
              <p className="num text-[12.5px] text-ink-soft">
                {fmtTime(r.rec.check_in)} → {fmtTime(r.rec.check_out)} {r.rec.check_out && <>· {fmtDuration(r.rec.worked_minutes)}</>}
              </p>
            )}
          </div>
        )}
      />
    </div>
  )
}
