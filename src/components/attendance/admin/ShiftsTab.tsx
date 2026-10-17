/**
 * Shift master — timings, break, grace, half/full-day thresholds and weekly offs.
 * These drive computePunch (late / worked / OT) and the week-off logic everywhere.
 */
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Coffee, Pencil, Plus, Timer, Trash2, Users } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Shift } from '@/data/types'
import { fmtDuration, fmtHHMM, hhmmToMinutes, WEEKDAYS } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { useSession } from '@/services/session'
import { deleteShift, isNightShift, saveShift, validateShift, type ShiftInput } from '@/services/attendance'
import { Badge, Button, confirm, EmptyState, Field, Input, Menu, Modal, Switch, toast } from '@/components/ui'

const COLORS = ['#6366f1', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#f97316', '#8b5cf6', '#0ea5e9']
const BLANK: ShiftInput = { code: '', name: '', start_time: '09:00', end_time: '17:00', break_minutes: 30, grace_minutes: 10, half_day_minutes: 240, full_day_minutes: 450, weekly_offs: [0], color: '#6366f1', active: true }

export function ShiftsTab() {
  const s = useSession()
  const shifts = useTable('shifts')
  const employees = useTable('employees')
  const [editing, setEditing] = useState<Shift | 'new' | null>(null)
  const manage = s.can('attendance.manage')

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of employees) if (e.status !== 'exited') m.set(e.shift_id, (m.get(e.shift_id) ?? 0) + 1)
    return m
  }, [employees])
  const list = [...shifts].sort((a, b) => Number(b.active) - Number(a.active) || a.start_time.localeCompare(b.start_time))

  const remove = async (sh: Shift) => {
    const ok = await confirm({ title: `Delete shift ${sh.code}?`, message: 'This cannot be undone. Shifts with attendance history can only be deactivated.', danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    try {
      deleteShift(sh)
      toast.success(`Shift ${sh.code} deleted`)
    } catch (e) {
      toast.error('Can’t delete', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-soft">Late = check-in after start + grace · Half day = worked below the half-day minutes · OT counted in 15-min blocks after shift end.</p>
        {manage && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            New shift
          </Button>
        )}
      </div>
      {!list.length ? (
        <EmptyState title="No shifts yet" description="Create the General shift first — every employee needs one." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((sh, i) => {
            const n = counts.get(sh.id) ?? 0
            let span = hhmmToMinutes(sh.end_time) - hhmmToMinutes(sh.start_time)
            if (span <= 0) span += 1440
            return (
              <motion.div key={sh.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.35 }} className={cn('card relative min-w-0 overflow-hidden p-4 sm:p-5', !sh.active && 'opacity-70')}>
                <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: sh.color }} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md px-1.5 py-0.5 text-[11.5px] font-bold text-white" style={{ background: sh.color }}>
                        {sh.code}
                      </span>
                      {!sh.active && <Badge tone="slate">Inactive</Badge>}
                      {isNightShift(sh) && <Badge tone="violet">Night</Badge>}
                    </div>
                    <h3 className="mt-1.5 truncate text-[16px] font-semibold text-ink">{sh.name}</h3>
                  </div>
                  {manage && (
                    <Menu
                      items={[
                        { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(sh) },
                        { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => void remove(sh), disabled: n > 0 },
                      ]}
                    />
                  )}
                </div>
                <p className="num mt-2 font-display text-[22px] font-bold text-ink">
                  {fmtHHMM(sh.start_time)} <span className="text-ink-faint">–</span> {fmtHHMM(sh.end_time)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-ink-soft">
                  <span className="flex items-center gap-1.5"><Coffee className="h-3.5 w-3.5" /> {sh.break_minutes} min break</span>
                  <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {sh.grace_minutes} min grace</span>
                  <span className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> Half day &lt; {fmtDuration(sh.half_day_minutes)}</span>
                  <span className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> Full day {fmtDuration(sh.full_day_minutes)}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-indigo-50 pt-3">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <span key={d} title={sh.weekly_offs.includes(d) ? 'Weekly off' : 'Working day'} className={cn('grid h-6 w-6 place-items-center rounded-md text-[10px] font-bold', sh.weekly_offs.includes(d) ? 'bg-rose-50 text-rose-500' : 'bg-indigo-50 text-indigo-600')}>
                        {WEEKDAYS[d]!.slice(0, 1)}
                      </span>
                    ))}
                  </div>
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <Users className="h-3.5 w-3.5 text-ink-faint" /> {n} employee{n === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-2 text-[11.5px] text-ink-faint">Span {fmtDuration(span)}</p>
              </motion.div>
            )
          })}
        </div>
      )}
      <ShiftModal editing={editing} onClose={() => setEditing(null)} assigned={editing && editing !== 'new' ? counts.get(editing.id) ?? 0 : 0} />
    </div>
  )
}

function ShiftModal({ editing, onClose, assigned }: { editing: Shift | 'new' | null; onClose: () => void; assigned: number }) {
  const [f, setF] = useState<ShiftInput>(BLANK)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!editing) return
    if (editing === 'new') setF(BLANK)
    else {
      const e = editing
      setF({ code: e.code, name: e.name, start_time: e.start_time, end_time: e.end_time, break_minutes: e.break_minutes, grace_minutes: e.grace_minutes, half_day_minutes: e.half_day_minutes, full_day_minutes: e.full_day_minutes, weekly_offs: [...e.weekly_offs], color: e.color, active: e.active })
    }
    setTouched(new Set())
  }, [editing])
  const errors = validateShift(f, editing && editing !== 'new' ? editing.id : undefined)
  const ok = Object.keys(errors).length === 0
  const set = <K extends keyof ShiftInput>(k: K, v: ShiftInput[K]) => {
    setF((p) => ({ ...p, [k]: v }))
    setTouched((t) => new Set(t).add(k))
  }
  const err = (k: keyof ShiftInput) => (touched.has(k) ? errors[k] : undefined)
  const numIn = (k: 'break_minutes' | 'grace_minutes' | 'half_day_minutes' | 'full_day_minutes', label: string, hint?: string) => (
    <Field label={label} required error={err(k)} hint={hint}>
      <Input type="number" inputMode="numeric" min={0} value={Number.isFinite(f[k]) ? f[k] : ''} onChange={(e) => set(k, e.target.value === '' ? NaN : Number(e.target.value))} invalid={!!err(k)} />
    </Field>
  )

  const save = () => {
    setTouched(new Set(Object.keys(BLANK)))
    if (!ok) return
    try {
      const row = saveShift(f, editing && editing !== 'new' ? editing : undefined)
      toast.success(editing === 'new' ? `Shift ${row.code} created` : `Shift ${row.code} updated`, assigned && editing !== 'new' ? `Applies to new punches of ${assigned} employee${assigned === 1 ? '' : 's'}.` : undefined)
      onClose()
    } catch (e) {
      toast.error('Could not save shift', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      title={editing === 'new' ? 'New shift' : `Edit shift ${editing ? (editing as Shift).code : ''}`}
      subtitle="Changes apply to new punches and marks; past records keep their computed values."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ok}>
            {editing === 'new' ? 'Create shift' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
          <Field label="Code" required error={err('code')}>
            <Input value={f.code} maxLength={12} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="GEN" invalid={!!err('code')} />
          </Field>
          <Field label="Name" required error={err('name')}>
            <Input value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="General Shift" invalid={!!err('name')} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Start" required error={err('start_time')}>
            <Input type="time" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} invalid={!!err('start_time')} />
          </Field>
          <Field label="End" required error={err('end_time')} hint={f.end_time && f.start_time && f.end_time < f.start_time ? 'Ends next day (night shift)' : undefined}>
            <Input type="time" value={f.end_time} onChange={(e) => set('end_time', e.target.value)} invalid={!!err('end_time')} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 md:grid-cols-4">
          {numIn('break_minutes', 'Break (min)', 'Deducted after 5 h')}
          {numIn('grace_minutes', 'Grace (min)', 'Late after this')}
          {numIn('half_day_minutes', 'Half-day below (min)')}
          {numIn('full_day_minutes', 'Full day (min)')}
        </div>
        <Field label="Weekly offs" error={err('weekly_offs')}>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = f.weekly_offs.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('weekly_offs', on ? f.weekly_offs.filter((x) => x !== d) : [...f.weekly_offs, d])}
                  className={cn('h-9 min-w-[48px] rounded-xl border px-2.5 text-[13px] font-semibold transition', on ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-indigo-100 bg-white text-ink-soft hover:border-indigo-200')}
                >
                  {WEEKDAYS[d]}
                </button>
              )
            })}
          </div>
        </Field>
        <Field label="Colour" error={err('color')}>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set('color', c)} aria-label={`Colour ${c}`} className={cn('h-8 w-8 rounded-full ring-offset-2 transition', f.color === c && 'ring-2 ring-ink')} style={{ background: c }} />
            ))}
            <input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} className="h-8 w-10 cursor-pointer rounded-lg border border-indigo-100 bg-white" aria-label="Custom colour" />
          </div>
        </Field>
        <div className="rounded-2xl border border-indigo-100 bg-white/70 p-3">
          <Switch checked={f.active} onChange={(v) => set('active', v)} label="Active" description={assigned && !f.active ? `${assigned} employee${assigned === 1 ? ' is' : 's are'} on this shift — move them first.` : 'Inactive shifts can’t be assigned to employees.'} />
        </div>
      </div>
    </Modal>
  )
}
