import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle, ArrowRight, Banknote, CalendarClock, CalendarDays, ClipboardCheck, Clock3, Factory, Gauge, Inbox, KanbanSquare, Megaphone,
  PackageX, Plus, Sparkles, UserCheck, Users, Wallet, Wrench,
} from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import { useSession } from '@/services/session'
import { useLookups } from '@/hooks/useLookups'
import { usePendingApprovals } from '@/hooks/useNavBadges'
import { useNow } from '@/hooks/useClock'
import { buildAttendanceContext, liveStatus, resolveDay } from '@/lib/attendance'
import { addDays, dayOfWeek, fmtDate, fmtDateShort, fmtMonth, fmtTime, relativeTime, todayISO, WEEKDAYS_LONG } from '@/lib/dates'
import { fullName, inr, inrCompact, pct } from '@/lib/format'
import { cn, sum } from '@/lib/misc'
import { Avatar, Badge, Button, Card, CardHeader, StatCard, StatusBadge } from '@/components/ui'
import { ChartBox, ChartGradients, Legend, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'

function greeting(h: number) {
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function AdminDashboard() {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const nav = useNavigate()
  const now = useNow(60_000)
  const today = todayISO()
  const approvals = usePendingApprovals()

  const attendance = useTable('attendance')
  const leaves = useTable('leave_requests')
  const leaveTypes = useTable('leave_types')
  const holidays = useTable('holidays')
  const shifts = useTable('shifts')
  const entries = useTable('petty_cash_entries')
  const tasks = useTable('tasks')
  const machines = useTable('machines')
  const schedules = useTable('maintenance_schedules')
  const runs = useTable('payroll_runs')
  const items = useTable('inventory_items')
  const assets = useTable('assets')
  const ncrs = useTable('ncrs')
  const wos = useTable('work_orders')
  const audits = useTable('audit_logs')
  const announcements = useTable('announcements')

  const ctx = useMemo(() => buildAttendanceContext({ holidays, attendance, leaveRequests: leaves, leaveTypes, shifts, today }), [holidays, attendance, leaves, leaveTypes, shifts, today])
  const onRolls = useMemo(() => L.employees.filter((e) => e.status !== 'exited' && e.date_of_joining <= today && (!e.date_of_exit || e.date_of_exit >= today)), [L.employees, today])

  /* ── today ── */
  const live = useMemo(() => {
    const counts = { in: 0, out: 0, not_in: 0, leave: 0, off: 0, holiday: 0, late: 0 }
    for (const e of onRolls) {
      const st = liveStatus(e, ctx)
      counts[st]++
      if (ctx.records.get(`${e.id}|${today}`)?.late_minutes) counts.late++
    }
    const present = counts.in + counts.out
    const expected = onRolls.length - counts.leave - counts.off - counts.holiday
    return { ...counts, present, expected }
  }, [onRolls, ctx, today])

  const punches = useMemo(
    () =>
      attendance
        .filter((a) => a.date === today && a.check_in)
        .flatMap((a) => [
          { id: a.id + 'i', emp: a.employee_id, at: a.check_in!, kind: 'in' as const, late: a.late_minutes },
          ...(a.check_out ? [{ id: a.id + 'o', emp: a.employee_id, at: a.check_out, kind: 'out' as const, late: 0 }] : []),
        ])
        .sort((x, y) => y.at.localeCompare(x.at))
        .slice(0, 9),
    [attendance, today],
  )

  /* ── presence by work centre (or department for office staff) ── */
  const floor = useMemo(() => {
    const groups = new Map<string, { name: string; color: string; total: number; present: number }>()
    for (const e of onRolls) {
      const wc = e.work_centre_id ? L.wc.get(e.work_centre_id) : null
      const d = L.dept.get(e.department_id)
      const key = wc?.id ?? 'dept:' + e.department_id
      const g = groups.get(key) ?? { name: wc?.name ?? d?.name ?? '—', color: wc?.color ?? d?.color ?? '#6366f1', total: 0, present: 0 }
      g.total++
      const st = liveStatus(e, ctx)
      if (st === 'in' || st === 'out') g.present++
      groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 8)
  }, [onRolls, ctx, L.wc, L.dept])

  /* ── 30-day attendance trend ── */
  const trend = useMemo(() => {
    const out: { day: string; rate: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i)
      let exp = 0
      let pres = 0
      for (const e of onRolls) {
        const r = resolveDay(e, d, ctx)
        if (['holiday', 'week_off', 'not_employed', 'upcoming', 'leave', 'unpaid_leave'].includes(r.status)) continue
        exp++
        if (r.status === 'present' || r.status === 'on_duty') pres++
        else if (r.status === 'half_day') pres += 0.5
      }
      if (exp > 0) out.push({ day: fmtDateShort(d), rate: Math.round((pres / exp) * 100) })
    }
    return out
  }, [onRolls, ctx, today])

  const deptMix = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of onRolls) m.set(e.department_id, (m.get(e.department_id) ?? 0) + 1)
    return [...m.entries()].map(([id, n], i) => ({ name: L.deptName(id), value: n, color: L.dept.get(id)?.color ?? SERIES[i % SERIES.length]! })).sort((a, b) => b.value - a.value)
  }, [onRolls, L])

  const payrollTrend = useMemo(
    () =>
      runs
        .filter((r) => r.status !== 'draft')
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6)
        .map((r) => ({ month: fmtMonth(r.month, true).split(' ')[0], gross: r.total_gross, net: r.total_net, cost: r.total_employer_cost })),
    [runs],
  )

  const cash = useMemo(() => sum(entries, (e) => (e.type === 'in' ? e.amount : -e.amount)), [entries])
  const openTasks = tasks.filter((t) => t.status !== 'done')
  const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date < today)
  const running = machines.filter((m) => m.status === 'running').length
  const breakdowns = machines.filter((m) => m.status === 'breakdown')
  const pmOverdue = schedules.filter((x) => x.active && x.next_due < today)
  const lowStock = items.filter((i) => i.active && i.reorder_level > 0 && i.stock_qty <= i.reorder_level)
  const calDue = assets.filter((a) => a.calibration_required && a.calibration_due && a.calibration_due <= addDays(today, 15))
  const openNcr = ncrs.filter((n) => n.status === 'open')
  const woDue = wos.filter((w) => !['completed', 'dispatched', 'cancelled'].includes(w.status)).sort((a, b) => a.due_date.localeCompare(b.due_date))

  const attention = [
    { show: s.can('leaves.manage') && approvals.leave > 0, icon: CalendarDays, label: 'Leave requests to approve', n: approvals.leave, to: '/admin/approvals', tone: 'amber' },
    { show: s.can('attendance.manage') && approvals.regularisation > 0, icon: Clock3, label: 'Attendance corrections', n: approvals.regularisation, to: '/admin/approvals', tone: 'amber' },
    { show: s.can('attendance.manage') && approvals.overtime > 0, icon: Clock3, label: 'Overtime entries to approve', n: approvals.overtime, to: '/admin/approvals', tone: 'indigo' },
    { show: s.can('petty_cash.manage') && approvals.voucher > 0, icon: Wallet, label: 'Petty-cash claims to settle', n: approvals.voucher, to: '/admin/approvals', tone: 'amber' },
    { show: s.can('payroll.manage') && approvals.advance > 0, icon: Banknote, label: 'Advance requests', n: approvals.advance, to: '/admin/approvals', tone: 'amber' },
    { show: s.can('purchase.manage') && approvals.purchase > 0, icon: Inbox, label: 'Draft purchase orders', n: approvals.purchase, to: '/admin/approvals', tone: 'indigo' },
    { show: s.canAny(['machines.view', 'machines.manage']) && breakdowns.length > 0, icon: AlertTriangle, label: `Breakdown: ${breakdowns.map((m) => m.asset_code).join(', ')}`, n: breakdowns.length, to: '/admin/machines', tone: 'red' },
    { show: s.canAny(['machines.view', 'machines.manage']) && pmOverdue.length > 0, icon: Wrench, label: 'Preventive maintenance overdue', n: pmOverdue.length, to: '/admin/machines', tone: 'red' },
    { show: s.canAny(['inventory.view', 'inventory.manage']) && lowStock.length > 0, icon: PackageX, label: 'Items at or below reorder level', n: lowStock.length, to: '/admin/inventory', tone: 'amber' },
    { show: s.canAny(['inventory.view', 'quality.view']) && calDue.length > 0, icon: Gauge, label: 'Gauges due for calibration (15 days)', n: calDue.length, to: '/admin/inventory', tone: 'amber' },
    { show: s.canAny(['quality.view', 'quality.manage']) && openNcr.length > 0, icon: ClipboardCheck, label: 'Open non-conformance reports', n: openNcr.length, to: '/admin/quality', tone: 'red' },
    { show: s.canAny(['tasks.view', 'tasks.manage']) && overdueTasks.length > 0, icon: KanbanSquare, label: 'Overdue tasks', n: overdueTasks.length, to: '/admin/tasks', tone: 'red' },
  ].filter((a) => a.show)

  const upcomingHolidays = holidays.filter((h) => h.date >= today && h.type !== 'optional').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
  const birthdays = useMemo(() => {
    const out: { id: string; name: string; date: string }[] = []
    for (const e of onRolls) {
      if (!e.dob) continue
      for (let i = 0; i <= 14; i++) {
        const d = addDays(today, i)
        if (d.slice(5) === e.dob.slice(5)) out.push({ id: e.id, name: fullName(e), date: d })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
  }, [onRolls, today])
  const recent = useMemo(() => [...audits].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8), [audits])
  const pinned = announcements.filter((a) => a.pinned && (!a.expires_on || a.expires_on >= today)).sort((a, b) => b.published_at.localeCompare(a.published_at))[0]

  const attendanceRate = live.expected > 0 ? (live.present / live.expected) * 100 : 0
  const firstName = s.employee?.first_name ?? s.user.display_name
  const holidayToday = ctx.holidays.get(today)

  return (
    <div className="space-y-5">
      {/* hero */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative overflow-hidden rounded-[26px] border border-white bg-gradient-to-br from-white via-white/90 to-indigo-50/80 p-5 shadow-glass sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,.22),transparent_65%)]" />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(6,182,212,.18),transparent_65%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker">
              {WEEKDAYS_LONG[dayOfWeek(today)]} · {fmtDate(today)}
            </p>
            <h1 className="mt-1 text-[26px] font-bold leading-tight sm:text-[32px]">
              {greeting(now.getHours())}, <span className="grad-text">{firstName}</span>
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {holidayToday ? `${holidayToday.name} — the plant is closed today.` : `${live.present} of ${live.expected} expected people are in today · ${settings.short_name} plant, KIADB Doddaballapura.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.can('tasks.manage') && (
              <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/admin/tasks')}>
                Task
              </Button>
            )}
            {s.can('announcements.manage') && (
              <Button variant="secondary" size="sm" icon={<Megaphone className="h-4 w-4" />} onClick={() => nav('/admin/announcements')}>
                Announce
              </Button>
            )}
            {approvals.total > 0 && (
              <Button size="sm" icon={<Inbox className="h-4 w-4" />} onClick={() => nav('/admin/approvals')}>
                {approvals.total} to approve
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="In today" value={live.present} icon={<UserCheck className="h-4 w-4" />} accent="green" hint={<span className="num">{pct(attendanceRate)} of {live.expected} · {live.late} late</span>} onClick={s.canAny(['attendance.view', 'attendance.manage']) ? () => nav('/admin/attendance') : undefined} />
        <StatCard label="On leave today" value={live.leave} icon={<CalendarDays className="h-4 w-4" />} accent="cyan" hint={`${live.not_in} not punched yet`} onClick={s.canAny(['leaves.view', 'leaves.manage']) ? () => nav('/admin/leaves') : undefined} />
        <StatCard label="Pending approvals" value={approvals.total} icon={<Inbox className="h-4 w-4" />} accent="pink" hint="Leave, OT, claims, advances, POs" onClick={() => nav('/admin/approvals')} />
        {s.canAny(['petty_cash.view', 'petty_cash.manage']) ? (
          <StatCard label="Petty cash in hand" value={cash} format={(n) => inr(n)} icon={<Wallet className="h-4 w-4" />} accent={cash < settings.petty_cash_low_alert ? 'red' : 'indigo'} hint={cash < settings.petty_cash_low_alert ? 'Below alert level — top up' : `Imprest ${inr(settings.petty_cash_imprest)}`} onClick={() => nav('/admin/petty-cash')} />
        ) : (
          <StatCard label="Headcount" value={onRolls.length} icon={<Users className="h-4 w-4" />} accent="indigo" />
        )}
        <StatCard label="Open tasks" value={openTasks.length} icon={<KanbanSquare className="h-4 w-4" />} accent="amber" hint={`${overdueTasks.length} overdue`} onClick={s.canAny(['tasks.view', 'tasks.manage']) ? () => nav('/admin/tasks') : undefined} />
        <StatCard label="Machines running" value={running} icon={<Factory className="h-4 w-4" />} accent={breakdowns.length ? 'red' : 'green'} hint={`of ${machines.length} · ${breakdowns.length} breakdown`} onClick={s.canAny(['machines.view', 'machines.manage']) ? () => nav('/admin/machines') : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* live floor */}
        <Card className="xl:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Live floor
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500 text-emerald-500" /> LIVE
                </span>
              </span>
            }
            subtitle="Today's presence by work centre and the latest punches — updates instantly."
            icon={<Gauge className="h-4 w-4" />}
            actions={
              s.canAny(['attendance.view', 'attendance.manage']) ? (
                <Link to="/admin/attendance" className="text-[12.5px] font-semibold text-brand-indigo hover:underline">
                  Attendance →
                </Link>
              ) : undefined
            }
          />
          <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[1.1fr_1fr]">
            <ul className="space-y-3">
              {floor.map((g) => (
                <li key={g.name}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-ink">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color, boxShadow: `0 0 8px ${g.color}` }} />
                      <span className="truncate">{g.name}</span>
                    </span>
                    <span className="num shrink-0 text-ink-soft">
                      {g.present}/{g.total}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-indigo-100/70">
                    <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${g.color}, #6366f1)` }} initial={{ width: 0 }} animate={{ width: `${g.total ? (g.present / g.total) * 100 : 0}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-ink-faint">Latest punches</p>
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {punches.map((p) => (
                    <motion.li key={p.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 rounded-xl bg-white/70 px-2.5 py-1.5">
                      <Avatar name={L.empName(p.emp)} src={L.emp.get(p.emp)?.photo} size={26} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{L.empName(p.emp)}</span>
                      {p.kind === 'in' && p.late > 0 && <Badge tone="amber">late {p.late}m</Badge>}
                      <span className={cn('num shrink-0 text-[12px] font-semibold', p.kind === 'in' ? 'text-emerald-600' : 'text-ink-soft')}>
                        {p.kind === 'in' ? 'IN' : 'OUT'} {fmtTime(p.at)}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
                {!punches.length && <li className="rounded-xl bg-white/60 px-3 py-6 text-center text-[13px] text-ink-soft">No punches yet today.</li>}
              </ul>
            </div>
          </div>
        </Card>

        {/* needs attention */}
        <Card>
          <CardHeader title="Needs attention" subtitle="Things waiting on you" icon={<AlertTriangle className="h-4 w-4" />} />
          <ul className="space-y-1.5 p-4 sm:p-5">
            {attention.map((a) => (
              <li key={a.label}>
                <Link to={a.to} className="group flex items-center gap-3 rounded-xl px-2.5 py-2 transition hover:bg-indigo-50/70">
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', a.tone === 'red' ? 'bg-rose-50 text-rose-600' : a.tone === 'indigo' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600')}>
                    <a.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{a.label}</span>
                  <span className="num rounded-full bg-white px-2 py-0.5 text-[12px] font-bold text-ink shadow-sm">{a.n}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-ink-faint transition group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
            {!attention.length && (
              <li className="flex flex-col items-center gap-2 py-8 text-center text-sm text-ink-soft">
                <Sparkles className="h-6 w-6 text-brand-indigo" />
                All clear — nothing is waiting.
              </li>
            )}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance — last 30 days" subtitle="Share of expected people present (leave, holidays and week-offs excluded)" icon={<CalendarClock className="h-4 w-4" />} />
          <div className="px-2 pb-3 sm:px-4">
            <ChartBox height={230}>
              <AreaChart data={trend} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                <ChartGradients />
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axisProps} domain={[50, 100]} unit="%" />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, 'Present']} />
                <Area type="monotone" dataKey="rate" stroke="#6366f1" strokeWidth={2.5} fill="url(#gIndigo)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ChartBox>
          </div>
        </Card>
        <Card>
          <CardHeader title="Headcount by department" subtitle={`${onRolls.length} on rolls`} icon={<Users className="h-4 w-4" />} />
          <div className="grid grid-cols-1 items-center gap-2 p-4 xs:grid-cols-[150px_1fr] sm:p-5 xl:grid-cols-1 2xl:grid-cols-[150px_1fr]">
            <ChartBox height={150}>
              <PieChart>
                <Pie data={deptMix} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
                  {deptMix.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip {...tooltipProps} />
              </PieChart>
            </ChartBox>
            <Legend items={deptMix.slice(0, 6).map((d) => ({ label: d.name, value: d.value, color: d.color }))} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {s.canAny(['payroll.view', 'payroll.manage']) && (
          <Card>
            <CardHeader title="Payroll cost" subtitle="Last six runs · employer cost vs net pay" icon={<Banknote className="h-4 w-4" />} actions={<Link to="/admin/payroll" className="text-[12.5px] font-semibold text-brand-indigo hover:underline">Payroll →</Link>} />
            <div className="px-2 pb-3 sm:px-4">
              <ChartBox height={210}>
                <BarChart data={payrollTrend} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                  <ChartGradients />
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => inrCompact(v)} width={56} />
                  <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [inr(v), n === 'cost' ? 'Employer cost' : n === 'gross' ? 'Gross' : 'Net pay']} />
                  <Bar dataKey="cost" fill="url(#gBar)" radius={[6, 6, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="net" fill="url(#gBarPink)" radius={[6, 6, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ChartBox>
            </div>
          </Card>
        )}

        {s.canAny(['sales.view', 'sales.manage']) && (
          <Card>
            <CardHeader title="Work orders due" subtitle={`${woDue.length} open`} icon={<Factory className="h-4 w-4" />} actions={<Link to="/admin/production" className="text-[12.5px] font-semibold text-brand-indigo hover:underline">Production →</Link>} />
            <ul className="space-y-2 p-4 sm:p-5">
              {woDue.slice(0, 5).map((w) => {
                const prog = w.qty ? Math.round((w.completed_qty / w.qty) * 100) : 0
                const late = w.due_date < today
                return (
                  <li key={w.id}>
                    <Link to={`/admin/production?wo=${w.id}`} className="block rounded-xl bg-white/70 px-3 py-2.5 transition hover:bg-indigo-50/70">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                          {w.wo_no} · {w.part_name}
                        </span>
                        <StatusBadge status={w.status} />
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-indigo-100/70">
                          <div className="h-full rounded-full bg-grad" style={{ width: `${prog}%` }} />
                        </div>
                        <span className={cn('num shrink-0 text-[11.5px] font-semibold', late ? 'text-rose-600' : 'text-ink-soft')}>
                          {late ? 'Overdue ' : 'Due '}
                          {fmtDateShort(w.due_date)}
                        </span>
                      </div>
                    </Link>
                  </li>
                )
              })}
              {!woDue.length && <li className="py-6 text-center text-sm text-ink-soft">No open work orders.</li>}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader title="Coming up" subtitle="Notices, holidays and birthdays" icon={<CalendarDays className="h-4 w-4" />} />
          <div className="space-y-4 p-4 sm:p-5">
            {pinned && (
              <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 p-3.5 text-white shadow-soft">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/80">
                  <Megaphone className="h-3.5 w-3.5" /> Pinned
                </p>
                <p className="mt-1 text-[13.5px] font-semibold leading-snug">{pinned.title}</p>
              </div>
            )}
            <ul className="space-y-2.5">
              {upcomingHolidays.map((h) => (
                <li key={h.id} className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-center leading-none text-sky-700">
                    <span>
                      <span className="block font-display text-[15px] font-bold">{h.date.slice(8)}</span>
                      <span className="block text-[9.5px] font-semibold uppercase">{fmtDateShort(h.date).slice(3)}</span>
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{h.name}</span>
                    <span className="block text-[12px] capitalize text-ink-soft">
                      {WEEKDAYS_LONG[dayOfWeek(h.date)]} · {h.type}
                    </span>
                  </span>
                </li>
              ))}
              {birthdays.map((b) => (
                <li key={b.id + b.date} className="flex items-center gap-3">
                  <Avatar name={b.name} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">🎂 {b.name}</span>
                    <span className="block text-[12px] text-ink-soft">{b.date === today ? 'Birthday today!' : `Birthday · ${fmtDateShort(b.date)}`}</span>
                  </span>
                </li>
              ))}
              {!upcomingHolidays.length && !birthdays.length && <li className="text-sm text-ink-soft">Nothing scheduled.</li>}
            </ul>
          </div>
        </Card>

        {s.can('audit.view') && (
          <Card className="lg:col-span-2 xl:col-span-3">
            <CardHeader title="Recent activity" subtitle="Every change is recorded in the audit log" icon={<Clock3 className="h-4 w-4" />} actions={<Link to="/admin/audit" className="text-[12.5px] font-semibold text-brand-indigo hover:underline">Audit log →</Link>} />
            <ul className="grid grid-cols-1 gap-x-6 p-4 sm:grid-cols-2 sm:p-5">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-3 border-b border-indigo-50 py-2.5">
                  <Avatar name={a.user_name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">
                      <b className="font-semibold">{a.user_name}</b> · {a.summary}
                    </span>
                    <span className="block text-[11.5px] text-ink-faint">{relativeTime(a.at)}</span>
                  </span>
                  <Badge tone="slate">{a.action}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}
