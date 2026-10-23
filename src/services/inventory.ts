/**
 * Inventory, tool crib and asset / calibration logic.
 *
 * Every stock change goes through postMovement(): one stock_movements row (with balance_after)
 * plus the matching inventory_items.stock_qty update — never below zero. Maintenance (spares),
 * purchase (goods receipts) and the tool crib all post through here.
 */
import { db } from '@/data/store'
import type { Asset, AssetCategory, InventoryItem, ItemCategory, Permission, StockMovement, StockMovementType, ToolIssue } from '@/data/types'
import { addDays, todayISO } from '@/lib/dates'
import { fullName, num, round2 } from '@/lib/format'
import { audit, diff } from './audit'
import { currentSession } from './session'

/** Quantities are numeric(14,3) in Postgres. */
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000
export const fmtQty = (n: number) => num(n, 3)

/** Client-side guard that mirrors RLS (the server enforces the same rule). */
export function requirePerm(...perms: Permission[]) {
  const s = currentSession()
  if (s && !s.canAny(perms)) throw new Error('You do not have permission for this action.')
}

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  raw_material: 'Raw material',
  consumable: 'Consumable',
  tooling: 'Tooling',
  spare: 'Spare',
  finished_good: 'Finished good',
  packing: 'Packing',
}
export const ITEM_CATEGORIES = (Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[]).map((value) => ({ value, label: ITEM_CATEGORY_LABEL[value] }))
export const UOMS = ['nos', 'kg', 'm', 'ltr', 'sheet', 'box', 'set', 'pair', 'roll', 'job']

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  it: 'IT', gauge: 'Gauge', instrument: 'Instrument', furniture: 'Furniture', vehicle: 'Vehicle', tool: 'Tool', equipment: 'Equipment',
}
export const ASSET_STATUS_LABEL: Record<Asset['status'], string> = { in_use: 'In use', in_store: 'In store', repair: 'Under repair', disposed: 'Disposed' }

export const SKU_RE = /^[A-Z0-9][A-Z0-9._/-]{1,39}$/
export const HSN_RE = /^\d{4,8}$/

export const isLowStock = (i: InventoryItem) => i.active && i.reorder_level > 0 && i.stock_qty <= i.reorder_level
export const isOutOfStock = (i: InventoryItem) => i.active && i.stock_qty <= 0
export const itemValue = (i: InventoryItem) => round2(i.stock_qty * i.unit_cost)
/** Order enough to bring stock back to twice the re-order level. */
export const suggestedOrderQty = (i: InventoryItem) => Math.max(1, Math.ceil(round3(i.reorder_level * 2 - i.stock_qty)))

/** Signed effect of a movement on stock (+in, −out, ±adjust). */
export const signedQty = (m: StockMovement) => (m.type === 'in' ? m.qty : m.type === 'out' ? -m.qty : m.qty)

/* ─────────────────────────── stock movements ─────────────────────────── */

export interface MovementInput {
  itemId: string
  type: StockMovementType
  /** in/out: quantity (> 0). adjust: the physically counted quantity (new balance, ≥ 0). */
  qty: number
  date?: string
  reference: string
  reason: string
}

const TYPE_VERB: Record<StockMovementType, string> = { in: 'Stock in', out: 'Stock out', adjust: 'Stock adjusted' }

/** Post one movement: stock_movements row + inventory_items.stock_qty, never below zero. */
export function postMovement(m: MovementInput): StockMovement {
  const item = db.get('inventory_items', m.itemId)
  if (!item) throw new Error('Inventory item not found.')
  const today = todayISO()
  const date = m.date || today
  if (date > today) throw new Error('A stock movement cannot be dated in the future.')
  if (!Number.isFinite(m.qty)) throw new Error('Enter a valid quantity.')
  let qty: number
  let balance: number
  if (m.type === 'adjust') {
    balance = round3(m.qty)
    if (balance < 0) throw new Error('Counted quantity cannot be negative.')
    qty = round3(balance - item.stock_qty)
    if (qty === 0) throw new Error(`${item.sku}: counted quantity equals book stock — nothing to adjust.`)
  } else {
    qty = round3(m.qty)
    if (qty <= 0) throw new Error('Quantity must be greater than zero.')
    balance = round3(m.type === 'in' ? item.stock_qty + qty : item.stock_qty - qty)
    if (balance < 0) throw new Error(`${item.sku}: only ${fmtQty(item.stock_qty)} ${item.uom} in stock.`)
  }
  const reference = m.reference.trim()
  const mv = db.batch(() => {
    // Supabase: the stock_movements insert trigger updates the item atomically under a row lock,
    // so only reflect the new stock locally; static mode persists the item update itself.
    if (db.backend?.kind === 'supabase') db.ingest('inventory_items', { ...item, stock_qty: balance })
    else db.update('inventory_items', item.id, { stock_qty: balance })
    return db.insert('stock_movements', {
      item_id: item.id, date, type: m.type, qty, balance_after: balance, reference, reason: m.reason.trim(), by_user_id: currentSession()?.user.id ?? null,
    })
  })
  const shown = m.type === 'adjust' ? `${qty > 0 ? '+' : ''}${fmtQty(qty)}` : fmtQty(qty)
  audit(m.type === 'adjust' ? 'update' : 'create', 'stock_movements', mv.id, `${TYPE_VERB[m.type]} ${shown} ${item.uom} · ${item.sku}${reference ? ` (${reference})` : ''}`, {
    stock_qty: { from: item.stock_qty, to: balance },
  })
  return mv
}

/** Throws unless every (aggregated) quantity is available. Use before multi-line issues. */
export function assertAvailable(lines: { item_id: string; qty: number }[]) {
  const need = new Map<string, number>()
  for (const l of lines) {
    if (!(l.qty > 0)) throw new Error('Every quantity must be greater than zero.')
    need.set(l.item_id, round3((need.get(l.item_id) ?? 0) + l.qty))
  }
  for (const [id, q] of need) {
    const it = db.get('inventory_items', id)
    if (!it) throw new Error('Inventory item not found.')
    if (q > it.stock_qty) throw new Error(`${it.sku}: ${fmtQty(q)} ${it.uom} needed, only ${fmtQty(it.stock_qty)} in stock.`)
  }
}

/* ─────────────────────────── items ─────────────────────────── */

export interface ItemInput {
  sku: string
  name: string
  category: ItemCategory
  uom: string
  reorder_level: number | null
  unit_cost: number | null
  location: string
  hsn: string
  preferred_vendor_id: string | null
  active: boolean
}

export function itemErrors(v: ItemInput & { opening?: number | null }, id?: string): Partial<Record<keyof ItemInput | 'opening', string>> {
  const e: Partial<Record<keyof ItemInput | 'opening', string>> = {}
  const sku = v.sku.trim().toUpperCase()
  if (!sku) e.sku = 'SKU is required'
  else if (!SKU_RE.test(sku)) e.sku = 'Use 2–40 capital letters, digits, . _ / -'
  else if (db.find('inventory_items', (i) => i.sku.toUpperCase() === sku && i.id !== id)) e.sku = 'This SKU already exists'
  if (!v.name.trim()) e.name = 'Name is required'
  else if (v.name.trim().length > 120) e.name = 'Keep it under 120 characters'
  if (!v.uom.trim()) e.uom = 'Unit is required'
  if (v.reorder_level == null) e.reorder_level = 'Required'
  else if (v.reorder_level < 0) e.reorder_level = 'Cannot be negative'
  if (v.unit_cost == null) e.unit_cost = 'Required'
  else if (v.unit_cost < 0) e.unit_cost = 'Cannot be negative'
  if (v.hsn.trim() && !HSN_RE.test(v.hsn.trim())) e.hsn = 'HSN is 4–8 digits'
  if (v.opening != null && v.opening < 0) e.opening = 'Cannot be negative'
  return e
}

function cleanItem(v: ItemInput) {
  return {
    sku: v.sku.trim().toUpperCase(), name: v.name.trim(), category: v.category, uom: v.uom.trim(), reorder_level: round3(v.reorder_level ?? 0),
    unit_cost: round2(v.unit_cost ?? 0), location: v.location.trim(), hsn: v.hsn.trim(), preferred_vendor_id: v.preferred_vendor_id || null, active: v.active,
  }
}

const firstError = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean)

export function createItem(v: ItemInput, opening: number | null): InventoryItem {
  requirePerm('inventory.manage')
  const err = firstError(itemErrors({ ...v, opening }))
  if (err) throw new Error(err)
  const item = db.insert('inventory_items', { ...cleanItem(v), stock_qty: 0 })
  audit('create', 'inventory_items', item.id, `Added item ${item.sku} — ${item.name}`)
  if (opening && opening > 0) postMovement({ itemId: item.id, type: 'adjust', qty: opening, reference: 'OPENING', reason: 'Opening stock' })
  return db.get('inventory_items', item.id) ?? item
}

export function updateItem(item: InventoryItem, v: ItemInput): InventoryItem {
  requirePerm('inventory.manage')
  const err = firstError(itemErrors(v, item.id))
  if (err) throw new Error(err)
  const patch = cleanItem(v)
  const changes = diff(item, patch)
  if (!changes) return item
  const row = db.update('inventory_items', item.id, patch)
  audit('update', 'inventory_items', item.id, `Updated item ${row.sku}`, changes)
  return row
}

export function deleteItem(item: InventoryItem) {
  requirePerm('inventory.manage')
  const used =
    db.count('stock_movements', (m) => m.item_id === item.id) +
    db.count('tool_issues', (t) => t.item_id === item.id) +
    db.count('purchase_order_lines', (l) => l.item_id === item.id)
  if (used) throw new Error(`${item.sku} has stock, tool-crib or purchase history — mark it inactive instead.`)
  db.remove('inventory_items', item.id)
  audit('delete', 'inventory_items', item.id, `Deleted item ${item.sku} — ${item.name}`)
}

/* ─────────────────────────── tool crib ─────────────────────────── */

export const isToolOverdue = (t: ToolIssue, today = todayISO()) => t.status === 'issued' && !!t.due_back && t.due_back < today
/** Quantity still with the employee on an open issue (partial returns keep the issue open). */
export const toolOutstanding = (t: ToolIssue) => Math.max(0, Math.round((t.qty - t.returned_qty) * 100) / 100)
const empLabel = (id: string) => {
  const e = db.get('employees', id)
  return { code: e?.emp_code ?? 'EMP', name: e ? fullName(e) : 'employee' }
}

export interface IssueToolInput {
  item_id: string
  employee_id: string
  qty: number
  issued_on: string
  due_back: string | null
  remarks: string
}

export function issueToolErrors(v: { item_id: string; employee_id: string; qty: number | null; issued_on: string; due_back: string | null }): Partial<Record<'item_id' | 'employee_id' | 'qty' | 'issued_on' | 'due_back', string>> {
  const e: Partial<Record<'item_id' | 'employee_id' | 'qty' | 'issued_on' | 'due_back', string>> = {}
  const item = db.get('inventory_items', v.item_id)
  if (!item) e.item_id = 'Choose a tool'
  else if (item.category !== 'tooling') e.item_id = 'Only tooling items can be issued from the crib'
  if (!v.employee_id) e.employee_id = 'Choose who takes the tool'
  if (v.qty == null) e.qty = 'Required'
  else if (v.qty <= 0) e.qty = 'Must be greater than zero'
  else if (round3(v.qty) !== Math.round(v.qty * 100) / 100) e.qty = 'Up to 2 decimals'
  else if (item && v.qty > item.stock_qty) e.qty = `Only ${fmtQty(item.stock_qty)} ${item.uom} in stock`
  if (!v.issued_on) e.issued_on = 'Required'
  else if (v.issued_on > todayISO()) e.issued_on = 'Cannot be in the future'
  if (v.due_back && v.issued_on && v.due_back < v.issued_on) e.due_back = 'Must be on or after the issue date'
  return e
}

export function issueTool(v: IssueToolInput): ToolIssue {
  requirePerm('inventory.manage')
  const err = firstError(issueToolErrors(v))
  if (err) throw new Error(err)
  const who = empLabel(v.employee_id)
  const qty = Math.round(v.qty * 100) / 100
  return db.batch(() => {
    // stock first: if it fails nothing else is written
    postMovement({ itemId: v.item_id, type: 'out', qty, date: v.issued_on, reference: `CRIB/${who.code}`, reason: `Tool issued to ${who.name}` })
    const issue = db.insert('tool_issues', {
      item_id: v.item_id, employee_id: v.employee_id, qty, issued_on: v.issued_on, due_back: v.due_back || null,
      returned_on: null, returned_qty: 0, condition: null, status: 'issued', remarks: v.remarks.trim(),
    })
    audit('create', 'tool_issues', issue.id, `Issued ${fmtQty(issue.qty)} × ${db.get('inventory_items', v.item_id)?.sku} to ${who.name}`)
    return issue
  })
}

/**
 * Record a tool return. A part return either keeps the issue open for the rest (`rest: 'out'`, the
 * default) or closes it with the rest written off as consumed (`rest: 'consumed'`).
 */
export function returnTool(t: ToolIssue, v: { qty: number; condition: 'good' | 'worn' | 'broken'; remarks: string; date: string; rest?: 'out' | 'consumed' }): ToolIssue {
  requirePerm('inventory.manage')
  if (t.status !== 'issued') throw new Error('This tool is not on issue.')
  const qty = Math.round(v.qty * 100) / 100
  const outstanding = toolOutstanding(t)
  if (!(qty > 0)) throw new Error('Returned quantity must be greater than zero.')
  if (qty > outstanding) throw new Error(`Only ${fmtQty(outstanding)} still on issue.`)
  if (!v.date || v.date > todayISO()) throw new Error('Return date cannot be in the future.')
  if (v.date < t.issued_on) throw new Error('Return date is before the issue date.')
  if (v.condition === 'broken' && !v.remarks.trim()) throw new Error('Describe how the tool broke.')
  const who = empLabel(t.employee_id)
  return db.batch(() => {
    const stillOut = qty < outstanding && v.rest !== 'consumed'
    const row = db.update('tool_issues', t.id, {
      status: stillOut ? 'issued' : 'returned', returned_on: v.date, returned_qty: Math.round((t.returned_qty + qty) * 100) / 100,
      condition: v.condition, remarks: v.remarks.trim() || t.remarks,
    })
    // broken tools are scrapped — they do not go back into stock
    if (v.condition !== 'broken') postMovement({ itemId: t.item_id, type: 'in', qty, date: v.date, reference: `CRIB/${who.code}`, reason: `Tool returned (${v.condition}) by ${who.name}` })
    audit('update', 'tool_issues', t.id, `Tool return: ${fmtQty(qty)} of ${fmtQty(outstanding)} on issue × ${db.get('inventory_items', t.item_id)?.sku} from ${who.name} — ${v.condition}${qty < outstanding ? (stillOut ? ' · rest still on issue' : ' · rest consumed') : ''}`, diff(t, row))
    return row
  })
}

export function markToolLost(t: ToolIssue, remarks: string): ToolIssue {
  requirePerm('inventory.manage')
  if (t.status !== 'issued') throw new Error('This tool is not on issue.')
  if (!remarks.trim()) throw new Error('Add a note on how the tool was lost.')
  const row = db.update('tool_issues', t.id, { status: 'lost', remarks: remarks.trim() })
  audit('update', 'tool_issues', t.id, `Tool marked lost: ${fmtQty(toolOutstanding(t))} × ${db.get('inventory_items', t.item_id)?.sku} (${empLabel(t.employee_id).name})`, { status: { from: t.status, to: 'lost' } })
  return row
}

/* ─────────────────────────── assets & calibration ─────────────────────────── */

export type CalState = 'overdue' | 'due_soon' | 'ok' | 'not_set'
export function calibrationState(a: Asset, today = todayISO(), window = 30): CalState | null {
  if (!a.calibration_required || a.status === 'disposed') return null
  if (!a.calibration_due) return 'not_set'
  if (a.calibration_due < today) return 'overdue'
  if (a.calibration_due <= addDays(today, window)) return 'due_soon'
  return 'ok'
}

export interface AssetInput {
  asset_code: string
  name: string
  category: AssetCategory
  make: string
  serial_no: string
  purchase_date: string | null
  cost: number | null
  location: string
  custodian_id: string | null
  calibration_required: boolean
  calibration_interval_days: number | null
  last_calibrated: string | null
  certificate_no: string
  status: Asset['status']
}

export const ASSET_CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{1,29}$/

export function assetErrors(v: AssetInput, id?: string): Partial<Record<keyof AssetInput, string>> {
  const e: Partial<Record<keyof AssetInput, string>> = {}
  const code = v.asset_code.trim().toUpperCase()
  const today = todayISO()
  if (!code) e.asset_code = 'Asset code is required'
  else if (!ASSET_CODE_RE.test(code)) e.asset_code = 'Use capital letters, digits, . _ / -'
  else if (db.find('assets', (a) => a.asset_code.toUpperCase() === code && a.id !== id)) e.asset_code = 'This asset code already exists'
  if (!v.name.trim()) e.name = 'Name is required'
  if (v.cost == null) e.cost = 'Required (0 if unknown)'
  else if (v.cost < 0) e.cost = 'Cannot be negative'
  if (v.purchase_date && v.purchase_date > today) e.purchase_date = 'Cannot be in the future'
  if (v.calibration_required) {
    if (v.calibration_interval_days == null || v.calibration_interval_days <= 0) e.calibration_interval_days = 'Enter the interval in days'
    else if (!Number.isInteger(v.calibration_interval_days)) e.calibration_interval_days = 'Whole days only'
    else if (v.calibration_interval_days > 3650) e.calibration_interval_days = 'At most 3650 days'
    if (v.last_calibrated && v.last_calibrated > today) e.last_calibrated = 'Cannot be in the future'
  }
  return e
}

export function saveAsset(existing: Asset | null, v: AssetInput): Asset {
  requirePerm('inventory.manage')
  const err = firstError(assetErrors(v, existing?.id))
  if (err) throw new Error(err)
  const interval = v.calibration_required ? Math.round(v.calibration_interval_days ?? 0) : 0
  const last = v.calibration_required ? v.last_calibrated || null : existing?.last_calibrated ?? null
  const due = v.calibration_required ? (last ? addDays(last, interval) : existing?.calibration_due ?? null) : null
  const row = {
    asset_code: v.asset_code.trim().toUpperCase(), name: v.name.trim(), category: v.category, make: v.make.trim(), serial_no: v.serial_no.trim(),
    purchase_date: v.purchase_date || null, cost: round2(v.cost ?? 0), location: v.location.trim(), custodian_id: v.custodian_id || null,
    calibration_required: v.calibration_required, calibration_interval_days: interval, last_calibrated: last, calibration_due: due,
    certificate_no: v.certificate_no.trim(), status: v.status,
  }
  if (!existing) {
    const a = db.insert('assets', row)
    audit('create', 'assets', a.id, `Added asset ${a.asset_code} — ${a.name}`)
    return a
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const a = db.update('assets', existing.id, row)
  audit('update', 'assets', a.id, `Updated asset ${a.asset_code}`, changes)
  return a
}

export function deleteAsset(a: Asset) {
  requirePerm('inventory.manage')
  db.remove('assets', a.id)
  audit('delete', 'assets', a.id, `Deleted asset ${a.asset_code} — ${a.name}`)
}

export function recordCalibration(a: Asset, date: string, certificateNo: string): Asset {
  requirePerm('inventory.manage', 'quality.manage')
  if (!a.calibration_required) throw new Error('This asset does not need calibration.')
  if (!date) throw new Error('Calibration date is required.')
  if (date > todayISO()) throw new Error('Calibration date cannot be in the future.')
  if (a.last_calibrated && date < a.last_calibrated) throw new Error('Date is before the last recorded calibration.')
  if (!certificateNo.trim()) throw new Error('Certificate number is required.')
  if (!(a.calibration_interval_days > 0)) throw new Error('Set the calibration interval on the asset first.')
  const patch = { last_calibrated: date, calibration_due: addDays(date, a.calibration_interval_days), certificate_no: certificateNo.trim() }
  const row = db.update('assets', a.id, patch)
  audit('update', 'assets', a.id, `Calibration recorded for ${a.asset_code} (cert ${patch.certificate_no}) — next due ${patch.calibration_due}`, diff(a, patch))
  return row
}
