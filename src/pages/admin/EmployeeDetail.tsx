import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, Boxes, BriefcaseBusiness, CalendarDays, ChevronDown, Fingerprint, History, IndianRupee, KeyRound, LogOut, Mail, Pencil, Phone,
  RotateCcw, Sparkles, UserRound, Users, Wrench,
} from 'lucide-react'
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, InfoGrid, Menu, Progress, StatusBadge, Tabs, confirm, guard, type Column, type MenuItem,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { AttendanceMonth } from '@/components/hr/AttendanceMonth'
import { ActionBadge, AuditChanges, entityLabel } from '@/components/hr/AuditChanges'
import { EmergencyContacts } from '@/components/hr/EmergencyContacts'
import { EmployeeDocuments } from '@/components/hr/EmployeeDocuments'
import { EmployeeForm } from '@/components/hr/EmployeeForm'
import { SalarySummary } from '@/components/hr/SalarySummary'
import { SeparationModal } from '@/components/hr/SeparationModal'
import { PhotoUpload } from '@/components/hr/StoredAvatar'
import { ColorChip } from '@/components/hr/inputs'
import { useRow, useTable } from '@/data/store'
import type { Asset, AuditLog, Employee, LeaveRequest, Payslip, ToolIssue } from '@/data/types'
import { useLookups } from '@/hooks/useLookups'
import { ageInYears, diffDays, fmtDate, fmtDateShort, fmtDateTime, fmtMonth, fyLabel, fyOf, relativeTime, tenure, todayISO } from '@/lib/dates'
import { fullName, inr, maskTail, num, titleCase } from '@/lib/format'
import { leaveBalances } from '@/lib/leaves'
import { cn } from '@/lib/misc'
import { reactivateEmployee, setEmployeePhoto } from '@/services/hr'
import { useSession } from '@/services/session'

type Tab = 'overview' | 'contacts' | 'documents' | 'attendance' | 'leaves' | 'salary' | 'assets' | 'activity'

export default function EmployeeDetailPage() {
  const { id } = useParams()
  const emp = useRow('employees', id)
  if (!emp)
    return (
      <div className="mx-auto mt-6 max-w-lg">
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="Employee not found"
          description="The record may have been removed, or your role cannot see it."
          action={
            <Link to="/admin/employees" className="font-semibold text-brand-indigo hover:underline">
              Back to employees
            </Link>
          }
        />
      </div>
    )
  return <Detail emp={emp} />
}

function Detail({ emp }: { emp: Employee }) {
  const s = useSession()
  const L = useLookups()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [separating, setSeparating] = useState(false)
  const contacts = useTable('emergency_contacts')
  const documents = useTable('employee_documents')
  const users = useTable('app_users')
  const canManage = s.can('employees.manage')
  const canPayroll = s.canAny(['payroll.view', 'payroll.manage'])
  const canAudit = s.can('audit.view')
  const today = todayISO()

  const dept = L.dept.get(emp.department_id)
  const desig = L.desig.get(emp.designation_id)
  const manager = emp.reporting_to ? L.emp.get(emp.reporting_to) : undefined
  const reports = L.employees.filter((e) => e.reporting_to === emp.id && e.status !== 'exited')
  const login = users.find((u) => u.employee_id === emp.id)
  const name = fullName(emp)
  const end = emp.date_of_exit && emp.date_of_exit < today ? emp.date_of_exit : today

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'contacts', label: 'Emergency contacts', count: contacts.filter((c) => c.employee_id === emp.id).length },
    { value: 'documents', label: 'Documents', count: documents.filter((d) => d.employee_id === emp.id).length },
    { value: 'attendance', label: 'Attendance' },
    { value: 'leaves', label: 'Leaves' },
    ...(canPayroll ? [{ value: 'salary' as const, label: 'Salary' }] : []),
    { value: 'assets', label: 'Assets & tools' },
    ...(canAudit ? [{ value: 'activity' as const, label: 'Activity' }] : []),
  ]
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && tabs.some((t) => t.value === raw) ? raw : 'overview'
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })

  const reactivate = async () => {
    if (await confirm({ title: `Re-activate ${name}?`, message: 'The exit date and reason are cleared and the employee is back on rolls for attendance and payroll.', confirmLabel: 'Re-activate' }))
      await guard(() => reactivateEmployee(emp), `${name} is active again`)
  }

  const menu: MenuItem[] = [
    ...(emp.status !== 'exited' ? [{ label: emp.status === 'on_notice' ? 'Update notice / mark exited' : 'Mark on notice / exit', icon: <LogOut />, onClick: () => setSeparating(true) }] : []),
    ...(emp.status !== 'active' ? [{ label: 'Re-activate', icon: <RotateCcw />, onClick: () => void reactivate() }] : []),
    ...(s.can('users.manage') ? [{ label: login ? 'Manage login' : 'Create login', icon: <KeyRound />, onClick: () => nav('/admin/users') }] : []),
  ]

  return (
    <div>
      <Link to="/admin/employees" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft transition hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Employees
      </Link>

      {/* ── header card ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
        <Card className="relative mb-5 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-24 sm:h-28" style={{ background: `linear-gradient(110deg, ${dept?.color ?? '#06b6d4'}42, rgba(99,102,241,.16) 55%, rgba(236,72,153,.14))` }} />
          <div className="relative flex flex-col gap-4 p-4 pt-8 sm:flex-row sm:items-end sm:p-6 sm:pt-12">
            <PhotoUpload name={name} src={emp.photo} size={96} canEdit={canManage} onUpload={(f) => setEmployeePhoto(emp, f)} onRemove={canManage ? () => setEmployeePhoto(emp, null) : undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-[24px] font-bold leading-tight text-ink sm:text-[28px]">{name}</h1>
                <StatusBadge status={emp.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span className="font-medium text-ink">{desig?.title ?? '—'}</span>
                {desig?.grade && <Badge tone="slate">{desig.grade}</Badge>}
                {dept && <ColorChip color={dept.color}>{dept.name}</ColorChip>}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
                <span className="num font-mono font-semibold text-ink">{emp.emp_code}</span>
                <span>
                  Joined {fmtDate(emp.date_of_joining)} · {tenure(emp.date_of_joining, end)}
                </span>
                {emp.work_centre_id && <span>{L.wcName(emp.work_centre_id)}</span>}
                <span>{L.shift.get(emp.shift_id)?.name ?? '—'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {emp.phone && <QuickLink href={`tel:${emp.phone.replace(/\s/g, '')}`} icon={<Phone className="h-4 w-4" />} label="Call" />}
              {emp.email && <QuickLink href={`mailto:${emp.email}`} icon={<Mail className="h-4 w-4" />} label="E-mail" />}
              {canManage && (
                <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {canManage && menu.length > 0 && <Menu items={menu} />}
            </div>
          </div>
          <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-indigo-50 px-4 py-3 text-[13px] sm:px-6">
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-ink-faint">Reports to</span>
              {manager ? (
                <Link to={`/admin/employees/${manager.id}`} className="min-w-0 rounded-lg px-1 py-0.5 transition hover:bg-indigo-50">
                  <EmployeeCell id={manager.id} size={26} />
                </Link>
              ) : (
                <span className="font-medium text-ink">— (top of the org)</span>
              )}
            </span>
            {reports.length > 0 && (
              <span className="text-ink-soft">
                <b className="text-ink">{reports.length}</b> direct report{reports.length === 1 ? '' : 's'}
              </span>
            )}
            {login && s.can('users.manage') && (
              <span className="flex items-center gap-1.5 text-ink-soft">
                <KeyRound className="h-3.5 w-3.5" /> Login {login.active ? 'active' : 'deactivated'} · <span className="min-w-0 truncate">{login.email}</span>
              </span>
            )}
          </div>
          {emp.status !== 'active' && (
            <div className={cn('relative flex items-start gap-2.5 px-4 py-3 text-[13px] sm:px-6', emp.status === 'on_notice' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700')}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0">
                {emp.status === 'on_notice' ? (
                  <>
                    Serving notice — last working day <b>{fmtDate(emp.date_of_exit)}</b>
                    {emp.date_of_exit && emp.date_of_exit >= today ? ` (${diffDays(today, emp.date_of_exit)} days left)` : ''}
                  </>
                ) : (
                  <>
                    Exited on <b>{fmtDate(emp.date_of_exit)}</b>
                  </>
                )}
                {emp.exit_reason && <> · {emp.exit_reason}</>}
              </p>
            </div>
          )}
        </Card>
      </motion.div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'overview' && <Overview emp={emp} onEdit={canManage ? () => setEditing(true) : undefined} />}
          {tab === 'contacts' && <EmergencyContacts employeeId={emp.id} canEdit={canManage} />}
          {tab === 'documents' && <EmployeeDocuments employeeId={emp.id} canManage={canManage} canUpload={canManage} />}
          {tab === 'attendance' &&
            (s.canAny(['attendance.view', 'attendance.manage']) ? <AttendanceMonth employee={emp} /> : <NeedAccess what="Attendance" icon={<CalendarDays className="h-6 w-6" />} />)}
          {tab === 'leaves' && (s.canAny(['leaves.view', 'leaves.manage']) ? <LeavesTab emp={emp} /> : <NeedAccess what="Leaves" icon={<CalendarDays className="h-6 w-6" />} />)}
          {tab === 'salary' && canPayroll && <SalaryTab emp={emp} />}
          {tab === 'assets' && <AssetsTab emp={emp} />}
          {tab === 'activity' && canAudit && <ActivityTab emp={emp} />}
        </motion.div>
      </AnimatePresence>

      <EmployeeForm open={editing} onClose={() => setEditing(false)} employee={emp} />
      <SeparationModal employee={emp} open={separating} onClose={() => setSeparating(false)} />
    </div>
  )
}

function QuickLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <a href={href} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-white/90 px-3.5 text-[13px] font-semibold text-ink shadow-sm transition hover:border-indigo-300 hover:bg-white active:scale-[.97]">
      {icon}
      {label}
    </a>
  )
}

function NeedAccess({ what, icon }: { what: string; icon: ReactNode }) {
  return <EmptyState icon={icon} title={`${what} is not part of your role`} description={`Ask an administrator for ${what.toLowerCase()} access to see this tab.`} />
}

/* ─────────────────────────────── Overview ─────────────────────────────── */

function Overview({ emp, onEdit }: { emp: Employee; onEdit?: () => void }) {
  const L = useLookups()
  const today = todayISO()
  const shift = L.shift.get(emp.shift_id)
  const desig = L.desig.get(emp.designation_id)
  const edit = onEdit ? (
    <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
      Edit
    </Button>
  ) : undefined
  const dash = (v: string | null | undefined) => (v ? v : <span className="text-ink-faint">—</span>)
  const cards: { title: string; icon: ReactNode; items: [ReactNode, ReactNode][] }[] = [
    {
      title: 'Personal',
      icon: <UserRound className="h-4 w-4" />,
      items: [
        ['Full name', fullName(emp)],
        ['Gender', titleCase(emp.gender)],
        ['Date of birth', emp.dob ? `${fmtDate(emp.dob)} · ${ageInYears(emp.dob)} yrs` : dash('')],
        ['Blood group', dash(emp.blood_group)],
        ['Marital status', titleCase(emp.marital_status)],
        ['Personal e-mail', emp.personal_email ? <a className="text-brand-indigo hover:underline" href={`mailto:${emp.personal_email}`}>{emp.personal_email}</a> : dash('')],
      ],
    },
    {
      title: 'Contact',
      icon: <Phone className="h-4 w-4" />,
      items: [
        ['Mobile', emp.phone ? <a className="num text-brand-indigo hover:underline" href={`tel:${emp.phone.replace(/\s/g, '')}`}>{emp.phone}</a> : dash('')],
        ['Official e-mail', emp.email ? <a className="break-all text-brand-indigo hover:underline" href={`mailto:${emp.email}`}>{emp.email}</a> : dash('')],
        ['Address', dash(emp.address)],
        ['City', dash(emp.city)],
        ['State', dash(emp.state)],
        ['Pincode', dash(emp.pincode)],
      ],
    },
    {
      title: 'Job',
      icon: <BriefcaseBusiness className="h-4 w-4" />,
      items: [
        ['Employee code', <span className="font-mono">{emp.emp_code}</span>],
        ['Employment type', titleCase(emp.employment_type)],
        ['Department', L.deptName(emp.department_id)],
        ['Designation', desig ? `${desig.title}${desig.grade ? ` · ${desig.grade}` : ''}` : '—'],
        ['Reports to', emp.reporting_to ? <Link className="text-brand-indigo hover:underline" to={`/admin/employees/${emp.reporting_to}`}>{L.empName(emp.reporting_to)}</Link> : dash('')],
        ['Work centre', emp.work_centre_id ? L.wcName(emp.work_centre_id) : dash('')],
        ['Shift', shift ? `${shift.name} · ${shift.start_time}–${shift.end_time}` : '—'],
        ['Date of joining', fmtDate(emp.date_of_joining)],
        ['Service', tenure(emp.date_of_joining, emp.date_of_exit && emp.date_of_exit < today ? emp.date_of_exit : today)],
        ...(emp.date_of_exit ? ([[emp.status === 'exited' ? 'Exit date' : 'Last working day', fmtDate(emp.date_of_exit)]] as [ReactNode, ReactNode][]) : []),
      ],
    },
    {
      title: 'Statutory & bank',
      icon: <Fingerprint className="h-4 w-4" />,
      items: [
        ['PAN', emp.pan ? <span className="font-mono">{emp.pan}</span> : dash('')],
        ['Aadhaar', emp.aadhaar_masked ? <span className="font-mono">{emp.aadhaar_masked}</span> : dash('')],
        ['UAN (EPF)', emp.uan ? <span className="font-mono">{emp.uan}</span> : dash('')],
        ['ESIC IP no.', emp.esic_no ? <span className="font-mono">{emp.esic_no}</span> : <span className="text-ink-faint">Not covered</span>],
        ['Bank', dash(emp.bank_name)],
        ['Account no.', emp.bank_account ? <span className="font-mono">{maskTail(emp.bank_account)}</span> : dash('')],
        ['IFSC', emp.ifsc ? <span className="font-mono">{emp.ifsc}</span> : dash('')],
        ['Tax regime', emp.tax_regime === 'old' ? `Old · ${inr(emp.declared_deductions)} declared` : 'New regime'],
      ],
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((c, i) => (
        <motion.div key={c.title} className="min-w-0" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.35 }}>
          <Card className="h-full">
            <CardHeader title={c.title} icon={c.icon} actions={edit} />
            <CardBody>
              <InfoGrid items={c.items} />
            </CardBody>
          </Card>
        </motion.div>
      ))}
      <Card className="lg:col-span-2">
        <CardHeader title="Skills & notes" icon={<Sparkles className="h-4 w-4" />} actions={edit} />
        <CardBody>
          {emp.skills.length ? (
            <div className="flex flex-wrap gap-1.5">
              {emp.skills.map((k) => (
                <Badge key={k} tone="indigo">
                  {k}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">No skills recorded.</p>
          )}
          {emp.notes && <p className="mt-4 whitespace-pre-line rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13.5px] text-ink-soft">{emp.notes}</p>}
        </CardBody>
      </Card>
    </div>
  )
}

/* ─────────────────────────────── Leaves ─────────────────────────────── */

function LeavesTab({ emp }: { emp: Employee }) {
  const types = useTable('leave_types')
  const balances = useTable('leave_balances')
  const requests = useTable('leave_requests')
  const today = todayISO()
  const fy = fyOf(today)
  const views = useMemo(() => leaveBalances(emp, fy, types, balances, requests), [emp, fy, types, balances, requests])
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const recent = useMemo(() => requests.filter((r) => r.employee_id === emp.id).sort((a, b) => b.from_date.localeCompare(a.from_date)), [requests, emp.id])

  const columns: Column<LeaveRequest>[] = [
    {
      key: 'type',
      header: 'Type',
      value: (r) => typeMap.get(r.leave_type_id)?.code ?? '',
      cell: (r) => {
        const t = typeMap.get(r.leave_type_id)
        return t ? <ColorChip color={t.color}>{t.name}</ColorChip> : '—'
      },
    },
    { key: 'dates', header: 'Dates', value: (r) => r.from_date, cell: (r) => <span className="num whitespace-nowrap">{r.from_date === r.to_date ? fmtDate(r.from_date) : `${fmtDateShort(r.from_date)} – ${fmtDate(r.to_date)}`}{r.half_day ? ` · ${r.half_day_session ?? ''} half` : ''}</span> },
    { key: 'days', header: 'Days', align: 'right', value: (r) => r.days },
    { key: 'reason', header: 'Reason', value: (r) => r.reason, cell: (r) => <span className="line-clamp-1 max-w-[18rem] text-ink-soft">{r.reason}</span>, hideOnMobile: true },
    { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'applied', header: 'Applied', value: (r) => r.applied_at, cell: (r) => <span className="whitespace-nowrap text-ink-soft">{fmtDate(r.applied_at.slice(0, 10))}</span>, hideOnMobile: true },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`Leave balance · FY ${fyLabel(fy)}`} subtitle="Opening + allotted + adjustments − taken − pending" icon={<CalendarDays className="h-4 w-4" />} actions={<Link to="/admin/leaves" className="text-[13px] font-semibold text-brand-indigo hover:underline">Leaves & holidays →</Link>} />
        <CardBody>
          {views.length ? (
            <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-3">
              {views.map((v, i) => {
                const unpaid = v.type.code === 'LOP'
                return (
                  <motion.div key={v.type.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} className="min-w-0 rounded-2xl border border-indigo-100/80 bg-white/80 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{v.type.name}</p>
                      <span className="shrink-0 rounded-md px-1.5 py-px font-mono text-[11px] font-bold" style={{ background: `${v.type.color}1a`, color: v.type.color }}>
                        {v.type.code}
                      </span>
                    </div>
                    {unpaid ? (
                      <p className="mt-1 font-display text-2xl font-bold text-ink">
                        {num(v.used, 1)} <span className="text-[13px] font-medium text-ink-soft">days taken</span>
                      </p>
                    ) : (
                      <p className="mt-1 font-display text-2xl font-bold text-ink">
                        {num(v.available, 1)} <span className="text-[13px] font-medium text-ink-soft">of {num(v.entitled, 1)} left</span>
                      </p>
                    )}
                    {!unpaid && <Progress className="mt-2" value={v.used + v.pending} max={Math.max(v.entitled, 0.0001)} tone={v.type.color} />}
                    <p className="mt-2 text-[11.5px] text-ink-faint">
                      Opening {num(v.opening, 1)} · Allotted {num(v.allotted, 1)}
                      {v.adjustment ? ` · Adj ${num(v.adjustment, 1)}` : ''} · Taken {num(v.used, 1)}
                      {v.pending ? ` · Pending ${num(v.pending, 1)}` : ''}
                    </p>
                  </motion.div>
                )
              })}
            </div>
          ) : (
            <EmptyState title="No leave types" description="Set up leave types in Leaves & holidays." />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Leave requests" subtitle={`${recent.length} on record`} />
        <CardBody>
          <DataTable rows={recent} columns={columns} rowKey={(r) => r.id} pageSize={10} empty={<EmptyState title="No leave requests" description="Requests appear here when they are applied." />} />
        </CardBody>
      </Card>
    </div>
  )
}

/* ─────────────────────────────── Salary ─────────────────────────────── */

function SalaryTab({ emp }: { emp: Employee }) {
  const nav = useNavigate()
  const payslips = useTable('payslips')
  const mine = useMemo(() => payslips.filter((p) => p.employee_id === emp.id).sort((a, b) => b.month.localeCompare(a.month)), [payslips, emp.id])
  const columns: Column<Payslip>[] = [
    { key: 'month', header: 'Month', value: (p) => p.month, cell: (p) => <span className="font-semibold text-ink">{fmtMonth(p.month)}</span> },
    { key: 'paid', header: 'Paid days', align: 'right', value: (p) => p.paid_days, cell: (p) => `${num(p.paid_days, 1)} / ${p.days_in_month}` },
    { key: 'gross', header: 'Gross', align: 'right', value: (p) => p.gross_earnings, cell: (p) => inr(p.gross_earnings) },
    { key: 'ded', header: 'Deductions', align: 'right', value: (p) => p.total_deductions, cell: (p) => inr(p.total_deductions), hideOnMobile: true },
    { key: 'net', header: 'Net pay', align: 'right', value: (p) => p.net_pay, cell: (p) => <b className="text-ink">{inr(p.net_pay)}</b> },
    { key: 'pub', header: 'Status', value: (p) => (p.published ? 'Published' : 'Draft'), cell: (p) => (p.published ? <Badge tone="green" dot>Published</Badge> : <Badge tone="slate" dot>Draft</Badge>) },
  ]
  return (
    <div className="space-y-4">
      <SalarySummary employee={emp} emptyHint="Add a salary structure in Payroll so this employee is included in payroll runs." />
      <Card>
        <CardHeader title="Payslips" subtitle={mine.length ? `${mine.length} months · click to open the payroll run` : undefined} icon={<IndianRupee className="h-4 w-4" />} actions={<Link to="/admin/payroll" className="text-[13px] font-semibold text-brand-indigo hover:underline">Payroll →</Link>} />
        <CardBody>
          <DataTable rows={mine} columns={columns} rowKey={(p) => p.id} pageSize={12} onRowClick={(p) => nav(`/admin/payroll/${p.run_id}`)} empty={<EmptyState title="No payslips yet" description="Payslips appear after a payroll run is processed." />} />
        </CardBody>
      </Card>
    </div>
  )
}

/* ─────────────────────────────── Assets & tools ─────────────────────────────── */

function AssetsTab({ emp }: { emp: Employee }) {
  const s = useSession()
  const assets = useTable('assets')
  const issues = useTable('tool_issues')
  const items = useTable('inventory_items')
  const today = todayISO()
  const canAssets = s.canAny(['inventory.view', 'inventory.manage', 'quality.view', 'quality.manage'])
  const canTools = s.canAny(['inventory.view', 'inventory.manage'])
  const mineAssets = useMemo(() => assets.filter((a) => a.custodian_id === emp.id).sort((a, b) => a.asset_code.localeCompare(b.asset_code)), [assets, emp.id])
  const mineTools = useMemo(() => issues.filter((t) => t.employee_id === emp.id).sort((a, b) => b.issued_on.localeCompare(a.issued_on)), [issues, emp.id])
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  if (!canAssets && !canTools) return <NeedAccess what="Inventory" icon={<Boxes className="h-6 w-6" />} />

  const assetCols: Column<Asset>[] = [
    { key: 'code', header: 'Asset', value: (a) => a.asset_code, cell: (a) => <span className="min-w-0"><span className="block font-semibold text-ink">{a.name}</span><span className="block font-mono text-[11.5px] text-ink-faint">{a.asset_code}</span></span> },
    { key: 'cat', header: 'Category', value: (a) => titleCase(a.category) },
    { key: 'serial', header: 'Serial', value: (a) => a.serial_no, hideOnMobile: true },
    {
      key: 'cal',
      header: 'Calibration due',
      value: (a) => a.calibration_due ?? '',
      cell: (a) => (!a.calibration_required || !a.calibration_due ? <span className="text-ink-faint">—</span> : a.calibration_due < today ? <Badge tone="red" dot>Overdue {fmtDateShort(a.calibration_due)}</Badge> : <span className="num">{fmtDate(a.calibration_due)}</span>),
    },
    { key: 'status', header: 'Status', value: (a) => a.status, cell: (a) => <StatusBadge status={a.status} /> },
  ]
  const toolCols: Column<ToolIssue>[] = [
    { key: 'item', header: 'Tool / item', value: (t) => itemMap.get(t.item_id)?.name ?? '', cell: (t) => <span className="min-w-0"><span className="block font-semibold text-ink">{itemMap.get(t.item_id)?.name ?? 'Item'}</span><span className="block font-mono text-[11.5px] text-ink-faint">{itemMap.get(t.item_id)?.sku ?? ''}</span></span> },
    { key: 'qty', header: 'Qty', align: 'right', value: (t) => t.qty },
    { key: 'issued', header: 'Issued', value: (t) => t.issued_on, cell: (t) => fmtDate(t.issued_on) },
    {
      key: 'due',
      header: 'Due back',
      value: (t) => t.due_back ?? '',
      cell: (t) => (!t.due_back ? <span className="text-ink-faint">—</span> : t.status === 'issued' && t.due_back < today ? <Badge tone="red" dot>Overdue {fmtDateShort(t.due_back)}</Badge> : fmtDate(t.due_back)),
    },
    { key: 'ret', header: 'Returned', value: (t) => t.returned_on ?? '', cell: (t) => (t.returned_on ? `${fmtDate(t.returned_on)}${t.condition ? ` · ${t.condition}` : ''}` : '—'), hideOnMobile: true },
    { key: 'status', header: 'Status', value: (t) => t.status, cell: (t) => <StatusBadge status={t.status} /> },
  ]
  const out = mineTools.filter((t) => t.status === 'issued').length
  return (
    <div className="space-y-4">
      {canAssets && (
        <Card>
          <CardHeader title="Assets in custody" subtitle={`${mineAssets.length} asset${mineAssets.length === 1 ? '' : 's'} — gauges, instruments, IT`} icon={<Boxes className="h-4 w-4" />} />
          <CardBody>
            <DataTable rows={mineAssets} columns={assetCols} rowKey={(a) => a.id} pageSize={10} empty={<EmptyState title="No assets assigned" description="Assets with this employee as custodian appear here." />} />
          </CardBody>
        </Card>
      )}
      {canTools && (
        <Card>
          <CardHeader title="Tool issues" subtitle={out ? `${out} not yet returned` : 'All tools returned'} icon={<Wrench className="h-4 w-4" />} />
          <CardBody>
            <DataTable rows={mineTools} columns={toolCols} rowKey={(t) => t.id} pageSize={10} empty={<EmptyState title="No tools issued" description="Tool-crib issues to this employee appear here." />} />
          </CardBody>
        </Card>
      )}
    </div>
  )
}

/* ─────────────────────────────── Activity ─────────────────────────────── */

function ActivityTab({ emp }: { emp: Employee }) {
  const logs = useTable('audit_logs')
  const contacts = useTable('emergency_contacts')
  const docs = useTable('employee_documents')
  const leaves = useTable('leave_requests')
  const regs = useTable('regularisations')
  const advances = useTable('advances')
  const structures = useTable('salary_structures')
  const tools = useTable('tool_issues')
  const vouchers = useTable('petty_cash_vouchers')
  const users = useTable('app_users')
  const [limit, setLimit] = useState(25)
  const [openId, setOpenId] = useState<string | null>(null)

  const entries = useMemo(() => {
    const ids = new Set<string>([emp.id])
    const mine = <T extends { id: string; employee_id: string }>(rows: T[]) => rows.forEach((r) => r.employee_id === emp.id && ids.add(r.id))
    mine(contacts)
    mine(docs)
    mine(leaves)
    mine(regs)
    mine(advances)
    mine(structures)
    mine(tools)
    mine(vouchers)
    users.forEach((u) => u.employee_id === emp.id && ids.add(u.id))
    return logs.filter((l) => !!l.entity_id && ids.has(l.entity_id)).sort((a, b) => b.at.localeCompare(a.at))
  }, [logs, contacts, docs, leaves, regs, advances, structures, tools, vouchers, users, emp.id])

  if (!entries.length) return <EmptyState icon={<History className="h-6 w-6" />} title="No activity yet" description="Changes to this employee’s record, documents, leave and salary appear here." />

  return (
    <Card>
      <CardHeader title="Activity" subtitle={`${entries.length} audit entries for this employee`} icon={<History className="h-4 w-4" />} />
      <CardBody>
        <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-indigo-100">
          {entries.slice(0, limit).map((l, i) => (
            <ActivityItem key={l.id} l={l} i={i} open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)} />
          ))}
        </ol>
        {entries.length > limit && (
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + 25)}>
              Show older
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function ActivityItem({ l, i, open, onToggle }: { l: AuditLog; i: number; open: boolean; onToggle: () => void }) {
  const has = !!l.changes && Object.keys(l.changes).length > 0
  return (
    <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 8) * 0.03 } }} className="relative pl-10">
      <span className="absolute left-[9px] top-3.5 h-3 w-3 rounded-full border-2 border-white bg-grad shadow" />
      <button type="button" onClick={has ? onToggle : undefined} className={cn('w-full rounded-xl px-3 py-2.5 text-left transition', has && 'hover:bg-indigo-50/60', open && 'bg-indigo-50/60')} aria-expanded={has ? open : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={l.action} />
          <span className="text-[12px] font-medium text-ink-faint">{entityLabel(l.entity)}</span>
          {has && <ChevronDown className={cn('ml-auto h-4 w-4 text-ink-faint transition-transform', open && 'rotate-180')} />}
        </div>
        <p className="mt-1 text-[13.5px] text-ink">{l.summary}</p>
        <p className="mt-0.5 text-[12px] text-ink-faint" title={fmtDateTime(l.at)}>
          {l.user_name || 'System'} · {relativeTime(l.at)}
        </p>
      </button>
      <AnimatePresence initial={false}>
        {open && has && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="px-3 pb-2">
            <AuditChanges changes={l.changes} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}
