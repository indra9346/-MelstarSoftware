/**
 * Check-in / check-out panel for the employee's own day. Reused by My attendance and the home page:
 *   <CheckInCard employee={session.employee} />
 * Live worked-time counter, shift, late indicator, distance from plant (geofence), friendly
 * blocked states on week-off / plant holiday / full-day approved leave.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { CalendarOff, CheckCircle2, Clock, Coffee, Crosshair, Fingerprint, Loader2, LogIn, LogOut, MapPin, Plane, ShieldAlert } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { resolveDay } from '@/lib/attendance'
import { addDays, combine, fmtDay, fmtDuration, fmtHHMM, fmtTime, minutesBetween } from '@/lib/dates'
import { cn, distanceMeters } from '@/lib/misc'
import { useNow } from '@/hooks/useClock'
import { checkIn, checkOut, getLocation, isEmployedOn } from '@/services/attendance'
import { Badge, confirm, toast } from '@/components/ui'
import { fmtDistance, useAttendanceContext, useToday } from './shared'

type Busy = null | 'locating' | 'in' | 'out' | 'probe'

export function CheckInCard({ employee, className }: { employee: Employee; className?: string }) {
  const settings = useSettings()
  const today = useToday()
  const ctx = useAttendanceContext(today)
  const attendance = useTable('attendance')
  const shifts = useTable('shifts')
  const [busy, setBusy] = useState<Busy>(null)
  const [probe, setProbe] = useState<{ distance: number; accuracy: number } | null | 'none'>(null)

  // Same rules as services/attendance todayRecord() / openRecord(), derived from the live table.
  const mine = useMemo(() => attendance.filter((a) => a.employee_id === employee.id), [attendance, employee.id])
  const record = mine.find((a) => a.date === today)
  const open = useMemo(() => {
    const cutoff = Date.now() - 20 * 3600_000
    return mine.filter((a) => !!a.check_in && !a.check_out && new Date(a.check_in).getTime() > cutoff).sort((a, b) => (b.check_in ?? '').localeCompare(a.check_in ?? ''))[0]
  }, [mine])
  const active = open ?? record
  const shift = shifts.find((s) => s.id === (active?.shift_id ?? employee.shift_id))
  const day = resolveDay(employee, today, ctx)
  const radius = settings.attendance.geofence_radius_m

  const state: 'in' | 'done' | 'ready' | 'blocked' = open ? 'in' : record?.check_out ? 'done' : record?.check_in ? 'in' : 'ready'
  const live = state === 'in'
  const now = useNow(live ? 1000 : 30_000)

  // Why the button is disabled (only when nothing is open — a punch that is open can always be closed).
  const block = useMemo(() => {
    if (state === 'in' || state === 'done') return null
    if (!isEmployedOn(employee, today)) return { icon: <ShieldAlert className="h-5 w-5" />, title: 'Not on rolls today', text: 'Your employment dates do not include today. Please contact HR.' }
    if (!shift) return { icon: <ShieldAlert className="h-5 w-5" />, title: 'No shift assigned', text: 'Ask HR to assign your shift before checking in.' }
    if (day.status === 'holiday') return { icon: <CalendarOff className="h-5 w-5" />, title: `Plant holiday · ${day.holiday?.name ?? ''}`, text: `The plant is closed today. Next working day: ${nextWorkingDay()}.` }
    if (day.status === 'week_off') return { icon: <Coffee className="h-5 w-5" />, title: 'Weekly off', text: `Your next shift is on ${nextWorkingDay()}.` }
    if (day.status === 'leave' || day.status === 'unpaid_leave') return { icon: <Plane className="h-5 w-5" />, title: `On ${day.leaveType?.name ?? 'leave'} today`, text: 'Full-day leave is approved, so no check-in is needed.' }
    if (!settings.attendance.allow_web_checkin) return { icon: <Fingerprint className="h-5 w-5" />, title: 'Use the biometric terminal', text: 'Web check-in is switched off for the plant.' }
    return null
    function nextWorkingDay() {
      let d = addDays(today, 1)
      for (let i = 0; i < 14; i++, d = addDays(d, 1)) {
        const info = resolveDay(employee, d, ctx)
        if (info.status !== 'holiday' && info.status !== 'week_off') return fmtDay(d)
      }
      return 'your next working day'
    }
  }, [state, employee, today, shift, day, settings.attendance.allow_web_checkin, ctx])

  const effective = block && state === 'ready' ? 'blocked' : state

  // timings
  const start = shift ? combine(active?.date ?? today, shift.start_time) : null
  let end = shift ? combine(active?.date ?? today, shift.end_time) : null
  if (start && end && end <= start) end = new Date(end.getTime() + 86_400_000)
  const span = active?.check_in ? Math.max(0, minutesBetween(active.check_in, active.check_out ?? now)) : 0
  const workedLive = active?.check_out ? active.worked_minutes : span > 300 && shift ? span - shift.break_minutes : span
  const secs = active?.check_in && !active.check_out ? Math.max(0, Math.floor((now.getTime() - new Date(active.check_in).getTime()) / 1000) % 60) : 0
  const lateNow = state === 'ready' && start && shift ? minutesBetween(start, now) : 0
  const runningLate = effective === 'ready' && shift ? lateNow > shift.grace_minutes : false
  const fullDay = shift?.full_day_minutes ?? 450
  const progress = Math.min(1, workedLive / fullDay)

  const doCheckIn = async () => {
    setBusy('locating')
    try {
      const geo = await getLocation()
      setBusy('in')
      const row = await checkIn(employee, geo)
      toast.success(`Checked in at ${fmtTime(row.check_in)}`, row.late_minutes > 0 ? `Late by ${fmtDuration(row.late_minutes)}` : undefined)
      if (row.check_in_distance_m != null && row.check_in_distance_m > radius) toast.warning('Outside the plant geofence', `${fmtDistance(row.check_in_distance_m)} from the plant. HR will see this flag.`)
      else if (!geo) toast.info('Location not captured', 'Allow location access so HR can verify on-site check-ins.')
    } catch (e) {
      toast.error('Could not check in', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const doCheckOut = async () => {
    if (end && now < end) {
      const left = minutesBetween(now, end)
      const ok = await confirm({ title: 'Check out early?', message: `Your shift ends at ${fmtTime(end.toISOString())}, ${fmtDuration(left)} from now. Leaving early is recorded as an early exit.`, confirmLabel: 'Check out' })
      if (!ok) return
    }
    setBusy('out')
    try {
      const row = await checkOut(employee)
      toast.success(`Checked out at ${fmtTime(row.check_out)}`, `Worked ${fmtDuration(row.worked_minutes)}${row.ot_minutes > 0 ? ` · ${fmtDuration(row.ot_minutes)} OT sent for approval` : ''}`)
    } catch (e) {
      toast.error('Could not check out', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const doProbe = async () => {
    setBusy('probe')
    const geo = await getLocation()
    setBusy(null)
    setProbe(geo ? { distance: distanceMeters(geo.lat, geo.lng, settings.plant_lat, settings.plant_lng), accuracy: geo.accuracy } : 'none')
  }

  const distance = active?.check_in_distance_m ?? (probe && probe !== 'none' ? probe.distance : null)

  return (
    <div className={cn('card', className)}>
      <div className="grid grid-cols-1 items-center gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="kicker">{fmtDay(today)}{shift ? ` · ${shift.name}` : ''}</p>
          <h2 className="mt-1 truncate text-[17px] font-semibold leading-tight text-ink">Today’s attendance</h2>
          {shift && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
              <Clock className="h-3.5 w-3.5" />
              {fmtHHMM(shift.start_time)} – {fmtHHMM(shift.end_time)}
              <span className="text-ink-faint">·</span> {shift.grace_minutes} min grace
              <span className="text-ink-faint">·</span> {shift.break_minutes} min break
            </p>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Tile label="Check-in" value={fmtTime(active?.check_in)} tone={active?.late_minutes ? 'amber' : 'default'} />
            <Tile label="Check-out" value={fmtTime(active?.check_out)} />
            <Tile
              label={live ? 'Worked · live' : 'Worked'}
              value={
                active?.check_in ? (
                  <>
                    {fmtDuration(workedLive)}
                    {live && <span className="ml-1 text-[11px] font-medium text-ink-faint">{String(secs).padStart(2, '0')}s</span>}
                  </>
                ) : (
                  '—'
                )
              }
              tone={live ? 'live' : 'default'}
            />
          </div>
          {active?.check_in && (
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200/80" title={`${Math.round(progress * 100)}% of a full day`}>
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${progress * 100}%` }} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {active && active.late_minutes > 0 && <Badge tone="amber" dot>Late by {fmtDuration(active.late_minutes)}</Badge>}
            {runningLate && <Badge tone="amber" dot>Shift started {fmtDuration(lateNow)} ago</Badge>}
            {effective === 'ready' && lateNow < 0 && <Badge tone="sky" dot>Shift starts in {fmtDuration(-lateNow)}</Badge>}
            {active?.check_out && active.ot_minutes > 0 && <Badge tone={active.ot_status === 'approved' ? 'green' : 'violet'} dot>OT {fmtDuration(active.ot_minutes)} · {active.ot_status}</Badge>}
            {active?.check_out && active.early_exit_minutes > 0 && <Badge tone="red" dot>Early exit {fmtDuration(active.early_exit_minutes)}</Badge>}
            {distance != null ? (
              <Badge tone={distance > radius ? 'red' : 'green'}>
                <MapPin className="-ml-0.5 mr-0.5 inline h-3 w-3" />
                {distance > radius ? `${fmtDistance(distance)} from plant · outside ${radius} m geofence` : `At plant · ${fmtDistance(distance)}`}
              </Badge>
            ) : active?.check_in && active.source !== 'biometric' ? (
              <Badge tone="slate">Location not captured</Badge>
            ) : null}
            {probe === 'none' && !active && <Badge tone="slate">Location unavailable</Badge>}
            {effective === 'ready' && probe === null && (
              <button type="button" onClick={doProbe} disabled={busy !== null} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                {busy === 'probe' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                Check my distance
              </button>
            )}
          </div>

          {block && effective === 'blocked' && (
            <div className="mt-4 flex items-start gap-3 rounded-md border border-line bg-slate-50 p-3">
              <span className="mt-0.5 shrink-0 text-ink-soft [&>svg]:h-[18px] [&>svg]:w-[18px]">{block.icon}</span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink">{block.title}</p>
                <p className="mt-0.5 text-[13px] text-ink-soft">{block.text}</p>
              </div>
            </div>
          )}
          {effective === 'done' && (
            <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Attendance complete for today.
            </p>
          )}
          {day.status === 'half_leave' && <p className="mt-3 text-[12.5px] text-violet-700">Half-day {day.leaveType?.name ?? 'leave'} approved for today ({day.leave?.half_day_session === 'first' ? 'first' : 'second'} half).</p>}
        </div>

        <div className="md:w-[200px]">
          <PunchButton state={effective} busy={busy} onIn={doCheckIn} onOut={doCheckOut} />
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'amber' | 'live' }) {
  return (
    <div className={cn('min-w-0 rounded-md border px-2.5 py-2 sm:px-3', tone === 'live' ? 'border-brand-200 bg-slate-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50/60' : 'border-line bg-white')}>
      <p className="truncate text-[12px] text-ink-soft">{label}</p>
      <p className="num mt-0.5 truncate text-[15px] font-semibold text-ink sm:text-[16px]">{value}</p>
    </div>
  )
}

function PunchButton({ state, busy, onIn, onOut }: { state: 'in' | 'done' | 'ready' | 'blocked'; busy: Busy; onIn: () => void; onOut: () => void }) {
  const working = busy === 'locating' || busy === 'in' || busy === 'out'
  const disabled = state === 'blocked' || state === 'done' || working
  const isOut = state === 'in'
  const label = busy === 'locating' ? 'Getting location…' : working ? 'Saving…' : state === 'done' ? 'Checked out' : state === 'blocked' ? 'Check-in unavailable' : isOut ? 'Check out' : 'Check in'
  return (
    <button
      type="button"
      onClick={isOut ? onOut : onIn}
      disabled={disabled}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-md text-[15px] font-medium transition-colors disabled:cursor-not-allowed',
        state === 'done' || state === 'blocked'
          ? 'border border-line bg-slate-50 text-ink-soft'
          : isOut
            ? 'border border-brand-600 bg-white text-brand-700 hover:bg-brand-50'
            : 'bg-brand-600 text-white shadow-card hover:bg-brand-700',
      )}
    >
      {working ? <Loader2 className="h-5 w-5 animate-spin" /> : state === 'done' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : isOut ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
      {label}
    </button>
  )
}
