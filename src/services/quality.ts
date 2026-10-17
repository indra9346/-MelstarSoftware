/**
 * Inspections (incoming / in-process / final / first-article) and non-conformance reports.
 * Parameter OK and the pass/fail result are derived, never typed in.
 */
import { db } from '@/data/store'
import type { Inspection, InspectionParameter, InspectionResult, InspectionType, Ncr, NcrDisposition } from '@/data/types'
import { addMonths, monthOf, todayISO } from '@/lib/dates'
import { nextNumber } from '@/lib/ids'
import { audit, diff } from './audit'
import { requirePerm } from './inventory'

export const INSPECTION_TYPE_LABEL: Record<InspectionType, string> = { incoming: 'Incoming', in_process: 'In-process', final: 'Final', first_article: 'First article' }
export const DISPOSITION_LABEL: Record<NcrDisposition, string> = { rework: 'Rework', scrap: 'Scrap', use_as_is: 'Use as is', return_to_vendor: 'Return to vendor' }
export const RESULT_LABEL: Record<InspectionResult, string> = { pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }

const firstError = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean)
const EPS = 1e-9

/** Variable parameters: measured within [lower, upper]. Attribute checks (no limits): the manual OK tick. */
export function paramOk(p: Pick<InspectionParameter, 'lower' | 'upper' | 'measured' | 'ok'>): boolean {
  if (p.lower == null && p.upper == null) return p.ok
  if (p.measured == null || !Number.isFinite(p.measured)) return false
  return (p.lower == null || p.measured >= p.lower - EPS) && (p.upper == null || p.measured <= p.upper + EPS)
}
export const isAttribute = (p: Pick<InspectionParameter, 'lower' | 'upper'>) => p.lower == null && p.upper == null

export function autoResult(params: Pick<InspectionParameter, 'lower' | 'upper' | 'measured' | 'ok'>[], rejected: number): 'pass' | 'fail' {
  return params.length > 0 && params.every(paramOk) && rejected === 0 ? 'pass' : 'fail'
}

/* ─────────────────────────── inspections ─────────────────────────── */

export interface InspectionInput {
  type: InspectionType
  date: string
  work_order_id: string | null
  po_id: string | null
  part_name: string
  lot_no: string
  lot_qty: number | null
  sample_size: number | null
  accepted_qty: number | null
  rejected_qty: number | null
  conditional: boolean
  inspector_id: string | null
  parameters: InspectionParameter[]
  remarks: string
}

const isWhole = (n: number | null) => n != null && Number.isInteger(n) && n >= 0

export function inspectionErrors(v: InspectionInput): Partial<Record<keyof InspectionInput, string>> {
  const e: Partial<Record<keyof InspectionInput, string>> = {}
  if (!v.date) e.date = 'Date is required'
  else if (v.date > todayISO()) e.date = 'Cannot be in the future'
  if (v.type === 'incoming') {
    if (!v.po_id) e.po_id = 'Link the purchase order'
    else if (!db.get('purchase_orders', v.po_id)) e.po_id = 'PO not found'
  } else if (!v.work_order_id) e.work_order_id = 'Link the work order'
  else if (!db.get('work_orders', v.work_order_id)) e.work_order_id = 'Work order not found'
  if (!v.part_name.trim()) e.part_name = 'Part name is required'
  if (!isWhole(v.lot_qty) || v.lot_qty! < 1) e.lot_qty = 'Whole number, at least 1'
  if (!isWhole(v.sample_size) || v.sample_size! < 1) e.sample_size = 'Whole number, at least 1'
  else if (isWhole(v.lot_qty) && v.sample_size! > v.lot_qty!) e.sample_size = 'Cannot exceed the lot qty'
  if (!isWhole(v.accepted_qty)) e.accepted_qty = 'Whole number, 0 or more'
  if (!isWhole(v.rejected_qty)) e.rejected_qty = 'Whole number, 0 or more'
  else if (isWhole(v.accepted_qty) && isWhole(v.lot_qty) && v.accepted_qty! + v.rejected_qty! > v.lot_qty!) e.rejected_qty = 'Accepted + rejected exceeds the lot qty'
  if (!v.inspector_id) e.inspector_id = 'Who inspected?'
  if (!v.parameters.length) e.parameters = 'Add at least one parameter'
  else {
    const bad = v.parameters.findIndex((p) => paramErrors(p))
    if (bad >= 0) e.parameters = `Parameter ${bad + 1}: ${paramErrors(v.parameters[bad]!)}`
  }
  return e
}

export function paramErrors(p: InspectionParameter): string | null {
  if (!p.name.trim()) return 'name is required'
  if (p.lower != null && !Number.isFinite(p.lower)) return 'invalid lower limit'
  if (p.upper != null && !Number.isFinite(p.upper)) return 'invalid upper limit'
  if (p.lower != null && p.upper != null && p.lower > p.upper) return 'lower limit is above the upper limit'
  if (!isAttribute(p) && p.measured == null) return 'enter the measured value'
  return null
}

export function inspectionResult(v: Pick<InspectionInput, 'parameters' | 'rejected_qty' | 'conditional'>): InspectionResult {
  const auto = autoResult(v.parameters, v.rejected_qty ?? 0)
  return auto === 'fail' && v.conditional ? 'conditional' : auto
}

export function saveInspection(existing: Inspection | null, v: InspectionInput): Inspection {
  requirePerm('quality.manage')
  const err = firstError(inspectionErrors(v))
  if (err) throw new Error(err)
  const parameters = v.parameters.map((p) => ({ name: p.name.trim(), spec: p.spec.trim(), lower: p.lower, upper: p.upper, measured: p.measured, ok: paramOk(p) }))
  const row = {
    type: v.type, date: v.date, work_order_id: v.type === 'incoming' ? null : v.work_order_id, po_id: v.type === 'incoming' ? v.po_id : null,
    part_name: v.part_name.trim(), lot_no: v.lot_no.trim(), lot_qty: v.lot_qty!, sample_size: v.sample_size!, accepted_qty: v.accepted_qty!, rejected_qty: v.rejected_qty!,
    result: inspectionResult({ ...v, parameters }), inspector_id: v.inspector_id, parameters, remarks: v.remarks.trim(),
  }
  if (!existing) {
    const insp = db.insert('inspections', { ...row, insp_no: nextNumber('QI-', db.all('inspections').map((i) => i.insp_no)) })
    audit('create', 'inspections', insp.id, `${INSPECTION_TYPE_LABEL[insp.type]} inspection ${insp.insp_no} — ${insp.part_name}: ${RESULT_LABEL[insp.result]}`)
    return insp
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const insp = db.update('inspections', existing.id, row)
  audit('update', 'inspections', insp.id, `Updated inspection ${insp.insp_no} (${RESULT_LABEL[insp.result]})`, changes)
  return insp
}

export function deleteInspection(i: Inspection) {
  requirePerm('quality.manage')
  const ncrs = db.count('ncrs', (n) => n.inspection_id === i.id)
  if (ncrs) throw new Error(`${i.insp_no} has ${ncrs} NCR${ncrs === 1 ? '' : 's'} linked — it cannot be deleted.`)
  db.remove('inspections', i.id)
  audit('delete', 'inspections', i.id, `Deleted inspection ${i.insp_no} — ${i.part_name}`)
}

/* ─────────────────────────── NCRs ─────────────────────────── */

export interface NcrInput {
  inspection_id: string | null
  date: string
  description: string
  qty_affected: number | null
  root_cause: string
  corrective_action: string
  disposition: NcrDisposition
  owner_id: string | null
  status: Ncr['status']
}

export function ncrErrors(v: NcrInput): Partial<Record<keyof NcrInput, string>> {
  const e: Partial<Record<keyof NcrInput, string>> = {}
  if (!v.date) e.date = 'Date is required'
  else if (v.date > todayISO()) e.date = 'Cannot be in the future'
  if (!v.description.trim()) e.description = 'Describe the non-conformance'
  if (!isWhole(v.qty_affected)) e.qty_affected = 'Whole number, 0 or more'
  if (v.status === 'closed' && !v.corrective_action.trim()) e.corrective_action = 'Required to close the NCR'
  if (v.inspection_id && !db.get('inspections', v.inspection_id)) e.inspection_id = 'Inspection not found'
  return e
}

export function saveNcr(existing: Ncr | null, v: NcrInput): Ncr {
  requirePerm('quality.manage')
  const err = firstError(ncrErrors(v))
  if (err) throw new Error(err)
  const row = {
    inspection_id: v.inspection_id || null, date: v.date, description: v.description.trim(), qty_affected: v.qty_affected!, root_cause: v.root_cause.trim(),
    corrective_action: v.corrective_action.trim(), disposition: v.disposition, owner_id: v.owner_id || null, status: v.status,
    closed_on: v.status === 'closed' ? existing?.closed_on ?? todayISO() : null,
  }
  if (!existing) {
    const n = db.insert('ncrs', { ...row, ncr_no: nextNumber('NCR-', db.all('ncrs').map((x) => x.ncr_no)) })
    audit('create', 'ncrs', n.id, `Raised ${n.ncr_no} — ${n.description.slice(0, 80)}`)
    return n
  }
  const changes = diff(existing, row)
  if (!changes) return existing
  const n = db.update('ncrs', existing.id, row)
  audit('update', 'ncrs', n.id, `Updated ${n.ncr_no}`, changes)
  return n
}

export function closeNcr(n: Ncr, correctiveAction?: string): Ncr {
  requirePerm('quality.manage')
  if (n.status === 'closed') throw new Error(`${n.ncr_no} is already closed.`)
  const ca = (correctiveAction ?? n.corrective_action).trim()
  if (!ca) throw new Error('Record the corrective action before closing.')
  const patch = { status: 'closed' as const, closed_on: todayISO(), corrective_action: ca }
  const row = db.update('ncrs', n.id, patch)
  audit('process', 'ncrs', n.id, `Closed ${n.ncr_no}`, diff(n, patch))
  return row
}

export function deleteNcr(n: Ncr) {
  requirePerm('quality.manage')
  db.remove('ncrs', n.id)
  audit('delete', 'ncrs', n.id, `Deleted ${n.ncr_no}`)
}

/* ─────────────────────────── KPIs ─────────────────────────── */

export function qualityKpis(inspections: Inspection[], ncrs: Ncr[], today = todayISO()) {
  const ym = monthOf(today)
  const month = inspections.filter((i) => monthOf(i.date) === ym)
  const pass = month.filter((i) => i.result === 'pass').length
  return {
    monthCount: month.length,
    passRate: month.length ? (pass / month.length) * 100 : 100,
    rejectedQty: month.reduce((s, i) => s + i.rejected_qty, 0),
    openNcrs: ncrs.filter((n) => n.status === 'open').length,
  }
}

export function qualityTrend(inspections: Inspection[], months = 6, today = todayISO()) {
  const ym = monthOf(today)
  return Array.from({ length: months }, (_, k) => {
    const m = addMonths(ym, k - months + 1)
    const rows = inspections.filter((i) => monthOf(i.date) === m)
    return {
      month: m,
      pass: rows.filter((i) => i.result === 'pass').length,
      conditional: rows.filter((i) => i.result === 'conditional').length,
      fail: rows.filter((i) => i.result === 'fail').length,
    }
  })
}
