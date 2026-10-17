/**
 * Monthly muster register — employees × days with day codes and the payroll summary
 * (summariseMonth is exactly what payroll uses for paid days / LOP / approved OT).
 */
import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Loader2, Search } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Employee, YearMonth } from '@/data/types'
import { DAY_STATUS_META, summariseMonth, type MonthSummary } from '@/lib/attendance'
import { currentMonth, dayOfWeek, fmtDate, fmtMonth, monthDates, monthEnd, monthStart, WEEKDAYS } from '@/lib/dates'
import { fullName, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { exportCsv, pdfFooter, pdfHeader } from '@/lib/export'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { audit } from '@/services/audit'
import { ensureAttendanceRange, needsAttendanceRange } from '@/services/attendance'
import { Button, EmptyState, Select, toast } from '@/components/ui'
import { MonthNav } from '../MonthCalendar'
import { StatusLegend, useAttendanceContext, useToday } from '../shared'
import type { MarkTarget } from '../MarkAttendanceModal'

interface Line {
  emp: Employee
  s: MonthSummary
}

const fullPresent = (s: MonthSummary) => s.present - s.half_days * 0.5
const otHours = (s: MonthSummary) => Math.round((s.ot_minutes_approved / 60) * 10) / 10

const SUMMARY: { key: string; label: string; title: string; value: (s: MonthSummary) => number; tone?: string }[] = [
  { key: 'p', label: 'P', title: 'Present / on-duty days', value: fullPresent, tone: 'text-emerald-700' },
  { key: 'hd', label: 'HD', title: 'Half days worked', value: (s) => s.half_days, tone: 'text-amber-700' },
  { key: 'l', label: 'Leave', title: 'Paid leave days', value: (s) => s.paid_leave, tone: 'text-violet-700' },
  { key: 'lwp', label: 'LWP', title: 'Leave without pay', value: (s) => s.unpaid_leave, tone: 'text-pink-700' },
  { key: 'a', label: 'A', title: 'Absent days', value: (s) => s.absent, tone: 'text-rose-700' },
  { key: 'h', label: 'H', title: 'Plant holidays', value: (s) => s.holidays, tone: 'text-sky-700' },
  { key: 'wo', label: 'WO', title: 'Week-offs', value: (s) => s.week_offs, tone: 'text-slate-500' },
  { key: 'late', label: 'Late', title: 'Late marks', value: (s) => s.late_marks, tone: 'text-amber-700' },
  { key: 'ot', label: 'OT h', title: 'Approved overtime hours', value: otHours, tone: 'text-cyan-700' },
  { key: 'paid', label: 'Paid', title: 'Paid days (payroll)', value: (s) => s.paid_days, tone: 'text-ink font-bold' },
  { key: 'lop', label: 'LOP', title: 'Loss-of-pay days (incl. late-mark penalty)', value: (s) => s.lop_days, tone: 'text-rose-700 font-bold' },
]

export function RegisterTab({ onMark }: { onMark: (t: MarkTarget) => void }) {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const today = useToday()
  const ctx = useAttendanceContext(today)
  const employees = useTable('employees')
  const departments = useTable('departments')
  const [month, setMonth] = useState<YearMonth>(currentMonth())
  const [dept, setDept] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const manage = s.can('attendance.manage')
  const policy = settings.attendance

  // Older months: fetch that slice of attendance from the server first.
  useEffect(() => {
    const from = monthStart(month)
    const to = monthEnd(month)
    if (!needsAttendanceRange(from, to)) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    ensureAttendanceRange(from, to)
      .catch((e) => toast.error('Could not load older attendance', e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [month])

  const dates = monthDates(month)
  const lines = useMemo<Line[]>(() => {
    const from = monthStart(month)
    const to = monthEnd(month)
    return employees
      .filter((e) => e.date_of_joining <= to && (!e.date_of_exit || e.date_of_exit >= from))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
      .map((emp) => ({ emp, s: summariseMonth(emp, month, ctx, policy) }))
  }, [employees, month, ctx, policy])

  const needle = q.trim().toLowerCase()
  const shown = lines.filter((l) => (!dept || l.emp.department_id === dept) && (!needle || `${fullName(l.emp)} ${l.emp.emp_code}`.toLowerCase().includes(needle)))
  const totals = SUMMARY.map((c) => Math.round(shown.reduce((t, l) => t + c.value(l.s), 0) * 10) / 10)
  const closed = (d: string) => ctx.holidays.has(d) || !settings.working_days.includes(dayOfWeek(d))
  const isCurrent = month === currentMonth()
  const deptLabel = dept ? L.deptName(dept) : 'All departments'

  const csv = () => {
    exportCsv(`attendance-register-${month}`, shown, [
      { header: 'Emp code', value: (l) => l.emp.emp_code },
      { header: 'Name', value: (l) => fullName(l.emp) },
      { header: 'Department', value: (l) => L.deptName(l.emp.department_id) },
      ...dates.map((d) => ({ header: d.slice(8), value: (l: Line) => cellCode(l, d) })),
      ...SUMMARY.map((c) => ({ header: c.label, value: (l: Line) => c.value(l.s) })),
    ])
    audit('export', 'attendance', null, `Exported attendance register ${fmtMonth(month)} (${deptLabel}, CSV)`)
  }

  const pdf = async () => {
    setExporting(true)
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      pdfHeader(doc, `Attendance register — ${fmtMonth(month)}`, `${deptLabel} · ${shown.length} employees`)
      const head = [['Employee', ...dates.map((d) => `${Number(d.slice(8))}\n${WEEKDAYS[dayOfWeek(d)]!.slice(0, 2)}`), ...SUMMARY.map((c) => c.label)]]
      const body = shown.map((l) => [`${fullName(l.emp)}\n${l.emp.emp_code}`, ...dates.map((d) => cellCode(l, d)), ...SUMMARY.map((c) => num(c.value(l.s)))])
      autoTable(doc, {
        startY: 104,
        head,
        body,
        foot: [['Total', ...dates.map(() => ''), ...totals.map((t) => num(t))]],
        styles: { fontSize: 6, cellPadding: 1.6, halign: 'center', valign: 'middle', textColor: [30, 43, 92], lineColor: [226, 232, 248], lineWidth: 0.4 },
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold', fontSize: 5.5 },
        footStyles: { fillColor: [238, 242, 255], textColor: [30, 43, 92], fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'left', cellWidth: 78, fontSize: 6.5 } },
        margin: { left: 24, right: 24, bottom: 50 },
        didParseCell: (data) => {
          const col = data.column.index
          if (data.section === 'head' && col >= 1 && col <= dates.length && closed(dates[col - 1]!)) data.cell.styles.fillColor = [129, 140, 248]
          if (data.section !== 'body' || col < 1 || col > dates.length) return
          const info = shown[data.row.index]!.s.days[col - 1]!
          const m = DAY_STATUS_META[info.status]
          if (m.bg !== 'transparent') data.cell.styles.fillColor = hexRgb(m.bg)
          data.cell.styles.textColor = hexRgb(m.color)
          data.cell.styles.fontStyle = 'bold'
        },
        didDrawPage: () => pdfFooter(doc),
      })
      let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120) + 14
      const W = doc.internal.pageSize.getWidth()
      if (y > doc.internal.pageSize.getHeight() - 70) {
        doc.addPage()
        pdfFooter(doc)
        y = 50
      }
      doc.setFontSize(7)
      doc.setTextColor(85, 98, 143)
      const legend = (['present', 'on_duty', 'half_day', 'absent', 'leave', 'half_leave', 'unpaid_leave', 'holiday', 'week_off'] as const).map((k) => `${DAY_STATUS_META[k].short} ${DAY_STATUS_META[k].label}`).join('  ·  ')
      doc.text(`${legend}  ·  * late mark  ·  ${policy.late_marks_per_half_day} late marks = 1/2 day LOP  ·  OT h = approved overtime${isCurrent ? '  ·  Current month: remaining days counted as paid (projected)' : ''}`, 24, y, { maxWidth: W - 48 })
      doc.save(`attendance-register-${month}.pdf`)
      audit('export', 'attendance', null, `Exported attendance register ${fmtMonth(month)} (${deptLabel}, PDF)`)
    } catch (e) {
      toast.error('Could not create PDF', e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthNav month={month} onChange={setMonth} max={currentMonth()} />
        <input type="month" value={month} max={currentMonth()} onChange={(e) => e.target.value && e.target.value <= currentMonth() && setMonth(e.target.value)} className="field-input h-9 w-[150px] py-0 text-sm" aria-label="Month" />
        {loading && (
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin text-brand-indigo" /> Loading older punches…
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={csv} disabled={!shown.length}>
            CSV
          </Button>
          <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => void pdf()} loading={exporting} disabled={!shown.length}>
            PDF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code…" className="field-input h-10 py-0 pl-9 text-sm" type="search" />
        </div>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="h-10 w-auto min-w-[170px] py-0 text-sm" aria-label="Department" />
      </div>

      {!shown.length ? (
        <EmptyState title="No employees" description="Nobody matches these filters for this month." />
      ) : (
        <div className={cn('overflow-x-auto rounded-2xl border border-indigo-100/80 bg-white/90 scroll-thin transition-opacity', loading && 'opacity-60')}>
          <table className="border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 min-w-[150px] border-b border-r border-indigo-100 bg-indigo-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft sm:min-w-[200px]">Employee</th>
                {dates.map((d) => {
                  const hol = ctx.holidays.get(d)
                  return (
                    <th key={d} title={hol ? hol.name : undefined} className={cn('min-w-[30px] border-b border-indigo-100 px-0.5 py-1.5 text-center font-semibold', closed(d) ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50/60 text-ink-soft', d === today && 'bg-indigo-200/60 text-ink')}>
                      <span className="block text-[11.5px] leading-tight">{Number(d.slice(8))}</span>
                      <span className={cn('block text-[9.5px] uppercase leading-tight', hol ? 'text-sky-600' : '')}>{WEEKDAYS[dayOfWeek(d)]!.slice(0, 2)}</span>
                    </th>
                  )
                })}
                {SUMMARY.map((c, i) => (
                  <th key={c.key} title={c.title} className={cn('min-w-[44px] border-b border-indigo-100 bg-indigo-50 px-1.5 py-2 text-center text-[11px] font-semibold uppercase text-ink-soft', i === 0 && 'border-l')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.emp.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-indigo-50 bg-white px-3 py-1.5 group-hover:bg-indigo-50">
                    <p className="max-w-[130px] truncate font-semibold text-ink sm:max-w-[180px]">{fullName(l.emp)}</p>
                    <p className="text-[10.5px] text-ink-faint">{l.emp.emp_code}</p>
                  </td>
                  {l.s.days.map((info) => {
                    const m = DAY_STATUS_META[info.status]
                    const canEdit = manage && info.status !== 'not_employed' && info.date <= today
                    return (
                      <td key={info.date} className={cn('border-b border-indigo-50 p-[2px] text-center', closed(info.date) && 'bg-slate-50/80')}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => onMark({ employeeId: l.emp.id, date: info.date })}
                          title={`${fmtDate(info.date)} · ${m.label}${info.holiday ? ` (${info.holiday.name})` : ''}${info.leaveType ? ` · ${info.leaveType.name}` : ''}${info.late ? ' · late' : ''}${info.record?.check_in ? ` · in ${new Date(info.record.check_in).toTimeString().slice(0, 5)}` : ''}`}
                          className={cn('relative grid h-7 w-full min-w-[26px] place-items-center rounded-md text-[10px] font-bold', canEdit && 'hover:ring-2 hover:ring-brand-indigo/40', info.date === today && 'ring-1 ring-brand-indigo')}
                          style={{ background: m.bg, color: m.color }}
                        >
                          {m.short}
                          {info.late && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                        </button>
                      </td>
                    )
                  })}
                  {SUMMARY.map((c, i) => (
                    <td key={c.key} className={cn('num border-b border-indigo-50 px-1.5 text-center', c.tone, i === 0 && 'border-l border-l-indigo-100')}>
                      {num(c.value(l.s))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 border-r border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Total · {shown.length}</td>
                {dates.map((d) => (
                  <td key={d} className="bg-indigo-50/60" />
                ))}
                {totals.map((t, i) => (
                  <td key={SUMMARY[i]!.key} className={cn('num bg-indigo-50 px-1.5 py-2 text-center font-bold text-ink', i === 0 && 'border-l border-l-indigo-100')}>
                    {num(t)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2 text-[12px] text-ink-soft sm:flex-row sm:items-start sm:justify-between">
        <StatusLegend statuses={['present', 'on_duty', 'half_day', 'absent', 'leave', 'half_leave', 'unpaid_leave', 'holiday', 'week_off', 'today']} />
        <p className="shrink-0 sm:max-w-xs sm:text-right">
          {policy.late_marks_per_half_day} late marks = ½ day LOP · OT counts only once approved.
          {isCurrent && ' Remaining days this month are counted as paid (projected).'}
        </p>
      </div>
    </div>
  )
}

function cellCode(l: Line, date: string): string {
  const info = l.s.days.find((d) => d.date === date)
  if (!info) return ''
  const code = DAY_STATUS_META[info.status].short
  return info.late ? `${code}*` : code
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
