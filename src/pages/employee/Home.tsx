import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight, CalendarDays, CalendarPlus, CheckCircle2, ClipboardList, Clock3, KanbanSquare, Megaphone, ReceiptIndianRupee, Sparkles, Timer, Wallet,
} from 'lucide-react'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'
import { useLookups } from '@/hooks/useLookups'
import { CheckInCard } from '@/components/attendance/CheckInCard'
import { useAttendanceContext, useToday } from '@/components/attendance/shared'
import { presentStreak, summariseMonth } from '@/lib/attendance'
import { leaveBalances } from '@/lib/leaves'
import { WEEKDAYS_LONG, dayOfWeek, fmtDate, fmtDateShort, fmtMonth, fyOf, monthOf, relativeTime } from '@/lib/dates'
import { inr, num } from '@/lib/format'
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
  const streak = useMemo(() => presentStreak(emp, ctx), [emp, ctx])
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
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <p className="kicker">
          {WEEKDAYS_LONG[dayOfWeek(today)]} · {fmtDate(today)}
        </p>
        <h1 className="mt-1 text-[26px] font-bold leading-tight sm:text-[32px]">
          Welcome back, <span className="grad-text">{emp.first_name}</span> 👋
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {L.desigTitle(emp.designation_id)} · {emp.work_centre_id ? L.wcName(emp.work_centre_id) : L.deptName(emp.department_id)}
          {streak > 1 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-700">🔥 {streak}-day streak</span>
          )}
        </p>
      </motion.div>

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
        <Quick to="/me/leaves" icon={<CalendarPlus className="h-5 w-5" />} label="Apply leave" tone="from-cyan-500 to-sky-500" />
        <Quick to="/me/claims" icon={<Wallet className="h-5 w-5" />} label="New claim" tone="from-pink-500 to-rose-500" />
        <Quick to="/me/attendance" icon={<Timer className="h-5 w-5" />} label="Fix attendance" tone="from-indigo-500 to-violet-500" />
        <Quick to="/me/payslips" icon={<ReceiptIndianRupee className="h-5 w-5" />} label="Payslips" tone="from-emerald-500 to-teal-500" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="My tasks" subtitle={myTasks.length ? `${myTasks.length} open` : 'All done'} icon={<KanbanSquare className="h-4 w-4" />} actions={<Link to="/me/tasks" className="text-[12.5px] font-semibold text-brand-indigo hover:underline">Board →</Link>} />
          <ul className="space-y-2 p-4 sm:p-5">
            {myTasks.slice(0, 5).map((t) => {
              const done = t.checklist.filter((c) => c.done).length
              const late = !!t.due_date && t.due_date < today
              return (
                <li key={t.id}>
                  <Link to="/me/tasks" className="block rounded-xl bg-white/70 px-3 py-2.5 transition hover:bg-indigo-50/70">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[13.5px] font-semibold leading-snug text-ink">{t.title}</span>
                      <StatusBadge status={t.priority} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                      <StatusBadge status={t.status} />
                      {t.due_date && <span className={cn('num font-semibold', late ? 'text-rose-600' : '')}>{late ? 'Overdue · ' : 'Due '}{fmtDateShort(t.due_date)}</span>}
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
                <Sparkles className="h-6 w-6 text-brand-indigo" /> No open tasks.
              </li>
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Announcements" subtitle="From HR & the plant office" icon={<Megaphone className="h-4 w-4" />} actions={<Link to="/me/announcements" className="text-[12.5px] font-semibold text-brand-indigo hover:underline">All →</Link>} />
          <ul className="space-y-2 p-4 sm:p-5">
            {unreadAnn.map((a) => (
              <li key={a.id}>
                <Link to="/me/announcements" className={cn('block rounded-xl px-3 py-2.5 transition hover:bg-indigo-50/70', a.pinned ? 'bg-gradient-to-br from-indigo-50 to-violet-50' : 'bg-white/70')}>
                  <div className="flex items-start gap-2">
                    {a.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-grad" />}
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-ink">{a.title}</span>
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
          <ul className="space-y-1.5 p-4 sm:p-5">
            {requests.map((r) => (
              <li key={r.id}>
                <Link to={r.to} className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition hover:bg-indigo-50/70">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-brand-indigo">{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">{r.title}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{r.sub}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
            {!requests.length && <li className="py-6 text-center text-sm text-ink-soft">No open requests.</li>}
          </ul>
          {upcoming.length > 0 && (
            <div className="border-t border-indigo-50 px-4 pb-4 pt-3 sm:px-5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-ink-faint">Upcoming holidays</p>
              <div className="flex flex-wrap gap-2">
                {upcoming.map((h) => (
                  <span key={h.id} className="rounded-xl bg-sky-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-sky-800">
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

function Quick({ to, icon, label, tone }: { to: string; icon: ReactNode; label: string; tone: string }) {
  return (
    <Link to={to} className="card group flex items-center gap-3 p-3.5 transition duration-300 hover:-translate-y-0.5 hover:shadow-lift active:scale-[.98]">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft transition-transform duration-500 group-hover:scale-110', tone)}>{icon}</span>
      <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">{label}</span>
      <ArrowRight className="hidden h-4 w-4 text-ink-faint transition group-hover:translate-x-0.5 sm:block" />
    </Link>
  )
}
