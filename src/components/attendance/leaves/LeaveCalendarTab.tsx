/**
 * Team leave calendar — approved (solid) and pending (striped) leave per working day, coloured by type,
 * with plant holidays. Phones get a day-by-day list instead of the grid.
 */
import { useMemo, useState } from 'react'
import { CalendarOff, CalendarX2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Employee, Holiday, ISODate, LeaveRequest, LeaveType, YearMonth } from '@/data/types'
import { currentMonth, dayOfWeek, fmtDay, monthDates, monthEnd, monthStart } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useLookups } from '@/hooks/useLookups'
import { fmtLeaveDates } from '@/services/leaves'
import { Badge, EmptyState, Modal, Select, Switch } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { MonthGrid, MonthNav } from '../MonthCalendar'
import { LeaveTypeChip, Swatch, useToday } from '../shared'

interface Entry {
  req: LeaveRequest
  emp: Employee
  type: LeaveType | undefined
}

export function LeaveCalendarTab() {
  const L = useLookups()
  const today = useToday()
  const mobile = useIsMobile()
  const requests = useTable('leave_requests')
  const types = useTable('leave_types')
  const holidays = useTable('holidays')
  const shifts = useTable('shifts')
  const departments = useTable('departments')
  const [month, setMonth] = useState<YearMonth>(currentMonth())
  const [dept, setDept] = useState('')
  const [type, setType] = useState('')
  const [pending, setPending] = useState(true)
  const [day, setDay] = useState<ISODate | null>(null)

  const typeOf = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const plantHolidays = useMemo(() => new Set(holidays.filter((h) => h.type !== 'optional').map((h) => h.date)), [holidays])
  const holidayByDate = useMemo(() => {
    const m = new Map<ISODate, Holiday[]>()
    for (const h of holidays) m.set(h.date, [...(m.get(h.date) ?? []), h])
    return m
  }, [holidays])

  const byDate = useMemo(() => {
    const from = monthStart(month)
    const to = monthEnd(month)
    const m = new Map<ISODate, Entry[]>()
    for (const req of requests) {
      if (req.status !== 'approved' && !(pending && req.status === 'pending')) continue
      if (req.to_date < from || req.from_date > to) continue
      if (type && req.leave_type_id !== type) continue
      const emp = L.emp.get(req.employee_id)
      if (!emp || (dept && emp.department_id !== dept)) continue
      const offs = shifts.find((s) => s.id === emp.shift_id)?.weekly_offs ?? [0]
      for (const d of monthDates(month)) {
        if (d < req.from_date || d > req.to_date) continue
        if (offs.includes(dayOfWeek(d)) || plantHolidays.has(d)) continue // not a leave day
        m.set(d, [...(m.get(d) ?? []), { req, emp, type: typeOf.get(req.leave_type_id) }])
      }
    }
    for (const list of m.values()) list.sort((a, b) => Number(a.req.status === 'pending') - Number(b.req.status === 'pending') || fullName(a.emp).localeCompare(fullName(b.emp)))
    return m
  }, [requests, pending, type, dept, month, L, shifts, plantHolidays, typeOf])

  const usedTypes = useMemo(() => {
    const ids = new Set<string>()
    for (const list of byDate.values()) for (const e of list) if (e.type) ids.add(e.type.id)
    return types.filter((t) => ids.has(t.id))
  }, [byDate, types])
  const totalPeople = useMemo(() => new Set([...byDate.values()].flat().map((e) => e.emp.id)).size, [byDate])
  const dayEntries = day ? byDate.get(day) ?? [] : []

  const chip = (e: Entry) => <LeaveTypeChip key={e.req.id} type={e.type} pending={e.req.status === 'pending'} label={`${e.emp.first_name}${e.req.half_day ? ' ½' : ''}`} className="w-full justify-start" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthNav month={month} onChange={setMonth} />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[150px] py-0 text-sm" aria-label="Department" />
        <Select value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} placeholder="All types" className="h-10 w-auto min-w-[130px] py-0 text-sm" aria-label="Leave type" />
        <div className="rounded-md border border-line bg-white px-3 py-2">
          <Switch checked={pending} onChange={setPending} label={<span className="text-[13px]">Show pending</span>} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {usedTypes.map((t) => (
          <Swatch key={t.id} color={t.color} label={t.name} />
        ))}
        {pending && <Swatch color="#2a56a1" striped label="Pending (striped)" />}
        <Swatch color="#0369a1" label="Plant holiday" />
        <span className="ml-auto text-[12.5px] font-medium text-ink-soft">{totalPeople} people on leave this month</span>
      </div>

      {mobile ? (
        <MobileList month={month} byDate={byDate} holidayByDate={holidayByDate} today={today} onDay={setDay} />
      ) : (
        <div className="card p-3 sm:p-4">
          <MonthGrid
            month={month}
            renderDay={(d) => {
              const list = byDate.get(d) ?? []
              const hols = holidayByDate.get(d) ?? []
              const closure = hols.find((h) => h.type !== 'optional')
              const sunday = dayOfWeek(d) === 0
              return (
                <button
                  type="button"
                  onClick={() => (list.length || hols.length) && setDay(d)}
                  className={cn(
                    'flex min-h-[104px] min-w-0 flex-col gap-1 rounded-md border p-1.5 text-left transition',
                    closure ? 'border-sky-200 bg-sky-50/70' : sunday ? 'border-slate-100 bg-slate-50/70' : 'border-line bg-white',
                    (list.length || hols.length) && 'hover:border-line-strong hover:border-line-strong',
                    d === today && 'ring-2 ring-brand-600/50',
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className={cn('num text-[12px] font-medium', d === today ? 'text-brand-600' : sunday ? 'text-rose-400' : 'text-ink-soft')}>{Number(d.slice(8))}</span>
                    {list.length > 0 && <span className="num rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700">{list.length}</span>}
                  </span>
                  {hols.map((h) => (
                    <span key={h.id} className={cn('truncate rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold', h.type === 'optional' ? 'border border-dashed border-sky-300 text-sky-700' : 'bg-sky-600 text-white')} title={`${h.name}${h.type === 'optional' ? ' (optional)' : ''}`}>
                      {h.name}
                    </span>
                  ))}
                  {list.slice(0, 3).map(chip)}
                  {list.length > 3 && <span className="text-[10.5px] font-semibold text-brand-600">+{list.length - 3} more</span>}
                </button>
              )
            }}
          />
        </div>
      )}

      <Modal open={!!day} onClose={() => setDay(null)} title={day ? fmtDay(day) : ''} subtitle={day ? `${dayEntries.length} on leave` : undefined} size="sm">
        {day && (
          <div className="space-y-3">
            {(holidayByDate.get(day) ?? []).map((h) => (
              <p key={h.id} className="flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-[13px] font-medium text-sky-800">
                <CalendarOff className="h-4 w-4" /> {h.name}
                {h.type === 'optional' && <Badge tone="sky">Optional</Badge>}
              </p>
            ))}
            {dayEntries.map((e) => (
              <div key={e.req.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2">
                <div className="min-w-0">
                  <EmployeeCell id={e.emp.id} sub="department" />
                  <p className="mt-1 pl-[42px] text-[12px] text-ink-soft">{fmtLeaveDates(e.req)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <LeaveTypeChip type={e.type} pending={e.req.status === 'pending'} />
                  {e.req.status === 'pending' && <span className="text-[11px] font-semibold text-amber-600">pending</span>}
                </div>
              </div>
            ))}
            {!dayEntries.length && !(holidayByDate.get(day) ?? []).length && <p className="text-sm text-ink-soft">Nobody is on leave.</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function MobileList({ month, byDate, holidayByDate, today, onDay }: { month: YearMonth; byDate: Map<ISODate, Entry[]>; holidayByDate: Map<ISODate, Holiday[]>; today: ISODate; onDay: (d: ISODate) => void }) {
  const days = monthDates(month).filter((d) => byDate.has(d) || holidayByDate.has(d))
  if (!days.length) return <EmptyState icon={<CalendarX2 className="h-6 w-6" />} title="No leave or holidays this month" />
  return (
    <ul className="space-y-2">
      {days.map((d) => {
        const list = byDate.get(d) ?? []
        const hols = holidayByDate.get(d) ?? []
        return (
          <li key={d}>
            <button type="button" onClick={() => onDay(d)} className={cn('flex w-full gap-3 rounded-lg border bg-white p-3 text-left shadow-sm', d === today ? 'border-brand-600/40' : 'border-line')}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-brand-50 text-center leading-tight">
                <span className="num text-[16px] font-semibold text-ink">{Number(d.slice(8))}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-ink-soft">{fmtDay(d)}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {hols.map((h) => (
                    <span key={h.id} className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', h.type === 'optional' ? 'border border-dashed border-sky-300 text-sky-700' : 'bg-sky-600 text-white')}>
                      {h.name}
                      {h.type === 'optional' ? ' (optional)' : ''}
                    </span>
                  ))}
                  {list.map((e) => (
                    <LeaveTypeChip key={e.req.id} type={e.type} pending={e.req.status === 'pending'} label={`${e.emp.first_name} · ${e.type?.code ?? ''}${e.req.half_day ? ' ½' : ''}`} />
                  ))}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
