import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, CheckCircle2, Download, FileClock, IndianRupee, PackageCheck, Plus, Send, Store } from 'lucide-react'
import { useTable } from '@/data/store'
import type { PoStatus, PurchaseOrder, Vendor } from '@/data/types'
import { Badge, Button, DataTable, EmptyState, Menu, PageHeader, StatCard, StatusBadge, Tabs, confirm, confirmWithNote, guard, toast, type Column } from '@/components/ui'
import { useSession } from '@/services/session'
import { fmtDate, fmtMonth, monthOf, todayISO } from '@/lib/dates'
import { inr, inrCompact } from '@/lib/format'
import { downloadPoPdf } from '@/lib/poPdf'
import { audit } from '@/services/audit'
import { PO_STATUS_LABEL, approvePo, cancelPo, deletePo, deleteVendor, markPoSent, poDeliveryState, purchaseKpis, vendorSpend } from '@/services/purchase'
import { useDialog, useLast, useQueryParam } from '@/components/ops/form'
import { DateRange, FilterSelect, KpiGrid, Stars, ViewOnly } from '@/components/ops/kit'
import { GrnForm, PoForm, VendorForm } from '@/components/ops/purchase/PurchaseForms'
import { PoDrawer, VendorDrawer } from '@/components/ops/purchase/PurchaseDrawers'

type Tab = 'pos' | 'vendors'

export default function PurchasePage() {
  const s = useSession()
  const canManage = s.can('purchase.manage')
  const pos = useTable('purchase_orders')
  const lines = useTable('purchase_order_lines')
  const movements = useTable('stock_movements')
  const vendors = useTable('vendors')
  const items = useTable('inventory_items')
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'vendors' ? 'vendors' : 'pos')

  // ?po=<id> opens a PO
  const [poId, setPoId] = useQueryParam('po')
  const livePo = pos.find((p) => p.id === poId)
  const drawerPo = useLast(livePo)
  useEffect(() => {
    if (poId && pos.length && !livePo) {
      toast.error('Purchase order not found')
      setPoId(null)
    }
  }, [poId, pos.length, livePo, setPoId])

  const poDlg = useDialog<{ po: PurchaseOrder | null; itemId?: string; vendorId?: string }>()
  const grnDlg = useDialog<PurchaseOrder>()
  const vendorDlg = useDialog<Vendor>()
  const [vendorView, setVendorView] = useState<string | null>(null)
  const liveVendor = vendors.find((v) => v.id === vendorView)
  const drawerVendor = useLast(liveVendor)

  // ?new=1&item=<id> → new PO prefilled with that item and its preferred vendor
  const handledNew = useRef(false)
  const showPo = poDlg.show
  useEffect(() => {
    if (params.get('new') !== '1' || handledNew.current) return
    handledNew.current = true
    const itemId = params.get('item') ?? undefined
    const found = itemId ? items.find((i) => i.id === itemId) : undefined
    if (!canManage) toast.error('You cannot raise purchase orders', 'Ask someone with purchase rights.')
    else {
      if (itemId && !found) toast.warning('Item not found', 'Starting an empty PO instead.')
      showPo({ po: null, itemId: found?.id })
    }
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('new')
        n.delete('item')
        return n
      },
      { replace: true },
    )
  }, [params, items, canManage, showPo, setParams])

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? 'vendor'
  const act = {
    approve: async (po: PurchaseOrder) => {
      if (await confirm({ title: `Approve ${po.po_no}?`, message: `${inr(po.total)} to ${vendorName(po.vendor_id)}. Approved POs can no longer be edited.`, confirmLabel: 'Approve' }))
        await guard(() => approvePo(po), `${po.po_no} approved`)
    },
    send: (po: PurchaseOrder) => void guard(() => markPoSent(po), `${po.po_no} marked as sent`),
    cancel: async (po: PurchaseOrder) => {
      const r = await confirmWithNote({ title: `Cancel ${po.po_no}?`, message: 'Inform the vendor separately.', danger: true, confirmLabel: 'Cancel PO', input: { label: 'Reason', required: true } })
      if (r.ok) await guard(() => cancelPo(po, r.note), `${po.po_no} cancelled`)
    },
    remove: async (po: PurchaseOrder) => {
      if (await confirm({ title: `Delete draft ${po.po_no}?`, danger: true, confirmLabel: 'Delete' })) {
        await guard(() => {
          deletePo(po)
          setPoId(null)
        }, 'Draft deleted')
      }
    },
    download: async (po: PurchaseOrder) => {
      await downloadPoPdf(po)
      audit('export', 'purchase_orders', po.id, `Downloaded PDF of ${po.po_no}`)
    },
  }

  const kpi = useMemo(() => purchaseKpis(pos, lines, todayISO()), [pos, lines, movements]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-w-0">
      <PageHeader
        kicker="Operations"
        title={<span className="flex flex-wrap items-center gap-2">Vendors & purchase <ViewOnly show={!canManage} /></span>}
        subtitle="Purchase orders with GST, approvals and goods receipts"
        actions={
          canManage && (
            <>
              {tab === 'pos' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => poDlg.show({ po: null })}>
                  New PO
                </Button>
              )}
              {tab === 'vendors' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => vendorDlg.show()}>
                  Add vendor
                </Button>
              )}
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pos', label: 'Purchase orders', count: kpi.pendingApproval },
          { value: 'vendors', label: 'Vendors' },
        ]}
      />

      {tab === 'pos' && (
        <PosTab
          kpi={kpi}
          canManage={canManage}
          onOpen={(p) => setPoId(p.id)}
          onApprove={(p) => void act.approve(p)}
          onSend={act.send}
          onReceive={(p) => grnDlg.show(p)}
          onDownload={(p) => void guard(() => act.download(p))}
        />
      )}
      {tab === 'vendors' && <VendorsTab onOpen={(v) => setVendorView(v.id)} />}

      {drawerPo && (
        <PoDrawer
          open={!!livePo}
          onClose={() => setPoId(null)}
          po={livePo ?? drawerPo}
          canManage={canManage}
          onEdit={() => poDlg.show({ po: livePo ?? drawerPo })}
          onApprove={() => void act.approve(livePo ?? drawerPo)}
          onSend={() => act.send(livePo ?? drawerPo)}
          onReceive={() => grnDlg.show(livePo ?? drawerPo)}
          onCancel={() => void act.cancel(livePo ?? drawerPo)}
          onDelete={() => void act.remove(livePo ?? drawerPo)}
          onDownload={() => act.download(livePo ?? drawerPo)}
          onOpenVendor={(id) => setVendorView(id)}
        />
      )}
      {drawerVendor && (
        <VendorDrawer
          open={!!liveVendor}
          onClose={() => setVendorView(null)}
          vendor={liveVendor ?? drawerVendor}
          canManage={canManage}
          onEdit={() => vendorDlg.show(liveVendor ?? drawerVendor)}
          onOpenPo={(id) => {
            setVendorView(null)
            setTab('pos')
            setPoId(id)
          }}
          onNewPo={() => {
            setVendorView(null)
            poDlg.show({ po: null, vendorId: drawerVendor.id })
          }}
          onDelete={async () => {
            const v = liveVendor ?? drawerVendor
            if (await confirm({ title: `Delete ${v.name}?`, message: 'Vendors with purchase orders cannot be deleted — mark them inactive instead.', danger: true, confirmLabel: 'Delete' })) {
              if (await guard(() => deleteVendor(v), 'Vendor deleted')) setVendorView(null)
            }
          }}
        />
      )}

      <PoForm key={`po${poDlg.key}`} open={poDlg.open} onClose={poDlg.close} po={poDlg.data?.po ?? null} prefillItemId={poDlg.data?.itemId} prefillVendorId={poDlg.data?.vendorId} onSaved={(p) => setPoId(p.id)} />
      {grnDlg.data && <GrnForm key={`g${grnDlg.key}`} open={grnDlg.open} onClose={grnDlg.close} po={grnDlg.data} />}
      <VendorForm key={`v${vendorDlg.key}`} open={vendorDlg.open} onClose={vendorDlg.close} vendor={vendorDlg.data} />
    </div>
  )
}

/* ─────────────────────────── Purchase orders ─────────────────────────── */

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'Open (approved / sent / partial)' },
  ...(['draft', 'approved', 'sent', 'partial', 'received', 'cancelled'] as PoStatus[]).map((st) => ({ value: st, label: PO_STATUS_LABEL[st] })),
]

function PosTab({
  kpi, canManage, onOpen, onApprove, onSend, onReceive, onDownload,
}: {
  kpi: ReturnType<typeof purchaseKpis>
  canManage: boolean
  onOpen: (p: PurchaseOrder) => void
  onApprove: (p: PurchaseOrder) => void
  onSend: (p: PurchaseOrder) => void
  onReceive: (p: PurchaseOrder) => void
  onDownload: (p: PurchaseOrder) => void
}) {
  const pos = useTable('purchase_orders')
  const vendors = useTable('vendors')
  const lines = useTable('purchase_order_lines')
  const today = todayISO()
  const [status, setStatus] = useState('')
  const [vendor, setVendor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const vMap = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors])
  const lineCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(l.po_id, (m.get(l.po_id) ?? 0) + 1)
    return m
  }, [lines])
  const rows = useMemo(
    () =>
      pos
        .filter((p) => (!status || (status === 'open' ? ['approved', 'sent', 'partial'].includes(p.status) : p.status === status)) && (!vendor || p.vendor_id === vendor) && (!from || p.date >= from) && (!to || p.date <= to))
        .sort((a, b) => (a.date === b.date ? b.po_no.localeCompare(a.po_no) : b.date.localeCompare(a.date))),
    [pos, status, vendor, from, to],
  )
  const total = rows.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.total, 0)

  const columns: Column<PurchaseOrder>[] = [
    { key: 'no', header: 'PO no.', value: (r) => r.po_no, cell: (r) => <span className="whitespace-nowrap font-semibold text-ink">{r.po_no}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, exportValue: (r) => fmtDate(r.date), cell: (r) => <span className="num whitespace-nowrap">{fmtDate(r.date)}</span> },
    {
      key: 'vendor', header: 'Vendor', value: (r) => vMap.get(r.vendor_id)?.name ?? '',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block max-w-[220px] truncate font-medium">{vMap.get(r.vendor_id)?.name ?? '—'}</span>
          <span className="text-[12px] text-ink-faint">{r.intra_state ? 'CGST+SGST' : 'IGST'} · {lineCount.get(r.id) ?? 0} lines</span>
        </span>
      ),
    },
    { key: 'sub', header: 'Taxable', align: 'right', value: (r) => r.subtotal, cell: (r) => inr(r.subtotal), hideOnMobile: true },
    { key: 'total', header: 'Total', align: 'right', value: (r) => r.total, cell: (r) => <span className="font-semibold">{inr(r.total)}</span> },
    {
      key: 'exp', header: 'Expected', value: (r) => r.expected_date ?? '', exportValue: (r) => fmtDate(r.expected_date),
      cell: (r) => {
        const st = poDeliveryState(r, today)
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="num whitespace-nowrap">{fmtDate(r.expected_date)}</span>
            {st === 'late' && <Badge tone="red">Late</Badge>}
            {st === 'due' && <Badge tone="amber">This week</Badge>}
          </span>
        )
      },
    },
    { key: 'status', header: 'Status', value: (r) => PO_STATUS_LABEL[r.status], cell: (r) => <StatusBadge status={r.status} label={PO_STATUS_LABEL[r.status]} /> },
    {
      key: 'act', header: '', export: false, sortable: false, align: 'right',
      cell: (r) => (
        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canManage && r.status === 'draft' && (
            <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onApprove(r)}>
              Approve
            </Button>
          )}
          {canManage && ['approved', 'sent', 'partial'].includes(r.status) && (
            <Button size="sm" variant="secondary" icon={<PackageCheck className="h-4 w-4" />} onClick={() => onReceive(r)}>
              GRN
            </Button>
          )}
          <Menu
            items={[
              { label: 'Download PDF', icon: <Download />, onClick: () => onDownload(r) },
              ...(canManage && r.status === 'approved' ? [{ label: 'Mark sent', icon: <Send />, onClick: () => onSend(r) }] : []),
            ]}
          />
        </span>
      ),
    },
  ]

  return (
    <div className="min-w-0">
      <KpiGrid>
        <StatCard label="Open PO value" value={kpi.openValue} format={(n) => inrCompact(n)} icon={<IndianRupee className="h-4 w-4" />} accent="indigo" hint={`${kpi.openCount} open · undelivered incl. GST`} onClick={() => setStatus('open')} />
        <StatCard label="Pending approval" value={kpi.pendingApproval} icon={<FileClock className="h-4 w-4" />} accent={kpi.pendingApproval ? 'amber' : 'green'} hint={kpi.pendingApproval ? `${inr(kpi.pendingValue)} in drafts` : 'Nothing waiting'} onClick={() => setStatus('draft')} />
        <StatCard label="Due this week" value={kpi.dueThisWeek} icon={<CalendarClock className="h-4 w-4" />} accent="cyan" hint={kpi.overdue ? `${kpi.overdue} overdue` : 'None overdue'} onClick={() => setStatus('open')} />
        <StatCard label={`Received · ${fmtMonth(monthOf(today), true)}`} value={kpi.receivedMonth} format={(n) => inrCompact(n)} icon={<PackageCheck className="h-4 w-4" />} accent="green" hint={`${kpi.receipts} stock receipt${kpi.receipts === 1 ? '' : 's'} (taxable value)`} />
      </KpiGrid>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        searchText={(r) => `${r.po_no} ${vMap.get(r.vendor_id)?.name} ${vMap.get(r.vendor_id)?.code} ${r.notes}`}
        searchPlaceholder="Search PO no., vendor, notes…"
        exportName="purchase-orders"
        exportSubtitle={`Total ${inr(total)} (excl. cancelled)`}
        toolbar={
          <>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} placeholder="All statuses" />
            <FilterSelect label="Vendor" value={vendor} onChange={setVendor} options={vendors.slice().sort((a, b) => a.name.localeCompare(b.name)).map((v) => ({ value: v.id, label: v.name }))} placeholder="All vendors" />
            <DateRange
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f)
                setTo(t)
              }}
            />
          </>
        }
        empty={<EmptyState title="No purchase orders" description={status || vendor || from || to ? 'Nothing matches these filters.' : 'Raise the first PO from here or from a low-stock item.'} icon={<FileClock className="h-6 w-6" />} />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink-faint">
                  {r.po_no} · {fmtDate(r.date)}
                </p>
                <p className="truncate font-semibold text-ink">{vMap.get(r.vendor_id)?.name}</p>
              </div>
              <StatusBadge status={r.status} label={PO_STATUS_LABEL[r.status]} />
            </div>
            <div className="flex items-center justify-between gap-2 text-[12.5px] text-ink-soft">
              <span>
                Expected {fmtDate(r.expected_date)}
                {poDeliveryState(r, today) === 'late' && <Badge tone="red" className="ml-1.5">Late</Badge>}
              </span>
              <span className="num text-sm font-semibold text-ink">{inr(r.total)}</span>
            </div>
          </div>
        )}
      />
    </div>
  )
}

/* ─────────────────────────── Vendors ─────────────────────────── */

function VendorsTab({ onOpen }: { onOpen: (v: Vendor) => void }) {
  const vendors = useTable('vendors')
  const pos = useTable('purchase_orders')
  const [cat, setCat] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const cats = useMemo(() => [...new Set(vendors.map((v) => v.category).filter(Boolean))].sort(), [vendors])
  const spend = useMemo(() => new Map(vendors.map((v) => [v.id, vendorSpend(v.id, pos)])), [vendors, pos])
  const rows = useMemo(() => vendors.filter((v) => (showInactive || v.active) && (!cat || v.category === cat)).sort((a, b) => a.code.localeCompare(b.code)), [vendors, cat, showInactive])

  const columns: Column<Vendor>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code, cell: (r) => <span className="font-semibold text-ink">{r.code}</span> },
    {
      key: 'name', header: 'Vendor', value: (r) => r.name,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block max-w-[240px] truncate font-medium">
            {r.name}
            {!r.active && <Badge tone="slate" className="ml-2">Inactive</Badge>}
          </span>
          <span className="text-[12px] text-ink-faint">{r.category || '—'}</span>
        </span>
      ),
    },
    { key: 'place', header: 'Location', value: (r) => `${r.city}, ${r.state}`, hideOnMobile: true },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin, cell: (r) => <span className="font-mono text-[12.5px]">{r.gstin || '—'}</span>, hideOnMobile: true },
    { key: 'terms', header: 'Terms', value: (r) => r.payment_terms_days, cell: (r) => `${r.payment_terms_days} d`, hideOnMobile: true },
    { key: 'rating', header: 'Rating', value: (r) => r.rating, cell: (r) => <Stars value={r.rating} size={14} /> },
    { key: 'pos', header: 'POs', align: 'right', value: (r) => spend.get(r.id)?.count ?? 0 },
    { key: 'spend', header: 'Spend', align: 'right', value: (r) => spend.get(r.id)?.value ?? 0, cell: (r) => <span className="font-semibold">{inr(spend.get(r.id)?.value ?? 0)}</span> },
  ]
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={onOpen}
      searchText={(r) => `${r.code} ${r.name} ${r.category} ${r.city} ${r.state} ${r.gstin} ${r.contact_person} ${r.phone} ${r.email}`}
      searchPlaceholder="Search vendor, city, GSTIN, contact…"
      exportName="vendors"
      initialSort={{ key: 'code', dir: 'asc' }}
      toolbar={
        <>
          <FilterSelect label="Category" value={cat} onChange={setCat} options={cats.map((c) => ({ value: c, label: c }))} placeholder="All categories" />
          <label className="inline-flex cursor-pointer items-center gap-2 px-1 text-[13px] text-ink">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-[18px] w-[18px] accent-[#6366f1]" />
            Show inactive
          </label>
        </>
      }
      empty={<EmptyState title="No vendors" icon={<Store className="h-6 w-6" />} />}
      mobileCard={(r) => (
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-ink-faint">
                {r.code} · {r.category}
              </p>
              <p className="truncate font-semibold text-ink">{r.name}</p>
              <p className="text-[12px] text-ink-soft">
                {r.city}, {r.state}
              </p>
            </div>
            <Stars value={r.rating} size={13} />
          </div>
          <div className="flex items-center justify-between text-[12.5px] text-ink-soft">
            <span>{spend.get(r.id)?.count ?? 0} POs</span>
            <span className="num font-semibold text-ink">{inr(spend.get(r.id)?.value ?? 0)}</span>
          </div>
        </div>
      )}
    />
  )
}
