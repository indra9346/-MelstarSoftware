/** Purchase order drawer (lines, receipts, approval flow, PDF) and vendor drawer (PO history, spend). */
import { useMemo, useState } from 'react'
import { Ban, Check, CheckCircle2, Download, FileText, Mail, MapPin, PackageCheck, Pencil, Phone, Send, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { PoStatus, PurchaseOrder, Vendor } from '@/data/types'
import { Badge, Button, EmptyState, InfoGrid, Menu, Modal, Progress, StatusBadge, guard } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, fmtDateTime, todayISO } from '@/lib/dates'
import { inr, inr2 } from '@/lib/format'
import { cn } from '@/lib/misc'
import { fmtQty } from '@/services/inventory'
import { PO_STATUS_LABEL, computeTotals, lineTax, poDeliveryState, poReceipts, vendorSpend } from '@/services/purchase'
import { FormSection, Stars, Tile } from '../kit'
import { TotalsBox } from './PurchaseForms'

const STEPS: { key: PoStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'received', label: 'Received' },
]
const STEP_INDEX: Record<PoStatus, number> = { draft: 0, approved: 1, sent: 2, partial: 2.5, received: 3, cancelled: -1 }

export function PoStepper({ status }: { status: PoStatus }) {
  if (status === 'cancelled')
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-2.5 text-sm font-medium text-rose-700">
        <Ban className="h-4 w-4" /> Cancelled
      </div>
    )
  const at = STEP_INDEX[status]
  return (
    <ol className="flex items-center gap-1.5" aria-label="PO progress">
      {STEPS.map((s, i) => {
        const done = at > i || (at === i && i === 3)
        const current = Math.floor(at) === i || (status === 'partial' && i === 3)
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium transition-colors', done ? 'bg-emerald-500 text-white' : current ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-faint')}>
              {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn('truncate text-[12px] font-medium', done || current ? 'text-ink' : 'text-ink-faint')}>{status === 'partial' && i === 3 ? 'Partly received' : s.label}</span>
            {i < STEPS.length - 1 && (
              <span className="relative h-0.5 min-w-[12px] flex-1 overflow-hidden rounded-full bg-slate-200">
                <span className="absolute inset-y-0 left-0 bg-emerald-400" style={{ width: at > i ? '100%' : '0%' }} />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function PoDrawer({
  open, onClose, po, canManage, onEdit, onApprove, onSend, onReceive, onCancel, onDelete, onDownload, onOpenVendor,
}: {
  open: boolean
  onClose: () => void
  po: PurchaseOrder
  canManage: boolean
  onEdit: () => void
  onApprove: () => void
  onSend: () => void
  onReceive: () => void
  onCancel: () => void
  onDelete: () => void
  onDownload: () => Promise<void>
  onOpenVendor: (id: string) => void
}) {
  const L = useLookups()
  const vendor = useTable('vendors').find((v) => v.id === po.vendor_id)
  const allLines = useTable('purchase_order_lines')
  const items = useTable('inventory_items')
  useTable('stock_movements')
  const lines = useMemo(() => allLines.filter((l) => l.po_id === po.id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [allLines, po.id])
  const receipts = poReceipts(po).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const totals = computeTotals(lines, po.intra_state)
  const orderedValue = lines.reduce((s, l) => s + lineTax(l, po.intra_state).taxable, 0)
  const receivedValue = lines.reduce((s, l) => s + lineTax({ ...l, qty: Math.min(l.qty, l.received_qty) }, po.intra_state).taxable, 0)
  const recPct = orderedValue > 0 ? (receivedValue / orderedValue) * 100 : 0
  const delivery = poDeliveryState(po, todayISO())
  const anyReceived = lines.some((l) => l.received_qty > 0)
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)
    await guard(onDownload)
    setBusy(false)
  }

  const menu = canManage
    ? [
        ...(po.status === 'draft' ? [{ label: 'Delete draft', icon: <Trash2 />, danger: true, onClick: onDelete }] : []),
        ...(['approved', 'sent', 'draft'].includes(po.status) && !anyReceived ? [{ label: 'Cancel PO', icon: <Ban />, danger: true, onClick: onCancel }] : []),
      ]
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="lg"
      title={po.po_no}
      subtitle={`${vendor?.name ?? 'Vendor'} · ${fmtDate(po.date)}`}
      footer={
        <>
          {menu.length > 0 && <Menu align="left" items={menu} />}
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void download()} loading={busy} className="mr-auto">
            PDF
          </Button>
          {canManage && po.status === 'draft' && (
            <>
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
                Edit
              </Button>
              <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={onApprove}>
                Approve
              </Button>
            </>
          )}
          {canManage && po.status === 'approved' && (
            <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={onSend}>
              Mark sent
            </Button>
          )}
          {canManage && ['approved', 'sent', 'partial'].includes(po.status) && (
            <Button icon={<PackageCheck className="h-4 w-4" />} onClick={onReceive}>
              Receive goods
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <PoStepper status={po.status} />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="PO value" value={inr(po.total)} sub={`${inr(po.subtotal)} + GST`} />
          <Tile label="Lines" value={lines.length} />
          <Tile label="Received" value={`${Math.round(recPct)}%`} sub={inr(receivedValue)} tone={po.status === 'received' ? 'green' : undefined} />
          <Tile label="Expected" value={po.expected_date ? fmtDate(po.expected_date) : '—'} sub={delivery === 'late' ? 'Overdue' : delivery === 'due' ? 'Due this week' : undefined} tone={delivery === 'late' ? 'red' : delivery === 'due' ? 'amber' : undefined} />
        </div>

        {vendor && (
          <FormSection title="Vendor">
            <button type="button" onClick={() => onOpenVendor(vendor.id)} className="block w-full rounded-lg border border-line bg-white p-3.5 text-left transition hover:border-line-strong hover:border-line-strong">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">
                  {vendor.name} <span className="text-[12px] font-medium text-ink-faint">{vendor.code}</span>
                </p>
                <Stars value={vendor.rating} size={14} />
              </div>
              <p className="mt-1 text-[12.5px] text-ink-soft">
                {[vendor.city, vendor.state].filter(Boolean).join(', ')} · GSTIN {vendor.gstin || 'not registered'} · {po.intra_state ? 'CGST + SGST' : 'IGST'} · {vendor.payment_terms_days} days credit
              </p>
            </button>
          </FormSection>
        )}

        <FormSection title="Lines">
          <ul className="space-y-2">
            {lines.map((l, i) => {
              const it = l.item_id ? items.find((x) => x.id === l.item_id) : undefined
              const t = lineTax(l, po.intra_state)
              return (
                <li key={l.id} className="rounded-lg border border-line bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-ink-faint">
                        {i + 1}. {it ? it.sku : 'Non-stock'}
                        {it?.hsn ? ` · HSN ${it.hsn}` : ''}
                      </p>
                      <p className="truncate text-sm font-medium text-ink">{l.description}</p>
                      <p className="num text-[12px] text-ink-soft">
                        {fmtQty(l.qty)} {l.uom} × {inr2(l.rate)} · GST {l.gst_rate}%
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="num font-semibold text-ink">{inr2(t.taxable + t.tax)}</p>
                      <p className="num text-[11.5px] text-ink-faint">{inr2(t.taxable)} + {inr2(t.tax)}</p>
                    </div>
                  </div>
                  {po.status !== 'draft' && po.status !== 'cancelled' && (
                    <div className="mt-2 flex items-center gap-2">
                      <Progress value={l.received_qty} max={l.qty} className="h-1.5" tone={l.received_qty >= l.qty ? '#3a8f5c' : undefined} />
                      <span className="num shrink-0 text-[11.5px] text-ink-soft">
                        {fmtQty(l.received_qty)}/{fmtQty(l.qty)}
                      </span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <TotalsBox totals={totals} intra={po.intra_state} className="mt-3" />
        </FormSection>

        <FormSection title={`Goods receipts (${receipts.length})`}>
          {receipts.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
              {receipts.map((m) => {
                const it = items.find((x) => x.id === m.item_id)
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{it?.name ?? 'Item'}</span>
                      <span className="block truncate text-[12px] text-ink-soft">
                        {fmtDate(m.date)} · {m.reason} · {L.userName(m.by_user_id)}
                      </span>
                    </span>
                    <span className="num shrink-0 font-semibold text-emerald-700">
                      +{fmtQty(m.qty)} {it?.uom}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">{po.status === 'draft' ? 'Approve the PO before receiving goods.' : 'Nothing received yet.'}</p>
          )}
        </FormSection>

        <FormSection title="Audit">
          <InfoGrid
            items={[
              ['Created by', L.userName(po.created_by)],
              ['Created', fmtDateTime(po.created_at)],
              ['Approved by', po.approved_by ? L.userName(po.approved_by) : '—'],
              ['Approved at', fmtDateTime(po.approved_at)],
            ]}
          />
          {po.notes && <p className="mt-3 whitespace-pre-line rounded-md bg-slate-50 px-3.5 py-2.5 text-[13px] text-ink">{po.notes}</p>}
        </FormSection>
      </div>
    </Modal>
  )
}

export function VendorDrawer({ open, onClose, vendor, canManage, onEdit, onOpenPo, onNewPo, onDelete }: { open: boolean; onClose: () => void; vendor: Vendor; canManage: boolean; onEdit: () => void; onOpenPo: (id: string) => void; onNewPo: () => void; onDelete: () => void }) {
  const pos = useTable('purchase_orders')
  const items = useTable('inventory_items')
  const mine = useMemo(() => pos.filter((p) => p.vendor_id === vendor.id).sort((a, b) => b.date.localeCompare(a.date)), [pos, vendor.id])
  const spend = vendorSpend(vendor.id, pos)
  const open_ = mine.filter((p) => ['approved', 'sent', 'partial'].includes(p.status))
  const preferred = items.filter((i) => i.preferred_vendor_id === vendor.id)
  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="md"
      title={vendor.name}
      subtitle={`${vendor.code} · ${vendor.category || 'Vendor'}${vendor.active ? '' : ' · inactive'}`}
      footer={
        canManage ? (
          <>
            <Menu align="left" items={[{ label: 'Delete vendor', icon: <Trash2 />, danger: true, onClick: onDelete }]} />
            <span className="flex-1" />
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            {vendor.active && (
              <Button icon={<FileText className="h-4 w-4" />} onClick={onNewPo}>
                New PO
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Stars value={vendor.rating} />
          {!vendor.active && <Badge tone="slate">Inactive</Badge>}
          <Badge tone={vendor.state === 'Karnataka' ? 'cyan' : 'violet'}>{vendor.state === 'Karnataka' ? 'Intra-state' : 'Inter-state'}</Badge>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label="POs" value={spend.count} />
          <Tile label="Spend" value={inr(spend.value)} />
          <Tile label="Open" value={open_.length} tone={open_.length ? 'amber' : undefined} />
        </div>
        <FormSection title="Contact">
          <ul className="space-y-1.5 text-sm text-ink">
            {vendor.contact_person && <li className="font-medium">{vendor.contact_person}</li>}
            {vendor.phone && (
              <li className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-ink-faint" />
                <a href={`tel:${vendor.phone.replace(/\s/g, '')}`} className="hover:text-brand-600">{vendor.phone}</a>
              </li>
            )}
            {vendor.email && (
              <li className="flex min-w-0 items-center gap-2">
                <Mail className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <a href={`mailto:${vendor.email}`} className="truncate hover:text-brand-600">{vendor.email}</a>
              </li>
            )}
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span>{[vendor.address, vendor.city, vendor.state].filter(Boolean).join(', ') || '—'}</span>
            </li>
          </ul>
          <div className="mt-3">
            <InfoGrid items={[['GSTIN', vendor.gstin || '—'], ['Payment terms', `${vendor.payment_terms_days} days`]]} />
          </div>
          {vendor.notes && <p className="mt-3 rounded-md bg-slate-50 px-3.5 py-2.5 text-[13px]">{vendor.notes}</p>}
        </FormSection>
        <FormSection title={`Purchase history (${mine.length})`}>
          {mine.length ? (
            <ul className="space-y-1.5">
              {mine.slice(0, 15).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenPo(p.id)} className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-left text-sm transition hover:border-line-strong">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{p.po_no}</span>
                      <span className="text-[12px] text-ink-soft">{fmtDate(p.date)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="num font-semibold">{inr(p.total)}</span>
                      <StatusBadge status={p.status} label={PO_STATUS_LABEL[p.status]} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No purchase orders yet" />
          )}
        </FormSection>
        {preferred.length > 0 && (
          <FormSection title={`Preferred vendor for (${preferred.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {preferred.map((i) => (
                <Badge key={i.id} tone="indigo">
                  {i.sku}
                </Badge>
              ))}
            </div>
          </FormSection>
        )}
      </div>
    </Modal>
  )
}
