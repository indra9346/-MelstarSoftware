import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertOctagon, AlertTriangle, CalendarClock, CheckCircle2, Clock3, Cpu, Factory, Gauge, Pencil, Plus, Search, Timer, Trash2, Wrench } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Machine, MachineStatus, MaintenanceLog, MaintenanceSchedule, MaintenanceType, WorkCentre } from '@/data/types'
import {
  AnimatedNumber, Badge, Button, Card, DataTable, EmptyState, Input, Menu, PageHeader, Ring, StatCard, StatusBadge, Tabs, confirm, guard, toast, type Column,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { useNow } from '@/hooks/useClock'
import { useSession } from '@/services/session'
import { diffDays, fmtDate, fmtDateTime, fmtDuration, todayISO, toISODate } from '@/lib/dates'
import { inr, num, pct } from '@/lib/format'
import { cn } from '@/lib/misc'
import {
  FREQUENCY_LABEL, LOG_STATUS_LABEL, MACHINE_STATUS_COLOR, MACHINE_STATUS_LABEL, MAINT_TYPE_LABEL, deleteMachine, deleteSchedule, deleteWorkCentre, liveDowntime,
  machineKpis, pmState, setMachineStatus, sparesValue,
} from '@/services/maintenance'
import { useDialog, useLast, useQueryParam } from '@/components/ops/form'
import { Chip, DateRange, FilterSelect, KpiGrid, MixBar, ViewOnly } from '@/components/ops/kit'
import { BreakdownForm, CompletePmForm, LogUpdateForm, MachineForm, ScheduleForm, WorkCentreForm } from '@/components/ops/machines/MachineForms'
import { CRIT_TONE, LogDrawer, MachineDrawer, PmDueBadge, StatusDot } from '@/components/ops/machines/MachineDrawer'

type Tab = 'machines' | 'pm' | 'log' | 'wc'
const TABS: Tab[] = ['machines', 'pm', 'log', 'wc']
const STATUSES = Object.keys(MACHINE_STATUS_LABEL) as MachineStatus[]

export default function MachinesPage() {
  const s = useSession()
  const canManage = s.can('machines.manage')
  const settings = useSettings()
  const machines = useTable('machines')
  const wcs = useTable('work_centres')
  const schedules = useTable('maintenance_schedules')
  const logs = useTable('maintenance_logs')
  const holidays = useTable('holidays')
  const now = useNow(60_000)
  const today = todayISO()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'machines'))

  // deep link ?m=<machine id> opens the drawer
  const [mId, setMId] = useQueryParam('m')
  const liveMachine = machines.find((m) => m.id === mId)
  const drawerMachine = useLast(liveMachine)
  useEffect(() => {
    if (mId && machines.length && !liveMachine) {
      toast.error('Machine not found', 'It may have been deleted.')
      setMId(null)
    }
  }, [mId, machines.length, liveMachine, setMId])

  const machineDlg = useDialog<{ machine: Machine | null; wc?: string }>()
  const wcDlg = useDialog<WorkCentre>()
  const schedDlg = useDialog<{ schedule: MaintenanceSchedule | null; machineId?: string }>()
  const pmDlg = useDialog<MaintenanceSchedule>()
  const bdDlg = useDialog<string>()
  const logDlg = useDialog<MaintenanceLog>()
  const updDlg = useDialog<MaintenanceLog>()
  const viewLog = logDlg.data ? logs.find((l) => l.id === logDlg.data!.id) ?? logDlg.data : null

  const kpi = useMemo(() => machineKpis(machines, schedules, logs, settings, holidays, today, now), [machines, schedules, logs, settings, holidays, today, now])

  const changeStatus = async (m: Machine, st: MachineStatus) => {
    if (st === m.status) return
    if (st === 'breakdown') return bdDlg.show(m.id)
    const open = logs.find((l) => l.machine_id === m.id && l.status !== 'closed')
    if (open && st === 'running') {
      const ok = await confirm({ title: `${open.log_no} is still open`, message: `Set ${m.asset_code} to running anyway? Close the job from the maintenance log so its downtime is recorded.`, confirmLabel: 'Set running' })
      if (!ok) return
    }
    if (await guard(() => setMachineStatus(m, st))) toast.success(`${m.asset_code} → ${MACHINE_STATUS_LABEL[st]}`)
  }

  const removeMachine = async (m: Machine) => {
    if (!(await confirm({ title: `Delete ${m.asset_code}?`, message: 'Its PM schedules are deleted too. Machines with maintenance history cannot be deleted.', danger: true, confirmLabel: 'Delete' }))) return
    await guard(() => {
      deleteMachine(m)
      setMId(null)
    }, 'Machine deleted')
  }

  return (
    <div className="min-w-0">
      <PageHeader
        kicker="Operations"
        title={<span className="flex flex-wrap items-center gap-2">Machines & maintenance <ViewOnly show={!canManage} /></span>}
        subtitle={`${machines.length} machines across ${wcs.length} work centres · KIADB Doddaballapura plant`}
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<AlertOctagon className="h-4 w-4 text-rose-500" />} onClick={() => bdDlg.show()}>
                Report breakdown
              </Button>
              {tab === 'machines' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => machineDlg.show({ machine: null })}>
                  Add machine
                </Button>
              )}
              {tab === 'pm' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => schedDlg.show({ schedule: null })}>
                  New schedule
                </Button>
              )}
              {tab === 'wc' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => wcDlg.show()}>
                  Add work centre
                </Button>
              )}
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'machines', label: 'Machines', count: machines.length },
          { value: 'pm', label: 'PM schedule', count: kpi.pmOverdue },
          { value: 'log', label: 'Maintenance log', count: logs.filter((l) => l.status !== 'closed').length },
          { value: 'wc', label: 'Work centres' },
        ]}
      />

      {tab === 'machines' && <MachinesTab kpi={kpi} canManage={canManage} onOpen={(m) => setMId(m.id)} onStatus={changeStatus} onAdd={(wc) => machineDlg.show({ machine: null, wc })} onGo={setTab} />}
      {tab === 'pm' && (
        <PmTab
          canManage={canManage}
          initialFilter={kpi.pmOverdue ? 'overdue' : 'active'}
          onComplete={(sc) => pmDlg.show(sc)}
          onEdit={(sc) => schedDlg.show({ schedule: sc })}
          onDelete={async (sc) => {
            if (await confirm({ title: 'Delete PM schedule?', message: `"${sc.title}" will stop appearing in due lists. Past PM records are kept.`, danger: true, confirmLabel: 'Delete' })) await guard(() => deleteSchedule(sc), 'Schedule deleted')
          }}
          onOpenMachine={(id) => setMId(id)}
        />
      )}
      {tab === 'log' && <LogTab onOpen={(l) => logDlg.show(l)} />}
      {tab === 'wc' && (
        <WorkCentresTab
          canManage={canManage}
          onEdit={(w) => wcDlg.show(w)}
          onDelete={async (w) => {
            if (await confirm({ title: `Delete ${w.name}?`, message: 'Only empty work centres (no machines, people or open work orders) can be deleted.', danger: true, confirmLabel: 'Delete' })) await guard(() => deleteWorkCentre(w), 'Work centre deleted')
          }}
          onAddMachine={(wc) => machineDlg.show({ machine: null, wc })}
        />
      )}

      {drawerMachine && (
        <MachineDrawer
          open={!!liveMachine}
          onClose={() => setMId(null)}
          machine={liveMachine ?? drawerMachine}
          canManage={canManage}
          onEdit={() => machineDlg.show({ machine: liveMachine ?? drawerMachine })}
          onDelete={() => void removeMachine(liveMachine ?? drawerMachine)}
          onStatus={(st) => void changeStatus(liveMachine ?? drawerMachine, st)}
          onBreakdown={() => bdDlg.show(drawerMachine.id)}
          onCompletePm={(sc) => pmDlg.show(sc)}
          onAddSchedule={() => schedDlg.show({ schedule: null, machineId: drawerMachine.id })}
          onEditSchedule={(sc) => schedDlg.show({ schedule: sc })}
          onOpenLog={(l) => logDlg.show(l)}
        />
      )}
      {viewLog && (
        <LogDrawer
          open={logDlg.open}
          onClose={logDlg.close}
          log={viewLog}
          canManage={canManage}
          onUpdate={() => {
            logDlg.close()
            updDlg.show(viewLog)
          }}
        />
      )}

      <MachineForm key={`m${machineDlg.key}`} open={machineDlg.open} onClose={machineDlg.close} machine={machineDlg.data?.machine ?? null} defaultWc={machineDlg.data?.wc} />
      <WorkCentreForm key={`w${wcDlg.key}`} open={wcDlg.open} onClose={wcDlg.close} wc={wcDlg.data} />
      <ScheduleForm key={`s${schedDlg.key}`} open={schedDlg.open} onClose={schedDlg.close} schedule={schedDlg.data?.schedule ?? null} machineId={schedDlg.data?.machineId} />
      {pmDlg.data && <CompletePmForm key={`p${pmDlg.key}`} open={pmDlg.open} onClose={pmDlg.close} schedule={pmDlg.data} />}
      <BreakdownForm key={`b${bdDlg.key}`} open={bdDlg.open} onClose={bdDlg.close} machineId={bdDlg.data ?? undefined} />
      {updDlg.data && <LogUpdateForm key={`u${updDlg.key}`} open={updDlg.open} onClose={updDlg.close} log={updDlg.data} />}
    </div>
  )
}

/* ─────────────────────────── Machines tab ─────────────────────────── */

function MachinesTab({
  kpi, canManage, onOpen, onStatus, onAdd, onGo,
}: {
  kpi: ReturnType<typeof machineKpis>
  canManage: boolean
  onOpen: (m: Machine) => void
  onStatus: (m: Machine, s: MachineStatus) => void
  onAdd: (wc?: string) => void
  onGo: (t: Tab) => void
}) {
  const machines = useTable('machines')
  const wcs = useTable('work_centres')
  const schedules = useTable('maintenance_schedules')
  const logs = useTable('maintenance_logs')
  const today = todayISO()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<MachineStatus | ''>('')
  const [wcFilter, setWcFilter] = useState('')

  const nextPm = useMemo(() => {
    const m = new Map<string, MaintenanceSchedule>()
    for (const sc of schedules) if (sc.active && (!m.get(sc.machine_id) || sc.next_due < m.get(sc.machine_id)!.next_due)) m.set(sc.machine_id, sc)
    return m
  }, [schedules])
  const openJob = useMemo(() => {
    const m = new Map<string, MaintenanceLog>()
    for (const l of logs) if (l.status !== 'closed') m.set(l.machine_id, l)
    return m
  }, [logs])

  const filtering = !!(q.trim() || status || wcFilter)
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = machines.filter(
      (m) =>
        (!status || m.status === status) &&
        (!wcFilter || m.work_centre_id === wcFilter) &&
        (!needle || `${m.asset_code} ${m.name} ${m.make} ${m.model} ${m.serial_no}`.toLowerCase().includes(needle)),
    )
    return wcs
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((w) => ({ wc: w, machines: list.filter((m) => m.work_centre_id === w.id).sort((a, b) => a.asset_code.localeCompare(b.asset_code)) }))
      .filter((g) => g.machines.length || !filtering)
  }, [machines, wcs, q, status, wcFilter, filtering])

  const total = machines.length
  let idx = 0
  return (
    <div className="min-w-0">
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink-soft">Fleet status now</p>
            <span className="num text-[12.5px] text-ink-faint">{total} machines</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STATUSES.map((st) => {
              const active = status === st
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatus(active ? '' : st)}
                  className={cn('min-w-0 rounded-2xl border px-3 py-2.5 text-left transition', active ? 'border-transparent bg-indigo-50 ring-2 ring-brand-indigo/40' : 'border-indigo-100 bg-white/70 hover:border-indigo-200')}
                  aria-pressed={active}
                >
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft">
                    <StatusDot status={st} /> <span className="truncate">{MACHINE_STATUS_LABEL[st]}</span>
                  </span>
                  <span className="mt-1 block font-display text-2xl font-bold text-ink">
                    <AnimatedNumber value={kpi[st]} />
                  </span>
                </button>
              )
            })}
          </div>
          <MixBar className="mt-4" parts={STATUSES.map((st) => ({ label: MACHINE_STATUS_LABEL[st], value: kpi[st], color: MACHINE_STATUS_COLOR[st] }))} />
        </Card>
        <Card className="flex min-w-0 flex-col items-center gap-4 p-4 xs:flex-row sm:p-5">
          <Ring value={kpi.availability} label={pct(kpi.availability, 1)} sub="availability" size={104} />
          <div className="w-full min-w-0 flex-1 space-y-2">
            <p className="text-[12px] text-ink-faint">Availability = planned plant hours this month less downtime</p>
            <Metric icon={<Timer className="h-4 w-4" />} label="MTTR" value={`${num(kpi.mttrH, 1)} h`} hint="Avg breakdown downtime, this FY" />
            <Metric icon={<Gauge className="h-4 w-4" />} label="MTBF" value={`${num(kpi.mtbfH, 0)} h`} hint={kpi.breakdownsFy ? `Operating h ÷ ${kpi.breakdownsFy} breakdown${kpi.breakdownsFy === 1 ? '' : 's'} (FY)` : 'No breakdowns this FY'} />
          </div>
        </Card>
      </div>
      <KpiGrid>
        <StatCard label="PM overdue" value={kpi.pmOverdue} accent={kpi.pmOverdue ? 'red' : 'green'} icon={<CalendarClock className="h-4 w-4" />} hint={`${kpi.pmDueSoon} due in 7 days`} onClick={() => onGo('pm')} />
        <StatCard label="Open breakdowns" value={kpi.openBreakdowns} accent={kpi.openBreakdowns ? 'pink' : 'green'} icon={<AlertOctagon className="h-4 w-4" />} hint="Reported, not yet closed" onClick={() => onGo('log')} />
        <StatCard label="Downtime this month" value={kpi.downtimeMonthH} format={(n) => `${n.toFixed(1)} h`} accent="amber" icon={<Clock3 className="h-4 w-4" />} hint="Includes jobs still open" />
        <StatCard label="Running now" value={total ? (kpi.running / total) * 100 : 0} format={(n) => `${Math.round(n)}%`} accent="cyan" icon={<Cpu className="h-4 w-4" />} hint={`${kpi.running} of ${total} machines`} />
      </KpiGrid>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, make…" className="h-10 py-0 pl-9 text-sm" aria-label="Search machines" />
        </div>
        <FilterSelect label="Status" value={status} onChange={(v) => setStatus(v as MachineStatus | '')} options={STATUSES.map((st) => ({ value: st, label: MACHINE_STATUS_LABEL[st] }))} placeholder="All statuses" />
        <FilterSelect label="Work centre" value={wcFilter} onChange={setWcFilter} options={wcs.map((w) => ({ value: w.id, label: w.name }))} placeholder="All work centres" />
      </div>

      {!machines.length ? (
        <EmptyState title="No machines yet" description="Add the machines on the shop floor to track status, PM and breakdowns." icon={<Factory className="h-6 w-6" />} action={canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => onAdd()}>Add machine</Button>} />
      ) : !groups.length ? (
        <EmptyState
          title="No machines match"
          description="Clear the filters to see the whole fleet."
          action={
            <Button variant="secondary" onClick={() => { setQ(''); setStatus(''); setWcFilter('') }}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.wc.id} className="min-w-0">
              <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="h-5 w-1.5 rounded-full" style={{ background: g.wc.color }} />
                <h2 className="text-[15px] font-semibold text-ink">{g.wc.name}</h2>
                <span className="text-[12.5px] text-ink-faint">
                  {g.machines.length} machine{g.machines.length === 1 ? '' : 's'}
                </span>
                <MixBar className="ml-auto h-1.5 !w-28" parts={STATUSES.map((st) => ({ label: MACHINE_STATUS_LABEL[st], value: g.machines.filter((m) => m.status === st).length, color: MACHINE_STATUS_COLOR[st] }))} />
              </div>
              {g.machines.length ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.machines.map((m) => (
                    <MachineCard key={m.id} i={idx++} m={m} color={g.wc.color} nextPm={nextPm.get(m.id)} openJob={openJob.get(m.id)} today={today} canManage={canManage} onOpen={() => onOpen(m)} onStatus={(st) => onStatus(m, st)} />
                  ))}
                </div>
              ) : (
                <button type="button" disabled={!canManage} onClick={() => onAdd(g.wc.id)} className="w-full rounded-2xl border border-dashed border-indigo-200 bg-white/50 px-4 py-5 text-[13px] text-ink-soft transition enabled:hover:border-indigo-300 enabled:hover:text-ink">
                  No machines in this work centre{canManage ? ' — add one' : ''}
                </button>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-indigo-50/60 px-3 py-2">
      <span className="text-brand-indigo">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-ink-soft">{label}</span>
        <span className="block truncate text-[11.5px] text-ink-faint">{hint}</span>
      </span>
      <span className="num shrink-0 font-display text-lg font-bold text-ink">{value}</span>
    </div>
  )
}

function MachineCard({
  m, color, nextPm, openJob, today, canManage, onOpen, onStatus, i,
}: {
  m: Machine
  color: string
  nextPm?: MaintenanceSchedule
  openJob?: MaintenanceLog
  today: string
  canManage: boolean
  onOpen: () => void
  onStatus: (s: MachineStatus) => void
  i: number
}) {
  const pm = nextPm ? pmState(nextPm, today) : null
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="min-w-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onOpen()
          }
        }}
        className="card group relative h-full cursor-pointer overflow-hidden p-4 pl-5 transition-all duration-300 ease-brand hover:-translate-y-0.5 hover:shadow-lift"
      >
        <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold tracking-wide text-ink-faint">{m.asset_code}</p>
            <p className="truncate font-semibold text-ink">{m.name}</p>
            <p className="truncate text-[12.5px] text-ink-soft">{[m.make, m.model].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge tone={CRIT_TONE[m.criticality]} className="px-2">
              {m.criticality}
            </Badge>
            {canManage && (
              <Menu
                items={STATUSES.map((st) => ({
                  label: (
                    <span className="flex items-center gap-2">
                      <StatusDot status={st} /> {st === 'breakdown' ? 'Report breakdown…' : `Set ${MACHINE_STATUS_LABEL[st].toLowerCase()}`}
                    </span>
                  ),
                  onClick: () => onStatus(st),
                  disabled: st === m.status,
                }))}
              />
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: MACHINE_STATUS_COLOR[m.status] }}>
            <StatusDot status={m.status} /> {MACHINE_STATUS_LABEL[m.status]}
          </span>
          <span className="num text-[12px] text-ink-soft">{num(m.hour_meter, 0)} h</span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {openJob && (
            <Badge tone="red">
              {openJob.log_no} · {fmtDuration(liveDowntime(openJob))} down
            </Badge>
          )}
          {nextPm ? (
            <Badge tone={pm === 'overdue' ? 'red' : pm === 'due_soon' ? 'amber' : 'slate'}>PM {pm === 'overdue' ? `overdue ${diffDays(nextPm.next_due, today)} d` : fmtDate(nextPm.next_due)}</Badge>
          ) : (
            <Badge tone="slate">No PM plan</Badge>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ─────────────────────────── PM schedule tab ─────────────────────────── */

type PmFilter = 'active' | 'overdue' | 'due_soon' | 'inactive' | 'all'

function PmTab({
  canManage, initialFilter, onComplete, onEdit, onDelete, onOpenMachine,
}: {
  canManage: boolean
  initialFilter: PmFilter
  onComplete: (s: MaintenanceSchedule) => void
  onEdit: (s: MaintenanceSchedule) => void
  onDelete: (s: MaintenanceSchedule) => void
  onOpenMachine: (id: string) => void
}) {
  const schedules = useTable('maintenance_schedules')
  const machines = useTable('machines')
  const L = useLookups()
  const today = todayISO()
  const [filter, setFilter] = useState<PmFilter>(initialFilter)
  const [machine, setMachine] = useState('')
  const mMap = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines])
  const rows = useMemo(
    () =>
      schedules
        .filter((sc) => {
          if (machine && sc.machine_id !== machine) return false
          if (filter === 'all') return true
          if (filter === 'inactive') return !sc.active
          if (filter === 'active') return sc.active
          return pmState(sc, today) === filter
        })
        .sort((a, b) => a.next_due.localeCompare(b.next_due)),
    [schedules, filter, machine, today],
  )
  const counts = useMemo(
    () => ({ overdue: schedules.filter((sc) => pmState(sc, today) === 'overdue').length, due_soon: schedules.filter((sc) => pmState(sc, today) === 'due_soon').length }),
    [schedules, today],
  )

  const columns: Column<MaintenanceSchedule>[] = [
    {
      key: 'machine', header: 'Machine', value: (r) => mMap.get(r.machine_id)?.asset_code ?? '',
      cell: (r) => {
        const m = mMap.get(r.machine_id)
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenMachine(r.machine_id)
            }}
            className="block min-w-0 text-left"
          >
            <span className="block text-[12px] font-semibold text-ink-faint">{m?.asset_code}</span>
            <span className="block max-w-[200px] truncate font-medium text-ink hover:text-brand-indigo">{m?.name ?? '—'}</span>
          </button>
        )
      },
    },
    {
      key: 'title', header: 'Plan', value: (r) => r.title,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block font-medium">{r.title}</span>
          <span className="text-[12px] text-ink-faint">{r.checklist.length} checklist points</span>
        </span>
      ),
    },
    { key: 'freq', header: 'Frequency', value: (r) => FREQUENCY_LABEL[r.frequency] },
    { key: 'last', header: 'Last done', value: (r) => r.last_done ?? '', exportValue: (r) => fmtDate(r.last_done), cell: (r) => <span className="num">{fmtDate(r.last_done)}</span>, hideOnMobile: true },
    {
      key: 'next', header: 'Next due', value: (r) => r.next_due, exportValue: (r) => fmtDate(r.next_due),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="num">{fmtDate(r.next_due)}</span>
          <PmDueBadge s={r} today={today} />
        </span>
      ),
    },
    { key: 'tech', header: 'Technician', value: (r) => L.empName(r.assigned_to), cell: (r) => <EmployeeCell id={r.assigned_to} size={28} sub="none" /> },
    {
      key: 'act', header: '', export: false, sortable: false, align: 'right',
      cell: (r) =>
        canManage ? (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {r.active && (
              <Button size="sm" variant={pmState(r, today) === 'ok' ? 'secondary' : 'success'} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onComplete(r)}>
                Complete PM
              </Button>
            )}
            <Menu
              items={[
                { label: 'Edit schedule', icon: <Pencil />, onClick: () => onEdit(r) },
                { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => onDelete(r) },
              ]}
            />
          </span>
        ) : null,
    },
  ]
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      searchText={(r) => `${mMap.get(r.machine_id)?.asset_code} ${mMap.get(r.machine_id)?.name} ${r.title} ${L.empName(r.assigned_to)}`}
      searchPlaceholder="Search machine, plan, technician…"
      exportName="pm-schedule"
      exportSubtitle={`As on ${fmtDate(today)}`}
      onRowClick={canManage ? onEdit : (r) => onOpenMachine(r.machine_id)}
      toolbar={
        <>
          <FilterSelect
            label="Due state"
            value={filter}
            onChange={(v) => setFilter(v as PmFilter)}
            options={[
              { value: 'active', label: 'All active' },
              { value: 'overdue', label: `Overdue (${counts.overdue})` },
              { value: 'due_soon', label: `Due in 7 days (${counts.due_soon})` },
              { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'Everything' },
            ]}
          />
          <FilterSelect label="Machine" value={machine} onChange={setMachine} options={machines.slice().sort((a, b) => a.asset_code.localeCompare(b.asset_code)).map((m) => ({ value: m.id, label: m.asset_code }))} placeholder="All machines" />
        </>
      }
      empty={<EmptyState title={filter === 'overdue' ? 'Nothing overdue' : 'No schedules'} description={filter === 'overdue' ? 'Every active PM plan is on time.' : 'Change the filter or add a PM schedule.'} icon={<CalendarClock className="h-6 w-6" />} />}
      mobileCard={(r) => {
        const m = mMap.get(r.machine_id)
        return (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink-faint">{m?.asset_code}</p>
                <p className="truncate font-semibold text-ink">{r.title}</p>
                <p className="text-[12px] text-ink-soft">
                  {FREQUENCY_LABEL[r.frequency]} · next {fmtDate(r.next_due)}
                </p>
              </div>
              <PmDueBadge s={r} today={today} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <EmployeeCell id={r.assigned_to} size={26} sub="none" />
              {canManage && r.active && (
                <span onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onComplete(r)}>
                    Complete
                  </Button>
                </span>
              )}
            </div>
          </div>
        )
      }}
    />
  )
}

/* ─────────────────────────── Maintenance log tab ─────────────────────────── */

function LogTab({ onOpen }: { onOpen: (l: MaintenanceLog) => void }) {
  const logs = useTable('maintenance_logs')
  const machines = useTable('machines')
  const L = useLookups()
  const [type, setType] = useState<MaintenanceType | ''>('')
  const [status, setStatus] = useState<MaintenanceLog['status'] | ''>('')
  const [machine, setMachine] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const mMap = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines])
  const rows = useMemo(
    () =>
      logs
        .filter((l) => {
          const d = toISODate(new Date(l.reported_at))
          return (!type || l.type === type) && (!status || l.status === status) && (!machine || l.machine_id === machine) && (!from || d >= from) && (!to || d <= to)
        })
        .sort((a, b) => ((a.status === 'closed') === (b.status === 'closed') ? b.reported_at.localeCompare(a.reported_at) : a.status === 'closed' ? 1 : -1)),
    [logs, type, status, machine, from, to],
  )
  const totalDown = rows.reduce((s, l) => s + liveDowntime(l), 0)
  const totalCost = rows.reduce((s, l) => s + l.cost + sparesValue(l.spares), 0)
  const openCount = rows.filter((r) => r.status !== 'closed').length

  const columns: Column<MaintenanceLog>[] = [
    { key: 'no', header: 'Job', value: (r) => r.log_no, cell: (r) => <span className="font-semibold text-ink">{r.log_no}</span> },
    {
      key: 'machine', header: 'Machine', value: (r) => mMap.get(r.machine_id)?.asset_code ?? '',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block text-[12px] font-semibold text-ink-faint">{mMap.get(r.machine_id)?.asset_code}</span>
          <span className="block max-w-[180px] truncate">{mMap.get(r.machine_id)?.name}</span>
        </span>
      ),
    },
    {
      key: 'type', header: 'Type', value: (r) => MAINT_TYPE_LABEL[r.type],
      cell: (r) => <Badge tone={r.type === 'breakdown' ? 'red' : r.type === 'preventive' ? 'indigo' : r.type === 'calibration' ? 'violet' : 'amber'}>{MAINT_TYPE_LABEL[r.type]}</Badge>,
    },
    { key: 'problem', header: 'Problem', value: (r) => r.problem, cell: (r) => <span className="block max-w-[260px] truncate" title={r.problem}>{r.problem}</span>, hideOnMobile: true },
    { key: 'reported', header: 'Reported', value: (r) => r.reported_at, exportValue: (r) => fmtDateTime(r.reported_at), cell: (r) => <span className="num whitespace-nowrap">{fmtDateTime(r.reported_at)}</span> },
    {
      key: 'down', header: 'Downtime (min)', align: 'right', value: (r) => liveDowntime(r),
      cell: (r) => <span className={cn('num', r.status !== 'closed' && 'font-semibold text-rose-600')}>{fmtDuration(liveDowntime(r))}</span>,
    },
    { key: 'tech', header: 'Technician', value: (r) => L.empName(r.technician_id), hideOnMobile: true },
    { key: 'cost', header: 'Cost incl. spares', align: 'right', value: (r) => r.cost + sparesValue(r.spares), cell: (r) => inr(r.cost + sparesValue(r.spares)), hideOnMobile: true },
    { key: 'status', header: 'Status', value: (r) => LOG_STATUS_LABEL[r.status], cell: (r) => <StatusBadge status={r.status} label={LOG_STATUS_LABEL[r.status]} /> },
  ]
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-soft">
        <span>
          <b className="num text-ink">{rows.length}</b> jobs
        </span>
        <span>
          Downtime <b className="num text-ink">{fmtDuration(totalDown)}</b>
        </span>
        <span>
          Cost incl. spares <b className="num text-ink">{inr(totalCost)}</b>
        </span>
        {openCount > 0 && (
          <span className="flex items-center gap-1 font-semibold text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" /> {openCount} open
          </span>
        )}
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        searchText={(r) => `${r.log_no} ${mMap.get(r.machine_id)?.asset_code} ${mMap.get(r.machine_id)?.name} ${r.problem} ${r.action_taken} ${r.root_cause} ${L.empName(r.technician_id)}`}
        searchPlaceholder="Search job, machine, problem…"
        exportName="maintenance-log"
        exportSubtitle={from || to ? `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : '…'}` : undefined}
        toolbar={
          <>
            <FilterSelect label="Type" value={type} onChange={(v) => setType(v as MaintenanceType | '')} options={(Object.keys(MAINT_TYPE_LABEL) as MaintenanceType[]).map((t) => ({ value: t, label: MAINT_TYPE_LABEL[t] }))} placeholder="All types" />
            <FilterSelect label="Status" value={status} onChange={(v) => setStatus(v as MaintenanceLog['status'] | '')} options={(['open', 'in_progress', 'closed'] as const).map((x) => ({ value: x, label: LOG_STATUS_LABEL[x] }))} placeholder="All statuses" />
            <FilterSelect label="Machine" value={machine} onChange={setMachine} options={machines.slice().sort((a, b) => a.asset_code.localeCompare(b.asset_code)).map((m) => ({ value: m.id, label: m.asset_code }))} placeholder="All machines" />
            <DateRange
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f)
                setTo(t)
              }}
            />
          </>
        }
        empty={<EmptyState title="No maintenance jobs" description="Nothing matches these filters." icon={<Wrench className="h-6 w-6" />} />}
      />
    </div>
  )
}

/* ─────────────────────────── Work centres tab ─────────────────────────── */

function WorkCentresTab({ canManage, onEdit, onDelete, onAddMachine }: { canManage: boolean; onEdit: (w: WorkCentre) => void; onDelete: (w: WorkCentre) => void; onAddMachine: (wcId: string) => void }) {
  const wcs = useTable('work_centres')
  const machines = useTable('machines')
  const employees = useTable('employees')
  const list = useMemo(() => wcs.slice().sort((a, b) => a.code.localeCompare(b.code)), [wcs])
  if (!list.length) return <EmptyState title="No work centres" description="Add the plant's work centres to group machines and route work orders." icon={<Factory className="h-6 w-6" />} />
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((w, i) => {
        const ms = machines.filter((m) => m.work_centre_id === w.id)
        const people = employees.filter((e) => e.work_centre_id === w.id && e.status !== 'exited').length
        return (
          <motion.div key={w.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.4 }} className="card min-w-0 overflow-hidden">
            <div className="h-1.5" style={{ background: w.color }} />
            <div className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Chip color={w.color}>{w.code}</Chip>
                  <h3 className="mt-2 truncate text-[16px] font-semibold text-ink">{w.name}</h3>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-soft">{w.description || '—'}</p>
                </div>
                {canManage && (
                  <Menu
                    items={[
                      { label: 'Edit', icon: <Pencil />, onClick: () => onEdit(w) },
                      { label: 'Add machine here', icon: <Plus />, onClick: () => onAddMachine(w.id) },
                      { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => onDelete(w) },
                    ]}
                  />
                )}
              </div>
              <div className="mt-4 flex min-w-0 items-center justify-between gap-3">
                <span className="shrink-0 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Supervisor</span>
                <span className="min-w-0">
                  <EmployeeCell id={w.supervisor_id} size={26} />
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-indigo-50/60 px-3 py-2">
                  <p className="text-[11.5px] font-semibold text-ink-faint">Machines</p>
                  <p className="num font-display text-xl font-bold text-ink">{ms.length}</p>
                </div>
                <div className="rounded-xl bg-indigo-50/60 px-3 py-2">
                  <p className="text-[11.5px] font-semibold text-ink-faint">People</p>
                  <p className="num font-display text-xl font-bold text-ink">{people}</p>
                </div>
              </div>
              <MixBar className="mt-4" parts={STATUSES.map((st) => ({ label: MACHINE_STATUS_LABEL[st], value: ms.filter((m) => m.status === st).length, color: MACHINE_STATUS_COLOR[st] }))} />
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-soft">
                {STATUSES.map((st) => (
                  <li key={st} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: MACHINE_STATUS_COLOR[st] }} />
                    {MACHINE_STATUS_LABEL[st]} <b className="num text-ink">{ms.filter((m) => m.status === st).length}</b>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
