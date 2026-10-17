/** Finance reports: petty-cash statement (cash book) and spend by category. */
import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, BookOpenText, Hash, PieChart as PieIcon, Receipt, TrendingUp, Wallet } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { useSettings, useTable } from '@/data/store'
import { fmtDate, todayISO } from '@/lib/dates'
import { inr, inrCompact, pct, plural } from '@/lib/format'
import { cn } from '@/lib/misc'
import { ChartBox, ChartGradients, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { fyText, fyWindow, pettyCashStatement, rangeLabel, recentFys, spendByCategory, type CategorySpend, type LedgerRow } from '@/services/reports'
import { ChartCard, ChartEmpty, Donut, FyFilter, RangeFilter, ReportFrame, ReportTable, totalOf, useDateRange, type RCol, type ReportProps } from './ReportKit'

/* ═════════════════════════ 10. Petty cash statement ═════════════════════════ */

export function PettyStatementView(p: ReportProps) {
  const entries = useTable('petty_cash_entries')
  const vouchers = useTable('petty_cash_vouchers')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const rs = useDateRange('this_month', today, fyStart)
  const st = useMemo(() => pettyCashStatement(entries, rs.range, today), [entries, rs.range, today])
  const awaiting = vouchers.filter((v) => v.status === 'approved')
  const awaitingAmt = awaiting.reduce((s, v) => s + v.amount, 0)
  const low = st.closing < settings.petty_cash_low_alert

  const amt = (n: number) => (n ? inr(n) : '')
  const cols: RCol<LedgerRow>[] = [
    { key: 'date', header: 'Date', sortable: false, value: (r) => r.date, cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.date)}</span> },
    { key: 'no', header: 'Entry no.', sortable: false, value: (r) => r.entry_no, hideOnMobile: true, cell: (r) => <span className="whitespace-nowrap text-ink-soft">{r.entry_no || '—'}</span> },
    { key: 'desc', header: 'Particulars', sortable: false, value: (r) => r.description, className: 'max-w-[320px]', cell: (r) => <span className={cn('line-clamp-2', r.kind === 'opening' && 'font-semibold')}>{r.description}</span> },
    { key: 'cat', header: 'Category', sortable: false, value: (r) => r.category, hideOnMobile: true, cell: (r) => <span className="whitespace-nowrap text-ink-soft">{r.category || '—'}</span> },
    { key: 'in', header: 'Receipts', align: 'right', sortable: false, total: true, value: (r) => r.receipt || null, cell: (r) => <span className="text-emerald-700">{amt(r.receipt)}</span> },
    { key: 'out', header: 'Payments', align: 'right', sortable: false, total: true, value: (r) => r.payment || null, cell: (r) => <span className="text-rose-600">{amt(r.payment)}</span> },
    { key: 'bal', header: 'Balance', align: 'right', sortable: false, total: true, value: (r) => r.balance, cell: (r) => <b>{inr(r.balance)}</b> },
  ]
  const totals: LedgerRow = { id: 'total', kind: 'entry', date: '', entry_no: '', description: 'Total', category: '', receipt: st.receipts, payment: st.payments, balance: st.closing }

  return (
    <ReportFrame
      {...p}
      period={rangeLabel(rs.range)}
      fileTag={`${rs.range.from}_${rs.range.to}`}
      filters={<RangeFilter state={rs} />}
      kpis={[
        { label: 'Opening balance', value: st.opening, format: inr, icon: <Wallet className="h-4 w-4" />, accent: 'indigo', hint: `As on ${fmtDate(rs.range.from)}` },
        { label: 'Receipts', value: st.receipts, format: inr, icon: <ArrowDownLeft className="h-4 w-4" />, accent: 'green', hint: 'Imprest top-ups & refunds' },
        { label: 'Payments', value: st.payments, format: inr, icon: <ArrowUpRight className="h-4 w-4" />, accent: 'pink', hint: `${plural(st.rows.filter((r) => r.payment > 0).length, 'voucher')} paid` },
        {
          label: 'Closing balance', value: st.closing, format: inr, icon: <BookOpenText className="h-4 w-4" />, accent: low ? 'red' : 'cyan',
          hint: low ? `Below the ${inr(settings.petty_cash_low_alert)} alert level` : awaitingAmt ? `${inr(awaitingAmt)} approved, awaiting payment` : `As on ${fmtDate(rs.range.to)}`,
        },
      ]}
      notes={
        <p>
          Opening balance = all receipts less payments before {fmtDate(rs.range.from)}. Payments are posted when a voucher is paid; {plural(awaiting.length, 'approved voucher')} ({inr(awaitingAmt)}) {awaiting.length === 1 ? 'is' : 'are'} not yet paid and not in this statement.
        </p>
      }
    >
      <ChartCard title="Cash in hand" subtitle={`End-of-day balance · low-balance alert ${inr(settings.petty_cash_low_alert)}`}>
        {st.daily.length ? (
          <ChartBox height={220}>
            <AreaChart data={st.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <ChartGradients />
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} tickFormatter={(v: number) => inrCompact(v)} width={52} />
              <Tooltip {...tooltipProps} formatter={(v) => inr(Number(v))} labelFormatter={(_, pl) => fmtDate((pl?.[0]?.payload as { date?: string } | undefined)?.date)} />
              <ReferenceLine y={settings.petty_cash_low_alert} stroke="#f43f5e" strokeDasharray="4 4" />
              <Area type="stepAfter" dataKey="balance" name="Balance" stroke={SERIES[0]} strokeWidth={2} fill="url(#gIndigo)" />
            </AreaChart>
          </ChartBox>
        ) : (
          <ChartEmpty text="The period has not started yet." />
        )}
      </ChartCard>
      <ReportTable
        title="Cash book"
        subtitle={`${plural(st.count, 'entry', 'entries')} · running balance after every entry`}
        rows={st.rows}
        columns={cols}
        rowKey={(r) => r.id}
        totalsRow={totals}
        pageSize={200}
        searchText={(r) => `${r.entry_no} ${r.description} ${r.category}`}
        searchPlaceholder="Search particulars, category or entry no…"
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('text-sm text-ink', r.kind === 'opening' && 'font-semibold')}>{r.description}</p>
              <p className="mt-0.5 text-[12px] text-ink-soft">{fmtDate(r.date)}{r.entry_no ? ` · ${r.entry_no}` : ''}{r.category ? ` · ${r.category}` : ''}</p>
            </div>
            <div className="shrink-0 text-right">
              {r.receipt > 0 && <p className="num text-sm font-semibold text-emerald-700">+{inr(r.receipt)}</p>}
              {r.payment > 0 && <p className="num text-sm font-semibold text-rose-600">−{inr(r.payment)}</p>}
              <p className="num text-[12px] text-ink-soft">Bal {inr(r.balance)}</p>
            </div>
          </div>
        )}
      />
    </ReportFrame>
  )
}

/* ═════════════════════════ 11. Spend by category ═════════════════════════ */

const CAT_BASE: CategorySpend = { id: 'total', category: 'Total', count: 0, amount: 0, share: 100, avg: 0, max: 0 }

export function SpendByCategoryView(p: ReportProps) {
  const entries = useTable('petty_cash_entries')
  const settings = useSettings()
  const fyStart = settings.financial_year_start_month || 4
  const today = todayISO()
  const years = useMemo(() => recentFys(today, fyStart), [today, fyStart])
  const [fy, setFy] = useState(years[0]!)
  const w = fyWindow(fy, today, fyStart)
  const data = useMemo(() => spendByCategory(entries, { from: w.from, to: w.asOf }, fy, fyStart), [entries, w.from, w.asOf, fy, fyStart])
  const months = data.monthly.length || 1
  const top = data.categories[0]
  const colored = data.categories.map((c, i) => ({ ...c, color: SERIES[i % SERIES.length]! }))
  const t = useMemo(() => {
    const x = totalOf(data.categories, { ...CAT_BASE }, ['count', 'amount'])
    return { ...x, share: data.categories.length ? 100 : 0, avg: x.count ? Math.round(x.amount / x.count) : 0, max: Math.max(0, ...data.categories.map((c) => c.max)) }
  }, [data.categories])

  const cols: RCol<CategorySpend>[] = [
    {
      key: 'cat', header: 'Category', value: (c) => c.category,
      cell: (c) => <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colored.find((x) => x.id === c.id)?.color }} /><span className="truncate font-semibold">{c.category}</span></span>,
    },
    { key: 'count', header: 'Payments', align: 'right', value: (c) => c.count, total: true },
    { key: 'amount', header: 'Amount', align: 'right', value: (c) => c.amount, total: true, cell: (c) => <b>{inr(c.amount)}</b> },
    { key: 'share', header: 'Share', align: 'right', value: (c) => Math.round(c.share * 10) / 10, total: true, cell: (c) => pct(c.share, 1) },
    { key: 'avg', header: 'Average', align: 'right', value: (c) => c.avg, total: true, cell: (c) => inr(c.avg), hideOnMobile: true },
    { key: 'max', header: 'Largest', align: 'right', value: (c) => c.max, total: true, cell: (c) => inr(c.max), hideOnMobile: true },
  ]

  return (
    <ReportFrame
      {...p}
      period={`${fyText(fy)}${w.current ? ` · to ${fmtDate(w.asOf)}` : ''}`}
      fileTag={`FY${fy}`}
      filters={<FyFilter value={fy} onChange={setFy} years={years} />}
      kpis={[
        { label: 'Total spend', value: data.total, format: inr, icon: <Receipt className="h-4 w-4" />, accent: 'indigo', hint: fyText(fy) },
        { label: 'Payments', value: data.count, icon: <Hash className="h-4 w-4" />, accent: 'cyan', hint: data.count ? `Avg ${inr(data.total / data.count)} each` : '—' },
        { label: 'Monthly average', value: data.total / months, format: inr, icon: <TrendingUp className="h-4 w-4" />, accent: 'green', hint: `Over ${plural(months, 'month')}` },
        { label: 'Top category', value: top?.amount ?? 0, format: inr, text: top ? `${top.category} ${inr(top.amount)}` : '—', icon: <PieIcon className="h-4 w-4" />, accent: 'pink', hint: top ? `${top.category} · ${pct(top.share, 1)}` : 'No spend yet' },
      ]}
      notes={<p>Paid petty-cash vouchers (cash book payments) dated in {fyText(fy)}. Pending, approved-but-unpaid and rejected vouchers are excluded.</p>}
    >
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard title="Spend mix" subtitle="Share of petty-cash payments by category">
          <Donut data={colored.map((c) => ({ label: c.category, value: c.amount, color: c.color }))} format={inr} center={<div><p className="font-display text-base font-bold text-ink">{inrCompact(data.total)}</p><p className="text-[10.5px] text-ink-soft">spent</p></div>} />
        </ChartCard>
        <ChartCard title="Monthly spend" subtitle={fyText(fy)}>
          {data.total > 0 ? (
            <ChartBox height={220}>
              <BarChart data={data.monthly} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <ChartGradients />
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v: number) => inrCompact(v)} width={52} />
                <Tooltip {...tooltipProps} formatter={(v) => inr(Number(v))} />
                <Bar dataKey="amount" name="Spend" fill="url(#gBar)" radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ChartBox>
          ) : (
            <ChartEmpty />
          )}
        </ChartCard>
      </div>
      <ReportTable title="By category" rows={data.categories} columns={cols} rowKey={(c) => c.id} totalsRow={data.categories.length ? t : undefined} initialSort={{ key: 'amount', dir: 'desc' }} empty={<ChartEmpty text="No petty-cash payments in this year." />} />
    </ReportFrame>
  )
}
