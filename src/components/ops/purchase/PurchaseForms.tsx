/** Purchase dialogs: purchase order (draft create/edit), goods receipt (GRN), vendor. */
import { useMemo, useState } from 'react'
import { PackageCheck, Plus, Trash2 } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { PurchaseOrder, Vendor } from '@/data/types'
import { Badge, Button, Field, Input, Modal, Select, guard, toast } from '@/components/ui'
import { addDays, todayISO } from '@/lib/dates'
import { amountInWords, inr2, num } from '@/lib/format'
import { uuid } from '@/lib/ids'
import { cn } from '@/lib/misc'
import { UOMS, fmtQty, round3, suggestedOrderQty } from '@/services/inventory'
import {
  GST_RATES, INDIAN_STATES, computeTotals, isIntraState, lineAmount, nextVendorCode, poHeaderErrors, poLineErrors, receiveGoods, remainingQty, savePo, saveVendor, vendorErrors,
  type PoLineInput, type VendorInput,
} from '@/services/purchase'
import { useForm, toNum, numStr } from '../form'
import { AreaF, DateF, NumF, SelectF, SwitchF, TextF } from '../fields'
import { FormSection, ModalActions, NumInput, Stars } from '../kit'

interface DialogProps {
  open: boolean
  onClose: () => void
}

/* ─────────────────────────── purchase order ─────────────────────────── */

interface LineRow {
  key: string
  id?: string
  item_id: string
  description: string
  qty: string
  uom: string
  rate: string
  gst_rate: string
}
interface PoV { vendor_id: string; date: string; expected_date: string; notes: string }

const blankLine = (): LineRow => ({ key: uuid(), item_id: '', description: '', qty: '', uom: 'nos', rate: '', gst_rate: '18' })
const isUsed = (l: LineRow) => !!(l.item_id || l.description.trim() || l.qty.trim())
const toLineInput = (l: LineRow): PoLineInput => ({ id: l.id, item_id: l.item_id || null, description: l.description, qty: toNum(l.qty), uom: l.uom, rate: toNum(l.rate), gst_rate: Number(l.gst_rate) })

export function PoForm({ open, onClose, po, prefillItemId, prefillVendorId, onSaved }: DialogProps & { po: PurchaseOrder | null; prefillItemId?: string; prefillVendorId?: string; onSaved?: (po: PurchaseOrder) => void }) {
  const vendors = useTable('vendors')
  const items = useTable('inventory_items')
  const prefill = prefillItemId ? items.find((i) => i.id === prefillItemId) : undefined
  const f = useForm<PoV>(
    () => ({
      vendor_id: po?.vendor_id ?? prefillVendorId ?? prefill?.preferred_vendor_id ?? '', date: po?.date ?? todayISO(), expected_date: po?.expected_date ?? addDays(po?.date ?? todayISO(), 10), notes: po?.notes ?? '',
    }),
    (v) => poHeaderErrors({ ...v, expected_date: v.expected_date || null }),
  )
  const [lines, setLines] = useState<LineRow[]>(() => {
    if (po) {
      return db
        .where('purchase_order_lines', (l) => l.po_id === po.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((l) => ({ key: l.id, id: l.id, item_id: l.item_id ?? '', description: l.description, qty: numStr(l.qty), uom: l.uom, rate: numStr(l.rate), gst_rate: String(l.gst_rate) }))
    }
    if (prefill) return [{ key: uuid(), item_id: prefill.id, description: prefill.name, qty: String(suggestedOrderQty(prefill)), uom: prefill.uom, rate: numStr(prefill.unit_cost), gst_rate: '18' }]
    return [blankLine()]
  })
  const [touchedLines, setTouchedLines] = useState(false)

  const vendor = vendors.find((v) => v.id === f.v.vendor_id)
  const intra = isIntraState(vendor)
  const used = lines.filter(isUsed)
  const lineErrs = lines.map((l) => (isUsed(l) ? poLineErrors(toLineInput(l)) : {}))
  const firstLineErr = lineErrs.map((e, i) => {
    const m = Object.values(e).find(Boolean)
    return m ? `Line ${i + 1}: ${m}` : null
  }).find(Boolean)
  const totals = computeTotals(
    used.map((l) => ({ qty: toNum(l.qty) ?? 0, rate: toNum(l.rate) ?? 0, gst_rate: Number(l.gst_rate) })),
    intra,
  )
  const noLines = !used.length ? 'Add at least one line' : null
  const valid = f.valid && !firstLineErr && !noLines
  const hint = f.firstError ?? noLines ?? firstLineErr ?? null

  const upd = (key: string, p: Partial<LineRow>) => {
    setTouchedLines(true)
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  }
  const pickItem = (key: string, itemId: string) => {
    const it = items.find((i) => i.id === itemId)
    const cur = lines.find((l) => l.key === key)
    if (!it) return upd(key, { item_id: '' })
    const prevItem = cur?.item_id ? items.find((i) => i.id === cur.item_id) : undefined
    upd(key, {
      item_id: it.id,
      description: !cur?.description.trim() || cur.description === prevItem?.name ? it.name : cur.description,
      uom: it.uom,
      rate: !cur?.rate || (prevItem && cur.rate === numStr(prevItem.unit_cost)) ? numStr(it.unit_cost) : cur.rate,
      qty: cur?.qty || String(suggestedOrderQty(it)),
    })
  }

  const submit = () =>
    void guard(async () => {
      const saved = savePo(po, { ...f.v, expected_date: f.v.expected_date || null }, lines.filter(isUsed).map(toLineInput))
      await db.flushed()
      onClose()
      toast.success(po ? `${saved.po_no} updated` : `Draft ${saved.po_no} created`, 'Approve it to release to the vendor.')
      onSaved?.(saved)
    })

  const itemOptions = useMemo(
    () => items.filter((i) => i.active && i.category !== 'finished_good').sort((a, b) => a.sku.localeCompare(b.sku)).map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` })),
    [items],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={po ? `Edit draft ${po.po_no}` : 'New purchase order'}
      subtitle={vendor ? `${vendor.name} · ${vendor.state} · ${intra ? 'CGST + SGST' : 'IGST'}` : 'Saved as a draft until approved'}
      footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!valid} hint={hint} label={po ? 'Save draft' : 'Create draft'} />}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectF
            f={f}
            k="vendor_id"
            label="Vendor"
            required
            className="sm:col-span-2"
            options={vendors.filter((v) => v.active || v.id === po?.vendor_id).sort((a, b) => a.name.localeCompare(b.name)).map((v) => ({ value: v.id, label: `${v.name} (${v.code}) · ${v.city || v.state}` }))}
            placeholder="Choose vendor…"
          />
          <DateF f={f} k="date" label="PO date" required />
          <DateF f={f} k="expected_date" label="Expected delivery" min={f.v.date} hint={vendor ? `Payment ${vendor.payment_terms_days ? `${vendor.payment_terms_days} days` : 'on delivery'}` : undefined} />
        </div>

        <FormSection
          title={`Lines (${used.length})`}
          action={
            <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((ls) => [...ls, blankLine()])}>
              Add line
            </Button>
          }
        >
          <div className="space-y-2.5">
              {lines.map((l, i) => {
                const e = touchedLines || po ? lineErrs[i]! : {}
                const amount = lineAmount({ qty: toNum(l.qty) ?? 0, rate: toNum(l.rate) ?? 0 })
                const it = items.find((x) => x.id === l.item_id)
                return (
                  <div
                    key={l.key}
                    className="min-w-0 overflow-hidden rounded-lg border border-line bg-white p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-ink-faint">
                        Line {i + 1}
                        {it && <span className="ml-2 font-normal">stock {fmtQty(it.stock_qty)} {it.uom}{it.hsn ? ` · HSN ${it.hsn}` : ''}</span>}
                      </span>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blankLine()]))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-12">
                      <Field className="col-span-2 sm:col-span-5" error={e.item_id}>
                        <Select aria-label="Item" value={l.item_id} onChange={(ev) => pickItem(l.key, ev.target.value)} options={itemOptions} placeholder="Stock item (optional)…" className="text-sm" />
                      </Field>
                      <Field className="col-span-2 sm:col-span-7" error={e.description}>
                        <Input aria-label="Description" value={l.description} onChange={(ev) => upd(l.key, { description: ev.target.value })} placeholder="Description / service" invalid={!!e.description} className="text-sm" />
                      </Field>
                      <Field className="sm:col-span-2" error={e.qty}>
                        <NumInput aria-label="Quantity" value={l.qty} min={0} onChange={(ev) => upd(l.key, { qty: ev.target.value })} placeholder="Qty" invalid={!!e.qty} className="text-sm" />
                      </Field>
                      <Field className="sm:col-span-2" error={e.uom}>
                        <Select aria-label="Unit" value={l.uom} onChange={(ev) => upd(l.key, { uom: ev.target.value })} options={(UOMS.includes(l.uom) ? UOMS : [...UOMS, l.uom]).map((u) => ({ value: u, label: u }))} className="text-sm" />
                      </Field>
                      <Field className="sm:col-span-3" error={e.rate}>
                        <NumInput aria-label="Rate" value={l.rate} min={0} onChange={(ev) => upd(l.key, { rate: ev.target.value })} placeholder="Rate ₹" invalid={!!e.rate} className="text-sm" />
                      </Field>
                      <Field className="sm:col-span-2" error={e.gst_rate}>
                        <Select aria-label="GST rate" value={l.gst_rate} onChange={(ev) => upd(l.key, { gst_rate: ev.target.value })} options={GST_RATES.map((g) => ({ value: String(g), label: `GST ${g}%` }))} className="text-sm" />
                      </Field>
                      <div className="col-span-2 flex items-center justify-end sm:col-span-3">
                        <span className="text-right">
                          <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Taxable</span>
                          <span className="num font-semibold text-ink">{inr2(amount)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        </FormSection>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <AreaF f={f} k="notes" label="Notes / special terms" rows={4} placeholder="Delivery instructions, test certificates, packing…" />
          <TotalsBox totals={totals} intra={intra} />
        </div>
      </div>
    </Modal>
  )
}

export function TotalsBox({ totals, intra, className }: { totals: ReturnType<typeof computeTotals>; intra: boolean; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-md border border-line bg-slate-50 p-4', className)}>
      <Row k="Sub-total" v={inr2(totals.subtotal)} />
      {intra ? (
        <>
          <Row k="CGST" v={inr2(totals.cgst)} />
          <Row k="SGST" v={inr2(totals.sgst)} />
        </>
      ) : (
        <Row k="IGST" v={inr2(totals.igst)} />
      )}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2">
        <span className="text-sm font-medium text-ink">Grand total</span>
        <span key={totals.total} className="num text-xl font-semibold text-ink">
          {inr2(totals.total)}
        </span>
      </div>
      {totals.total > 0 && <p className="mt-1 text-[11.5px] leading-snug text-ink-soft">{amountInWords(totals.total)}</p>}
      {totals.byRate.length > 1 && (
        <p className="mt-2 text-[11.5px] text-ink-faint">
          {totals.byRate.map((r) => `${r.rate}% on ${inr2(r.taxable)}`).join(' · ')}
        </p>
      )}
    </div>
  )
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-ink-soft">{k}</span>
      <span className="num text-ink">{v}</span>
    </div>
  )
}

/* ─────────────────────────── goods receipt ─────────────────────────── */

export function GrnForm({ open, onClose, po }: DialogProps & { po: PurchaseOrder }) {
  const allLines = useTable('purchase_order_lines')
  const items = useTable('inventory_items')
  const lines = useMemo(() => allLines.filter((l) => l.po_id === po.id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [allLines, po.id])
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, remainingQty(l) > 0 ? String(remainingQty(l)) : ''])))
  const [date, setDate] = useState(todayISO())
  const [challan, setChallan] = useState('')
  const errs = lines.map((l) => {
    const q = toNum(qty[l.id] ?? '')
    if (q == null || q === 0) return null
    if (q < 0) return 'Cannot be negative'
    if (round3(q) !== q) return 'Max 3 decimals'
    if (q > remainingQty(l)) return `Only ${fmtQty(remainingQty(l))} pending`
    return null
  })
  const anyQty = lines.some((l) => (toNum(qty[l.id] ?? '') ?? 0) > 0)
  const dateErr = !date ? 'Receipt date is required' : date > todayISO() ? 'Cannot be in the future' : date < po.date ? 'Before the PO date' : null
  const hint = dateErr ?? errs.find(Boolean) ?? (!anyQty ? 'Enter a received quantity on at least one line' : null)
  const submit = () =>
    void guard(async () => {
      const row = receiveGoods(po, { date, challan, receipts: lines.map((l) => ({ line_id: l.id, qty: toNum(qty[l.id] ?? '') ?? 0 })) })
      await db.flushed()
      onClose()
      toast.success(`Goods received on ${po.po_no}`, row.status === 'received' ? 'PO fully received.' : 'Partly received — balance still open.')
    })
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Receive goods · ${po.po_no}`} subtitle="Stock-in movements are posted for every stock item" footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!!hint} hint={hint} label="Post GRN" variant="success" icon={<PackageCheck className="h-4 w-4" />} />}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Receipt date" required error={dateErr}>
            <Input type="date" value={date} min={po.date} max={todayISO()} onChange={(e) => setDate(e.target.value)} invalid={!!dateErr} />
          </Field>
          <Field label="Vendor DC / invoice no.">
            <Input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="DC-4471" />
          </Field>
        </div>
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const rem = remainingQty(l)
            const it = l.item_id ? items.find((x) => x.id === l.item_id) : undefined
            return (
              <li key={l.id} className={cn('rounded-lg border p-3', rem <= 0 ? 'border-emerald-100 bg-emerald-50/40' : 'border-line bg-white')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{l.description}</p>
                    <p className="text-[12px] text-ink-soft">
                      Ordered {fmtQty(l.qty)} {l.uom} · received {fmtQty(l.received_qty)} · <b className="text-ink">pending {fmtQty(rem)}</b>
                      {it ? ` · stock ${fmtQty(it.stock_qty)}` : ' · non-stock line'}
                    </p>
                  </div>
                  {rem <= 0 ? (
                    <Badge tone="green">Fully received</Badge>
                  ) : (
                    <div className="w-32 shrink-0">
                      <NumInput aria-label={`Receive qty line ${i + 1}`} value={qty[l.id] ?? ''} min={0} max={rem} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} invalid={!!errs[i]} className="text-sm" placeholder={`≤ ${num(rem, 3)}`} />
                    </div>
                  )}
                </div>
                {errs[i] && <p className="mt-1 text-right text-[12px] font-medium text-rose-600">{errs[i]}</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}

/* ─────────────────────────── vendor ─────────────────────────── */

interface VendorV { name: string; category: string; contact_person: string; phone: string; email: string; gstin: string; address: string; city: string; state: string; payment_terms_days: string; rating: number; active: boolean; notes: string }

export function VendorForm({ open, onClose, vendor }: DialogProps & { vendor: Vendor | null }) {
  const vendors = useTable('vendors')
  const categories = useMemo(() => [...new Set(vendors.map((v) => v.category).filter(Boolean))].sort(), [vendors])
  const f = useForm<VendorV>(
    () => ({
      name: vendor?.name ?? '', category: vendor?.category ?? '', contact_person: vendor?.contact_person ?? '', phone: vendor?.phone ?? '', email: vendor?.email ?? '', gstin: vendor?.gstin ?? '',
      address: vendor?.address ?? '', city: vendor?.city ?? '', state: vendor?.state ?? 'Karnataka', payment_terms_days: numStr(vendor?.payment_terms_days ?? 30), rating: vendor?.rating ?? 3,
      active: vendor?.active ?? true, notes: vendor?.notes ?? '',
    }),
    (v) => vendorErrors(toInput(v)),
  )
  function toInput(v: VendorV): VendorInput {
    return { ...v, payment_terms_days: toNum(v.payment_terms_days) }
  }
  const dup = !vendor && f.v.name.trim() && vendors.find((x) => x.name.trim().toLowerCase() === f.v.name.trim().toLowerCase())
  const submit = () =>
    void guard(() => {
      const v = saveVendor(vendor, toInput(f.v))
      onClose()
      toast.success(vendor ? 'Vendor updated' : `Vendor ${v.code} added`)
    })
  return (
    <Modal open={open} onClose={onClose} size="lg" title={vendor ? `Edit ${vendor.name}` : 'Add vendor'} subtitle={vendor ? vendor.code : `Code ${nextVendorCode()} will be assigned`} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={vendor ? 'Save changes' : 'Add vendor'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextF f={f} k="name" label="Vendor name" required className="sm:col-span-2" hint={dup ? `A vendor named “${dup.name}” already exists (${dup.code}).` : undefined} />
        <Field label="Category">
          <input list="vendor-cats" value={f.v.category} onChange={(e) => f.set('category', e.target.value)} className="field-input" placeholder="Steel & raw material" />
          <datalist id="vendor-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <TextF f={f} k="contact_person" label="Contact person" />
        <TextF f={f} k="phone" label="Phone" type="tel" inputMode="tel" placeholder="+91 98450 12345" />
        <TextF f={f} k="email" label="E-mail" type="email" inputMode="email" />
        <TextF f={f} k="gstin" label="GSTIN" placeholder="29ABCDE1234F1Z5" maxLength={15} onBlur={() => f.set('gstin', f.v.gstin.trim().toUpperCase())} hint="Optional · 15 characters" />
        <NumF f={f} k="payment_terms_days" label="Payment terms (days)" required min={0} step="1" />
        <TextF f={f} k="address" label="Address" className="sm:col-span-2" />
        <TextF f={f} k="city" label="City" />
        <SelectF f={f} k="state" label="State" required options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} hint={f.v.state === 'Karnataka' ? 'Intra-state: CGST + SGST' : 'Inter-state: IGST'} />
        <Field label="Rating" required error={f.err('rating')}>
          <div className="flex h-11 items-center">
            <Stars value={f.v.rating} onChange={(r) => f.set('rating', r)} size={22} />
          </div>
        </Field>
        <SwitchF f={f} k="active" label="Active" description="Inactive vendors cannot get new POs" />
        <AreaF f={f} k="notes" label="Notes" className="sm:col-span-2" rows={2} />
      </div>
    </Modal>
  )
}
