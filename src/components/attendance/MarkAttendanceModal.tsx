/**
 * Admin: mark or edit one employee's attendance for one date (the unique employee+date row).
 * Times run through computePunch with the employee's shift, so late / worked / OT match punches.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import { useRow, useTable } from '@/data/store'
import type { AttendanceStatus, ISODate } from '@/data/types'
import { DAY_STATUS_META } from '@/lib/attendance'
import { fmtDay, fmtDuration, fmtHHMM, fmtMonth, fmtTime, monthOf, todayISO } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { ATTENDANCE_STATUSES, deleteAttendance, hhmmOf, markAttendance, payrollLock, punchFromTimes } from '@/services/attendance'
import { Button, confirm, Field, Input, Modal, Segmented, Textarea, toast } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { SourceBadge } from './shared'

export interface MarkTarget {
  employeeId: string
  date: ISODate
}

export function MarkAttendanceModal({ target, onClose }: { target: MarkTarget | null; onClose: () => void }) {
  const attendance = useTable('attendance')
  const emp = useRow('employees', target?.employeeId)
  const existing = useMemo(() => (target ? attendance.find((a) => a.employee_id === target.employeeId && a.date === target.date) : undefined), [attendance, target])
  const shifts = useTable('shifts')
  const shift = shifts.find((s) => s.id === (existing?.shift_id ?? emp?.shift_id))

  const [status, setStatus] = useState<AttendanceStatus>('present')
  const [inT, setIn] = useState('')
  const [outT, setOut] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  // (re)initialise when a different cell is opened
  const key = target ? `${target.employeeId}|${target.date}` : ''
  useEffect(() => {
    if (!target) return
    setStatus(existing?.status ?? 'present')
    setIn(existing ? hhmmOf(existing.check_in) : shift?.start_time ?? '')
    // a new mark for today defaults to "still inside" until the shift has ended
    const endPassed = !!shift && (target.date < todayISO() || hhmmOf(new Date().toISOString()) >= shift.end_time)
    setOut(existing ? hhmmOf(existing.check_out) : endPassed ? shift?.end_time ?? '' : '')
    setRemarks(existing?.remarks ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const needsTimes = status === 'present' || status === 'half_day'
  const preview = useMemo(() => {
    if (!target || !shift) return { error: shift ? null : 'No shift assigned to this employee.', p: null }
    try {
      return { error: null, p: punchFromTimes(target.date, shift, status === 'absent' ? null : inT || null, status === 'absent' ? null : outT || null, status) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), p: null }
    }
  }, [target, shift, status, inT, outT])
  const inError = needsTimes && !inT ? 'Check-in is required for this status.' : null
  const valid = !!target && !!emp && !preview.error && !inError && remarks.length <= 300
  const lock = target ? payrollLock(monthOf(target.date)) : undefined
  const mismatch = preview.p?.suggested && needsTimes && preview.p.suggested !== status

  const save = async () => {
    if (!target || !valid) return
    setSaving(true)
    try {
      markAttendance({ employeeId: target.employeeId, date: target.date, status, checkIn: status === 'absent' ? '' : inT, checkOut: status === 'absent' ? '' : outT, remarks })
      toast.success(existing ? 'Attendance updated' : 'Attendance marked', `${fullName(emp)} · ${fmtDay(target.date)} · ${DAY_STATUS_META[status].label}`)
      onClose()
    } catch (e) {
      toast.error('Could not save', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing || !target) return
    const ok = await confirm({
      title: 'Delete this attendance record?',
      message: `${fullName(emp)}’s record for ${fmtDay(target.date)} will be removed. The day will then show as absent, leave, holiday or week-off by the usual rules.`,
      danger: true,
      confirmLabel: 'Delete record',
    })
    if (!ok) return
    try {
      deleteAttendance(existing)
      toast.success('Record deleted')
      onClose()
    } catch (e) {
      toast.error('Could not delete', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={existing ? 'Edit attendance' : 'Mark attendance'}
      subtitle={target ? fmtDay(target.date) + (shift ? ` · ${shift.name} (${fmtHHMM(shift.start_time)} – ${fmtHHMM(shift.end_time)})` : '') : undefined}
      footer={
        <>
          {existing && (
            <Button variant="ghost" className="mr-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!valid}>
            {existing ? 'Save changes' : 'Mark attendance'}
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 p-3">
            <EmployeeCell id={target.employeeId} sub="code" />
            {existing ? (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
                <SourceBadge source={existing.source} />
                {fmtTime(existing.check_in)} – {fmtTime(existing.check_out)}
              </div>
            ) : (
              <span className="text-[12.5px] text-ink-soft">No record yet</span>
            )}
          </div>

          {lock && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Payroll for {fmtMonth(lock.month)} is already {lock.status}. This change updates the register but not payslips already issued.
            </p>
          )}

          <Field label="Status" required>
            <Segmented<AttendanceStatus> value={status} onChange={setStatus} options={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: DAY_STATUS_META[s].label }))} className="w-full" />
          </Field>

          {status !== 'absent' && (
            <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
              <Field label="Check-in" required={needsTimes} error={inError ?? (preview.error && !outT ? preview.error : null)} hint={status === 'on_duty' ? 'Optional for on-duty days' : undefined}>
                <Input type="time" value={inT} onChange={(e) => setIn(e.target.value)} invalid={!!inError} />
              </Field>
              <Field label="Check-out" error={preview.error && outT ? preview.error : null} hint="Leave empty if still inside">
                <Input type="time" value={outT} onChange={(e) => setOut(e.target.value)} invalid={!!(preview.error && outT)} />
              </Field>
            </div>
          )}

          {preview.p && status !== 'absent' && preview.p.check_in && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="Late" value={preview.p.late_minutes ? fmtDuration(preview.p.late_minutes) : '—'} warn={preview.p.late_minutes > 0} />
              <Mini label="Worked" value={preview.p.check_out ? fmtDuration(preview.p.worked_minutes) : '—'} />
              <Mini label="Early exit" value={preview.p.early_exit_minutes ? fmtDuration(preview.p.early_exit_minutes) : '—'} warn={preview.p.early_exit_minutes > 0} />
              <Mini label="Overtime" value={preview.p.ot_minutes ? fmtDuration(preview.p.ot_minutes) : '—'} />
            </div>
          )}
          {mismatch && (
            <p className="flex items-start gap-2 rounded-md bg-brand-50 px-3 py-2.5 text-[12.5px] text-brand-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              The times work out to a {DAY_STATUS_META[preview.p!.suggested!].label.toLowerCase()} ({fmtDuration(preview.p!.worked_minutes)} worked; half day below {fmtDuration(shift?.half_day_minutes ?? 240)}). Your chosen status will be saved.
            </p>
          )}
          {preview.p && preview.p.ot_minutes > 0 && <p className="text-[12px] text-ink-soft">Overtime goes to the Overtime tab for approval before it reaches payroll.</p>}

          <Field label="Remarks" hint={`${remarks.length}/300`} error={remarks.length > 300 ? 'Keep remarks under 300 characters.' : null}>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="e.g. Biometric down — verified with supervisor" />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={warn ? 'rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2' : 'rounded-md border border-line bg-white px-3 py-2'}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="num text-[15px] font-semibold text-ink">{value}</p>
    </div>
  )
}
