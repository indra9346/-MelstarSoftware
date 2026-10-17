/**
 * Apply for leave — the employee's own form and HR's "apply on behalf" share this modal and the
 * same validation (services/leaves.checkLeave).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, FileUp, Info, Paperclip, X } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { leaveBalances } from '@/lib/leaves'
import { dayOfWeek, eachDay, fmtDate, fyOf } from '@/lib/dates'
import { fileSize, fullName, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { MAX_FILE_BYTES } from '@/services/files'
import { applicableLeaveTypes, applyLeave, approveLeave, checkLeave, isUnlimited, plantHolidaySet, type LeaveDraft, type LeaveField } from '@/services/leaves'
import { AnimatedNumber, Button, Field, Input, Modal, Segmented, Select, Switch, Textarea, toast } from '@/components/ui'
import { useToday } from './shared'

export function LeaveApplyModal({ open, onClose, employee, onBehalf, defaultTypeId }: { open: boolean; onClose: () => void; employee?: Employee | null; onBehalf?: boolean; defaultTypeId?: string }) {
  const s = useSession()
  const L = useLookups()
  const today = useToday()
  const types = useTable('leave_types')
  const balances = useTable('leave_balances')
  const requests = useTable('leave_requests')
  const holidays = useTable('holidays')
  const shifts = useTable('shifts')

  const blank = (): LeaveDraft => ({ employeeId: employee?.id ?? '', leaveTypeId: defaultTypeId ?? '', from: today, to: today, halfDay: false, session: 'first', reason: '' })
  const [d, setD] = useState<LeaveDraft>(blank)
  const [file, setFile] = useState<File | null>(null)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [approveNow, setApproveNow] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setD(blank())
    setFile(null)
    setTouched(new Set())
    setApproveNow(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id, defaultTypeId])

  const emp = employee ?? L.emp.get(d.employeeId)
  const applicable = useMemo(() => (emp ? applicableLeaveTypes(emp, types) : []), [emp, types])
  const views = useMemo(() => (emp ? leaveBalances(emp, fyOf(d.from || today), types, balances, requests) : []), [emp, d.from, today, types, balances, requests])
  const check = useMemo(() => checkLeave(d, { hasAttachment: !!file, today }), [d, file, today, types, balances, requests, holidays, shifts]) // eslint-disable-line react-hooks/exhaustive-deps
  const type = check.type
  const view = views.find((v) => v.type.id === d.leaveTypeId)

  const set = <K extends keyof LeaveDraft>(k: K, v: LeaveDraft[K]) => {
    setD((p) => {
      const next = { ...p, [k]: v }
      if (k === 'from' && (!p.to || p.to < (v as string) || p.halfDay)) next.to = v as string
      if (k === 'leaveTypeId') {
        const t = types.find((x) => x.id === v)
        if (t && !t.allow_half_day) next.halfDay = false
      }
      if (k === 'halfDay' && v) next.to = next.from
      return next
    })
    setTouched((t) => new Set(t).add(k === 'leaveTypeId' ? 'type' : k === 'employeeId' ? 'employee' : k))
  }
  const err = (f: LeaveField) => (touched.has(f) || f === 'days' || (f === 'attachment' && check.needsDocument) ? check.errors[f] : undefined)

  // what the span skips
  const skipped = useMemo(() => {
    if (!emp || !d.from || !d.to || d.to < d.from || d.halfDay) return null
    const offs = shifts.find((x) => x.id === emp.shift_id)?.weekly_offs ?? [0]
    const hol = plantHolidaySet(holidays)
    const all = eachDay(d.from, d.to)
    if (all.length > 400) return null
    const wo = all.filter((x) => offs.includes(dayOfWeek(x))).length
    const h = all.filter((x) => !offs.includes(dayOfWeek(x)) && hol.has(x)).length
    return { total: all.length, wo, h }
  }, [emp, d.from, d.to, d.halfDay, shifts, holidays])

  const canApproveNow = !!onBehalf && s.can('leaves.manage')
  const halfAllowed = !!type?.allow_half_day && d.from === d.to

  const submit = async () => {
    setTouched(new Set(['employee', 'type', 'from', 'to', 'halfDay', 'reason', 'attachment']))
    if (!check.ok) return
    setSaving(true)
    try {
      const row = await applyLeave(d, file)
      if (approveNow && canApproveNow) {
        try {
          approveLeave(row, 'Applied and approved by HR')
        } catch (e) {
          toast.warning('Applied, but left pending', e instanceof Error ? e.message : String(e))
          onClose()
          return
        }
      }
      toast.success(approveNow ? 'Leave applied and approved' : onBehalf ? 'Leave applied on behalf' : 'Leave applied', `${type?.name} · ${num(check.days)} day${check.days === 1 ? '' : 's'}${onBehalf && emp ? ` for ${fullName(emp)}` : ' — HR will review it'}`)
      onClose()
    } catch (e) {
      toast.error('Could not apply', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const pickFile = (f: File | null) => {
    if (f && f.size > MAX_FILE_BYTES) {
      toast.error('File too large', 'Attach a file of 10 MB or less.')
      return
    }
    setFile(f)
    setTouched((t) => new Set(t).add('attachment'))
  }

  const after = view && Number.isFinite(view.available) ? view.available - check.days : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={onBehalf ? 'Apply leave on behalf' : 'Apply for leave'}
      subtitle={onBehalf ? 'Same rules as the employee’s own form' : 'Working days exclude your week-offs and plant holidays'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!check.ok}>
            {approveNow ? 'Apply & approve' : 'Submit request'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {onBehalf && !employee && (
          <Field label="Employee" required error={err('employee')}>
            <Select value={d.employeeId} onChange={(e) => set('employeeId', e.target.value)} options={L.employeeOptions()} placeholder="Choose employee…" invalid={!!err('employee')} />
          </Field>
        )}

        <Field label="Leave type" required error={err('type')}>
          <Select
            value={d.leaveTypeId}
            onChange={(e) => set('leaveTypeId', e.target.value)}
            placeholder={emp ? 'Choose leave type…' : 'Choose the employee first'}
            disabled={!emp}
            invalid={!!err('type')}
            options={applicable.map((t) => {
              const v = views.find((x) => x.type.id === t.id)
              const avail = isUnlimited(t) ? 'no limit' : v ? `${num(v.available)} available` : ''
              return { value: t.id, label: `${t.code} · ${t.name}${avail ? ` — ${avail}` : ''}` }
            })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
          <Field label="From" required error={err('from')} hint={type?.code === 'SL' ? 'Sick leave: up to 7 days back' : undefined}>
            <Input type="date" value={d.from} min={check.minFrom} onChange={(e) => set('from', e.target.value)} invalid={!!err('from')} />
          </Field>
          <Field label="To" required error={err('to')}>
            <Input type="date" value={d.to} min={d.from || check.minFrom} disabled={d.halfDay} onChange={(e) => set('to', e.target.value)} invalid={!!err('to')} />
          </Field>
        </div>

        {type?.allow_half_day && (
          <div className={cn('rounded-2xl border border-indigo-100 bg-white/70 p-3', !halfAllowed && 'opacity-70')}>
            <Switch checked={d.halfDay} onChange={(v) => set('halfDay', v)} disabled={!halfAllowed && !d.halfDay} label="Half day" description={halfAllowed ? 'Take only half of the day off' : 'Available when From and To are the same date'} />
            {d.halfDay && (
              <div className="mt-3">
                <Segmented<'first' | 'second'> value={d.session} onChange={(v) => set('session', v)} options={[{ value: 'first', label: 'First half' }, { value: 'second', label: 'Second half' }]} />
              </div>
            )}
            {err('halfDay') && <p className="mt-1 text-[12.5px] font-medium text-rose-600">{err('halfDay')}</p>}
          </div>
        )}

        {/* live count */}
        <div className={cn('flex flex-wrap items-center gap-4 rounded-2xl border p-3.5', check.errors.days ? 'border-rose-200 bg-rose-50/60' : 'border-indigo-100 bg-gradient-to-br from-cyan-50/70 to-indigo-50/70')}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-brand-indigo shadow-sm">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[22px] font-bold leading-none text-ink">
              <AnimatedNumber value={check.days} format={(n) => num(Math.round(n * 2) / 2)} /> <span className="text-[13px] font-semibold text-ink-soft">working day{check.days === 1 ? '' : 's'}</span>
            </p>
            <p className="mt-1 text-[12px] text-ink-soft">
              {skipped && (skipped.wo || skipped.h) ? `${skipped.total} calendar days · excludes ${[skipped.wo ? `${skipped.wo} week-off${skipped.wo > 1 ? 's' : ''}` : '', skipped.h ? `${skipped.h} holiday${skipped.h > 1 ? 's' : ''}` : ''].filter(Boolean).join(' & ')}` : d.halfDay ? `${d.session === 'first' ? 'First' : 'Second'} half of ${fmtDate(d.from)}` : 'Week-offs and plant holidays are not counted'}
            </p>
          </div>
          {type && (
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{isUnlimited(type) ? 'Unpaid' : 'Balance after'}</p>
              <p className={cn('num font-display text-[17px] font-bold', after != null && after < 0 ? 'text-rose-600' : 'text-ink')}>{isUnlimited(type) ? 'No limit' : after != null ? num(after) : '—'}</p>
            </div>
          )}
          {check.errors.days && <p className="w-full text-[12.5px] font-medium text-rose-600">{check.errors.days}</p>}
        </div>

        <Field label="Reason" required error={err('reason')}>
          <Textarea value={d.reason} onChange={(e) => set('reason', e.target.value)} rows={3} placeholder="e.g. Family function at Tumakuru" invalid={!!err('reason')} />
        </Field>

        <Field
          label={check.needsDocument ? 'Supporting document' : 'Attachment (optional)'}
          required={check.needsDocument}
          error={err('attachment')}
          hint={type && type.document_after_days > 0 ? `Required for ${type.code} longer than ${type.document_after_days} day${type.document_after_days === 1 ? '' : 's'} · PDF or image, max 10 MB` : 'PDF or image, max 10 MB'}
        >
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-white px-3 py-2.5">
              <Paperclip className="h-4 w-4 shrink-0 text-brand-indigo" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
              <span className="shrink-0 text-[12px] text-ink-faint">{fileSize(file.size)}</span>
              <button
                type="button"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-rose-50 hover:text-rose-600"
                onClick={() => {
                  setFile(null)
                  if (fileRef.current) fileRef.current.value = ''
                }}
                aria-label="Remove attachment"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn('flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-[13px] font-semibold transition', err('attachment') ? 'border-rose-300 bg-rose-50/50 text-rose-700' : 'border-indigo-200 bg-indigo-50/40 text-brand-indigo hover:bg-indigo-50')}
            >
              <FileUp className="h-4 w-4" /> Choose file
            </button>
          )}
        </Field>

        {canApproveNow && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
            <Switch checked={approveNow} onChange={setApproveNow} label="Approve right away" description="For leave already agreed on paper — skips the pending step." />
          </div>
        )}
        {!onBehalf && (
          <p className="flex items-start gap-2 text-[12px] text-ink-soft">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            You can cancel a pending request, or an approved one before it starts.
          </p>
        )}
      </div>
    </Modal>
  )
}
