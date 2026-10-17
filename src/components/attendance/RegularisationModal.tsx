/**
 * Self-service: request an attendance correction for a recent day (≤ today, last 30 days).
 */
import { useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { useTable } from '@/data/store'
import type { AttendanceStatus, Employee, ISODate } from '@/data/types'
import { DAY_STATUS_META } from '@/lib/attendance'
import { addDays, fmtDay, fmtTime } from '@/lib/dates'
import { REGULARISATION_WINDOW_DAYS, requestRegularisation, validateRegularisation, type RegularisationInput } from '@/services/attendance'
import { Button, Field, Input, Modal, Segmented, Textarea, toast } from '@/components/ui'
import { SourceBadge, useToday } from './shared'

const STATUSES: AttendanceStatus[] = ['present', 'half_day', 'on_duty']

export function RegularisationModal({ open, onClose, employee, date }: { open: boolean; onClose: () => void; employee: Employee; date?: ISODate }) {
  const today = useToday()
  const attendance = useTable('attendance')
  const regs = useTable('regularisations')
  const shifts = useTable('shifts')
  const blank = (d: ISODate): RegularisationInput => ({ date: d, checkIn: '', checkOut: '', status: 'present', reason: '' })
  const [form, setForm] = useState<RegularisationInput>(blank(date ?? today))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const d = date ?? today
    const rec = attendance.find((a) => a.employee_id === employee.id && a.date === d)
    setForm({ ...blank(d), status: rec?.status === 'half_day' || rec?.status === 'on_duty' ? rec.status : 'present' })
    setTouched(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date])

  const record = attendance.find((a) => a.employee_id === employee.id && a.date === form.date)
  const shift = shifts.find((s) => s.id === (record?.shift_id ?? employee.shift_id))
  // regs is a dependency so the duplicate check re-runs when requests change
  const errors = useMemo(() => validateRegularisation(employee, form, today), [employee, form, today, regs, attendance]) // eslint-disable-line react-hooks/exhaustive-deps
  const ok = Object.keys(errors).length === 0
  const set = <K extends keyof RegularisationInput>(k: K, v: RegularisationInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTouched((t) => new Set(t).add(k))
  }
  const err = (k: keyof RegularisationInput) => (touched.has(k) || (k === 'date' && !!form.date) ? errors[k] : undefined)

  const submit = async () => {
    setTouched(new Set(['date', 'checkIn', 'checkOut', 'status', 'reason']))
    if (!ok) return
    setSaving(true)
    try {
      requestRegularisation(employee, form)
      toast.success('Correction requested', `HR will review your request for ${fmtDay(form.date)}.`)
      onClose()
    } catch (e) {
      toast.error('Could not submit', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request attendance correction"
      subtitle={`For missed or wrong punches in the last ${REGULARISATION_WINDOW_DAYS} days`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!ok}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Date" required error={err('date')}>
          <Input type="date" value={form.date} min={addDays(today, -REGULARISATION_WINDOW_DAYS)} max={today} onChange={(e) => set('date', e.target.value)} invalid={!!err('date')} />
        </Field>

        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3 text-[13px]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Currently recorded</p>
          {record ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-ink">
              <span className="font-semibold">{DAY_STATUS_META[record.status].label}</span>
              <span className="num text-ink-soft">
                {fmtTime(record.check_in)} – {fmtTime(record.check_out)}
              </span>
              <SourceBadge source={record.source} />
            </div>
          ) : (
            <p className="mt-1 text-ink-soft">No punch recorded for this day.</p>
          )}
          {shift && <p className="mt-1 text-[12px] text-ink-soft">Your shift: {shift.start_time} – {shift.end_time}</p>}
        </div>

        <Field label="Correct status" required error={err('status')}>
          <Segmented<AttendanceStatus> value={form.status} onChange={(v) => set('status', v)} options={STATUSES.map((s) => ({ value: s, label: DAY_STATUS_META[s].label }))} className="w-full" />
        </Field>

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="Check-in" error={err('checkIn')} hint={record?.check_in ? 'Leave empty to keep the recorded time' : undefined}>
            <Input type="time" value={form.checkIn} onChange={(e) => set('checkIn', e.target.value)} invalid={!!err('checkIn')} />
          </Field>
          <Field label="Check-out" error={err('checkOut')} hint={record?.check_out ? 'Leave empty to keep the recorded time' : undefined}>
            <Input type="time" value={form.checkOut} onChange={(e) => set('checkOut', e.target.value)} invalid={!!err('checkOut')} />
          </Field>
        </div>

        <Field label="Reason" required error={err('reason')} hint={`${form.reason.trim().length}/500 · e.g. biometric didn’t read, customer visit, forgot to check out`}>
          <Textarea value={form.reason} onChange={(e) => set('reason', e.target.value)} rows={3} placeholder="What happened?" invalid={!!err('reason')} />
        </Field>

        <p className="flex items-start gap-2 text-[12px] text-ink-soft">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Once approved, the day is recalculated with your shift rules (late mark, worked hours, overtime).
        </p>
      </div>
    </Modal>
  )
}
