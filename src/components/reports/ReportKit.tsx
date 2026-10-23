/**
 * Building blocks shared by every report: frame (title, filters, print), KPI grid, chart card,
 * donut, and a table card whose CSV / PDF exports include totals + KPIs and are audited.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { CalendarRange, Download, FileText, Info, Printer } from 'lucide-react'
import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import { useTable } from '@/data/store'
import type { ISODate, YearMonth } from '@/data/types'
import { Button, Card, CardHeader, DataTable, Field, Input, Segmented, Select, StatCard, toast, type Column } from '@/components/ui'
import { ChartBox, Legend, tooltipProps } from '@/components/charts'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { exportCsv, pdfFooter, pdfHeader } from '@/lib/export'
import { fmtDateTime, fmtMonth, fyLabel } from '@/lib/dates'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { audit } from '@/services/audit'
import { presetRange, type DateRange, type RangePreset, type ReportDef } from '@/services/reports'
import { COMPANY } from '@/config/company'

/* ── report context (title / period for exports) ─────────────────────────── */

interface ReportCtx {
  title: string
  period: string
  fileTag: string
  summary: [string, string][]
}
const Ctx = createContext<ReportCtx>({ title: 'Report', period: '', fileTag: '', summary: [] })

export type Accent = 'indigo' | 'cyan' | 'pink' | 'green' | 'amber' | 'red'

export interface Kpi {
  label: string
  value: number
  format?: (n: number) => string
  icon?: ReactNode
  accent?: Accent
  hint?: ReactNode
  /** Plain text used in PDF exports (defaults to format(value)). */
  text?: string
}

/* ── PDF-safe text (jsPDF core fonts have no ₹ / ≤ / smart quotes) ───────── */

const PDF_MAP: [RegExp, string][] = [
  [/₹\s?/g, 'Rs '], [/[—–−]/g, '-'], [/≤/g, '<='], [/≥/g, '>='], [/…/g, '...'], [/[‘’]/g, "'"], [/[“”]/g, '"'], [/→/g, '->'], [/÷/g, '/'],
]
export function pdfSafe(s: string): string {
  let out = s
  for (const [re, rep] of PDF_MAP) out = out.replace(re, rep)
  // drop anything outside Latin-1 that the core fonts cannot draw
  return out.replace(/[^\x00-\xFF]/g, '')
}
const pdfNum = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
type CellValue = string | number | null | undefined
const pdfCell = (v: CellValue) => (v == null ? '' : typeof v === 'number' ? pdfNum.format(v) : pdfSafe(v))
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Branded A4 PDF for a report table: KPI strip, font scaled to the column count (wide registers stay
 * on one line per row), totals as a bold footer on the last page.
 */
async function exportReportPdf(o: {
  filename: string
  title: string
  subtitle: string
  head: string[]
  aligns: ('left' | 'right' | 'center')[]
  body: string[][]
  foot: string[] | null
  summary: [string, string][]
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const n = o.head.length
  const doc = new jsPDF({ orientation: n > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  pdfHeader(doc, o.title, o.subtitle)
  let y = 108
  if (o.summary.length) {
    const perRow = n > 7 ? 5 : 4
    doc.setFontSize(8.5)
    o.summary.forEach(([k, v], i) => {
      const x = 40 + (i % perRow) * ((W - 80) / perRow)
      const yy = y + Math.floor(i / perRow) * 30
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(85, 98, 143)
      doc.text(k.toUpperCase(), x, yy)
      doc.setTextColor(30, 43, 92)
      doc.setFont('helvetica', 'bold')
      doc.text(v, x, yy + 13, { maxWidth: (W - 80) / perRow - 8 })
    })
    doc.setFont('helvetica', 'normal')
    y += Math.ceil(o.summary.length / perRow) * 30 + 6
  }
  const fontSize = n > 18 ? 6 : n > 14 ? 6.5 : n > 10 ? 7.2 : 8
  autoTable(doc, {
    startY: y,
    head: [o.head],
    body: o.body,
    foot: o.foot ? [o.foot] : undefined,
    showFoot: 'lastPage',
    styles: { fontSize, cellPadding: n > 14 ? 2.5 : 4, textColor: [30, 43, 92], lineColor: [226, 232, 248], lineWidth: 0.5, overflow: 'linebreak' },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [238, 242, 255], textColor: [30, 43, 92], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 255] },
    columnStyles: Object.fromEntries(o.aligns.map((a, i) => [i, { halign: a }])),
    margin: { left: 40, right: 40, bottom: 50 },
    didDrawPage: () => pdfFooter(doc),
  })
  doc.save(o.filename.endsWith('.pdf') ? o.filename : o.filename + '.pdf')
}

/* ── frame ───────────────────────────────────────────────────────────────── */

export function ReportFrame({
  def, icon, groupLabel, period, fileTag, filters, kpis, notes, children,
}: {
  def: ReportDef
  icon: ReactNode
  groupLabel: string
  /** Human-readable period + filters, e.g. 'September 2026 · All departments'. Printed and used in exports. */
  period: string
  /** Short tag for export file names, e.g. '2026-09'. */
  fileTag: string
  filters?: ReactNode
  kpis?: Kpi[]
  notes?: ReactNode
  children: ReactNode
}) {
  const summary = useMemo<[string, string][]>(
    () => (kpis ?? []).map((k) => [k.label, k.text ?? (k.format ? k.format(k.value) : num(k.value))]),
    [kpis],
  )
  const generated = fmtDateTime(new Date().toISOString())
  return (
    <Ctx.Provider value={{ title: def.title, period, fileTag, summary }}>
      <div className="space-y-4">
        <Card className="p-4 sm:p-5">
          <p className="mb-2 hidden text-[11px] font-semibold uppercase tracking-wider text-ink-soft print:block">{COMPANY.legal_name}</p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="mt-0.5 shrink-0 text-brand-600 print:hidden [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
              <div className="min-w-0">
                <p className="kicker">{groupLabel} report</p>
                <h2 className="text-[18px] font-semibold leading-tight text-ink sm:text-[20px]">{def.title}</h2>
                <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-soft">{def.description}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="no-print shrink-0" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </div>
          {filters && <div className="no-print mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">{filters}</div>}
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-soft">
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-brand-600" />
            <span className="font-semibold text-ink">{period}</span>
            <span className="text-ink-faint">· Generated {generated}</span>
          </p>
        </Card>
        {!!kpis?.length && <KpiGrid kpis={kpis} />}
        {children}
        {notes && (
          <div className="flex gap-2.5 rounded-lg border border-line bg-white px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <div className="min-w-0 space-y-1">{notes}</div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="print-avoid grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
      {kpis.map((k) => (
        <div key={k.label} className="min-w-0">
          <StatCard label={k.label} value={k.value} format={k.format} icon={k.icon} accent={k.accent} hint={k.hint} className="h-full" />
        </div>
      ))}
    </div>
  )
}

/* ── cards ───────────────────────────────────────────────────────────────── */

export function ChartCard({ title, subtitle, actions, children, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('print-avoid min-w-0', className)}>
      <CardHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="min-w-0 px-2 pb-4 pt-3 sm:px-4">{children}</div>
    </Card>
  )
}

export function ChartEmpty({ text = 'No data for this period.' }: { text?: string }) {
  return <div className="grid h-[180px] place-items-center rounded-lg border border-dashed border-line text-[13px] text-ink-faint">{text}</div>
}

export interface Slice {
  label: string
  value: number
  color: string
}

/** Donut + legend, stacked on phones. */
export function Donut({ data, format = (n) => num(n), height = 200, center }: { data: Slice[]; format?: (n: number) => string; height?: number; center?: ReactNode }) {
  const shown = data.filter((d) => d.value > 0)
  if (!shown.length) return <ChartEmpty />
  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="relative mx-auto w-full max-w-[220px] min-w-0">
        <ChartBox height={height}>
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
              {shown.map((d) => (
                <Cell key={d.label} fill={d.color} />
              ))}
            </Pie>
            <Tooltip {...tooltipProps} formatter={(v) => format(Number(v))} />
          </PieChart>
        </ChartBox>
        {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
      </div>
      <div className="min-w-0">
        <Legend items={shown.map((d) => ({ label: d.label, value: format(d.value), color: d.color }))} />
      </div>
    </div>
  )
}

/* ── table card with audited exports ─────────────────────────────────────── */

export type RCol<T> = Column<T> & {
  /** Show this column's value in the totals row. */
  total?: boolean
}

export function ReportTable<T>({
  title, subtitle, rows, columns, rowKey, searchText, searchPlaceholder, totalsRow, toolbar, initialSort, mobileCard, pageSize = 100, empty, onRowClick, exportLabel,
}: {
  title: string
  subtitle?: ReactNode
  rows: T[]
  columns: RCol<T>[]
  rowKey: (r: T) => string
  searchText?: (r: T) => string
  searchPlaceholder?: string
  /** Row of summed values; rendered as a footer and appended to exports. */
  totalsRow?: T
  toolbar?: ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  mobileCard?: (r: T) => ReactNode
  pageSize?: number
  empty?: ReactNode
  onRowClick?: (r: T) => void
  /** Overrides the table part of the export title. */
  exportLabel?: string
}) {
  const ctx = useContext(Ctx)
  const mobile = useIsMobile()
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)
  const value = (c: RCol<T>, r: T): CellValue => (c.exportValue ?? c.value)?.(r)

  const doExport = async (kind: 'csv' | 'pdf') => {
    const cols = columns.filter((c) => c.export !== false && (c.exportValue || c.value))
    const matrix: CellValue[][] = rows.map((r) => cols.map((c) => value(c, r)))
    const totals: CellValue[] | null = totalsRow ? cols.map((c, i) => (i === 0 ? 'Total' : c.total ? value(c, totalsRow) : '')) : null
    const part = exportLabel ?? title
    const fullTitle = part && part !== ctx.title ? `${ctx.title} — ${part}` : ctx.title
    const fileName = [slug(ctx.title), part !== ctx.title ? slug(part) : '', ctx.fileTag].filter(Boolean).join('_')
    setBusy(kind)
    try {
      if (kind === 'csv') {
        exportCsv(fileName, totals ? [...matrix, totals] : matrix, cols.map((c, i) => ({ header: c.header, value: (r: CellValue[]) => r[i] })))
      } else {
        await exportReportPdf({
          filename: fileName,
          title: pdfSafe(fullTitle),
          subtitle: pdfSafe(ctx.period),
          head: cols.map((c) => pdfSafe(c.header)),
          aligns: cols.map((c) => c.align ?? 'left'),
          body: matrix.map((r) => r.map(pdfCell)),
          foot: totals ? totals.map(pdfCell) : null,
          summary: ctx.summary.map(([k, v]) => [pdfSafe(k), pdfSafe(v)]),
        })
      }
      audit('export', 'reports', null, `Exported ${fullTitle} (${ctx.period}) as ${kind.toUpperCase()}`)
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const totalCols = totalsRow ? columns.filter((c, i) => i > 0 && c.total) : []
  const footer =
    totalsRow && rows.length ? (
      <tr className="border-t-2 border-line bg-slate-50 font-semibold">
        {columns.map((c, i) => (
          <td key={c.key} className={cn('whitespace-nowrap px-3.5 py-2.5 text-ink', c.align === 'right' ? 'num text-right' : c.align === 'center' ? 'text-center' : 'text-left')}>
            {i === 0 ? 'Total' : c.total ? (c.cell ? c.cell(totalsRow) : String(value(c, totalsRow) ?? '')) : ''}
          </td>
        ))}
      </tr>
    ) : undefined

  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="no-print flex gap-1.5">
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} loading={busy === 'csv'} disabled={!rows.length || !!busy} onClick={() => void doExport('csv')} title="Export CSV">
              CSV
            </Button>
            <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} loading={busy === 'pdf'} disabled={!rows.length || !!busy} onClick={() => void doExport('pdf')} title="Export PDF">
              PDF
            </Button>
          </div>
        }
      />
      <div className="min-w-0 px-3 pb-4 pt-3 sm:px-5 sm:pb-5">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={rowKey}
          searchText={searchText}
          searchPlaceholder={searchPlaceholder}
          toolbar={toolbar}
          initialSort={initialSort}
          mobileCard={mobileCard}
          pageSize={pageSize}
          empty={empty}
          onRowClick={onRowClick}
          footer={mobile ? undefined : footer}
          dense
        />
        {mobile && totalsRow && rows.length > 0 && totalCols.length > 0 && (
          <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3.5">
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">Totals</p>
            <div className="space-y-1">
              {totalCols.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-ink-soft">{c.header}</span>
                  <span className="num font-semibold text-ink">{c.cell ? c.cell(totalsRow) : String(value(c, totalsRow) ?? '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ── filters ─────────────────────────────────────────────────────────────── */

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Field label={label} className={cn('w-full xs:w-auto xs:min-w-[180px]', className)}>
      {children}
    </Field>
  )
}

export function MonthFilter({ value, onChange, months, label = 'Month' }: { value: YearMonth; onChange: (m: YearMonth) => void; months: YearMonth[]; label?: string }) {
  const opts = months.includes(value) ? months : [value, ...months]
  return (
    <FilterField label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} options={opts.map((m) => ({ value: m, label: fmtMonth(m) }))} className="h-10 py-0 text-sm" />
    </FilterField>
  )
}

export function FyFilter({ value, onChange, years }: { value: number; onChange: (y: number) => void; years: number[] }) {
  return (
    <FilterField label="Financial year">
      <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))} options={years.map((y) => ({ value: String(y), label: `FY ${fyLabel(y)}` }))} className="h-10 py-0 text-sm" />
    </FilterField>
  )
}

export function DeptFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const depts = useTable('departments')
  const options = useMemo(() => [...depts].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name })), [depts])
  return (
    <FilterField label="Department">
      <Select value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder="All departments" className="h-10 py-0 text-sm" />
    </FilterField>
  )
}

export function useDeptName() {
  const depts = useTable('departments')
  return useMemo(() => {
    const m = new Map(depts.map((d) => [d.id, d.name]))
    return (id: string) => (id ? m.get(id) ?? '—' : 'All departments')
  }, [depts])
}

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'fy', label: 'FY to date' },
]

/** Date-range state with presets; switching to a manual date marks it 'custom'. */
export function useDateRange(initial: Exclude<RangePreset, 'custom'>, today: ISODate, fyStartMonth: number) {
  const [preset, setPresetState] = useState<RangePreset>(initial)
  const [range, setRangeState] = useState<DateRange>(() => presetRange(initial, today, fyStartMonth))
  return {
    preset,
    range,
    setPreset: (p: RangePreset) => {
      setPresetState(p)
      if (p !== 'custom') setRangeState(presetRange(p, today, fyStartMonth))
    },
    setRange: (r: DateRange) => {
      setPresetState('custom')
      setRangeState(r.from > r.to ? { from: r.from, to: r.from } : r)
    },
  }
}

export function RangeFilter({ state }: { state: ReturnType<typeof useDateRange> }) {
  const { preset, range, setPreset, setRange } = state
  return (
    <>
      <div className="w-full min-w-0 sm:w-auto">
        <span className="label">Period</span>
        <Segmented size="sm" value={preset === 'custom' ? ('' as RangePreset) : preset} onChange={setPreset} options={PRESETS} />
      </div>
      <FilterField label="From" className="xs:min-w-[150px]">
        <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ from: e.target.value, to: range.to })} className="h-10 py-0 text-sm" />
      </FilterField>
      <FilterField label="To" className="xs:min-w-[150px]">
        <Input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ from: range.from, to: e.target.value })} className="h-10 py-0 text-sm" />
      </FilterField>
    </>
  )
}

/* ── small presentational helpers ────────────────────────────────────────── */

/** Props every report view receives from the hub. */
export interface ReportProps {
  def: ReportDef
  icon: ReactNode
  groupLabel: string
}

/** A copy of `base` with the listed numeric fields summed over `rows` (for totals rows). */
export function totalOf<T extends object>(rows: T[], base: T, keys: (keyof T)[]): T {
  const out = { ...base }
  for (const k of keys) {
    let s = 0
    for (const r of rows) s += Number(r[k]) || 0
    ;(out as Record<keyof T, unknown>)[k] = Math.round(s * 100) / 100
  }
  return out
}

/** Colour key for multi-series charts. */
export function SeriesKey({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[12px] font-medium text-ink-soft">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', i.dashed && 'h-0.5 w-3.5 rounded-none')} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** used / entitled with a thin bar. */
export function UsageCell({ used, of, pending }: { used: number; of: number; pending?: number }) {
  const pctv = of > 0 ? Math.min(100, (used / of) * 100) : used > 0 ? 100 : 0
  return (
    <span className="inline-flex min-w-[78px] flex-col items-end gap-1">
      <span className="num text-[13px] text-ink">
        <b className="font-semibold">{num(used)}</b>
        <span className="text-ink-faint">/{num(of)}</span>
        {!!pending && <span className="ml-1 text-[11px] font-semibold text-amber-600">+{num(pending)}</span>}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-slate-200/80">
        <span className={cn('block h-full rounded-full', pctv >= 90 ? 'bg-red-500' : pctv >= 60 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pctv}%` }} />
      </span>
    </span>
  )
}

/** Inline mini progress for percentages in tables. */
export function PctBar({ value, good = 'high' }: { value: number; good?: 'high' | 'low' }) {
  const v = Math.max(0, Math.min(100, value))
  const ok = good === 'high' ? v >= 90 : v <= 2
  const warn = good === 'high' ? v >= 70 : v <= 5
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-200/80 sm:block">
        <span className={cn('block h-full rounded-full', ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-rose-400')} style={{ width: `${v}%` }} />
      </span>
      <span className="num">{value.toFixed(1)}%</span>
    </span>
  )
}

/** Print-only tweaks while the reports page is mounted (hides app chrome, un-clips wide tables). */
export function ReportPrintStyles() {
  return (
    <style>{`
@media print {
  @page { size: A4; margin: 12mm; }
  header.sticky, nav[aria-label="Quick navigation"], aside { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  [data-report-root] .overflow-x-auto { overflow: visible !important; }
  [data-report-root] table { min-width: 0 !important; font-size: 10px; }
  [data-report-root] td, [data-report-root] th { padding: 4px 6px !important; }
  [data-report-root] input[type="search"] { display: none !important; }
  [data-report-root] .print-avoid { break-inside: avoid; }
}
`}</style>
  )
}
