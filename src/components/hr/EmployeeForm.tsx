import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, BriefcaseBusiness, CheckCircle2, Fingerprint, ImagePlus, Info, Mail, Phone, Sparkles, Trash2, UserRound } from 'lucide-react'
import { Button, Field, Input, Modal, Segmented, Select, Textarea, toast } from '@/components/ui'
import { useSettings, useTable } from '@/data/store'
import type { Employee } from '@/data/types'
import { ageInYears, diffDays, fyLabel, fyOf, tenure, todayISO } from '@/lib/dates'
import { fullName, inr } from '@/lib/format'
import { cn } from '@/lib/misc'
import { annualTax } from '@/lib/payroll'
import { useSession } from '@/services/session'
import {
  BLOOD_GROUPS, EMPLOYEE_SECTIONS, EMPLOYMENT_TYPES, GENDER_OPTIONS, INDIAN_STATES, createEmployee, currentStructure, employeeToForm,
  emptyEmployeeForm, isDate, nextEmpCode, updateEmployee, validateEmployee, type EmployeeFormValues, type EmployeeSection,
} from '@/services/hr'
import { ChipsInput } from './inputs'
import { StoredAvatar } from './StoredAvatar'

const SECTION_ICONS: Record<EmployeeSection, ReactNode> = {
  personal: <UserRound className="h-4 w-4" />,
  contact: <Phone className="h-4 w-4" />,
  job: <BriefcaseBusiness className="h-4 w-4" />,
  statutory: <Fingerprint className="h-4 w-4" />,
  tax: <Sparkles className="h-4 w-4" />,
}

const COMMON_BANKS = ['State Bank of India', 'Canara Bank', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Karnataka Bank', 'Union Bank of India', 'Bank of Baroda', 'Kotak Mahindra Bank', 'Punjab National Bank', 'Indian Bank', 'Karnataka Gramin Bank']

/**
 * Add / edit employee — one multi-section modal (size lg). Errors appear once a field is touched;
 * the save button stays disabled until everything validates.
 */
export function EmployeeForm({ open, onClose, employee, onSaved }: { open: boolean; onClose: () => void; employee?: Employee | null; onSaved?: (e: Employee, created: boolean) => void }) {
  const s = useSession()
  const settings = useSettings()
  const departments = useTable('departments')
  const designations = useTable('designations')
  const employees = useTable('employees')
  const shifts = useTable('shifts')
  const workCentres = useTable('work_centres')
  const structures = useTable('salary_structures')
  const editing = !!employee

  const [values, setValues] = useState<EmployeeFormValues>(() => (employee ? employeeToForm(employee) : emptyEmployeeForm()))
  const [initial, setInitial] = useState(values)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [active, setActive] = useState<EmployeeSection>('personal')
  const refs = useRef<Partial<Record<EmployeeSection, HTMLElement | null>>>({})
  const photoInput = useRef<HTMLInputElement>(null)

  // reset whenever the dialog opens
  useEffect(() => {
    if (!open) return
    const v = employee ? employeeToForm(employee) : emptyEmployeeForm()
    setValues(v)
    setInitial(v)
    setTouched(new Set())
    setShowAll(false)
    setPhotoFile(null)
    setRemovePhoto(false)
    setActive('personal')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id])

  useEffect(() => {
    if (!photoFile) return setPreview(null)
    const url = URL.createObjectURL(photoFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  // scroll-spy for the section pills
  useEffect(() => {
    if (!open) return
    let io: IntersectionObserver | null = null
    const t = setTimeout(() => {
      const root = refs.current.personal?.closest('.overflow-y-auto') as HTMLElement | null
      if (!root || typeof IntersectionObserver === 'undefined') return
      io = new IntersectionObserver(
        (entries) => {
          const first = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
          if (first) setActive(first.target.getAttribute('data-section') as EmployeeSection)
        },
        { root, rootMargin: '-5% 0px -65% 0px' },
      )
      Object.values(refs.current).forEach((el) => el && io!.observe(el))
    }, 260)
    return () => {
      clearTimeout(t)
      io?.disconnect()
    }
  }, [open])

  const errors = useMemo(() => validateEmployee(values, employee ?? undefined), [values, employee, employees])
  const issues = Object.keys(errors).length
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || !!photoFile || removePhoto

  const set = <K extends keyof EmployeeFormValues>(k: K, v: EmployeeFormValues[K]) => setValues((p) => ({ ...p, [k]: v }))
  const touch = (k: keyof EmployeeFormValues) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))
  const err = (k: keyof EmployeeFormValues) => (showAll || touched.has(k) ? errors[k] : undefined)
  const bind = (k: Exclude<keyof EmployeeFormValues, 'skills' | 'gender' | 'marital_status' | 'tax_regime' | 'employment_type'>) => ({
    value: values[k] as string,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
    onBlur: () => touch(k),
    invalid: !!err(k),
    id: `emp-${k}`,
  })

  const goTo = (key: EmployeeSection) => {
    setActive(key)
    refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const reveal = () => {
    setShowAll(true)
    const first = EMPLOYEE_SECTIONS.find((sec) => sec.fields.some((f) => errors[f]))
    if (first) goTo(first.key)
  }

  // options
  const deptOptions = useMemo(() => [...departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` })), [departments])
  const desigOptions = useMemo(
    () => designations.filter((d) => d.department_id === values.department_id).sort((a, b) => a.title.localeCompare(b.title)).map((d) => ({ value: d.id, label: d.grade ? `${d.title} · ${d.grade}` : d.title })),
    [designations, values.department_id],
  )
  const managerOptions = useMemo(
    () =>
      employees
        .filter((e) => e.id !== employee?.id && (e.status !== 'exited' || e.id === employee?.reporting_to))
        .sort((a, b) => fullName(a).localeCompare(fullName(b)))
        .map((e) => ({ value: e.id, label: `${fullName(e)} · ${designations.find((d) => d.id === e.designation_id)?.title ?? e.emp_code}` })),
    [employees, designations, employee],
  )
  const shiftOptions = shifts.filter((x) => x.active || x.id === values.shift_id).map((x) => ({ value: x.id, label: `${x.name} · ${x.start_time}–${x.end_time}${x.active ? '' : ' (inactive)'}` }))
  const wcOptions = workCentres.map((w) => ({ value: w.id, label: w.name }))

  const today = todayISO()
  const name = `${values.first_name} ${values.last_name}`.trim() || 'New employee'
  const age = isDate(values.dob) && values.dob <= today ? ageInYears(values.dob) : null
  const dojHint = isDate(values.date_of_joining)
    ? values.date_of_joining <= today
      ? `${tenure(values.date_of_joining)} of service`
      : `Joins in ${diffDays(today, values.date_of_joining)} days`
    : undefined
  const nextCode = useMemo(() => (editing ? '' : nextEmpCode()), [editing, employees])

  // live tax preview from the current salary structure (edit only)
  const structure = employee ? currentStructure(structures, employee.id, today) : null
  const tax = useMemo(() => {
    if (!structure) return null
    const ded = Math.max(0, Number(values.declared_deductions) || 0)
    return { new: annualTax(structure, 'new', 0, settings.payroll).monthly_tds, old: annualTax(structure, 'old', ded, settings.payroll).monthly_tds }
  }, [structure, values.declared_deductions, settings.payroll])

  const photoSrc = preview ?? (removePhoto ? null : employee?.photo ?? null)

  const submit = async () => {
    if (issues) return reveal()
    setBusy(true)
    try {
      if (employee) {
        if (!dirty) {
          onClose()
          return
        }
        const row = await updateEmployee(employee, values, { file: photoFile, remove: removePhoto })
        toast.success('Employee updated', `${fullName(row)} · ${row.emp_code}`)
        onSaved?.(row, false)
        onClose()
      } else {
        const res = await createEmployee(values, photoFile)
        if (!res) return
        toast.success(`${fullName(res.employee)} added`, `Next: add a salary structure in Payroll.${res.balances ? ` ${res.balances} leave balances opened for FY ${fyLabel(fyOf(today))}.` : ''}`)
        onSaved?.(res.employee, true)
        onClose()
      }
    } catch (e) {
      toast.error('Could not save the employee', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const section = (key: EmployeeSection, title: string, sub: string, children: ReactNode) => (
    <section ref={(el) => (refs.current[key] = el)} data-section={key} className="scroll-mt-16 pb-6">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-50 to-indigo-100 text-brand-indigo">{SECTION_ICONS[key]}</span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight text-ink">{title}</h3>
          <p className="text-[12px] text-ink-soft">{sub}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${fullName(employee)}` : 'Add employee'}
      subtitle={editing ? `${employee!.emp_code} · fields marked * are required` : 'Fields marked * are required'}
      footer={
        <>
          <div className="mr-auto flex min-w-0 items-center text-[12.5px]">
            {issues ? (
              <button type="button" onClick={reveal} className="inline-flex items-center gap-1.5 font-semibold text-rose-600 hover:underline">
                <AlertCircle className="h-4 w-4" />
                {issues} field{issues === 1 ? '' : 's'} to fix
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Ready to save
              </span>
            )}
          </div>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={issues > 0 || (editing && !dirty)}>
            {editing ? 'Save changes' : 'Add employee'}
          </Button>
        </>
      }
    >
      {/* section pills */}
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 mb-4 border-b border-indigo-50 bg-white/95 px-5 py-2.5">
        <div className="flex gap-1 overflow-x-auto no-scrollbar" role="tablist">
          {EMPLOYEE_SECTIONS.map((sec) => {
            const bad = sec.fields.some((f) => errors[f] && (showAll || touched.has(f)))
            return (
              <button
                key={sec.key}
                type="button"
                role="tab"
                aria-selected={active === sec.key}
                onClick={() => goTo(sec.key)}
                className={cn('relative shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors', active === sec.key ? 'text-ink' : 'text-ink-soft hover:text-ink')}
              >
                {active === sec.key && <motion.span layoutId="emp-form-pill" className="absolute inset-0 rounded-full bg-indigo-50 ring-1 ring-indigo-100" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="relative inline-flex items-center gap-1.5">
                  {sec.label}
                  {bad && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {section(
        'personal',
        'Personal',
        'As on the Aadhaar / school records',
        <>
          <div className="flex items-center gap-4 sm:col-span-2">
            {preview ? <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white" /> : <StoredAvatar name={name} src={photoSrc} size={64} />}
            <div className="flex min-w-0 flex-wrap gap-2">
              <input
                ref={photoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  if (!f.type.startsWith('image/')) return void toast.error('Choose an image', 'JPG, PNG or WebP photos only.')
                  if (f.size > 10 * 1024 * 1024) return void toast.error('Photo is too large', 'Use an image under 10 MB.')
                  setPhotoFile(f)
                  setRemovePhoto(false)
                }}
              />
              <Button size="sm" variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => photoInput.current?.click()}>
                {photoSrc ? 'Change photo' : 'Upload photo'}
              </Button>
              {photoSrc && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    setPhotoFile(null)
                    setRemovePhoto(!!employee?.photo)
                  }}
                >
                  Remove
                </Button>
              )}
              <p className="w-full text-[12px] text-ink-faint">Passport-style photo, JPG/PNG, up to 10 MB.</p>
            </div>
          </div>
          <Field label="First name" required error={err('first_name')} htmlFor="emp-first_name">
            <Input {...bind('first_name')} autoComplete="off" placeholder="e.g. Ravi" />
          </Field>
          <Field label="Last name / initial" error={err('last_name')} htmlFor="emp-last_name">
            <Input {...bind('last_name')} autoComplete="off" placeholder="e.g. Kumar M" />
          </Field>
          <Field label="Gender" required error={err('gender')} htmlFor="emp-gender">
            <Select
              id="emp-gender"
              value={values.gender}
              onChange={(e) => set('gender', e.target.value as EmployeeFormValues['gender'])}
              onBlur={() => touch('gender')}
              invalid={!!err('gender')}
              options={GENDER_OPTIONS}
              placeholder="Select…"
            />
          </Field>
          <Field label="Date of birth" required error={err('dob')} hint={age != null ? `${age} years old` : 'Must be 18+ on the joining date'} htmlFor="emp-dob">
            <Input {...bind('dob')} type="date" max={today} />
          </Field>
          <Field label="Blood group" error={err('blood_group')} htmlFor="emp-blood_group">
            <Select {...bind('blood_group')} options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} placeholder="Not known" />
          </Field>
          <Field label="Marital status">
            <Segmented
              value={values.marital_status}
              onChange={(v) => set('marital_status', v)}
              options={[
                { value: 'single', label: 'Single' },
                { value: 'married', label: 'Married' },
              ]}
            />
          </Field>
        </>,
      )}

      {section(
        'contact',
        'Contact',
        'How we reach them — official e-mail is used for the ERP login',
        <>
          <Field label="Official e-mail" error={err('email')} hint="Unique per employee" htmlFor="emp-email">
            <Input {...bind('email')} type="email" inputMode="email" autoComplete="off" leading={<Mail className="h-4 w-4" />} placeholder="name@melstarmanufacturing.in" />
          </Field>
          <Field label="Personal e-mail" error={err('personal_email')} htmlFor="emp-personal_email">
            <Input {...bind('personal_email')} type="email" inputMode="email" autoComplete="off" leading={<Mail className="h-4 w-4" />} placeholder="name@gmail.com" />
          </Field>
          <Field label="Mobile" required error={err('phone')} htmlFor="emp-phone">
            <Input {...bind('phone')} type="tel" inputMode="tel" autoComplete="off" leading={<Phone className="h-4 w-4" />} placeholder="+91 98450 12345" />
          </Field>
          <Field label="City / town" error={err('city')} htmlFor="emp-city">
            <Input {...bind('city')} placeholder="Doddaballapura" />
          </Field>
          <Field label="Address" error={err('address')} className="sm:col-span-2" htmlFor="emp-address">
            <Textarea {...bind('address')} rows={2} placeholder="House no., street, locality" />
          </Field>
          <Field label="State" required error={err('state')} htmlFor="emp-state">
            <Select {...bind('state')} options={INDIAN_STATES.map((x) => ({ value: x, label: x }))} placeholder="Select…" />
          </Field>
          <Field label="Pincode" error={err('pincode')} htmlFor="emp-pincode">
            <Input {...bind('pincode')} inputMode="numeric" maxLength={6} placeholder="561203" onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
        </>,
      )}

      {section(
        'job',
        'Job',
        'Position, reporting line and shift',
        <>
          <Field
            label="Employee code"
            required
            error={err('emp_code')}
            hint={!editing && nextCode && values.emp_code.trim().toUpperCase() !== nextCode ? (
              <button type="button" className="font-semibold text-brand-indigo hover:underline" onClick={() => set('emp_code', nextCode)}>
                Use next free code {nextCode}
              </button>
            ) : 'Unique, e.g. MMS-1037'}
            htmlFor="emp-emp_code"
          >
            <Input {...bind('emp_code')} className="font-mono uppercase" onChange={(e) => set('emp_code', e.target.value.toUpperCase())} maxLength={20} />
          </Field>
          <Field label="Employment type" required error={err('employment_type')} htmlFor="emp-employment_type">
            <Select
              id="emp-employment_type"
              value={values.employment_type}
              onChange={(e) => set('employment_type', e.target.value as EmployeeFormValues['employment_type'])}
              onBlur={() => touch('employment_type')}
              invalid={!!err('employment_type')}
              options={EMPLOYMENT_TYPES}
              placeholder="Select…"
            />
          </Field>
          <Field label="Department" required error={err('department_id')} htmlFor="emp-department_id">
            <Select
              {...bind('department_id')}
              onChange={(e) => {
                const dept = e.target.value
                setValues((p) => ({ ...p, department_id: dept, designation_id: designations.find((d) => d.id === p.designation_id)?.department_id === dept ? p.designation_id : '' }))
              }}
              options={deptOptions}
              placeholder="Select…"
            />
          </Field>
          <Field label="Designation" required error={err('designation_id')} hint={!values.department_id ? 'Pick a department first' : !desigOptions.length ? 'No designations yet — add one in Designations' : undefined} htmlFor="emp-designation_id">
            <Select {...bind('designation_id')} options={desigOptions} placeholder={values.department_id ? 'Select…' : '—'} disabled={!values.department_id} />
          </Field>
          <Field label="Reports to" error={err('reporting_to')} htmlFor="emp-reporting_to">
            <Select {...bind('reporting_to')} options={managerOptions} placeholder="No manager" />
          </Field>
          <Field label="Date of joining" required error={err('date_of_joining')} hint={dojHint} htmlFor="emp-date_of_joining">
            <Input {...bind('date_of_joining')} type="date" />
          </Field>
          <Field label="Shift" required error={err('shift_id')} htmlFor="emp-shift_id">
            <Select {...bind('shift_id')} options={shiftOptions} placeholder="Select…" />
          </Field>
          <Field label="Work centre" error={err('work_centre_id')} hint="Shop-floor cell, if any" htmlFor="emp-work_centre_id">
            <Select {...bind('work_centre_id')} options={wcOptions} placeholder="Not on a cell" />
          </Field>
        </>,
      )}

      {section(
        'statutory',
        'Statutory & bank',
        'Used for PF, ESI, TDS and salary credit',
        <>
          <Field label="PAN" error={err('pan')} hint="10 characters, e.g. ABCPE1234F" htmlFor="emp-pan">
            <Input {...bind('pan')} className="font-mono uppercase" maxLength={10} autoComplete="off" onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABCPE1234F" />
          </Field>
          <Field label="Aadhaar — last 4 digits" error={err('aadhaar_last4')} hint="Only the last 4 digits are stored — never the full number" htmlFor="emp-aadhaar_last4">
            <div className="flex min-w-0">
              <span className="inline-flex shrink-0 items-center rounded-l-xl border border-r-0 border-indigo-200/70 bg-indigo-50/70 px-3 font-mono text-[14px] text-ink-soft">XXXX-XXXX-</span>
              <Input {...bind('aadhaar_last4')} inputMode="numeric" maxLength={4} className="rounded-l-none font-mono" autoComplete="off" onChange={(e) => set('aadhaar_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" />
            </div>
          </Field>
          <Field label="UAN (EPF)" error={err('uan')} hint="12 digits" htmlFor="emp-uan">
            <Input {...bind('uan')} inputMode="numeric" maxLength={12} className="font-mono" onChange={(e) => set('uan', e.target.value.replace(/\D/g, '').slice(0, 12))} />
          </Field>
          <Field label="ESIC IP number" error={err('esic_no')} hint="10 digits · only if covered by ESI" htmlFor="emp-esic_no">
            <Input {...bind('esic_no')} inputMode="numeric" maxLength={10} className="font-mono" onChange={(e) => set('esic_no', e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </Field>
          <Field label="Bank" error={err('bank_name')} htmlFor="emp-bank_name">
            <Input {...bind('bank_name')} list="emp-banks" placeholder="State Bank of India" />
            <datalist id="emp-banks">
              {COMMON_BANKS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Account number" error={err('bank_account')} hint="9–18 digits" htmlFor="emp-bank_account">
            <Input {...bind('bank_account')} inputMode="numeric" maxLength={18} className="font-mono" autoComplete="off" onChange={(e) => set('bank_account', e.target.value.replace(/\D/g, '').slice(0, 18))} />
          </Field>
          <Field label="IFSC" error={err('ifsc')} hint="11 characters, 5th is zero" htmlFor="emp-ifsc">
            <Input {...bind('ifsc')} className="font-mono uppercase" maxLength={11} onChange={(e) => set('ifsc', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} placeholder="SBIN0040170" />
          </Field>
        </>,
      )}

      {section(
        'tax',
        'Tax & skills',
        'Income-tax regime for TDS, and what they are good at',
        <>
          <Field label="Tax regime" hint={values.tax_regime === 'new' ? 'Default regime · standard deduction only' : 'Old regime · 80C / 80D / HRA declarations count'}>
            <Segmented
              value={values.tax_regime}
              onChange={(v) => set('tax_regime', v)}
              options={[
                { value: 'new', label: 'New regime' },
                { value: 'old', label: 'Old regime' },
              ]}
            />
          </Field>
          {values.tax_regime === 'old' ? (
            <Field label="Declared deductions (₹ / year)" required error={err('declared_deductions')} hint="80C (incl. PF), 80D, HRA exemption …" htmlFor="emp-declared_deductions">
              <Input {...bind('declared_deductions')} type="number" inputMode="decimal" min={0} step="1" />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          {tax && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 sm:col-span-2">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Projected monthly TDS on the current salary</p>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                {(['new', 'old'] as const).map((r) => (
                  <div key={r} className={cn('rounded-xl px-3 py-2', values.tax_regime === r ? 'bg-white shadow-sm ring-1 ring-indigo-200' : '')}>
                    <p className="text-[12px] text-ink-soft">{r === 'new' ? 'New regime' : 'Old regime'}</p>
                    <p className="num font-display text-lg font-bold text-ink">{inr(tax[r])}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Field label="Skills" error={err('skills')} hint="Press Enter or comma after each skill" className="sm:col-span-2" htmlFor="emp-skills">
            <ChipsInput id="emp-skills" value={values.skills} onChange={(v) => set('skills', v)} onBlur={() => touch('skills')} placeholder="e.g. Fanuc 0i-TF, GD&T, MIG welding" invalid={!!err('skills')} />
          </Field>
          <Field label="Notes" error={err('notes')} className="sm:col-span-2" htmlFor="emp-notes">
            <Textarea {...bind('notes')} rows={2} placeholder="Internal HR notes (not visible to the employee)" />
          </Field>
        </>,
      )}

      {!editing && (
        <div className="flex gap-3 rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50/80 to-indigo-50/70 p-3.5 text-[13px] text-ink-soft">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-indigo" />
          <p>
            After saving, <b className="text-ink">add a salary structure in Payroll</b> so {values.first_name.trim() || 'the employee'} is included in the next payroll run.
            {s.can('leaves.manage')
              ? ` Leave balances for FY ${fyLabel(fyOf(today))} are opened automatically, pro-rated from the joining date.`
              : ' Leave balances default to the pro-rated annual quota until HR adjusts them.'}{' '}
            Create a login in <b className="text-ink">Users &amp; roles</b> if they need the self-service app.
          </p>
        </div>
      )}
    </Modal>
  )
}
