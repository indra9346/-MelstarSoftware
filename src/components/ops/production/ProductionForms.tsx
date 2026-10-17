/** Production dialogs: work order, progress update, customer. */
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Customer, Priority, WorkOrder } from '@/data/types'
import { Badge, Checkbox, Field, Modal, Progress, Segmented, guard, toast } from '@/components/ui'
import { addDays, todayISO } from '@/lib/dates'
import { inr, inr2, titleCase } from '@/lib/format'
import { cn } from '@/lib/misc'
import { INDIAN_STATES } from '@/services/purchase'
import { PRIORITIES, WO_STATUS_LABEL, customerErrors, nextCustomerCode, nextWoNo, progressErrors, saveCustomer, saveWo, updateProgress, woErrors, type CustomerInput, type WoInput } from '@/services/production'
import { useForm, toNum, numStr } from '../form'
import { AreaF, DateF, NumF, SelectF, SwitchF, TextF } from '../fields'
import { FormSection, ModalActions } from '../kit'

interface DialogProps {
  open: boolean
  onClose: () => void
}

/* ─────────────────────────── work order ─────────────────────────── */

interface WoV { customer_id: string; customer_po_ref: string; part_no: string; part_name: string; drawing_rev: string; material: string; qty: string; unit_price: string; route: string[]; start_date: string; due_date: string; priority: string; notes: string }

export function WoForm({ open, onClose, wo, customerId, onSaved }: DialogProps & { wo: WorkOrder | null; customerId?: string; onSaved?: (w: WorkOrder) => void }) {
  const customers = useTable('customers')
  const wcs = useTable('work_centres')
  const wcMap = useMemo(() => new Map(wcs.map((w) => [w.id, w])), [wcs])
  const f = useForm<WoV>(
    () => ({
      customer_id: wo?.customer_id ?? customerId ?? '', customer_po_ref: wo?.customer_po_ref ?? '', part_no: wo?.part_no ?? '', part_name: wo?.part_name ?? '', drawing_rev: wo?.drawing_rev ?? '',
      material: wo?.material ?? '', qty: numStr(wo?.qty), unit_price: numStr(wo?.unit_price), route: wo?.route_work_centre_ids ?? [], start_date: wo?.start_date ?? todayISO(),
      due_date: wo?.due_date ?? addDays(todayISO(), 21), priority: wo?.priority ?? 'medium', notes: wo?.notes ?? '',
    }),
    (v) => woErrors(toInput(v), wo),
  )
  function toInput(v: WoV): WoInput {
    return { ...v, qty: toNum(v.qty), unit_price: toNum(v.unit_price), route_work_centre_ids: v.route, priority: v.priority as Priority }
  }
  const value = (toNum(f.v.qty) ?? 0) * (toNum(f.v.unit_price) ?? 0)
  const cust = customers.find((c) => c.id === f.v.customer_id)
  const move = (i: number, d: -1 | 1) => {
    const r = [...f.v.route]
    const j = i + d
    if (j < 0 || j >= r.length) return
    ;[r[i], r[j]] = [r[j]!, r[i]!]
    f.set('route', r)
  }
  const submit = () =>
    void guard(() => {
      const saved = saveWo(wo, toInput(f.v))
      onClose()
      toast.success(wo ? `${saved.wo_no} updated` : `${saved.wo_no} created`, `${saved.part_name} × ${saved.qty}`)
      onSaved?.(saved)
    })
  return (
    <Modal open={open} onClose={onClose} size="xl" title={wo ? `Edit ${wo.wo_no}` : 'New work order'} subtitle={wo ? `${WO_STATUS_LABEL[wo.status]} · ${wo.completed_qty} completed` : `Number ${nextWoNo()} will be assigned`} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={wo ? 'Save changes' : 'Create work order'} />}>
      <div className="space-y-5">
        <FormSection title="Customer & order">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectF f={f} k="customer_id" label="Customer" required className="sm:col-span-2" options={customers.filter((c) => c.active || c.id === wo?.customer_id).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} placeholder="Choose customer…" />
            <TextF f={f} k="customer_po_ref" label="Customer PO ref." placeholder="VH/PO/26-0912" />
            <Field label="Priority" required>
              <Segmented size="sm" value={f.v.priority} onChange={(v) => f.set('priority', v)} options={PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))} className="w-full" />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Part">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextF f={f} k="part_no" label="Part no." required placeholder="VH-EC-080" onBlur={() => f.set('part_no', f.v.part_no.trim().toUpperCase())} />
            <TextF f={f} k="part_name" label="Part name" required className="sm:col-span-2" placeholder="Hydraulic cylinder end cap Ø80" />
            <TextF f={f} k="drawing_rev" label="Drawing rev." placeholder="C" maxLength={8} />
            <TextF f={f} k="material" label="Material" placeholder="EN8 / SS304 / CI FG260" />
            <NumF f={f} k="qty" label="Quantity (nos)" required min={1} step="1" hint={wo && wo.completed_qty ? `${wo.completed_qty} already completed` : undefined} />
            <NumF f={f} k="unit_price" label="Unit price (₹)" required min={0} />
            <div className="flex flex-col justify-end rounded-2xl bg-indigo-50/70 px-3.5 py-2.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Order value</span>
              <motion.span key={Math.round(value)} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="num font-display text-lg font-bold text-ink">
                {inr2(value)}
              </motion.span>
              {cust && cust.credit_limit > 0 && value > cust.credit_limit && <span className="text-[11.5px] font-medium text-amber-700">Above {cust.name.split(' ')[0]}’s credit limit {inr(cust.credit_limit)}</span>}
            </div>
          </div>
        </FormSection>
        <FormSection title="Route (in order)">
          <Field error={f.err('route')}>
            <div className={cn('min-h-[52px] rounded-2xl border border-dashed p-2.5', f.err('route') ? 'border-rose-300' : 'border-indigo-200')}>
              {f.v.route.length ? (
                <motion.ol layout className="flex flex-wrap items-center gap-1.5">
                  <AnimatePresence initial={false}>
                    {f.v.route.map((id, i) => {
                      const w = wcMap.get(id)
                      return (
                        <motion.li key={`${id}-${i}`} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="flex items-center gap-1">
                          <span className="flex items-center gap-1 rounded-full border bg-white py-0.5 pl-1 pr-1 text-[12.5px] font-semibold text-ink" style={{ borderColor: `${w?.color ?? '#6366f1'}66` }}>
                            <span className="grid h-5 w-5 place-items-center rounded-full text-[10.5px] text-white" style={{ background: w?.color ?? '#6366f1' }}>
                              {i + 1}
                            </span>
                            <span className="px-1">{w?.name ?? 'Removed'}</span>
                            <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)} className="grid h-5 w-5 place-items-center rounded-full text-ink-faint hover:bg-indigo-50 disabled:opacity-30">
                              <ArrowLeft className="h-3 w-3" />
                            </button>
                            <button type="button" aria-label="Move later" disabled={i === f.v.route.length - 1} onClick={() => move(i, 1)} className="grid h-5 w-5 place-items-center rounded-full text-ink-faint hover:bg-indigo-50 disabled:opacity-30">
                              <ArrowRight className="h-3 w-3" />
                            </button>
                            <button type="button" aria-label="Remove step" onClick={() => f.set('route', f.v.route.filter((_, j) => j !== i))} className="grid h-5 w-5 place-items-center rounded-full text-ink-faint hover:bg-rose-50 hover:text-rose-600">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                          {i < f.v.route.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-ink-faint" />}
                        </motion.li>
                      )
                    })}
                  </AnimatePresence>
                </motion.ol>
              ) : (
                <p className="px-1 py-2 text-[13px] text-ink-faint">Add the work centres this part goes through, in order.</p>
              )}
            </div>
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {wcs
              .slice()
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((w) => (
                <button key={w.id} type="button" onClick={() => f.set('route', [...f.v.route, w.id])} className="flex items-center gap-1 rounded-full border border-indigo-100 bg-white px-2.5 py-1 text-[12px] font-semibold text-ink-soft transition hover:border-indigo-300 hover:text-ink">
                  <Plus className="h-3 w-3" />
                  <span className="h-2 w-2 rounded-full" style={{ background: w.color }} />
                  {w.name}
                </button>
              ))}
          </div>
        </FormSection>
        <FormSection title="Schedule">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DateF f={f} k="start_date" label="Start date" required />
            <DateF f={f} k="due_date" label="Due date" required min={f.v.start_date} />
            <AreaF f={f} k="notes" label="Notes" className="sm:col-span-2" rows={2} placeholder="Special instructions, packing, inspection requirements…" />
          </div>
        </FormSection>
      </div>
    </Modal>
  )
}

/* ─────────────────────────── progress ─────────────────────────── */

interface ProgV { completed: string; rejected: string; moveToQc: boolean }

export function ProgressForm({ open, onClose, wo }: DialogProps & { wo: WorkOrder }) {
  const f = useForm<ProgV>(
    () => ({ completed: String(wo.completed_qty), rejected: String(wo.rejected_qty), moveToQc: true }),
    (v) => progressErrors(wo, toNum(v.completed), toNum(v.rejected)),
  )
  const done = toNum(f.v.completed) ?? 0
  const rej = toNum(f.v.rejected) ?? 0
  const pctDone = wo.qty ? Math.min(100, (done / wo.qty) * 100) : 0
  const yieldPct = done + rej > 0 ? (done / (done + rej)) * 100 : 100
  const canQc = done >= wo.qty && (wo.status === 'in_progress' || wo.status === 'planned')
  const submit = () =>
    void guard(() => {
      const row = updateProgress(wo, toNum(f.v.completed)!, toNum(f.v.rejected)!, canQc && f.v.moveToQc)
      onClose()
      toast.success(`${wo.wo_no} progress saved`, row.status !== wo.status ? `Moved to ${WO_STATUS_LABEL[row.status]}` : `${row.completed_qty}/${row.qty} done`)
    })
  return (
    <Modal open={open} onClose={onClose} title={`Progress · ${wo.wo_no}`} subtitle={`${wo.part_name} · order qty ${wo.qty}`} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label="Save progress" />}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="num font-display text-2xl font-bold text-ink">
              {done}
              <span className="text-base font-semibold text-ink-faint"> / {wo.qty}</span>
            </span>
            <span className="num text-sm font-semibold text-ink-soft">{Math.round(pctDone)}%</span>
          </div>
          <Progress value={done} max={wo.qty} className="h-3" />
          <p className="mt-2 text-[12.5px] text-ink-soft">
            Balance {Math.max(0, wo.qty - done)} · yield <b className={cn(yieldPct < 97 ? 'text-amber-700' : 'text-emerald-700')}>{yieldPct.toFixed(1)}%</b>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumF f={f} k="completed" label="Completed (good)" required min={0} max={wo.qty} step="1" />
          <NumF f={f} k="rejected" label="Rejected" required min={0} step="1" />
        </div>
        {canQc && (
          <div className="rounded-xl bg-violet-50 px-3.5 py-2.5">
            <Checkbox checked={f.v.moveToQc} onChange={(v) => f.set('moveToQc', v)} label="Order quantity reached — move to QC" />
          </div>
        )}
        {wo.status === 'planned' && done + rej > 0 && <Badge tone="cyan">Will move to In progress</Badge>}
      </div>
    </Modal>
  )
}

/* ─────────────────────────── customer ─────────────────────────── */

interface CustV { name: string; contact_person: string; phone: string; email: string; gstin: string; address: string; city: string; state: string; payment_terms_days: string; credit_limit: string; active: boolean; notes: string }

export function CustomerForm({ open, onClose, customer }: DialogProps & { customer: Customer | null }) {
  const customers = useTable('customers')
  const f = useForm<CustV>(
    () => ({
      name: customer?.name ?? '', contact_person: customer?.contact_person ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', gstin: customer?.gstin ?? '',
      address: customer?.address ?? '', city: customer?.city ?? '', state: customer?.state ?? 'Karnataka', payment_terms_days: numStr(customer?.payment_terms_days ?? 30),
      credit_limit: numStr(customer?.credit_limit ?? 0), active: customer?.active ?? true, notes: customer?.notes ?? '',
    }),
    (v) => customerErrors(toInput(v)),
  )
  function toInput(v: CustV): CustomerInput {
    return { ...v, payment_terms_days: toNum(v.payment_terms_days), credit_limit: toNum(v.credit_limit) }
  }
  const dup = !customer && f.v.name.trim() && customers.find((x) => x.name.trim().toLowerCase() === f.v.name.trim().toLowerCase())
  const submit = () =>
    void guard(() => {
      const c = saveCustomer(customer, toInput(f.v))
      onClose()
      toast.success(customer ? 'Customer updated' : `Customer ${c.code} added`)
    })
  return (
    <Modal open={open} onClose={onClose} size="lg" title={customer ? `Edit ${customer.name}` : 'Add customer'} subtitle={customer ? customer.code : `Code ${nextCustomerCode()} will be assigned`} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={customer ? 'Save changes' : 'Add customer'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextF f={f} k="name" label="Customer name" required className="sm:col-span-2" hint={dup ? `“${dup.name}” already exists (${dup.code}).` : undefined} />
        <TextF f={f} k="contact_person" label="Contact person" />
        <TextF f={f} k="phone" label="Phone" type="tel" inputMode="tel" />
        <TextF f={f} k="email" label="E-mail" type="email" inputMode="email" />
        <TextF f={f} k="gstin" label="GSTIN" placeholder="29ABCDE1234F1Z5" maxLength={15} onBlur={() => f.set('gstin', f.v.gstin.trim().toUpperCase())} hint="Optional · 15 characters" />
        <TextF f={f} k="address" label="Address" className="sm:col-span-2" />
        <TextF f={f} k="city" label="City" />
        <SelectF f={f} k="state" label="State" required options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} />
        <NumF f={f} k="payment_terms_days" label="Payment terms (days)" required min={0} step="1" />
        <NumF f={f} k="credit_limit" label="Credit limit (₹)" required min={0} hint={toNum(f.v.credit_limit) ? inr(toNum(f.v.credit_limit)) : '0 = no credit'} />
        <SwitchF f={f} k="active" label="Active" description="Inactive customers cannot get new work orders" className="sm:col-span-2" />
        <AreaF f={f} k="notes" label="Notes" className="sm:col-span-2" rows={2} />
      </div>
    </Modal>
  )
}
