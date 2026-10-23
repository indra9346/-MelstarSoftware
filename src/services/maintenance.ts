/**
 * Machines, work centres, preventive-maintenance schedules and the maintenance log.
 * Spares used are issued from stock through postMovement() (reference = log number).
 */
import { db } from '@/data/store'
import type {
  CompanySettings, Frequency, Holiday, HHMM, Machine, MachineStatus, MaintenanceLog, MaintenanceSchedule, MaintenanceType, SpareUsed, WorkCentre,
} from '@/data/types'
import { addDays, combine, dayOfWeek, eachDay, fyOf, fyRange, hhmmToMinutes, minutesBetween, monthOf, todayISO, toISODate } from '@/lib/dates'
import { nextNumber } from '@/lib/ids'
import { round2 } from '@/lib/format'
import { audit, diff } from './audit'
import { assertAvailable, postMovement, requirePerm, round3 } from './inventory'

export const FREQ_DAYS: Record<Frequency, number> = { daily: 1, weekly: 7, monthly: 30, quarterly: 91, half_yearly: 182, yearly: 365 }
export const FREQUENCY_LABEL: Record<Frequency, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' }
export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = { running: 'Running', idle: 'Idle', breakdown: 'Breakdown', maintenance: 'Maintenance' }
export const MACHINE_STATUS_COLOR: Record<MachineStatus, string> = { running: '#3a8f5c', idle: '#94a3b8', breakdown: '#c94a4a', maintenance: '#d08c1e' }
export const MAINT_TYPE_LABEL: Record<MaintenanceType, string> = { preventive: 'Preventive', breakdown: 'Breakdown', corrective: 'Corrective', calibration: 'Calibration' }
export const LOG_STATUS_LABEL: Record<MaintenanceLog['status'], string> = { open: 'Open', in_progress: 'In progress', closed: 'Closed' }

const firstError = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean)
const nextLogNo = () => nextNumber('MNT-', db.all('maintenance_logs').map((l) => l.log_no))
export const HEX_RE = /^#[0-9a-fA-F]{6}$/

/* ─────────────────────────── work centres ─────────────────────────── */

export interface WorkCentreInput {
  code: string
  name: string
  description: string
  color: string
  supervisor_id: string | null
}

export function workCentreErrors(v: WorkCentreInput, id?: string): Partial<Record<keyof WorkCentreInput, string>> {
  const e: Partial<Record<keyof WorkCentreInput, string>> = {}
  const code = v.code.trim().toUpperCase()
  if (!code) e.code = 'Code is required'
  else if (!/^[A-Z0-9-]{2,10}$/.test(code)) e.code = '2–10 capital letters, digits or -'
  else if (db.find('work_centres', (w) => w.code.toUpperCase() === code && w.id !== id)) e.code = 'Code already used'
  const name = v.name.trim()
  if (!name) e.name = 'Name is required'
  else if (db.find('work_centres', (w) => w.name.toLowerCase() === name.toLowerCase() && w.id !== id)) e.name = 'Name already used'
  if (!HEX_RE.test(v.color)) e.color = 'Pick a colour'
  return e
}

export function saveWorkCentre(existing: WorkCentre | null, v: WorkCentreInput): WorkCentre {
  requirePerm('machines.manage')
  const err = firstError(workCentreErrors(v, existing?.id))
  if (err) throw new Error(err)
  const row = { code: v.code.trim().toUpperCase(), name: v.name.trim(), description: v.description.trim(), color: v.color.toLowerCase(), supervisor_id: v.supervisor_id || null }
  if (!existing) {
    const w = db.insert('work_centres', row)
    audit('create', 'work_centres', w.id, `Added work centre ${w.code} — ${w.name}`)
    return w
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const w = db.update('work_centres', existing.id, row)
  audit('update', 'work_centres', w.id, `Updated work centre ${w.code}`, changes)
  return w
}

export function deleteWorkCentre(w: WorkCentre) {
  requirePerm('machines.manage')
  const machines = db.count('machines', (m) => m.work_centre_id === w.id)
  if (machines) throw new Error(`${w.name} still has ${machines} machine${machines === 1 ? '' : 's'} — move them first.`)
  const people = db.count('employees', (e) => e.work_centre_id === w.id && e.status !== 'exited')
  if (people) throw new Error(`${people} employee${people === 1 ? ' is' : 's are'} assigned to ${w.name} — reassign them first.`)
  const wos = db.count('work_orders', (o) => o.route_work_centre_ids.includes(w.id) && !['dispatched', 'cancelled'].includes(o.status))
  if (wos) throw new Error(`${wos} open work order${wos === 1 ? ' routes' : 's route'} through ${w.name}.`)
  db.remove('work_centres', w.id)
  audit('delete', 'work_centres', w.id, `Deleted work centre ${w.code} — ${w.name}`)
}

/* ─────────────────────────── machines ─────────────────────────── */

export interface MachineInput {
  asset_code: string
  name: string
  make: string
  model: string
  serial_no: string
  work_centre_id: string
  install_date: string
  status: MachineStatus
  criticality: Machine['criticality']
  hour_meter: number | null
  specs: string
  notes: string
}

export function machineErrors(v: MachineInput, id?: string): Partial<Record<keyof MachineInput, string>> {
  const e: Partial<Record<keyof MachineInput, string>> = {}
  const code = v.asset_code.trim().toUpperCase()
  if (!code) e.asset_code = 'Asset code is required'
  else if (!/^[A-Z0-9][A-Z0-9._/-]{1,29}$/.test(code)) e.asset_code = 'Capital letters, digits, . _ / -'
  else if (db.find('machines', (m) => m.asset_code.toUpperCase() === code && m.id !== id)) e.asset_code = 'Asset code already used'
  if (!v.name.trim()) e.name = 'Name is required'
  if (!v.work_centre_id) e.work_centre_id = 'Choose a work centre'
  if (!v.install_date) e.install_date = 'Install date is required'
  else if (v.install_date > todayISO()) e.install_date = 'Cannot be in the future'
  if (v.hour_meter == null) e.hour_meter = 'Required (0 for new)'
  else if (v.hour_meter < 0) e.hour_meter = 'Cannot be negative'
  else if (v.hour_meter >= 1e9) e.hour_meter = 'Too large'
  return e
}

export function saveMachine(existing: Machine | null, v: MachineInput): Machine {
  requirePerm('machines.manage')
  const err = firstError(machineErrors(v, existing?.id))
  if (err) throw new Error(err)
  const row = {
    asset_code: v.asset_code.trim().toUpperCase(), name: v.name.trim(), make: v.make.trim(), model: v.model.trim(), serial_no: v.serial_no.trim(),
    work_centre_id: v.work_centre_id, install_date: v.install_date, status: v.status, criticality: v.criticality,
    hour_meter: Math.round((v.hour_meter ?? 0) * 10) / 10, specs: v.specs.trim(), notes: v.notes.trim(),
  }
  if (!existing) {
    const m = db.insert('machines', row)
    audit('create', 'machines', m.id, `Added machine ${m.asset_code} — ${m.name}`)
    return m
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const m = db.update('machines', existing.id, row)
  audit('update', 'machines', m.id, `Updated machine ${m.asset_code}`, changes)
  return m
}

export function deleteMachine(m: Machine) {
  requirePerm('machines.manage')
  const logs = db.count('maintenance_logs', (l) => l.machine_id === m.id)
  if (logs) throw new Error(`${m.asset_code} has ${logs} maintenance record${logs === 1 ? '' : 's'} — history cannot be deleted.`)
  db.batch(() => {
    for (const s of db.where('maintenance_schedules', (s) => s.machine_id === m.id)) db.remove('maintenance_schedules', s.id)
    db.remove('machines', m.id)
  })
  audit('delete', 'machines', m.id, `Deleted machine ${m.asset_code} — ${m.name}`)
}

export function setMachineStatus(m: Machine, status: MachineStatus): Machine {
  requirePerm('machines.manage')
  if (m.status === status) return m
  const row = db.update('machines', m.id, { status })
  audit('update', 'machines', m.id, `${m.asset_code} status: ${MACHINE_STATUS_LABEL[m.status]} → ${MACHINE_STATUS_LABEL[status]}`, { status: { from: m.status, to: status } })
  return row
}

/* ─────────────────────────── PM schedules ─────────────────────────── */

export interface ScheduleInput {
  machine_id: string
  title: string
  frequency: Frequency
  next_due: string
  checklist: string[]
  assigned_to: string | null
  active: boolean
}

export function scheduleErrors(v: ScheduleInput): Partial<Record<keyof ScheduleInput, string>> {
  const e: Partial<Record<keyof ScheduleInput, string>> = {}
  if (!v.machine_id) e.machine_id = 'Choose a machine'
  if (!v.title.trim()) e.title = 'Title is required'
  if (!v.next_due) e.next_due = 'Next due date is required'
  if (!v.checklist.some((c) => c.trim())) e.checklist = 'Add at least one checklist point'
  return e
}

export function saveSchedule(existing: MaintenanceSchedule | null, v: ScheduleInput): MaintenanceSchedule {
  requirePerm('machines.manage')
  const err = firstError(scheduleErrors(v))
  if (err) throw new Error(err)
  const row = {
    machine_id: v.machine_id, title: v.title.trim(), frequency: v.frequency, next_due: v.next_due,
    checklist: v.checklist.map((c) => c.trim()).filter(Boolean), assigned_to: v.assigned_to || null, active: v.active,
  }
  const code = db.get('machines', v.machine_id)?.asset_code ?? ''
  if (!existing) {
    const s = db.insert('maintenance_schedules', { ...row, last_done: null })
    audit('create', 'maintenance_schedules', s.id, `PM schedule "${s.title}" for ${code} (${FREQUENCY_LABEL[s.frequency]})`)
    return s
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const s = db.update('maintenance_schedules', existing.id, row)
  audit('update', 'maintenance_schedules', s.id, `Updated PM schedule "${s.title}" (${code})`, changes)
  return s
}

export function deleteSchedule(s: MaintenanceSchedule) {
  requirePerm('machines.manage')
  db.remove('maintenance_schedules', s.id)
  audit('delete', 'maintenance_schedules', s.id, `Deleted PM schedule "${s.title}" (${db.get('machines', s.machine_id)?.asset_code ?? ''})`)
}

export type PmState = 'overdue' | 'due_soon' | 'ok' | 'inactive'
export function pmState(s: MaintenanceSchedule, today = todayISO()): PmState {
  if (!s.active) return 'inactive'
  if (s.next_due < today) return 'overdue'
  if (s.next_due <= addDays(today, 7)) return 'due_soon'
  return 'ok'
}

/* ─────────────────────────── spares ─────────────────────────── */

/** Net change per item between two spares lists (new − old). */
function sparesDelta(oldSpares: SpareUsed[], newSpares: SpareUsed[]) {
  const m = new Map<string, number>()
  for (const s of newSpares) m.set(s.item_id, round3((m.get(s.item_id) ?? 0) + s.qty))
  for (const s of oldSpares) m.set(s.item_id, round3((m.get(s.item_id) ?? 0) - s.qty))
  return [...m].filter(([, q]) => q !== 0).map(([item_id, qty]) => ({ item_id, qty }))
}

function mergeSpares(spares: SpareUsed[]): SpareUsed[] {
  const m = new Map<string, number>()
  for (const s of spares) if (s.item_id && s.qty > 0) m.set(s.item_id, round3((m.get(s.item_id) ?? 0) + s.qty))
  return [...m].map(([item_id, qty]) => ({ item_id, qty }))
}

/** Issue/return spares for a log so stock matches the log's spares list. */
function syncSpares(logNo: string, machineCode: string, oldSpares: SpareUsed[], newSpares: SpareUsed[], date: string) {
  const delta = sparesDelta(oldSpares, newSpares)
  assertAvailable(delta.filter((d) => d.qty > 0))
  for (const d of delta) {
    if (d.qty > 0) postMovement({ itemId: d.item_id, type: 'out', qty: d.qty, date, reference: logNo, reason: `Spares for ${machineCode}` })
    else postMovement({ itemId: d.item_id, type: 'in', qty: -d.qty, date, reference: logNo, reason: `Unused spares returned (${machineCode})` })
  }
}

export const sparesValue = (spares: SpareUsed[]) => round2(spares.reduce((s, x) => s + x.qty * (db.get('inventory_items', x.item_id)?.unit_cost ?? 0), 0))

/* ─────────────────────────── complete PM ─────────────────────────── */

export interface CompletePmInput {
  date: string
  start: HHMM
  end: HHMM
  technician_id: string | null
  checklistDone: boolean[]
  spares: SpareUsed[]
  cost: number | null
  remarks: string
  machineStatus: MachineStatus
}

export function completePmErrors(s: MaintenanceSchedule, v: CompletePmInput): Partial<Record<keyof CompletePmInput, string>> {
  const e: Partial<Record<keyof CompletePmInput, string>> = {}
  const today = todayISO()
  if (!v.date) e.date = 'Date is required'
  else if (v.date > today) e.date = 'Cannot be in the future'
  else if (s.last_done && v.date < s.last_done) e.date = `Last PM was on ${s.last_done}`
  if (!v.start) e.start = 'Required'
  if (!v.end) e.end = 'Required'
  else if (v.start && hhmmToMinutes(v.end) <= hhmmToMinutes(v.start)) e.end = 'End must be after start'
  else if (v.date === today && v.end && hhmmToMinutes(v.end) > new Date().getHours() * 60 + new Date().getMinutes()) e.end = 'End time is still ahead'
  if (!v.technician_id) e.technician_id = 'Who did the PM?'
  if (v.cost == null) e.cost = 'Required (0 if none)'
  else if (v.cost < 0) e.cost = 'Cannot be negative'
  const skipped = v.checklistDone.filter((d) => !d).length
  if (skipped && !v.remarks.trim()) e.remarks = `${skipped} checklist point${skipped === 1 ? '' : 's'} not ticked — explain in remarks`
  return e
}

export function completePm(s: MaintenanceSchedule, v: CompletePmInput): MaintenanceLog {
  requirePerm('machines.manage')
  const err = firstError(completePmErrors(s, v))
  if (err) throw new Error(err)
  const machine = db.get('machines', s.machine_id)
  if (!machine) throw new Error('Machine not found.')
  const spares = mergeSpares(v.spares)
  assertAvailable(spares)
  const startIso = combine(v.date, v.start).toISOString()
  const endIso = combine(v.date, v.end).toISOString()
  const downtime = minutesBetween(startIso, endIso)
  const done = s.checklist.filter((_, i) => v.checklistDone[i])
  const skipped = s.checklist.filter((_, i) => !v.checklistDone[i])
  const action = [
    `Checklist ${done.length}/${s.checklist.length} completed${done.length ? ': ' + done.join(', ') : ''}.`,
    skipped.length ? `Not done: ${skipped.join(', ')}.` : '',
    v.remarks.trim(),
  ].filter(Boolean).join(' ')
  const logNo = nextLogNo()
  const nextDue = addDays(v.date, FREQ_DAYS[s.frequency])
  return db.batch(() => {
    const log = db.insert('maintenance_logs', {
      log_no: logNo, machine_id: s.machine_id, type: 'preventive', schedule_id: s.id, reported_at: startIso, started_at: startIso, completed_at: endIso,
      downtime_minutes: downtime, problem: s.title, action_taken: action, root_cause: '', technician_id: v.technician_id, spares, cost: round2(v.cost ?? 0), status: 'closed',
    })
    syncSpares(logNo, machine.asset_code, [], spares, v.date)
    // never move the plan backwards if a later PM was already recorded
    const patch = { last_done: v.date, next_due: s.last_done && s.last_done > v.date ? s.next_due : nextDue }
    db.update('maintenance_schedules', s.id, patch)
    if (machine.status !== v.machineStatus) db.update('machines', machine.id, { status: v.machineStatus })
    audit('process', 'maintenance_logs', log.id, `PM completed ${logNo} — ${machine.asset_code} "${s.title}" (${downtime} min); next due ${patch.next_due}`, diff(s, patch))
    return log
  })
}

/* ─────────────────────────── breakdowns / log updates ─────────────────────────── */

export interface BreakdownInput {
  machine_id: string
  problem: string
  reported_at: string // ISO
  technician_id: string | null
  type: Extract<MaintenanceType, 'breakdown' | 'corrective'>
}

export function breakdownErrors(v: BreakdownInput): Partial<Record<keyof BreakdownInput, string>> {
  const e: Partial<Record<keyof BreakdownInput, string>> = {}
  if (!v.machine_id) e.machine_id = 'Choose the machine'
  else if (v.type === 'breakdown' && db.find('maintenance_logs', (l) => l.machine_id === v.machine_id && l.type === 'breakdown' && l.status !== 'closed'))
    e.machine_id = 'This machine already has an open breakdown'
  if (!v.problem.trim()) e.problem = 'Describe the problem'
  if (!v.reported_at || Number.isNaN(new Date(v.reported_at).getTime())) e.reported_at = 'Required'
  else if (new Date(v.reported_at).getTime() > Date.now() + 60_000) e.reported_at = 'Cannot be in the future'
  return e
}

export function reportBreakdown(v: BreakdownInput): MaintenanceLog {
  requirePerm('machines.manage')
  const err = firstError(breakdownErrors(v))
  if (err) throw new Error(err)
  const machine = db.get('machines', v.machine_id)
  if (!machine) throw new Error('Machine not found.')
  const logNo = nextLogNo()
  return db.batch(() => {
    const log = db.insert('maintenance_logs', {
      log_no: logNo, machine_id: machine.id, type: v.type, schedule_id: null, reported_at: v.reported_at, started_at: null, completed_at: null,
      downtime_minutes: 0, problem: v.problem.trim(), action_taken: '', root_cause: '', technician_id: v.technician_id || null, spares: [], cost: 0, status: 'open',
    })
    const status: MachineStatus = v.type === 'breakdown' ? 'breakdown' : 'maintenance'
    if (machine.status !== status) db.update('machines', machine.id, { status })
    audit('create', 'maintenance_logs', log.id, `${MAINT_TYPE_LABEL[v.type]} reported ${logNo} — ${machine.asset_code}: ${log.problem}`, { status: { from: machine.status, to: status } })
    return log
  })
}

export interface LogUpdateInput {
  started_at: string | null
  completed_at: string | null
  action_taken: string
  root_cause: string
  technician_id: string | null
  spares: SpareUsed[]
  cost: number | null
  close: boolean
  machineStatus: MachineStatus
}

/** Downtime: breakdowns count from the report (machine down), other work from the start. */
export function logDowntime(log: Pick<MaintenanceLog, 'type' | 'reported_at' | 'started_at'>, completedAt: string): number {
  const from = log.type === 'breakdown' ? log.reported_at : log.started_at ?? log.reported_at
  return Math.max(0, minutesBetween(from, completedAt))
}

export function logUpdateErrors(log: MaintenanceLog, v: LogUpdateInput): Partial<Record<keyof LogUpdateInput, string>> {
  const e: Partial<Record<keyof LogUpdateInput, string>> = {}
  const now = Date.now() + 60_000
  const rep = new Date(log.reported_at).getTime()
  const st = v.started_at ? new Date(v.started_at).getTime() : null
  const en = v.completed_at ? new Date(v.completed_at).getTime() : null
  if (st != null && Number.isNaN(st)) e.started_at = 'Invalid date/time'
  else if (st != null && st < rep) e.started_at = 'Before the report time'
  else if (st != null && st > now) e.started_at = 'Cannot be in the future'
  if (v.close) {
    if (en == null) e.completed_at = 'Completion time is required to close'
    else if (Number.isNaN(en)) e.completed_at = 'Invalid date/time'
    else if (en > now) e.completed_at = 'Cannot be in the future'
    else if (st != null && en < st) e.completed_at = 'Before the start time'
    else if (en < rep) e.completed_at = 'Before the report time'
    if (!v.action_taken.trim()) e.action_taken = 'Describe the action taken'
    if (!v.started_at) e.started_at = 'Start time is required to close'
  }
  if (v.cost == null) e.cost = 'Required (0 if none)'
  else if (v.cost < 0) e.cost = 'Cannot be negative'
  return e
}

export function updateLog(log: MaintenanceLog, v: LogUpdateInput): MaintenanceLog {
  requirePerm('machines.manage')
  if (log.status === 'closed') throw new Error(`${log.log_no} is already closed.`)
  const err = firstError(logUpdateErrors(log, v))
  if (err) throw new Error(err)
  const machine = db.get('machines', log.machine_id)
  if (!machine) throw new Error('Machine not found.')
  const spares = mergeSpares(v.spares)
  const completed = v.close ? v.completed_at : null
  const patch: Partial<MaintenanceLog> = {
    started_at: v.started_at, completed_at: completed, action_taken: v.action_taken.trim(), root_cause: v.root_cause.trim(),
    technician_id: v.technician_id || null, spares, cost: round2(v.cost ?? 0),
    downtime_minutes: completed ? logDowntime({ type: log.type, reported_at: log.reported_at, started_at: v.started_at }, completed) : 0,
    status: v.close ? 'closed' : v.started_at ? 'in_progress' : 'open',
  }
  const date = toISODate(new Date(completed ?? Date.now()))
  return db.batch(() => {
    syncSpares(log.log_no, machine.asset_code, log.spares, spares, date > todayISO() ? todayISO() : date)
    const row = db.update('maintenance_logs', log.id, patch)
    if (v.close && machine.status !== v.machineStatus) db.update('machines', machine.id, { status: v.machineStatus })
    audit(v.close ? 'process' : 'update', 'maintenance_logs', log.id, v.close ? `Closed ${log.log_no} — ${machine.asset_code} back to ${MACHINE_STATUS_LABEL[v.machineStatus]} (${patch.downtime_minutes} min down)` : `Updated ${log.log_no} — ${machine.asset_code}`, diff(log, patch))
    return row
  })
}

/* ─────────────────────────── KPIs ─────────────────────────── */

/** Minutes of downtime per log, attributed to a month (closed: completion month; open: live). */
export function downtimeMinutesInMonth(log: MaintenanceLog, ym: string, now = new Date()): number {
  if (log.status === 'closed') {
    const when = log.completed_at ?? log.reported_at
    return monthOf(toISODate(new Date(when))) === ym ? log.downtime_minutes : 0
  }
  const monthStartMs = combine(`${ym}-01`, '00:00').getTime()
  const from = Math.max(new Date(log.type === 'breakdown' ? log.reported_at : log.started_at ?? log.reported_at).getTime(), monthStartMs)
  return monthOf(toISODate(now)) === ym ? Math.max(0, Math.round((now.getTime() - from) / 60000)) : 0
}

/** Downtime so far for an open / in-progress job. */
export function liveDowntime(log: MaintenanceLog, now = new Date()): number {
  if (log.status === 'closed') return log.downtime_minutes
  const from = new Date(log.type === 'breakdown' ? log.reported_at : log.started_at ?? log.reported_at).getTime()
  return Math.max(0, Math.round((now.getTime() - from) / 60000))
}

export function plannedHoursPerDay(s: Pick<CompanySettings, 'plant_open' | 'plant_close'>): number {
  try {
    const h = (hhmmToMinutes(s.plant_close) - hhmmToMinutes(s.plant_open)) / 60
    return h > 0 ? h : 8
  } catch {
    return 8
  }
}

/** Plant working days in a range (weekday working days minus plant-closure holidays). */
export function workingDays(from: string, to: string, settings: Pick<CompanySettings, 'working_days'>, holidays: Holiday[]): string[] {
  if (to < from) return []
  const closed = new Set(holidays.filter((h) => h.type !== 'optional').map((h) => h.date))
  return eachDay(from, to).filter((d) => settings.working_days.includes(dayOfWeek(d)) && !closed.has(d))
}

export interface MachineKpis {
  running: number
  idle: number
  breakdown: number
  maintenance: number
  pmOverdue: number
  pmDueSoon: number
  openBreakdowns: number
  downtimeMonthH: number
  mttrH: number
  mtbfH: number
  breakdownsFy: number
  availability: number
}

export function machineKpis(
  machines: Machine[], schedules: MaintenanceSchedule[], logs: MaintenanceLog[], settings: CompanySettings, holidays: Holiday[], today = todayISO(), now = new Date(),
): MachineKpis {
  const ym = monthOf(today)
  const fy = fyRange(fyOf(today, settings.financial_year_start_month || 4), settings.financial_year_start_month || 4)
  const count = (s: MachineStatus) => machines.filter((m) => m.status === s).length
  const downtimeMonth = logs.reduce((s, l) => s + downtimeMinutesInMonth(l, ym, now), 0)
  const fyBreakdowns = logs.filter((l) => l.type === 'breakdown' && toISODate(new Date(l.reported_at)) >= fy.from && toISODate(new Date(l.reported_at)) <= today)
  const closedBd = fyBreakdowns.filter((l) => l.status === 'closed')
  const mttr = closedBd.length ? closedBd.reduce((s, l) => s + l.downtime_minutes, 0) / closedBd.length / 60 : 0
  const hpd = plannedHoursPerDay(settings)
  const fyDays = workingDays(fy.from, today, settings, holidays)
  const monthDays = fyDays.filter((d) => d.startsWith(ym))
  const machineHours = (days: string[]) => machines.reduce((s, m) => s + days.filter((d) => d >= m.install_date).length * hpd, 0)
  const fyDownH = logs
    .filter((l) => toISODate(new Date(l.reported_at)) >= fy.from)
    .reduce((s, l) => s + (l.status === 'closed' ? l.downtime_minutes : liveDowntime(l, now)), 0) / 60
  const fyOperating = Math.max(0, machineHours(fyDays) - fyDownH)
  const monthPlanned = machineHours(monthDays)
  return {
    running: count('running'),
    idle: count('idle'),
    breakdown: count('breakdown'),
    maintenance: count('maintenance'),
    pmOverdue: schedules.filter((s) => pmState(s, today) === 'overdue').length,
    pmDueSoon: schedules.filter((s) => pmState(s, today) === 'due_soon').length,
    openBreakdowns: logs.filter((l) => l.type === 'breakdown' && l.status !== 'closed').length,
    downtimeMonthH: round2(downtimeMonth / 60),
    mttrH: round2(mttr),
    mtbfH: fyBreakdowns.length ? round2(fyOperating / fyBreakdowns.length) : round2(fyOperating),
    breakdownsFy: fyBreakdowns.length,
    availability: monthPlanned > 0 ? Math.max(0, Math.min(100, ((monthPlanned - downtimeMonth / 60) / monthPlanned) * 100)) : 100,
  }
}
