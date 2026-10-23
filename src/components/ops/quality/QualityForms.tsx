/** Quality dialogs: inspection (with live parameter OK / result) and NCR. */
import { useMemo, useState } from 'react'
import { CheckCircle2, Copy, Plus, Trash2, XCircle } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { Inspection, InspectionParameter, InspectionType, Ncr, NcrDisposition } from '@/data/types'
import { Button, Checkbox, Field, Input, Modal, Segmented, StatusBadge, guard, toast } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, todayISO } from '@/lib/dates'
import { num } from '@/lib/format'
import { uuid } from '@/lib/ids'
import { cn } from '@/lib/misc'
import {
  DISPOSITION_LABEL, INSPECTION_TYPE_LABEL, RESULT_LABEL, autoResult, inspectionErrors, isAttribute, ncrErrors, paramErrors, paramOk, saveInspection, saveNcr, type InspectionInput, type NcrInput,
} from '@/services/quality'
import { PO_STATUS_LABEL } from '@/services/purchase'
import { WO_STATUS_LABEL } from '@/services/production'
import { useForm, toNum, numStr } from '../form'
import { AreaF, DateF, NumF, SelectF, TextF } from '../fields'
import { FormSection, ModalActions, NumInput } from '../kit'

interface DialogProps {
  open: boolean
  onClose: () => void
}

/* ─────────────────────────── inspection ─────────────────────────── */

interface ParamRow {
  key: string
  name: string
  spec: string
  lower: string
  upper: string
  measured: string
  ok: boolean
}
interface InspV { type: string; date: string; work_order_id: string; po_id: string; part_name: string; lot_no: string; lot_qty: string; sample_size: string; accepted_qty: string; rejected_qty: string; conditional: boolean; inspector_id: string; remarks: string }

const blankParam = (): ParamRow => ({ key: uuid(), name: '', spec: '', lower: '', upper: '', measured: '', ok: false })
const rowToParam = (p: ParamRow): InspectionParameter => {
  const base = { name: p.name, spec: p.spec, lower: toNum(p.lower), upper: toNum(p.upper), measured: toNum(p.measured), ok: p.ok }
  return { ...base, ok: paramOk(base) }
}
const paramToRow = (p: InspectionParameter, keepMeasured = true): ParamRow => ({
  key: uuid(), name: p.name, spec: p.spec, lower: numStr(p.lower), upper: numStr(p.upper), measured: keepMeasured ? numStr(p.measured) : '', ok: keepMeasured ? p.ok : false,
})
const lotNo = (date: string) => `L${date.replace(/-/g, '').slice(2)}-${String(Math.floor(Math.random() * 90) + 10)}`

export function InspectionForm({ open, onClose, inspection, prefillWoId, prefillPoId, onSaved }: DialogProps & { inspection: Inspection | null; prefillWoId?: string; prefillPoId?: string; onSaved?: (i: Inspection) => void }) {
  const L = useLookups()
  const wos = useTable('work_orders')
  const pos = useTable('purchase_orders')
  const lines = useTable('purchase_order_lines')
  const inspections = useTable('inspections')
  const prefWo = prefillWoId ? wos.find((w) => w.id === prefillWoId) : undefined
  const prefPo = prefillPoId ? pos.find((p) => p.id === prefillPoId) : undefined
  // declared before useForm: its validator (toInput) reads the parameter rows on the first render
  const [params, setParams] = useState<ParamRow[]>(() => (inspection?.parameters.length ? inspection.parameters.map((p) => paramToRow(p)) : [blankParam()]))
  const [paramsTouched, setParamsTouched] = useState(!!inspection)
  const f = useForm<InspV>(
    () => {
      const date = inspection?.date ?? todayISO()
      return {
        type: inspection?.type ?? (prefPo ? 'incoming' : prefWo ? (prefWo.completed_qty >= prefWo.qty ? 'final' : 'in_process') : 'in_process'),
        date, work_order_id: inspection?.work_order_id ?? prefWo?.id ?? '', po_id: inspection?.po_id ?? prefPo?.id ?? '',
        part_name: inspection?.part_name ?? prefWo?.part_name ?? (prefPo ? poPart(prefPo.id) : ''), lot_no: inspection?.lot_no ?? lotNo(date),
        lot_qty: numStr(inspection?.lot_qty), sample_size: numStr(inspection?.sample_size), accepted_qty: numStr(inspection?.accepted_qty), rejected_qty: numStr(inspection?.rejected_qty ?? 0),
        conditional: inspection?.result === 'conditional', inspector_id: inspection?.inspector_id ?? '', remarks: inspection?.remarks ?? '',
      }
    },
    (v) => inspectionErrors(toInput(v)),
  )

  function poPart(poId: string) {
    const ls = lines.filter((l) => l.po_id === poId)
    return ls.length ? `${ls[0]!.description}${ls.length > 1 ? ` (+${ls.length - 1} more)` : ''}` : ''
  }
  function toInput(v: InspV): InspectionInput {
    return {
      type: v.type as InspectionType, date: v.date, work_order_id: v.work_order_id || null, po_id: v.po_id || null, part_name: v.part_name, lot_no: v.lot_no,
      lot_qty: toNum(v.lot_qty), sample_size: toNum(v.sample_size), accepted_qty: toNum(v.accepted_qty), rejected_qty: toNum(v.rejected_qty), conditional: v.conditional,
      inspector_id: v.inspector_id || null, parameters: params.map(rowToParam), remarks: v.remarks,
    }
  }

  const incoming = f.v.type === 'incoming'
  const parsed = params.map(rowToParam)
  const rej = toNum(f.v.rejected_qty) ?? 0
  const auto = autoResult(parsed, rej)
  const result = auto === 'fail' && f.v.conditional ? 'conditional' : auto
  const hint = f.firstError ?? null

  const setLink = (id: string) => {
    if (incoming) {
      const po = pos.find((p) => p.id === id)
      const first = lines.find((l) => l.po_id === id)
      f.patch({ po_id: id, part_name: po ? poPart(id) : f.v.part_name, lot_qty: first && !f.v.lot_qty ? String(Math.round(first.received_qty || first.qty)) : f.v.lot_qty })
    } else {
      const wo = wos.find((w) => w.id === id)
      const lot = wo ? (f.v.type === 'first_article' ? Math.min(5, wo.qty) : f.v.type === 'final' ? wo.completed_qty || wo.qty : 0) : 0
      f.patch({ work_order_id: id, part_name: wo?.part_name ?? f.v.part_name, ...(lot && !f.v.lot_qty ? { lot_qty: String(lot), accepted_qty: String(lot - rej) } : {}) })
    }
  }
  const setLot = (v: string) => {
    const wasSync = (toNum(f.v.accepted_qty) ?? null) === (toNum(f.v.lot_qty) ?? 0) - rej || !f.v.accepted_qty
    const lot = toNum(v)
    f.patch({ lot_qty: v, ...(wasSync && lot != null ? { accepted_qty: String(Math.max(0, lot - rej)) } : {}) })
  }
  const setRej = (v: string) => {
    const lot = toNum(f.v.lot_qty)
    const wasSync = (toNum(f.v.accepted_qty) ?? null) === (lot ?? 0) - rej || !f.v.accepted_qty
    const r = toNum(v)
    f.patch({ rejected_qty: v, ...(wasSync && lot != null && r != null ? { accepted_qty: String(Math.max(0, lot - r)) } : {}) })
  }

  const lastSame = useMemo(() => {
    const name = f.v.part_name.trim().toLowerCase()
    if (!name) return null
    return inspections.filter((i) => i.id !== inspection?.id && i.part_name.trim().toLowerCase() === name && i.parameters.length).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  }, [inspections, f.v.part_name, inspection?.id])

  const updParam = (key: string, p: Partial<ParamRow>) => {
    setParamsTouched(true)
    setParams((ps) => ps.map((x) => (x.key === key ? { ...x, ...p } : x)))
  }

  const linkOptions = incoming
    ? pos.filter((p) => p.status !== 'draft' && p.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date)).map((p) => ({ value: p.id, label: `${p.po_no} · ${db.get('vendors', p.vendor_id)?.name ?? ''} (${PO_STATUS_LABEL[p.status]})` }))
    : wos.filter((w) => w.status !== 'cancelled' || w.id === f.v.work_order_id).sort((a, b) => b.wo_no.localeCompare(a.wo_no)).map((w) => ({ value: w.id, label: `${w.wo_no} · ${w.part_name} (${WO_STATUS_LABEL[w.status]})` }))

  const submit = () =>
    void guard(() => {
      const saved = saveInspection(inspection, toInput(f.v))
      onClose()
      if (saved.result === 'pass') toast.success(`${saved.insp_no} passed`, `${saved.accepted_qty} of ${saved.lot_qty} accepted`)
      else toast.warning(`${saved.insp_no}: ${RESULT_LABEL[saved.result]}`, `${saved.rejected_qty} rejected`)
      onSaved?.(saved)
    })

  return (
    <Modal open={open} onClose={onClose} size="xl" title={inspection ? `Edit ${inspection.insp_no}` : 'New inspection'} subtitle="Result is calculated from the parameters and rejections" footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={hint} label={inspection ? 'Save changes' : 'Save inspection'} />}>
      <div className="space-y-5">
        <Field label="Inspection type" required>
          <Segmented
            value={f.v.type}
            onChange={(t) => f.patch({ type: t, ...(t === 'incoming' ? { work_order_id: '' } : { po_id: '' }) })}
            options={(Object.keys(INSPECTION_TYPE_LABEL) as InspectionType[]).map((t) => ({ value: t, label: INSPECTION_TYPE_LABEL[t] }))}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={incoming ? 'Purchase order' : 'Work order'} required error={f.err(incoming ? 'po_id' : 'work_order_id')} className="sm:col-span-2">
            <select value={incoming ? f.v.po_id : f.v.work_order_id} onChange={(e) => setLink(e.target.value)} className="field-input field-select" aria-invalid={!!f.err(incoming ? 'po_id' : 'work_order_id') || undefined}>
              <option value="">Choose…</option>
              {linkOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <TextF f={f} k="part_name" label="Part / material" required className="sm:col-span-2" />
          <DateF f={f} k="date" label="Date" required max={todayISO()} />
          <TextF f={f} k="lot_no" label="Lot no." />
          <SelectF f={f} k="inspector_id" label="Inspector" required className="sm:col-span-2" options={L.employeeOptions()} placeholder="Choose…" />
        </div>

        <FormSection
          title={`Parameters (${params.length})`}
          action={
            <span className="flex flex-wrap gap-1.5">
              {lastSame && (
                <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => { setParams(lastSame.parameters.map((p) => paramToRow(p, false))); setParamsTouched(false) }}>
                  Copy specs from {lastSame.insp_no}
                </Button>
              )}
              <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setParams((ps) => [...ps, blankParam()])}>
                Add
              </Button>
            </span>
          }
        >
          <div className="space-y-2">
              {params.map((p, i) => {
                const pp = rowToParam(p)
                const attr = isAttribute(pp)
                const ok = paramOk(pp)
                const filled = attr ? true : pp.measured != null
                const err = paramsTouched ? paramErrors(pp) : null
                return (
                  <div
                    key={p.key}
                    className={cn('min-w-0 rounded-lg border p-2.5 transition-colors', !filled ? 'border-line bg-white' : ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50')}
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                      <Input aria-label={`Parameter ${i + 1} name`} value={p.name} onChange={(e) => updParam(p.key, { name: e.target.value })} placeholder="Parameter (e.g. Bore)" className="col-span-2 text-sm sm:col-span-3" />
                      <Input aria-label="Spec" value={p.spec} onChange={(e) => updParam(p.key, { spec: e.target.value })} placeholder="Spec (Ø80 H7)" className="col-span-2 text-sm sm:col-span-2" />
                      <NumInput aria-label="Lower limit" value={p.lower} onChange={(e) => updParam(p.key, { lower: e.target.value })} placeholder="Lower" className="text-sm sm:col-span-2" />
                      <NumInput aria-label="Upper limit" value={p.upper} onChange={(e) => updParam(p.key, { upper: e.target.value })} placeholder="Upper" className="text-sm sm:col-span-2" />
                      {attr ? (
                        <div className="flex items-center sm:col-span-2">
                          <Checkbox checked={p.ok} onChange={(v) => updParam(p.key, { ok: v })} label={<span className="text-[13px]">OK (visual)</span>} />
                        </div>
                      ) : (
                        <NumInput aria-label="Measured" value={p.measured} onChange={(e) => updParam(p.key, { measured: e.target.value })} placeholder="Measured" className="text-sm font-medium sm:col-span-2" />
                      )}
                      <div className="flex items-center justify-end gap-1 sm:col-span-1">
                        {filled && (
                          <span key={String(ok)} title={ok ? 'Within limits' : 'Out of tolerance'}>
                            {ok ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-rose-500" />}
                          </span>
                        )}
                        <Button size="icon-sm" variant="ghost" aria-label="Remove parameter" onClick={() => setParams((ps) => (ps.length > 1 ? ps.filter((x) => x.key !== p.key) : [blankParam()]))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {err && <p className="mt-1 text-[12px] font-medium text-rose-600">{err}</p>}
                  </div>
                )
              })}
            <p className="text-[12px] text-ink-faint">Leave both limits blank for an attribute (visual / go–no-go) check and tick OK.</p>
          </div>
        </FormSection>

        <FormSection title="Lot disposition">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Field label="Lot qty" required error={f.err('lot_qty')}>
              <NumInput value={f.v.lot_qty} min={1} step="1" onChange={(e) => setLot(e.target.value)} invalid={!!f.err('lot_qty')} />
            </Field>
            <NumF f={f} k="sample_size" label="Sample size" required min={1} step="1" />
            <NumF f={f} k="accepted_qty" label="Accepted" required min={0} step="1" />
            <Field label="Rejected" required error={f.err('rejected_qty')}>
              <NumInput value={f.v.rejected_qty} min={0} step="1" onChange={(e) => setRej(e.target.value)} invalid={!!f.err('rejected_qty')} />
            </Field>
          </div>
          <div className={cn('mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3', result === 'pass' ? 'border-emerald-200 bg-emerald-50/60' : result === 'conditional' ? 'border-amber-200 bg-amber-50/60' : 'border-rose-200 bg-rose-50/60')}>
            <span className="text-[12px] font-medium uppercase tracking-wider text-ink-faint">Result</span>
            <span key={result}>
              <StatusBadge status={result} label={RESULT_LABEL[result]} className="text-[13px]" />
            </span>
            <span className="text-[12.5px] text-ink-soft">
              {parsed.filter((p) => !paramOk(p)).length} parameter{parsed.filter((p) => !paramOk(p)).length === 1 ? '' : 's'} not OK · {num(rej, 0)} rejected
            </span>
            {auto === 'fail' && (
              <Checkbox className="ml-auto" checked={f.v.conditional} onChange={(v) => f.set('conditional', v)} label={<span className="text-[13px] font-medium">Accept conditionally (deviation approved)</span>} />
            )}
          </div>
        </FormSection>
        <AreaF f={f} k="remarks" label="Remarks" rows={2} placeholder="Observations, gauges used, deviation reference…" />
      </div>
    </Modal>
  )
}

/* ─────────────────────────── NCR ─────────────────────────── */

interface NcrV { inspection_id: string; date: string; description: string; qty_affected: string; root_cause: string; corrective_action: string; disposition: string; owner_id: string; status: string }

export function NcrForm({ open, onClose, ncr, fromInspection }: DialogProps & { ncr: Ncr | null; fromInspection?: Inspection | null }) {
  const L = useLookups()
  const inspections = useTable('inspections')
  const f = useForm<NcrV>(
    () => {
      const failed = fromInspection?.parameters.filter((p) => !p.ok) ?? []
      const desc = fromInspection
        ? `${fromInspection.part_name} (${fromInspection.insp_no}, lot ${fromInspection.lot_no || '—'}): ${failed.length ? failed.map((p) => `${p.name} ${p.spec} measured ${p.measured ?? '—'}`).join('; ') : 'rejections found'}.`
        : ''
      return {
        inspection_id: ncr?.inspection_id ?? fromInspection?.id ?? '', date: ncr?.date ?? todayISO(), description: ncr?.description ?? desc,
        qty_affected: numStr(ncr?.qty_affected ?? fromInspection?.rejected_qty ?? 0), root_cause: ncr?.root_cause ?? '', corrective_action: ncr?.corrective_action ?? '',
        disposition: ncr?.disposition ?? 'rework', owner_id: ncr?.owner_id ?? '', status: ncr?.status ?? 'open',
      }
    },
    (v) => ncrErrors(toInput(v)),
  )
  function toInput(v: NcrV): NcrInput {
    return { ...v, inspection_id: v.inspection_id || null, qty_affected: toNum(v.qty_affected), disposition: v.disposition as NcrDisposition, owner_id: v.owner_id || null, status: v.status as Ncr['status'] }
  }
  const submit = () =>
    void guard(() => {
      const n = saveNcr(ncr, toInput(f.v))
      onClose()
      toast.success(ncr ? `${n.ncr_no} updated` : `${n.ncr_no} raised`)
    })
  const insp = inspections.find((i) => i.id === f.v.inspection_id)
  return (
    <Modal open={open} onClose={onClose} size="lg" title={ncr ? `Edit ${ncr.ncr_no}` : 'Raise NCR'} subtitle={insp ? `From ${insp.insp_no} · ${insp.part_name}` : 'Non-conformance report'} footer={<ModalActions onCancel={onClose} onSubmit={submit} disabled={!f.valid} hint={f.firstError} label={ncr ? 'Save changes' : 'Raise NCR'} variant={ncr ? 'primary' : 'danger'} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectF
          f={f}
          k="inspection_id"
          label="Inspection"
          className="sm:col-span-2"
          options={inspections
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((i) => ({ value: i.id, label: `${i.insp_no} · ${fmtDate(i.date)} · ${i.part_name} (${RESULT_LABEL[i.result]})` }))}
          placeholder="— Not linked (e.g. customer complaint) —"
        />
        <DateF f={f} k="date" label="Date" required max={todayISO()} />
        <NumF f={f} k="qty_affected" label="Qty affected" required min={0} step="1" />
        <AreaF f={f} k="description" label="Non-conformance" required className="sm:col-span-2" rows={3} />
        <Field label="Disposition" required className="sm:col-span-2">
          <Segmented value={f.v.disposition} onChange={(v) => f.set('disposition', v)} options={(Object.keys(DISPOSITION_LABEL) as NcrDisposition[]).map((d) => ({ value: d, label: DISPOSITION_LABEL[d] }))} />
        </Field>
        <AreaF f={f} k="root_cause" label="Root cause" className="sm:col-span-2" rows={2} placeholder="Why-why / fishbone outcome" />
        <AreaF f={f} k="corrective_action" label="Corrective action" required={f.v.status === 'closed'} className="sm:col-span-2" rows={2} placeholder="What prevents a repeat" />
        <SelectF f={f} k="owner_id" label="Owner" options={L.employeeOptions()} placeholder="— Unassigned —" />
        <Field label="Status" required>
          <Segmented value={f.v.status} onChange={(v) => f.set('status', v)} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
        </Field>
        {ncr?.closed_on && f.v.status === 'closed' && <p className="text-[12.5px] text-ink-soft sm:col-span-2">Closed on {fmtDate(ncr.closed_on)}</p>}
      </div>
    </Modal>
  )
}
