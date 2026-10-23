/** Inventory dialogs: item, stock in / out / adjust, tool issue & return, asset, calibration. */
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Scale } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { Asset, AssetCategory, InventoryItem, ItemCategory, StockMovementType, ToolIssue } from '@/data/types'
import { Badge, Field, Modal, Segmented, guard, toast } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { addDays, fmtDate, todayISO } from '@/lib/dates'
import { inr, num, round2 } from '@/lib/format'
import { cn } from '@/lib/misc'
import {
  ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, ITEM_CATEGORIES, UOMS, assetErrors, createItem, fmtQty, issueTool, issueToolErrors, itemErrors, postMovement, recordCalibration,
  returnTool, round3, saveAsset, toolOutstanding, updateItem, type AssetInput, type ItemInput,
} from '@/services/inventory'
import { useForm, toNum, numStr } from '../form'
import { AreaF, DateF, NumF, SelectF, SwitchF, TextF } from '../fields'
import { ModalActions, StockBar } from '../kit'

interface DialogProps {
  open: boolean
  onClose: () => void
}

/* ─────────────────────────── item ─────────────────────────── */

interface ItemV { sku: string; name: string; category: string; uom: string; reorder_level: string; unit_cost: string; location: string; hsn: string; preferred_vendor_id: string; active: boolean; opening: string }

export function ItemForm({ open, onClose, item }: DialogProps & { item: InventoryItem | null }) {
  const vendors = useTable('vendors')
  const f = useForm<ItemV>(
    () => ({
      sku: item?.sku ?? '', name: item?.name ?? '', category: item?.category ?? 'raw_material', uom: item?.uom ?? 'nos', reorder_level: numStr(item?.reorder_level ?? 0),
      unit_cost: numStr(item?.unit_cost ?? 0), location: item?.location ?? '', hsn: item?.hsn ?? '', preferred_vendor_id: item?.preferred_vendor_id ?? '', active: item?.active ?? true, opening: '',
    }),
    (v) => itemErrors({ ...toInput(v), opening: item ? null : toNum(v.opening) }, item?.id),
  )
  function toInput(v: ItemV): ItemInput {
    return { ...v, category: v.category as ItemCategory, reorder_level: toNum(v.reorder_level), unit_cost: toNum(v.unit_cost), preferred_vendor_id: v.preferred_vendor_id || null }
  }
  const uoms = item && !UOMS.includes(item.uom) ? [...UOMS, item.uom] : UOMS
  const opening = toNum(f.v.opening) ?? 0
  const submit = () =>
    void guard(async () => {
      if (item) updateItem(item, toInput(f.v))
      else createItem(toInput(f.v), opening)
      await db.flushed()
      onClose()
    }, item ? 'Item updated' : 'Item added')
  return (
    <Modal open={open} onClose={onClose} size="lg" title={item ? `Edit ${item.sku}` : 'Add inventory item'} subtitle={item ? 'Stock is changed only through stock in / out / adjust' : 'Raw material, tooling, consumable, spare, packing or finished good'} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={item ? 'Save changes' : 'Add item'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextF f={f} k="sku" label="SKU" required placeholder="RM-EN8-80" onBlur={() => f.set('sku', f.v.sku.trim().toUpperCase())} />
        <SelectF f={f} k="category" label="Category" required options={ITEM_CATEGORIES} />
        <TextF f={f} k="name" label="Name" required className="sm:col-span-2" placeholder="EN8 round bar Ø80 mm" />
        <SelectF f={f} k="uom" label="Unit of measure" required options={uoms.map((u) => ({ value: u, label: u }))} />
        <TextF f={f} k="hsn" label="HSN code" inputMode="numeric" placeholder="72142090" />
        <NumF f={f} k="reorder_level" label="Re-order level" required min={0} hint="Low-stock alert at or below this" />
        <NumF f={f} k="unit_cost" label="Unit cost (₹)" required min={0} hint={toNum(f.v.unit_cost) ? `${inr(toNum(f.v.unit_cost))} per ${f.v.uom}` : undefined} />
        <TextF f={f} k="location" label="Store location" placeholder="Bar rack A1" />
        <SelectF f={f} k="preferred_vendor_id" label="Preferred vendor" options={vendors.filter((v) => v.active || v.id === item?.preferred_vendor_id).map((v) => ({ value: v.id, label: `${v.code} — ${v.name}` }))} placeholder="— None —" />
        {!item && <NumF f={f} k="opening" label="Opening stock" min={0} hint={opening > 0 ? `Posted as an opening adjustment · value ${inr(opening * (toNum(f.v.unit_cost) ?? 0))}` : 'Optional — leave blank for zero'} />}
        <SwitchF f={f} k="active" label="Active" description="Inactive items are hidden from pickers" className="sm:col-span-2" />
      </div>
    </Modal>
  )
}

/* ─────────────────────────── stock in / out / adjust ─────────────────────────── */

const REASONS: Record<StockMovementType, string[]> = {
  in: ['Goods receipt', 'Production receipt', 'Returned from shop floor', 'Transfer in', 'Customer return'],
  out: ['Issued to production', 'Issued to maintenance', 'Issued to tool crib', 'Scrapped', 'Sample / testing', 'Transfer out'],
  adjust: ['Physical stock count', 'Damaged in store', 'Data correction'],
}
const MODE_META: Record<StockMovementType, { title: string; verb: string; icon: JSX.Element }> = {
  in: { title: 'Stock in', verb: 'Receive', icon: <ArrowDownToLine className="h-4 w-4" /> },
  out: { title: 'Stock out', verb: 'Issue', icon: <ArrowUpFromLine className="h-4 w-4" /> },
  adjust: { title: 'Stock adjustment', verb: 'Post adjustment', icon: <Scale className="h-4 w-4" /> },
}

interface MoveV { qty: string; date: string; reference: string; reason: string }

export function StockMoveForm({ open, onClose, item, mode }: DialogProps & { item: InventoryItem; mode: StockMovementType }) {
  const live = useTable('inventory_items').find((i) => i.id === item.id) ?? item
  const f = useForm<MoveV>(
    () => ({ qty: '', date: todayISO(), reference: '', reason: REASONS[mode][0]! }),
    (v) => {
      const q = toNum(v.qty)
      const e: Partial<Record<keyof MoveV, string>> = {}
      if (q == null) e.qty = mode === 'adjust' ? 'Enter the counted quantity' : 'Enter the quantity'
      else if (mode === 'adjust' ? q < 0 : q <= 0) e.qty = mode === 'adjust' ? 'Cannot be negative' : 'Must be greater than zero'
      else if (round3(q) !== q) e.qty = 'At most 3 decimals'
      else if (mode === 'out' && q > live.stock_qty) e.qty = `Only ${fmtQty(live.stock_qty)} ${live.uom} in stock`
      else if (mode === 'adjust' && round3(q) === live.stock_qty) e.qty = 'Same as book stock — nothing to adjust'
      if (!v.date) e.date = 'Required'
      else if (v.date > todayISO()) e.date = 'Cannot be in the future'
      if (!v.reason.trim()) e.reason = 'Give a reason'
      if (mode !== 'adjust' && !v.reference.trim()) e.reference = 'Reference (PO, WO, DC, slip no.) is required'
      return e
    },
  )
  const q = toNum(f.v.qty)
  const after = q == null ? null : mode === 'in' ? round3(live.stock_qty + q) : mode === 'out' ? round3(live.stock_qty - q) : round3(q)
  const delta = after == null ? null : round3(after - live.stock_qty)
  const meta = MODE_META[mode]
  const submit = () =>
    void guard(async () => {
      postMovement({ itemId: live.id, type: mode, qty: q!, date: f.v.date, reference: mode === 'adjust' && !f.v.reference.trim() ? 'STOCK COUNT' : f.v.reference, reason: f.v.reason })
      await db.flushed()
      onClose()
      toast.success(`${meta.title} posted`, `${live.sku}: balance ${fmtQty(after!)} ${live.uom}`)
    })
  return (
    <Modal open={open} onClose={onClose} title={`${meta.title} · ${live.sku}`} subtitle={live.name} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={meta.verb} icon={meta.icon} variant={mode === 'out' ? 'primary' : mode === 'in' ? 'success' : 'primary'} />}>
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-slate-50 p-3.5">
          <StockBar qty={live.stock_qty} reorder={live.reorder_level} uom={live.uom} />
          <p className="mt-1.5 text-[12px] text-ink-soft">Book stock · {live.location || 'no location'} · {inr(live.unit_cost)}/{live.uom}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumF f={f} k="qty" label={mode === 'adjust' ? `Counted quantity (${live.uom})` : `Quantity (${live.uom})`} required min={0} autoFocus />
          <DateF f={f} k="date" label="Date" required max={todayISO()} />
          <TextF f={f} k="reference" label="Reference" required={mode !== 'adjust'} placeholder={mode === 'in' ? 'PO / DC no.' : mode === 'out' ? 'WO-1042 / slip no.' : 'Count sheet no.'} />
          <Field label="Reason" required error={f.err('reason')}>
            <input list={`reasons-${mode}`} value={f.v.reason} onChange={(e) => f.set('reason', e.target.value)} className="field-input" aria-invalid={!!f.err('reason') || undefined} />
            <datalist id={`reasons-${mode}`}>
              {REASONS[mode].map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
        </div>
        {after != null && delta != null && after >= 0 && (
          <div className={cn('grid grid-cols-3 gap-2 rounded-lg border px-3.5 py-3 text-center', delta < 0 ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60')}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Now</p>
              <p className="num font-semibold text-ink">{fmtQty(live.stock_qty)}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Change</p>
              <p className={cn('num font-semibold', delta < 0 ? 'text-amber-700' : 'text-emerald-700')}>
                {delta > 0 ? '+' : ''}
                {fmtQty(delta)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">After</p>
              <p className="num font-semibold text-ink">{fmtQty(after)}</p>
            </div>
            <p className="col-span-3 text-[12px] text-ink-soft">
              Value impact {delta < 0 ? '−' : '+'}
              {inr(Math.abs(round2(delta * live.unit_cost)))}
              {live.reorder_level > 0 && after <= live.reorder_level && <Badge tone="amber" className="ml-2">At / below re-order level</Badge>}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ─────────────────────────── tool crib ─────────────────────────── */

interface IssueV { item_id: string; employee_id: string; qty: string; issued_on: string; due_back: string; remarks: string }

export function IssueToolForm({ open, onClose, itemId }: DialogProps & { itemId?: string }) {
  const L = useLookups()
  const items = useTable('inventory_items')
  const tools = items.filter((i) => i.category === 'tooling' && i.active).sort((a, b) => a.sku.localeCompare(b.sku))
  const f = useForm<IssueV>(
    () => ({ item_id: itemId ?? '', employee_id: '', qty: '1', issued_on: todayISO(), due_back: addDays(todayISO(), 7), remarks: '' }),
    (v) => issueToolErrors({ ...v, qty: toNum(v.qty), due_back: v.due_back || null }),
  )
  const tool = items.find((i) => i.id === f.v.item_id)
  const submit = () =>
    void guard(async () => {
      issueTool({ ...f.v, qty: toNum(f.v.qty)!, due_back: f.v.due_back || null })
      await db.flushed()
      onClose()
    }, 'Tool issued')
  return (
    <Modal open={open} onClose={onClose} title="Issue tool" subtitle="Draws stock from the tool crib" footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label="Issue" icon={<ArrowUpFromLine className="h-4 w-4" />} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectF f={f} k="item_id" label="Tool" required className="sm:col-span-2" options={tools.map((t) => ({ value: t.id, label: `${t.sku} — ${t.name} (${fmtQty(t.stock_qty)} ${t.uom})`, disabled: t.stock_qty <= 0 }))} placeholder="Choose tooling item…" />
        {tool && (
          <div className="sm:col-span-2">
            <StockBar qty={tool.stock_qty} reorder={tool.reorder_level} uom={tool.uom} />
          </div>
        )}
        <SelectF f={f} k="employee_id" label="Issued to" required className="sm:col-span-2" options={L.employeeOptions()} placeholder="Choose employee…" />
        <NumF f={f} k="qty" label={`Quantity${tool ? ` (${tool.uom})` : ''}`} required min={0} />
        <DateF f={f} k="issued_on" label="Issued on" required max={todayISO()} />
        <DateF f={f} k="due_back" label="Due back" min={f.v.issued_on} hint="Leave blank for consumables" />
        <TextF f={f} k="remarks" label="Remarks" placeholder="Job / machine" />
      </div>
    </Modal>
  )
}

interface ReturnV { qty: string; condition: string; date: string; remarks: string; rest: 'out' | 'consumed' }

export function ReturnToolForm({ open, onClose, issue }: DialogProps & { issue: ToolIssue }) {
  const L = useLookups()
  const item = db.get('inventory_items', issue.item_id)
  const outstanding = toolOutstanding(issue)
  const f = useForm<ReturnV>(
    () => ({ qty: String(outstanding), condition: 'good', date: todayISO(), remarks: '', rest: 'out' }),
    (v) => {
      const q = toNum(v.qty)
      const e: Partial<Record<keyof ReturnV, string>> = {}
      if (q == null) e.qty = 'Required'
      else if (q <= 0) e.qty = 'Must be greater than zero'
      else if (q > outstanding) e.qty = `Only ${fmtQty(outstanding)} still on issue`
      if (!v.date) e.date = 'Required'
      else if (v.date > todayISO()) e.date = 'Cannot be in the future'
      else if (v.date < issue.issued_on) e.date = 'Before the issue date'
      if (v.condition === 'broken' && !v.remarks.trim()) e.remarks = 'Describe how it broke'
      return e
    },
  )
  const q = toNum(f.v.qty) ?? 0
  const submit = () =>
    void guard(async () => {
      returnTool(issue, { qty: q, condition: f.v.condition as 'good' | 'worn' | 'broken', remarks: f.v.remarks, date: f.v.date, rest: f.v.rest })
      await db.flushed()
      onClose()
    }, f.v.condition === 'broken' ? 'Return recorded — tool scrapped' : 'Tool returned to stock')
  return (
    <Modal open={open} onClose={onClose} title="Return tool" subtitle={`${item?.sku ?? ''} · ${fmtQty(outstanding)} on issue to ${L.empName(issue.employee_id)} since ${fmtDate(issue.issued_on)}`} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label="Record return" icon={<ArrowDownToLine className="h-4 w-4" />} variant="success" />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Condition" required className="sm:col-span-2">
          <Segmented value={f.v.condition} onChange={(v) => f.set('condition', v)} options={[{ value: 'good', label: 'Good' }, { value: 'worn', label: 'Worn' }, { value: 'broken', label: 'Broken' }]} />
        </Field>
        <NumF f={f} k="qty" label={`Returned qty${item ? ` (${item.uom})` : ''}`} required min={0} />
        {q > 0 && q < outstanding && (
          <Field label={`Remaining ${fmtQty(round3(outstanding - q))}`} className="sm:col-span-2">
            <Segmented value={f.v.rest} onChange={(v) => f.set('rest', v)} options={[{ value: 'out', label: `Still with ${L.empName(issue.employee_id)}` }, { value: 'consumed', label: 'Consumed / written off' }]} />
          </Field>
        )}
        <DateF f={f} k="date" label="Returned on" required min={issue.issued_on} max={todayISO()} />
        <AreaF f={f} k="remarks" label="Remarks" required={f.v.condition === 'broken'} className="sm:col-span-2" rows={2} />
        <p className={cn('rounded-md px-3 py-2 text-[12.5px] sm:col-span-2', f.v.condition === 'broken' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
          {f.v.condition === 'broken' ? 'Broken tools are scrapped — nothing goes back into stock.' : `${fmtQty(q)} ${item?.uom ?? ''} will be added back to stock.`}
        </p>
      </div>
    </Modal>
  )
}

/* ─────────────────────────── assets ─────────────────────────── */

interface AssetV { asset_code: string; name: string; category: string; make: string; serial_no: string; purchase_date: string; cost: string; location: string; custodian_id: string; calibration_required: boolean; calibration_interval_days: string; last_calibrated: string; certificate_no: string; status: string }

export function AssetForm({ open, onClose, asset }: DialogProps & { asset: Asset | null }) {
  const L = useLookups()
  const f = useForm<AssetV>(
    () => ({
      asset_code: asset?.asset_code ?? '', name: asset?.name ?? '', category: asset?.category ?? 'gauge', make: asset?.make ?? '', serial_no: asset?.serial_no ?? '',
      purchase_date: asset?.purchase_date ?? '', cost: numStr(asset?.cost ?? 0), location: asset?.location ?? '', custodian_id: asset?.custodian_id ?? '',
      calibration_required: asset?.calibration_required ?? false, calibration_interval_days: numStr(asset?.calibration_interval_days || 365), last_calibrated: asset?.last_calibrated ?? '',
      certificate_no: asset?.certificate_no ?? '', status: asset?.status ?? 'in_use',
    }),
    (v) => assetErrors(toInput(v), asset?.id),
  )
  function toInput(v: AssetV): AssetInput {
    return {
      ...v, category: v.category as AssetCategory, purchase_date: v.purchase_date || null, cost: toNum(v.cost), custodian_id: v.custodian_id || null,
      calibration_interval_days: toNum(v.calibration_interval_days), last_calibrated: v.last_calibrated || null, status: v.status as Asset['status'],
    }
  }
  const interval = toNum(f.v.calibration_interval_days)
  const nextDue = f.v.calibration_required && f.v.last_calibrated && interval && interval > 0 ? addDays(f.v.last_calibrated, Math.round(interval)) : null
  const submit = () =>
    void guard(() => {
      saveAsset(asset, toInput(f.v))
      onClose()
    }, asset ? 'Asset updated' : 'Asset added')
  return (
    <Modal open={open} onClose={onClose} size="lg" title={asset ? `Edit ${asset.asset_code}` : 'Add asset'} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={asset ? 'Save changes' : 'Add asset'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextF f={f} k="asset_code" label="Asset code" required placeholder="AS-GA-008" onBlur={() => f.set('asset_code', f.v.asset_code.trim().toUpperCase())} />
        <SelectF f={f} k="category" label="Category" required options={(Object.keys(ASSET_CATEGORY_LABEL) as AssetCategory[]).map((c) => ({ value: c, label: ASSET_CATEGORY_LABEL[c] }))} />
        <TextF f={f} k="name" label="Name" required className="sm:col-span-2" placeholder="Outside micrometer 50–75 mm" />
        <TextF f={f} k="make" label="Make / model" />
        <TextF f={f} k="serial_no" label="Serial no." />
        <DateF f={f} k="purchase_date" label="Purchase date" max={todayISO()} />
        <NumF f={f} k="cost" label="Cost (₹)" required min={0} />
        <TextF f={f} k="location" label="Location" placeholder="QA room" />
        <SelectF f={f} k="custodian_id" label="Custodian" options={L.employeeOptions()} placeholder="— None —" />
        <SelectF f={f} k="status" label="Status" required options={(Object.keys(ASSET_STATUS_LABEL) as Asset['status'][]).map((s) => ({ value: s, label: ASSET_STATUS_LABEL[s] }))} />
        <SwitchF f={f} k="calibration_required" label="Needs calibration" description="Gauges and instruments with a calibration cycle" className="sm:col-span-2" />
        {f.v.calibration_required && (
          <>
            <NumF f={f} k="calibration_interval_days" label="Interval (days)" required min={1} step="1" />
            <DateF f={f} k="last_calibrated" label="Last calibrated" max={todayISO()} hint={nextDue ? `Next due ${fmtDate(nextDue)}` : asset?.calibration_due ? `Due ${fmtDate(asset.calibration_due)}` : undefined} />
            <TextF f={f} k="certificate_no" label="Certificate no." className="sm:col-span-2" />
          </>
        )}
      </div>
    </Modal>
  )
}

interface CalV { date: string; certificate_no: string }

export function CalibrationForm({ open, onClose, asset }: DialogProps & { asset: Asset }) {
  const f = useForm<CalV>(
    () => ({ date: todayISO(), certificate_no: '' }),
    (v) => ({
      date: !v.date ? 'Required' : v.date > todayISO() ? 'Cannot be in the future' : asset.last_calibrated && v.date < asset.last_calibrated ? `Last calibrated ${fmtDate(asset.last_calibrated)}` : null,
      certificate_no: v.certificate_no.trim() ? null : 'Certificate number is required',
    }),
  )
  const next = f.v.date && asset.calibration_interval_days > 0 ? addDays(f.v.date, asset.calibration_interval_days) : null
  const submit = () =>
    void guard(() => {
      recordCalibration(asset, f.v.date, f.v.certificate_no)
      onClose()
    }, `Calibration recorded — next due ${next ? fmtDate(next) : ''}`)
  return (
    <Modal open={open} onClose={onClose} title="Record calibration" subtitle={`${asset.asset_code} · ${asset.name}`} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label="Record" icon={<ClipboardCheck className="h-4 w-4" />} variant="success" />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateF f={f} k="date" label="Calibrated on" required max={todayISO()} />
        <TextF f={f} k="certificate_no" label="Certificate no." required placeholder="MCL/2026/1234" />
        <div className="rounded-md bg-slate-50 px-3.5 py-2.5 text-[13px] text-ink-soft sm:col-span-2">
          Interval {num(asset.calibration_interval_days, 0)} days → next due <b className="text-ink">{next ? fmtDate(next) : '—'}</b>
          {asset.calibration_due && <span className="block text-[12px] text-ink-faint">Currently due {fmtDate(asset.calibration_due)}</span>}
        </div>
      </div>
    </Modal>
  )
}
