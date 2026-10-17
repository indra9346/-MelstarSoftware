/**
 * Check-in / check-out hero for the employee's own day. Reused by My attendance and the home page:
 *   <CheckInCard employee={session.employee} />
 * Live worked-time counter, shift, late indicator, distance from plant (geofence), friendly
 * blocked states on week-off / plant holiday / full-day approved leave.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarHeart, Check, Clock, Coffee, Crosshair, Fingerprint, Loader2, LogIn, LogOut, MapPin, PartyPopper, Plane, ShieldAlert } from 'lucide-react'
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
  const [burst, setBurst] = useState(0)
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
    if (!isEmployedOn(employee, today)) return { icon: <ShieldAlert className="h-5 w-5" />, title: 'Not on rolls today', text: 'Your employment dates don’t include today. Please contact HR.' }
    if (!shift) return { icon: <ShieldAlert className="h-5 w-5" />, title: 'No shift assigned', text: 'Ask HR to assign your shift before checking in.' }
    if (day.status === 'holiday') return { icon: <PartyPopper className="h-5 w-5" />, title: `Plant holiday · ${day.holiday?.name ?? ''}`, text: `The plant is closed today. Enjoy the day — see you on ${nextWorkingDay()}!` }
    if (day.status === 'week_off') return { icon: <Coffee className="h-5 w-5" />, title: 'Weekly off', text: `Relax and recharge — your next shift is on ${nextWorkingDay()}.` }
    if (day.status === 'leave' || day.status === 'unpaid_leave') return { icon: <Plane className="h-5 w-5" />, title: `On ${day.leaveType?.name ?? 'leave'} today`, text: 'Your full-day leave is approved — no need to check in. Rest well!' }
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
      setBurst((b) => b + 1)
      toast.success(`Checked in at ${fmtTime(row.check_in)}`, row.late_minutes > 0 ? `Late by ${fmtDuration(row.late_minutes)} — have a good shift!` : 'Have a great shift!')
      if (row.check_in_distance_m != null && row.check_in_distance_m > radius) toast.warning('Outside the plant geofence', `${fmtDistance(row.check_in_distance_m)} from the plant — HR will see this flag.`)
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
      const ok = await confirm({ title: 'Check out early?', message: `Your shift ends at ${fmtTime(end.toISOString())} — that’s ${fmtDuration(left)} from now. Leaving early is recorded as an early exit.`, confirmLabel: 'Check out' })
      if (!ok) return
    }
    setBusy('out')
    try {
      const row = await checkOut(employee)
      setBurst((b) => b + 1)
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
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className={cn('card relative overflow-hidden', className)}>
      <span className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,.18),transparent_65%)]" />
      <span className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(6,182,212,.16),transparent_65%)]" />
      <div className="relative grid grid-cols-1 items-center gap-5 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="kicker">{fmtDay(today)}{shift ? ` · ${shift.name}` : ''}</p>
          <h2 className="mt-1 truncate text-[22px] font-bold leading-tight text-ink sm:text-[26px]">
            {greeting}, <span className="grad-text">{employee.first_name}</span>
          </h2>
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
                    {live && <span className="ml-1 text-[11px] font-semibold text-ink-faint">{String(secs).padStart(2, '0')}s</span>}
                  </>
                ) : (
                  '—'
                )
              }
              tone={live ? 'live' : 'default'}
            />
          </div>
          {active?.check_in && (
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-indigo-100/70" title={`${Math.round(progress * 100)}% of a full day`}>
              <motion.div className="h-full rounded-full bg-grad" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
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
              <button type="button" onClick={doProbe} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold text-brand-indigo hover:bg-indigo-50 disabled:opacity-50">
                {busy === 'probe' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                Check my distance
              </button>
            )}
          </div>

          {block && effective === 'blocked' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-indigo shadow-sm">{block.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{block.title}</p>
                <p className="mt-0.5 text-[13px] text-ink-soft">{block.text}</p>
              </div>
            </motion.div>
          )}
          {effective === 'done' && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex items-center gap-2 text-[13px] font-medium text-emerald-700">
              <CalendarHeart className="h-4 w-4" /> Day complete — thanks for your work today!
            </motion.p>
          )}
          {day.status === 'half_leave' && <p className="mt-3 text-[12.5px] text-violet-700">Half-day {day.leaveType?.name ?? 'leave'} approved for today ({day.leave?.half_day_session === 'first' ? 'first' : 'second'} half).</p>}
        </div>

        <div className="flex justify-center md:pr-2">
          <PunchButton state={effective} busy={busy} burst={burst} onIn={doCheckIn} onOut={doCheckOut} />
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'amber' | 'live' }) {
  return (
    <div className={cn('min-w-0 rounded-2xl border px-2.5 py-2 sm:px-3', tone === 'live' ? 'border-indigo-200 bg-gradient-to-br from-cyan-50 to-indigo-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50/60' : 'border-indigo-100/80 bg-white/70')}>
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="num mt-0.5 truncate font-display text-[15px] font-bold text-ink sm:text-[17px]">{value}</p>
    </div>
  )
}

function PunchButton({ state, busy, burst, onIn, onOut }: { state: 'in' | 'done' | 'ready' | 'blocked'; busy: Busy; burst: number; onIn: () => void; onOut: () => void }) {
  const working = busy === 'locating' || busy === 'in' || busy === 'out'
  const disabled = state === 'blocked' || state === 'done' || working
  const isOut = state === 'in'
  const label = busy === 'locating' ? 'Locating…' : working ? 'Saving…' : state === 'done' ? 'Done' : state === 'blocked' ? 'Unavailable' : isOut ? 'Check out' : 'Check in'
  const ringColor = isOut ? 'rgba(236,72,153,.45)' : 'rgba(99,102,241,.45)'
  return (
    <div className="relative grid h-[148px] w-[148px] place-items-center sm:h-[164px] sm:w-[164px]">
      {/* idle pulse rings */}
      {!disabled &&
        [0, 1].map((i) => (
          <motion.span
            key={`${state}-${i}`}
            className="absolute inset-3 rounded-full"
            style={{ border: `2px solid ${ringColor}` }}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.32, opacity: 0 }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
          />
        ))}
      {/* success burst */}
      <AnimatePresence>
        {burst > 0 && (
          <motion.span
            key={burst}
            className="absolute inset-3 rounded-full bg-gradient-to-br from-emerald-300/60 to-cyan-300/50"
            initial={{ scale: 0.9, opacity: 0.9 }}
            animate={{ scale: 1.6, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        onClick={isOut ? onOut : onIn}
        disabled={disabled}
        whileHover={disabled ? undefined : { scale: 1.04 }}
        whileTap={disabled ? undefined : { scale: 0.93 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        aria-label={label}
        className={cn(
          'relative grid h-[120px] w-[120px] place-items-center rounded-full text-white sm:h-[132px] sm:w-[132px]',
          'shadow-[0_22px_45px_-16px_rgba(99,102,241,.75),inset_0_2px_0_rgba(255,255,255,.35)] disabled:cursor-not-allowed',
          state === 'done' ? 'bg-gradient-to-br from-emerald-400 to-teal-500' : state === 'blocked' ? 'bg-gradient-to-br from-slate-300 to-slate-400 shadow-none' : isOut ? 'bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-pink-500' : 'bg-grad',
        )}
      >
        <span className="flex flex-col items-center gap-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={working ? 'busy' : state}
              initial={{ scale: 0.4, rotate: -40, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.4, rotate: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 26 }}
              className="grid place-items-center"
            >
              {working ? <Loader2 className="h-8 w-8 animate-spin" /> : state === 'done' ? <Check className="h-9 w-9" strokeWidth={3} /> : isOut ? <LogOut className="h-8 w-8" /> : <LogIn className="h-8 w-8" />}
            </motion.span>
          </AnimatePresence>
          <span className="font-display text-[14px] font-bold tracking-wide">{label}</span>
        </span>
      </motion.button>
    </div>
  )
}
