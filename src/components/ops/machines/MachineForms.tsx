/** Machines module dialogs: machine, work centre, PM schedule, complete PM, report breakdown, update/close job. */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Clock3, ListChecks, Wrench } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { Frequency, Machine, MachineStatus, MaintenanceLog, MaintenanceSchedule, WorkCentre } from '@/data/types'
import { Badge, Checkbox, Field, Modal, Segmented, Select, guard, toast } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { addDays, fmtDate, fmtDateTime, fmtDuration, hhmmToMinutes, todayISO } from '@/lib/dates'
import { cn } from '@/lib/misc'
import {
  FREQ_DAYS, FREQUENCY_LABEL, MACHINE_STATUS_LABEL, MAINT_TYPE_LABEL, breakdownErrors, completePm, completePmErrors, logDowntime, logUpdateErrors, machineErrors,
  reportBreakdown, saveMachine, saveSchedule, saveWorkCentre, scheduleErrors, updateLog, workCentreErrors, type MachineInput,
} from '@/services/maintenance'
import { useForm, toNum, numStr, isoToLocalInput, localInputToIso, nowLocalInput, nowHHMM } from '../form'
import { AreaF, DateF, NumF, SelectF, TextF } from '../fields'
import { ColorPicker, FormSection, ModalActions } from '../kit'
import { SparesEditor, rowsFromSpares, sparesErrors, sparesFromRows, type SpareRow } from '../SparesEditor'

const STATUS_OPTIONS = (Object.keys(MACHINE_STATUS_LABEL) as MachineStatus[]).map((s) => ({ value: s, label: MACHINE_STATUS_LABEL[s] }))
const FREQ_OPTIONS = (Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => ({ value: f, label: `${FREQUENCY_LABEL[f]} (every ${FREQ_DAYS[f]} d)` }))

interface MachineV { asset_code: string; name: string; make: string; model: string; serial_no: string; work_centre_id: string; install_date: string; status: string; criticality: string; hour_meter: string; specs: string; notes: string }
interface ScheduleV { machine_id: string; title: string; frequency: string; next_due: string; checklist: string; assigned_to: string; active: boolean }
interface PmV { date: string; start: string; end: string; technician_id: string; checklistDone: boolean[]; cost: string; remarks: string; machineStatus: string }
interface BreakdownV { machine_id: string; problem: string; reported_at: string; technician_id: string; type: 'breakdown' | 'corrective' }
interface LogV { started_at: string; completed_at: string; action_taken: string; root_cause: string; technician_id: string; cost: string; close: boolean; machineStatus: string }

interface DialogProps {
  open: boolean
  onClose: () => void
}

/* ─────────────────────────── machine ─────────────────────────── */

export function MachineForm({ open, onClose, machine, defaultWc }: DialogProps & { machine: Machine | null; defaultWc?: string }) {
  const wcs = useTable('work_centres')
  const f = useForm<MachineV>(
    () => ({
      asset_code: machine?.asset_code ?? '', name: machine?.name ?? '', make: machine?.make ?? '', model: machine?.model ?? '', serial_no: machine?.serial_no ?? '',
      work_centre_id: machine?.work_centre_id ?? defaultWc ?? '', install_date: machine?.install_date ?? todayISO(), status: (machine?.status ?? 'idle') as string,
      criticality: (machine?.criticality ?? 'B') as string, hour_meter: numStr(machine?.hour_meter ?? 0), specs: machine?.specs ?? '', notes: machine?.notes ?? '',
    }),
    (v) => machineErrors(toInput(v), machine?.id),
  )
  function toInput(v: MachineV): MachineInput {
    return { ...v, status: v.status as MachineStatus, criticality: v.criticality as Machine['criticality'], hour_meter: toNum(v.hour_meter) }
  }
  const submit = () =>
    void guard(() => {
      saveMachine(machine, toInput(f.v))
      onClose()
    }, machine ? 'Machine updated' : 'Machine added')
  return (
    <Modal open={open} onClose={onClose} size="lg" title={machine ? `Edit ${machine.asset_code}` : 'Add machine'} subtitle="Asset register entry for the plant floor" footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={machine ? 'Save changes' : 'Add machine'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextF f={f} k="asset_code" label="Asset code" required placeholder="MC-CNC-04" onBlur={() => f.set('asset_code', f.v.asset_code.trim().toUpperCase())} />
        <TextF f={f} k="name" label="Machine name" required placeholder="CNC Turning Centre 4" />
        <TextF f={f} k="make" label="Make" placeholder="ACE Micromatic" />
        <TextF f={f} k="model" label="Model" placeholder="Jobber XL" />
        <TextF f={f} k="serial_no" label="Serial no." />
        <SelectF f={f} k="work_centre_id" label="Work centre" required options={wcs.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} placeholder="Choose…" />
        <DateF f={f} k="install_date" label="Install date" required max={todayISO()} />
        <NumF f={f} k="hour_meter" label="Hour meter (h)" required min={0} step="0.1" />
        <Field label="Criticality" required hint="A = line stops without it · C = easily bypassed">
          <Segmented value={f.v.criticality} onChange={(v) => f.set('criticality', v)} options={['A', 'B', 'C'].map((c) => ({ value: c, label: c }))} className="w-full" />
        </Field>
        <SelectF f={f} k="status" label="Current status" required options={STATUS_OPTIONS} />
        <AreaF f={f} k="specs" label="Specifications" className="sm:col-span-2" rows={2} placeholder="Swing, travel, controller, spindle …" />
        <AreaF f={f} k="notes" label="Notes" className="sm:col-span-2" rows={2} />
      </div>
    </Modal>
  )
}

/* ─────────────────────────── work centre ─────────────────────────── */

export function WorkCentreForm({ open, onClose, wc }: DialogProps & { wc: WorkCentre | null }) {
  const L = useLookups()
  const f = useForm(
    () => ({ code: wc?.code ?? '', name: wc?.name ?? '', description: wc?.description ?? '', color: wc?.color ?? '#6366f1', supervisor_id: wc?.supervisor_id ?? '' }),
    (v) => workCentreErrors(v, wc?.id),
  )
  const submit = () =>
    void guard(() => {
      saveWorkCentre(wc, { ...f.v, supervisor_id: f.v.supervisor_id || null })
      onClose()
    }, wc ? 'Work centre updated' : 'Work centre added')
  return (
    <Modal open={open} onClose={onClose} title={wc ? `Edit ${wc.name}` : 'Add work centre'} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={wc ? 'Save changes' : 'Add work centre'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
        <TextF f={f} k="code" label="Code" required placeholder="GRD" onBlur={() => f.set('code', f.v.code.trim().toUpperCase())} />
        <TextF f={f} k="name" label="Name" required placeholder="Grinding Cell" />
        <AreaF f={f} k="description" label="Description" className="sm:col-span-2" rows={2} />
        <Field label="Colour" required error={f.err('color')} className="sm:col-span-2">
          <ColorPicker value={f.v.color} onChange={(c) => f.set('color', c)} />
        </Field>
        <SelectF f={f} k="supervisor_id" label="Supervisor" className="sm:col-span-2" options={L.employeeOptions()} placeholder="— None —" />
      </div>
    </Modal>
  )
}

/* ─────────────────────────── PM schedule ─────────────────────────── */

export function ScheduleForm({ open, onClose, schedule, machineId }: DialogProps & { schedule: MaintenanceSchedule | null; machineId?: string }) {
  const L = useLookups()
  const machines = useTable('machines')
  const f = useForm<ScheduleV>(
    () => ({
      machine_id: schedule?.machine_id ?? machineId ?? '', title: schedule?.title ?? 'Monthly preventive maintenance', frequency: (schedule?.frequency ?? 'monthly') as string,
      next_due: schedule?.next_due ?? addDays(todayISO(), 7), checklist: (schedule?.checklist ?? []).join('\n'), assigned_to: schedule?.assigned_to ?? '', active: schedule?.active ?? true,
    }),
    (v) => scheduleErrors(toInput(v)),
  )
  function toInput(v: ScheduleV) {
    return { ...v, frequency: v.frequency as Frequency, checklist: v.checklist.split('\n'), assigned_to: v.assigned_to || null }
  }
  const submit = () =>
    void guard(() => {
      saveSchedule(schedule, toInput(f.v))
      onClose()
    }, schedule ? 'Schedule updated' : 'PM schedule added')
  const points = f.v.checklist.split('\n').filter((c) => c.trim()).length
  return (
    <Modal open={open} onClose={onClose} size="lg" title={schedule ? 'Edit PM schedule' : 'New PM schedule'} subtitle={schedule?.last_done ? `Last done ${fmtDate(schedule.last_done)}` : 'Preventive maintenance plan'} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={schedule ? 'Save changes' : 'Add schedule'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectF f={f} k="machine_id" label="Machine" required className="sm:col-span-2" options={machines.slice().sort((a, b) => a.asset_code.localeCompare(b.asset_code)).map((m) => ({ value: m.id, label: `${m.asset_code} — ${m.name}` }))} placeholder="Choose…" />
        <TextF f={f} k="title" label="Title" required className="sm:col-span-2" />
        <SelectF f={f} k="frequency" label="Frequency" required options={FREQ_OPTIONS} />
        <DateF f={f} k="next_due" label="Next due" required />
        <SelectF f={f} k="assigned_to" label="Assigned technician" options={L.employeeOptions()} placeholder="— Unassigned —" className="sm:col-span-2" />
        <AreaF f={f} k="checklist" label={`Checklist (${points} point${points === 1 ? '' : 's'})`} required hint="One point per line" className="sm:col-span-2" rows={5} placeholder={'Lubrication points\nWay-cover & wipers\nCoolant tank cleaning'} />
        <div className="sm:col-span-2">
          <Checkbox checked={f.v.active} onChange={(v) => f.set('active', v)} label="Active (shows in due / overdue lists)" />
        </div>
      </div>
    </Modal>
  )
}

/* ─────────────────────────── complete PM ─────────────────────────── */

export function CompletePmForm({ open, onClose, schedule }: DialogProps & { schedule: MaintenanceSchedule }) {
  const L = useLookups()
  const machine = db.get('machines', schedule.machine_id)
  const [spares, setSpares] = useState<SpareRow[]>([])
  const items = useTable('inventory_items')
  const f = useForm<PmV>(
    () => {
      const end = nowHHMM()
      const startMin = Math.max(0, hhmmToMinutes(end) - 60)
      return {
        date: todayISO(), start: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`, end,
        technician_id: schedule.assigned_to ?? '', checklistDone: schedule.checklist.map(() => false), cost: '0', remarks: '',
        machineStatus: (machine && machine.status !== 'maintenance' ? machine.status : 'running') as string,
      }
    },
    (v) => completePmErrors(schedule, toInput(v)),
  )
  function toInput(v: PmV) {
    return { ...v, technician_id: v.technician_id || null, spares: sparesFromRows(spares), cost: toNum(v.cost), machineStatus: v.machineStatus as MachineStatus }
  }
  const stock = useMemo(() => new Map(items.map((i) => [i.id, i.stock_qty])), [items])
  const spareErrs = sparesErrors(spares, stock)
  const valid = f.valid && spareErrs.every((e) => !e)
  const mins = f.v.start && f.v.end ? hhmmToMinutes(f.v.end) - hhmmToMinutes(f.v.start) : 0
  const done = f.v.checklistDone.filter(Boolean).length
  const submit = () =>
    void guard(async () => {
      const log = completePm(schedule, toInput(f.v))
      await db.flushed()
      onClose()
      toast.success('PM completed', `${log.log_no} logged · next due ${fmtDate(addDays(f.v.date, FREQ_DAYS[schedule.frequency]))}`)
    })
  const toggle = (i: number, on: boolean) => f.set('checklistDone', f.v.checklistDone.map((d, j) => (j === i ? on : d)))
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Complete PM"
      subtitle={`${machine?.asset_code ?? ''} · ${schedule.title} · ${FREQUENCY_LABEL[schedule.frequency]}`}
      footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!valid} hint={f.firstError ?? spareErrs.find(Boolean) ?? null} label="Complete PM" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} />}
    >
      <div className="space-y-5">
        <FormSection
          title={<span className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Checklist</span>}
          action={
            <button type="button" className="text-[12.5px] font-semibold text-brand-indigo hover:underline" onClick={() => f.set('checklistDone', schedule.checklist.map(() => done < schedule.checklist.length))}>
              {done < schedule.checklist.length ? 'Tick all' : 'Clear all'}
            </button>
          }
        >
          <div className="mb-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-indigo-100/70">
              <motion.div className="h-full rounded-full bg-grad" animate={{ width: `${schedule.checklist.length ? (done / schedule.checklist.length) * 100 : 0}%` }} transition={{ duration: 0.35 }} />
            </div>
            <span className="num text-[12px] font-semibold text-ink-soft">{done}/{schedule.checklist.length}</span>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {schedule.checklist.map((c, i) => (
              <li key={i} className={cn('rounded-xl border px-3 py-2 transition-colors', f.v.checklistDone[i] ? 'border-emerald-200 bg-emerald-50/60' : 'border-indigo-100 bg-white')}>
                <Checkbox checked={!!f.v.checklistDone[i]} onChange={(v) => toggle(i, v)} label={<span className={cn('text-[13.5px]', f.v.checklistDone[i] && 'text-ink-soft line-through')}>{c}</span>} />
              </li>
            ))}
          </ul>
        </FormSection>

        <FormSection title={<span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Time & people</span>}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateF f={f} k="date" label="Date" required max={todayISO()} min={schedule.last_done ?? undefined} />
            <DateF f={f} k="start" type="time" label="Start" required />
            <DateF f={f} k="end" type="time" label="End" required hint={mins > 0 ? `Downtime ${fmtDuration(mins)}` : undefined} />
            <SelectF f={f} k="technician_id" label="Technician" required options={L.employeeOptions()} placeholder="Choose…" className="sm:col-span-2" />
            <SelectF f={f} k="machineStatus" label="Machine after PM" required options={STATUS_OPTIONS} />
          </div>
        </FormSection>

        <FormSection title={<span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Spares & cost</span>}>
          <SparesEditor rows={spares} onChange={setSpares} />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumF f={f} k="cost" label="Other cost (₹)" required min={0} hint="Labour / outside service" />
            <AreaF f={f} k="remarks" label="Remarks" className="sm:col-span-2" rows={2} placeholder="Observations, readings, follow-ups…" />
          </div>
        </FormSection>
      </div>
    </Modal>
  )
}

/* ─────────────────────────── report breakdown ─────────────────────────── */

export function BreakdownForm({ open, onClose, machineId }: DialogProps & { machineId?: string }) {
  const L = useLookups()
  const machines = useTable('machines')
  const f = useForm<BreakdownV>(
    () => ({ machine_id: machineId ?? '', problem: '', reported_at: nowLocalInput(), technician_id: '', type: 'breakdown' as 'breakdown' | 'corrective' }),
    (v) => breakdownErrors(toInput(v)),
  )
  function toInput(v: BreakdownV) {
    return { ...v, reported_at: localInputToIso(v.reported_at) ?? '', technician_id: v.technician_id || null }
  }
  const m = machines.find((x) => x.id === f.v.machine_id)
  const submit = () =>
    void guard(async () => {
      const log = reportBreakdown(toInput(f.v))
      await db.flushed()
      onClose()
      toast.warning(`${MAINT_TYPE_LABEL[log.type]} logged — ${log.log_no}`, `${m?.asset_code ?? ''} marked ${log.type === 'breakdown' ? 'breakdown' : 'under maintenance'}`)
    })
  return (
    <Modal open={open} onClose={onClose} title="Report breakdown" subtitle="Opens a job and takes the machine out of service" footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label="Report" variant="danger" />}>
      <div className="grid grid-cols-1 gap-4">
        <Field label="Type" required>
          <Segmented value={f.v.type} onChange={(v) => f.set('type', v)} options={[{ value: 'breakdown', label: 'Breakdown' }, { value: 'corrective', label: 'Corrective job' }]} />
        </Field>
        <SelectF f={f} k="machine_id" label="Machine" required options={machines.slice().sort((a, b) => a.asset_code.localeCompare(b.asset_code)).map((x) => ({ value: x.id, label: `${x.asset_code} — ${x.name} (${MACHINE_STATUS_LABEL[x.status]})` }))} placeholder="Choose…" />
        {m?.criticality === 'A' && <Badge tone="red" className="w-fit">Criticality A — line-stopping machine</Badge>}
        <AreaF f={f} k="problem" label="Problem" required rows={3} placeholder="Alarm code, symptoms, what the operator saw…" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateF f={f} k="reported_at" type="datetime-local" label="Reported at" required max={nowLocalInput()} />
          <SelectF f={f} k="technician_id" label="Technician" options={L.employeeOptions()} placeholder="— Assign later —" />
        </div>
      </div>
    </Modal>
  )
}

/* ─────────────────────────── update / close a job ─────────────────────────── */

export function LogUpdateForm({ open, onClose, log }: DialogProps & { log: MaintenanceLog }) {
  const L = useLookups()
  const machine = db.get('machines', log.machine_id)
  const items = useTable('inventory_items')
  const [spares, setSpares] = useState<SpareRow[]>(() => rowsFromSpares(log.spares))
  const f = useForm<LogV>(
    () => ({
      started_at: isoToLocalInput(log.started_at) || nowLocalInput(), completed_at: isoToLocalInput(log.completed_at) || nowLocalInput(), action_taken: log.action_taken,
      root_cause: log.root_cause, technician_id: log.technician_id ?? '', cost: numStr(log.cost), close: true, machineStatus: 'running',
    }),
    (v) => logUpdateErrors(log, toInput(v)),
  )
  function toInput(v: LogV) {
    return {
      started_at: localInputToIso(v.started_at), completed_at: localInputToIso(v.completed_at), action_taken: v.action_taken, root_cause: v.root_cause,
      technician_id: v.technician_id || null, spares: sparesFromRows(spares), cost: toNum(v.cost), close: v.close, machineStatus: v.machineStatus as MachineStatus,
    }
  }
  const stock = useMemo(() => new Map(items.map((i) => [i.id, i.stock_qty])), [items])
  const spareErrs = sparesErrors(spares, stock, log.spares)
  const valid = f.valid && spareErrs.every((e) => !e)
  const st = localInputToIso(f.v.started_at)
  const en = localInputToIso(f.v.completed_at)
  const down = f.v.close && en ? logDowntime({ type: log.type, reported_at: log.reported_at, started_at: st }, en) : null
  const repair = f.v.close && en && st ? Math.max(0, Math.round((new Date(en).getTime() - new Date(st).getTime()) / 60000)) : null
  const submit = () =>
    void guard(async () => {
      updateLog(log, toInput(f.v))
      await db.flushed()
      onClose()
      toast.success(f.v.close ? `${log.log_no} closed` : `${log.log_no} updated`, f.v.close ? `${machine?.asset_code ?? ''} → ${MACHINE_STATUS_LABEL[f.v.machineStatus as MachineStatus]}` : undefined)
    })
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Update ${log.log_no}`}
      subtitle={`${machine?.asset_code ?? ''} · ${MAINT_TYPE_LABEL[log.type]} · reported ${fmtDateTime(log.reported_at)}`}
      footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!valid} hint={f.firstError ?? spareErrs.find(Boolean) ?? null} label={f.v.close ? 'Close job' : 'Save progress'} variant={f.v.close ? 'success' : 'primary'} />}
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 px-4 py-3 text-[13.5px] text-ink">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-600">Problem</p>
          <p className="mt-0.5">{log.problem}</p>
        </div>
        <Field label="Action">
          <Segmented value={f.v.close ? 'close' : 'progress'} onChange={(v) => f.set('close', v === 'close')} options={[{ value: 'progress', label: 'Work in progress' }, { value: 'close', label: 'Close the job' }]} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateF f={f} k="started_at" type="datetime-local" label="Work started" required={f.v.close} max={nowLocalInput()} />
          {f.v.close && <DateF f={f} k="completed_at" type="datetime-local" label="Completed" required max={nowLocalInput()} />}
          {f.v.close && down != null && (
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <div className="rounded-xl bg-indigo-50/70 px-3 py-2 text-[12.5px] text-ink-soft">Repair time <b className="num block text-[15px] text-ink">{repair != null ? fmtDuration(repair) : '—'}</b></div>
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-ink-soft">Downtime {log.type === 'breakdown' ? '(from report)' : ''} <b className="num block text-[15px] text-ink">{fmtDuration(down)}</b></div>
            </div>
          )}
          <AreaF f={f} k="action_taken" label="Action taken" required={f.v.close} className="sm:col-span-2" rows={3} />
          <AreaF f={f} k="root_cause" label="Root cause" className="sm:col-span-2" rows={2} placeholder="Why did it fail? (helps prevent repeats)" />
          <SelectF f={f} k="technician_id" label="Technician" options={L.employeeOptions()} placeholder="— Unassigned —" />
          <NumF f={f} k="cost" label="Cost (₹)" required min={0} hint="Labour / outside service" />
          {f.v.close && (
            <Field label="Machine status after" required className="sm:col-span-2">
              <Select value={f.v.machineStatus} onChange={(e) => f.set('machineStatus', e.target.value)} options={STATUS_OPTIONS} />
            </Field>
          )}
        </div>
        <FormSection title="Spares used">
          <SparesEditor rows={spares} onChange={setSpares} already={log.spares} />
          {log.spares.length > 0 && <p className="mt-2 text-[12px] text-ink-faint">Already drawn for this job are included; lowering a quantity returns the difference to stock.</p>}
        </FormSection>
        {log.technician_id && (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            Reported technician: <EmployeeCell id={log.technician_id} size={24} sub="none" />
          </div>
        )}
      </div>
    </Modal>
  )
}
