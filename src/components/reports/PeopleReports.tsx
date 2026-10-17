/** People reports: headcount & attrition, attendance summary, late & OT, leave utilisation, celebrations. */
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlarmClock, Award, Cake, CalendarCheck2, Clock3, Hourglass, PartyPopper, Percent, Plane, TriangleAlert, UserMinus, UserPlus, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { useSettings, useTable } from '@/data/store'
import type { BalanceView } from '@/lib/leaves'
import { buildAttendanceContext } from '@/lib/attendance'
import { fmtDate, fmtDay, fmtDuration, fmtMonth, todayISO } from '@/lib/dates'
import { fullName, num, pct, plural } from '@/lib/format'
import { useLookups } from '@/hooks/useLookups'
import { EmployeeCell } from '@/components/EmployeeCell'
import { Avatar, Badge, Card, Segmented } from '@/components/ui'
import { ChartBox, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'
import {
  EMPLOYMENT_TYPE_LABEL, attendanceSummary, celebrations, countsForUtilisation, fyText, headcountReport, lateOvertime, leaveUtilisation, recentFys, recentMonths,
  type AttendanceRow, type Celebration, type HeadcountDeptRow, type HeadcountMovement, type LateOtRow, type LeaveUtilRow,
} from '@/services/reports'
import {
  ChartCard, ChartEmpty, DeptFilter, Donut, FyFilter, MonthFilter, ReportFrame, ReportTable, SeriesKey, UsageCell, totalOf, useDeptName,
  type RCol, type ReportProps,
} from './ReportKit'

const GENDER_COLORS: Record<string, string> = { male: '#6366f1', female: '#ec4899', other: '#10b981' }
const TYPE_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#10b981']

/* ═════════════════════════ 1. Headcount & attrition ═════════════════════════ */

export function HeadcountReportView(p: ReportProps) {
  const employees = useTable('employees')
  const departments = useTable('departments')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [fy, setFy] = useState(years[0]!)
  const L = useLookups()
  const r = useMemo(() => headcountReport(employees, departments, fy, today, fyStart), [employees, departments, fy, today, fyStart])
  const running = today <= r.asOf

  const deptCols: RCol<HeadcountDeptRow>[] = [
    { key: 'name', header: 'Department', value: (d) => d.name, cell: (d) => <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} /><span className="truncate font-semibold">{d.name}</span></span> },
    { key: 'opening', header: 'Opening', align: 'right', value: (d) => d.opening, total: true },
    { key: 'joiners', header: 'Joiners', align: 'right', value: (d) => d.joiners, total: true, cell: (d) => (d.joiners ? <span className="font-semibold text-emerald-600">+{d.joiners}</span> : '0') },
    { key: 'leavers', header: 'Leavers', align: 'right', value: (d) => d.leavers, total: true, cell: (d) => (d.leavers ? <span className="font-semibold text-rose-600">−{d.leavers}</span> : '0') },
    { key: 'closing', header: 'Headcount', align: 'right', value: (d) => d.closing, total: true, cell: (d) => <b>{d.closing}</b> },
    { key: 'male', header: 'Male', align: 'right', value: (d) => d.male, total: true, hideOnMobile: true },
    { key: 'female', header: 'Female', align: 'right', value: (d) => d.female, total: true, hideOnMobile: true },
    { key: 'average', header: 'Avg headcount', align: 'right', value: (d) => d.average, total: true, hideOnMobile: true },
    { key: 'attrition', header: 'Attrition %', align: 'right', value: (d) => Math.round(d.attrition * 10) / 10, total: true, cell: (d) => pct(d.attrition, 1) },
  ]
  const deptTotal = useMemo(
    () => {
      const base: HeadcountDeptRow = { id: 'total', name: 'Total', color: '', opening: 0, joiners: 0, leavers: 0, closing: 0, male: 0, female: 0, other: 0, average: 0, attrition: 0 }
      return { ...totalOf(r.byDept, base, ['opening', 'joiners', 'leavers', 'closing', 'male', 'female', 'other', 'average']), attrition: r.attrition }
    },
    [r],
  )

  const moveCols: RCol<HeadcountMovement>[] = [
    { key: 'emp', header: 'Employee', value: (m) => L.empName(m.employee_id), cell: (m) => <EmployeeCell id={m.employee_id} sub="code" /> },
    { key: 'event', header: 'Event', value: (m) => (m.event === 'joined' ? 'Joined' : 'Left'), cell: (m) => <Badge tone={m.event === 'joined' ? 'green' : 'red'} dot>{m.event === 'joined' ? 'Joined' : 'Left'}</Badge> },
    { key: 'date', header: 'Date', value: (m) => m.date, cell: (m) => fmtDate(m.date) },
    { key: 'dept', header: 'Department', value: (m) => L.deptName(m.department_id) },
    { key: 'type', header: 'Type', value: (m) => EMPLOYMENT_TYPE_LABEL[m.employment_type], hideOnMobile: true },
    { key: 'note', header: 'Reason', value: (m) => m.note || '—', className: 'max-w-[260px] truncate', hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fyText(fy)} · as on ${fmtDate(r.asOf)}`}
      fileTag={`FY${fy}-${String((fy + 1) % 100).padStart(2, '0')}`}
      filters={<FyFilter value={fy} onChange={setFy} years={years} />}
      kpis={[
        { label: 'Headcount', value: r.closing, icon: <Users className="h-4 w-4" />, accent: 'indigo', hint: `Opening ${r.opening} on ${fmtDate(r.from)}` },
        { label: 'Joiners', value: r.joiners, icon: <UserPlus className="h-4 w-4" />, accent: 'green', hint: fyText(fy) },
        { label: 'Leavers', value: r.leavers, icon: <UserMinus className="h-4 w-4" />, accent: 'pink', hint: `Avg headcount ${num(r.average)}` },
        {
          label: 'Attrition', value: r.attrition, format: (n) => pct(n, 1), icon: <Percent className="h-4 w-4" />, accent: 'amber',
          hint: running && r.monthsElapsed < 12 ? `≈ ${pct(r.annualised, 1)} annualised (${plural(r.monthsElapsed, 'month')})` : 'Leavers ÷ average headcount',
        },
      ]}
      notes={<p>Opening = on the rolls before {fmtDate(r.from)}; headcount = opening + joiners − leavers as on {fmtDate(r.asOf)}. Employees serving notice stay in the headcount until their exit date.</p>}
    >
      <ChartCard title="Headcount through the year" subtitle="Month-end headcount with joiners and leavers">
        <SeriesKey items={[{ label: 'Headcount', color: SERIES[0]!, dashed: true }, { label: 'Joiners', color: '#10b981' }, { label: 'Leavers', color: '#ec4899' }]} />
        <ChartBox height={240}>
          <ComposedChart data={r.monthly} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis yAxisId="hc" {...axisProps} allowDecimals={false} domain={[(min: number) => Math.max(0, min - 3), (max: number) => max + 2]} />
            <YAxis yAxisId="mv" orientation="right" {...axisProps} allowDecimals={false} hide />
            <Tooltip {...tooltipProps} />
            <Bar yAxisId="mv" dataKey="joiners" name="Joiners" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={18} />
            <Bar yAxisId="mv" dataKey="leavers" name="Leavers" fill="#ec4899" radius={[6, 6, 0, 0]} maxBarSize={18} />
            <Line yAxisId="hc" type="monotone" dataKey="headcount" name="Headcount" stroke={SERIES[0]} strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ChartBox>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard title="Headcount by department" subtitle={`As on ${fmtDate(r.asOf)}`}>
          {r.byDept.length ? (
            <ChartBox height={Math.max(180, r.byDept.length * 30 + 20)}>
              <BarChart data={r.byDept} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axisProps} width={128} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + '…' : v)} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="closing" name="Headcount" radius={[0, 6, 6, 0]} maxBarSize={18}>
                  {r.byDept.map((d) => (
                    <Cell key={d.id} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmpty />
          )}
        </ChartCard>
        <ChartCard title="Mix on the rolls" subtitle="Employment type and gender">
          <Donut data={r.byType.map((t, i) => ({ label: t.label, value: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length]! }))} center={<div><p className="font-display text-xl font-bold text-ink">{r.closing}</p><p className="text-[10.5px] text-ink-soft">on rolls</p></div>} />
          {r.closing > 0 && (
            <div className="mt-4">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-indigo-50">
                {r.byGender.map((g) => (
                  <motion.span key={g.key} initial={{ width: 0 }} animate={{ width: `${(g.count / r.closing) * 100}%` }} transition={{ duration: 0.6 }} style={{ background: GENDER_COLORS[g.key] }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-soft">
                {r.byGender.map((g) => (
                  <span key={g.key} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: GENDER_COLORS[g.key] }} />
                    {g.label} <b className="num text-ink">{g.count}</b> <span className="text-ink-faint">({pct((g.count / r.closing) * 100)})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      <ReportTable title="By department" rows={r.byDept} columns={deptCols} rowKey={(d) => d.id} totalsRow={r.byDept.length ? deptTotal : undefined} />
      <ReportTable
        title="Joiners & leavers"
        subtitle={`${fmtDate(r.from)} – ${fmtDate(r.asOf)}`}
        rows={r.movements}
        columns={moveCols}
        rowKey={(m) => m.id}
        searchText={(m) => `${L.empName(m.employee_id)} ${L.emp.get(m.employee_id)?.emp_code ?? ''} ${L.deptName(m.department_id)}`}
        empty={<ChartEmpty text="No joiners or leavers in this period." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ shared: month attendance ═════════════════════════ */

function useMonthAttendance(month: string, deptId: string) {
  const employees = useTable('employees')
  const holidays = useTable('holidays')
  const attendance = useTable('attendance')
  const leaveRequests = useTable('leave_requests')
  const leaveTypes = useTable('leave_types')
  const shifts = useTable('shifts')
  const settings = useSettings()
  const today = todayISO()
  return useMemo(() => {
    const ctx = buildAttendanceContext({ holidays, attendance, leaveRequests, leaveTypes, shifts, today })
    return { ...attendanceSummary(employees, month, ctx, settings.attendance, deptId), policy: settings.attendance }
  }, [employees, holidays, attendance, leaveRequests, leaveTypes, shifts, settings.attendance, month, deptId, today])
}

interface AttFlat {
  id: string
  employee_id: string
  department_id: string
  present: number
  half_days: number
  paid_leave: number
  unpaid_leave: number
  absent: number
  holidays: number
  week_offs: number
  upcoming: number
  late: number
  ot: number
  ot_pending: number
  paid_days: number
  lop: number
  elapsed: number
}

const ATT_KEYS: (keyof AttFlat)[] = ['present', 'half_days', 'paid_leave', 'unpaid_leave', 'absent', 'holidays', 'week_offs', 'upcoming', 'late', 'ot', 'ot_pending', 'paid_days', 'lop', 'elapsed']

const flatAtt = (r: AttendanceRow): AttFlat => ({
  id: r.id, employee_id: r.emp.id, department_id: r.department_id, present: r.s.present, half_days: r.s.half_days, paid_leave: r.s.paid_leave,
  unpaid_leave: r.s.unpaid_leave, absent: r.s.absent, holidays: r.s.holidays, week_offs: r.s.week_offs, upcoming: r.s.upcoming, late: r.s.late_marks,
  ot: r.ot_hours, ot_pending: r.ot_pending_hours, paid_days: r.s.paid_days, lop: r.s.lop_days, elapsed: r.elapsed_working,
})

/* ═════════════════════════ 2. Attendance summary ═════════════════════════ */

export function AttendanceSummaryView(p: ReportProps) {
  const today = todayISO()
  const months = useMemo(() => recentMonths(today), [today])
  const [month, setMonth] = useState(months[0]!)
  const [dept, setDept] = useState('')
  const deptName = useDeptName()
  const L = useLookups()
  const data = useMonthAttendance(month, dept)
  const rows = useMemo(() => data.rows.map(flatAtt), [data.rows])
  const total = useMemo(() => totalOf(rows, { id: 'total', employee_id: '', department_id: '' } as AttFlat, ATT_KEYS), [rows])
  const rate = total.elapsed > 0 ? (total.present / total.elapsed) * 100 : 0

  const n = (v: number) => num(v, 1)
  const cols: RCol<AttFlat>[] = [
    { key: 'emp', header: 'Employee', value: (r) => L.empName(r.employee_id), cell: (r) => <EmployeeCell id={r.employee_id} sub="code" size={28} /> },
    { key: 'code', header: 'Code', value: (r) => L.emp.get(r.employee_id)?.emp_code ?? '', hideOnMobile: true, cell: (r) => <span className="text-ink-soft">{L.emp.get(r.employee_id)?.emp_code}</span> },
    { key: 'dept', header: 'Department', value: (r) => L.deptName(r.department_id), hideOnMobile: true, className: 'max-w-[160px] truncate' },
    { key: 'present', header: 'P', align: 'right', value: (r) => r.present, total: true, cell: (r) => n(r.present) },
    { key: 'half_days', header: 'HD', align: 'right', value: (r) => r.half_days, total: true, hideOnMobile: true },
    { key: 'paid_leave', header: 'L', align: 'right', value: (r) => r.paid_leave, total: true, cell: (r) => n(r.paid_leave) },
    { key: 'unpaid_leave', header: 'LWP', align: 'right', value: (r) => r.unpaid_leave, total: true, cell: (r) => n(r.unpaid_leave), hideOnMobile: true },
    { key: 'absent', header: 'A', align: 'right', value: (r) => r.absent, total: true, cell: (r) => (r.absent ? <span className="font-semibold text-rose-600">{n(r.absent)}</span> : '0') },
    { key: 'holidays', header: 'H', align: 'right', value: (r) => r.holidays, total: true, hideOnMobile: true },
    { key: 'week_offs', header: 'WO', align: 'right', value: (r) => r.week_offs, total: true, hideOnMobile: true },
    { key: 'late', header: 'Late', align: 'right', value: (r) => r.late, total: true, cell: (r) => (r.late ? <span className="font-semibold text-amber-600">{r.late}</span> : '0') },
    { key: 'ot', header: 'OT h', align: 'right', value: (r) => r.ot, total: true, cell: (r) => n(r.ot) },
    { key: 'paid_days', header: 'Paid days', align: 'right', value: (r) => r.paid_days, total: true, cell: (r) => <b>{n(r.paid_days)}</b> },
    { key: 'lop', header: 'LOP', align: 'right', value: (r) => r.lop, total: true, cell: (r) => (r.lop ? <span className="font-semibold text-rose-600">{n(r.lop)}</span> : '0') },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fmtMonth(month)} · ${deptName(dept)}`}
      fileTag={month + (dept ? '_' + deptName(dept).toLowerCase().replace(/[^a-z0-9]+/g, '-') : '')}
      filters={
        <>
          <MonthFilter value={month} onChange={setMonth} months={months} />
          <DeptFilter value={dept} onChange={setDept} />
        </>
      }
      kpis={[
        { label: 'Employees', value: rows.length, icon: <Users className="h-4 w-4" />, accent: 'indigo', hint: deptName(dept) },
        { label: 'Attendance rate', value: rate, format: (v) => pct(v, 1), icon: <CalendarCheck2 className="h-4 w-4" />, accent: 'green', hint: `${n(total.present)} of ${n(total.elapsed)} working days` },
        { label: 'LOP days', value: total.lop, format: (v) => num(v, 1), icon: <TriangleAlert className="h-4 w-4" />, accent: 'red', hint: `${n(total.absent)} absent · ${n(total.unpaid_leave)} LWP` },
        { label: 'Late marks', value: total.late, icon: <AlarmClock className="h-4 w-4" />, accent: 'amber', hint: `${data.policy.late_marks_per_half_day} marks = ½ day LOP` },
        { label: 'OT approved', value: total.ot, format: (v) => `${num(v, 1)} h`, icon: <Clock3 className="h-4 w-4" />, accent: 'cyan', hint: total.ot_pending ? `${num(total.ot_pending, 1)} h pending approval` : 'Nothing pending' },
      ]}
      notes={
        <>
          <p>P present (a half day counts 0.5) · HD half days · L paid leave · LWP leave without pay · A absent · H holidays · WO week-offs · OT h approved overtime hours.</p>
          <p>Paid days and LOP use the same rules as payroll: holidays and week-offs are paid, approved paid leave is paid, and late marks carry the half-day penalty.</p>
          {data.inProgress && <p>{fmtMonth(month)} is in progress — the remaining {plural(total.upcoming, 'working day')} are projected as paid until they happen.</p>}
        </>
      }
    >
      <ChartCard title="Daily attendance" subtitle="Employees present, on leave and absent each day">
        {data.daily.length ? (
          <>
            <SeriesKey items={[{ label: 'Present', color: '#10b981' }, { label: 'On leave', color: '#8b5cf6' }, { label: 'Absent', color: '#f43f5e' }]} />
            <ChartBox height={230}>
              <BarChart data={data.daily} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={6} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipProps} labelFormatter={(d) => `Day ${d}`} />
                <Bar dataKey="present" name="Present" stackId="a" fill="#10b981" maxBarSize={16} />
                <Bar dataKey="leave" name="On leave" stackId="a" fill="#8b5cf6" maxBarSize={16} />
                <Bar dataKey="absent" name="Absent" stackId="a" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text="This month has not started yet." />
        )}
      </ChartCard>
      <ReportTable
        title="Employee-wise summary"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={total}
        initialSort={{ key: 'emp', dir: 'asc' }}
        searchText={(r) => `${L.empName(r.employee_id)} ${L.emp.get(r.employee_id)?.emp_code ?? ''} ${L.deptName(r.department_id)}`}
        searchPlaceholder="Search employee or department…"
        mobileCard={(r) => (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <EmployeeCell id={r.employee_id} sub="department" size={30} />
              <div className="shrink-0 text-right">
                <p className="num text-sm font-bold text-ink">{n(r.paid_days)} <span className="text-[11px] font-medium text-ink-soft">paid</span></p>
                {r.lop > 0 && <p className="num text-[12px] font-semibold text-rose-600">LOP {n(r.lop)}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11.5px]">
              {(
                [
                  ['Present', r.present, 'green'],
                  ['Leave', r.paid_leave, 'violet'],
                  ['LWP', r.unpaid_leave, 'pink'],
                  ['Absent', r.absent, 'red'],
                  ['Late', r.late, 'amber'],
                  ['OT h', r.ot, 'cyan'],
                ] as const
              )
                .filter(([, v], i) => i === 0 || v > 0)
                .map(([k, v, tone]) => (
                  <Badge key={k} tone={tone}>
                    {k} {n(v)}
                  </Badge>
                ))}
            </div>
          </div>
        )}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 3. Late coming & overtime ═════════════════════════ */

export function LateOvertimeView(p: ReportProps) {
  const today = todayISO()
  const months = useMemo(() => recentMonths(today), [today])
  const [month, setMonth] = useState(months[0]!)
  const [dept, setDept] = useState('')
  const deptName = useDeptName()
  const L = useLookups()
  const data = useMonthAttendance(month, dept)
  const rows = useMemo(() => lateOvertime(data.rows), [data.rows])
  const total = useMemo(
    () => totalOf(rows, { ...(rows[0] ?? ({} as LateOtRow)), id: 'total' }, ['late_marks', 'late_minutes', 'penalty_days', 'ot_days', 'ot_approved', 'ot_pending', 'ot_rejected']),
    [rows],
  )
  const frequent = rows.filter((r) => r.late_marks >= data.policy.late_marks_per_half_day).length

  const cols: RCol<LateOtRow>[] = [
    { key: 'emp', header: 'Employee', value: (r) => fullName(r.emp), cell: (r) => <EmployeeCell id={r.emp.id} sub="code" size={28} /> },
    { key: 'dept', header: 'Department', value: (r) => L.deptName(r.department_id), hideOnMobile: true, className: 'max-w-[160px] truncate' },
    { key: 'late_marks', header: 'Late marks', align: 'right', value: (r) => r.late_marks, total: true, cell: (r) => (r.late_marks ? <span className="font-semibold text-amber-600">{r.late_marks}</span> : '0') },
    { key: 'late_minutes', header: 'Late (total)', align: 'right', value: (r) => r.late_minutes, exportValue: (r) => r.late_minutes, total: true, cell: (r) => (r.late_minutes ? fmtDuration(r.late_minutes) : '—'), hideOnMobile: true },
    { key: 'avg_late', header: 'Avg late (min)', align: 'right', value: (r) => r.avg_late, hideOnMobile: true },
    { key: 'max_late', header: 'Worst (min)', align: 'right', value: (r) => r.max_late, hideOnMobile: true },
    { key: 'penalty_days', header: 'Penalty days', align: 'right', value: (r) => r.penalty_days, total: true, cell: (r) => (r.penalty_days ? <span className="font-semibold text-rose-600">{num(r.penalty_days, 1)}</span> : '0') },
    { key: 'ot_days', header: 'OT days', align: 'right', value: (r) => r.ot_days, total: true, hideOnMobile: true },
    { key: 'ot_approved', header: 'OT approved h', align: 'right', value: (r) => r.ot_approved, total: true, cell: (r) => num(r.ot_approved, 1) },
    { key: 'ot_pending', header: 'OT pending h', align: 'right', value: (r) => r.ot_pending, total: true, cell: (r) => (r.ot_pending ? <span className="font-semibold text-amber-600">{num(r.ot_pending, 1)}</span> : '0') },
    { key: 'ot_rejected', header: 'OT rejected h', align: 'right', value: (r) => r.ot_rejected, total: true, cell: (r) => num(r.ot_rejected, 1), hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fmtMonth(month)} · ${deptName(dept)}`}
      fileTag={month}
      filters={
        <>
          <MonthFilter value={month} onChange={setMonth} months={months} />
          <DeptFilter value={dept} onChange={setDept} />
        </>
      }
      kpis={[
        { label: 'Late marks', value: total.late_marks, icon: <AlarmClock className="h-4 w-4" />, accent: 'amber', hint: `${fmtDuration(total.late_minutes)} lost in total` },
        { label: 'Penalty days', value: total.penalty_days, format: (v) => num(v, 1), icon: <TriangleAlert className="h-4 w-4" />, accent: 'red', hint: `${plural(frequent, 'employee')} at ≥ ${data.policy.late_marks_per_half_day} marks` },
        { label: 'OT approved', value: total.ot_approved, format: (v) => `${num(v, 1)} h`, icon: <Clock3 className="h-4 w-4" />, accent: 'indigo', hint: `${plural(total.ot_days, 'OT day')}` },
        { label: 'OT pending', value: total.ot_pending, format: (v) => `${num(v, 1)} h`, icon: <Hourglass className="h-4 w-4" />, accent: 'cyan', hint: total.ot_rejected ? `${num(total.ot_rejected, 1)} h rejected` : 'Awaiting approval' },
      ]}
      notes={<p>A late mark is a punch-in after the shift start plus grace. Every {data.policy.late_marks_per_half_day} late marks deduct half a paid day in payroll. Only approved OT is paid.</p>}
    >
      <ChartCard title="By day" subtitle="Late marks and overtime hours each day">
        {data.daily.length ? (
          <>
            <SeriesKey items={[{ label: 'Late marks', color: '#f59e0b' }, { label: 'OT approved (h)', color: '#6366f1', dashed: true }, { label: 'OT pending (h)', color: '#06b6d4', dashed: true }]} />
            <ChartBox height={240}>
              <ComposedChart data={data.daily} margin={{ top: 8, right: 0, left: -22, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={6} />
                <YAxis yAxisId="l" {...axisProps} allowDecimals={false} />
                <YAxis yAxisId="h" orientation="right" {...axisProps} width={34} />
                <Tooltip {...tooltipProps} labelFormatter={(d) => `Day ${d}`} />
                <Bar yAxisId="l" dataKey="late" name="Late marks" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Line yAxisId="h" type="monotone" dataKey="ot_approved" name="OT approved (h)" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line yAxisId="h" type="monotone" dataKey="ot_pending" name="OT pending (h)" stroke="#06b6d4" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text="This month has not started yet." />
        )}
      </ChartCard>
      <ReportTable
        title="Employee-wise late marks & overtime"
        subtitle="Employees with at least one late mark or OT entry"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={rows.length ? total : undefined}
        initialSort={{ key: 'late_marks', dir: 'desc' }}
        searchText={(r) => `${fullName(r.emp)} ${r.emp.emp_code} ${L.deptName(r.department_id)}`}
        empty={<ChartEmpty text="No late marks or overtime this month." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 4. Leave utilisation ═════════════════════════ */

export function LeaveUtilisationView(p: ReportProps) {
  const employees = useTable('employees')
  const leaveTypes = useTable('leave_types')
  const balances = useTable('leave_balances')
  const requests = useTable('leave_requests')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [fy, setFy] = useState(years[0]!)
  const [dept, setDept] = useState('')
  const deptName = useDeptName()
  const L = useLookups()
  const data = useMemo(() => leaveUtilisation(employees, fy, leaveTypes, balances, requests, fyStart, dept), [employees, fy, leaveTypes, balances, requests, fyStart, dept])

  const tot = useMemo(() => {
    const t = totalOf(data.rows, { ...(data.rows[0] ?? ({} as LeaveUtilRow)), id: 'total', balances: {} }, ['used', 'paidUsed', 'entitled', 'pending', 'lop'])
    const b: Record<string, BalanceView> = {}
    for (const bt of data.byType) b[bt.type.id] = { type: bt.type, opening: 0, allotted: 0, adjustment: 0, entitled: bt.entitled, used: bt.used, pending: bt.pending, available: bt.available }
    return { ...t, balances: b }
  }, [data])
  const util = tot.entitled > 0 ? (tot.paidUsed / tot.entitled) * 100 : 0

  const cols: RCol<LeaveUtilRow>[] = [
    { key: 'emp', header: 'Employee', value: (r) => fullName(r.emp), cell: (r) => <EmployeeCell id={r.emp.id} sub="code" size={28} /> },
    { key: 'dept', header: 'Department', value: (r) => L.deptName(r.department_id), hideOnMobile: true, className: 'max-w-[150px] truncate' },
    ...data.types.map<RCol<LeaveUtilRow>>((t) => ({
      key: `t-${t.id}`,
      header: t.code,
      align: 'right',
      total: true,
      value: (r) => r.balances[t.id]?.used ?? null,
      exportValue: (r) => {
        const b = r.balances[t.id]
        if (!b) return '—'
        return t.code === 'LOP' ? b.used : `${b.used} / ${b.entitled}`
      },
      cell: (r) => {
        const b = r.balances[t.id]
        if (!b) return <span className="text-ink-faint">—</span>
        if (t.code === 'LOP') return b.used ? <span className="font-semibold text-rose-600">{num(b.used)}</span> : <span>0</span>
        return <UsageCell used={b.used} of={b.entitled} pending={b.pending} />
      },
    })),
    { key: 'used', header: 'Total used', align: 'right', value: (r) => r.used, total: true, cell: (r) => <b>{num(r.used)}</b> },
    { key: 'pending', header: 'Pending', align: 'right', value: (r) => r.pending, total: true, cell: (r) => (r.pending ? <span className="font-semibold text-amber-600">{num(r.pending)}</span> : '0'), hideOnMobile: true },
  ]

  // event-based leave (maternity) has a large one-off entitlement: show what was used, not the balance
  const chart = data.byType.map((t) => ({ name: t.type.code, label: t.type.name, used: t.used, pending: t.pending, balance: t.eventBased ? 0 : t.available }))

  return (
    <ReportFrame
      {...p}
      period={`${fyText(fy)} · ${deptName(dept)}`}
      fileTag={`FY${fy}`}
      filters={
        <>
          <FyFilter value={fy} onChange={setFy} years={years} />
          <DeptFilter value={dept} onChange={setDept} />
        </>
      }
      kpis={[
        { label: 'Leave days taken', value: tot.used, format: (v) => num(v, 1), icon: <Plane className="h-4 w-4" />, accent: 'indigo', hint: `${plural(data.rows.length, 'employee')}` },
        { label: 'Utilisation', value: util, format: (v) => pct(v, 1), icon: <Percent className="h-4 w-4" />, accent: 'cyan', hint: `${num(tot.paidUsed)} of ${num(tot.entitled)} entitled days` },
        { label: 'Pending approval', value: tot.pending, format: (v) => num(v, 1), icon: <Hourglass className="h-4 w-4" />, accent: 'amber', hint: 'Days in pending requests' },
        { label: 'Leave without pay', value: tot.lop, format: (v) => num(v, 1), icon: <TriangleAlert className="h-4 w-4" />, accent: 'red', hint: 'LOP leave days' },
      ]}
      notes={
        <>
          <p>Entitled = opening (carried forward) + allotted for the year + adjustments; mid-year joiners are pro-rated. Used counts approved requests starting in the financial year; amber “+n” shows days awaiting approval.</p>
          <p>Utilisation covers annual paid leave ({data.types.filter(countsForUtilisation).map((t) => t.code).join(', ') || '—'}); leave without pay and gender-specific statutory leave such as maternity are shown but not counted.</p>
        </>
      }
    >
      <ChartCard title="By leave type" subtitle="Days used, pending and still available across employees">
        {chart.length ? (
          <>
            <SeriesKey items={[{ label: 'Used', color: SERIES[0]! }, { label: 'Pending', color: '#f59e0b' }, { label: 'Available', color: '#c7d2fe' }]} />
            <ChartBox height={240}>
              <BarChart data={chart} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipProps} labelFormatter={(_, pl) => (pl?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} />
                <Bar dataKey="used" name="Used" stackId="a" fill={SERIES[0]} maxBarSize={36} />
                <Bar dataKey="pending" name="Pending" stackId="a" fill="#f59e0b" maxBarSize={36} />
                <Bar dataKey="balance" name="Available" stackId="a" fill="#c7d2fe" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text="No active leave types." />
        )}
      </ChartCard>
      <ReportTable
        title="Employee-wise utilisation"
        subtitle="Used / entitled days per leave type"
        rows={data.rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={data.rows.length ? tot : undefined}
        initialSort={{ key: 'used', dir: 'desc' }}
        searchText={(r) => `${fullName(r.emp)} ${r.emp.emp_code} ${L.deptName(r.department_id)}`}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 5. Birthdays & anniversaries ═════════════════════════ */

export function CelebrationsView(p: ReportProps) {
  const employees = useTable('employees')
  const today = todayISO()
  const L = useLookups()
  const [kind, setKind] = useState<'all' | 'birthday' | 'anniversary'>('all')
  const all = useMemo(() => celebrations(employees, today, 30), [employees, today])
  const rows = kind === 'all' ? all : all.filter((c) => c.kind === kind)
  const birthdays = all.filter((c) => c.kind === 'birthday').length
  const anniversaries = all.length - birthdays
  const todays = all.filter((c) => c.daysAway === 0)
  const milestones = all.filter((c) => c.kind === 'anniversary' && c.years % 5 === 0).length
  const skipped = employees.filter((e) => e.status !== 'exited' && !e.dob).length
  const when = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d} days`)

  const cols: RCol<Celebration>[] = [
    { key: 'date', header: 'Date', value: (c) => c.date, cell: (c) => <span className="whitespace-nowrap"><b className="font-semibold">{fmtDay(c.date)}</b> <span className={c.daysAway === 0 ? 'font-semibold text-pink-600' : 'text-ink-faint'}>· {when(c.daysAway)}</span></span> },
    { key: 'emp', header: 'Employee', value: (c) => L.empName(c.employee_id), cell: (c) => <EmployeeCell id={c.employee_id} sub="designation" size={28} /> },
    { key: 'dept', header: 'Department', value: (c) => L.deptName(c.department_id), hideOnMobile: true },
    { key: 'kind', header: 'Occasion', value: (c) => (c.kind === 'birthday' ? 'Birthday' : 'Work anniversary'), cell: (c) => (c.kind === 'birthday' ? <Badge tone="pink">Birthday</Badge> : <Badge tone="violet">Work anniversary</Badge>) },
    {
      key: 'years', header: 'Milestone', align: 'right', value: (c) => c.years,
      exportValue: (c) => (c.kind === 'birthday' ? `Turns ${c.years}` : `${c.years} yr${c.years === 1 ? '' : 's'} of service`),
      cell: (c) => (c.kind === 'birthday' ? `Turns ${c.years}` : <span className={c.years % 5 === 0 ? 'font-semibold text-brand-indigo' : ''}>{plural(c.years, 'year')}</span>),
    },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fmtDate(today)} – next 30 days`}
      fileTag={today}
      kpis={[
        { label: 'Birthdays', value: birthdays, icon: <Cake className="h-4 w-4" />, accent: 'pink', hint: 'Next 30 days' },
        { label: 'Work anniversaries', value: anniversaries, icon: <Award className="h-4 w-4" />, accent: 'indigo', hint: `${plural(milestones, 'milestone')} (5, 10, 15 … yrs)` },
        { label: 'Today', value: todays.length, icon: <PartyPopper className="h-4 w-4" />, accent: 'amber', hint: todays.length ? 'Celebrations today' : 'Nothing today' },
      ]}
      notes={<p>Employees on the rolls (including those serving notice). {skipped ? `${plural(skipped, 'employee')} without a date of birth on file ${skipped === 1 ? 'is' : 'are'} skipped for birthdays.` : 'Employees without a date of birth on file are skipped.'}</p>}
    >
      {todays.length > 0 && (
        <Card className="relative overflow-hidden p-4 sm:p-5">
          <span className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br from-pink-400/25 to-amber-300/25" />
          <p className="kicker mb-3 flex items-center gap-1.5"><PartyPopper className="h-3.5 w-3.5" /> Today</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {todays.map((c, i) => {
              const e = L.emp.get(c.employee_id)
              const name = e ? fullName(e) : '—'
              return (
                <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="flex min-w-0 items-center gap-3 rounded-2xl border border-pink-100 bg-white/80 p-3">
                  <Avatar name={name} src={e?.photo} size={40} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{name}</p>
                    <p className="truncate text-[12.5px] text-ink-soft">{c.kind === 'birthday' ? `Birthday · turns ${c.years}` : `${plural(c.years, 'year')} at Melstar`}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-pink-500">{c.kind === 'birthday' ? <Cake className="h-5 w-5" /> : <Award className="h-5 w-5" />}</span>
                </motion.div>
              )
            })}
          </div>
        </Card>
      )}
      <ReportTable
        title="Upcoming celebrations"
        rows={rows}
        columns={cols}
        rowKey={(c) => c.id}
        toolbar={
          <Segmented
            size="sm"
            className="no-print"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: `All (${all.length})` },
              { value: 'birthday', label: `Birthdays (${birthdays})` },
              { value: 'anniversary', label: `Anniversaries (${anniversaries})` },
            ]}
          />
        }
        searchText={(c) => `${L.empName(c.employee_id)} ${L.deptName(c.department_id)}`}
        empty={<ChartEmpty text="No birthdays or anniversaries in the next 30 days." />}
      />
    </ReportFrame>
  )
}
