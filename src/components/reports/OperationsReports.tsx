/** Operations reports: downtime & MTTR, PM compliance, inventory, tool crib, calibration, purchase, work orders, quality. */
import { useMemo, useState } from 'react'
import {
  Activity, BadgeIndianRupee, Boxes, CalendarClock, CircleAlert, ClipboardCheck, Factory, Gauge, Hammer, Hourglass, PackageSearch, Percent, ShieldCheck,
  ShoppingCart, Timer, TriangleAlert, Truck, Wrench,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts'
import { useSettings, useTable } from '@/data/store'
import type { Machine } from '@/data/types'
import { fmtDate, fmtDuration, fyOf, fyRange, todayISO } from '@/lib/dates'
import { inr, inrCompact, num, pct, plural, round2, titleCase } from '@/lib/format'
import { useLookups } from '@/hooks/useLookups'
import { EmployeeCell } from '@/components/EmployeeCell'
import { Badge, Segmented, Select, StatusBadge } from '@/components/ui'
import { ChartBox, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'
import {
  ITEM_CATEGORY_LABEL, calibrationDue, downtimeByMachine, fyText, fyWindow, inventoryValuation, pmCompliance, purchaseByVendor, qualityReport,
  rangeLabel, recentFys, toolCrib, workOrderReport,
  type CalRow, type DeliveryState, type DowntimeRow, type NcrRow, type PartQuality, type PmRow, type QualityMonth, type StockRow, type ToolRow, type VendorRow, type WoRow,
} from '@/services/reports'
import {
  ChartCard, ChartEmpty, Donut, FyFilter, PctBar, RangeFilter, ReportFrame, ReportTable, SeriesKey, totalOf, useDateRange, type RCol, type ReportProps,
} from './ReportKit'

const hrs = (min: number) => round2(min / 60)
const hrsText = (min: number) => (min ? `${num(min / 60, 1)} h` : '—')
const short = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function MachineCell({ m }: { m: Machine }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate font-semibold text-ink">{m.name}</span>
      <span className="block truncate text-[12px] text-ink-soft">{m.asset_code}</span>
    </span>
  )
}

/* ═════════════════════════ 12. Downtime & MTTR ═════════════════════════ */

export function DowntimeView(p: ReportProps) {
  const logs = useTable('maintenance_logs')
  const machines = useTable('machines')
  const settings = useSettings()
  const L = useLookups()
  const today = todayISO()
  const rs = useDateRange('fy', today, settings.financial_year_start_month || 4)
  const [show, setShow] = useState<'active' | 'all'>('active')
  const d = useMemo(() => downtimeByMachine(logs, machines, rs.range), [logs, machines, rs.range])
  const active = d.rows.filter((r) => r.breakdowns || r.preventive || r.other)
  const rows = show === 'active' ? active : d.rows
  const chart = [...active].sort((a, b) => b.total_min - a.total_min).map((r) => ({ name: r.machine.asset_code, label: r.machine.name, breakdown: hrs(r.breakdown_min), preventive: hrs(r.preventive_min), other: hrs(r.other_min) }))
  const totals: DowntimeRow = { id: 'total', machine: {} as Machine, ...d.totals, mttr_min: d.totals.mttr_min }

  const cols: RCol<DowntimeRow>[] = [
    { key: 'machine', header: 'Machine', value: (r) => r.machine.asset_code, exportValue: (r) => `${r.machine.asset_code} — ${r.machine.name}`, cell: (r) => <MachineCell m={r.machine} /> },
    { key: 'wc', header: 'Work centre', value: (r) => L.wcName(r.machine.work_centre_id), hideOnMobile: true, className: 'max-w-[150px] truncate' },
    { key: 'crit', header: 'Crit.', align: 'center', value: (r) => r.machine.criticality, hideOnMobile: true, cell: (r) => <Badge tone={r.machine.criticality === 'A' ? 'red' : r.machine.criticality === 'B' ? 'amber' : 'slate'}>{r.machine.criticality}</Badge> },
    { key: 'bd', header: 'Breakdowns', align: 'right', value: (r) => r.breakdowns, total: true, cell: (r) => (r.breakdowns ? <span className="font-semibold text-rose-600">{r.breakdowns}</span> : '0') },
    { key: 'bd_h', header: 'Breakdown h', align: 'right', value: (r) => hrs(r.breakdown_min), total: true, cell: (r) => hrsText(r.breakdown_min) },
    { key: 'mttr', header: 'MTTR', align: 'right', value: (r) => r.mttr_min, exportValue: (r) => (r.mttr_min == null ? '' : fmtDuration(r.mttr_min)), total: true, cell: (r) => (r.mttr_min == null ? '—' : fmtDuration(r.mttr_min)) },
    { key: 'pm', header: 'PM jobs', align: 'right', value: (r) => r.preventive, total: true },
    { key: 'pm_h', header: 'PM h', align: 'right', value: (r) => hrs(r.preventive_min), total: true, cell: (r) => hrsText(r.preventive_min), hideOnMobile: true },
    { key: 'oth', header: 'Other jobs', align: 'right', value: (r) => r.other, total: true, hideOnMobile: true },
    { key: 'tot_h', header: 'Total downtime h', align: 'right', value: (r) => hrs(r.total_min), total: true, cell: (r) => <b>{hrsText(r.total_min)}</b> },
    { key: 'cost', header: 'Cost', align: 'right', value: (r) => r.cost, total: true, cell: (r) => (r.cost ? inr(r.cost) : '—'), hideOnMobile: true },
    { key: 'open', header: 'Open', align: 'right', value: (r) => r.open, total: true, cell: (r) => (r.open ? <Badge tone="amber">{r.open}</Badge> : '0') },
  ]

  return (
    <ReportFrame
      {...p}
      period={rangeLabel(rs.range)}
      fileTag={`${rs.range.from}_${rs.range.to}`}
      filters={<RangeFilter state={rs} />}
      kpis={[
        { label: 'Breakdowns', value: d.totals.breakdowns, icon: <TriangleAlert className="h-4 w-4" />, accent: 'red', hint: d.totals.open ? `${plural(d.totals.open, 'job')} still open` : 'All closed' },
        { label: 'Breakdown downtime', value: d.totals.breakdown_min, format: fmtDuration, icon: <Timer className="h-4 w-4" />, accent: 'pink', hint: `${plural(active.length, 'machine')} with maintenance` },
        { label: 'MTTR', value: d.totals.mttr_min ?? 0, format: (v) => (d.totals.mttr_min == null ? '—' : fmtDuration(v)), icon: <Activity className="h-4 w-4" />, accent: 'amber', hint: 'Mean time to repair (closed breakdowns)' },
        { label: 'PM jobs done', value: d.totals.preventive, icon: <Wrench className="h-4 w-4" />, accent: 'green', hint: `${fmtDuration(d.totals.preventive_min)} planned downtime` },
        { label: 'Maintenance cost', value: d.totals.cost, format: inr, icon: <BadgeIndianRupee className="h-4 w-4" />, accent: 'indigo', hint: 'Spares & services booked' },
      ]}
      notes={<p>Downtime is the recorded downtime of closed jobs, by the date each job was reported. MTTR = breakdown downtime ÷ closed breakdowns. Jobs still open are counted under “Open” and excluded from downtime until closed. “Other” covers corrective and calibration jobs.</p>}
    >
      <ChartCard title="Downtime by machine" subtitle="Hours, breakdown vs preventive">
        {chart.length ? (
          <>
            <SeriesKey items={[{ label: 'Breakdown', color: '#c94a4a' }, { label: 'Preventive', color: SERIES[0]! }, { label: 'Other', color: '#d08c1e' }]} />
            <ChartBox height={Math.max(180, chart.length * 28 + 30)}>
              <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} unit=" h" />
                <YAxis type="category" dataKey="name" {...axisProps} width={86} />
                <Tooltip {...tooltipProps} formatter={(v) => `${num(Number(v), 1)} h`} labelFormatter={(_, pl) => (pl?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} />
                <Bar dataKey="breakdown" name="Breakdown" stackId="a" fill="#c94a4a" maxBarSize={18} />
                <Bar dataKey="preventive" name="Preventive" stackId="a" fill={SERIES[0]} maxBarSize={18} />
                <Bar dataKey="other" name="Other" stackId="a" fill="#d08c1e" radius={[0, 2, 2, 0]} maxBarSize={18} />
              </BarChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text="No maintenance jobs in this period." />
        )}
      </ChartCard>
      <ReportTable
        title="Machine-wise downtime"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={totals}
        initialSort={{ key: 'tot_h', dir: 'desc' }}
        searchText={(r) => `${r.machine.asset_code} ${r.machine.name} ${L.wcName(r.machine.work_centre_id)}`}
        toolbar={<Segmented size="sm" className="no-print" value={show} onChange={setShow} options={[{ value: 'active', label: `With jobs (${active.length})` }, { value: 'all', label: `All machines (${d.rows.length})` }]} />}
        empty={<ChartEmpty text="No maintenance jobs in this period." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 13. PM compliance ═════════════════════════ */

const PM_META = {
  overdue: { label: 'Overdue', tone: 'red', color: '#c94a4a' },
  due_soon: { label: 'Due ≤ 7 days', tone: 'amber', color: '#d08c1e' },
  on_track: { label: 'On track', tone: 'green', color: '#3a8f5c' },
} as const

export function PmComplianceView(p: ReportProps) {
  const schedules = useTable('maintenance_schedules')
  const logs = useTable('maintenance_logs')
  const machines = useTable('machines')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const L = useLookups()
  const today = todayISO()
  const fy = fyOf(today, fyStart)
  const fyFrom = fyRange(fy, fyStart).from
  const d = useMemo(() => pmCompliance(schedules, logs, machines, today, fyFrom), [schedules, logs, machines, today, fyFrom])
  const [show, setShow] = useState<'all' | 'overdue' | 'due_soon'>('all')
  const rows = show === 'all' ? d.rows : d.rows.filter((r) => r.state === show)
  const byWc = useMemo(() => {
    const ids = [...new Set(d.rows.map((r) => r.machine?.work_centre_id ?? ''))]
    return ids
      .map((id) => {
        const mine = d.rows.filter((r) => (r.machine?.work_centre_id ?? '') === id)
        return { name: short(L.wcName(id), 18), on_track: mine.filter((r) => r.state === 'on_track').length, due_soon: mine.filter((r) => r.state === 'due_soon').length, overdue: mine.filter((r) => r.state === 'overdue').length }
      })
      .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name))
  }, [d.rows, L])

  const cols: RCol<PmRow>[] = [
    { key: 'machine', header: 'Machine', value: (r) => r.machine?.asset_code ?? '—', exportValue: (r) => (r.machine ? `${r.machine.asset_code} — ${r.machine.name}` : '—'), cell: (r) => (r.machine ? <MachineCell m={r.machine} /> : '—') },
    { key: 'title', header: 'Schedule', value: (r) => r.schedule.title, className: 'max-w-[220px]', cell: (r) => <span className="line-clamp-2">{r.schedule.title}</span> },
    { key: 'freq', header: 'Frequency', value: (r) => titleCase(r.schedule.frequency), hideOnMobile: true },
    { key: 'last', header: 'Last done', value: (r) => r.schedule.last_done ?? '', cell: (r) => fmtDate(r.schedule.last_done), hideOnMobile: true },
    { key: 'next', header: 'Next due', value: (r) => r.schedule.next_due, cell: (r) => fmtDate(r.schedule.next_due) },
    {
      key: 'state', header: 'Status', value: (r) => r.days, exportValue: (r) => (r.state === 'overdue' ? `Overdue by ${-r.days} d` : r.state === 'due_soon' ? `Due in ${r.days} d` : 'On track'),
      cell: (r) => <Badge tone={PM_META[r.state].tone} dot>{r.state === 'overdue' ? `Overdue ${-r.days} d` : r.state === 'due_soon' ? (r.days === 0 ? 'Due today' : `Due in ${r.days} d`) : 'On track'}</Badge>,
    },
    { key: 'done', header: 'Done (FY)', align: 'right', value: (r) => r.done, total: true },
    { key: 'ontime', header: 'On time (FY)', align: 'right', value: (r) => r.onTime, total: true, hideOnMobile: true },
    { key: 'who', header: 'Assigned to', value: (r) => L.empName(r.schedule.assigned_to), hideOnMobile: true, cell: (r) => (r.schedule.assigned_to ? <EmployeeCell id={r.schedule.assigned_to} sub="none" size={24} /> : '—') },
  ]
  const totals = totalOf(d.rows, { ...(d.rows[0] ?? ({} as PmRow)), id: 'total' }, ['done', 'onTime', 'late'])

  return (
    <ReportFrame
      {...p}
      period={`As on ${fmtDate(today)} · history ${fyText(fy)}`}
      fileTag={today}
      kpis={[
        { label: 'Active schedules', value: d.active, icon: <CalendarClock className="h-4 w-4" />, accent: 'indigo', hint: `${d.onTrack} on track` },
        { label: 'Compliance', value: d.compliance, format: (v) => pct(v, 1), icon: <ShieldCheck className="h-4 w-4" />, accent: 'green', hint: 'Schedules not overdue' },
        { label: 'Overdue', value: d.overdue, icon: <TriangleAlert className="h-4 w-4" />, accent: 'red', hint: d.overdue ? 'Past the next-due date' : 'Nothing overdue' },
        { label: 'Due in 7 days', value: d.dueSoon, icon: <Hourglass className="h-4 w-4" />, accent: 'amber', hint: 'Plan these now' },
        { label: 'PMs on time (FY)', value: d.onTimePct, format: (v) => pct(v, 1), icon: <Wrench className="h-4 w-4" />, accent: 'cyan', hint: `${d.onTime} of ${d.done} done on time` },
      ]}
      notes={<p>A PM counts as on time when it was completed within one frequency period (plus a small grace: weekly 1 d, monthly 3 d, quarterly 7 d, half-yearly 14 d, yearly 30 d) of the previous completion.</p>}
    >
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard title="Schedule status" subtitle={`${d.active} active schedules`}>
          <Donut
            data={(['on_track', 'due_soon', 'overdue'] as const).map((k) => ({ label: PM_META[k].label, value: k === 'on_track' ? d.onTrack : k === 'due_soon' ? d.dueSoon : d.overdue, color: PM_META[k].color }))}
            center={<div><p className="text-xl font-semibold text-ink">{pct(d.compliance)}</p><p className="text-[10.5px] text-ink-soft">compliant</p></div>}
          />
        </ChartCard>
        <ChartCard title="By work centre" subtitle="Schedules on track, due soon and overdue">
          {byWc.length ? (
            <ChartBox height={Math.max(180, byWc.length * 30 + 20)}>
              <BarChart data={byWc} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axisProps} width={120} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="on_track" name="On track" stackId="a" fill={PM_META.on_track.color} maxBarSize={18} />
                <Bar dataKey="due_soon" name="Due ≤ 7 days" stackId="a" fill={PM_META.due_soon.color} maxBarSize={18} />
                <Bar dataKey="overdue" name="Overdue" stackId="a" fill={PM_META.overdue.color} radius={[0, 2, 2, 0]} maxBarSize={18} />
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmpty text="No active schedules." />
          )}
        </ChartCard>
      </div>
      <ReportTable
        title="PM schedules"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={d.rows.length ? totals : undefined}
        searchText={(r) => `${r.machine?.asset_code ?? ''} ${r.machine?.name ?? ''} ${r.schedule.title}`}
        toolbar={
          <Segmented
            size="sm"
            className="no-print"
            value={show}
            onChange={setShow}
            options={[{ value: 'all', label: `All (${d.active})` }, { value: 'overdue', label: `Overdue (${d.overdue})` }, { value: 'due_soon', label: `Due ≤ 7 d (${d.dueSoon})` }]}
          />
        }
        empty={<ChartEmpty text="Nothing to show." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 14. Inventory valuation & low stock ═════════════════════════ */

const STOCK_BADGE = { out: { tone: 'red', label: 'Out of stock' }, low: { tone: 'amber', label: 'Low' }, ok: { tone: 'green', label: 'OK' } } as const

export function InventoryView(p: ReportProps) {
  const items = useTable('inventory_items')
  const today = todayISO()
  const d = useMemo(() => inventoryValuation(items), [items])
  const [cat, setCat] = useState('')
  const [show, setShow] = useState<'all' | 'alerts'>('all')
  const rows = d.rows.filter((r) => (!cat || r.item.category === cat) && (show === 'all' || r.state !== 'ok'))
  const totals = useMemo(() => totalOf(rows, { ...(rows[0] ?? ({} as StockRow)), id: 'total' }, ['value', 'shortfall']), [rows])
  const colors = Object.fromEntries(d.byCategory.map((c, i) => [c.category, SERIES[i % SERIES.length]!]))

  const cols: RCol<StockRow>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.item.sku, cell: (r) => <span className="whitespace-nowrap font-semibold">{r.item.sku}</span> },
    { key: 'name', header: 'Item', value: (r) => r.item.name, className: 'max-w-[240px]', cell: (r) => <span className="line-clamp-2">{r.item.name}</span> },
    { key: 'cat', header: 'Category', value: (r) => ITEM_CATEGORY_LABEL[r.item.category], hideOnMobile: true },
    { key: 'loc', header: 'Location', value: (r) => r.item.location || '—', hideOnMobile: true },
    { key: 'qty', header: 'Stock', align: 'right', value: (r) => r.item.stock_qty, cell: (r) => `${num(r.item.stock_qty)} ${r.item.uom}` },
    { key: 'reorder', header: 'Reorder at', align: 'right', value: (r) => r.item.reorder_level, hideOnMobile: true },
    { key: 'cost', header: 'Unit cost', align: 'right', value: (r) => r.item.unit_cost, cell: (r) => inr(r.item.unit_cost), hideOnMobile: true },
    { key: 'value', header: 'Value', align: 'right', value: (r) => r.value, total: true, cell: (r) => <b>{inr(r.value)}</b> },
    { key: 'state', header: 'Status', value: (r) => STOCK_BADGE[r.state].label, cell: (r) => <Badge tone={STOCK_BADGE[r.state].tone} dot>{STOCK_BADGE[r.state].label}</Badge> },
    { key: 'short', header: 'Shortfall', align: 'right', value: (r) => r.shortfall, cell: (r) => (r.shortfall ? `${num(r.shortfall)} ${r.item.uom}` : '—'), hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`Stock as on ${fmtDate(today)}${cat ? ` · ${ITEM_CATEGORY_LABEL[cat as keyof typeof ITEM_CATEGORY_LABEL]}` : ''}${show === 'alerts' ? ' · low & out of stock' : ''}`}
      fileTag={today}
      kpis={[
        { label: 'Stock value', value: d.total, format: inrCompact, text: inr(d.total), icon: <BadgeIndianRupee className="h-4 w-4" />, accent: 'indigo', hint: inr(d.total) },
        { label: 'Active items', value: d.rows.length, icon: <Boxes className="h-4 w-4" />, accent: 'cyan', hint: `${plural(d.byCategory.length, 'category', 'categories')}` },
        { label: 'Low stock', value: d.low, icon: <TriangleAlert className="h-4 w-4" />, accent: 'amber', hint: 'At or below reorder level' },
        { label: 'Out of stock', value: d.out, icon: <CircleAlert className="h-4 w-4" />, accent: 'red', hint: d.out ? 'Raise a PO' : 'None' },
      ]}
      notes={<p>Value = stock quantity × unit cost on the item master. Low stock = quantity at or below the reorder level; shortfall = reorder level − stock.</p>}
    >
      <div className="grid grid-cols-1 gap-4">
        <ChartCard title="Value by category" subtitle="Share of stock value">
          <Donut data={d.byCategory.map((c) => ({ label: c.label, value: c.value, color: colors[c.category]! }))} format={inr} center={<div><p className="text-base font-semibold text-ink">{inrCompact(d.total)}</p><p className="text-[10.5px] text-ink-soft">in stock</p></div>} />
        </ChartCard>
        <ReportTable
          title="Category summary"
          rows={d.byCategory}
          columns={[
            { key: 'label', header: 'Category', value: (c) => c.label, cell: (c) => <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[c.category] }} /><b className="font-semibold">{c.label}</b></span> },
            { key: 'items', header: 'Items', align: 'right', value: (c) => c.items, total: true },
            { key: 'value', header: 'Value', align: 'right', value: (c) => c.value, total: true, cell: (c) => inr(c.value) },
            { key: 'share', header: 'Share', align: 'right', value: (c) => Math.round(c.share * 10) / 10, cell: (c) => pct(c.share, 1) },
            { key: 'alerts', header: 'Alerts', align: 'right', value: (c) => c.alerts, total: true, cell: (c) => (c.alerts ? <Badge tone="amber">{c.alerts}</Badge> : '0') },
          ]}
          rowKey={(c) => c.id}
          totalsRow={totalOf(d.byCategory, { ...(d.byCategory[0] ?? { id: '', category: 'raw_material', label: '', items: 0, value: 0, share: 0, alerts: 0 }), id: 'total' }, ['items', 'value', 'alerts'])}
          exportLabel="Category summary"
        />
      </div>
      <ReportTable
        title="Item-wise stock"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={rows.length ? totals : undefined}
        initialSort={{ key: 'value', dir: 'desc' }}
        searchText={(r) => `${r.item.sku} ${r.item.name} ${r.item.location}`}
        toolbar={
          <div className="no-print flex flex-wrap gap-2">
            <Select value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={d.byCategory.map((c) => ({ value: c.category, label: c.label }))} className="h-10 w-auto min-w-[160px] py-0 text-sm" />
            <Segmented size="sm" value={show} onChange={setShow} options={[{ value: 'all', label: 'All items' }, { value: 'alerts', label: `Low & out (${d.low + d.out})` }]} />
          </div>
        }
        empty={<ChartEmpty text="No items match." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 15. Tool crib ═════════════════════════ */

export function ToolCribView(p: ReportProps) {
  const issues = useTable('tool_issues')
  const items = useTable('inventory_items')
  const L = useLookups()
  const today = todayISO()
  const d = useMemo(() => toolCrib(issues, items, today), [issues, items, today])
  const [show, setShow] = useState<'open' | 'overdue' | 'loss' | 'all'>('open')
  const rows = d.rows.filter((r) => (show === 'all' ? true : show === 'open' ? r.state === 'open' || r.state === 'overdue' : show === 'overdue' ? r.state === 'overdue' : r.state === 'lost' || r.broken))

  const statusBadge = (r: ToolRow) =>
    r.state === 'overdue' ? <Badge tone="red" dot>Overdue {r.overdueDays} d</Badge> : r.state === 'lost' ? <Badge tone="red" dot>Lost</Badge> : r.state === 'returned' ? <Badge tone="green" dot>Returned</Badge> : <Badge tone="amber" dot>Issued</Badge>
  const cols: RCol<ToolRow>[] = [
    { key: 'tool', header: 'Tool', value: (r) => r.item?.name ?? '—', exportValue: (r) => `${r.item?.sku ?? ''} ${r.item?.name ?? ''}`.trim(), cell: (r) => <span className="block min-w-0"><span className="block truncate font-semibold">{r.item?.name ?? '—'}</span><span className="block text-[12px] text-ink-soft">{r.item?.sku}</span></span> },
    { key: 'emp', header: 'Issued to', value: (r) => L.empName(r.issue.employee_id), cell: (r) => <EmployeeCell id={r.issue.employee_id} sub="code" size={26} /> },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.issue.qty },
    { key: 'issued', header: 'Issued on', value: (r) => r.issue.issued_on, cell: (r) => fmtDate(r.issue.issued_on), hideOnMobile: true },
    { key: 'due', header: 'Due back', value: (r) => r.issue.due_back ?? '', cell: (r) => fmtDate(r.issue.due_back) },
    { key: 'ret', header: 'Returned', value: (r) => r.issue.returned_on ?? '', cell: (r) => fmtDate(r.issue.returned_on), hideOnMobile: true },
    { key: 'days', header: 'Days out', align: 'right', value: (r) => r.daysOut, hideOnMobile: true },
    { key: 'state', header: 'Status', value: (r) => (r.state === 'overdue' ? `Overdue ${r.overdueDays} d` : titleCase(r.state === 'open' ? 'issued' : r.state)), cell: statusBadge },
    { key: 'cond', header: 'Condition', value: (r) => (r.issue.condition ? titleCase(r.issue.condition) : '—'), cell: (r) => (r.issue.condition === 'broken' ? <Badge tone="red">Broken</Badge> : r.issue.condition ? titleCase(r.issue.condition) : '—') },
    { key: 'value', header: 'Value', align: 'right', value: (r) => r.value, cell: (r) => inr(r.value), hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`As on ${fmtDate(today)}`}
      fileTag={`${today}_${show}`}
      kpis={[
        { label: 'Open issues', value: d.open, icon: <Hammer className="h-4 w-4" />, accent: 'indigo', hint: `${num(d.openQty)} pcs · ${inr(d.openValue)} out` },
        { label: 'Overdue returns', value: d.overdue, icon: <Hourglass className="h-4 w-4" />, accent: 'red', hint: d.overdue ? 'Past the due-back date' : 'All within due date' },
        { label: 'Lost', value: d.lost, icon: <CircleAlert className="h-4 w-4" />, accent: 'pink', hint: 'Marked lost' },
        { label: 'Returned broken', value: d.broken, icon: <TriangleAlert className="h-4 w-4" />, accent: 'amber', hint: `Loss value ${inr(d.lossValue)}` },
      ]}
      notes={<p>Value = issued quantity × the item’s unit cost (for lost tools, the quantity not returned). Overdue = still issued after the due-back date.</p>}
    >
      <ReportTable
        title="Tool issues"
        exportLabel={show === 'open' ? 'Open issues' : show === 'overdue' ? 'Overdue' : show === 'loss' ? 'Lost & broken' : 'All issues'}
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.item?.sku ?? ''} ${r.item?.name ?? ''} ${L.empName(r.issue.employee_id)}`}
        toolbar={
          <Segmented
            size="sm"
            className="no-print"
            value={show}
            onChange={setShow}
            options={[
              { value: 'open', label: `Open (${d.open})` },
              { value: 'overdue', label: `Overdue (${d.overdue})` },
              { value: 'loss', label: `Lost / broken (${d.rows.filter((r) => r.state === 'lost' || r.broken).length})` },
              { value: 'all', label: `All (${d.rows.length})` },
            ]}
          />
        }
        empty={<ChartEmpty text="Nothing in this view." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 16. Calibration due list ═════════════════════════ */

export function CalibrationView(p: ReportProps) {
  const assets = useTable('assets')
  const L = useLookups()
  const today = todayISO()
  const d = useMemo(() => calibrationDue(assets, today, 60), [assets, today])
  const [show, setShow] = useState<'due' | 'all'>('due')
  const rows = show === 'all' ? d.rows : d.rows.filter((r) => r.state !== 'later')

  const cols: RCol<CalRow>[] = [
    { key: 'code', header: 'Asset', value: (r) => r.asset.asset_code, cell: (r) => <span className="whitespace-nowrap font-semibold">{r.asset.asset_code}</span> },
    { key: 'name', header: 'Instrument', value: (r) => r.asset.name, className: 'max-w-[240px]', cell: (r) => <span className="block min-w-0"><span className="line-clamp-2">{r.asset.name}</span><span className="block text-[12px] text-ink-soft">{r.asset.make}</span></span> },
    { key: 'cat', header: 'Type', value: (r) => titleCase(r.asset.category), hideOnMobile: true },
    { key: 'loc', header: 'Location', value: (r) => r.asset.location || '—', hideOnMobile: true },
    { key: 'cust', header: 'Custodian', value: (r) => L.empName(r.asset.custodian_id), hideOnMobile: true },
    { key: 'last', header: 'Last calibrated', value: (r) => r.asset.last_calibrated ?? '', cell: (r) => fmtDate(r.asset.last_calibrated), hideOnMobile: true },
    { key: 'due', header: 'Due', value: (r) => r.asset.calibration_due ?? '', cell: (r) => fmtDate(r.asset.calibration_due) },
    {
      key: 'days', header: 'Status', value: (r) => r.days, exportValue: (r) => (r.days == null ? 'Not scheduled' : r.days < 0 ? `Overdue by ${-r.days} d` : `Due in ${r.days} d`),
      cell: (r) => (r.days == null ? <Badge tone="slate">Not scheduled</Badge> : r.days < 0 ? <Badge tone="red" dot>Overdue {-r.days} d</Badge> : r.days <= 30 ? <Badge tone="amber" dot>{r.days === 0 ? 'Due today' : `Due in ${r.days} d`}</Badge> : r.days <= 60 ? <Badge tone="sky" dot>Due in {r.days} d</Badge> : <Badge tone="green" dot>In {r.days} d</Badge>),
    },
    { key: 'cert', header: 'Certificate', value: (r) => r.asset.certificate_no || '—', hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`As on ${fmtDate(today)} · ${show === 'due' ? 'overdue + next 60 days' : 'all instruments'}`}
      fileTag={today}
      kpis={[
        { label: 'Instruments tracked', value: d.total, icon: <Gauge className="h-4 w-4" />, accent: 'indigo', hint: d.unscheduled ? `${d.unscheduled} without a due date` : 'All scheduled' },
        { label: 'Overdue', value: d.overdue, icon: <CircleAlert className="h-4 w-4" />, accent: 'red', hint: d.overdue ? 'Do not use until calibrated' : 'None overdue' },
        { label: 'Due in 30 days', value: d.due30, icon: <CalendarClock className="h-4 w-4" />, accent: 'amber', hint: 'Book the lab now' },
        { label: 'Due in 31–60 days', value: d.due60, icon: <Hourglass className="h-4 w-4" />, accent: 'cyan', hint: `${d.later} due later` },
      ]}
      notes={<p>Assets flagged “calibration required” that are not disposed. Overdue gauges should be quarantined until re-calibrated.</p>}
    >
      <ChartCard title="Due profile" subtitle="Instruments by days to calibration due">
        {d.total ? (
          <ChartBox height={200}>
            <BarChart data={d.buckets} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="key" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" name="Instruments" radius={[2, 2, 0, 0]} maxBarSize={44}>
                {d.buckets.map((b) => (
                  <Cell key={b.key} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartBox>
        ) : (
          <ChartEmpty text="No instruments need calibration." />
        )}
      </ChartCard>
      <ReportTable
        title="Calibration due list"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.asset.asset_code} ${r.asset.name} ${r.asset.location} ${L.empName(r.asset.custodian_id)}`}
        toolbar={<Segmented size="sm" className="no-print" value={show} onChange={setShow} options={[{ value: 'due', label: `Due list (${d.total - d.later})` }, { value: 'all', label: `All (${d.total})` }]} />}
        empty={<ChartEmpty text="Nothing overdue or due in the next 60 days." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 17. Purchase summary by vendor ═════════════════════════ */

export function PurchaseVendorView(p: ReportProps) {
  const pos = useTable('purchase_orders')
  const lines = useTable('purchase_order_lines')
  const vendors = useTable('vendors')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [fy, setFy] = useState(years[0]!)
  const { from, to } = fyRange(fy, fyStart)
  const d = useMemo(() => purchaseByVendor(pos, lines, vendors, { from, to }), [pos, lines, vendors, from, to])
  const chart = d.rows.map((r) => ({ name: short(r.name, 20), label: r.name, received: r.received, open: r.open }))
  const totals: VendorRow = { id: 'total', vendor: undefined, name: 'Total', ...d.totals, lastPo: '' }

  const cols: RCol<VendorRow>[] = [
    { key: 'name', header: 'Vendor', value: (r) => r.name, cell: (r) => <span className="block min-w-0"><span className="block truncate font-semibold">{r.name}</span><span className="block truncate text-[12px] text-ink-soft">{r.vendor?.category ?? ''}</span></span> },
    { key: 'pos', header: 'POs', align: 'right', value: (r) => r.pos, total: true },
    { key: 'sub', header: 'Taxable value', align: 'right', value: (r) => r.subtotal, total: true, cell: (r) => inr(r.subtotal), hideOnMobile: true },
    { key: 'tax', header: 'GST', align: 'right', value: (r) => r.tax, total: true, cell: (r) => inr(r.tax), hideOnMobile: true },
    { key: 'total', header: 'PO value (incl. GST)', align: 'right', value: (r) => r.total, total: true, cell: (r) => <b>{inr(r.total)}</b> },
    { key: 'rec', header: 'Received', align: 'right', value: (r) => r.received, total: true, cell: (r) => inr(r.received), hideOnMobile: true },
    { key: 'pct', header: 'Received %', align: 'right', value: (r) => Math.round(r.receivedPct * 10) / 10, total: true, cell: (r) => <PctBar value={r.receivedPct} /> },
    { key: 'open', header: 'Open value', align: 'right', value: (r) => r.open, total: true, cell: (r) => (r.open > 0.5 ? <span className="font-semibold text-amber-700">{inr(r.open)}</span> : '—') },
    { key: 'last', header: 'Last PO', value: (r) => r.lastPo, cell: (r) => fmtDate(r.lastPo), hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={fyText(fy)}
      fileTag={`FY${fy}`}
      filters={<FyFilter value={fy} onChange={setFy} years={years} />}
      kpis={[
        { label: 'PO value (incl. GST)', value: d.totals.total, format: inrCompact, text: inr(d.totals.total), icon: <ShoppingCart className="h-4 w-4" />, accent: 'indigo', hint: `${plural(d.totals.pos, 'PO')} · ${plural(d.rows.length, 'vendor')}` },
        { label: 'GST', value: d.totals.tax, format: inrCompact, text: inr(d.totals.tax), icon: <BadgeIndianRupee className="h-4 w-4" />, accent: 'cyan', hint: inr(d.totals.tax) },
        { label: 'Received', value: d.totals.receivedPct, format: (v) => pct(v, 1), icon: <Truck className="h-4 w-4" />, accent: 'green', hint: `${inr(d.totals.received)} of ordered value` },
        { label: 'Open value', value: d.totals.open, format: inrCompact, text: inr(d.totals.open), icon: <PackageSearch className="h-4 w-4" />, accent: 'amber', hint: 'Ordered, not yet received' },
      ]}
      notes={
        <p>
          Approved, sent, partially received and received POs dated in {fyText(fy)}. Received value = received quantity × rate incl. GST.
          {d.drafts ? ` ${plural(d.drafts, 'draft PO')} (${inr(d.draftValue)}) awaiting approval ${d.drafts === 1 ? 'is' : 'are'} excluded.` : ''}
          {d.cancelled ? ` ${plural(d.cancelled, 'cancelled PO')} excluded.` : ''}
        </p>
      }
    >
      <ChartCard title="Value by vendor" subtitle="Received vs open (incl. GST)">
        {chart.length ? (
          <>
            <SeriesKey items={[{ label: 'Received', color: '#3a8f5c' }, { label: 'Open', color: '#d08c1e' }]} />
            <ChartBox height={Math.max(180, chart.length * 32 + 24)}>
              <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} tickFormatter={(v: number) => inrCompact(v)} />
                <YAxis type="category" dataKey="name" {...axisProps} width={136} />
                <Tooltip {...tooltipProps} formatter={(v) => inr(Number(v))} labelFormatter={(_, pl) => (pl?.[0]?.payload as { label?: string } | undefined)?.label ?? ''} />
                <Bar dataKey="received" name="Received" stackId="a" fill="#3a8f5c" maxBarSize={20} />
                <Bar dataKey="open" name="Open" stackId="a" fill="#d08c1e" radius={[0, 2, 2, 0]} maxBarSize={20} />
              </BarChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text={`No purchase orders in ${fyText(fy)}.`} />
        )}
      </ChartCard>
      <ReportTable title="Vendor-wise purchases" rows={d.rows} columns={cols} rowKey={(r) => r.id} totalsRow={d.rows.length ? totals : undefined} initialSort={{ key: 'total', dir: 'desc' }} searchText={(r) => `${r.name} ${r.vendor?.category ?? ''}`} empty={<ChartEmpty text={`No purchase orders in ${fyText(fy)}.`} />} />
    </ReportFrame>
  )
}

/* ═════════════════════════ 18. Work orders ═════════════════════════ */

const DELIVERY: Record<DeliveryState, { label: string; tone: 'green' | 'red' | 'amber' | 'slate' | 'sky' }> = {
  on_time: { label: 'On time', tone: 'green' },
  late: { label: 'Late', tone: 'red' },
  overdue: { label: 'Overdue', tone: 'red' },
  open: { label: 'Open', tone: 'sky' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}
const WO_COLORS: Record<string, string> = { planned: '#94a3b8', in_progress: '#2f8f83', qc: '#7a5aa6', on_hold: '#d08c1e', completed: '#3a8f5c', dispatched: '#2a56a1', cancelled: '#cbd5e1' }

export function WorkOrdersView(p: ReportProps) {
  const wos = useTable('work_orders')
  const customers = useTable('customers')
  const audits = useTable('audit_logs')
  const today = todayISO()
  const d = useMemo(() => workOrderReport(wos, customers, audits, today), [wos, customers, audits, today])
  const [show, setShow] = useState<'all' | 'open' | 'overdue' | 'delivered'>('all')
  const rows = d.rows.filter((r) =>
    show === 'all' ? true : show === 'open' ? r.wo.status !== 'dispatched' && r.wo.status !== 'cancelled' : show === 'overdue' ? r.delivery === 'overdue' : r.delivery === 'on_time' || r.delivery === 'late',
  )
  const totals = useMemo(() => totalOf(rows, { ...(rows[0] ?? ({} as WoRow)), id: 'total' }, ['value', 'balanceValue']), [rows])

  const cols: RCol<WoRow>[] = [
    { key: 'wo', header: 'WO', value: (r) => r.wo.wo_no, cell: (r) => <span className="whitespace-nowrap font-semibold">{r.wo.wo_no}</span> },
    { key: 'cust', header: 'Customer', value: (r) => r.customer?.name ?? '—', className: 'max-w-[180px] truncate' },
    { key: 'part', header: 'Part', value: (r) => `${r.wo.part_no} ${r.wo.part_name}`, className: 'max-w-[220px]', cell: (r) => <span className="block min-w-0"><span className="block truncate">{r.wo.part_name}</span><span className="block text-[12px] text-ink-soft">{r.wo.part_no}</span></span>, hideOnMobile: true },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.wo.qty, hideOnMobile: true },
    { key: 'done', header: 'Done', align: 'right', value: (r) => r.wo.completed_qty, cell: (r) => `${num(r.wo.completed_qty)} / ${num(r.wo.qty)}` },
    { key: 'rej', header: 'Rejected', align: 'right', value: (r) => r.wo.rejected_qty, hideOnMobile: true },
    { key: 'value', header: 'Order value', align: 'right', value: (r) => r.value, total: true, cell: (r) => inr(r.value) },
    { key: 'due', header: 'Due', value: (r) => r.wo.due_date, cell: (r) => fmtDate(r.wo.due_date) },
    { key: 'status', header: 'Status', value: (r) => titleCase(r.wo.status), cell: (r) => <StatusBadge status={r.wo.status} /> },
    {
      key: 'delivery', header: 'Delivery', value: (r) => DELIVERY[r.delivery].label + (r.daysLate ? ` (${r.daysLate} d)` : ''),
      cell: (r) => <Badge tone={DELIVERY[r.delivery].tone}>{DELIVERY[r.delivery].label}{r.daysLate ? ` · ${r.daysLate} d` : ''}</Badge>,
    },
    { key: 'delivered', header: 'Delivered on', value: (r) => r.deliveredOn ?? '', cell: (r) => fmtDate(r.deliveredOn), hideOnMobile: true },
    { key: 'balance', header: 'Balance value', align: 'right', value: (r) => r.balanceValue, total: true, cell: (r) => (r.balanceValue ? inr(r.balanceValue) : '—'), hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`As on ${fmtDate(today)}`}
      fileTag={`${today}_${show}`}
      kpis={[
        { label: 'Open work orders', value: d.open, icon: <Factory className="h-4 w-4" />, accent: 'indigo', hint: `${d.rows.length} in total` },
        { label: 'Order book', value: d.orderBook, format: inrCompact, text: inr(d.orderBook), icon: <BadgeIndianRupee className="h-4 w-4" />, accent: 'cyan', hint: `${inr(d.balanceValue)} still to produce` },
        { label: 'On-time delivery', value: d.otd, format: (v) => pct(v, 1), icon: <Truck className="h-4 w-4" />, accent: 'green', hint: `${d.onTime} of ${plural(d.delivered, 'dispatch', 'dispatches')} by due date` },
        { label: 'Overdue', value: d.overdue, icon: <TriangleAlert className="h-4 w-4" />, accent: 'red', hint: 'Open past due date' },
        { label: 'Rejection', value: d.rejectionPct, format: (v) => pct(v, 2), icon: <Percent className="h-4 w-4" />, accent: 'amber', hint: 'Rejected ÷ (good + rejected)' },
      ]}
      notes={<p>Order book = order value (qty × unit price) of work orders not yet dispatched or cancelled. On-time delivery compares the dispatch date (from the audit trail, else the last update of the work order) with the due date.</p>}
    >
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard title="By status" subtitle={`${d.rows.length} work orders`}>
          <Donut data={d.byStatus.map((s) => ({ label: titleCase(s.status), value: s.count, color: WO_COLORS[s.status] ?? '#94a3b8' }))} center={<div><p className="text-xl font-semibold text-ink">{d.open}</p><p className="text-[10.5px] text-ink-soft">open</p></div>} />
        </ChartCard>
        <ChartCard title="Order book by customer" subtitle="Open orders at order value">
          {d.byCustomer.length ? (
            <ChartBox height={Math.max(180, d.byCustomer.length * 32 + 24)}>
              <BarChart data={d.byCustomer.map((c) => ({ ...c, short: short(c.name, 20) }))} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} tickFormatter={(v: number) => inrCompact(v)} />
                <YAxis type="category" dataKey="short" {...axisProps} width={136} />
                <Tooltip {...tooltipProps} formatter={(v) => inr(Number(v))} labelFormatter={(_, pl) => (pl?.[0]?.payload as { name?: string } | undefined)?.name ?? ''} />
                <Bar dataKey="value" name="Order book" fill={SERIES[0]} radius={[0, 2, 2, 0]} maxBarSize={20} />
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmpty text="No open orders." />
          )}
        </ChartCard>
      </div>
      <ReportTable
        title="Work orders"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={rows.length ? totals : undefined}
        searchText={(r) => `${r.wo.wo_no} ${r.customer?.name ?? ''} ${r.wo.part_no} ${r.wo.part_name} ${r.wo.customer_po_ref}`}
        toolbar={
          <Segmented
            size="sm"
            className="no-print"
            value={show}
            onChange={setShow}
            options={[{ value: 'all', label: `All (${d.rows.length})` }, { value: 'open', label: `Open (${d.open})` }, { value: 'overdue', label: `Overdue (${d.overdue})` }, { value: 'delivered', label: `Delivered (${d.delivered})` }]}
          />
        }
        empty={<ChartEmpty text="No work orders in this view." />}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 19. Quality ═════════════════════════ */

export function QualityView(p: ReportProps) {
  const inspections = useTable('inspections')
  const ncrs = useTable('ncrs')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const L = useLookups()
  const today = todayISO()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [fy, setFy] = useState(years[0]!)
  const w = fyWindow(fy, today, fyStart)
  const d = useMemo(() => qualityReport(inspections, ncrs, fy, today, fyStart), [inspections, ncrs, fy, today, fyStart])
  const monthRows = d.months.filter((m) => m.total > 0)

  const monthCols: RCol<QualityMonth>[] = [
    { key: 'month', header: 'Month', value: (m) => m.month, exportValue: (m) => m.label, cell: (m) => <b className="font-semibold">{m.label}</b> },
    { key: 'total', header: 'Inspections', align: 'right', value: (m) => m.total, total: true },
    { key: 'pass', header: 'Pass', align: 'right', value: (m) => m.pass, total: true },
    { key: 'fail', header: 'Fail', align: 'right', value: (m) => m.fail, total: true, cell: (m) => (m.fail ? <span className="font-semibold text-rose-600">{m.fail}</span> : '0') },
    { key: 'cond', header: 'Conditional', align: 'right', value: (m) => m.conditional, total: true, hideOnMobile: true },
    { key: 'rate', header: 'Pass rate', align: 'right', value: (m) => Math.round(m.passRate * 10) / 10, total: true, cell: (m) => <PctBar value={m.passRate} /> },
    { key: 'lot', header: 'Lot qty', align: 'right', value: (m) => m.lot, total: true, hideOnMobile: true },
    { key: 'rej', header: 'Rejected', align: 'right', value: (m) => m.rejected, total: true },
    { key: 'rejpct', header: 'Rejection %', align: 'right', value: (m) => round2(m.rejPct), total: true, cell: (m) => pct(m.rejPct, 2) },
  ]
  const monthTotal: QualityMonth = { id: 'total', month: '', label: 'Total', total: d.total, pass: d.pass, fail: d.fail, conditional: d.conditional, passRate: d.passRate, lot: d.lot, rejected: d.rejected, rejPct: d.rejPct }

  const partCols: RCol<PartQuality>[] = [
    { key: 'part', header: 'Part', value: (r) => r.part, cell: (r) => <span className="font-semibold">{r.part}</span> },
    { key: 'ins', header: 'Inspections', align: 'right', value: (r) => r.inspections, total: true },
    { key: 'fails', header: 'Failed', align: 'right', value: (r) => r.fails, total: true, cell: (r) => (r.fails ? <span className="font-semibold text-rose-600">{r.fails}</span> : '0') },
    { key: 'lot', header: 'Lot qty', align: 'right', value: (r) => r.lot, total: true },
    { key: 'acc', header: 'Accepted', align: 'right', value: (r) => r.accepted, total: true, hideOnMobile: true },
    { key: 'rej', header: 'Rejected', align: 'right', value: (r) => r.rejected, total: true },
    { key: 'rejpct', header: 'Rejection %', align: 'right', value: (r) => round2(r.rejPct), total: true, cell: (r) => <PctBar value={r.rejPct} good="low" /> },
  ]
  const partTotal: PartQuality = { id: 'total', part: 'Total', inspections: d.total, fails: d.fail, lot: d.lot, accepted: d.parts.reduce((s, x) => s + x.accepted, 0), rejected: d.rejected, rejPct: d.rejPct }

  const ncrCols: RCol<NcrRow>[] = [
    { key: 'no', header: 'NCR', value: (r) => r.ncr.ncr_no, cell: (r) => <span className="whitespace-nowrap font-semibold">{r.ncr.ncr_no}</span> },
    { key: 'date', header: 'Date', value: (r) => r.ncr.date, cell: (r) => fmtDate(r.ncr.date) },
    { key: 'desc', header: 'Non-conformance', value: (r) => r.ncr.description, className: 'max-w-[300px]', cell: (r) => <span className="line-clamp-2">{r.ncr.description}</span> },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.ncr.qty_affected },
    { key: 'disp', header: 'Disposition', value: (r) => titleCase(r.ncr.disposition), hideOnMobile: true },
    { key: 'cause', header: 'Root cause', value: (r) => r.ncr.root_cause || '—', className: 'max-w-[220px]', cell: (r) => <span className="line-clamp-2 text-ink-soft">{r.ncr.root_cause || '—'}</span>, hideOnMobile: true },
    { key: 'owner', header: 'Owner', value: (r) => L.empName(r.ncr.owner_id), hideOnMobile: true },
    { key: 'status', header: 'Status', value: (r) => titleCase(r.ncr.status), cell: (r) => <StatusBadge status={r.ncr.status} /> },
    { key: 'closed', header: 'Closed on', value: (r) => r.ncr.closed_on ?? '', cell: (r) => fmtDate(r.ncr.closed_on), hideOnMobile: true },
    { key: 'age', header: 'Age (days)', align: 'right', value: (r) => r.ageDays },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fyText(fy)}${w.current ? ` · to ${fmtDate(w.asOf)}` : ''}`}
      fileTag={`FY${fy}`}
      filters={<FyFilter value={fy} onChange={setFy} years={years} />}
      kpis={[
        { label: 'Inspections', value: d.total, icon: <ClipboardCheck className="h-4 w-4" />, accent: 'indigo', hint: `${d.fail} failed · ${d.conditional} conditional` },
        { label: 'Pass rate', value: d.passRate, format: (v) => pct(v, 1), icon: <ShieldCheck className="h-4 w-4" />, accent: 'green', hint: 'Passed ÷ inspections' },
        { label: 'Rejected qty', value: d.rejected, icon: <TriangleAlert className="h-4 w-4" />, accent: 'pink', hint: `${pct(d.rejPct, 2)} of ${num(d.lot)} inspected` },
        { label: 'Open NCRs', value: d.openNcrs, icon: <CircleAlert className="h-4 w-4" />, accent: 'amber', hint: `${plural(d.ncrs.length, 'NCR')} in the register` },
      ]}
      notes={<p>Pass rate counts conditional acceptances as not passed. Rejection % = rejected ÷ lot quantity inspected. The NCR register lists NCRs raised in the year plus any still open.</p>}
    >
      <ChartCard title="Pass rate by month" subtitle="Inspections passed / failed with the pass rate">
        {monthRows.length ? (
          <>
            <SeriesKey items={[{ label: 'Pass', color: '#3a8f5c' }, { label: 'Fail', color: '#c94a4a' }, { label: 'Conditional', color: '#d08c1e' }, { label: 'Pass rate %', color: SERIES[0]!, dashed: true }]} />
            <ChartBox height={240}>
              <ComposedChart data={d.months} margin={{ top: 8, right: 0, left: -22, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} tickFormatter={(v: string) => v.slice(0, 3)} />
                <YAxis yAxisId="n" {...axisProps} allowDecimals={false} />
                <YAxis yAxisId="p" orientation="right" {...axisProps} domain={[0, 100]} unit="%" width={44} />
                <Tooltip {...tooltipProps} formatter={(v, name) => (name === 'Pass rate' ? pct(Number(v), 1) : num(Number(v)))} />
                <Bar yAxisId="n" dataKey="pass" name="Pass" stackId="a" fill="#3a8f5c" maxBarSize={28} />
                <Bar yAxisId="n" dataKey="fail" name="Fail" stackId="a" fill="#c94a4a" maxBarSize={28} />
                <Bar yAxisId="n" dataKey="conditional" name="Conditional" stackId="a" fill="#d08c1e" radius={[2, 2, 0, 0]} maxBarSize={28} />
                <Line yAxisId="p" type="monotone" dataKey={(m: QualityMonth) => (m.total ? round2(m.passRate) : null)} name="Pass rate" stroke={SERIES[0]} strokeWidth={2} connectNulls dot={{ r: 3 }} />
              </ComposedChart>
            </ChartBox>
          </>
        ) : (
          <ChartEmpty text={`No inspections in ${fyText(fy)}.`} />
        )}
      </ChartCard>
      <ReportTable title="Rejection by part" rows={d.parts} columns={partCols} rowKey={(r) => r.id} totalsRow={d.parts.length ? partTotal : undefined} searchText={(r) => r.part} empty={<ChartEmpty text="No inspections this year." />} />
      <ReportTable
        title="NCR register"
        rows={d.ncrs}
        columns={ncrCols}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.ncr.ncr_no} ${r.ncr.description} ${r.ncr.root_cause} ${L.empName(r.ncr.owner_id)}`}
        empty={<ChartEmpty text="No NCRs this year." />}
      />
      <ReportTable title="Month-wise inspections" rows={monthRows} columns={monthCols} rowKey={(m) => m.id} totalsRow={monthRows.length ? monthTotal : undefined} empty={<ChartEmpty text="No inspections this year." />} />
    </ReportFrame>
  )
}
