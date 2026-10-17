/**
 * Live board — today's plant floor at a glance: who is in, out, late, on leave or not yet in,
 * grouped by work centre or department, plus a timeline of today's punches.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarOff, Clock, DoorOpen, LogIn, LogOut, Plane, Radio, UserCheck, Users, UserX, AlarmClock } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { AttendanceRecord, Employee } from '@/data/types'
import { liveStatus, resolveDay, type DayInfo } from '@/lib/attendance'
import { fmtDay, fmtDuration, fmtHHMM, fmtTime, hhmmToMinutes } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useNow } from '@/hooks/useClock'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { isEmployedOn } from '@/services/attendance'
import { Avatar, Badge, Button, Card, CardBody, CardHeader, EmptyState, InfoGrid, Modal, Segmented, StatCard } from '@/components/ui'
import { DayStatusChip, GeoBadge, OtBadge, SourceBadge, useAttendanceContext, useToday } from '../shared'
import type { MarkTarget } from '../MarkAttendanceModal'

type Bucket = 'in' | 'out' | 'duty' | 'waiting' | 'absent' | 'leave' | 'off'

const BUCKET: Record<Bucket, { label: string; color: string; order: number }> = {
  in: { label: 'Inside', color: '#10b981', order: 0 },
  duty: { label: 'On duty', color: '#06b6d4', order: 1 },
  out: { label: 'Checked out', color: '#6366f1', order: 2 },
  waiting: { label: 'Not yet in', color: '#f59e0b', order: 3 },
  absent: { label: 'Absent', color: '#f43f5e', order: 4 },
  leave: { label: 'On leave', color: '#8b5cf6', order: 5 },
  off: { label: 'Holiday / week-off', color: '#cbd5e1', order: 6 },
}

interface Person {
  emp: Employee
  day: DayInfo
  rec?: AttendanceRecord
  bucket: Bucket
}

type Focus = Bucket | 'late' | 'checked' | null

export function LiveBoard({ onMark }: { onMark: (t: MarkTarget) => void }) {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const now = useNow(30_000)
  const today = useToday()
  const ctx = useAttendanceContext(today)
  const employees = useTable('employees')
  const workCentres = useTable('work_centres')
  const departments = useTable('departments')
  const [groupBy, setGroupBy] = useState<'wc' | 'dept'>('wc')
  const [focus, setFocus] = useState<Focus>(null)
  const [detail, setDetail] = useState<Person | null>(null)
  const [showAll, setShowAll] = useState(false)

  const cutoff = settings.attendance.auto_absent_after
  const pastCutoff = now.getHours() * 60 + now.getMinutes() >= hhmmToMinutes(cutoff)
  const radius = settings.attendance.geofence_radius_m

  const people = useMemo<Person[]>(() => {
    return employees
      .filter((e) => e.status !== 'exited' && isEmployedOn(e, today))
      .map((emp) => {
        const day = resolveDay(emp, today, ctx)
        const rec = ctx.records.get(`${emp.id}|${today}`)
        const live = liveStatus(emp, ctx)
        let bucket: Bucket
        if (live === 'holiday' || live === 'off') bucket = 'off'
        else if (live === 'leave') bucket = 'leave'
        else if (live === 'in') bucket = 'in'
        else if (live === 'out') bucket = 'out'
        else if (day.status === 'on_duty') bucket = 'duty'
        else if (rec?.status === 'absent') bucket = 'absent'
        else bucket = pastCutoff ? 'absent' : 'waiting'
        return { emp, day, rec, bucket }
      })
  }, [employees, today, ctx, pastCutoff])

  const count = (b: Bucket) => people.filter((p) => p.bucket === b).length
  const late = people.filter((p) => (p.rec?.late_minutes ?? 0) > 0).length
  const checkedIn = people.filter((p) => !!p.rec?.check_in).length
  const notIn = count('waiting') + count('absent')

  const matches = (p: Person) =>
    !focus || (focus === 'late' ? (p.rec?.late_minutes ?? 0) > 0 : focus === 'checked' ? !!p.rec?.check_in : focus === 'waiting' ? p.bucket === 'waiting' || p.bucket === 'absent' : p.bucket === focus)

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; color: string; people: Person[] }>()
    const add = (key: string, name: string, color: string, p: Person) => {
      let g = map.get(key)
      if (!g) map.set(key, (g = { key, name, color, people: [] }))
      g.people.push(p)
    }
    for (const p of people) {
      if (groupBy === 'wc') {
        const wc = p.emp.work_centre_id ? workCentres.find((w) => w.id === p.emp.work_centre_id) : undefined
        if (wc) add(wc.id, wc.name, wc.color, p)
        else add('_office', 'Offices & support', '#94a3b8', p)
      } else {
        const d = departments.find((x) => x.id === p.emp.department_id)
        add(d?.id ?? '_none', d?.name ?? 'No department', d?.color ?? '#94a3b8', p)
      }
    }
    for (const g of map.values()) g.people.sort((a, b) => BUCKET[a.bucket].order - BUCKET[b.bucket].order || fullName(a.emp).localeCompare(fullName(b.emp)))
    return [...map.values()].sort((a, b) => (a.key === '_office' ? 1 : b.key === '_office' ? -1 : a.name.localeCompare(b.name)))
  }, [people, groupBy, workCentres, departments])

  const events = useMemo(() => {
    const out: { id: string; at: string; kind: 'in' | 'out'; rec: AttendanceRecord }[] = []
    for (const p of people) {
      if (p.rec?.check_in) out.push({ id: p.rec.id + 'i', at: p.rec.check_in, kind: 'in', rec: p.rec })
      if (p.rec?.check_out) out.push({ id: p.rec.id + 'o', at: p.rec.check_out, kind: 'out', rec: p.rec })
    }
    return out.sort((a, b) => b.at.localeCompare(a.at))
  }, [people])
  const visibleEvents = showAll ? events : events.slice(0, 25)

  const stats: { key: Focus; label: string; value: number; icon: ReactNode; accent: 'indigo' | 'cyan' | 'green' | 'amber' | 'red' | 'pink'; hint?: string }[] = [
    { key: null, label: 'On rolls', value: people.length, icon: <Users className="h-4 w-4" />, accent: 'indigo', hint: fmtDay(today) },
    { key: 'checked', label: 'Checked in', value: checkedIn, icon: <LogIn className="h-4 w-4" />, accent: 'cyan', hint: people.length ? `${Math.round((checkedIn / Math.max(1, people.length - count('off') - count('leave'))) * 100)}% of expected` : undefined },
    { key: 'in', label: 'Still inside', value: count('in'), icon: <UserCheck className="h-4 w-4" />, accent: 'green' },
    { key: 'out', label: 'Checked out', value: count('out'), icon: <LogOut className="h-4 w-4" />, accent: 'indigo' },
    { key: 'late', label: 'Late', value: late, icon: <AlarmClock className="h-4 w-4" />, accent: 'amber' },
    { key: 'leave', label: 'On leave', value: count('leave'), icon: <Plane className="h-4 w-4" />, accent: 'pink' },
    { key: 'waiting', label: pastCutoff ? 'Absent' : 'Not yet in', value: notIn, icon: <UserX className="h-4 w-4" />, accent: 'red', hint: pastCutoff ? `No punch by ${fmtHHMM(cutoff)}` : `Absent after ${fmtHHMM(cutoff)}` },
    { key: 'off', label: 'Holiday / week-off', value: count('off'), icon: <CalendarOff className="h-4 w-4" />, accent: 'cyan' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
          <span className="pulse-dot h-2 w-2 rounded-full bg-emerald-500 text-emerald-500" />
          Live · updated {fmtTime(now.toISOString())}
          {ctx.holidays.get(today) && <Badge tone="sky">{ctx.holidays.get(today)!.name}</Badge>}
        </p>
        {focus && (
          <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
            Clear filter
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((st) => (
          <StatCard
            key={st.label}
            label={st.label}
            value={st.value}
            icon={st.icon}
            accent={st.accent}
            hint={st.hint}
            onClick={() => setFocus((f) => (f === st.key ? null : st.key))}
            className={cn(focus && focus === st.key && 'ring-2 ring-brand-indigo/50')}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
              {(Object.keys(BUCKET) as Bucket[]).map((b) => (
                <li key={b} className="flex items-center gap-1.5 text-[12px] text-ink-soft">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKET[b].color }} />
                  {BUCKET[b].label}
                </li>
              ))}
            </ul>
            <Segmented size="sm" value={groupBy} onChange={setGroupBy} options={[{ value: 'wc', label: 'Work centre' }, { value: 'dept', label: 'Department' }]} />
          </div>
          {!people.length ? (
            <EmptyState title="Nobody on rolls today" />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {groups.map((g, gi) => {
                const inside = g.people.filter((p) => p.bucket === 'in' || p.bucket === 'duty').length
                const expected = g.people.filter((p) => p.bucket !== 'off' && p.bucket !== 'leave').length
                return (
                  <motion.div key={g.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(gi, 8) * 0.04, duration: 0.35 }} className="card min-w-0 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold text-ink">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
                        <span className="truncate">{g.name}</span>
                      </p>
                      <span className="num shrink-0 text-[12px] font-semibold text-ink-soft">
                        {inside}/{expected} in
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-3">
                      {g.people.map((p) => (
                        <button
                          key={p.emp.id}
                          type="button"
                          onClick={() => setDetail(p)}
                          title={`${fullName(p.emp)} — ${BUCKET[p.bucket].label}${p.rec?.check_in ? ` · in ${fmtTime(p.rec.check_in)}` : ''}`}
                          className={cn('group flex w-[58px] flex-col items-center gap-1 transition-opacity', !matches(p) && 'opacity-25')}
                        >
                          <span className="relative rounded-full p-[2px] transition-transform group-hover:scale-105" style={{ boxShadow: `0 0 0 2.5px ${BUCKET[p.bucket].color}` }}>
                            <Avatar name={fullName(p.emp)} src={p.emp.photo} size={38} />
                            {(p.rec?.late_minutes ?? 0) > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-500" />}
                            {p.bucket === 'in' && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
                          </span>
                          <span className="w-full truncate text-center text-[11px] font-medium text-ink-soft">{p.emp.first_name}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>

        <Card className="min-w-0 self-start">
          <CardHeader title="Today’s punches" subtitle={`${events.length} punch${events.length === 1 ? '' : 'es'} · latest first`} icon={<Radio className="h-4 w-4" />} />
          <CardBody>
            {!events.length ? (
              <EmptyState icon={<Clock className="h-6 w-6" />} title="No punches yet" description="Check-ins from the biometric terminal, web and mobile appear here live." />
            ) : (
              <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[80px] before:top-2 before:w-px before:bg-indigo-100">
                <AnimatePresence initial={false}>
                  {visibleEvents.map((ev, i) => {
                    const emp = L.emp.get(ev.rec.employee_id)
                    const isIn = ev.kind === 'in'
                    return (
                      <motion.li
                        key={ev.id}
                        layout
                        initial={i < 8 ? { opacity: 0, x: 10 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, delay: i < 8 ? i * 0.03 : 0 }}
                        className="relative flex gap-3"
                      >
                        <span className="num w-[58px] shrink-0 whitespace-nowrap pt-1 text-right text-[11.5px] font-semibold text-ink-soft">{fmtTime(ev.at)}</span>
                        <span className={cn('relative z-10 mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-4 ring-white', isIn ? 'bg-emerald-500' : 'bg-indigo-500')}>
                          {isIn ? <LogIn className="h-3 w-3 text-white" /> : <DoorOpen className="h-3 w-3 text-white" />}
                        </span>
                        <div className="min-w-0 flex-1 rounded-xl border border-indigo-50 bg-white/70 px-3 py-2">
                          <p className="truncate text-[13px] text-ink">
                            <span className="font-semibold">{fullName(emp)}</span> <span className="text-ink-soft">{isIn ? 'checked in' : 'checked out'}</span>
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {isIn && ev.rec.late_minutes > 0 && <Badge tone="amber">Late {fmtDuration(ev.rec.late_minutes)}</Badge>}
                            <SourceBadge source={ev.rec.source} />
                            {isIn && (ev.rec.source === 'web' || ev.rec.source === 'mobile' || ev.rec.check_in_distance_m != null) && <GeoBadge distance={ev.rec.check_in_distance_m} radius={radius} />}
                            {!isIn && <Badge tone="slate">{fmtDuration(ev.rec.worked_minutes)} worked</Badge>}
                            {!isIn && ev.rec.ot_minutes > 0 && <OtBadge minutes={ev.rec.ot_minutes} status={ev.rec.ot_status} />}
                          </div>
                        </div>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ol>
            )}
            {events.length > 25 && (
              <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show latest 25' : `Show all ${events.length}`}
              </Button>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? fullName(detail.emp) : ''}
        subtitle={detail ? `${detail.emp.emp_code} · ${L.deptName(detail.emp.department_id)} · ${fmtDay(today)}` : undefined}
        size="sm"
        footer={
          detail && s.can('attendance.manage') ? (
            <Button
              onClick={() => {
                onMark({ employeeId: detail.emp.id, date: today })
                setDetail(null)
              }}
            >
              {detail.rec ? 'Edit today’s record' : 'Mark attendance'}
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={fullName(detail.emp)} src={detail.emp.photo} size={52} />
              <div className="min-w-0">
                <DayStatusChip status={detail.day.status} late={detail.day.late} />
                <p className="mt-1 text-[12.5px] text-ink-soft">{L.desigTitle(detail.emp.designation_id)}</p>
              </div>
            </div>
            <InfoGrid
              items={[
                ['Check-in', fmtTime(detail.rec?.check_in)],
                ['Check-out', fmtTime(detail.rec?.check_out)],
                ['Worked', detail.rec?.check_out ? fmtDuration(detail.rec.worked_minutes) : detail.rec?.check_in ? 'In progress' : '—'],
                ['Late', detail.rec?.late_minutes ? fmtDuration(detail.rec.late_minutes) : '—'],
                ['Source', detail.rec ? <SourceBadge source={detail.rec.source} /> : '—'],
                ['Location', detail.rec ? <GeoBadge distance={detail.rec.check_in_distance_m} radius={radius} /> : '—'],
                ['Shift', L.shift.get(detail.rec?.shift_id ?? detail.emp.shift_id)?.name ?? '—'],
                ['Leave', detail.day.leaveType ? `${detail.day.leaveType.name}${detail.day.leave?.half_day ? ' (half day)' : ''}` : '—'],
              ]}
            />
            {detail.rec?.remarks && <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-ink-soft">“{detail.rec.remarks}”</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
