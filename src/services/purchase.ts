/**
 * Vendors and purchase orders: GST maths, the draft → approved → sent → partial/received flow,
 * and goods receipts (GRN) that post stock 'in' movements referencing the PO number.
 */
import { db } from '@/data/store'
import type { PoStatus, PurchaseOrder, PurchaseOrderLine, Vendor } from '@/data/types'
import { addDays, monthOf, todayISO, toISODate } from '@/lib/dates'
import { nextFyNumber, nextNumber } from '@/lib/ids'
import { round2 } from '@/lib/format'
import { audit, diff } from './audit'
import { currentSession } from './session'
import { postMovement, requirePerm, round3 } from './inventory'

export const GST_RATES = [0, 5, 12, 18, 28, 40] as const
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const PHONE_RE = /^\+?[\d][\d\s-]{6,18}\d$/
export const HOME_STATE = 'Karnataka'

/** GST state codes → state (first two digits of a GSTIN). */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}
export const INDIAN_STATES = [...new Set(Object.values(GST_STATE_CODES))].sort()

export const PO_STATUS_LABEL: Record<PoStatus, string> = { draft: 'Draft', approved: 'Approved', sent: 'Sent', partial: 'Partly received', received: 'Received', cancelled: 'Cancelled' }
export const OPEN_PO: PoStatus[] = ['approved', 'sent', 'partial']

const firstError = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean)

/* ─────────────────────────── party (vendor / customer) validation ─────────────────────────── */

export interface PartyInput {
  name: string
  contact_person: string
  phone: string
  email: string
  gstin: string
  address: string
  city: string
  state: string
  payment_terms_days: number | null
}

/** Shared by vendors and customers (same DB constraints). */
export function partyErrors(v: PartyInput): Partial<Record<keyof PartyInput, string>> {
  const e: Partial<Record<keyof PartyInput, string>> = {}
  if (!v.name.trim()) e.name = 'Name is required'
  else if (v.name.trim().length > 120) e.name = 'Keep it under 120 characters'
  if (v.phone.trim() && !PHONE_RE.test(v.phone.trim())) e.phone = 'Enter a valid phone number'
  if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) e.email = 'Enter a valid e-mail'
  const g = v.gstin.trim().toUpperCase()
  if (g) {
    if (!GSTIN_RE.test(g)) e.gstin = 'GSTIN format: 29ABCDE1234F1Z5'
    else if (v.state && GST_STATE_CODES[g.slice(0, 2)] && GST_STATE_CODES[g.slice(0, 2)] !== v.state) e.gstin = `GSTIN state code ${g.slice(0, 2)} is ${GST_STATE_CODES[g.slice(0, 2)]}, not ${v.state}`
  }
  if (!v.state.trim()) e.state = 'State is required'
  if (v.payment_terms_days == null) e.payment_terms_days = 'Required (0 = advance / on delivery)'
  else if (v.payment_terms_days < 0 || !Number.isInteger(v.payment_terms_days)) e.payment_terms_days = 'Whole days, 0 or more'
  else if (v.payment_terms_days > 365) e.payment_terms_days = 'At most 365 days'
  return e
}

export const cleanParty = (v: PartyInput) => ({
  name: v.name.trim(), contact_person: v.contact_person.trim(), phone: v.phone.trim(), email: v.email.trim().toLowerCase(), gstin: v.gstin.trim().toUpperCase(),
  address: v.address.trim(), city: v.city.trim(), state: v.state.trim(), payment_terms_days: v.payment_terms_days ?? 0,
})

/* ─────────────────────────── vendors ─────────────────────────── */

export interface VendorInput extends PartyInput {
  category: string
  rating: number
  active: boolean
  notes: string
}

export const nextVendorCode = () => nextNumber('V', db.all('vendors').map((v) => v.code), 3)

export function vendorErrors(v: VendorInput): Partial<Record<keyof VendorInput, string>> {
  const e: Partial<Record<keyof VendorInput, string>> = partyErrors(v)
  if (!(v.rating >= 1 && v.rating <= 5 && Number.isInteger(v.rating))) e.rating = 'Rate 1 to 5 stars'
  return e
}

export function saveVendor(existing: Vendor | null, v: VendorInput): Vendor {
  requirePerm('purchase.manage')
  const err = firstError(vendorErrors(v))
  if (err) throw new Error(err)
  const row = { ...cleanParty(v), category: v.category.trim(), rating: v.rating, active: v.active, notes: v.notes.trim() }
  if (!existing) {
    const vendor = db.insert('vendors', { ...row, code: nextVendorCode() })
    audit('create', 'vendors', vendor.id, `Added vendor ${vendor.code} — ${vendor.name}`)
    return vendor
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const vendor = db.update('vendors', existing.id, row)
  audit('update', 'vendors', vendor.id, `Updated vendor ${vendor.code} — ${vendor.name}`, changes)
  return vendor
}

export function deleteVendor(v: Vendor) {
  requirePerm('purchase.manage')
  const pos = db.count('purchase_orders', (p) => p.vendor_id === v.id)
  if (pos) throw new Error(`${v.name} has ${pos} purchase order${pos === 1 ? '' : 's'} — mark the vendor inactive instead.`)
  db.remove('vendors', v.id)
  audit('delete', 'vendors', v.id, `Deleted vendor ${v.code} — ${v.name}`)
}

/* ─────────────────────────── GST maths ─────────────────────────── */

export interface LineLike {
  qty: number
  rate: number
  gst_rate: number
}
export interface RateRow {
  rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
}
export interface PoTotals {
  subtotal: number
  cgst: number
  sgst: number
  igst: number
  tax: number
  total: number
  byRate: RateRow[]
}

export const lineAmount = (l: Pick<LineLike, 'qty' | 'rate'>) => round2(l.qty * l.rate)

/**
 * Line-wise GST. Intra-state: CGST = SGST = taxable × rate/2 each (rounded per line, so the two are
 * always equal). Inter-state: IGST = taxable × rate.
 */
export function lineTax(l: LineLike, intra: boolean) {
  const taxable = lineAmount(l)
  if (intra) {
    const half = round2((taxable * l.gst_rate) / 200)
    return { taxable, cgst: half, sgst: half, igst: 0, tax: round2(half * 2) }
  }
  const igst = round2((taxable * l.gst_rate) / 100)
  return { taxable, cgst: 0, sgst: 0, igst, tax: igst }
}

export function computeTotals(lines: LineLike[], intra: boolean): PoTotals {
  const by = new Map<number, RateRow>()
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0
  for (const l of lines) {
    if (!(l.qty > 0) || !(l.rate >= 0)) continue
    const t = lineTax(l, intra)
    subtotal += t.taxable
    cgst += t.cgst
    sgst += t.sgst
    igst += t.igst
    const r = by.get(l.gst_rate) ?? { rate: l.gst_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    r.taxable = round2(r.taxable + t.taxable)
    r.cgst = round2(r.cgst + t.cgst)
    r.sgst = round2(r.sgst + t.sgst)
    r.igst = round2(r.igst + t.igst)
    by.set(l.gst_rate, r)
  }
  subtotal = round2(subtotal)
  cgst = round2(cgst)
  sgst = round2(sgst)
  igst = round2(igst)
  const tax = round2(cgst + sgst + igst)
  return { subtotal, cgst, sgst, igst, tax, total: round2(subtotal + tax), byRate: [...by.values()].sort((a, b) => a.rate - b.rate) }
}

/* ─────────────────────────── purchase orders ─────────────────────────── */

export interface PoHeaderInput {
  vendor_id: string
  date: string
  expected_date: string | null
  notes: string
}
export interface PoLineInput {
  id?: string
  item_id: string | null
  description: string
  qty: number | null
  uom: string
  rate: number | null
  gst_rate: number
}

export function poHeaderErrors(v: PoHeaderInput): Partial<Record<keyof PoHeaderInput, string>> {
  const e: Partial<Record<keyof PoHeaderInput, string>> = {}
  const vendor = db.get('vendors', v.vendor_id)
  if (!vendor) e.vendor_id = 'Choose a vendor'
  else if (!vendor.active) e.vendor_id = 'This vendor is inactive'
  if (!v.date) e.date = 'PO date is required'
  else if (v.date > addDays(todayISO(), 30)) e.date = 'More than 30 days ahead'
  if (v.expected_date && v.date && v.expected_date < v.date) e.expected_date = 'Cannot be before the PO date'
  return e
}

export function poLineErrors(l: PoLineInput): Partial<Record<keyof PoLineInput, string>> {
  const e: Partial<Record<keyof PoLineInput, string>> = {}
  if (l.item_id && !db.get('inventory_items', l.item_id)) e.item_id = 'Item not found'
  if (!l.description.trim()) e.description = l.item_id ? 'Description required' : 'Pick an item or type a description'
  if (l.qty == null) e.qty = 'Qty required'
  else if (l.qty <= 0) e.qty = 'Qty must be > 0'
  else if (round3(l.qty) !== l.qty) e.qty = 'Max 3 decimals'
  if (!l.uom.trim()) e.uom = 'Unit required'
  if (l.rate == null) e.rate = 'Rate required'
  else if (l.rate < 0) e.rate = 'Rate ≥ 0'
  if (!(GST_RATES as readonly number[]).includes(l.gst_rate)) e.gst_rate = 'Invalid GST rate'
  return e
}

export function isIntraState(vendor: Vendor | undefined) {
  return (vendor?.state ?? HOME_STATE).trim().toLowerCase() === HOME_STATE.toLowerCase()
}

export function savePo(existing: PurchaseOrder | null, h: PoHeaderInput, lines: PoLineInput[]): PurchaseOrder {
  requirePerm('purchase.manage')
  if (existing && existing.status !== 'draft') throw new Error('Only draft purchase orders can be edited.')
  const herr = firstError(poHeaderErrors(h))
  if (herr) throw new Error(herr)
  const used = lines.filter((l) => l.item_id || l.description.trim() || l.qty != null)
  if (!used.length) throw new Error('Add at least one line.')
  used.forEach((l, i) => {
    const le = firstError(poLineErrors(l))
    if (le) throw new Error(`Line ${i + 1}: ${le}`)
  })
  const vendor = db.get('vendors', h.vendor_id)!
  const intra = isIntraState(vendor)
  const clean = used.map((l) => ({ id: l.id, item_id: l.item_id || null, description: l.description.trim(), qty: round3(l.qty!), uom: l.uom.trim(), rate: round2(l.rate!), gst_rate: l.gst_rate }))
  const t = computeTotals(clean, intra)
  const header = { vendor_id: vendor.id, date: h.date, expected_date: h.expected_date || null, notes: h.notes.trim(), intra_state: intra, subtotal: t.subtotal, tax_total: t.tax, total: t.total }
  return db.batch(() => {
    if (!existing) {
      const po = db.insert('purchase_orders', {
        ...header, po_no: nextFyNumber('PO', db.all('purchase_orders').map((p) => p.po_no), h.date), status: 'draft',
        created_by: currentSession()?.user.id ?? null, approved_by: null, approved_at: null,
      })
      for (const l of clean) db.insert('purchase_order_lines', { po_id: po.id, item_id: l.item_id, description: l.description, qty: l.qty, uom: l.uom, rate: l.rate, gst_rate: l.gst_rate, received_qty: 0 })
      audit('create', 'purchase_orders', po.id, `Draft ${po.po_no} — ${vendor.name}, ${clean.length} line${clean.length === 1 ? '' : 's'}, ₹${t.total.toLocaleString('en-IN')}`)
      return po
    }
    const before = db.where('purchase_order_lines', (l) => l.po_id === existing.id)
    const keep = new Set(clean.map((l) => l.id).filter(Boolean))
    for (const l of before) if (!keep.has(l.id)) db.remove('purchase_order_lines', l.id)
    for (const l of clean) {
      const row = { item_id: l.item_id, description: l.description, qty: l.qty, uom: l.uom, rate: l.rate, gst_rate: l.gst_rate }
      const prev = l.id ? before.find((b) => b.id === l.id) : undefined
      if (prev) {
        if (diff(prev, row)) db.update('purchase_order_lines', prev.id, row)
      } else db.insert('purchase_order_lines', { ...row, po_id: existing.id, received_qty: 0 })
    }
    const po = db.update('purchase_orders', existing.id, header)
    audit('update', 'purchase_orders', po.id, `Edited draft ${po.po_no} — total ₹${t.total.toLocaleString('en-IN')}`, diff(existing, header))
    return po
  })
}

export function approvePo(po: PurchaseOrder): PurchaseOrder {
  requirePerm('purchase.manage')
  if (po.status !== 'draft') throw new Error(`${po.po_no} is not a draft.`)
  if (!db.count('purchase_order_lines', (l) => l.po_id === po.id)) throw new Error('This PO has no lines.')
  const patch = { status: 'approved' as const, approved_by: currentSession()?.user.id ?? null, approved_at: new Date().toISOString() }
  const row = db.update('purchase_orders', po.id, patch)
  audit('approve', 'purchase_orders', po.id, `Approved ${po.po_no} (₹${po.total.toLocaleString('en-IN')})`, { status: { from: po.status, to: 'approved' } })
  return row
}

export function markPoSent(po: PurchaseOrder): PurchaseOrder {
  requirePerm('purchase.manage')
  if (po.status !== 'approved') throw new Error('Only approved POs can be marked as sent.')
  const row = db.update('purchase_orders', po.id, { status: 'sent' })
  audit('update', 'purchase_orders', po.id, `${po.po_no} sent to vendor`, { status: { from: po.status, to: 'sent' } })
  return row
}

export function cancelPo(po: PurchaseOrder, reason: string): PurchaseOrder {
  requirePerm('purchase.manage')
  if (po.status === 'cancelled' || po.status === 'received') throw new Error(`${po.po_no} is already ${po.status}.`)
  if (db.find('purchase_order_lines', (l) => l.po_id === po.id && l.received_qty > 0)) throw new Error('Goods have been received against this PO — it cannot be cancelled.')
  if (!reason.trim()) throw new Error('Give a reason for cancelling.')
  const notes = [po.notes, `Cancelled ${todayISO()}: ${reason.trim()}`].filter(Boolean).join('\n')
  const row = db.update('purchase_orders', po.id, { status: 'cancelled', notes })
  audit('cancel', 'purchase_orders', po.id, `Cancelled ${po.po_no} — ${reason.trim()}`, { status: { from: po.status, to: 'cancelled' } })
  return row
}

export function deletePo(po: PurchaseOrder) {
  requirePerm('purchase.manage')
  if (po.status !== 'draft') throw new Error('Only drafts can be deleted — cancel the PO instead.')
  db.batch(() => {
    for (const l of db.where('purchase_order_lines', (x) => x.po_id === po.id)) db.remove('purchase_order_lines', l.id)
    db.remove('purchase_orders', po.id)
  })
  audit('delete', 'purchase_orders', po.id, `Deleted draft ${po.po_no}`)
}

export const remainingQty = (l: PurchaseOrderLine) => Math.max(0, round3(l.qty - l.received_qty))

export interface GrnInput {
  date: string
  challan: string
  receipts: { line_id: string; qty: number }[]
}

export function receiveGoods(po: PurchaseOrder, g: GrnInput): PurchaseOrder {
  requirePerm('purchase.manage')
  if (!OPEN_PO.includes(po.status)) throw new Error(`Goods can only be received on approved / sent POs (this one is ${PO_STATUS_LABEL[po.status].toLowerCase()}).`)
  if (!g.date) throw new Error('Receipt date is required.')
  if (g.date > todayISO()) throw new Error('Receipt date cannot be in the future.')
  if (g.date < po.date) throw new Error('Receipt date is before the PO date.')
  const lines = db.where('purchase_order_lines', (l) => l.po_id === po.id)
  const recs = g.receipts.filter((r) => r.qty !== 0)
  if (!recs.length) throw new Error('Enter the quantity received on at least one line.')
  for (const r of recs) {
    const l = lines.find((x) => x.id === r.line_id)
    if (!l) throw new Error('PO line not found.')
    if (!(r.qty > 0)) throw new Error(`${l.description}: quantity must be greater than zero.`)
    if (round3(r.qty) > remainingQty(l)) throw new Error(`${l.description}: only ${remainingQty(l)} ${l.uom} pending.`)
  }
  const vendor = db.get('vendors', po.vendor_id)
  const reason = `GRN${g.challan.trim() ? ` · DC ${g.challan.trim()}` : ''}${vendor ? ` · ${vendor.name}` : ''}`
  return db.batch(() => {
    for (const r of recs) {
      const l = lines.find((x) => x.id === r.line_id)!
      const qty = round3(r.qty)
      if (l.item_id && db.get('inventory_items', l.item_id)) postMovement({ itemId: l.item_id, type: 'in', qty, date: g.date, reference: po.po_no, reason })
      db.update('purchase_order_lines', l.id, { received_qty: round3(l.received_qty + qty) })
    }
    const after = db.where('purchase_order_lines', (l) => l.po_id === po.id)
    const status: PoStatus = after.every((l) => l.received_qty >= l.qty) ? 'received' : 'partial'
    const row = db.update('purchase_orders', po.id, { status })
    audit('process', 'purchase_orders', po.id, `GRN on ${po.po_no}: ${recs.length} line${recs.length === 1 ? '' : 's'} received${g.challan.trim() ? ` (DC ${g.challan.trim()})` : ''} → ${PO_STATUS_LABEL[status]}`, { status: { from: po.status, to: status } })
    return row
  })
}

/* ─────────────────────────── KPIs ─────────────────────────── */

/** Undelivered value (incl. GST) of a PO's open lines. */
export function outstandingValue(po: PurchaseOrder, lines: PurchaseOrderLine[]): number {
  const open = lines.filter((l) => l.po_id === po.id).map((l) => ({ qty: remainingQty(l), rate: l.rate, gst_rate: l.gst_rate }))
  return computeTotals(open, po.intra_state).total
}

export function purchaseKpis(pos: PurchaseOrder[], lines: PurchaseOrderLine[], today = todayISO()) {
  const open = pos.filter((p) => OPEN_PO.includes(p.status))
  const week = addDays(today, 7)
  const ym = monthOf(today)
  const byNo = new Map(pos.map((p) => [p.po_no, p]))
  const linesByPo = new Map<string, PurchaseOrderLine[]>()
  for (const l of lines) (linesByPo.get(l.po_id) ?? linesByPo.set(l.po_id, []).get(l.po_id)!).push(l)
  let receivedMonth = 0
  let receipts = 0
  for (const m of db.all('stock_movements')) {
    if (m.type !== 'in' || monthOf(m.date) !== ym) continue
    const po = byNo.get(m.reference)
    if (!po) continue
    const l = (linesByPo.get(po.id) ?? []).find((x) => x.item_id === m.item_id)
    if (!l) continue
    receivedMonth += lineTax({ qty: m.qty, rate: l.rate, gst_rate: l.gst_rate }, po.intra_state).taxable
    receipts++
  }
  const drafts = pos.filter((p) => p.status === 'draft')
  return {
    openValue: round2(open.reduce((s, p) => s + outstandingValue(p, linesByPo.get(p.id) ?? []), 0)),
    openCount: open.length,
    pendingApproval: drafts.length,
    pendingValue: round2(drafts.reduce((s, p) => s + p.total, 0)),
    dueThisWeek: open.filter((p) => p.expected_date && p.expected_date >= today && p.expected_date <= week).length,
    overdue: open.filter((p) => p.expected_date && p.expected_date < today).length,
    receivedMonth: round2(receivedMonth),
    receipts,
  }
}

export function vendorSpend(vendorId: string, pos: PurchaseOrder[]) {
  const mine = pos.filter((p) => p.vendor_id === vendorId && p.status !== 'cancelled' && p.status !== 'draft')
  return { count: mine.length, value: round2(mine.reduce((s, p) => s + p.total, 0)) }
}

/** GRN stock movements for a PO (item lines). */
export const poReceipts = (po: PurchaseOrder) => db.where('stock_movements', (m) => m.reference === po.po_no && m.type === 'in')

export const poDeliveryState = (po: PurchaseOrder, today = todayISO()) =>
  OPEN_PO.includes(po.status) && po.expected_date ? (po.expected_date < today ? 'late' : po.expected_date <= addDays(today, 7) ? 'due' : null) : null

export const createdOn = (iso: string) => toISODate(new Date(iso))
