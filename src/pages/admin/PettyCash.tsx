import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Banknote, BookOpen, Check, Clock3, Download, Eye, FileImage, FileText, FilterX, Landmark, Plus, ReceiptIndianRupee, Search, Wallet, X, Zap } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { PettyCashVoucher, VoucherStatus } from '@/data/types'
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Input, Menu, PageHeader, Progress, Select, StatCard, StatusBadge, Tabs, toast, type Column, type MenuItem } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { ChartBox, ChartGradients, Legend, SERIES, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { VoucherForm } from '@/components/petty/VoucherForm'
import { TopUpModal } from '@/components/petty/TopUpModal'
import { CashBook } from '@/components/petty/CashBook'
import { VoucherDetail } from '@/components/petty/VoucherDetail'
import { useVoucherActions } from '@/components/petty/useVoucherActions'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { openFile } from '@/services/files'
import { audit } from '@/services/audit'
import { approvalBlock, cashInHand, payBlock } from '@/services/pettyCash'
import { addMonths, currentMonth, fmtDate, fmtDateShort, fmtMonth, fyLabel, fyMonths, fyOf, fyRange, monthOf, todayISO } from '@/lib/dates'
import { inr, inrCompact, pct, plural, titleCase } from '@/lib/format'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'
import { sum } from '@/lib/misc'

type Tab = 'vouchers' | 'cashbook'
type StatusFilter = 'all' | 'action' | VoucherStatus

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'action', label: 'Needs action' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved · to pay' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
]

export default function PettyCashPage() {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const entries = useTable('petty_cash_entries')
  const vouchers = useTable('petty_cash_vouchers')
  const actions = useVoucherActions()
  const manage = s.can('petty_cash.manage')
  const [params, setParams] = useSearchParams()

  const [tab, setTab] = useState<Tab>('vouchers')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [category, setCategory] = useState('')
  const [employee, setEmployee] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)
  const closeNew = useCallback(() => setNewOpen(false), [])
  const closeTopUp = useCallback(() => setTopUpOpen(false), [])
  const detailId = params.get('v')
  const openDetail = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (id) n.set('v', id)
        else n.delete('v')
        return n
      },
      { replace: true },
    )

  const today = todayISO()
  const fyStartMonth = settings.financial_year_start_month
  const fy = fyOf(today, fyStartMonth)
  const fyR = fyRange(fy, fyStartMonth)
  const month = currentMonth()
  const imprest = settings.petty_cash_imprest
  const lowAlert = settings.petty_cash_low_alert

  const balance = useMemo(() => cashInHand(entries), [entries])
  const low = balance < lowAlert

  const stats = useMemo(() => {
    const outs = entries.filter((e) => e.type === 'out')
    const pending = vouchers.filter((v) => v.status === 'pending')
    const approved = vouchers.filter((v) => v.status === 'approved')
    return {
      thisMonth: sum(outs.filter((e) => monthOf(e.date) === month), (e) => e.amount),
      lastMonth: sum(outs.filter((e) => monthOf(e.date) === addMonths(month, -1)), (e) => e.amount),
      pendingCount: pending.length,
      pendingValue: sum(pending, (v) => v.amount),
      approvedCount: approved.length,
      approvedValue: sum(approved, (v) => v.amount),
    }
  }, [entries, vouchers, month])

  const categoryColor = useMemo(() => {
    const m = new Map<string, string>()
    settings.petty_cash_categories.forEach((c, i) => m.set(c, SERIES[i % SERIES.length]!))
    return (c: string) => m.get(c) ?? '#94a3b8'
  }, [settings.petty_cash_categories])

  const fySpend = useMemo(() => {
    const outs = entries.filter((e) => e.type === 'out' && e.date >= fyR.from && e.date <= fyR.to)
    const byCat = new Map<string, number>()
    for (const e of outs) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount)
    const cats = [...byCat.entries()].map(([name, value]) => ({ name, value, color: categoryColor(name) })).sort((a, b) => b.value - a.value)
    const months = fyMonths(fy, fyStartMonth).map((m) => ({
      month: fmtMonth(m, true).split(' ')[0]!,
      ym: m,
      spend: sum(outs.filter((e) => monthOf(e.date) === m), (e) => e.amount),
    }))
    return { cats, months, total: sum(outs, (e) => e.amount) }
  }, [entries, fyR.from, fyR.to, fy, fyStartMonth, categoryColor])

  const rows = useMemo(() => {
    let list = vouchers
    if (status === 'action') list = list.filter((v) => v.status === 'pending' || v.status === 'approved')
    else if (status !== 'all') list = list.filter((v) => v.status === status)
    if (category) list = list.filter((v) => v.category === category)
    if (employee) list = list.filter((v) => v.employee_id === employee)
    if (from) list = list.filter((v) => v.date >= from)
    if (to) list = list.filter((v) => v.date <= to)
    const needle = q.trim().toLowerCase()
    if (needle) list = list.filter((v) => `${v.voucher_no} ${L.empName(v.employee_id)} ${v.category} ${v.payee} ${v.description} ${v.bill_no} ${v.amount}`.toLowerCase().includes(needle))
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
  }, [vouchers, status, category, employee, from, to, q, L])
  const rowsTotal = useMemo(() => sum(rows, (v) => v.amount), [rows])
  const filtered = status !== 'all' || !!category || !!employee || !!from || !!to || !!q.trim()
  const filterLabel = [
    STATUS_OPTIONS.find((o) => o.value === status && o.value !== 'all')?.label,
    category,
    employee && L.empName(employee),
    (from || to) && `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : '…'}`,
    q.trim() && `“${q.trim()}”`,
  ]
    .filter(Boolean)
    .join(' · ')
  const doExport = (kind: 'csv' | 'pdf') => {
    if (!rows.length) return toast.info('Nothing to export', 'No vouchers match the current filters.')
    const cols: ExportColumn<PettyCashVoucher>[] = [
      { header: 'Voucher', value: (v) => v.voucher_no },
      { header: 'Date', value: (v) => fmtDate(v.date) },
      { header: 'Claimant', value: (v) => L.empName(v.employee_id) },
      { header: 'Category', value: (v) => v.category },
      { header: 'Payee', value: (v) => v.payee },
      { header: 'Bill no', value: (v) => v.bill_no },
      { header: 'Description', value: (v) => v.description },
      { header: 'Amount (Rs)', value: (v) => v.amount.toFixed(2), align: 'right' },
      { header: 'Status', value: (v) => titleCase(v.status) },
    ]
    const name = `petty-cash-vouchers-${today}`
    if (kind === 'csv') exportCsv(name, rows, cols)
    else
      void exportPdf({
        filename: name,
        title: 'Petty-cash vouchers',
        subtitle: filterLabel || 'All vouchers',
        rows,
        columns: cols,
        landscape: true,
        summary: [
          ['Vouchers', String(rows.length)],
          ['Total', `Rs ${inr(rowsTotal).replace('₹', '')}`],
          ['Pending', String(rows.filter((v) => v.status === 'pending').length)],
          ['As on', fmtDate(today)],
        ],
      })
    audit('export', 'petty_cash_vouchers', null, `Exported ${rows.length} petty-cash vouchers (${kind.toUpperCase()}${filterLabel ? ` · ${filterLabel}` : ''})`)
  }
  const clear = () => {
    setQ('')
    setStatus('all')
    setCategory('')
    setEmployee('')
    setFrom('')
    setTo('')
  }

  const claimantOptions = useMemo(() => {
    const ids = new Set(vouchers.map((v) => v.employee_id))
    return L.employeeOptions((e) => ids.has(e.id))
  }, [vouchers, L])

  // drop a deep link to a voucher that no longer exists (withdrawn / not visible)
  useEffect(() => {
    if (detailId && vouchers.length && !vouchers.some((v) => v.id === detailId)) openDetail(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, vouchers])

  const viewBill = (v: PettyCashVoucher) => openFile(v.attachment).catch((e: unknown) => toast.error('Could not open the bill', e instanceof Error ? e.message : String(e)))

  const rowActions = (v: PettyCashVoucher) => {
    const approveBlock = approvalBlock(v, s)
    const payBlocked = payBlock(v, balance, s)
    const items: MenuItem[] = [{ label: 'Open details', icon: <Eye />, onClick: () => openDetail(v.id) }]
    if (v.attachment) items.push({ label: 'View bill', icon: <FileImage />, onClick: () => void viewBill(v) })
    if (manage && v.status === 'pending') items.push({ label: 'Approve & pay', icon: <Zap />, onClick: () => void actions.approvePay(v) })
    if (manage && v.status === 'approved') items.push({ label: 'Reject', icon: <X />, onClick: () => void actions.reject(v), danger: true })
    return (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {manage && v.status === 'pending' && (
          <>
            <Button size="icon-sm" variant="secondary" aria-label="Approve" title={approveBlock ?? 'Approve'} onClick={() => void actions.approve(v)} className={approveBlock ? 'text-ink-faint' : 'text-emerald-600'}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="secondary" aria-label="Reject" title="Reject" onClick={() => void actions.reject(v)} className="text-rose-600">
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
        {manage && v.status === 'approved' && (
          <Button size="sm" variant={payBlocked ? 'secondary' : 'success'} icon={<Banknote className="h-4 w-4" />} title={payBlocked ?? 'Pay from the cash box'} loading={actions.busy === v.id} onClick={() => void actions.pay(v)}>
            Pay
          </Button>
        )}
        {!manage && v.attachment && (
          <Button size="icon-sm" variant="ghost" aria-label="View bill" title="View bill" onClick={() => void viewBill(v)}>
            <FileImage className="h-4 w-4" />
          </Button>
        )}
        <Menu items={items} />
      </div>
    )
  }

  const columns: Column<PettyCashVoucher>[] = [
    { key: 'no', header: 'Voucher', value: (v) => v.voucher_no, cell: (v) => <span className="num whitespace-nowrap font-semibold text-ink">{v.voucher_no}</span> },
    { key: 'date', header: 'Date', value: (v) => v.date, exportValue: (v) => fmtDate(v.date), cell: (v) => <span className="num whitespace-nowrap">{fmtDate(v.date)}</span> },
    { key: 'emp', header: 'Claimant', value: (v) => L.empName(v.employee_id), cell: (v) => <EmployeeCell id={v.employee_id} sub="code" size={30} /> },
    { key: 'cat', header: 'Category', value: (v) => v.category, cell: (v) => <CategoryChip name={v.category} color={categoryColor(v.category)} /> },
    { key: 'payee', header: 'Payee', value: (v) => v.payee, cell: (v) => <span className="block max-w-[160px] truncate">{v.payee || '—'}</span> },
    { key: 'desc', header: 'Description', value: (v) => v.description, cell: (v) => <span className="block max-w-[240px] truncate text-ink-soft" title={v.description}>{v.description}</span> },
    { key: 'amount', header: 'Amount', align: 'right', value: (v) => v.amount, cell: (v) => <span className="num font-semibold">{inr(v.amount)}</span> },
    { key: 'status', header: 'Status', value: (v) => v.status, cell: (v) => <StatusBadge status={v.status} /> },
    { key: 'actions', header: '', export: false, sortable: false, align: 'right', cell: rowActions },
  ]

  return (
    <div>
      <PageHeader
        kicker="Finance"
        title="Petty cash"
        subtitle={`Imprest cash box, employee claims and the cash book · FY ${fyLabel(fy)}`}
        actions={
          manage && (
            <>
              <Button variant="secondary" icon={<Landmark className="h-4 w-4" />} onClick={() => setTopUpOpen(true)}>
                Top up
              </Button>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
                New voucher
              </Button>
            </>
          )
        }
      />

      <AnimatePresence initial={false}>
        {low && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex flex-wrap items-center gap-3 rounded-[20px] border border-amber-200 bg-gradient-to-r from-amber-50 to-rose-50 p-4"
            role="alert"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 text-white shadow-soft">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold text-ink">Cash in hand is low</p>
              <p className="text-[13px] text-ink-soft">
                {inr(balance)} left — below the {inr(lowAlert)} alert level.
                {stats.approvedCount > 0 && ` ${plural(stats.approvedCount, 'approved claim')} (${inr(stats.approvedValue)}) still to be paid.`}
              </p>
            </div>
            {manage && (
              <Button size="sm" onClick={() => setTopUpOpen(true)} icon={<Landmark className="h-4 w-4" />}>
                Top up to imprest
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Cash in hand"
          value={balance}
          format={inr}
          icon={<Wallet className="h-4 w-4" />}
          accent={low ? 'red' : 'green'}
          hint={
            <span className="block space-y-1">
              <Progress value={balance} max={imprest} tone={low ? 'linear-gradient(90deg,#f59e0b,#f43f5e)' : undefined} className="h-1.5" />
              <span className="block">{pct((balance / Math.max(1, imprest)) * 100)} of imprest</span>
            </span>
          }
          onClick={() => setTab('cashbook')}
        />
        <StatCard label="Imprest float" value={imprest} format={inr} icon={<Landmark className="h-4 w-4" />} accent="indigo" hint={`Alert below ${inr(lowAlert)} · limit ${inr(settings.petty_cash_approval_limit)}/claim`} />
        <StatCard
          label={`Spent in ${fmtMonth(month, true)}`}
          value={stats.thisMonth}
          format={inr}
          icon={<ReceiptIndianRupee className="h-4 w-4" />}
          accent="cyan"
          hint={`${fmtMonth(addMonths(month, -1), true)}: ${inr(stats.lastMonth)}`}
        />
        <StatCard
          label="Pending claims"
          value={stats.pendingCount}
          icon={<Clock3 className="h-4 w-4" />}
          accent="amber"
          hint={`${inr(stats.pendingValue)} pending · ${stats.approvedCount} to pay (${inr(stats.approvedValue)})`}
          onClick={() => {
            setTab('vouchers')
            setStatus('action')
          }}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Spend by category" subtitle={`FY ${fyLabel(fy)} · ${inr(fySpend.total)}`} />
          <div className="grid grid-cols-1 items-center gap-4 p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:p-5">
            {fySpend.cats.length ? (
              <>
                <div className="relative mx-auto w-full max-w-[200px] min-w-0">
                  <ChartBox height={180}>
                    <PieChart>
                      <Pie data={fySpend.cats} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="none">
                        {fySpend.cats.map((c) => (
                          <Cell key={c.name} fill={c.color} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipProps} formatter={(v: number) => inr(v)} />
                    </PieChart>
                  </ChartBox>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div>
                      <p className="num font-display text-[15px] font-bold text-ink">{inrCompact(fySpend.total)}</p>
                      <p className="text-[10.5px] font-medium text-ink-soft">this FY</p>
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <Legend items={fySpend.cats.slice(0, 7).map((c) => ({ label: c.name, value: inr(c.value), color: c.color }))} />
                  {fySpend.cats.length > 7 && <p className="mt-1.5 text-[12px] text-ink-faint">+ {fySpend.cats.length - 7} more categories</p>}
                </div>
              </>
            ) : (
              <EmptyState className="sm:col-span-2" title="No spend yet this year" />
            )}
          </div>
        </Card>
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader title="Month-wise spend" subtitle={`Payments from the cash box · FY ${fyLabel(fy)}`} />
          <div className="min-w-0 p-4 pt-2 sm:p-5 sm:pt-2">
            <ChartBox height={220}>
              <BarChart data={fySpend.months} margin={{ top: 10, right: 6, left: -8, bottom: 0 }}>
                <ChartGradients />
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} interval="preserveStartEnd" />
                <YAxis {...axisProps} width={52} tickFormatter={(v: number) => inrCompact(v)} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [inr(v), 'Spent']} />
                <Bar dataKey="spend" radius={[6, 6, 0, 0]} maxBarSize={28}>
                  {fySpend.months.map((m) => (
                    <Cell key={m.ym} fill={m.ym === month ? 'url(#gBarPink)' : 'url(#gBar)'} />
                  ))}
                </Bar>
              </BarChart>
            </ChartBox>
          </div>
        </Card>
      </div>

      <Card className="mt-4 min-w-0">
        <div className="px-4 pt-3 sm:px-5">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'vouchers', label: 'Vouchers', count: stats.pendingCount + stats.approvedCount },
              { value: 'cashbook', label: 'Cash book' },
            ]}
            className="mb-0"
          />
        </div>
        <div className="min-w-0 p-4 sm:p-5">
          {tab === 'vouchers' ? (
            <>
              <div className="mb-3 grid grid-cols-1 gap-2 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))_auto]">
                <Input aria-label="Search vouchers" type="search" value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="h-4 w-4" />} placeholder="Search voucher, employee, payee, bill…" className="h-10 py-0 text-sm" />
                <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} options={STATUS_OPTIONS} className="h-10 py-0 text-sm" />
                <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={settings.petty_cash_categories.map((c) => ({ value: c, label: c }))} placeholder="All categories" className="h-10 py-0 text-sm" />
                <Select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} options={claimantOptions} placeholder="All employees" className="h-10 py-0 text-sm" />
                <Input aria-label="From date" title="From date" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="h-10 py-0 text-sm" />
                <Input aria-label="To date" title="To date" type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className="h-10 py-0 text-sm" />
                <Button size="sm" variant="ghost" className="h-10" icon={<FilterX className="h-4 w-4" />} disabled={!filtered} onClick={clear}>
                  Clear
                </Button>
              </div>
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(v) => v.id}
                onRowClick={(v) => openDetail(v.id)}
                toolbar={
                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <Badge tone="indigo">
                      {rows.length} {rows.length === 1 ? 'voucher' : 'vouchers'} · {inr(rowsTotal)}
                    </Badge>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => doExport('csv')}>
                        CSV
                      </Button>
                      <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => doExport('pdf')}>
                        PDF
                      </Button>
                    </div>
                  </div>
                }
                empty={
                  <EmptyState
                    icon={<ReceiptIndianRupee className="h-6 w-6" />}
                    title={filtered ? 'No vouchers match these filters' : 'No petty-cash vouchers yet'}
                    description={filtered ? 'Try clearing a filter.' : 'Claims raised by employees from My space appear here.'}
                    action={
                      filtered ? (
                        <Button size="sm" variant="secondary" onClick={clear}>
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                }
                mobileCard={(v) => (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <EmployeeCell id={v.employee_id} sub="none" size={28} />
                      </div>
                      <span className="num shrink-0 font-display text-[16px] font-bold text-ink">{inr(v.amount)}</span>
                    </div>
                    <p className="truncate text-[13px] text-ink">{v.description}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-soft">
                      <span className="num font-semibold">{v.voucher_no}</span>
                      <span>· {fmtDateShort(v.date)}</span>
                      <CategoryChip name={v.category} color={categoryColor(v.category)} />
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <StatusBadge status={v.status} />
                      {rowActions(v)}
                    </div>
                  </div>
                )}
                initialSort={{ key: 'date', dir: 'desc' }}
              />
            </>
          ) : (
            <CashBook entries={entries} fyStartMonth={fyStartMonth} canManage={manage} onTopUp={() => setTopUpOpen(true)} />
          )}
        </div>
      </Card>

      {!manage && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
          <BookOpen className="h-3.5 w-3.5 shrink-0" /> View-only access — approvals and payments need petty-cash manage rights.
        </p>
      )}

      {manage && <VoucherForm open={newOpen} onClose={closeNew} mode="admin" />}
      {manage && <TopUpModal open={topUpOpen} onClose={closeTopUp} balance={balance} imprest={imprest} />}
      <VoucherDetail id={detailId} onClose={() => openDetail(null)} balance={balance} actions={actions} />
    </div>
  )
}

function CategoryChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-[12px] font-medium text-ink-soft ring-1 ring-inset ring-slate-200">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  )
}
