/**
 * Small building blocks shared by the attendance & leave screens (admin and self-service).
 */
import { useMemo, type ReactNode } from 'react'
import { Fingerprint, Globe, MapPin, MapPinOff, PenLine, FileCheck2, Smartphone, Timer } from 'lucide-react'
import { useTable } from '@/data/store'
import type { ISODate, LeaveType, OtStatus, PunchSource } from '@/data/types'
import { buildAttendanceContext, DAY_STATUS_META, type DayStatus } from '@/lib/attendance'
import { fmtDuration, todayISO } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { useNow } from '@/hooks/useClock'

/** Today's ISO date that rolls over at midnight (re-renders once a minute). */
export function useToday(): ISODate {
  useNow(60_000)
  return todayISO()
}

/** Attendance context (holidays, punches, approved leave, shifts) from live tables. */
export function useAttendanceContext(today: ISODate) {
  const holidays = useTable('holidays')
  const attendance = useTable('attendance')
  const leaveRequests = useTable('leave_requests')
  const leaveTypes = useTable('leave_types')
  const shifts = useTable('shifts')
  return useMemo(
    () => buildAttendanceContext({ holidays, attendance, leaveRequests, leaveTypes, shifts, today }),
    [holidays, attendance, leaveRequests, leaveTypes, shifts, today],
  )
}

/** Statuses an admin can filter on, in display order. */
export const DAY_STATUS_ORDER: DayStatus[] = ['present', 'on_duty', 'half_day', 'absent', 'leave', 'half_leave', 'unpaid_leave', 'holiday', 'week_off', 'today', 'upcoming']

export function DayStatusChip({ status, late, className }: { status: DayStatus; late?: boolean; className?: string }) {
  const m = DAY_STATUS_META[status]
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', className)} style={{ background: m.bg === 'transparent' ? '#f8fafc' : m.bg, color: m.color }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: m.color }} />
      <span className="truncate">{m.label}</span>
      {late && <span className="rounded-full bg-amber-100 px-1.5 text-[10.5px] font-bold text-amber-700">Late</span>}
    </span>
  )
}

export function StatusLegend({ statuses, className }: { statuses: DayStatus[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-ink-soft', className)}>
      {statuses.map((s) => {
        const m = DAY_STATUS_META[s]
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className="grid h-5 min-w-[22px] place-items-center rounded-md px-1 text-[10px] font-bold" style={{ background: m.bg === 'transparent' ? '#f8fafc' : m.bg, color: m.color }}>
              {m.short || '·'}
            </span>
            {m.label}
          </li>
        )
      })}
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-500" /> Late mark
      </li>
    </ul>
  )
}

const SOURCE_META: Record<PunchSource, { label: string; icon: ReactNode; cls: string }> = {
  biometric: { label: 'Biometric', icon: <Fingerprint className="h-3.5 w-3.5" />, cls: 'bg-indigo-50 text-indigo-700' },
  web: { label: 'Web', icon: <Globe className="h-3.5 w-3.5" />, cls: 'bg-cyan-50 text-cyan-700' },
  mobile: { label: 'Mobile', icon: <Smartphone className="h-3.5 w-3.5" />, cls: 'bg-sky-50 text-sky-700' },
  manual: { label: 'Manual', icon: <PenLine className="h-3.5 w-3.5" />, cls: 'bg-amber-50 text-amber-700' },
  regularised: { label: 'Regularised', icon: <FileCheck2 className="h-3.5 w-3.5" />, cls: 'bg-violet-50 text-violet-700' },
}

export function SourceBadge({ source, className }: { source: PunchSource; className?: string }) {
  const m = SOURCE_META[source]
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', m.cls, className)}>
      {m.icon}
      {m.label}
    </span>
  )
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`
}

/** Check-in distance from the plant, flagged when outside the geofence. */
export function GeoBadge({ distance, radius, className }: { distance: number | null | undefined; radius: number; className?: string }) {
  if (distance == null)
    return (
      <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-slate-500', className)} title="No location captured">
        <MapPinOff className="h-3.5 w-3.5" /> No GPS
      </span>
    )
  const outside = distance > radius
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', outside ? 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' : 'bg-emerald-50 text-emerald-700', className)}
      title={outside ? `Outside the ${radius} m geofence` : `Within the ${radius} m geofence`}
    >
      <MapPin className="h-3.5 w-3.5" />
      {fmtDistance(distance)}
      {outside && <span className="font-bold">· outside</span>}
    </span>
  )
}

const OT_CLS: Record<OtStatus, string> = {
  none: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-600 line-through decoration-rose-300',
}

export function OtBadge({ minutes, status, className }: { minutes: number; status: OtStatus; className?: string }) {
  if (minutes <= 0) return <span className="text-ink-faint">—</span>
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', OT_CLS[status], className)} title={`OT ${status}`}>
      <Timer className="h-3.5 w-3.5" />
      {fmtDuration(minutes)}
      {status !== 'approved' && status !== 'none' && <span className="font-medium opacity-80">· {status}</span>}
    </span>
  )
}

/** Leave type chip in its colour. Pending leave is drawn striped/outlined. */
export function LeaveTypeChip({ type, pending, className, label }: { type: Pick<LeaveType, 'code' | 'name' | 'color'> | undefined; pending?: boolean; className?: string; label?: ReactNode }) {
  if (!type) return <span className="text-ink-faint">—</span>
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-bold', className)}
      style={pending ? stripedStyle(type.color) : { background: type.color, color: '#fff' }}
      title={`${type.name}${pending ? ' (pending)' : ''}`}
    >
      <span className="truncate">{label ?? type.code}</span>
    </span>
  )
}

export function stripedStyle(color: string) {
  return {
    color,
    border: `1px dashed ${color}`,
    backgroundImage: `repeating-linear-gradient(135deg, ${color}1f 0 5px, transparent 5px 10px)`,
    backgroundColor: '#fff',
  }
}

/** Dot + label used in compact legends. */
export function Swatch({ color, label, striped }: { color: string; label: ReactNode; striped?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft">
      <span className="h-3 w-4 rounded" style={striped ? stripedStyle(color) : { background: color }} />
      {label}
    </span>
  )
}
