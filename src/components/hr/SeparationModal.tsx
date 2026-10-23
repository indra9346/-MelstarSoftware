import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, LogOut } from 'lucide-react'
import { Button, Checkbox, Field, Input, Modal, Segmented, Textarea, guard, toast } from '@/components/ui'
import { useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { addDays, fmtDate, todayISO } from '@/lib/dates'
import { fullName, plural } from '@/lib/format'
import { markSeparation, validateSeparation, type SeparationStatus } from '@/services/hr'
import { useSession } from '@/services/session'
import { setActive } from '@/services/users'

/** Mark an employee as serving notice or exited (with hand-over warnings). */
export function SeparationModal({ employee, open, onClose }: { employee: Employee; open: boolean; onClose: () => void }) {
  const s = useSession()
  const users = useTable('app_users')
  const assets = useTable('assets')
  const tools = useTable('tool_issues')
  const departments = useTable('departments')
  const employees = useTable('employees')
  const today = todayISO()

  const defaults = (st: SeparationStatus) =>
    st === 'on_notice'
      ? employee.date_of_exit && employee.date_of_exit >= today ? employee.date_of_exit : addDays(today, 30)
      : employee.date_of_exit && employee.date_of_exit <= today && employee.date_of_exit >= employee.date_of_joining ? employee.date_of_exit : today

  const [status, setStatus] = useState<SeparationStatus>('on_notice')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [deactivate, setDeactivate] = useState(true)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const st: SeparationStatus = employee.status === 'on_notice' ? 'exited' : 'on_notice'
    setStatus(st)
    setDate(defaults(st))
    setReason(employee.exit_reason)
    setDeactivate(true)
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee.id])

  const errors = validateSeparation(employee, status, date, reason)
  const invalid = Object.keys(errors).length > 0
  const login = users.find((u) => u.employee_id === employee.id && u.active)
  const canDeactivate = !!login && s.can('users.manage') && login.id !== s.user.id

  const handover = useMemo(() => {
    const out: string[] = []
    const t = tools.filter((x) => x.employee_id === employee.id && x.status === 'issued')
    if (t.length) out.push(`${plural(t.length, 'tool issue')} not yet returned`)
    const a = assets.filter((x) => x.custodian_id === employee.id && x.status !== 'disposed')
    if (a.length) out.push(`Custodian of ${plural(a.length, 'asset')}`)
    const heads = departments.filter((d) => d.head_employee_id === employee.id)
    if (heads.length) out.push(`Head of ${heads.map((d) => d.name).join(', ')}`)
    const reports = employees.filter((e) => e.reporting_to === employee.id && e.status !== 'exited')
    if (reports.length) out.push(`${plural(reports.length, 'person', 'people')} report to ${employee.first_name}`)
    if (login && !canDeactivate) out.push('Has an active ERP login')
    return out
  }, [tools, assets, departments, employees, employee, login, canDeactivate])

  const save = async () => {
    setTouched(true)
    if (invalid) return
    setBusy(true)
    try {
      markSeparation(employee, status, date, reason)
      if (status === 'exited' && canDeactivate && deactivate) await guard(() => setActive(login!.id, false))
      toast.success(status === 'exited' ? `${fullName(employee)} marked as exited` : `${fullName(employee)} is on notice`, `${status === 'exited' ? 'Exit date' : 'Last working day'} ${fmtDate(date)}`)
      onClose()
    } catch (e) {
      toast.error('Could not update', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Separation · ${fullName(employee)}`}
      subtitle={`${employee.emp_code} · joined ${fmtDate(employee.date_of_joining)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={status === 'exited' ? 'danger' : 'primary'} icon={<LogOut className="h-4 w-4" />} onClick={() => void save()} loading={busy} disabled={touched && invalid}>
            {status === 'exited' ? 'Mark as exited' : 'Mark on notice'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <Segmented
          value={status}
          onChange={(v) => {
            setStatus(v)
            setDate(defaults(v))
          }}
          options={[
            { value: 'on_notice', label: 'Serving notice' },
            { value: 'exited', label: 'Exited' },
          ]}
        />
        <Field
          label={status === 'exited' ? 'Exit date (last day on rolls)' : 'Last working day'}
          required
          error={touched ? errors.date : undefined}
          hint={status === 'on_notice' ? 'Attendance and payroll treat them as active until this day.' : 'Days after this are not counted in attendance or payroll.'}
          htmlFor="sep-date"
        >
          <Input id="sep-date" type="date" value={date} min={employee.date_of_joining} max={status === 'exited' ? today : undefined} onChange={(e) => setDate(e.target.value)} invalid={touched && !!errors.date} />
        </Field>
        <Field label="Reason" required error={touched ? errors.reason : undefined} htmlFor="sep-reason">
          <Textarea id="sep-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} invalid={touched && !!errors.reason} placeholder="e.g. Resigned — relocating to Hubballi" maxLength={300} />
        </Field>
        {handover.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5">
            <p className="flex items-center gap-2 text-[13px] font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4" /> Before the last day
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-[13px] text-amber-900">
              {handover.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}
        {status === 'exited' && canDeactivate && <Checkbox checked={deactivate} onChange={setDeactivate} label={`Also deactivate the ERP login (${login!.email})`} />}
      </div>
    </Modal>
  )
}
