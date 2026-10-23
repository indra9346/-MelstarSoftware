import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, Hammer, IndianRupee, PackageX, Pencil, Plus, Scale, ShieldAlert, ShoppingCart, Trash2, Undo2, Wrench,
} from 'lucide-react'
import { useTable } from '@/data/store'
import type { Asset, InventoryItem, ItemCategory, StockMovement, StockMovementType, ToolIssue } from '@/data/types'
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, Menu, PageHeader, StatCard, StatusBadge, Tabs, confirm, confirmWithNote, guard, toast, type Column } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { diffDays, fmtDate, monthOf, todayISO } from '@/lib/dates'
import { inr, inrCompact, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import {
  ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, ITEM_CATEGORIES, ITEM_CATEGORY_LABEL, calibrationState, deleteAsset, deleteItem, fmtQty, isLowStock, isOutOfStock, isToolOverdue,
  itemValue, markToolLost, toolOutstanding,
} from '@/services/inventory'
import { useDialog, useLast, useQueryParam } from '@/components/ops/form'
import { DateRange, FilterSelect, KpiGrid, StockBar, ViewOnly } from '@/components/ops/kit'
import { AssetForm, CalibrationForm, IssueToolForm, ItemForm, ReturnToolForm, StockMoveForm } from '@/components/ops/inventory/InventoryForms'
import { ItemDrawer, MOVE_LABEL, MOVE_TONE, SignedQty } from '@/components/ops/inventory/ItemDrawer'

type Tab = 'items' | 'movements' | 'tools' | 'assets'
const TABS: Tab[] = ['items', 'movements', 'tools', 'assets']

export default function InventoryPage() {
  const s = useSession()
  const canManage = s.can('inventory.manage')
  const canCal = s.canAny(['inventory.manage', 'quality.manage'])
  const canPo = s.can('purchase.manage')
  const navigate = useNavigate()
  const items = useTable('inventory_items')
  const issues = useTable('tool_issues')
  const assets = useTable('assets')
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'items'))

  // ?item=<id> opens the item drawer
  const [itemId, setItemId] = useQueryParam('item')
  const liveItem = items.find((i) => i.id === itemId)
  const drawerItem = useLast(liveItem)
  useEffect(() => {
    if (itemId && items.length && !liveItem) {
      toast.error('Item not found')
      setItemId(null)
    }
  }, [itemId, items.length, liveItem, setItemId])

  const itemDlg = useDialog<InventoryItem>()
  const moveDlg = useDialog<{ item: InventoryItem; mode: StockMovementType }>()
  const issueDlg = useDialog<string>()
  const returnDlg = useDialog<ToolIssue>()
  const assetDlg = useDialog<Asset>()
  const calDlg = useDialog<Asset>()

  const raisePo = (it: InventoryItem) => navigate(`/admin/purchase?new=1&item=${it.id}`)
  const today = todayISO()
  const overdueTools = issues.filter((t) => isToolOverdue(t, today)).length
  const calDue = assets.filter((a) => {
    const st = calibrationState(a, today)
    return st === 'overdue' || st === 'due_soon'
  }).length

  return (
    <div className="min-w-0">
      <PageHeader
        kicker="Operations"
        title={<span className="flex flex-wrap items-center gap-2">Inventory & assets <ViewOnly show={!canManage} /></span>}
        subtitle="Stores, tool crib, plant assets and gauge calibration"
        actions={
          canManage && (
            <>
              {tab === 'items' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => itemDlg.show()}>
                  Add item
                </Button>
              )}
              {tab === 'tools' && (
                <Button icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => issueDlg.show()}>
                  Issue tool
                </Button>
              )}
              {tab === 'assets' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => assetDlg.show()}>
                  Add asset
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
          { value: 'items', label: 'Items', count: items.filter(isLowStock).length },
          { value: 'movements', label: 'Stock movements' },
          { value: 'tools', label: 'Tool crib', count: overdueTools },
          { value: 'assets', label: 'Assets & calibration', count: calDue },
        ]}
      />

      {tab === 'items' && (
        <ItemsTab
          canManage={canManage}
          canPo={canPo}
          onOpen={(i) => setItemId(i.id)}
          onEdit={(i) => itemDlg.show(i)}
          onMove={(item, mode) => moveDlg.show({ item, mode })}
          onRaisePo={raisePo}
        />
      )}
      {tab === 'movements' && <MovementsTab onOpenItem={(id) => setItemId(id)} />}
      {tab === 'tools' && (
        <ToolsTab
          canManage={canManage}
          onReturn={(t) => returnDlg.show(t)}
          onLost={async (t, label) => {
            const r = await confirmWithNote({ title: 'Mark tool as lost?', message: `${label}. Stock is not restored.`, danger: true, confirmLabel: 'Mark lost', input: { label: 'How was it lost?', required: true } })
            if (r.ok) await guard(() => markToolLost(t, r.note), 'Marked as lost')
          }}
        />
      )}
      {tab === 'assets' && (
        <AssetsTab
          canManage={canManage}
          canCal={canCal}
          onEdit={(a) => assetDlg.show(a)}
          onCalibrate={(a) => calDlg.show(a)}
          onDelete={async (a) => {
            if (await confirm({ title: `Delete ${a.asset_code}?`, message: 'Consider marking it disposed instead to keep the record.', danger: true, confirmLabel: 'Delete' })) await guard(() => deleteAsset(a), 'Asset deleted')
          }}
        />
      )}

      {drawerItem && (
        <ItemDrawer
          open={!!liveItem}
          onClose={() => setItemId(null)}
          item={liveItem ?? drawerItem}
          canManage={canManage}
          canPo={canPo}
          onMove={(mode) => moveDlg.show({ item: liveItem ?? drawerItem, mode })}
          onEdit={() => itemDlg.show(liveItem ?? drawerItem)}
          onRaisePo={() => raisePo(drawerItem)}
        />
      )}

      <ItemForm key={`i${itemDlg.key}`} open={itemDlg.open} onClose={itemDlg.close} item={itemDlg.data} />
      {moveDlg.data && <StockMoveForm key={`mv${moveDlg.key}`} open={moveDlg.open} onClose={moveDlg.close} item={moveDlg.data.item} mode={moveDlg.data.mode} />}
      <IssueToolForm key={`t${issueDlg.key}`} open={issueDlg.open} onClose={issueDlg.close} itemId={issueDlg.data ?? undefined} />
      {returnDlg.data && <ReturnToolForm key={`r${returnDlg.key}`} open={returnDlg.open} onClose={returnDlg.close} issue={returnDlg.data} />}
      <AssetForm key={`a${assetDlg.key}`} open={assetDlg.open} onClose={assetDlg.close} asset={assetDlg.data} />
      {calDlg.data && <CalibrationForm key={`c${calDlg.key}`} open={calDlg.open} onClose={calDlg.close} asset={calDlg.data} />}
    </div>
  )
}

/* ─────────────────────────── Items ─────────────────────────── */

function ItemsTab({
  canManage, canPo, onOpen, onEdit, onMove, onRaisePo,
}: {
  canManage: boolean
  canPo: boolean
  onOpen: (i: InventoryItem) => void
  onEdit: (i: InventoryItem) => void
  onMove: (i: InventoryItem, mode: StockMovementType) => void
  onRaisePo: (i: InventoryItem) => void
}) {
  const items = useTable('inventory_items')
  const vendors = useTable('vendors')
  const [category, setCategory] = useState<ItemCategory | ''>('')
  const [lowOnly, setLowOnly] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const vMap = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors])

  const active = items.filter((i) => i.active)
  const kpi = useMemo(
    () => ({
      count: active.length,
      value: active.reduce((s, i) => s + itemValue(i), 0),
      low: active.filter(isLowStock).length,
      out: active.filter(isOutOfStock).length,
    }),
    [active],
  )
  const lowList = useMemo(() => active.filter(isLowStock).sort((a, b) => a.stock_qty / (a.reorder_level || 1) - b.stock_qty / (b.reorder_level || 1)), [active])
  const rows = useMemo(
    () => items.filter((i) => (showInactive || i.active) && (!category || i.category === category) && (!lowOnly || isLowStock(i))).sort((a, b) => a.sku.localeCompare(b.sku)),
    [items, category, lowOnly, showInactive],
  )

  const remove = async (i: InventoryItem) => {
    if (await confirm({ title: `Delete ${i.sku}?`, message: 'Only items with no stock, tool-crib or purchase history can be deleted.', danger: true, confirmLabel: 'Delete' })) await guard(() => deleteItem(i), 'Item deleted')
  }

  const columns: Column<InventoryItem>[] = [
    { key: 'sku', header: 'SKU', value: (r) => r.sku, cell: (r) => <span className="whitespace-nowrap font-semibold text-ink">{r.sku}</span> },
    { key: 'name', header: 'Item', value: (r) => r.name, cell: (r) => <span className="block max-w-[240px] truncate" title={r.name}>{r.name}{!r.active && <Badge tone="slate" className="ml-2">Inactive</Badge>}</span> },
    { key: 'cat', header: 'Category', value: (r) => ITEM_CATEGORY_LABEL[r.category], hideOnMobile: true },
    { key: 'stock', header: 'Stock', value: (r) => r.stock_qty, exportValue: (r) => r.stock_qty, cell: (r) => <StockBar qty={r.stock_qty} reorder={r.reorder_level} className="w-36" /> },
    { key: 'uom', header: 'UoM', value: (r) => r.uom },
    { key: 'cost', header: 'Unit cost', align: 'right', value: (r) => r.unit_cost, cell: (r) => inr(r.unit_cost), hideOnMobile: true },
    { key: 'value', header: 'Value', align: 'right', value: (r) => itemValue(r), cell: (r) => <span className="font-semibold">{inr(itemValue(r))}</span> },
    { key: 'loc', header: 'Location', value: (r) => r.location, hideOnMobile: true },
    {
      key: 'act', header: '', export: false, sortable: false, align: 'right',
      cell: (r) => (
        <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canPo && isLowStock(r) && (
            <Button size="sm" variant="outline" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={() => onRaisePo(r)}>
              Raise PO
            </Button>
          )}
          {canManage && (
            <Menu
              items={[
                { label: 'Stock in', icon: <ArrowDownToLine />, onClick: () => onMove(r, 'in') },
                { label: 'Stock out', icon: <ArrowUpFromLine />, onClick: () => onMove(r, 'out'), disabled: r.stock_qty <= 0 },
                { label: 'Adjust (count)', icon: <Scale />, onClick: () => onMove(r, 'adjust') },
                { label: 'Edit item', icon: <Pencil />, onClick: () => onEdit(r) },
                { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => void remove(r) },
              ]}
            />
          )}
        </span>
      ),
    },
  ]

  return (
    <div className="min-w-0">
      <KpiGrid>
        <StatCard label="Active items" value={kpi.count} icon={<Boxes className="h-4 w-4" />} accent="indigo" hint={`${items.length - kpi.count} inactive`} />
        <StatCard label="Stock value" value={kpi.value} format={(n) => inrCompact(n)} icon={<IndianRupee className="h-4 w-4" />} accent="cyan" hint="Σ qty × unit cost" />
        <StatCard label="Low stock" value={kpi.low} icon={<AlertTriangle className="h-4 w-4" />} accent={kpi.low ? 'amber' : 'green'} hint="At or below re-order level" onClick={() => setLowOnly(true)} />
        <StatCard label="Out of stock" value={kpi.out} icon={<PackageX className="h-4 w-4" />} accent={kpi.out ? 'red' : 'green'} hint="Zero on hand" />
      </KpiGrid>

      {lowList.length > 0 && (
        <Card className="mb-5 min-w-0 overflow-hidden">
          <CardHeader title="Needs re-ordering" subtitle={`${lowList.length} item${lowList.length === 1 ? '' : 's'} at or below re-order level`} icon={<AlertTriangle className="h-4 w-4" />} />
          <div className="flex gap-2.5 overflow-x-auto px-4 pb-4 pt-3 scroll-thin sm:px-5">
            {lowList.slice(0, 12).map((i) => (
              <div key={i.id} className="w-[220px] shrink-0 rounded-lg border border-amber-200/80 bg-amber-50/40 p-3">
                <button type="button" className="block w-full min-w-0 text-left" onClick={() => onOpen(i)}>
                  <p className="text-[11.5px] font-semibold text-ink-faint">{i.sku}</p>
                  <p className="truncate text-sm font-medium text-ink">{i.name}</p>
                </button>
                <StockBar qty={i.stock_qty} reorder={i.reorder_level} uom={i.uom} className="mt-2" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate text-[11.5px] text-ink-soft">{vMap.get(i.preferred_vendor_id ?? '')?.name ?? 'No preferred vendor'}</span>
                  {canPo && (
                    <Button size="icon-sm" variant="outline" onClick={() => onRaisePo(i)} aria-label={`Raise PO for ${i.sku}`} title="Raise PO">
                      <ShoppingCart className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        searchText={(r) => `${r.sku} ${r.name} ${r.location} ${r.hsn} ${ITEM_CATEGORY_LABEL[r.category]}`}
        searchPlaceholder="Search SKU, name, location, HSN…"
        exportName="inventory-items"
        exportSubtitle={`Stock as on ${fmtDate(todayISO())}`}
        toolbar={
          <>
            <FilterSelect label="Category" value={category} onChange={(v) => setCategory(v as ItemCategory | '')} options={ITEM_CATEGORIES} placeholder="All categories" />
            <Checkbox checked={lowOnly} onChange={setLowOnly} label="Low stock only" className="px-1 text-[13px]" />
            <Checkbox checked={showInactive} onChange={setShowInactive} label="Show inactive" className="px-1 text-[13px]" />
          </>
        }
        empty={<EmptyState title={lowOnly ? 'Nothing is low' : 'No items'} description={lowOnly ? 'Every active item is above its re-order level.' : 'Add items to start tracking stock.'} icon={<Boxes className="h-6 w-6" />} />}
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink-faint">{r.sku}</p>
                <p className="truncate font-semibold text-ink">{r.name}</p>
                <p className="text-[12px] text-ink-soft">{ITEM_CATEGORY_LABEL[r.category]} · {r.location || '—'}</p>
              </div>
              <span className="num shrink-0 text-sm font-medium">{inr(itemValue(r))}</span>
            </div>
            <StockBar qty={r.stock_qty} reorder={r.reorder_level} uom={r.uom} />
            {canPo && isLowStock(r) && (
              <span onClick={(e) => e.stopPropagation()} className="block">
                <Button size="sm" variant="outline" icon={<ShoppingCart className="h-3.5 w-3.5" />} onClick={() => onRaisePo(r)}>
                  Raise PO
                </Button>
              </span>
            )}
          </div>
        )}
      />
    </div>
  )
}

/* ─────────────────────────── Movements ledger ─────────────────────────── */

function MovementsTab({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const movements = useTable('stock_movements')
  const items = useTable('inventory_items')
  const L = useLookups()
  const [item, setItem] = useState('')
  const [type, setType] = useState<StockMovementType | ''>('')
  const [from, setFrom] = useState(() => `${monthOf(todayISO())}-01`)
  const [to, setTo] = useState('')
  const iMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const rows = useMemo(
    () =>
      movements
        .filter((m) => (!item || m.item_id === item) && (!type || m.type === type) && (!from || m.date >= from) && (!to || m.date <= to))
        .sort((a, b) => (a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date))),
    [movements, item, type, from, to],
  )
  const ins = rows.filter((m) => m.type === 'in').reduce((s, m) => s + m.qty * (iMap.get(m.item_id)?.unit_cost ?? 0), 0)
  const outs = rows.filter((m) => m.type === 'out').reduce((s, m) => s + m.qty * (iMap.get(m.item_id)?.unit_cost ?? 0), 0)

  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Date', value: (r) => r.date, exportValue: (r) => fmtDate(r.date), cell: (r) => <span className="num whitespace-nowrap">{fmtDate(r.date)}</span> },
    {
      key: 'item', header: 'Item', value: (r) => iMap.get(r.item_id)?.sku ?? '',
      exportValue: (r) => `${iMap.get(r.item_id)?.sku ?? ''} ${iMap.get(r.item_id)?.name ?? ''}`,
      cell: (r) => (
        <button
          type="button"
          className="block min-w-0 text-left"
          onClick={(e) => {
            e.stopPropagation()
            onOpenItem(r.item_id)
          }}
        >
          <span className="block text-[12px] font-medium text-ink-faint">{iMap.get(r.item_id)?.sku}</span>
          <span className="block max-w-[220px] truncate hover:text-brand-600">{iMap.get(r.item_id)?.name ?? '—'}</span>
        </button>
      ),
    },
    { key: 'type', header: 'Type', value: (r) => MOVE_LABEL[r.type], cell: (r) => <Badge tone={MOVE_TONE[r.type]}>{MOVE_LABEL[r.type]}</Badge> },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.qty, exportValue: (r) => (r.type === 'out' ? -r.qty : r.qty), cell: (r) => <SignedQty m={r} uom={iMap.get(r.item_id)?.uom} /> },
    { key: 'bal', header: 'Balance after', align: 'right', value: (r) => r.balance_after, cell: (r) => <span className="num">{fmtQty(r.balance_after)}</span> },
    { key: 'ref', header: 'Reference', value: (r) => r.reference, cell: (r) => <span className="whitespace-nowrap font-medium">{r.reference || '—'}</span> },
    { key: 'reason', header: 'Reason', value: (r) => r.reason, cell: (r) => <span className="block max-w-[220px] truncate" title={r.reason}>{r.reason || '—'}</span>, hideOnMobile: true },
    { key: 'by', header: 'By', value: (r) => L.userName(r.by_user_id), hideOnMobile: true },
  ]
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-soft">
        <span>
          <b className="num text-ink">{rows.length}</b> movements
        </span>
        <span>
          Received <b className="num text-emerald-700">{inr(ins)}</b>
        </span>
        <span>
          Issued <b className="num text-amber-700">{inr(outs)}</b>
        </span>
        <span className="text-ink-faint">valued at current unit cost</span>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        dense
        searchText={(r) => `${iMap.get(r.item_id)?.sku} ${iMap.get(r.item_id)?.name} ${r.reference} ${r.reason}`}
        searchPlaceholder="Search item, reference, reason…"
        exportName="stock-ledger"
        exportSubtitle={`${from ? fmtDate(from) : 'Beginning'} – ${to ? fmtDate(to) : fmtDate(todayISO())}`}
        pageSize={40}
        toolbar={
          <>
            <FilterSelect label="Item" value={item} onChange={setItem} options={items.slice().sort((a, b) => a.sku.localeCompare(b.sku)).map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` }))} placeholder="All items" className="xs:max-w-[240px]" />
            <FilterSelect label="Type" value={type} onChange={(v) => setType(v as StockMovementType | '')} options={(['in', 'out', 'adjust'] as const).map((t) => ({ value: t, label: MOVE_LABEL[t] }))} placeholder="All types" />
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
        empty={<EmptyState title="No movements" description="Nothing in this period — widen the date range." icon={<Scale className="h-6 w-6" />} />}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] text-ink-faint">
                {fmtDate(r.date)} · {iMap.get(r.item_id)?.sku}
              </p>
              <p className="truncate font-semibold text-ink">{iMap.get(r.item_id)?.name}</p>
              <p className="truncate text-[12px] text-ink-soft">
                {r.reference || '—'} · {r.reason}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <SignedQty m={r} uom={iMap.get(r.item_id)?.uom} />
              <p className="num text-[12px] text-ink-faint">bal {fmtQty(r.balance_after)}</p>
            </div>
          </div>
        )}
      />
    </div>
  )
}

/* ─────────────────────────── Tool crib ─────────────────────────── */

type ToolFilter = 'out' | 'overdue' | 'returned' | 'lost' | 'all'

function ToolsTab({ canManage, onReturn, onLost }: { canManage: boolean; onReturn: (t: ToolIssue) => void; onLost: (t: ToolIssue, label: string) => void }) {
  const issues = useTable('tool_issues')
  const items = useTable('inventory_items')
  const L = useLookups()
  const today = todayISO()
  const [filter, setFilter] = useState<ToolFilter>('out')
  const iMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const ym = monthOf(today)
  const stats = useMemo(
    () => ({
      out: issues.filter((t) => t.status === 'issued').length,
      overdue: issues.filter((t) => isToolOverdue(t, today)).length,
      returned: issues.filter((t) => t.status === 'returned' && t.returned_on && monthOf(t.returned_on) === ym).length,
      broken: issues.filter((t) => t.status === 'returned' && t.condition === 'broken' && t.returned_on && monthOf(t.returned_on) === ym).length,
      lost: issues.filter((t) => t.status === 'lost').length,
    }),
    [issues, today, ym],
  )
  const rows = useMemo(
    () =>
      issues
        .filter((t) => (filter === 'all' ? true : filter === 'out' ? t.status === 'issued' : filter === 'overdue' ? isToolOverdue(t, today) : t.status === filter))
        .sort((a, b) => (a.status === 'issued') === (b.status === 'issued') ? b.issued_on.localeCompare(a.issued_on) : a.status === 'issued' ? -1 : 1),
    [issues, filter, today],
  )
  const label = (t: ToolIssue) => `${fmtQty(toolOutstanding(t))} × ${iMap.get(t.item_id)?.sku ?? 'tool'} with ${L.empName(t.employee_id)}`

  const columns: Column<ToolIssue>[] = [
    {
      key: 'tool', header: 'Tool', value: (r) => iMap.get(r.item_id)?.sku ?? '',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block text-[12px] font-medium text-ink-faint">{iMap.get(r.item_id)?.sku}</span>
          <span className="block max-w-[200px] truncate">{iMap.get(r.item_id)?.name}</span>
        </span>
      ),
    },
    { key: 'emp', header: 'Issued to', value: (r) => L.empName(r.employee_id), cell: (r) => <EmployeeCell id={r.employee_id} size={28} sub="code" /> },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.qty, cell: (r) => <span className="num">{fmtQty(r.qty)}{r.status === 'issued' && r.returned_qty > 0 && <span className="block text-[11.5px] text-ink-soft">{fmtQty(toolOutstanding(r))} still out</span>}</span> },
    { key: 'issued', header: 'Issued', value: (r) => r.issued_on, exportValue: (r) => fmtDate(r.issued_on), cell: (r) => <span className="num whitespace-nowrap">{fmtDate(r.issued_on)}</span> },
    {
      key: 'due', header: 'Due back', value: (r) => r.due_back ?? '', exportValue: (r) => fmtDate(r.due_back),
      cell: (r) =>
        isToolOverdue(r, today) ? (
          <Badge tone="red" dot>
            {fmtDate(r.due_back)} · {diffDays(r.due_back!, today)} d late
          </Badge>
        ) : (
          <span className="num whitespace-nowrap">{fmtDate(r.due_back)}</span>
        ),
    },
    {
      key: 'status', header: 'Status', value: (r) => r.status,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge status={r.status} />
          {r.status === 'returned' && (
            <span className="text-[11.5px] text-ink-soft">
              {fmtQty(r.returned_qty)} back · {r.condition} · {fmtDate(r.returned_on)}
            </span>
          )}
        </span>
      ),
    },
    { key: 'remarks', header: 'Remarks', value: (r) => r.remarks, cell: (r) => <span className="block max-w-[200px] truncate" title={r.remarks}>{r.remarks || '—'}</span>, hideOnMobile: true },
    {
      key: 'act', header: '', export: false, sortable: false, align: 'right',
      cell: (r) =>
        canManage && r.status === 'issued' ? (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => onReturn(r)}>
              Return
            </Button>
            <Menu items={[{ label: 'Mark lost', icon: <ShieldAlert />, danger: true, onClick: () => onLost(r, label(r)) }]} />
          </span>
        ) : null,
    },
  ]
  return (
    <div className="min-w-0">
      <KpiGrid>
        <StatCard label="On issue" value={stats.out} icon={<Hammer className="h-4 w-4" />} accent="indigo" onClick={() => setFilter('out')} />
        <StatCard label="Overdue returns" value={stats.overdue} icon={<AlertTriangle className="h-4 w-4" />} accent={stats.overdue ? 'red' : 'green'} onClick={() => setFilter('overdue')} hint="Past due-back date" />
        <StatCard label="Returned this month" value={stats.returned} icon={<Undo2 className="h-4 w-4" />} accent="green" hint={`${stats.broken} broken / scrapped`} onClick={() => setFilter('returned')} />
        <StatCard label="Lost (all time)" value={stats.lost} icon={<ShieldAlert className="h-4 w-4" />} accent={stats.lost ? 'amber' : 'cyan'} onClick={() => setFilter('lost')} />
      </KpiGrid>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchText={(r) => `${iMap.get(r.item_id)?.sku} ${iMap.get(r.item_id)?.name} ${L.empName(r.employee_id)} ${r.remarks}`}
        searchPlaceholder="Search tool or person…"
        exportName="tool-crib"
        toolbar={
          <FilterSelect
            label="Status"
            value={filter}
            onChange={(v) => setFilter(v as ToolFilter)}
            options={[
              { value: 'out', label: `On issue (${stats.out})` },
              { value: 'overdue', label: `Overdue (${stats.overdue})` },
              { value: 'returned', label: 'Returned' },
              { value: 'lost', label: 'Lost' },
              { value: 'all', label: 'Everything' },
            ]}
          />
        }
        empty={<EmptyState title={filter === 'overdue' ? 'No overdue tools' : 'Nothing here'} description={filter === 'out' ? 'No tools are out on issue.' : undefined} icon={<Wrench className="h-6 w-6" />} />}
        mobileCard={(r) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink-faint">{iMap.get(r.item_id)?.sku}</p>
                <p className="truncate font-semibold text-ink">{iMap.get(r.item_id)?.name}</p>
              </div>
              {isToolOverdue(r, today) ? <Badge tone="red" dot>Overdue</Badge> : <StatusBadge status={r.status} />}
            </div>
            <div className="flex items-center justify-between gap-2">
              <EmployeeCell id={r.employee_id} size={26} sub="none" />
              <span className="num shrink-0 text-[12.5px] text-ink-soft">
                {fmtQty(r.status === 'issued' ? toolOutstanding(r) : r.qty)} · due {fmtDate(r.due_back)}
              </span>
            </div>
            {canManage && r.status === 'issued' && (
              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => onReturn(r)}>
                  Return
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onLost(r, label(r))}>
                  Mark lost
                </Button>
              </div>
            )}
          </div>
        )}
      />
    </div>
  )
}

/* ─────────────────────────── Assets & calibration ─────────────────────────── */

function AssetsTab({ canManage, canCal, onEdit, onCalibrate, onDelete }: { canManage: boolean; canCal: boolean; onEdit: (a: Asset) => void; onCalibrate: (a: Asset) => void; onDelete: (a: Asset) => void }) {
  const assets = useTable('assets')
  const L = useLookups()
  const today = todayISO()
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const due = useMemo(
    () =>
      assets
        .filter((a) => {
          const st = calibrationState(a, today)
          return st === 'overdue' || st === 'due_soon' || st === 'not_set'
        })
        .sort((a, b) => (a.calibration_due ?? '').localeCompare(b.calibration_due ?? '')),
    [assets, today],
  )
  const rows = useMemo(() => assets.filter((a) => (!category || a.category === category) && (!status || a.status === status)).sort((a, b) => a.asset_code.localeCompare(b.asset_code)), [assets, category, status])
  const totalCost = rows.filter((a) => a.status !== 'disposed').reduce((s, a) => s + a.cost, 0)

  const calCell = (a: Asset) => {
    const st = calibrationState(a, today)
    if (!st) return <span className="text-ink-faint">—</span>
    if (st === 'not_set') return <Badge tone="amber">Not set</Badge>
    if (st === 'overdue') return <Badge tone="red" dot>Overdue {diffDays(a.calibration_due!, today)} d</Badge>
    if (st === 'due_soon') return <Badge tone="amber" dot>Due {fmtDate(a.calibration_due)}</Badge>
    return <span className="num whitespace-nowrap text-ink-soft">{fmtDate(a.calibration_due)}</span>
  }

  const columns: Column<Asset>[] = [
    { key: 'code', header: 'Code', value: (r) => r.asset_code, cell: (r) => <span className="whitespace-nowrap font-semibold text-ink">{r.asset_code}</span> },
    { key: 'name', header: 'Asset', value: (r) => r.name, cell: (r) => <span className="block min-w-0"><span className="block max-w-[220px] truncate">{r.name}</span><span className="block text-[12px] text-ink-faint">{r.make}</span></span> },
    { key: 'cat', header: 'Category', value: (r) => ASSET_CATEGORY_LABEL[r.category], hideOnMobile: true },
    { key: 'cust', header: 'Custodian', value: (r) => L.empName(r.custodian_id), cell: (r) => <EmployeeCell id={r.custodian_id} size={26} sub="none" /> },
    { key: 'loc', header: 'Location', value: (r) => r.location, hideOnMobile: true },
    { key: 'cost', header: 'Cost', align: 'right', value: (r) => r.cost, cell: (r) => inr(r.cost), hideOnMobile: true },
    { key: 'cal', header: 'Calibration due', value: (r) => r.calibration_due ?? '', exportValue: (r) => (r.calibration_required ? fmtDate(r.calibration_due) : 'n/a'), cell: calCell },
    { key: 'status', header: 'Status', value: (r) => ASSET_STATUS_LABEL[r.status], cell: (r) => <StatusBadge status={r.status} label={ASSET_STATUS_LABEL[r.status]} /> },
    {
      key: 'act', header: '', export: false, sortable: false, align: 'right',
      cell: (r) =>
        canManage || (canCal && r.calibration_required) ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu
              items={[
                ...(canCal && r.calibration_required ? [{ label: 'Record calibration', icon: <ClipboardCheck />, onClick: () => onCalibrate(r) }] : []),
                ...(canManage ? [{ label: 'Edit asset', icon: <Pencil />, onClick: () => onEdit(r) }, { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => onDelete(r) }] : []),
              ]}
            />
          </span>
        ) : null,
    },
  ]

  return (
    <div className="min-w-0 space-y-5">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader
          title="Calibration due"
          subtitle={due.length ? `${due.filter((a) => calibrationState(a, today) === 'overdue').length} overdue · ${due.filter((a) => calibrationState(a, today) === 'due_soon').length} due within 30 days` : 'All gauges and instruments are within their calibration period'}
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <div className="px-4 pb-4 pt-3 sm:px-5">
          {due.length ? (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {due.map((a) => {
                const st = calibrationState(a, today)
                return (
                  <li
                    key={a.id}
                    className={cn('flex min-w-0 items-center gap-3 rounded-lg border px-3.5 py-2.5', st === 'overdue' ? 'border-rose-200 bg-rose-50/50' : 'border-amber-200 bg-amber-50/40')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                      <p className="truncate text-[12px] text-ink-soft">
                        {a.asset_code} · {a.location || '—'} · every {num(a.calibration_interval_days, 0)} d
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {calCell(a)}
                      {canCal && (
                        <button type="button" onClick={() => onCalibrate(a)} className="mt-1 block text-[13px] font-medium text-brand-600 hover:underline">
                          Record calibration
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Nothing due in the next 30 days.</p>
          )}
        </div>
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={canManage ? onEdit : undefined}
        searchText={(r) => `${r.asset_code} ${r.name} ${r.make} ${r.serial_no} ${r.location} ${L.empName(r.custodian_id)} ${r.certificate_no}`}
        searchPlaceholder="Search code, name, serial, custodian…"
        exportName="asset-register"
        exportSubtitle={`Book cost ${inr(totalCost)}`}
        toolbar={
          <>
            <FilterSelect label="Category" value={category} onChange={setCategory} options={Object.entries(ASSET_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} placeholder="All categories" />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={Object.entries(ASSET_STATUS_LABEL).map(([value, label]) => ({ value, label }))} placeholder="All statuses" />
          </>
        }
        empty={<EmptyState title="No assets" icon={<Boxes className="h-6 w-6" />} />}
      />
    </div>
  )
}
