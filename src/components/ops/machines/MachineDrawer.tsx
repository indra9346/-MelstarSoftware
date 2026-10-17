/** Machine detail drawer and maintenance-job detail drawer. */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertOctagon, CalendarClock, CheckCircle2, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { Machine, MachineStatus, MaintenanceLog, MaintenanceSchedule } from '@/data/types'
import { Badge, Button, EmptyState, InfoGrid, Menu, Modal, StatusBadge } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { ChartBox, ChartGradients, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { addMonths, currentMonth, diffDays, fmtDate, fmtDateTime, fmtDuration, fmtMonth, fyOf, fyRange, todayISO, toISODate } from '@/lib/dates'
import { inr, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import {
  FREQUENCY_LABEL, LOG_STATUS_LABEL, MACHINE_STATUS_COLOR, MACHINE_STATUS_LABEL, MAINT_TYPE_LABEL, downtimeMinutesInMonth, liveDowntime, pmState, sparesValue,
} from '@/services/maintenance'
import { Chip, FormSection, Tile } from '../kit'

export const CRIT_TONE = { A: 'red', B: 'amber', C: 'slate' } as const

export function StatusDot({ status, className }: { status: MachineStatus; className?: string }) {
  return <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', status === 'running' && 'pulse-dot', className)} style={{ background: MACHINE_STATUS_COLOR[status], color: MACHINE_STATUS_COLOR[status] }} aria-hidden />
}

export function PmDueBadge({ s, today = todayISO() }: { s: MaintenanceSchedule; today?: string }) {
  const st = pmState(s, today)
  if (st === 'inactive') return <Badge tone="slate">Inactive</Badge>
  if (st === 'overdue') return <Badge tone="red" dot>Overdue {diffDays(s.next_due, today)} d</Badge>
  if (st === 'due_soon') {
    const d = diffDays(today, s.next_due)
    return <Badge tone="amber" dot>{d === 0 ? 'Due today' : `Due in ${d} d`}</Badge>
  }
  return <Badge tone="green">On plan</Badge>
}

export function MachineDrawer({
  open, onClose, machine, canManage, onEdit, onDelete, onStatus, onBreakdown, onCompletePm, onAddSchedule, onEditSchedule, onOpenLog,
}: {
  open: boolean
  onClose: () => void
  machine: Machine
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
  onStatus: (s: MachineStatus) => void
  onBreakdown: () => void
  onCompletePm: (s: MaintenanceSchedule) => void
  onAddSchedule: () => void
  onEditSchedule: (s: MaintenanceSchedule) => void
  onOpenLog: (l: MaintenanceLog) => void
}) {
  const wc = useTable('work_centres').find((w) => w.id === machine.work_centre_id)
  const allSchedules = useTable('maintenance_schedules')
  const allLogs = useTable('maintenance_logs')
  const schedules = useMemo(() => allSchedules.filter((s) => s.machine_id === machine.id).sort((a, b) => a.next_due.localeCompare(b.next_due)), [allSchedules, machine.id])
  const logs = useMemo(() => allLogs.filter((l) => l.machine_id === machine.id).sort((a, b) => b.reported_at.localeCompare(a.reported_at)), [allLogs, machine.id])
  const today = todayISO()
  const fy = fyRange(fyOf(today))
  const chart = useMemo(() => {
    const ym = currentMonth()
    return Array.from({ length: 6 }, (_, i) => {
      const m = addMonths(ym, i - 5)
      const mins = logs.reduce((s, l) => s + downtimeMinutesInMonth(l, m), 0)
      const bd = logs.filter((l) => l.type === 'breakdown').reduce((s, l) => s + downtimeMinutesInMonth(l, m), 0)
      return { month: fmtMonth(m, true).slice(0, 3), hours: Math.round((mins / 60) * 10) / 10, breakdown: Math.round((bd / 60) * 10) / 10 }
    })
  }, [logs])
  const fyLogs = logs.filter((l) => toISODate(new Date(l.reported_at)) >= fy.from)
  const fyDown = fyLogs.reduce((s, l) => s + liveDowntime(l), 0)
  const fyBreakdowns = fyLogs.filter((l) => l.type === 'breakdown').length
  const openJobs = logs.filter((l) => l.status !== 'closed')
  const fySpend = fyLogs.reduce((s, l) => s + l.cost + sparesValue(l.spares), 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="lg"
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <StatusDot status={machine.status} />
          <span className="truncate">{machine.name}</span>
        </span>
      }
      subtitle={`${machine.asset_code} · ${[machine.make, machine.model].filter(Boolean).join(' ') || 'Machine'}`}
      footer={
        canManage ? (
          <>
            <Menu
              align="left"
              items={[
                { label: 'Delete machine', icon: <Trash2 />, danger: true, onClick: onDelete },
              ]}
            />
            <span className="flex-1" />
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            {machine.status !== 'breakdown' && (
              <Button variant="danger" icon={<AlertOctagon className="h-4 w-4" />} onClick={onBreakdown}>
                Report breakdown
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={machine.status} />
          <Badge tone={CRIT_TONE[machine.criticality]}>Criticality {machine.criticality}</Badge>
          {wc && <Chip color={wc.color}>{wc.name}</Chip>}
        </div>

        {canManage && (
          <div className="min-w-0">
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Set status</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(MACHINE_STATUS_LABEL) as MachineStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStatus(s)}
                  className={cn('relative flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] font-semibold transition', machine.status === s ? 'border-transparent text-white' : 'border-indigo-100 bg-white text-ink-soft hover:border-indigo-200 hover:text-ink')}
                >
                  {machine.status === s && <motion.span layoutId={`mstatus-${machine.id}`} className="absolute inset-0 rounded-xl" style={{ background: MACHINE_STATUS_COLOR[s] }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <span className="relative">{MACHINE_STATUS_LABEL[s]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="Hour meter" value={`${num(machine.hour_meter, 1)} h`} />
          <Tile label="Downtime FY" value={fmtDuration(fyDown)} />
          <Tile label="Breakdowns FY" value={fyBreakdowns} tone={fyBreakdowns > 2 ? 'amber' : undefined} />
          <Tile label="Maint. spend FY" value={inr(fySpend)} sub={openJobs.length ? `${openJobs.length} open job${openJobs.length === 1 ? '' : 's'}` : undefined} tone={openJobs.length ? 'red' : undefined} />
        </div>

        <FormSection title="Downtime by month (h)">
          <ChartBox height={190}>
            <BarChart data={chart} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
              <ChartGradients />
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [`${v} h`, n === 'hours' ? 'All downtime' : 'Breakdown']} />
              <Bar dataKey="hours" fill="url(#gBar)" radius={[6, 6, 0, 0]} maxBarSize={30} />
              <Bar dataKey="breakdown" fill="url(#gBarPink)" radius={[6, 6, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ChartBox>
        </FormSection>

        <FormSection title="Specifications">
          <InfoGrid
            items={[
              ['Make', machine.make || '—'],
              ['Model', machine.model || '—'],
              ['Serial no.', machine.serial_no || '—'],
              ['Installed', fmtDate(machine.install_date)],
              ['Specs', machine.specs || '—'],
              ['Notes', machine.notes || '—'],
            ]}
          />
        </FormSection>

        <FormSection
          title="PM schedules"
          action={canManage && (
            <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={onAddSchedule}>
              Add
            </Button>
          )}
        >
          {schedules.length ? (
            <ul className="space-y-2">
              {schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-indigo-100 bg-white/80 px-3.5 py-2.5">
                  <CalendarClock className="h-4 w-4 shrink-0 text-brand-indigo" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{s.title}</p>
                    <p className="text-[12px] text-ink-soft">
                      {FREQUENCY_LABEL[s.frequency]} · next {fmtDate(s.next_due)}
                      {s.last_done ? ` · last ${fmtDate(s.last_done)}` : ''}
                    </p>
                  </div>
                  <PmDueBadge s={s} today={today} />
                  {canManage && (
                    <span className="flex items-center gap-1">
                      {s.active && (
                        <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onCompletePm(s)}>
                          Complete
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" onClick={() => onEditSchedule(s)} aria-label="Edit schedule">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No PM plan yet" description="Add a preventive-maintenance schedule so this machine shows up in due lists." icon={<CalendarClock className="h-6 w-6" />} />
          )}
        </FormSection>

        <FormSection title={`Maintenance history (${logs.length})`}>
          {logs.length ? (
            <ul className="space-y-2">
              {logs.slice(0, 10).map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => onOpenLog(l)} className="flex w-full min-w-0 items-start gap-3 rounded-2xl border border-indigo-100 bg-white/80 px-3.5 py-2.5 text-left transition hover:border-indigo-200 hover:shadow-soft">
                    <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', l.type === 'breakdown' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-brand-indigo')}>
                      {l.type === 'breakdown' ? <AlertOctagon className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[12px] font-semibold text-ink-faint">{l.log_no}</span>
                        <span className="text-[12px] text-ink-soft">{MAINT_TYPE_LABEL[l.type]} · {fmtDateTime(l.reported_at)}</span>
                      </span>
                      <span className="block truncate text-sm font-medium text-ink">{l.problem}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={l.status} label={LOG_STATUS_LABEL[l.status]} />
                      <span className="num text-[12px] text-ink-soft">{fmtDuration(liveDowntime(l))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No maintenance recorded" icon={<Wrench className="h-6 w-6" />} />
          )}
        </FormSection>
      </div>
    </Modal>
  )
}

export function LogDrawer({ open, onClose, log, canManage, onUpdate }: { open: boolean; onClose: () => void; log: MaintenanceLog; canManage: boolean; onUpdate: () => void }) {
  const machine = useTable('machines').find((m) => m.id === log.machine_id)
  const items = useTable('inventory_items')
  const movements = useTable('stock_movements')
  const issued = useMemo(() => movements.filter((m) => m.reference === log.log_no).sort((a, b) => a.created_at.localeCompare(b.created_at)), [movements, log.log_no])
  const spareValue = sparesValue(log.spares)
  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="md"
      title={`${log.log_no} · ${MAINT_TYPE_LABEL[log.type]}`}
      subtitle={machine ? `${machine.asset_code} — ${machine.name}` : undefined}
      footer={
        canManage && log.status !== 'closed' ? (
          <Button icon={<Wrench className="h-4 w-4" />} onClick={onUpdate}>
            Update / close
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={log.status} label={LOG_STATUS_LABEL[log.status]} />
          {log.schedule_id && <Badge tone="indigo">From PM plan</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label={log.status === 'closed' ? 'Downtime' : 'Down so far'} value={fmtDuration(liveDowntime(log))} tone={log.status !== 'closed' ? 'red' : undefined} />
          <Tile label="Total cost" value={inr(log.cost + spareValue)} sub={spareValue ? `${inr(spareValue)} spares` : undefined} />
        </div>
        <InfoGrid
          items={[
            ['Reported', fmtDateTime(log.reported_at)],
            ['Started', fmtDateTime(log.started_at)],
            ['Completed', fmtDateTime(log.completed_at)],
            ['Technician', <EmployeeCell key="t" id={log.technician_id} size={26} />],
          ]}
        />
        <FormSection title="Problem">
          <p className="whitespace-pre-line text-sm text-ink">{log.problem}</p>
        </FormSection>
        {log.action_taken && (
          <FormSection title="Action taken">
            <p className="whitespace-pre-line text-sm text-ink">{log.action_taken}</p>
          </FormSection>
        )}
        {log.root_cause && (
          <FormSection title="Root cause">
            <p className="whitespace-pre-line text-sm text-ink">{log.root_cause}</p>
          </FormSection>
        )}
        <FormSection title="Spares used">
          {log.spares.length ? (
            <ul className="divide-y divide-indigo-50 rounded-2xl border border-indigo-100 bg-white/80">
              {log.spares.map((s) => {
                const it = items.find((i) => i.id === s.item_id)
                return (
                  <li key={s.item_id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{it?.name ?? 'Item'}</span>
                      <span className="text-[12px] text-ink-faint">{it?.sku}</span>
                    </span>
                    <span className="num shrink-0 text-right">
                      {num(s.qty, 3)} {it?.uom}
                      <span className="block text-[12px] text-ink-soft">{inr(s.qty * (it?.unit_cost ?? 0))}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">No spares drawn.</p>
          )}
          {issued.length > 0 && <p className="mt-2 text-[12px] text-ink-faint">{issued.length} stock movement{issued.length === 1 ? '' : 's'} posted against {log.log_no}.</p>}
        </FormSection>
      </div>
    </Modal>
  )
}

/** Re-export for the page (keeps the import list short). */
export const machineLabel = (id: string) => {
  const m = db.get('machines', id)
  return m ? `${m.asset_code} — ${m.name}` : '—'
}
