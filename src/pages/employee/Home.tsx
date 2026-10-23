import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, CalendarPlus, CheckCircle2, ChevronRight, ClipboardList, Clock3, KanbanSquare, Megaphone, ReceiptIndianRupee, Timer, Wallet,
} from 'lucide-react'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'
import { useLookups } from '@/hooks/useLookups'
import { CheckInCard } from '@/components/attendance/CheckInCard'
import { useAttendanceContext, useToday } from '@/components/attendance/shared'
import { summariseMonth } from '@/lib/attendance'
import { leaveBalances } from '@/lib/leaves'
import { WEEKDAYS_LONG, dayOfWeek, fmtDate, fmtDateShort, fmtMonth, fyOf, monthOf, relativeTime } from '@/lib/dates'
import { fullName, inr, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { Badge, Card, CardHeader, StatCard, StatusBadge } from '@/components/ui'

export default function EmployeeHome() {
  const s = useSession()
  const emp = s.employee!
  const L = useLookups()
  const today = useToday()
  const ctx = useAttendanceContext(today)
  const settings = useTable('company_settings')[0]!

  const leaveTypes = useTable('leave_types')
  const balances = useTable('leave_balances')
  const leaveReqs = useTable('leave_requests')
  const tasks = useTable('tasks')
  const payslips = useTable('payslips')
  const vouchers = useTable('petty_cash_vouchers')
  const regs = useTable('regularisations')
  const advances = useTable('advances')
  const announcements = useTable('announcements')
  const reads = useTable('announcement_reads')
  const holidays = useTable('holidays')

  const month = useMemo(() => summariseMonth(emp, monthOf(today), ctx, settings.attendance), [emp, today, ctx, settings.attendance])
  const bal = useMemo(() => leaveBalances(emp, fyOf(today), leaveTypes, balances, leaveReqs).filter((b) => b.type.code !== 'LOP' && (b.entitled > 0 || b.used > 0)), [emp, today, leaveTypes, balances, leaveReqs])
  const myTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'done' && t.assignee_ids.includes(emp.id))
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
    [tasks, emp.id],
  )
  const lastSlip = useMemo(() => payslips.filter((p) => p.employee_id === emp.id && p.published).sort((a, b) => b.month.localeCompare(a.month))[0], [payslips, emp.id])
  const unreadAnn = useMemo(() => {
    const read = new Set(reads.filter((r) => r.user_id === s.user.id).map((r) => r.announcement_id))
    return announcements
      .filter((a) => (!a.expires_on || a.expires_on >= today) && (!a.audience_department_ids.length || a.audience_department_ids.includes(emp.department_id)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.published_at.localeCompare(a.published_at))
      .slice(0, 3)
      .map((a) => ({ ...a, unread: !read.has(a.id) }))
  }, [announcements, reads, s.user.id, today, emp.department_id])

  const requests = useMemo(() => {
    const out: { id: string; icon: ReactNode; title: string; sub: string; status: string; at: string; to: string }[] = []
    for (const l of leaveReqs) {
      if (l.employee_id !== emp.id || (l.status !== 'pending' && l.updated_at < new Date(Date.now() - 7 * 86400000).toISOString())) continue
      const t = leaveTypes.find((x) => x.id === l.leave_type_id)
      out.push({ id: l.id, icon: <CalendarDays className="h-4 w-4" />, title: `${t?.name ?? 'Leave'} · ${num(l.days)} d`, sub: `${fmtDateShort(l.from_date)}${l.to_date !== l.from_date ? ' – ' + fmtDateShort(l.to_date) : ''}`, status: l.status, at: l.updated_at, to: '/me/leaves' })
    }
    for (const v of vouchers) {
      if (v.employee_id !== emp.id || (v.status === 'paid' && v.updated_at < new Date(Date.now() - 7 * 86400000).toISOString()) || v.status === 'rejected') continue
      out.push({ id: v.id, icon: <Wallet className="h-4 w-4" />, title: `Claim ${inr(v.amount)} · ${v.category}`, sub: v.voucher_no, status: v.status, at: v.updated_at, to: '/me/claims' })
    }
    for (const r of regs) if (r.employee_id === emp.id && r.status === 'pending') out.push({ id: r.id, icon: <Clock3 className="h-4 w-4" />, title: 'Attendance correction', sub: fmtDate(r.date), status: r.status, at: r.updated_at, to: '/me/attendance' })
    for (const a of advances) if (a.employee_id === emp.id && (a.status === 'pending' || a.status === 'active')) out.push({ id: a.id, icon: <ReceiptIndianRupee className="h-4 w-4" />, title: `${a.type === 'loan' ? 'Loan' : 'Salary advance'} ${inr(a.amount)}`, sub: a.status === 'active' ? `EMI ${inr(a.emi_amount)}` : 'Awaiting approval', status: a.status, at: a.updated_at, to: '/me/payslips' })
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
  }, [leaveReqs, vouchers, regs, advances, emp.id, leaveTypes])

  const upcoming = holidays.filter((h) => h.date >= today && h.type !== 'optional').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
  const totalAvail = bal.reduce((t, b) => t + Math.max(0, b.available), 0)
  const overdue = myTasks.filter((t) => t.due_date && t.due_date < today).length

  return (
    <div className="space-y-5">
      <div>
        <p className="kicker">
          {WEEKDAYS_LONG[dayOfWeek(today)]}, {fmtDate(today)}
        </p>
        <h1 className="mt-1 text-[20px] font-semibold leading-tight sm:text-[22px]">{fullName(emp)}</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          {emp.emp_code} · {L.desigTitle(emp.designation_id)} · {emp.work_centre_id ? L.wcName(emp.work_centre_id) : L.deptName(emp.department_id)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[1.25fr_1fr]">
        <CheckInCard employee={emp} />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-2">
          <StatCard label="Leave available" value={totalAvail} format={(n) => num(Math.round(n * 2) / 2)} icon={<CalendarDays className="h-4 w-4" />} accent="cyan" hint={bal.slice(0, 3).map((b) => `${b.type.code} ${num(b.available)}`).join(' · ')} />
          <StatCard label={`Present in ${fmtMonth(monthOf(today), true).split(' ')[0]}`} value={month.present} format={(n) => num(Math.round(n * 2) / 2)} icon={<CheckCircle2 className="h-4 w-4" />} accent="green" hint={`${month.late_marks} late · ${num(month.ot_minutes_approved / 60)} h OT`} />
          <StatCard label="Last net pay" value={lastSlip?.net_pay ?? 0} format={(n) => inr(n)} icon={<ReceiptIndianRupee className="h-4 w-4" />} accent="indigo" hint={lastSlip ? fmtMonth(lastSlip.month) : 'No payslip yet'} />
          <StatCard label="Open tasks" value={myTasks.length} icon={<KanbanSquare className="h-4 w-4" />} accent="amber" hint={overdue ? `${overdue} overdue` : 'Nothing overdue'} />
        </div>
      </div>

      {/* quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Quick to="/me/leaves" icon={<CalendarPlus className="h-[18px] w-[18px]" />} label="Apply for leave" />
        <Quick to="/me/claims" icon={<Wallet className="h-[18px] w-[18px]" />} label="New expense claim" />
        <Quick to="/me/attendance" icon={<Timer className="h-[18px] w-[18px]" />} label="Request correction" />
        <Quick to="/me/payslips" icon={<ReceiptIndianRupee className="h-[18px] w-[18px]" />} label="View payslips" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="My tasks" subtitle={myTasks.length ? `${myTasks.length} open` : 'None open'} icon={<KanbanSquare className="h-4 w-4" />} actions={<Link to="/me/tasks" className="text-[13px] font-medium text-brand-600 hover:underline">View board</Link>} />
          <ul className="divide-y divide-line/70 px-4 py-2 sm:px-5">
            {myTasks.slice(0, 5).map((t) => {
              const done = t.checklist.filter((c) => c.done).length
              const late = !!t.due_date && t.due_date < today
              return (
                <li key={t.id}>
                  <Link to="/me/tasks" className="-mx-2 block rounded-md px-2 py-2.5 transition-colors hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[13.5px] font-medium leading-snug text-ink">{t.title}</span>
                      <StatusBadge status={t.priority} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                      <StatusBadge status={t.status} />
                      {t.due_date && <span className={cn('num', late ? 'font-medium text-red-600' : '')}>{late ? 'Overdue · ' : 'Due '}{fmtDateShort(t.due_date)}</span>}
                      {t.checklist.length > 0 && (
                        <span className="num">
                          ✓ {done}/{t.checklist.length}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
            {!myTasks.length && (
              <li className="flex flex-col items-center gap-2 py-6 text-center text-sm text-ink-soft">
                <CheckCircle2 className="h-6 w-6 text-ink-faint" /> No open tasks.
              </li>
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Announcements" subtitle="From HR and the plant office" icon={<Megaphone className="h-4 w-4" />} actions={<Link to="/me/announcements" className="text-[13px] font-medium text-brand-600 hover:underline">View all</Link>} />
          <ul className="divide-y divide-line/70 px-4 py-2 sm:px-5">
            {unreadAnn.map((a) => (
              <li key={a.id}>
                <Link to="/me/announcements" className="-mx-2 block rounded-md px-2 py-2.5 transition-colors hover:bg-slate-50">
                  <div className="flex items-start gap-2">
                    {a.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                    <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-ink">{a.title}</span>
                    {a.priority !== 'normal' && <Badge tone={a.priority === 'urgent' ? 'red' : 'amber'}>{a.priority}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-soft">{a.body}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">{relativeTime(a.published_at)}</p>
                </Link>
              </li>
            ))}
            {!unreadAnn.length && <li className="py-6 text-center text-sm text-ink-soft">No announcements.</li>}
          </ul>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="My requests" subtitle="Leave, claims, corrections and advances" icon={<ClipboardList className="h-4 w-4" />} />
          <ul className="px-2 py-2 sm:px-3">
            {requests.map((r) => (
              <li key={r.id}>
                <Link to={r.to} className="flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors hover:bg-slate-50">
                  <span className="shrink-0 text-ink-faint">{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{r.sub}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
            {!requests.length && <li className="py-6 text-center text-sm text-ink-soft">No open requests.</li>}
          </ul>
          {upcoming.length > 0 && (
            <div className="border-t border-line px-4 pb-4 pt-3 sm:px-5">
              <p className="kicker mb-2">Upcoming holidays</p>
              <div className="flex flex-wrap gap-2">
                {upcoming.map((h) => (
                  <span key={h.id} className="rounded-md border border-line bg-slate-50 px-2.5 py-1 text-[12.5px] text-ink">
                    {fmtDateShort(h.date)} · {h.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Quick({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="card group flex items-center gap-3 px-3.5 py-3 transition-colors hover:border-line-strong hover:bg-slate-50/60">
      <span className="shrink-0 text-brand-600">{icon}</span>
      <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">{label}</span>
      <ChevronRight className="hidden h-4 w-4 text-ink-faint group-hover:text-ink-soft sm:block" />
    </Link>
  )
}
