import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, BookOpen, Download, FileText, Plus } from 'lucide-react'
import type { PettyCashEntry } from '@/data/types'
import { Button, EmptyState, Field, Input, Segmented } from '@/components/ui'
import { ledgerWithBalance, type LedgerRow } from '@/services/pettyCash'
import { audit } from '@/services/audit'
import { addMonths, currentMonth, fmtDate, fmtDateShort, fyOf, fyRange, monthEnd, monthStart, todayISO } from '@/lib/dates'
import { inr2 } from '@/lib/format'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/misc'

type Preset = 'month' | 'last' | 'fy' | 'custom'

function presetRange(p: Preset, fyStartMonth: number): { from: string; to: string } {
  const today = todayISO()
  if (p === 'month') return { from: monthStart(currentMonth()), to: today }
  if (p === 'last') {
    const m = addMonths(currentMonth(), -1)
    return { from: monthStart(m), to: monthEnd(m) }
  }
  return { from: fyRange(fyOf(today, fyStartMonth), fyStartMonth).from, to: today }
}

interface ExportRow {
  date: string
  entry: string
  particulars: string
  receipt: number | null
  payment: number | null
  balance: number
}

const money = (n: number | null) => (n ? inr2(n).replace('₹', '') : '')
// jsPDF's built-in fonts have no ₹ glyph
const rs = (n: number) => `Rs ${inr2(n).replace('₹', '')}`

/** Chronological petty-cash book with opening balance, running balance and totals. */
export function CashBook({ entries, fyStartMonth, canManage, onTopUp }: { entries: readonly PettyCashEntry[]; fyStartMonth: number; canManage: boolean; onTopUp: () => void }) {
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => presetRange('month', fyStartMonth))
  const [limit, setLimit] = useState(60)
  const mobile = useIsMobile()

  const choose = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p, fyStartMonth))
    setLimit(60)
  }
  const setCustom = (patch: Partial<{ from: string; to: string }>) => {
    setPreset('custom')
    setRange((r) => ({ ...r, ...patch }))
  }
  const invalidRange = !!range.from && !!range.to && range.from > range.to
  const ledger = useMemo(() => ledgerWithBalance(entries, range.from || null, invalidRange ? range.from : range.to || null), [entries, range, invalidRange])
  const rangeLabel = `${range.from ? fmtDate(range.from) : 'Beginning'} – ${range.to ? fmtDate(range.to) : fmtDate(todayISO())}`

  const exportRows = (): ExportRow[] => [
    { date: range.from || '', entry: '', particulars: 'Opening balance', receipt: null, payment: null, balance: ledger.opening },
    ...ledger.rows.map((r) => ({ date: r.date, entry: r.entry_no, particulars: `${r.category} — ${r.description}`, receipt: r.receipt || null, payment: r.payment || null, balance: r.balance })),
    { date: range.to || todayISO(), entry: '', particulars: 'Closing balance (totals)', receipt: ledger.receipts, payment: ledger.payments, balance: ledger.closing },
  ]
  const cols: ExportColumn<ExportRow>[] = [
    { header: 'Date', value: (r) => (r.date ? fmtDate(r.date) : '') },
    { header: 'Entry no', value: (r) => r.entry },
    { header: 'Particulars', value: (r) => r.particulars },
    { header: 'Receipts (Rs)', value: (r) => money(r.receipt), align: 'right' },
    { header: 'Payments (Rs)', value: (r) => money(r.payment), align: 'right' },
    { header: 'Balance (Rs)', value: (r) => inr2(r.balance).replace('₹', ''), align: 'right' },
  ]
  const doExport = async (kind: 'csv' | 'pdf') => {
    const rows = exportRows()
    const name = `petty-cash-book-${range.from || 'start'}-to-${range.to || todayISO()}`
    if (kind === 'csv') exportCsv(name, rows, cols)
    else
      await exportPdf({
        filename: name,
        title: 'Petty cash book',
        subtitle: rangeLabel,
        rows,
        columns: cols,
        summary: [
          ['Opening balance', rs(ledger.opening)],
          ['Receipts', rs(ledger.receipts)],
          ['Payments', rs(ledger.payments)],
          ['Closing balance', rs(ledger.closing)],
        ],
      })
    audit('export', 'petty_cash_entries', null, `Exported petty cash book (${kind.toUpperCase()}) · ${rangeLabel}`)
  }

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented<Preset>
          value={preset}
          onChange={choose}
          options={[
            { value: 'month', label: 'This month' },
            { value: 'last', label: 'Last month' },
            { value: 'fy', label: 'This FY' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 xs:grid-cols-2 sm:w-auto">
          <Field label="From" className="min-w-0">
            <Input type="date" value={range.from} max={range.to || undefined} onChange={(e) => setCustom({ from: e.target.value })} className="h-10 py-0 text-sm" />
          </Field>
          <Field label="To" className="min-w-0">
            <Input type="date" value={range.to} min={range.from || undefined} max={todayISO()} onChange={(e) => setCustom({ to: e.target.value })} className="h-10 py-0 text-sm" />
          </Field>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {canManage && (
            <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={onTopUp}>
              Top up
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void doExport('csv')}>
            CSV
          </Button>
          <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => void doExport('pdf')}>
            PDF
          </Button>
        </div>
      </div>
      {invalidRange && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700">“From” is after “To” — showing a single day.</p>}

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile label="Opening balance" value={ledger.opening} />
        <Tile label="Receipts" value={ledger.receipts} tone="text-emerald-600" icon={<ArrowDownLeft className="h-3.5 w-3.5" />} />
        <Tile label="Payments" value={ledger.payments} tone="text-rose-600" icon={<ArrowUpRight className="h-3.5 w-3.5" />} />
        <Tile label="Closing balance" value={ledger.closing} strong />
      </div>

      {!ledger.rows.length ? (
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No cash movements in this period" description={`Opening and closing balance: ${inr2(ledger.opening)}`} />
      ) : mobile ? (
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-2xl bg-indigo-50/70 px-3.5 py-2.5 text-[13px]">
            <span className="font-semibold text-ink-soft">Opening balance</span>
            <span className="num font-semibold text-ink">{inr2(ledger.opening)}</span>
          </li>
          {ledger.rows.slice(0, limit).map((r) => (
            <MobileRow key={r.id} r={r} />
          ))}
          {ledger.rows.length > limit && (
            <li>
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setLimit((l) => l + 60)}>
                Show {Math.min(60, ledger.rows.length - limit)} more
              </Button>
            </li>
          )}
          <li className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-cyan-50 via-indigo-50 to-pink-50 px-3.5 py-2.5 text-[13px]">
            <span className="font-semibold text-ink">Closing balance</span>
            <span className="num font-bold text-ink">{inr2(ledger.closing)}</span>
          </li>
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-indigo-100/80 bg-white/85 scroll-thin">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-indigo-100 bg-indigo-50/50 text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">
                <th className="px-3.5 py-2.5 text-left">Date</th>
                <th className="px-3.5 py-2.5 text-left">Entry no</th>
                <th className="px-3.5 py-2.5 text-left">Particulars</th>
                <th className="px-3.5 py-2.5 text-right">Receipts</th>
                <th className="px-3.5 py-2.5 text-right">Payments</th>
                <th className="px-3.5 py-2.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-indigo-50 bg-slate-50/70">
                <td className="num px-3.5 py-2.5 text-ink-soft">{range.from ? fmtDate(range.from) : '—'}</td>
                <td className="px-3.5 py-2.5" />
                <td className="px-3.5 py-2.5 font-semibold text-ink-soft">Opening balance</td>
                <td className="px-3.5 py-2.5" />
                <td className="px-3.5 py-2.5" />
                <td className="num px-3.5 py-2.5 text-right font-semibold text-ink">{inr2(ledger.opening)}</td>
              </tr>
              {ledger.rows.map((r) => (
                <tr key={r.id} className="border-b border-indigo-50 transition-colors hover:bg-indigo-50/40">
                  <td className="num whitespace-nowrap px-3.5 py-2.5 text-ink">{fmtDate(r.date)}</td>
                  <td className="num whitespace-nowrap px-3.5 py-2.5 text-ink-soft">{r.entry_no}</td>
                  <td className="max-w-[420px] px-3.5 py-2.5">
                    <span className="block truncate font-medium text-ink">{r.description || r.category}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{r.category}</span>
                  </td>
                  <td className="num whitespace-nowrap px-3.5 py-2.5 text-right font-medium text-emerald-600">{r.receipt ? inr2(r.receipt) : ''}</td>
                  <td className="num whitespace-nowrap px-3.5 py-2.5 text-right font-medium text-rose-600">{r.payment ? inr2(r.payment) : ''}</td>
                  <td className={cn('num whitespace-nowrap px-3.5 py-2.5 text-right font-semibold', r.balance < 0 ? 'text-rose-600' : 'text-ink')}>{inr2(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gradient-to-r from-cyan-50/80 via-indigo-50/80 to-pink-50/80 font-semibold">
                <td className="px-3.5 py-3 text-ink" colSpan={3}>
                  Totals · {ledger.rows.length} entries · closing balance
                </td>
                <td className="num px-3.5 py-3 text-right text-emerald-700">{inr2(ledger.receipts)}</td>
                <td className="num px-3.5 py-3 text-right text-rose-700">{inr2(ledger.payments)}</td>
                <td className="num px-3.5 py-3 text-right text-ink">{inr2(ledger.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, tone, icon, strong }: { label: string; value: number; tone?: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('min-w-0 rounded-2xl border px-3.5 py-2.5', strong ? 'border-indigo-200 bg-white shadow-soft' : 'border-indigo-100/80 bg-white/70')}>
      <p className="flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">
        {icon && <span className={tone}>{icon}</span>}
        {label}
      </p>
      <p className={cn('num mt-0.5 truncate font-display text-[17px] font-bold', tone ?? 'text-ink')}>{inr2(value)}</p>
    </motion.div>
  )
}

function MobileRow({ r }: { r: LedgerRow }) {
  const inflow = r.type === 'in'
  return (
    <li className="rounded-2xl border border-indigo-100/80 bg-white/90 p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl', inflow ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600')}>
          {inflow ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink">{r.description || r.category}</p>
          <p className="truncate text-[11.5px] text-ink-soft">
            {fmtDateShort(r.date)} · {r.entry_no} · {r.category}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('num text-[13.5px] font-bold', inflow ? 'text-emerald-600' : 'text-rose-600')}>
            {inflow ? '+' : '−'}
            {inr2(r.amount)}
          </p>
          <p className="num text-[11px] text-ink-faint">Bal {inr2(r.balance)}</p>
        </div>
      </div>
    </li>
  )
}
