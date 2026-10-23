import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BriefcaseBusiness, Eye, EyeOff, Fingerprint, KeyRound, LogOut, Pencil, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, Field, InfoGrid, Input, Modal, PageHeader, Segmented, Select, Tabs, Textarea, guard, toast } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { EmergencyContacts } from '@/components/hr/EmergencyContacts'
import { EmployeeDocuments } from '@/components/hr/EmployeeDocuments'
import { SalarySummary } from '@/components/hr/SalarySummary'
import { PhotoUpload } from '@/components/hr/StoredAvatar'
import { ColorChip, PasswordField } from '@/components/hr/inputs'
import { DATA_MODE } from '@/config/env'
import { useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { useLookups } from '@/hooks/useLookups'
import { ageInYears, fmtDate, fmtDateTime, relativeTime, tenure, todayISO } from '@/lib/dates'
import { fullName, maskTail, titleCase } from '@/lib/format'
import { audit } from '@/services/audit'
import { BLOOD_GROUPS, passwordStrength, selfContactOf, setEmployeePhoto, updateOwnContact, validateSelfContact, type SelfContactValues } from '@/services/hr'
import { useAuth, useSession } from '@/services/session'

type Tab = 'about' | 'contacts' | 'documents' | 'salary' | 'account'

export default function ProfilePage() {
  const s = useSession()
  const emp = s.employee
  if (!emp)
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader kicker="My profile" title={s.user.display_name} subtitle={`${s.role.name} · ${s.user.email}`} />
        <AccountSection />
      </div>
    )
  return <EmployeeProfile emp={emp} />
}

function EmployeeProfile({ emp }: { emp: Employee }) {
  const s = useSession()
  const L = useLookups()
  const structures = useTable('salary_structures')
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const hasSalary = useMemo(() => structures.some((r) => r.employee_id === emp.id), [structures, emp.id])
  const tabs: { value: Tab; label: string }[] = [
    { value: 'about', label: 'About me' },
    { value: 'contacts', label: 'Emergency contacts' },
    { value: 'documents', label: 'Documents' },
    ...(hasSalary ? [{ value: 'salary' as const, label: 'Salary' }] : []),
    { value: 'account', label: 'Account & password' },
  ]
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && tabs.some((t) => t.value === raw) ? raw : 'about'
  const setTab = (t: Tab) => setParams(t === 'about' ? {} : { tab: t }, { replace: true })
  const dept = L.dept.get(emp.department_id)
  const name = fullName(emp)
  const today = todayISO()

  return (
    <div>
      <div>
        <Card className="mb-5">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
            <PhotoUpload name={name} src={emp.photo} size={96} canEdit onUpload={(f) => setEmployeePhoto(emp, f)} onRemove={() => setEmployeePhoto(emp, null)} />
            <div className="min-w-0 flex-1">
              <p className="kicker">My profile</p>
              <h1 className="min-w-0 break-words text-[20px] font-semibold leading-tight text-ink sm:text-[22px]">{name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span className="font-medium text-ink">{L.desigTitle(emp.designation_id)}</span>
                {dept && <ColorChip color={dept.color}>{dept.name}</ColorChip>}
              </div>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
                <span className="num font-mono font-semibold text-ink">{emp.emp_code}</span>
                <span>
                  Joined {fmtDate(emp.date_of_joining)} · {tenure(emp.date_of_joining)}
                </span>
                {emp.work_centre_id && <span>{L.wcName(emp.work_centre_id)}</span>}
              </p>
            </div>
            <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit contact details
            </Button>
          </div>
          {emp.reporting_to && (
            <div className="relative flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-[13px] sm:px-6">
              <span className="text-ink-faint">Reports to</span>
              <EmployeeCell id={emp.reporting_to} size={26} />
            </div>
          )}
        </Card>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div key={tab}>
        {tab === 'about' && <About emp={emp} onEdit={() => setEditing(true)} today={today} />}
        {tab === 'contacts' && <EmergencyContacts employeeId={emp.id} canEdit />}
        {tab === 'documents' && (
          <div className="space-y-3">
            <EmployeeDocuments employeeId={emp.id} canManage={s.can('employees.manage')} canUpload />
            <p className="px-1 text-[12.5px] text-ink-faint">HR verifies uploaded documents. To replace or remove one, ask HR.</p>
          </div>
        )}
        {tab === 'salary' && hasSalary && <SalarySummary employee={emp} />}
        {tab === 'account' && <AccountSection />}
      </div>

      <ContactModal emp={emp} open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

function About({ emp, onEdit, today }: { emp: Employee; onEdit: () => void; today: string }) {
  const L = useLookups()
  const shift = L.shift.get(emp.shift_id)
  const dash = (v: string | null | undefined) => (v ? v : <span className="text-ink-faint">—</span>)
  const mono = (v: string) => (v ? <span className="font-mono">{v}</span> : dash(''))
  const cards: { title: string; icon: ReactNode; items: [ReactNode, ReactNode][]; action?: ReactNode; note?: string }[] = [
    {
      title: 'Contact details',
      icon: <Phone className="h-4 w-4" />,
      action: (
        <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
          Edit
        </Button>
      ),
      items: [
        ['Mobile', dash(emp.phone)],
        ['Personal e-mail', dash(emp.personal_email)],
        ['Official e-mail', dash(emp.email)],
        ['Address', dash(emp.address)],
        ['City', dash(emp.city)],
        ['Pincode', dash(emp.pincode)],
        ['Blood group', dash(emp.blood_group)],
        ['Marital status', titleCase(emp.marital_status)],
      ],
      note: 'You can update these yourself.',
    },
    {
      title: 'Personal',
      icon: <UserRound className="h-4 w-4" />,
      items: [
        ['Full name', fullName(emp)],
        ['Gender', titleCase(emp.gender)],
        ['Date of birth', emp.dob ? `${fmtDate(emp.dob)} · ${ageInYears(emp.dob, today)} yrs` : dash('')],
        ['State', dash(emp.state)],
      ],
      note: 'Name and date of birth are changed by HR against an ID proof.',
    },
    {
      title: 'Job',
      icon: <BriefcaseBusiness className="h-4 w-4" />,
      items: [
        ['Employee code', mono(emp.emp_code)],
        ['Department', L.deptName(emp.department_id)],
        ['Designation', L.desigTitle(emp.designation_id)],
        ['Employment type', titleCase(emp.employment_type)],
        ['Date of joining', fmtDate(emp.date_of_joining)],
        ['Shift', shift ? `${shift.name} · ${shift.start_time}–${shift.end_time}` : '—'],
        ['Work centre', emp.work_centre_id ? L.wcName(emp.work_centre_id) : dash('')],
        ['Reports to', emp.reporting_to ? L.empName(emp.reporting_to) : dash('')],
      ],
    },
    {
      title: 'Statutory & bank',
      icon: <Fingerprint className="h-4 w-4" />,
      items: [
        ['PAN', emp.pan ? mono(maskTail(emp.pan)) : dash('')],
        ['Aadhaar', mono(emp.aadhaar_masked)],
        ['UAN (EPF)', emp.uan ? mono(maskTail(emp.uan)) : dash('')],
        ['ESIC IP no.', emp.esic_no ? mono(maskTail(emp.esic_no)) : <span className="text-ink-faint">Not covered</span>],
        ['Bank', dash(emp.bank_name)],
        ['Account no.', emp.bank_account ? mono(maskTail(emp.bank_account)) : dash('')],
        ['IFSC', mono(emp.ifsc)],
        ['Tax regime', emp.tax_regime === 'old' ? 'Old regime' : 'New regime'],
      ],
      note: 'Masked for your safety. Ask HR to correct bank or statutory details.',
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((c) => (
        <div key={c.title} className="min-w-0">
          <Card className="h-full">
            <CardHeader title={c.title} icon={c.icon} actions={c.action} />
            <CardBody>
              <InfoGrid items={c.items} />
              {c.note && <p className="mt-4 text-[12px] text-ink-faint">{c.note}</p>}
            </CardBody>
          </Card>
        </div>
      ))}
      {emp.skills.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader title="Skills" />
          <CardBody>
            <div className="flex flex-wrap gap-1.5">
              {emp.skills.map((k) => (
                <Badge key={k} tone="indigo">
                  {k}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function ContactModal({ emp, open, onClose }: { emp: Employee; open: boolean; onClose: () => void }) {
  const [f, setF] = useState<SelfContactValues>(selfContactOf(emp))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setF(selfContactOf(emp))
    setTouched(new Set())
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateSelfContact(f)
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof SelfContactValues) => (touched.has(k) ? errors[k] : undefined)
  const touch = (k: keyof SelfContactValues) => setTouched((t) => new Set(t).add(k))
  const dirty = JSON.stringify(f) !== JSON.stringify(selfContactOf(emp))
  const bind = (k: Exclude<keyof SelfContactValues, 'marital_status'>) => ({
    id: `me-${k}`,
    value: f[k],
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
    onBlur: () => touch(k),
    invalid: !!err(k),
  })

  const save = async () => {
    if (invalid) return setTouched(new Set(Object.keys(f)))
    setBusy(true)
    const ok = await guard(() => {
      if (!updateOwnContact(emp, f)) toast.info('Nothing changed')
    }, 'Contact details updated')
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit contact details"
      subtitle="Other details (bank, PAN, job) are updated by HR"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={invalid || !dirty}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Mobile" required error={err('phone')} htmlFor="me-phone">
          <Input {...bind('phone')} type="tel" inputMode="tel" placeholder="+91 98450 12345" />
        </Field>
        <Field label="Personal e-mail" error={err('personal_email')} htmlFor="me-personal_email">
          <Input {...bind('personal_email')} type="email" inputMode="email" placeholder="name@gmail.com" />
        </Field>
        <Field label="Address" error={err('address')} className="sm:col-span-2" htmlFor="me-address">
          <Textarea {...bind('address')} rows={2} />
        </Field>
        <Field label="City / town" error={err('city')} htmlFor="me-city">
          <Input {...bind('city')} />
        </Field>
        <Field label="Pincode" error={err('pincode')} htmlFor="me-pincode">
          <Input {...bind('pincode')} inputMode="numeric" maxLength={6} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
        </Field>
        <Field label="Blood group" error={err('blood_group')} htmlFor="me-blood_group">
          <Select {...bind('blood_group')} options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} placeholder="Not known" />
        </Field>
        <Field label="Marital status">
          <Segmented
            value={f.marital_status}
            onChange={(v) => setF({ ...f, marital_status: v })}
            options={[
              { value: 'single', label: 'Single' },
              { value: 'married', label: 'Married' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  )
}

/* ─────────────────────────────── Account ─────────────────────────────── */

function AccountSection() {
  const s = useSession()
  const { signOut, changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const touch = (k: string) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))

  const strength = passwordStrength(next)
  const errors: { current?: string; next?: string; again?: string } = {}
  if (!current) errors.current = 'Enter your current password'
  if (next.length < 8) errors.next = 'Use at least 8 characters'
  else if (next.length > 72) errors.next = 'Keep it under 72 characters'
  else if (next === current) errors.next = 'Choose a password different from the current one'
  else if (strength.score < 2) errors.next = 'Too easy to guess — mix upper/lower case, numbers and a symbol'
  if (again !== next) errors.again = 'Passwords do not match'
  const invalid = Object.keys(errors).length > 0

  const submit = async () => {
    if (invalid) return setTouched(new Set(['current', 'next', 'again']))
    setBusy(true)
    try {
      await changePassword(current, next)
      audit('update', 'app_users', s.user.id, 'Changed own password')
      toast.success('Password changed', 'Use the new password next time you sign in.')
      setCurrent('')
      setNext('')
      setAgain('')
      setTouched(new Set())
    } catch (e) {
      toast.error('Could not change the password', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader title="Account" subtitle="Your sign-in for Melstar ERP" icon={<ShieldCheck className="h-4 w-4" />} />
        <CardBody>
          <InfoGrid
            cols={1}
            items={[
              ['Sign-in e-mail', <span className="break-all">{s.user.email}</span>],
              ['Display name', s.user.display_name],
              [
                'Role',
                <span className="flex flex-wrap items-center gap-1.5">
                  {s.role.name}
                  <Badge tone={s.isAdminPortal ? 'indigo' : 'slate'}>{s.isAdminPortal ? 'Admin portal' : 'Self-service'}</Badge>
                </span>,
              ],
              ['Last sign-in', s.user.last_login_at ? `${fmtDateTime(s.user.last_login_at)} · ${relativeTime(s.user.last_login_at)}` : 'This is your first session'],
              ['Workspace', DATA_MODE === 'supabase' ? 'Live · company database' : 'Offline demo (this browser)'],
            ]}
          />
          <Button variant="secondary" className="mt-5 w-full sm:w-auto" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Change password" subtitle="At least 8 characters — longer is stronger" icon={<KeyRound className="h-4 w-4" />} />
        <CardBody>
          <form
            className="grid grid-cols-1 gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            noValidate
          >
            {/* hidden username helps password managers pair the new password with this login */}
            <input type="email" autoComplete="username" value={s.user.email} readOnly hidden />
            <Field label="Current password" required error={touched.has('current') ? errors.current : undefined} htmlFor="pw-current">
              <div className="relative">
                <Input id="pw-current" type={show ? 'text' : 'password'} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} onBlur={() => touch('current')} invalid={touched.has('current') && !!errors.current} className="pr-11" />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-1.5 my-auto grid h-8 w-8 place-items-center rounded-md text-ink-faint hover:bg-brand-50 hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <Field label="New password" required error={touched.has('next') || next.length >= 8 ? errors.next : undefined} htmlFor="pw-new">
              <PasswordField id="pw-new" value={next} onChange={setNext} onBlur={() => touch('next')} invalid={(touched.has('next') || next.length >= 8) && !!errors.next} />
            </Field>
            <Field label="Confirm new password" required error={touched.has('again') || (again.length > 0 && again.length >= next.length) ? errors.again : undefined} htmlFor="pw-again">
              <Input
                id="pw-again"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                onBlur={() => touch('again')}
                invalid={(touched.has('again') || (again.length > 0 && again.length >= next.length)) && !!errors.again}
              />
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p className="mr-auto text-[12px] text-ink-faint">Never share your password — HR will never ask for it.</p>
              <Button type="submit" loading={busy} disabled={invalid}>
                Change password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
