import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'
import { useSettings, useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { DAY_STATUS_META, buildAttendanceContext, summariseMonth, type DayStatus } from '@/lib/attendance'
import { WEEKDAYS, addMonths, dayOfWeek, fmtDay, fmtDuration, fmtMonth, fmtTime, monthOf, monthStart, todayISO } from '@/lib/dates'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'

const LEGEND: DayStatus[] = ['present', 'half_day', 'absent', 'leave', 'half_leave', 'unpaid_leave', 'holiday', 'week_off']

/** Month calendar of derived day statuses + the payroll roll-up for one employee. */
export function AttendanceMonth({ employee }: { employee: Employee }) {
  const settings = useSettings()
  const attendance = useTable('attendance')
  const holidays = useTable('holidays')
  const leaveRequests = useTable('leave_requests')
  const leaveTypes = useTable('leave_types')
  const shifts = useTable('shifts')
  const today = todayISO()
  const thisMonth = monthOf(today)
  const [month, setMonth] = useState(thisMonth)
  const firstMonth = monthOf(employee.date_of_joining)
  const lastMonth = employee.date_of_exit && monthOf(employee.date_of_exit) < thisMonth ? monthOf(employee.date_of_exit) : thisMonth

  const ctx = useMemo(
    () =>
      buildAttendanceContext({
        holidays,
        attendance: attendance.filter((a) => a.employee_id === employee.id),
        leaveRequests: leaveRequests.filter((l) => l.employee_id === employee.id),
        leaveTypes,
        shifts,
        today,
      }),
    [holidays, attendance, leaveRequests, leaveTypes, shifts, employee.id, today],
  )
  const sum = useMemo(() => summariseMonth(employee, month, ctx, settings.attendance), [employee, month, ctx, settings.attendance])
  const lead = dayOfWeek(monthStart(month))
  const otHours = sum.ot_minutes_approved / 60

  const tiles: [string, string, string][] = [
    ['Paid days', num(sum.paid_days, 1), 'text-ink'],
    ['Present', num(sum.present, 1), 'text-emerald-600'],
    ['Paid leave', num(sum.paid_leave, 1), 'text-violet-600'],
    ['Absent', num(sum.absent, 1), 'text-rose-600'],
    ['LOP days', num(sum.lop_days, 1), 'text-rose-600'],
    ['Late marks', String(sum.late_marks), 'text-amber-600'],
    ['OT approved', `${num(otHours, 1)} h`, 'text-teal-700'],
    ['Hours worked', fmtDuration(sum.worked_minutes), 'text-ink'],
  ]

  return (
    <Card>
      <CardHeader
        title="Attendance"
        subtitle={`${fmtMonth(month)} · ${sum.working_days} working days${sum.late_penalty_days ? ` · ${sum.late_penalty_days} day late-mark penalty` : ''}`}
        icon={<CalendarDays className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="secondary" disabled={month <= firstMonth} onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={month === lastMonth} onClick={() => setMonth(lastMonth)}>
              {month === thisMonth ? 'This month' : 'Latest'}
            </Button>
            <Button size="icon-sm" variant="secondary" disabled={month >= lastMonth} onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <CardBody>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map(([k, v, tone]) => (
            <div key={k} className="min-w-0 rounded-md border border-line bg-white px-3 py-2">
              <p className="truncate text-[11.5px] font-semibold text-ink-soft">{k}</p>
              <p className={cn('num text-lg font-semibold', tone)}>{v}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-1 text-center text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
              <span className="xs:hidden">{d.slice(0, 1)}</span>
              <span className="hidden xs:inline">{d}</span>
            </div>
          ))}
        </div>
          <div key={month} className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {Array.from({ length: lead }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {sum.days.map((d) => {
              const meta = DAY_STATUS_META[d.status]
              const day = Number(d.date.slice(8))
              const title = [
                fmtDay(d.date),
                meta.label,
                d.holiday?.name,
                d.leaveType?.name,
                d.record?.check_in ? `In ${fmtTime(d.record.check_in)}` : null,
                d.record?.check_out ? `Out ${fmtTime(d.record.check_out)}` : null,
                d.late ? `Late ${d.record?.late_minutes} min` : null,
                d.record?.ot_minutes ? `OT ${fmtDuration(d.record.ot_minutes)} (${d.record.ot_status})` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <div
                  key={d.date}
                  title={title}
                  className={cn('relative flex h-12 min-w-0 flex-col items-center justify-center rounded-md sm:h-16 sm:rounded-md', d.date === today && 'ring-2 ring-brand-600 ring-offset-1')}
                  style={{ background: meta.bg === 'transparent' ? 'rgba(255,255,255,.55)' : meta.bg, color: meta.color }}
                >
                  <span className="absolute left-1 top-0.5 text-[10px] font-semibold opacity-70 sm:left-1.5 sm:top-1 sm:text-[11px]">{day}</span>
                  <span className="mt-1.5 text-[11px] font-semibold sm:text-[13px]">{meta.short}</span>
                  {d.record?.check_in && <span className="hidden text-[10px] font-medium opacity-80 sm:block">{fmtTime(d.record.check_in).replace(' ', '')}</span>}
                  {d.late && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                </div>
              )
            })}
          </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {LEGEND.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-soft">
              <span className="h-3 w-3 rounded" style={{ background: DAY_STATUS_META[k].bg, boxShadow: `inset 0 0 0 1px ${DAY_STATUS_META[k].color}33` }} />
              {DAY_STATUS_META[k].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Late
          </span>
        </div>
      </CardBody>
    </Card>
  )
}
