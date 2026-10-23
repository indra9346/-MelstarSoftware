import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDown, ArrowUp, Bot, Building2, CheckCircle2, CircleDashed, Clock, Cloud, Database, ExternalLink, HardDrive, IndianRupee, Landmark, MapPin,
  Pencil, Plus, RotateCcw, Scale, ShieldAlert, Trash2, UserRoundCog, Wallet,
} from 'lucide-react'
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, EmptyState, Field, Input, KV, Menu, Modal, PageHeader, Segmented, Select, Switch, Tabs, Textarea,
  confirm, guard, toast, type Column,
} from '@/components/ui'
import { ChipsInput, NumberInput } from '@/components/hr/inputs'
import { DATA_MODE } from '@/config/env'
import { resetStaticDemo } from '@/data/boot'
import { useSettings, useTable } from '@/data/store'
import type { CompanySettings, Director, PayrollConfig, SalaryStructure, TaxRegime } from '@/data/types'
import { WEEKDAYS, WEEKDAYS_LONG, currentMonth, fmtDate, fmtHHMM, hhmmToMinutes, minutesToHHMM, relativeTime, todayISO } from '@/lib/dates'
import { inr, inrCompact, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { DEFAULT_PAYROLL_CONFIG, computePayslip, structureFromGross } from '@/lib/payroll'
import { audit } from '@/services/audit'
import {
  DIRECTOR_DESIGNATIONS, RE, deleteDirector, directorToForm, isDate, normaliseList, phoneError, saveDirector, saveSettings, validateDirector, type DirectorFormValues,
} from '@/services/hr'

type Tab = 'company' | 'payroll' | 'plant' | 'petty' | 'data'
type Num = number | null
type Errs = Record<string, string>

const TABS: { value: Tab; label: string }[] = [
  { value: 'company', label: 'Company' },
  { value: 'payroll', label: 'Payroll & statutory' },
  { value: 'plant', label: 'Attendance & plant' },
  { value: 'petty', label: 'Petty cash' },
  { value: 'data', label: 'Data' },
]

export default function SettingsPage() {
  const settings = useSettings()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.some((t) => t.value === raw) ? raw : 'company'
  const [dirty, setDirty] = useState(false)

  const change = async (t: Tab) => {
    if (t === tab) return
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'You have changes on this tab that are not saved yet.', danger: true, confirmLabel: 'Discard' }))) return
    setDirty(false)
    setParams(t === 'company' ? {} : { tab: t }, { replace: true })
  }

  return (
    <div>
      <PageHeader kicker="Administration" title="Settings" subtitle={`${settings.legal_name} · last changed ${relativeTime(settings.updated_at)}`} />
      <Tabs tabs={TABS} value={tab} onChange={(t) => void change(t)} />
      <div key={tab}>
        {tab === 'company' && <CompanyTab onDirty={setDirty} />}
        {tab === 'payroll' && <PayrollTab onDirty={setDirty} />}
        {tab === 'plant' && <PlantTab onDirty={setDirty} />}
        {tab === 'petty' && <PettyTab onDirty={setDirty} />}
        {tab === 'data' && <DataTab onDirty={setDirty} />}
      </div>
    </div>
  )
}

/* ─────────────────────────────── shared bits ─────────────────────────────── */

/**
 * Draft of one tab, derived from company_settings. Follows remote changes while the user has not
 * edited anything; reports `dirty` to the page so switching tabs can warn.
 */
function useDraft<T>(of: (s: CompanySettings) => T, onDirty: (d: boolean) => void) {
  const settings = useSettings()
  const base = useMemo(() => of(settings), [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<T>(base)
  const prev = useRef(base)
  useEffect(() => {
    const prevJson = JSON.stringify(prev.current)
    if (prevJson === JSON.stringify(base)) return
    setDraft((d) => (JSON.stringify(d) === prevJson ? base : d))
    prev.current = base
  }, [base])
  const dirty = JSON.stringify(draft) !== JSON.stringify(base)
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  return { draft, setDraft, dirty, reset: () => setDraft(base), settings }
}

function SaveBar({ dirty, errors, busy, onSave, onReset, what }: { dirty: boolean; errors: number; busy?: boolean; onSave: () => void; onReset: () => void; what: string }) {
  return (
    <div className="sticky bottom-[84px] z-20 mt-5 lg:bottom-4">
      <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 transition-colors', dirty ? 'border-amber-300 bg-white shadow-lift' : 'border-line bg-white')}>
        <span className="mr-auto flex min-w-0 items-center gap-2 text-[13px] font-medium">
          {errors ? (
            <span className="flex items-center gap-1.5 text-rose-600">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {errors} field{errors === 1 ? '' : 's'} need attention
            </span>
          ) : dirty ? (
            <span className="flex items-center gap-1.5 text-amber-600">
              <CircleDashed className="h-4 w-4 shrink-0" /> Unsaved changes to {what}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-600">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {what} saved
            </span>
          )}
        </span>
        <Button size="sm" variant="secondary" onClick={onReset} disabled={!dirty || busy}>
          Discard
        </Button>
        <Button size="sm" onClick={onSave} disabled={!dirty || errors > 0} loading={busy}>
          Save {what}
        </Button>
      </div>
    </div>
  )
}

function NumField({
  label, value, onChange, error, hint, prefix, suffix, step = 'any', required = true, id,
}: {
  label: ReactNode
  value: Num
  onChange: (v: Num) => void
  error?: string
  hint?: ReactNode
  prefix?: string
  suffix?: string
  step?: string
  required?: boolean
  id: string
}) {
  return (
    <Field label={label} required={required} error={error} hint={hint} htmlFor={id}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[14px] text-ink-faint">{prefix}</span>}
        <NumberInput id={id} value={value} onChange={onChange} step={step} invalid={!!error} className={cn('num', prefix && 'pl-8', suffix && 'pr-16')} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[12.5px] font-medium text-ink-faint">{suffix}</span>}
      </div>
    </Field>
  )
}

/** Range check for a numeric field; `int` requires a whole number. */
function numErr(v: Num, min: number, max: number, opts: { int?: boolean; label?: string } = {}): string | undefined {
  if (v == null) return 'Required'
  if (opts.int && !Number.isInteger(v)) return 'Use a whole number'
  if (v < min) return `Minimum ${num(min)}`
  if (v > max) return `Maximum ${num(max)}`
  return undefined
}

const section = (title: string, sub: string, icon: ReactNode, children: ReactNode, actions?: ReactNode) => (
  <Card>
    <CardHeader title={title} subtitle={sub} icon={icon} actions={actions} />
    <CardBody>{children}</CardBody>
  </Card>
)

/* ─────────────────────────────── Company ─────────────────────────────── */

interface CompanyDraft {
  legal_name: string
  short_name: string
  cin: string
  incorporated_on: string
  roc: string
  company_type: string
  company_category: string
  listing_status: string
  status: string
  authorised_capital: Num
  paid_up_capital: Num
  sectors: string[]
  business_activity: string
  registered_office: string
  plant_address: string
  plant_lat: Num
  plant_lng: Num
  plus_code: string
  phone: string
  email: string
  website: string
  gstin: string
  pan: string
  tan: string
  pf_establishment_code: string
  esi_employer_code: string
  pt_registration_no: string
}

const companyOf = (s: CompanySettings): CompanyDraft => ({
  legal_name: s.legal_name, short_name: s.short_name, cin: s.cin, incorporated_on: s.incorporated_on, roc: s.roc, company_type: s.company_type,
  company_category: s.company_category, listing_status: s.listing_status, status: s.status, authorised_capital: s.authorised_capital, paid_up_capital: s.paid_up_capital,
  sectors: [...s.sectors], business_activity: s.business_activity, registered_office: s.registered_office, plant_address: s.plant_address, plant_lat: s.plant_lat,
  plant_lng: s.plant_lng, plus_code: s.plus_code, phone: s.phone, email: s.email, website: s.website, gstin: s.gstin, pan: s.pan, tan: s.tan,
  pf_establishment_code: s.pf_establishment_code, esi_employer_code: s.esi_employer_code, pt_registration_no: s.pt_registration_no,
})

const PF_CODE_RE = /^([A-Z]{5}\d{10}|[A-Z]{2}\/[A-Z]{3}\/\d{1,7}(\/\d{1,3})?)$/
const PT_REG_RE = /^[A-Z0-9/-]{6,25}$/

function validateCompany(d: CompanyDraft): Errs {
  const e: Errs = {}
  const req = (k: keyof CompanyDraft, label: string, max = 200) => {
    const v = String(d[k] ?? '').trim()
    if (!v) e[k] = `${label} is required`
    else if (v.length > max) e[k] = `Keep it under ${max} characters`
  }
  req('legal_name', 'Legal name', 150)
  req('short_name', 'Short name', 40)
  if (!d.cin.trim()) e.cin = 'CIN is required'
  else if (!RE.cin.test(d.cin.trim())) e.cin = '21 characters, e.g. U29309KA2011PTC060656'
  if (!isDate(d.incorporated_on)) e.incorporated_on = 'Incorporation date is required'
  else if (d.incorporated_on > todayISO()) e.incorporated_on = 'Cannot be in the future'
  else if (d.cin.length >= 12 && RE.cin.test(d.cin) && d.cin.slice(8, 12) !== d.incorporated_on.slice(0, 4)) e.incorporated_on = `CIN says the company was incorporated in ${d.cin.slice(8, 12)}`
  const auth = numErr(d.authorised_capital, 0, 1e13)
  if (auth) e.authorised_capital = auth
  const paid = numErr(d.paid_up_capital, 0, 1e13)
  if (paid) e.paid_up_capital = paid
  else if (d.authorised_capital != null && d.paid_up_capital! > d.authorised_capital) e.paid_up_capital = 'Paid-up capital cannot exceed authorised capital'
  if (d.sectors.length > 12) e.sectors = 'Up to 12 sectors'
  if (d.business_activity.length > 600) e.business_activity = 'Keep it under 600 characters'
  req('registered_office', 'Registered office', 300)
  req('plant_address', 'Plant address', 300)
  const lat = numErr(d.plant_lat, -90, 90)
  if (lat) e.plant_lat = lat
  const lng = numErr(d.plant_lng, -180, 180)
  if (lng) e.plant_lng = lng
  if (!lat && !lng && d.plant_lat === 0 && d.plant_lng === 0) e.plant_lat = 'Set the plant location (used for the check-in geofence)'
  const pe = phoneError(d.phone)
  if (pe) e.phone = pe
  if (d.email.trim() && !RE.email.test(d.email.trim())) e.email = 'Enter a valid e-mail address'
  if (d.website.trim() && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(d.website.trim())) e.website = 'Start with https://'
  const pan = d.pan.trim()
  if (pan && !RE.pan.test(pan)) e.pan = 'Format AAACM1234A'
  else if (pan && pan[3] !== 'C') e.pan = 'A company PAN has C as the 4th letter'
  const gst = d.gstin.trim()
  if (gst && !RE.gstin.test(gst)) e.gstin = '15 characters, e.g. 29AAACM1234A1Z5'
  else if (gst && pan && RE.pan.test(pan) && gst.slice(2, 12) !== pan) e.gstin = 'Characters 3–12 must be the company PAN'
  if (d.tan.trim() && !RE.tan.test(d.tan.trim())) e.tan = 'Format BLRM12345A'
  if (d.pf_establishment_code.trim() && !PF_CODE_RE.test(d.pf_establishment_code.trim())) e.pf_establishment_code = 'e.g. KNBNG0012345000 (15 characters)'
  if (d.esi_employer_code.trim() && !RE.esiEmployer.test(d.esi_employer_code.trim())) e.esi_employer_code = 'ESI employer code is 17 digits'
  if (d.pt_registration_no.trim() && !PT_REG_RE.test(d.pt_registration_no.trim())) e.pt_registration_no = '6–25 letters, digits, / or -'
  return e
}

function CompanyTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft: d, setDraft, dirty, reset } = useDraft(companyOf, onDirty)
  const errors = validateCompany(d)
  const set = <K extends keyof CompanyDraft>(k: K, v: CompanyDraft[K]) => setDraft((p) => ({ ...p, [k]: v }))
  const text = (k: keyof CompanyDraft, opts: { upper?: boolean } = {}) => ({
    id: `co-${k}`,
    value: d[k] as string,
    invalid: !!errors[k],
    onChange: (e: { target: { value: string } }) => set(k, (opts.upper ? e.target.value.toUpperCase().replace(/\s/g, '') : e.target.value) as never),
  })

  const save = () => {
    const patch: Partial<CompanySettings> = {
      legal_name: d.legal_name.trim(), short_name: d.short_name.trim(), cin: d.cin.trim(), incorporated_on: d.incorporated_on, roc: d.roc.trim(),
      company_type: d.company_type.trim(), company_category: d.company_category.trim(), listing_status: d.listing_status.trim(), status: d.status.trim(),
      authorised_capital: d.authorised_capital ?? 0, paid_up_capital: d.paid_up_capital ?? 0, sectors: normaliseList(d.sectors, 60),
      business_activity: d.business_activity.trim(), registered_office: d.registered_office.trim(), plant_address: d.plant_address.trim(),
      plant_lat: d.plant_lat ?? 0, plant_lng: d.plant_lng ?? 0, plus_code: d.plus_code.trim(), phone: d.phone.trim(), email: d.email.trim().toLowerCase(),
      website: d.website.trim(), gstin: d.gstin.trim(), pan: d.pan.trim(), tan: d.tan.trim(), pf_establishment_code: d.pf_establishment_code.trim(),
      esi_employer_code: d.esi_employer_code.trim(), pt_registration_no: d.pt_registration_no.trim(),
    }
    void guard(() => (saveSettings(patch, 'company') ? undefined : toast.info('Nothing changed')), 'Company details saved')
  }

  const mapUrl = d.plant_lat != null && d.plant_lng != null ? `https://www.google.com/maps?q=${d.plant_lat},${d.plant_lng}` : null

  return (
    <div className="space-y-4">
      {section(
        'Identity',
        'As registered with the Ministry of Corporate Affairs',
        <Building2 className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Legal name" required error={errors.legal_name} className="sm:col-span-2" htmlFor="co-legal_name">
            <Input {...text('legal_name')} />
          </Field>
          <Field label="Short name" required error={errors.short_name} htmlFor="co-short_name">
            <Input {...text('short_name')} />
          </Field>
          <Field label="CIN" required error={errors.cin} htmlFor="co-cin">
            <Input {...text('cin', { upper: true })} className="font-mono" maxLength={21} />
          </Field>
          <Field label="Incorporated on" required error={errors.incorporated_on} htmlFor="co-incorporated_on">
            <Input {...text('incorporated_on')} type="date" max={todayISO()} />
          </Field>
          <Field label="Registrar of Companies" error={errors.roc} htmlFor="co-roc">
            <Input {...text('roc')} placeholder="RoC Bangalore" />
          </Field>
          <Field label="Company type" htmlFor="co-company_type">
            <Input {...text('company_type')} />
          </Field>
          <Field label="Category" htmlFor="co-company_category">
            <Input {...text('company_category')} />
          </Field>
          <Field label="Listing status" htmlFor="co-listing_status">
            <Input {...text('listing_status')} />
          </Field>
          <Field label="Company status" htmlFor="co-status">
            <Input {...text('status')} list="co-status-list" />
            <datalist id="co-status-list">
              {['Active', 'Dormant', 'Under process of striking off', 'Amalgamated', 'Strike off'].map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </Field>
          <NumField id="co-auth" label="Authorised capital" prefix="₹" value={d.authorised_capital} onChange={(v) => set('authorised_capital', v)} error={errors.authorised_capital} hint={d.authorised_capital ? inrCompact(d.authorised_capital) : undefined} step="1" />
          <NumField id="co-paid" label="Paid-up capital" prefix="₹" value={d.paid_up_capital} onChange={(v) => set('paid_up_capital', v)} error={errors.paid_up_capital} hint={d.paid_up_capital ? inrCompact(d.paid_up_capital) : undefined} step="1" />
          <Field label="Sectors" error={errors.sectors} hint="Press Enter after each" className="sm:col-span-2 xl:col-span-3">
            <ChipsInput value={d.sectors} onChange={(v) => set('sectors', v)} max={12} maxLen={60} placeholder="e.g. Heavy Machinery" />
          </Field>
          <Field label="Business activity" error={errors.business_activity} className="sm:col-span-2 xl:col-span-3" htmlFor="co-business_activity">
            <Textarea {...text('business_activity')} rows={2} />
          </Field>
        </div>,
      )}

      {section(
        'Addresses & location',
        'The plant location drives the check-in geofence',
        <MapPin className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Registered office" required error={errors.registered_office} htmlFor="co-registered_office">
            <Textarea {...text('registered_office')} rows={3} />
          </Field>
          <Field label="Plant address" required error={errors.plant_address} htmlFor="co-plant_address">
            <Textarea {...text('plant_address')} rows={3} />
          </Field>
          <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 sm:col-span-2 lg:grid-cols-4">
            <NumField id="co-lat" label="Plant latitude" value={d.plant_lat} onChange={(v) => set('plant_lat', v)} error={errors.plant_lat} step="0.0001" suffix="°N" />
            <NumField id="co-lng" label="Plant longitude" value={d.plant_lng} onChange={(v) => set('plant_lng', v)} error={errors.plant_lng} step="0.0001" suffix="°E" />
            <Field label="Plus code" htmlFor="co-plus_code">
              <Input {...text('plus_code')} placeholder="7HFG+CR Doddaballapura" />
            </Field>
            <div className="flex items-end">
              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-md border border-brand-200/80 bg-white px-3 text-[13px] font-medium text-brand-600 transition hover:bg-brand-50">
                  <ExternalLink className="h-4 w-4" /> Check on the map
                </a>
              )}
            </div>
          </div>
        </div>,
      )}

      {section(
        'Contact',
        'Printed on payslips, purchase orders and reports',
        <UserRoundCog className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Phone" error={errors.phone} required={false} htmlFor="co-phone">
            <Input {...text('phone')} type="tel" inputMode="tel" placeholder="080 2345 6789" />
          </Field>
          <Field label="E-mail" error={errors.email} htmlFor="co-email">
            <Input {...text('email')} type="email" inputMode="email" placeholder="info@melstarmanufacturing.in" />
          </Field>
          <Field label="Website" error={errors.website} htmlFor="co-website">
            <Input {...text('website')} type="url" placeholder="https://" />
          </Field>
        </div>,
      )}

      {section(
        'Tax & statutory registrations',
        'Needed for GST invoices, TDS returns and PF / ESI / PT challans',
        <Landmark className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="GSTIN" error={errors.gstin} hint="Karnataka GSTINs start with 29" htmlFor="co-gstin">
            <Input {...text('gstin', { upper: true })} className="font-mono" maxLength={15} placeholder="29AAACM1234A1Z5" />
          </Field>
          <Field label="PAN" error={errors.pan} htmlFor="co-pan">
            <Input {...text('pan', { upper: true })} className="font-mono" maxLength={10} placeholder="AAACM1234A" />
          </Field>
          <Field label="TAN" error={errors.tan} hint="For TDS on salaries (Form 24Q)" htmlFor="co-tan">
            <Input {...text('tan', { upper: true })} className="font-mono" maxLength={10} placeholder="BLRM12345A" />
          </Field>
          <Field label="PF establishment code" error={errors.pf_establishment_code} htmlFor="co-pf_establishment_code">
            <Input {...text('pf_establishment_code', { upper: true })} className="font-mono" maxLength={22} placeholder="KNBNG0012345000" />
          </Field>
          <Field label="ESI employer code" error={errors.esi_employer_code} htmlFor="co-esi_employer_code">
            <Input {...text('esi_employer_code')} onChange={(e) => set('esi_employer_code', e.target.value.replace(/\D/g, '').slice(0, 17))} className="font-mono" inputMode="numeric" placeholder="17 digits" />
          </Field>
          <Field label="PT registration no." error={errors.pt_registration_no} hint="Karnataka Professional Tax (employer)" htmlFor="co-pt_registration_no">
            <Input {...text('pt_registration_no', { upper: true })} className="font-mono" maxLength={25} />
          </Field>
        </div>,
      )}

      <SaveBar dirty={dirty} errors={Object.keys(errors).length} onSave={save} onReset={reset} what="company details" />

      <DirectorsCard />
    </div>
  )
}

function DirectorsCard() {
  const directors = useTable('directors')
  const [editing, setEditing] = useState<Director | 'new' | null>(null)
  const rows = useMemo(() => [...directors].sort((a, b) => a.appointed_on.localeCompare(b.appointed_on)), [directors])

  const remove = async (d: Director) => {
    if (await confirm({ title: `Remove ${d.name}?`, message: `DIN ${d.din} will be removed from the board list.`, danger: true, confirmLabel: 'Remove' })) await guard(() => deleteDirector(d), 'Director removed')
  }

  const columns: Column<Director>[] = [
    { key: 'name', header: 'Director', value: (d) => d.name, cell: (d) => <span className="min-w-0"><span className="block font-semibold text-ink">{d.name}</span><span className="block text-[12px] text-ink-soft">{d.designation}</span></span> },
    { key: 'din', header: 'DIN', value: (d) => d.din, cell: (d) => <span className="num font-mono whitespace-nowrap">{d.din}</span> },
    { key: 'appointed', header: 'Appointed', value: (d) => d.appointed_on, cell: (d) => <span className="num whitespace-nowrap">{fmtDate(d.appointed_on)}</span> },
    {
      key: 'other',
      header: 'Other directorships',
      value: (d) => d.other_directorships.join(', '),
      cell: (d) => (d.other_directorships.length ? <span className="flex flex-wrap gap-1">{d.other_directorships.map((o) => <Badge key={o} tone="slate">{o}</Badge>)}</span> : <span className="text-ink-faint">None</span>),
      sortable: false,
    },
    {
      key: 'actions',
      header: '',
      sortable: false,
      align: 'right',
      cell: (d) => (
        <Menu
          items={[
            { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(d) },
            { label: 'Remove', icon: <Trash2 />, danger: true, onClick: () => void remove(d) },
          ]}
        />
      ),
    },
  ]

  return (
    <Card>
      <CardHeader
        title="Board of directors"
        subtitle={`${rows.length} director${rows.length === 1 ? '' : 's'} · DIN as per MCA records`}
        icon={<Scale className="h-4 w-4" />}
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add director
          </Button>
        }
      />
      <CardBody>
        <DataTable rows={rows} columns={columns} rowKey={(d) => d.id} onRowClick={(d) => setEditing(d)} empty={<EmptyState icon={<Scale className="h-6 w-6" />} title="No directors recorded" />} />
      </CardBody>
      <DirectorModal value={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function DirectorModal({ value, onClose }: { value: Director | 'new' | null; onClose: () => void }) {
  const existing = value && value !== 'new' ? value : undefined
  const [f, setF] = useState<DirectorFormValues>(directorToForm(existing))
  const [touched, setTouched] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!value) return
    setF(directorToForm(value === 'new' ? undefined : value))
    setTouched(new Set())
  }, [value])
  const errors = validateDirector(f, existing)
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof DirectorFormValues) => (touched.has(k) ? errors[k] : undefined)
  const touch = (k: keyof DirectorFormValues) => setTouched((t) => new Set(t).add(k))
  const save = async () => {
    if (invalid) return setTouched(new Set(Object.keys(f)))
    if (await guard(() => saveDirector(f, existing), existing ? 'Director updated' : 'Director added')) onClose()
  }
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'Add director'}
      subtitle="Director Identification Number (DIN) is 8 digits"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={invalid}>
            {existing ? 'Save' : 'Add director'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={err('name')} className="sm:col-span-2" htmlFor="dir-name">
          <Input id="dir-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => touch('name')} invalid={!!err('name')} />
        </Field>
        <Field label="Designation" required error={err('designation')} htmlFor="dir-desig">
          <Input id="dir-desig" list="dir-desig-list" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} onBlur={() => touch('designation')} invalid={!!err('designation')} />
          <datalist id="dir-desig-list">
            {DIRECTOR_DESIGNATIONS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <Field label="DIN" required error={err('din')} htmlFor="dir-din">
          <Input id="dir-din" inputMode="numeric" maxLength={8} className="font-mono" value={f.din} onChange={(e) => setF({ ...f, din: e.target.value.replace(/\D/g, '').slice(0, 8) })} onBlur={() => touch('din')} invalid={!!err('din')} placeholder="02146175" />
        </Field>
        <Field label="Appointed on" required error={err('appointed_on')} htmlFor="dir-date">
          <Input id="dir-date" type="date" max={todayISO()} value={f.appointed_on} onChange={(e) => setF({ ...f, appointed_on: e.target.value })} onBlur={() => touch('appointed_on')} invalid={!!err('appointed_on')} />
        </Field>
        <Field label="Other directorships" error={err('other_directorships')} hint="Company names, press Enter after each" className="sm:col-span-2">
          <ChipsInput value={f.other_directorships} onChange={(v) => setF({ ...f, other_directorships: v })} max={30} maxLen={120} placeholder="e.g. Macurex Sensors Pvt Ltd" />
        </Field>
      </div>
    </Modal>
  )
}

/* ─────────────────────────────── Payroll ─────────────────────────────── */

type NumKey =
  | 'pf_employee_rate' | 'pf_employer_epf_rate' | 'pf_employer_eps_rate' | 'pf_edli_rate' | 'pf_admin_rate' | 'pf_wage_ceiling'
  | 'esi_wage_threshold' | 'esi_employee_rate' | 'esi_employer_rate'
  | 'tds_new_standard_deduction' | 'tds_new_rebate_limit' | 'tds_old_standard_deduction' | 'tds_old_rebate_limit' | 'tds_cess_rate'
  | 'ot_multiplier' | 'ot_base_days' | 'ot_hours_per_day' | 'pay_day'

interface FieldSpec {
  key: NumKey
  label: string
  min: number
  max: number
  int?: boolean
  prefix?: string
  suffix?: string
  step?: string
  hint?: string
}

const PF_FIELDS: FieldSpec[] = [
  { key: 'pf_employee_rate', label: 'Employee PF', min: 0, max: 100, suffix: '%', hint: 'Statutory 12% of PF wages' },
  { key: 'pf_employer_eps_rate', label: 'Employer EPS (pension)', min: 0, max: 100, suffix: '%', hint: '8.33% on wages up to the ceiling' },
  { key: 'pf_employer_epf_rate', label: 'Employer EPF', min: 0, max: 100, suffix: '%', hint: '3.67% — balance of the 12% share' },
  { key: 'pf_edli_rate', label: 'EDLI', min: 0, max: 10, suffix: '%', hint: '0.5% insurance contribution' },
  { key: 'pf_admin_rate', label: 'EPF admin charges', min: 0, max: 10, suffix: '%', hint: '0.5% of PF wages' },
  { key: 'pf_wage_ceiling', label: 'PF wage ceiling', min: 0, max: 1_000_000, int: true, prefix: '₹', suffix: '/ month', hint: '₹15,000 statutory ceiling' },
]
const ESI_FIELDS: FieldSpec[] = [
  { key: 'esi_wage_threshold', label: 'ESI wage threshold', min: 0, max: 1_000_000, int: true, prefix: '₹', suffix: '/ month', hint: 'Covered when monthly gross ≤ this' },
  { key: 'esi_employee_rate', label: 'Employee ESI', min: 0, max: 100, suffix: '%', hint: 'Statutory 0.75%' },
  { key: 'esi_employer_rate', label: 'Employer ESI', min: 0, max: 100, suffix: '%', hint: 'Statutory 3.25%' },
]
const TDS_FIELDS: FieldSpec[] = [
  { key: 'tds_new_standard_deduction', label: 'New regime · standard deduction', min: 0, max: 1_000_000, int: true, prefix: '₹' },
  { key: 'tds_new_rebate_limit', label: 'New regime · 87A rebate up to', min: 0, max: 10_000_000, int: true, prefix: '₹', hint: 'No tax up to this taxable income' },
  { key: 'tds_old_standard_deduction', label: 'Old regime · standard deduction', min: 0, max: 1_000_000, int: true, prefix: '₹' },
  { key: 'tds_old_rebate_limit', label: 'Old regime · 87A rebate up to', min: 0, max: 10_000_000, int: true, prefix: '₹' },
  { key: 'tds_cess_rate', label: 'Health & education cess', min: 0, max: 20, suffix: '%', hint: '4% on tax' },
]
const OT_FIELDS: FieldSpec[] = [
  { key: 'ot_multiplier', label: 'OT multiplier', min: 1, max: 4, step: '0.25', suffix: '×', hint: 'Factories Act s.59: twice the ordinary rate' },
  { key: 'ot_base_days', label: 'Days for daily rate', min: 20, max: 31, int: true, step: '1', suffix: 'days', hint: '(Basic + DA) ÷ days ÷ hours' },
  { key: 'ot_hours_per_day', label: 'Hours per day', min: 1, max: 12, step: '0.5', suffix: 'hours' },
  { key: 'pay_day', label: 'Salary credit day', min: 1, max: 28, int: true, step: '1', suffix: 'of next month', hint: 'Payment of Wages Act: by the 7th (under 1,000 workers)' },
]
const ALL_FIELDS = [...PF_FIELDS, ...ESI_FIELDS, ...TDS_FIELDS, ...OT_FIELDS]

interface PtRow {
  min: Num
  max: Num
  amount: Num
  feb_amount: Num
}
interface TaxRow {
  upto: Num
  rate: Num
}
interface PayrollDraft {
  nums: Record<NumKey, Num>
  pf_restrict_to_ceiling: boolean
  pt_state: string
  pt_slabs: PtRow[]
  tds_new: TaxRow[]
  tds_old: TaxRow[]
}

const payrollOfConfig = (p: PayrollConfig): PayrollDraft => ({
  nums: Object.fromEntries(ALL_FIELDS.map((f) => [f.key, p[f.key]])) as Record<NumKey, Num>,
  pf_restrict_to_ceiling: p.pf_restrict_to_ceiling,
  pt_state: p.pt_state,
  pt_slabs: p.pt_slabs.map((s) => ({ min: s.min, max: s.max, amount: s.amount, feb_amount: s.feb_amount ?? null })),
  tds_new: p.tds_new_regime_slabs.map((s) => ({ upto: s.upto, rate: s.rate })),
  tds_old: p.tds_old_regime_slabs.map((s) => ({ upto: s.upto, rate: s.rate })),
})
const payrollOf = (s: CompanySettings) => payrollOfConfig({ ...DEFAULT_PAYROLL_CONFIG, ...s.payroll })

function toConfig(d: PayrollDraft): PayrollConfig {
  const n = d.nums
  return {
    pf_employee_rate: n.pf_employee_rate!, pf_employer_epf_rate: n.pf_employer_epf_rate!, pf_employer_eps_rate: n.pf_employer_eps_rate!, pf_edli_rate: n.pf_edli_rate!,
    pf_admin_rate: n.pf_admin_rate!, pf_wage_ceiling: n.pf_wage_ceiling!, pf_restrict_to_ceiling: d.pf_restrict_to_ceiling, esi_wage_threshold: n.esi_wage_threshold!,
    esi_employee_rate: n.esi_employee_rate!, esi_employer_rate: n.esi_employer_rate!, pt_state: d.pt_state.trim(),
    pt_slabs: d.pt_slabs.map((s) => ({ min: s.min!, max: s.max, amount: s.amount!, ...(s.feb_amount != null ? { feb_amount: s.feb_amount } : {}) })),
    tds_new_regime_slabs: d.tds_new.map((s) => ({ upto: s.upto, rate: s.rate! })),
    tds_new_standard_deduction: n.tds_new_standard_deduction!, tds_new_rebate_limit: n.tds_new_rebate_limit!,
    tds_old_regime_slabs: d.tds_old.map((s) => ({ upto: s.upto, rate: s.rate! })),
    tds_old_standard_deduction: n.tds_old_standard_deduction!, tds_old_rebate_limit: n.tds_old_rebate_limit!, tds_cess_rate: n.tds_cess_rate!,
    ot_multiplier: n.ot_multiplier!, ot_base_days: n.ot_base_days!, ot_hours_per_day: n.ot_hours_per_day!, pay_day: n.pay_day!,
  }
}

function validatePtSlabs(rows: PtRow[]): Errs {
  const e: Errs = {}
  if (!rows.length) e.pt = 'Add at least one slab (₹0 and above, amount 0 if no PT)'
  rows.forEach((r, i) => {
    const p = `pt.${i}`
    if (r.min == null || r.min < 0) e[`${p}.min`] = 'From ≥ 0'
    if (r.max != null && r.min != null && r.max < r.min) e[`${p}.max`] = 'To must be ≥ From'
    if (r.max == null && i !== rows.length - 1) e[`${p}.max`] = 'Only the last slab can be open-ended'
    if (r.amount == null || r.amount < 0 || r.amount > 2500) e[`${p}.amount`] = '0 – 2,500'
    if (r.feb_amount != null && (r.feb_amount < 0 || r.feb_amount > 2500)) e[`${p}.feb_amount`] = '0 – 2,500'
    const prev = rows[i - 1]
    if (prev && r.min != null && prev.max != null && r.min <= prev.max) e[`${p}.min`] = `Overlaps the slab above (ends ₹${num(prev.max)})`
    if (prev && r.min != null && prev.min != null && r.min <= prev.min) e[`${p}.min`] = 'Slabs must go up'
  })
  return e
}

function validateTaxSlabs(rows: TaxRow[], key: string): Errs {
  const e: Errs = {}
  if (!rows.length) e[key] = 'Add at least one slab'
  rows.forEach((r, i) => {
    const p = `${key}.${i}`
    if (r.rate == null || r.rate < 0 || r.rate > 100) e[`${p}.rate`] = '0 – 100%'
    const last = i === rows.length - 1
    if (r.upto == null && !last) e[`${p}.upto`] = 'Only the last slab can be open-ended'
    if (r.upto != null && last) e[`${p}.upto`] = 'Leave the last slab blank (“and above”)'
    if (r.upto != null && r.upto <= 0) e[`${p}.upto`] = 'Must be above 0'
    const prev = rows[i - 1]
    if (prev?.upto != null && r.upto != null && r.upto <= prev.upto) e[`${p}.upto`] = 'Must be higher than the slab above'
  })
  return e
}

function validatePayroll(d: PayrollDraft): Errs {
  const e: Errs = {}
  for (const f of ALL_FIELDS) {
    const m = numErr(d.nums[f.key], f.min, f.max, { int: f.int })
    if (m) e[f.key] = m
  }
  if (!d.pt_state.trim()) e.pt_state = 'State is required'
  return { ...e, ...validatePtSlabs(d.pt_slabs), ...validateTaxSlabs(d.tds_new, 'tds_new'), ...validateTaxSlabs(d.tds_old, 'tds_old') }
}

function PayrollTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft: d, setDraft, dirty, reset } = useDraft(payrollOf, onDirty)
  const errors = validatePayroll(d)
  const nErr = Object.keys(errors).length
  const setNum = (k: NumKey, v: Num) => setDraft((p) => ({ ...p, nums: { ...p.nums, [k]: v } }))
  const field = (f: FieldSpec) => (
    <NumField key={f.key} id={`pr-${f.key}`} label={f.label} value={d.nums[f.key]} onChange={(v) => setNum(f.key, v)} error={errors[f.key]} hint={f.hint} prefix={f.prefix} suffix={f.suffix} step={f.step} />
  )
  const employerTotal = (d.nums.pf_employer_epf_rate ?? 0) + (d.nums.pf_employer_eps_rate ?? 0)
  const splitOff = d.nums.pf_employee_rate != null && Math.abs(employerTotal - d.nums.pf_employee_rate) > 0.001

  const save = () => void guard(() => (saveSettings({ payroll: toConfig(d) }, 'payroll & statutory') ? undefined : toast.info('Nothing changed')), 'Payroll settings saved')
  const restore = async () => {
    if (await confirm({ title: 'Restore statutory defaults?', message: 'Fills the form with the built-in FY 2026-27 defaults (EPF 12%, ESI 0.75/3.25%, Karnataka PT, new-regime slabs). Nothing is saved until you press Save.', confirmLabel: 'Fill defaults' }))
      setDraft(payrollOfConfig(DEFAULT_PAYROLL_CONFIG))
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-[13px] text-amber-900">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="font-semibold">Confirm statutory rates with the company’s Chartered Accountant before running payroll.</p>
          <p className="mt-0.5 text-amber-800">PF, ESI, Professional Tax and income-tax slabs change with budgets and government notifications. Changes apply to the next payroll run; processed payslips are not recalculated.</p>
        </div>
        <Button size="sm" variant="secondary" className="ml-auto hidden shrink-0 sm:inline-flex" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void restore()}>
          Defaults
        </Button>
      </div>

      {section(
        'Provident fund (EPF)',
        'Employees’ Provident Funds & Miscellaneous Provisions Act, 1952',
        <Landmark className="h-4 w-4" />,
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{PF_FIELDS.map(field)}</div>
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-line bg-white p-3.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Switch
                checked={d.pf_restrict_to_ceiling}
                onChange={(v) => setDraft((p) => ({ ...p, pf_restrict_to_ceiling: v }))}
                label="Restrict employee PF to the wage ceiling"
                description="On: 12% of min(Basic + DA, ceiling). Off: 12% of full Basic + DA (voluntary higher contribution)."
              />
            </div>
          </div>
          {splitOff && <p className="mt-2 text-[12.5px] font-medium text-amber-700">Employer EPF + EPS is {num(employerTotal)}% — it normally equals the employee rate ({num(d.nums.pf_employee_rate)}%).</p>}
        </>,
      )}

      {section('Employees’ State Insurance (ESI)', 'ESI Act, 1948 — contributions on gross wages earned', <IndianRupee className="h-4 w-4" />, <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{ESI_FIELDS.map(field)}</div>)}

      {section(
        'Professional Tax',
        'Monthly slabs on gross salary',
        <Building2 className="h-4 w-4" />,
        <>
          <div className="mb-4 max-w-xs">
            <Field label="State" required error={errors.pt_state} htmlFor="pr-pt-state">
              <Input id="pr-pt-state" value={d.pt_state} onChange={(e) => setDraft((p) => ({ ...p, pt_state: e.target.value }))} invalid={!!errors.pt_state} />
            </Field>
          </div>
          <PtSlabsEditor rows={d.pt_slabs} errors={errors} onChange={(pt_slabs) => setDraft((p) => ({ ...p, pt_slabs }))} />
        </>,
      )}

      {section(
        'Income tax (TDS on salary)',
        'Annual slabs on taxable income · projected tax ÷ 12 each month',
        <Scale className="h-4 w-4" />,
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TaxSlabsEditor title="New regime (default)" keyName="tds_new" rows={d.tds_new} errors={errors} onChange={(tds_new) => setDraft((p) => ({ ...p, tds_new }))} />
            <TaxSlabsEditor title="Old regime" keyName="tds_old" rows={d.tds_old} errors={errors} onChange={(tds_old) => setDraft((p) => ({ ...p, tds_old }))} />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">{TDS_FIELDS.map(field)}</div>
        </>,
      )}

      {section('Overtime & pay day', 'OT hourly rate = (Basic + DA) ÷ days ÷ hours × multiplier', <Clock className="h-4 w-4" />, <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{OT_FIELDS.map(field)}</div>)}

      <PayrollPreview config={nErr ? null : toConfig(d)} />

      <div className="sm:hidden">
        <Button variant="secondary" className="w-full" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void restore()}>
          Fill statutory defaults
        </Button>
      </div>

      <SaveBar dirty={dirty} errors={nErr} onSave={save} onReset={reset} what="payroll settings" />
    </div>
  )
}

function SlabInput({ value, onChange, error, label, placeholder, prefix, suffix }: { value: Num; onChange: (v: Num) => void; error?: string; label: string; placeholder?: string; prefix?: string; suffix?: string }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint sm:hidden">{label}</span>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-ink-faint">{prefix}</span>}
        <NumberInput value={value} onChange={onChange} invalid={!!error} placeholder={placeholder} aria-label={label} title={error} step="any" className={cn('num h-10 py-0 text-sm', prefix && 'pl-7', suffix && 'pr-8')} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] font-medium text-ink-faint">{suffix}</span>}
      </div>
      {error && <p className="mt-0.5 text-[11.5px] font-medium text-rose-600">{error}</p>}
    </div>
  )
}

function PtSlabsEditor({ rows, errors, onChange }: { rows: PtRow[]; errors: Errs; onChange: (r: PtRow[]) => void }) {
  const set = (i: number, patch: Partial<PtRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => {
    const last = rows[rows.length - 1]
    if (!last) return onChange([{ min: 0, max: null, amount: 0, feb_amount: null }])
    const top = last.max ?? (last.min ?? 0) + 9999
    onChange([...rows.slice(0, -1), { ...last, max: top }, { min: top + 1, max: null, amount: last.amount ?? 0, feb_amount: null }])
  }
  return (
    <div>
      <div className="hidden grid-cols-[repeat(4,minmax(0,1fr))_2.25rem] gap-2 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint sm:grid">
        <span>Gross from</span>
        <span>Gross to (blank = above)</span>
        <span>PT / month</span>
        <span>February</span>
        <span />
      </div>
      <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-2 gap-2 rounded-md border border-line bg-white p-2.5 sm:grid-cols-[repeat(4,minmax(0,1fr))_2.25rem] sm:items-start sm:border-0 sm:bg-transparent sm:p-0">
              <SlabInput label="Gross from" prefix="₹" value={r.min} onChange={(v) => set(i, { min: v })} error={errors[`pt.${i}.min`]} />
              <SlabInput label="Gross to" prefix="₹" value={r.max} onChange={(v) => set(i, { max: v })} error={errors[`pt.${i}.max`]} placeholder="and above" />
              <SlabInput label="PT / month" prefix="₹" value={r.amount} onChange={(v) => set(i, { amount: v })} error={errors[`pt.${i}.amount`]} />
              <SlabInput label="February" prefix="₹" value={r.feb_amount} onChange={(v) => set(i, { feb_amount: v })} error={errors[`pt.${i}.feb_amount`]} placeholder="same" />
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="col-span-2 grid h-10 place-items-center rounded-md text-ink-faint transition hover:bg-rose-50 hover:text-rose-600 sm:col-span-1" aria-label={`Remove slab ${i + 1}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
      </ul>
      {errors.pt && <p className="mt-1.5 text-[12.5px] font-medium text-rose-600">{errors.pt}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={add}>
          Add slab
        </Button>
        <p className="text-[12px] text-ink-faint">Karnataka: nil below ₹25,000; ₹200 a month above, ₹300 in February (₹2,500 a year).</p>
      </div>
    </div>
  )
}

function TaxSlabsEditor({ title, keyName, rows, errors, onChange }: { title: string; keyName: string; rows: TaxRow[]; errors: Errs; onChange: (r: TaxRow[]) => void }) {
  const set = (i: number, patch: Partial<TaxRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => {
    const prevTop = rows.length >= 2 ? rows[rows.length - 2]!.upto ?? 0 : 0
    const copy = rows.map((r, i) => (i === rows.length - 1 ? { ...r, upto: prevTop + 400000 } : r))
    onChange([...copy, { upto: null, rate: rows[rows.length - 1]?.rate ?? 30 }])
  }
  return (
    <div className="min-w-0 rounded-lg border border-line bg-white p-3.5">
      <p className="mb-2 text-[13px] font-medium text-ink">{title}</p>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] gap-2 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <span>Income up to</span>
        <span>Rate</span>
        <span />
      </div>
      <ul className="space-y-2">
        {rows.map((r, i) => {
          const prev = rows[i - 1]?.upto
          return (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] items-start gap-2">
              <div className="min-w-0">
                <NumberInput value={r.upto} onChange={(v) => set(i, { upto: v })} invalid={!!errors[`${keyName}.${i}.upto`]} placeholder="and above" aria-label="Income up to" className="num h-10 py-0 text-sm" step="any" />
                <p className={cn('mt-0.5 text-[11px]', errors[`${keyName}.${i}.upto`] ? 'font-medium text-rose-600' : 'text-ink-faint')}>
                  {errors[`${keyName}.${i}.upto`] ?? (r.upto == null ? `Above ${inrCompact(prev ?? 0)}` : `${inrCompact(prev ?? 0)} – ${inrCompact(r.upto)}`)}
                </p>
              </div>
              <div className="relative">
                <NumberInput value={r.rate} onChange={(v) => set(i, { rate: v })} invalid={!!errors[`${keyName}.${i}.rate`]} aria-label="Rate" className="num h-10 py-0 pr-7 text-sm" step="any" />
                <span className="pointer-events-none absolute right-3 top-2.5 text-[12px] font-medium text-ink-faint">%</span>
                {errors[`${keyName}.${i}.rate`] && <p className="mt-0.5 text-[11px] font-medium text-rose-600">{errors[`${keyName}.${i}.rate`]}</p>}
              </div>
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="grid h-10 place-items-center rounded-md text-ink-faint transition hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove slab ${i + 1}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          )
        })}
      </ul>
      {errors[keyName] && <p className="mt-1.5 text-[12.5px] font-medium text-rose-600">{errors[keyName]}</p>}
      <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={add}>
        Add slab
      </Button>
    </div>
  )
}

function PayrollPreview({ config }: { config: PayrollConfig | null }) {
  const [gross, setGross] = useState<Num>(30000)
  const [regime, setRegime] = useState<TaxRegime>('new')
  const calc = useMemo(() => {
    if (!config || gross == null || gross <= 0) return null
    const parts = structureFromGross(gross)
    const s = {
      id: 'preview', created_at: '', updated_at: '', employee_id: 'preview', effective_from: todayISO(), ctc_annual: 0, ...parts,
      pf_applicable: true, esi_applicable: true, pt_applicable: true, ot_eligible: false, ot_rate_per_hour: null, notes: '',
    } satisfies SalaryStructure
    const month = currentMonth()
    const c = computePayslip({ month, structure: s, regime, declaredDeductions: 0, daysInMonth: 30, paidDays: 30, otMinutesApproved: 0, config })
    const feb = computePayslip({ month: `${month.slice(0, 4)}-02`, structure: s, regime, declaredDeductions: 0, daysInMonth: 28, paidDays: 28, otMinutesApproved: 0, config })
    return { c, febPt: feb.professional_tax }
  }, [config, gross, regime])

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Live preview" subtitle="A full month for a typical structure (45% basic, 5% DA, HRA 40% of basic)" icon={<Wallet className="h-4 w-4" />} />
      <CardBody>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <NumField id="pv-gross" label="Monthly gross" prefix="₹" value={gross} onChange={setGross} step="500" />
            <Segmented
              value={regime}
              onChange={setRegime}
              options={[
                { value: 'new', label: 'New regime' },
                { value: 'old', label: 'Old regime' },
              ]}
            />
          </div>
          {calc ? (
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Employee</p>
                <KV k="PF" v={inr(calc.c.pf_employee)} />
                <KV k="ESI" v={inr(calc.c.esi_employee)} />
                <KV k="Professional tax" v={`${inr(calc.c.professional_tax)}${calc.febPt !== calc.c.professional_tax ? ` · Feb ${inr(calc.febPt)}` : ''}`} />
                <KV k="TDS" v={inr(calc.c.tds)} />
                <div className="mt-1 border-t border-line pt-1">
                  <KV k="Net pay" v={inr(calc.c.net_pay)} strong />
                </div>
              </div>
              <div className="min-w-0">
                <p className="mb-1 mt-3 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint sm:mt-0">Employer</p>
                <KV k="EPF + EPS" v={inr(calc.c.pf_employer_epf + calc.c.pf_employer_eps)} />
                <KV k="EDLI + admin" v={inr(calc.c.pf_edli + calc.c.pf_admin)} />
                <KV k="ESI" v={inr(calc.c.esi_employer)} />
                <div className="mt-1 border-t border-line pt-1">
                  <KV k="Cost to company" v={inr(calc.c.employer_cost)} strong />
                </div>
              </div>
            </div>
          ) : (
            <p className="self-center rounded-md bg-slate-50 px-4 py-3 text-[13px] text-ink-soft">{config ? 'Enter a monthly gross above ₹0.' : 'Fix the highlighted fields to see the preview.'}</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

/* ─────────────────────────────── Attendance & plant ─────────────────────────────── */

interface PlantDraft {
  plant_open: string
  plant_close: string
  working_days: number[]
  financial_year_start_month: number
  late_marks_per_half_day: Num
  min_ot_minutes: Num
  geofence_radius_m: Num
  auto_absent_after: string
  allow_web_checkin: boolean
}

const plantOf = (s: CompanySettings): PlantDraft => ({
  plant_open: s.plant_open, plant_close: s.plant_close, working_days: [...s.working_days].sort((a, b) => a - b), financial_year_start_month: s.financial_year_start_month,
  late_marks_per_half_day: s.attendance.late_marks_per_half_day, min_ot_minutes: s.attendance.min_ot_minutes, geofence_radius_m: s.attendance.geofence_radius_m,
  auto_absent_after: s.attendance.auto_absent_after, allow_web_checkin: s.attendance.allow_web_checkin,
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function validatePlant(d: PlantDraft): Errs {
  const e: Errs = {}
  if (!RE.hhmm.test(d.plant_open)) e.plant_open = 'Use HH:MM'
  if (!RE.hhmm.test(d.plant_close)) e.plant_close = 'Use HH:MM'
  else if (RE.hhmm.test(d.plant_open) && hhmmToMinutes(d.plant_close) <= hhmmToMinutes(d.plant_open)) e.plant_close = 'Must be after the opening time'
  if (!d.working_days.length) e.working_days = 'Pick at least one working day'
  if (d.financial_year_start_month < 1 || d.financial_year_start_month > 12) e.financial_year_start_month = 'Pick a month'
  const lm = numErr(d.late_marks_per_half_day, 0, 31, { int: true })
  if (lm) e.late_marks_per_half_day = lm
  const ot = numErr(d.min_ot_minutes, 0, 240, { int: true })
  if (ot) e.min_ot_minutes = ot
  const g = numErr(d.geofence_radius_m, 25, 10000, { int: true })
  if (g) e.geofence_radius_m = g
  if (!RE.hhmm.test(d.auto_absent_after)) e.auto_absent_after = 'Use HH:MM'
  else if (RE.hhmm.test(d.plant_open) && hhmmToMinutes(d.auto_absent_after) <= hhmmToMinutes(d.plant_open)) e.auto_absent_after = 'Should be after the plant opens'
  return e
}

function PlantTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft: d, setDraft, dirty, reset, settings } = useDraft(plantOf, onDirty)
  const shifts = useTable('shifts')
  const errors = validatePlant(d)
  const set = <K extends keyof PlantDraft>(k: K, v: PlantDraft[K]) => setDraft((p) => ({ ...p, [k]: v }))
  const off = [0, 1, 2, 3, 4, 5, 6].filter((x) => !d.working_days.includes(x))
  const hours = RE.hhmm.test(d.plant_open) && RE.hhmm.test(d.plant_close) ? (hhmmToMinutes(d.plant_close) - hhmmToMinutes(d.plant_open)) / 60 : 0

  const save = () =>
    void guard(
      () =>
        saveSettings(
          {
            plant_open: d.plant_open, plant_close: d.plant_close, working_days: [...d.working_days].sort((a, b) => a - b), financial_year_start_month: d.financial_year_start_month,
            attendance: { ...settings.attendance, late_marks_per_half_day: d.late_marks_per_half_day!, min_ot_minutes: d.min_ot_minutes!, geofence_radius_m: d.geofence_radius_m!, auto_absent_after: d.auto_absent_after, allow_web_checkin: d.allow_web_checkin },
          },
          'attendance & plant',
        )
          ? undefined
          : toast.info('Nothing changed'),
      'Attendance & plant settings saved',
    )

  return (
    <div className="space-y-4">
      {section(
        'Plant timings',
        `${hours > 0 ? `${num(hours, 1)} h a day` : '—'} · ${d.working_days.length}-day week${off.length ? ` · ${off.map((x) => WEEKDAYS_LONG[x]).join(', ')} off` : ''}`,
        <Clock className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Plant opens" required error={errors.plant_open} hint={fmtHHMM(d.plant_open)} htmlFor="pl-open">
            <Input id="pl-open" type="time" value={d.plant_open} onChange={(e) => set('plant_open', e.target.value)} invalid={!!errors.plant_open} />
          </Field>
          <Field label="Plant closes" required error={errors.plant_close} hint={fmtHHMM(d.plant_close)} htmlFor="pl-close">
            <Input id="pl-close" type="time" value={d.plant_close} onChange={(e) => set('plant_close', e.target.value)} invalid={!!errors.plant_close} />
          </Field>
          <Field label="Financial year starts" required error={errors.financial_year_start_month} hint="April for most Indian companies" htmlFor="pl-fy">
            <Select id="pl-fy" value={String(d.financial_year_start_month)} onChange={(e) => set('financial_year_start_month', Number(e.target.value))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          </Field>
          <Field label="Time zone" hint="Punch times use the plant’s clock">
            <Input value={`${settings.timezone} (IST)`} disabled />
          </Field>
          <Field label="Working days" required error={errors.working_days} className="sm:col-span-2 lg:col-span-4">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w, i) => {
                const on = d.working_days.includes(i)
                return (
                  <label key={w} className={cn('cursor-pointer rounded-md border px-3.5 py-2 transition', on ? 'border-brand-200 bg-brand-50 text-ink' : 'border-line bg-white text-ink-soft')}>
                    <Checkbox checked={on} onChange={(v) => set('working_days', v ? [...d.working_days, i].sort((a, b) => a - b) : d.working_days.filter((x) => x !== i))} label={<span className="font-semibold">{w}</span>} />
                  </label>
                )
              })}
            </div>
          </Field>
        </div>,
      )}

      {section(
        'Attendance policy',
        'Late marks, overtime and check-in rules',
        <UserRoundCog className="h-4 w-4" />,
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumField id="pl-late" label="Late marks per half-day LOP" value={d.late_marks_per_half_day} onChange={(v) => set('late_marks_per_half_day', v)} error={errors.late_marks_per_half_day} step="1" suffix="marks" hint={d.late_marks_per_half_day ? `Every ${d.late_marks_per_half_day} late arrivals = ½ day loss of pay` : '0 = no late-mark penalty'} />
            <NumField id="pl-ot" label="Minimum OT" value={d.min_ot_minutes} onChange={(v) => set('min_ot_minutes', v)} error={errors.min_ot_minutes} step="5" suffix="min" hint="OT counts in 15-min blocks beyond this past shift end" />
            <NumField id="pl-geo" label="Geofence radius" value={d.geofence_radius_m} onChange={(v) => set('geofence_radius_m', v)} error={errors.geofence_radius_m} step="25" suffix="metres" hint="Check-ins farther from the plant are flagged" />
            <Field label="Mark absent after" required error={errors.auto_absent_after} hint="Live board shows ‘absent’ with no punch by then" htmlFor="pl-abs">
              <Input id="pl-abs" type="time" value={d.auto_absent_after} onChange={(e) => set('auto_absent_after', e.target.value)} invalid={!!errors.auto_absent_after} />
            </Field>
          </div>
          <div className="mt-4 rounded-lg border border-line bg-white p-3.5">
            <Switch checked={d.allow_web_checkin} onChange={(v) => set('allow_web_checkin', v)} label="Allow web / mobile check-in" description="Off = punches only from the biometric terminal (or HR’s manual marks)." />
          </div>
        </>,
      )}

      {section(
        'Shifts',
        'Timings, grace and weekly offs are managed in Attendance',
        <Clock className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shifts.map((sh) => (
            <div key={sh.id} className={cn('min-w-0 rounded-lg border border-line bg-white p-3.5', !sh.active && 'opacity-60')}>
              <p className="flex items-center gap-2 font-semibold text-ink">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sh.color }} />
                <span className="truncate">{sh.name}</span>
                {!sh.active && <Badge tone="slate">Inactive</Badge>}
              </p>
              <p className="mt-1 text-[12.5px] text-ink-soft">
                {fmtHHMM(sh.start_time)} – {fmtHHMM(sh.end_time)} · {sh.grace_minutes} min grace · {sh.break_minutes} min break
              </p>
              <p className="text-[12px] text-ink-faint">Weekly off: {sh.weekly_offs.map((x) => WEEKDAYS[x]).join(', ') || 'none'} · half day below {minutesToHHMM(sh.half_day_minutes)} h</p>
            </div>
          ))}
        </div>,
      )}

      <SaveBar dirty={dirty} errors={Object.keys(errors).length} onSave={save} onReset={reset} what="attendance settings" />
    </div>
  )
}

/* ─────────────────────────────── Petty cash ─────────────────────────────── */

interface PettyDraft {
  imprest: Num
  low: Num
  limit: Num
  categories: string[]
}
const pettyOf = (s: CompanySettings): PettyDraft => ({ imprest: s.petty_cash_imprest, low: s.petty_cash_low_alert, limit: s.petty_cash_approval_limit, categories: [...s.petty_cash_categories] })

function validatePetty(d: PettyDraft): Errs {
  const e: Errs = {}
  const im = numErr(d.imprest, 1, 1_000_000)
  if (im) e.imprest = im
  const lo = numErr(d.low, 0, 1_000_000)
  if (lo) e.low = lo
  else if (d.imprest != null && d.low! >= d.imprest) e.low = 'Must be below the imprest amount'
  const li = numErr(d.limit, 0, 1_000_000)
  if (li) e.limit = li
  if (!d.categories.length) e.categories = 'Keep at least one category'
  const seen = new Set<string>()
  d.categories.forEach((c, i) => {
    const v = c.trim()
    if (!v) e[`cat.${i}`] = 'Name required'
    else if (v.length > 40) e[`cat.${i}`] = 'Max 40 characters'
    else if (seen.has(v.toLowerCase())) e[`cat.${i}`] = 'Duplicate'
    seen.add(v.toLowerCase())
  })
  if (d.categories.length > 30) e.categories = 'Up to 30 categories'
  return e
}

function PettyTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft: d, setDraft, dirty, reset } = useDraft(pettyOf, onDirty)
  const vouchers = useTable('petty_cash_vouchers')
  const [newCat, setNewCat] = useState('')
  const errors = validatePetty(d)
  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of vouchers) m.set(v.category.toLowerCase(), (m.get(v.category.toLowerCase()) ?? 0) + 1)
    return m
  }, [vouchers])

  const setCat = (i: number, v: string) => setDraft((p) => ({ ...p, categories: p.categories.map((c, j) => (j === i ? v : c)) }))
  const move = (i: number, dir: -1 | 1) =>
    setDraft((p) => {
      const c = [...p.categories]
      const j = i + dir
      if (j < 0 || j >= c.length) return p
      ;[c[i], c[j]] = [c[j]!, c[i]!]
      return { ...p, categories: c }
    })
  const addCat = () => {
    const v = newCat.trim().replace(/\s+/g, ' ')
    if (!v) return
    if (d.categories.some((c) => c.trim().toLowerCase() === v.toLowerCase())) return toast.warning('Category already exists')
    setDraft((p) => ({ ...p, categories: [...p.categories, v.slice(0, 40)] }))
    setNewCat('')
  }

  const save = () =>
    void guard(
      () =>
        saveSettings({ petty_cash_imprest: d.imprest!, petty_cash_low_alert: d.low!, petty_cash_approval_limit: d.limit!, petty_cash_categories: d.categories.map((c) => c.trim().replace(/\s+/g, ' ')) }, 'petty cash')
          ? undefined
          : toast.info('Nothing changed'),
      'Petty-cash settings saved',
    )

  return (
    <div className="space-y-4">
      {section(
        'Cash box',
        'Imprest system — the box is topped up to a fixed float',
        <Wallet className="h-4 w-4" />,
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumField id="pc-imp" label="Imprest (float)" prefix="₹" value={d.imprest} onChange={(v) => setDraft((p) => ({ ...p, imprest: v }))} error={errors.imprest} step="500" hint="Top-ups bring the box back to this" />
          <NumField id="pc-low" label="Low-balance alert" prefix="₹" value={d.low} onChange={(v) => setDraft((p) => ({ ...p, low: v }))} error={errors.low} step="500" hint={d.imprest && d.low != null && !errors.low ? `Alert at ${Math.round((d.low / d.imprest) * 100)}% of the float` : undefined} />
          <NumField
            id="pc-lim"
            label="Approval limit per voucher"
            prefix="₹"
            value={d.limit}
            onChange={(v) => setDraft((p) => ({ ...p, limit: v }))}
            error={errors.limit}
            step="500"
            hint={d.limit != null && d.imprest != null && d.limit > d.imprest ? 'Higher than the float — large claims may not be payable from the box' : 'Vouchers above this need Super Admin approval'}
          />
        </div>,
      )}

      {section(
        'Expense categories',
        'Shown when employees file a claim — order matters',
        <Database className="h-4 w-4" />,
        <>
          <ul className="space-y-2">
              {d.categories.map((c, i) => {
                const n = used.get(c.trim().toLowerCase()) ?? 0
                return (
                  <li key={i} className="flex min-w-0 items-start gap-2">
                    <span className="num mt-2.5 w-6 shrink-0 text-right text-[12px] font-medium text-ink-faint">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Input value={c} onChange={(e) => setCat(i, e.target.value)} invalid={!!errors[`cat.${i}`]} className="h-10 py-0 text-sm" aria-label={`Category ${i + 1}`} maxLength={40} />
                      {errors[`cat.${i}`] ? <p className="mt-0.5 text-[11.5px] font-medium text-rose-600">{errors[`cat.${i}`]}</p> : n > 0 && <p className="mt-0.5 text-[11.5px] text-ink-faint">{n} voucher{n === 1 ? '' : 's'} use this name — renaming keeps old vouchers as they are</p>}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" disabled={i === d.categories.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="hover:!bg-rose-50 hover:!text-rose-600" onClick={() => setDraft((p) => ({ ...p, categories: p.categories.filter((_, j) => j !== i) }))} aria-label={`Remove ${c}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                )
              })}
          </ul>
          {errors.categories && <p className="mt-2 text-[12.5px] font-medium text-rose-600">{errors.categories}</p>}
          <div className="mt-3 flex min-w-0 gap-2 pl-8">
            <Input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCat()
                }
              }}
              placeholder="New category, e.g. Safety & PPE"
              className="h-10 py-0 text-sm"
              maxLength={40}
            />
            <Button size="sm" variant="secondary" className="h-10" icon={<Plus className="h-4 w-4" />} onClick={addCat} disabled={!newCat.trim()}>
              Add
            </Button>
          </div>
        </>,
      )}

      <SaveBar dirty={dirty} errors={Object.keys(errors).length} onSave={save} onReset={reset} what="petty-cash settings" />
    </div>
  )
}

/* ─────────────────────────────── Data ─────────────────────────────── */

const dataOf = (s: CompanySettings) => ({ demo_autopilot: s.demo_autopilot })

function DataTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft: d, setDraft, dirty, reset, settings } = useDraft(dataOf, onDirty)
  const users = useTable('app_users')
  const employees = useTable('employees')
  const attendance = useTable('attendance')
  const payslips = useTable('payslips')
  const logs = useTable('audit_logs')
  const leaves = useTable('leave_requests')
  const [busy, setBusy] = useState(false)
  const live = DATA_MODE === 'supabase'

  const save = () => void guard(() => (saveSettings({ demo_autopilot: d.demo_autopilot }, 'data') ? undefined : toast.info('Nothing changed')), d.demo_autopilot ? 'Demo autopilot is on' : 'Demo autopilot is off')

  const resetDemo = async () => {
    const ok = await confirm({
      title: 'Reset all demo data?',
      message: 'Everything stored in this browser — employees, attendance, payroll, logins and your changes — is erased and the demo is generated again. You may need to sign in again with a demo login.',
      danger: true,
      confirmLabel: 'Erase and reset',
    })
    if (!ok) return
    setBusy(true)
    try {
      audit('reset', 'demo_data', null, 'Reset the offline demo data')
      await resetStaticDemo()
      window.location.reload()
    } catch (e) {
      setBusy(false)
      toast.error('Could not reset the demo', e instanceof Error ? e.message : String(e))
    }
  }

  const realLogins = users.filter((u) => u.active).length
  const checklist: { done: boolean; title: string; body: ReactNode }[] = [
    { done: !settings.demo_autopilot, title: 'Turn off the demo autopilot', body: 'Simulated biometric punches must stop before real attendance starts (switch above, then Save).' },
    {
      done: false,
      title: 'Purge the demo data',
      body: (
        <>
          Run <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-ink">supabase/purge_demo_data.sql</code> in the Supabase SQL editor. It keeps company settings, roles, departments and your admin login.
        </>
      ),
    },
    { done: realLogins > 1, title: 'Create real logins', body: <>Add HR, accounts and supervisors in <b>Users &amp; roles</b> — {realLogins} active login{realLogins === 1 ? '' : 's'} today.</> },
    {
      done: !!(settings.gstin && settings.pan && settings.tan && settings.pf_establishment_code && settings.esi_employer_code),
      title: 'Set statutory registrations',
      body: `Company GSTIN, PAN, TAN, PF and ESI codes (Company tab). Missing: ${[['GSTIN', settings.gstin], ['PAN', settings.pan], ['TAN', settings.tan], ['PF code', settings.pf_establishment_code], ['ESI code', settings.esi_employer_code]].filter(([, v]) => !v).map(([k]) => k).join(', ') || 'none'}.`,
    },
  ]

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-md border', live ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
            {live ? <Cloud className="h-5 w-5" /> : <HardDrive className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="kicker">Data mode</p>
            <p className="text-[17px] font-semibold text-ink">{live ? 'Live · Supabase' : 'Offline demo'}</p>
            <p className="text-[13px] text-ink-soft">
              {live ? 'Every change is saved to the company database and syncs to other devices in real time. Row Level Security enforces each role on the server.' : 'Data lives only in this browser (IndexedDB). Nothing is shared with other devices; suitable for training and demos.'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-line bg-brand-50 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Employees', employees.length],
            ['Logins', users.length],
            ['Attendance rows', attendance.length],
            ['Leave requests', leaves.length],
            ['Payslips', payslips.length],
            ['Audit entries', logs.length],
          ].map(([k, v]) => (
            <div key={k} className="bg-white px-4 py-3">
              <p className="text-[11.5px] font-semibold text-ink-soft">{k}</p>
              <p className="num text-lg font-semibold text-ink">{Number(v).toLocaleString('en-IN')}</p>
            </div>
          ))}
        </div>
      </Card>

      {section(
        'Demo autopilot',
        settings.demo_autopilot_through ? `Simulated up to ${fmtDate(settings.demo_autopilot_through)}` : 'Not run yet',
        <Bot className="h-4 w-4" />,
        <>
          <Switch
            checked={d.demo_autopilot}
            onChange={(v) => setDraft({ demo_autopilot: v })}
            label="Simulate biometric punches"
            description="When someone signs in, the autopilot fills in plausible check-in / check-out punches for employees who have no ERP login, up to today — so dashboards, attendance and payroll look alive in a demo."
          />
          <p className={cn('mt-3 flex items-start gap-2 rounded-md px-3.5 py-2.5 text-[12.5px]', d.demo_autopilot ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800')}>
            {d.demo_autopilot ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {d.demo_autopilot ? 'Turn this off before go-live — real attendance must come only from real punches.' : 'Off — only real punches, regularisations and HR’s manual marks are recorded.'}
          </p>
          <SaveBar dirty={dirty} errors={0} onSave={save} onReset={reset} what="data settings" />
        </>,
      )}

      {live ? (
        section(
          'Go-live checklist',
          'Before switching the plant over from the demo',
          <CheckCircle2 className="h-4 w-4" />,
          <ol className="space-y-3">
            {checklist.map((c, i) => (
              <li key={c.title} className="flex gap-3 rounded-lg border border-line bg-white p-3.5">
                <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium', c.done ? 'bg-emerald-500 text-white' : 'bg-brand-50 text-brand-600')}>{c.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{c.title}</p>
                  <p className="mt-0.5 text-[13px] text-ink-soft">{c.body}</p>
                </div>
              </li>
            ))}
          </ol>,
        )
      ) : (
        <Card className="border-rose-200/70">
          <CardHeader title="Reset demo data" subtitle="Start the offline demo afresh" icon={<RotateCcw className="h-4 w-4" />} />
          <CardBody>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-[13px] text-ink-soft">Erases everything stored in this browser and regenerates the Melstar demo (36 employees, a year of attendance, payroll, purchase, quality). Other browsers are not affected.</p>
              <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} loading={busy} onClick={() => void resetDemo()} className="shrink-0">
                Reset demo data
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

