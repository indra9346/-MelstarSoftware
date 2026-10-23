import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Briefcase, Building2, CalendarPlus, Download, FileText, LayoutGrid, List, Network, Pencil, Plus, Search, Trash2, UserMinus, UserPlus, Users } from 'lucide-react'
import {
  Badge, Button, Card, CardBody, DataTable, EmptyState, Field, Input, Menu, Modal, PageHeader, Segmented, Select, StatCard, StatusBadge, Tabs, Textarea,
  confirm, guard, toast, type Column,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { EmployeeForm } from '@/components/hr/EmployeeForm'
import { StoredAvatar } from '@/components/hr/StoredAvatar'
import { ColorChip, ColorPicker } from '@/components/hr/inputs'
import { useTable } from '@/data/store'
import type { Department, Designation, Employee } from '@/data/types'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, fmtDateShort, fyLabel, fyOf, fyRange, tenure, todayISO } from '@/lib/dates'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'
import { fullName, titleCase } from '@/lib/format'
import { audit } from '@/services/audit'
import {
  EMPLOYMENT_TYPES, deleteDepartment, deleteDesignation, departmentToForm, departmentUsage, designationToForm, saveDepartment, saveDesignation,
  validateDepartment, validateDesignation, type DepartmentFormValues, type DesignationFormValues,
} from '@/services/hr'
import { useSession } from '@/services/session'

type Tab = 'directory' | 'departments' | 'designations'
type StatusFilter = 'current' | 'all' | 'active' | 'on_notice' | 'exited' | 'joined_fy' | 'exited_fy'

const VIEW_KEY = 'melstar-employees-view'
const readView = (): 'list' | 'grid' => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

/** End of service for tenure: exit date once it has passed, else today. */
const serviceEnd = (e: Employee, today: string) => (e.date_of_exit && e.date_of_exit < today ? e.date_of_exit : today)
const serviceMonths = (e: Employee, today: string) => {
  const [y1, m1] = e.date_of_joining.split('-').map(Number)
  const [y2, m2] = serviceEnd(e, today).split('-').map(Number)
  return Math.max(0, (y2! - y1!) * 12 + (m2! - m1!))
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'current', label: 'On rolls' },
  { value: 'active', label: 'Active' },
  { value: 'on_notice', label: 'On notice' },
  { value: 'exited', label: 'Exited' },
  { value: 'joined_fy', label: 'Joined this FY' },
  { value: 'exited_fy', label: 'Exited this FY' },
  { value: 'all', label: 'All statuses' },
]

export default function EmployeesPage() {
  const s = useSession()
  const canManage = s.can('employees.manage')
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'departments' || raw === 'designations' ? raw : 'directory'
  const setTab = (t: Tab) => setParams(t === 'directory' ? {} : { tab: t }, { replace: true })
  const [adding, setAdding] = useState(false)
  const employees = useTable('employees')
  const departments = useTable('departments')
  const designations = useTable('designations')
  const onRolls = employees.filter((e) => e.status !== 'exited').length

  return (
    <div>
      <PageHeader
        kicker="People"
        title="Employees"
        subtitle={`${onRolls} on rolls across ${departments.length} departments${canManage ? '' : ' · view only'}`}
        actions={
          canManage && (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              Add employee
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { value: 'directory', label: 'Directory', count: onRolls },
          { value: 'departments', label: 'Departments', count: departments.length },
          { value: 'designations', label: 'Designations', count: designations.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div key={tab}>
        {tab === 'directory' && <Directory onAdd={canManage ? () => setAdding(true) : undefined} />}
        {tab === 'departments' && <Departments canManage={canManage} />}
        {tab === 'designations' && <Designations canManage={canManage} />}
      </div>
      <EmployeeForm open={adding} onClose={() => setAdding(false)} onSaved={(e, created) => created && nav(`/admin/employees/${e.id}`)} />
    </div>
  )
}

/* ─────────────────────────────── Directory ─────────────────────────────── */

function Directory({ onAdd }: { onAdd?: () => void }) {
  const L = useLookups()
  const nav = useNavigate()
  const employees = L.employees
  const today = todayISO()
  const fy = fyOf(today)
  const { from: fyFrom, to: fyTo } = fyRange(fy)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [status, setStatus] = useState<StatusFilter>('current')
  const [type, setType] = useState('')
  const [view, setView] = useState<'list' | 'grid'>(readView)
  const [limit, setLimit] = useState(48)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* private mode — keep it for this visit only */
    }
  }, [view])
  useEffect(() => setLimit(48), [q, dept, status, type])

  const stats = useMemo(() => {
    const current = employees.filter((e) => e.status !== 'exited')
    const notice = employees.filter((e) => e.status === 'on_notice').sort((a, b) => (a.date_of_exit ?? '').localeCompare(b.date_of_exit ?? ''))
    const joined = employees.filter((e) => e.date_of_joining >= fyFrom && e.date_of_joining <= fyTo && e.date_of_joining <= today)
    const exited = employees.filter((e) => e.status === 'exited' && !!e.date_of_exit && e.date_of_exit >= fyFrom && e.date_of_exit <= fyTo)
    return { current, notice, joined, exited, permanent: current.filter((e) => e.employment_type === 'permanent').length }
  }, [employees, fyFrom, fyTo, today])

  const filtered = !!(q || dept || type || status !== 'current')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return employees
      .filter((e) => {
        if (dept && e.department_id !== dept) return false
        if (type && e.employment_type !== type) return false
        switch (status) {
          case 'current':
            if (e.status === 'exited') return false
            break
          case 'active':
          case 'on_notice':
          case 'exited':
            if (e.status !== status) return false
            break
          case 'joined_fy':
            if (!(e.date_of_joining >= fyFrom && e.date_of_joining <= fyTo && e.date_of_joining <= today)) return false
            break
          case 'exited_fy':
            if (!(e.status === 'exited' && e.date_of_exit && e.date_of_exit >= fyFrom && e.date_of_exit <= fyTo)) return false
            break
        }
        if (!needle) return true
        return [fullName(e), e.emp_code, e.email, e.phone, L.deptName(e.department_id), L.desigTitle(e.designation_id), e.work_centre_id ? L.wcName(e.work_centre_id) : '', e.skills.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) => a.emp_code.localeCompare(b.emp_code, 'en-IN', { numeric: true }))
  }, [employees, q, dept, status, type, fyFrom, fyTo, today, L])

  const columns: Column<Employee>[] = [
    { key: 'code', header: 'Code', value: (e) => e.emp_code, cell: (e) => <span className="num font-mono text-[13px] font-medium text-ink-soft whitespace-nowrap">{e.emp_code}</span> },
    { key: 'name', header: 'Employee', value: (e) => fullName(e), cell: (e) => <EmployeeCell id={e.id} sub="none" /> },
    {
      key: 'dept',
      header: 'Department',
      value: (e) => L.deptName(e.department_id),
      cell: (e) => {
        const d = L.dept.get(e.department_id)
        return d ? <ColorChip color={d.color}>{d.name}</ColorChip> : '—'
      },
    },
    { key: 'desig', header: 'Designation', value: (e) => L.desigTitle(e.designation_id), cell: (e) => <span className="block max-w-[14rem] truncate">{L.desigTitle(e.designation_id)}</span> },
    { key: 'wc', header: 'Work centre', value: (e) => (e.work_centre_id ? L.wcName(e.work_centre_id) : ''), cell: (e) => (e.work_centre_id ? L.wcName(e.work_centre_id) : <span className="text-ink-faint">—</span>) },
    { key: 'type', header: 'Type', value: (e) => titleCase(e.employment_type) },
    { key: 'doj', header: 'Joined', value: (e) => e.date_of_joining, cell: (e) => <span className="num whitespace-nowrap">{fmtDate(e.date_of_joining)}</span> },
    { key: 'tenure', header: 'Tenure', value: (e) => serviceMonths(e, today), cell: (e) => <span className="whitespace-nowrap text-ink-soft">{tenure(e.date_of_joining, serviceEnd(e, today))}</span> },
    { key: 'status', header: 'Status', value: (e) => e.status, cell: (e) => <StatusBadge status={e.status} /> },
  ]

  const exportCols: ExportColumn<Employee>[] = [
    { header: 'Code', value: (e) => e.emp_code },
    { header: 'Name', value: (e) => fullName(e) },
    { header: 'Department', value: (e) => L.deptName(e.department_id) },
    { header: 'Designation', value: (e) => L.desigTitle(e.designation_id) },
    { header: 'Work centre', value: (e) => (e.work_centre_id ? L.wcName(e.work_centre_id) : '') },
    { header: 'Type', value: (e) => titleCase(e.employment_type) },
    { header: 'Joined', value: (e) => fmtDate(e.date_of_joining) },
    { header: 'Tenure', value: (e) => tenure(e.date_of_joining, serviceEnd(e, today)) },
    { header: 'Status', value: (e) => titleCase(e.status) },
    { header: 'Phone', value: (e) => e.phone },
    { header: 'E-mail', value: (e) => e.email },
  ]
  const filterLabel = [dept && L.deptName(dept), type && titleCase(type), STATUS_OPTIONS.find((o) => o.value === status)?.label].filter(Boolean).join(' · ')
  const doExport = (kind: 'csv' | 'pdf') => {
    if (!rows.length) return toast.info('Nothing to export', 'No employees match the current filters.')
    if (kind === 'csv') exportCsv(`employees-${today}`, rows, exportCols)
    else
      void exportPdf({
        filename: `employees-${today}`,
        title: 'Employee directory',
        subtitle: filterLabel,
        rows,
        columns: exportCols,
        landscape: true,
        summary: [
          ['Employees', String(rows.length)],
          ['On notice', String(rows.filter((e) => e.status === 'on_notice').length)],
          ['Permanent', String(rows.filter((e) => e.employment_type === 'permanent').length)],
          ['As on', fmtDate(today)],
        ],
      })
    audit('export', 'employees', null, `Exported ${rows.length} employees (${kind.toUpperCase()}${filterLabel ? ` · ${filterLabel}` : ''})`)
  }
  const clear = () => {
    setQ('')
    setDept('')
    setType('')
    setStatus('current')
  }
  const nextExit = stats.notice[0]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Active headcount" value={stats.current.length} icon={<Users className="h-4 w-4" />} accent="indigo" hint={`${stats.permanent} permanent · ${stats.current.length - stats.permanent} others`} onClick={() => setStatus('current')} />
        <StatCard label="On notice" value={stats.notice.length} icon={<UserMinus className="h-4 w-4" />} accent="amber" hint={nextExit ? `Next exit ${fmtDateShort(nextExit.date_of_exit)} · ${nextExit.first_name}` : 'Nobody serving notice'} onClick={() => setStatus('on_notice')} />
        <StatCard label="Joined this FY" value={stats.joined.length} icon={<CalendarPlus className="h-4 w-4" />} accent="green" hint={`FY ${fyLabel(fy)}`} onClick={() => setStatus('joined_fy')} />
        <StatCard label="Exited this FY" value={stats.exited.length} icon={<Briefcase className="h-4 w-4" />} accent="pink" hint={`FY ${fyLabel(fy)}`} onClick={() => setStatus('exited_fy')} />
      </div>

      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]">
          <div className="relative min-w-0 sm:col-span-3 xl:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search name, code, skill, phone…" className="field-input h-10 py-0 pl-9 text-sm" aria-label="Search employees" />
          </div>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} options={[...L.dept.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 py-0 text-sm" aria-label="Department" />
          <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} options={STATUS_OPTIONS} className="h-10 py-0 text-sm" aria-label="Status" />
          <Select value={type} onChange={(e) => setType(e.target.value)} options={EMPLOYMENT_TYPES} placeholder="All types" className="h-10 py-0 text-sm" aria-label="Employment type" />
          <div className="flex min-w-0 items-center gap-1.5 sm:col-span-3 xl:col-span-1">
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: <List className="h-4 w-4" aria-label="List view" /> },
                { value: 'grid', label: <LayoutGrid className="h-4 w-4" aria-label="Grid view" /> },
              ]}
            />
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => doExport('csv')} title="Export CSV">
                CSV
              </Button>
              <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => doExport('pdf')} title="Export PDF">
                PDF
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-2.5 px-0.5 text-[12.5px] text-ink-soft">
          Showing <b className="text-ink">{rows.length}</b> of {employees.length}
          {filterLabel ? ` · ${filterLabel}` : ''}
          {filtered && (
            <button className="ml-2 font-semibold text-brand-600 hover:underline" onClick={clear}>
              Clear filters
            </button>
          )}
        </p>
      </Card>

      {view === 'list' ? (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(e) => e.id}
          onRowClick={(e) => nav(`/admin/employees/${e.id}`)}
          empty={<NoMatches onAdd={onAdd} filtered={filtered} />}
          mobileCard={(e) => <MobileRow e={e} />}
        />
      ) : rows.length ? (
        <>
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.slice(0, limit).map((e, i) => (
              <EmployeeCard key={e.id} e={e} i={i} onOpen={() => nav(`/admin/employees/${e.id}`)} />
            ))}
          </div>
          {rows.length > limit && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((n) => n + 48)}>
                Show {Math.min(48, rows.length - limit)} more
              </Button>
            </div>
          )}
        </>
      ) : (
        <NoMatches onAdd={onAdd} filtered={filtered} />
      )}
    </div>
  )
}

function NoMatches({ onAdd, filtered }: { onAdd?: () => void; filtered: boolean }) {
  return (
    <EmptyState
      icon={<Users className="h-6 w-6" />}
      title={filtered ? 'No employees match' : 'No employees yet'}
      description={filtered ? 'Try another department, status or search term.' : 'Add the first employee to start the directory.'}
      action={
        !filtered && onAdd ? (
          <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={onAdd}>
            Add employee
          </Button>
        ) : undefined
      }
    />
  )
}

function MobileRow({ e }: { e: Employee }) {
  const L = useLookups()
  const d = L.dept.get(e.department_id)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <StoredAvatar name={fullName(e)} src={e.photo} size={44} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-ink">{fullName(e)}</span>
          <span className="num shrink-0 font-mono text-[11.5px] text-ink-faint">{e.emp_code}</span>
        </p>
        <p className="truncate text-[12.5px] text-ink-soft">{L.desigTitle(e.designation_id)}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {d && <ColorChip color={d.color}>{d.name}</ColorChip>}
          {e.status !== 'active' && <StatusBadge status={e.status} />}
        </div>
      </div>
    </div>
  )
}

function EmployeeCard({ e, onOpen }: { e: Employee; i: number; onOpen: () => void }) {
  const L = useLookups()
  const d = L.dept.get(e.department_id)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card relative flex min-w-0 flex-col items-center overflow-hidden px-4 pb-4 pt-5 text-center transition-colors hover:border-line-strong"
    >
      <span className="absolute right-3 top-3">{e.status !== 'active' ? <StatusBadge status={e.status} /> : <span className="num font-mono text-[11px] font-semibold text-ink-faint">{e.emp_code}</span>}</span>
      <StoredAvatar name={fullName(e)} src={e.photo} size={56} className="relative" />
      <p className="relative mt-3 w-full truncate text-[14.5px] font-semibold text-ink">{fullName(e)}</p>
      <p className="relative w-full truncate text-[12.5px] text-ink-soft">{L.desigTitle(e.designation_id)}</p>
      <div className="relative mt-2.5 flex max-w-full flex-wrap justify-center gap-1.5">{d && <ColorChip color={d.color}>{d.name}</ColorChip>}</div>
      <div className="relative mt-3 flex w-full min-w-0 items-center justify-between gap-2 border-t border-line pt-2.5 text-[12px] text-ink-soft">
        <span className="truncate">{e.work_centre_id ? L.wcName(e.work_centre_id) : titleCase(e.employment_type)}</span>
        <span className="shrink-0">{tenure(e.date_of_joining)}</span>
      </div>
    </button>
  )
}

/* ─────────────────────────────── Departments ─────────────────────────────── */

function Departments({ canManage }: { canManage: boolean }) {
  const L = useLookups()
  const departments = useTable('departments')
  const designations = useTable('designations')
  const employees = useTable('employees')
  const [editing, setEditing] = useState<Department | 'new' | null>(null)

  const rows = useMemo(() => {
    const head = new Map<string, number>()
    const des = new Map<string, number>()
    const all = new Map<string, number>()
    for (const e of employees) {
      all.set(e.department_id, (all.get(e.department_id) ?? 0) + 1)
      if (e.status !== 'exited') head.set(e.department_id, (head.get(e.department_id) ?? 0) + 1)
    }
    for (const d of designations) des.set(d.department_id, (des.get(d.department_id) ?? 0) + 1)
    return [...departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ d, headcount: head.get(d.id) ?? 0, designations: des.get(d.id) ?? 0, records: all.get(d.id) ?? 0 }))
  }, [departments, designations, employees])
  type Row = (typeof rows)[number]
  const max = Math.max(1, ...rows.map((r) => r.headcount))

  const remove = async (d: Department) => {
    if (await confirm({ title: `Delete ${d.name}?`, message: 'The department has no employees or designations. This cannot be undone.', danger: true, confirmLabel: 'Delete' }))
      await guard(() => deleteDepartment(d), 'Department deleted')
  }

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Department',
      value: (r) => r.d.name,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[10.5px] font-semibold text-white shadow-sm" style={{ background: r.d.color }}>
            {r.d.code.slice(0, 3)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{r.d.name}</span>
            <span className="block truncate font-mono text-[11.5px] text-ink-faint">{r.d.code}</span>
          </span>
        </span>
      ),
    },
    { key: 'head', header: 'Head', value: (r) => (r.d.head_employee_id ? L.empName(r.d.head_employee_id) : ''), cell: (r) => (r.d.head_employee_id ? <EmployeeCell id={r.d.head_employee_id} size={28} /> : <span className="text-ink-faint">Not set</span>) },
    {
      key: 'headcount',
      header: 'Headcount',
      align: 'right',
      value: (r) => r.headcount,
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2.5">
          <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-200/80 sm:block">
            <span className="block h-full rounded-full bg-brand-600" style={{ width: `${(r.headcount / max) * 100}%` }} />
          </span>
          <span className="num font-semibold">{r.headcount}</span>
        </span>
      ),
    },
    { key: 'desig', header: 'Designations', align: 'right', value: (r) => r.designations },
    { key: 'desc', header: 'Description', value: (r) => r.d.description, cell: (r) => <span className="line-clamp-2 max-w-[22rem] text-[13px] text-ink-soft">{r.d.description || '—'}</span>, hideOnMobile: true },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            sortable: false,
            align: 'right' as const,
            cell: (r: Row) => (
              <Menu
                items={[
                  { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(r.d) },
                  { label: r.records || r.designations ? 'Delete — in use' : 'Delete', icon: <Trash2 />, danger: true, disabled: !!(r.records || r.designations), onClick: () => void remove(r.d) },
                ]}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <Card>
      <CardBody>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.d.id}
          searchText={(r) => `${r.d.name} ${r.d.code} ${r.d.description}`}
          searchPlaceholder="Search departments…"
          onRowClick={canManage ? (r) => setEditing(r.d) : undefined}
          toolbar={
            canManage && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                Add department
              </Button>
            )
          }
          empty={<EmptyState icon={<Building2 className="h-6 w-6" />} title="No departments" description="Create departments before adding employees." />}
        />
      </CardBody>
      <DepartmentModal value={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function DepartmentModal({ value, onClose }: { value: Department | 'new' | null; onClose: () => void }) {
  const L = useLookups()
  const existing = value && value !== 'new' ? value : undefined
  const [f, setF] = useState<DepartmentFormValues>(departmentToForm(existing))
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!value) return
    setF(departmentToForm(value === 'new' ? undefined : value))
    setTouched(new Set())
  }, [value])

  const errors = validateDepartment(f, existing)
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof DepartmentFormValues) => (touched.has(k) ? errors[k] : undefined)
  const touch = (k: keyof DepartmentFormValues) => setTouched((t) => new Set(t).add(k))
  const usage = existing ? departmentUsage(existing.id) : null

  const save = async () => {
    if (invalid) return setTouched(new Set(Object.keys(f)))
    if (await guard(() => saveDepartment(f, existing), existing ? 'Department updated' : 'Department created')) onClose()
  }

  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'New department'}
      subtitle={usage ? `${usage.employees} employee records · ${usage.designations} designations` : 'Code and name must be unique'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={invalid}>
            {existing ? 'Save' : 'Create department'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field label="Code" required error={err('code')} htmlFor="dept-code">
          <Input id="dept-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} onBlur={() => touch('code')} invalid={!!err('code')} className="font-mono uppercase" placeholder="MCH" />
        </Field>
        <Field label="Name" required error={err('name')} htmlFor="dept-name">
          <Input id="dept-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => touch('name')} invalid={!!err('name')} placeholder="Production – Machining" />
        </Field>
        <Field label="Description" error={err('description')} className="sm:col-span-2" htmlFor="dept-desc">
          <Textarea id="dept-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} onBlur={() => touch('description')} invalid={!!err('description')} placeholder="What this department does" />
        </Field>
        <Field label="Department head" error={err('head_employee_id')} className="sm:col-span-2" htmlFor="dept-head">
          <Select
            id="dept-head"
            value={f.head_employee_id}
            onChange={(e) => {
              setF({ ...f, head_employee_id: e.target.value })
              touch('head_employee_id')
            }}
            options={L.employeeOptions((e) => e.status !== 'exited' || e.id === existing?.head_employee_id)}
            placeholder="Not set"
          />
        </Field>
        <Field label="Colour" error={err('color')} className="sm:col-span-2" hint="Used for chips and charts">
          <div className="flex flex-wrap items-center gap-3">
            <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
            {f.name.trim() && <ColorChip color={f.color}>{f.name.trim()}</ColorChip>}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/* ─────────────────────────────── Designations ─────────────────────────────── */

function Designations({ canManage }: { canManage: boolean }) {
  const L = useLookups()
  const designations = useTable('designations')
  const employees = useTable('employees')
  const [dept, setDept] = useState('')
  const [editing, setEditing] = useState<Designation | 'new' | null>(null)

  const rows = useMemo(() => {
    const head = new Map<string, number>()
    const all = new Map<string, number>()
    for (const e of employees) {
      all.set(e.designation_id, (all.get(e.designation_id) ?? 0) + 1)
      if (e.status !== 'exited') head.set(e.designation_id, (head.get(e.designation_id) ?? 0) + 1)
    }
    return designations
      .filter((d) => !dept || d.department_id === dept)
      .map((d) => ({ d, headcount: head.get(d.id) ?? 0, records: all.get(d.id) ?? 0 }))
      .sort((a, b) => L.deptName(a.d.department_id).localeCompare(L.deptName(b.d.department_id)) || a.d.title.localeCompare(b.d.title))
  }, [designations, employees, dept, L])
  type Row = (typeof rows)[number]

  const remove = async (d: Designation) => {
    if (await confirm({ title: `Delete “${d.title}”?`, message: 'No employee holds this designation. This cannot be undone.', danger: true, confirmLabel: 'Delete' }))
      await guard(() => deleteDesignation(d), 'Designation deleted')
  }

  const columns: Column<Row>[] = [
    { key: 'title', header: 'Designation', value: (r) => r.d.title, cell: (r) => <span className="font-semibold text-ink">{r.d.title}</span> },
    {
      key: 'dept',
      header: 'Department',
      value: (r) => L.deptName(r.d.department_id),
      cell: (r) => {
        const d = L.dept.get(r.d.department_id)
        return d ? <ColorChip color={d.color}>{d.name}</ColorChip> : '—'
      },
    },
    { key: 'grade', header: 'Grade', value: (r) => r.d.grade, cell: (r) => (r.d.grade ? <Badge tone="slate">{r.d.grade}</Badge> : <span className="text-ink-faint">—</span>) },
    { key: 'headcount', header: 'Headcount', align: 'right', value: (r) => r.headcount },
    { key: 'desc', header: 'Description', value: (r) => r.d.description, cell: (r) => <span className="line-clamp-2 max-w-[22rem] text-[13px] text-ink-soft">{r.d.description || '—'}</span>, hideOnMobile: true },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            sortable: false,
            align: 'right' as const,
            cell: (r: Row) => (
              <Menu
                items={[
                  { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(r.d) },
                  { label: r.records ? 'Delete — in use' : 'Delete', icon: <Trash2 />, danger: true, disabled: r.records > 0, onClick: () => void remove(r.d) },
                ]}
              />
            ),
          },
        ]
      : []),
  ]

  return (
    <Card>
      <CardBody>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.d.id}
          searchText={(r) => `${r.d.title} ${r.d.grade} ${L.deptName(r.d.department_id)}`}
          searchPlaceholder="Search designations…"
          onRowClick={canManage ? (r) => setEditing(r.d) : undefined}
          toolbar={
            <>
              <Select value={dept} onChange={(e) => setDept(e.target.value)} options={[...L.dept.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[10rem] flex-1 py-0 text-sm sm:flex-none" aria-label="Department" />
              {canManage && (
                <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                  Add designation
                </Button>
              )}
            </>
          }
          empty={<EmptyState icon={<Network className="h-6 w-6" />} title="No designations" description={dept ? 'This department has no designations yet.' : 'Add designations under each department.'} />}
        />
      </CardBody>
      <DesignationModal value={editing} defaultDept={dept} onClose={() => setEditing(null)} />
    </Card>
  )
}

function DesignationModal({ value, defaultDept, onClose }: { value: Designation | 'new' | null; defaultDept: string; onClose: () => void }) {
  const L = useLookups()
  const existing = value && value !== 'new' ? value : undefined
  const [f, setF] = useState<DesignationFormValues>(designationToForm(existing, defaultDept))
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!value) return
    setF(designationToForm(value === 'new' ? undefined : value, defaultDept))
    setTouched(new Set())
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateDesignation(f, existing)
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof DesignationFormValues) => (touched.has(k) || (k === 'department_id' && !!existing) ? errors[k] : undefined)
  const touch = (k: keyof DesignationFormValues) => setTouched((t) => new Set(t).add(k))

  const save = async () => {
    if (invalid) return setTouched(new Set(Object.keys(f)))
    if (await guard(() => saveDesignation(f, existing), existing ? 'Designation updated' : 'Designation created')) onClose()
  }

  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={existing ? `Edit ${existing.title}` : 'New designation'}
      subtitle="Titles are unique within a department"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={invalid}>
            {existing ? 'Save' : 'Create designation'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Title" required error={err('title')} htmlFor="des-title">
          <Input id="des-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => touch('title')} invalid={!!err('title')} placeholder="CNC Operator" />
        </Field>
        <Field label="Grade" error={err('grade')} htmlFor="des-grade">
          <Input id="des-grade" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value.toUpperCase().slice(0, 6) })} onBlur={() => touch('grade')} invalid={!!err('grade')} className="font-mono uppercase" placeholder="W2" />
        </Field>
        <Field label="Department" required error={err('department_id')} className="sm:col-span-2" htmlFor="des-dept">
          <Select
            id="des-dept"
            value={f.department_id}
            onChange={(e) => {
              setF({ ...f, department_id: e.target.value })
              touch('department_id')
            }}
            invalid={!!err('department_id')}
            options={[...L.dept.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select…"
          />
        </Field>
        <Field label="Description" error={err('description')} className="sm:col-span-2" htmlFor="des-desc">
          <Textarea id="des-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} onBlur={() => touch('description')} placeholder="Responsibilities, qualifications …" />
        </Field>
        <p className="text-[12px] text-ink-faint sm:col-span-2">Grades: M = management · E = engineer/executive · S = supervisor · W = workman · T = trainee.</p>
      </div>
    </Modal>
  )
}
