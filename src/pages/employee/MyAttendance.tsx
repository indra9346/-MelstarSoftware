import { useMemo, useState } from 'react'
import { AlarmClock, CalendarCheck2, CalendarClock, FilePenLine, History, Timer, Undo2, UserX, Wallet } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Employee, ISODate, Regularisation, YearMonth } from '@/data/types'
import { DAY_STATUS_META, summariseMonth, type DayInfo } from '@/lib/attendance'
import { addDays, currentMonth, fmtDay, fmtDuration, fmtHHMM, fmtMonth, fmtTime, monthOf, relativeTime } from '@/lib/dates'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useSession } from '@/services/session'
import { earliestAttendanceDate, REGULARISATION_WINDOW_DAYS, withdrawRegularisation } from '@/services/attendance'
import { Badge, Button, Card, CardBody, CardHeader, confirm, EmptyState, guard, InfoGrid, Modal, PageHeader, StatCard, StatusBadge } from '@/components/ui'
import { CheckInCard } from '@/components/attendance/CheckInCard'
import { MonthGrid, MonthNav } from '@/components/attendance/MonthCalendar'
import { RegularisationModal } from '@/components/attendance/RegularisationModal'
import { DayStatusChip, GeoBadge, OtBadge, SourceBadge, StatusLegend, useAttendanceContext, useToday } from '@/components/attendance/shared'

export default function MyAttendancePage() {
  const s = useSession()
  if (!s.employee)
    return (
      <div>
        <PageHeader kicker="Self-service" title="My attendance" />
        <EmptyState icon={<UserX className="h-6 w-6" />} title="No employee profile linked" description="Your login isn’t linked to an employee record, so there is no attendance to show. Ask HR to link it." />
      </div>
    )
  return <MyAttendance emp={s.employee} />
}

function MyAttendance({ emp }: { emp: Employee }) {
  const settings = useSettings()
  const today = useToday()
  const ctx = useAttendanceContext(today)
  const attendance = useTable('attendance')
  const regs = useTable('regularisations')
  const [month, setMonth] = useState<YearMonth>(currentMonth())
  const [detail, setDetail] = useState<DayInfo | null>(null)
  const [reg, setReg] = useState<{ date?: ISODate } | null>(null)

  const minMonth = useMemo(() => {
    const earliest = earliestAttendanceDate()
    const fromData = earliest ? monthOf(earliest) : currentMonth()
    const joined = monthOf(emp.date_of_joining)
    return joined > fromData ? joined : fromData
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance, emp.date_of_joining])

  const summary = useMemo(() => summariseMonth(emp, month, ctx, settings.attendance), [emp, month, ctx, settings.attendance])
  const isCurrent = month === currentMonth()
  const history = useMemo(() => attendance.filter((a) => a.employee_id === emp.id && monthOf(a.date) === month).sort((a, b) => b.date.localeCompare(a.date)), [attendance, emp.id, month])
  const myRegs = useMemo(() => regs.filter((r) => r.employee_id === emp.id).sort((a, b) => b.created_at.localeCompare(a.created_at)), [regs, emp.id])
  const pendingRegDates = useMemo(() => new Set(myRegs.filter((r) => r.status === 'pending').map((r) => r.date)), [myRegs])
  const minRegDate = addDays(today, -REGULARISATION_WINDOW_DAYS)
  const canCorrect = (d: ISODate) => d <= today && d >= minRegDate && d >= emp.date_of_joining && !pendingRegDates.has(d)

  const withdraw = async (r: Regularisation) => {
    const ok = await confirm({ title: 'Withdraw this request?', message: `Your correction request for ${fmtDay(r.date)} will be deleted.`, confirmLabel: 'Withdraw', danger: true })
    if (ok) await guard(() => withdrawRegularisation(r), 'Request withdrawn')
  }

  const radius = settings.attendance.geofence_radius_m

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Self-service"
        title="My attendance"
        subtitle="Check in, see your month and request corrections."
        actions={
          <Button variant="secondary" icon={<FilePenLine className="h-4 w-4" />} onClick={() => setReg({})}>
            Request correction
          </Button>
        }
      />

      <CheckInCard employee={emp} />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">{fmtMonth(month)} at a glance</h2>
          <MonthNav month={month} onChange={setMonth} min={minMonth} max={currentMonth()} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Present" value={summary.present} format={(n) => num(Math.round(n * 2) / 2)} icon={<CalendarCheck2 className="h-4 w-4" />} accent="green" hint={summary.half_days ? `incl. ${summary.half_days} half day${summary.half_days === 1 ? '' : 's'}` : `of ${summary.working_days - summary.upcoming} working days`} />
          <StatCard label="Late marks" value={summary.late_marks} icon={<AlarmClock className="h-4 w-4" />} accent="amber" hint={summary.late_penalty_days ? `${num(summary.late_penalty_days)} day LOP penalty` : `${settings.attendance.late_marks_per_half_day} marks = ½ day LOP`} />
          <StatCard label="OT hours" value={summary.ot_minutes_approved / 60} format={(n) => num(Math.round(n * 10) / 10)} icon={<Timer className="h-4 w-4" />} accent="cyan" hint={summary.ot_minutes_pending ? `${num(Math.round((summary.ot_minutes_pending / 60) * 10) / 10)} h awaiting approval` : 'Approved'} />
          <StatCard label={isCurrent ? 'LOP so far' : 'LOP days'} value={summary.lop_days} format={(n) => num(Math.round(n * 10) / 10)} icon={<UserX className="h-4 w-4" />} accent="red" hint={summary.absent ? `${num(summary.absent)} absent · ${num(summary.unpaid_leave)} unpaid leave` : 'No absences'} />
          <StatCard label="Paid days" value={summary.paid_days} format={(n) => num(Math.round(n * 10) / 10)} icon={<Wallet className="h-4 w-4" />} accent="indigo" hint={isCurrent ? `of ${summary.employed_days} · rest of month projected` : `of ${summary.employed_days} days`} className="col-span-2 sm:col-span-1" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Calendar" subtitle="Tap a day for details" icon={<CalendarClock className="h-4 w-4" />} />
          <CardBody>
            <MonthGrid
              month={month}
              renderDay={(d) => {
                const info = summary.days.find((x) => x.date === d)!
                const m = DAY_STATUS_META[info.status]
                const muted = info.status === 'not_employed' || info.status === 'upcoming'
                return (
                  <button
                    type="button"
                    onClick={() => setDetail(info)}
                    disabled={info.status === 'not_employed'}
                    className={cn('relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-md border text-center transition sm:aspect-auto sm:h-16', muted ? 'border-line bg-white' : 'border-transparent', d === today && 'ring-2 ring-brand-600')}
                    style={muted ? undefined : { background: m.bg, color: m.color }}
                    title={`${fmtDay(d)} · ${m.label}`}
                  >
                    <span className={cn('num text-[13px] font-medium leading-none sm:text-[14px]', muted && 'text-ink-faint')}>{Number(d.slice(8))}</span>
                    {m.short && !muted && <span className="mt-0.5 text-[9.5px] font-semibold leading-none sm:mt-1 sm:text-[10.5px]">{m.short}</span>}
                    {info.late && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                    {pendingRegDates.has(d) && <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-brand-500" title="Correction pending" />}
                  </button>
                )
              }}
            />
            <StatusLegend className="mt-4" statuses={['present', 'half_day', 'on_duty', 'absent', 'leave', 'half_leave', 'unpaid_leave', 'holiday', 'week_off', 'today']} />
          </CardBody>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader
            title="My correction requests"
            subtitle={`Missed or wrong punches · last ${REGULARISATION_WINDOW_DAYS} days`}
            icon={<FilePenLine className="h-4 w-4" />}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setReg({})}>
                New
              </Button>
            }
          />
          <CardBody>
            {!myRegs.length ? (
              <EmptyState title="No requests yet" description="If the biometric missed you or you forgot to check out, request a correction here." />
            ) : (
              <ul className="space-y-2.5">
                {myRegs.slice(0, 12).map((r) => (
                  <li key={r.id} className="rounded-lg border border-line bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium text-ink">{fmtDay(r.date)}</p>
                        <p className="num text-[12.5px] text-ink-soft">
                          {DAY_STATUS_META[r.requested_status].label} · {r.requested_check_in ? fmtHHMM(r.requested_check_in) : 'keep'} – {r.requested_check_out ? fmtHHMM(r.requested_check_out) : 'keep'}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] text-ink-soft">“{r.reason}”</p>
                    {r.review_note && <p className="mt-1 text-[12px] text-ink-faint">HR: {r.review_note}</p>}
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-ink-faint">Sent {relativeTime(r.created_at)}</span>
                      {r.status === 'pending' && (
                        <Button size="sm" variant="ghost" className="h-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => void withdraw(r)}>
                          Withdraw
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader title="Punch history" subtitle={`${history.length} record${history.length === 1 ? '' : 's'} in ${fmtMonth(month)}`} icon={<History className="h-4 w-4" />} />
        <CardBody>
          {!history.length ? (
            <EmptyState title="No punches this month" />
          ) : (
            <ul className="divide-y divide-line">
              {history.map((r) => {
                const info = summary.days.find((x) => x.date === r.date)
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                    <button type="button" onClick={() => info && setDetail(info)} className="w-[96px] shrink-0 text-left text-[13px] font-medium text-ink hover:text-brand-600">
                      {fmtDay(r.date)}
                    </button>
                    <span className="num min-w-0 flex-1 text-[13px] text-ink">
                      {fmtTime(r.check_in)} <span className="text-ink-faint">→</span> {fmtTime(r.check_out)}
                      {r.check_out && <span className="ml-2 text-ink-soft">{fmtDuration(r.worked_minutes)}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {info && info.status !== 'present' && <DayStatusChip status={info.status} />}
                      {r.late_minutes > 0 && <Badge tone="amber">Late {fmtDuration(r.late_minutes)}</Badge>}
                      {r.ot_minutes > 0 && <OtBadge minutes={r.ot_minutes} status={r.ot_status} />}
                      <SourceBadge source={r.source} />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="sm"
        title={detail ? fmtDay(detail.date) : ''}
        footer={
          detail && detail.date <= today ? (
            canCorrect(detail.date) ? (
              <Button
                icon={<FilePenLine className="h-4 w-4" />}
                onClick={() => {
                  setReg({ date: detail.date })
                  setDetail(null)
                }}
              >
                Request correction
              </Button>
            ) : (
              <p className="mr-auto text-[12.5px] text-ink-soft">{pendingRegDates.has(detail.date) ? 'A correction for this day is already pending.' : `Corrections are possible for the last ${REGULARISATION_WINDOW_DAYS} days — contact HR for older days.`}</p>
            )
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <DayStatusChip status={detail.status} late={detail.late} />
            {detail.holiday && <p className="text-[13px] font-medium text-sky-700">{detail.holiday.name}</p>}
            {detail.leave && (
              <p className="rounded-md bg-violet-50 px-3 py-2 text-[13px] text-violet-800">
                {detail.leaveType?.name ?? 'Leave'}
                {detail.leave.half_day ? ` · ${detail.leave.half_day_session === 'first' ? 'first' : 'second'} half` : ''} — “{detail.leave.reason}”
              </p>
            )}
            {(() => {
              const rec = detail.record ?? ctx.records.get(`${emp.id}|${detail.date}`)
              if (!rec) return <p className="text-[13px] text-ink-soft">{detail.status === 'upcoming' ? 'This day hasn’t happened yet.' : 'No punch recorded for this day.'}</p>
              return (
                <>
                  <InfoGrid
                    items={[
                      ['Check-in', fmtTime(rec.check_in)],
                      ['Check-out', fmtTime(rec.check_out)],
                      ['Worked', rec.check_out ? fmtDuration(rec.worked_minutes) : rec.check_in ? 'In progress' : '—'],
                      ['Late', rec.late_minutes ? fmtDuration(rec.late_minutes) : 'On time'],
                      ['Early exit', rec.early_exit_minutes ? fmtDuration(rec.early_exit_minutes) : '—'],
                      ['Overtime', rec.ot_minutes ? <OtBadge minutes={rec.ot_minutes} status={rec.ot_status} /> : '—'],
                      ['Source', <SourceBadge source={rec.source} />],
                      ['Location', rec.source === 'web' || rec.source === 'mobile' ? <GeoBadge distance={rec.check_in_distance_m} radius={radius} /> : '—'],
                    ]}
                  />
                  {rec.remarks && <p className="rounded-md bg-slate-50 px-3 py-2 text-[12.5px] text-ink-soft">{rec.remarks}</p>}
                </>
              )
            })()}
            {myRegs
              .filter((r) => r.date === detail.date)
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-[12.5px]">
                  <span className="text-ink-soft">Correction requested {relativeTime(r.created_at)}</span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
          </div>
        )}
      </Modal>

      <RegularisationModal open={!!reg} onClose={() => setReg(null)} employee={emp} date={reg?.date} />
    </div>
  )
}
