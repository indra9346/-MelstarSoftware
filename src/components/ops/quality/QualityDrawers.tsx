/** Inspection detail (colour-coded parameter table, linked NCRs) and NCR detail drawers. */
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, CheckCircle2, ExternalLink, Lock, Pencil, Trash2, XCircle } from 'lucide-react'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'
import type { Inspection, Ncr } from '@/data/types'
import { Badge, Button, InfoGrid, Menu, Modal, StatusBadge } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { diffDays, fmtDate, todayISO } from '@/lib/dates'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { DISPOSITION_LABEL, INSPECTION_TYPE_LABEL, RESULT_LABEL, isAttribute, paramOk } from '@/services/quality'
import { FormSection, Tile } from '../kit'

const limits = (lo: number | null, hi: number | null) => (lo == null && hi == null ? 'Attribute' : lo != null && hi != null ? `${num(lo, 4)} – ${num(hi, 4)}` : lo != null ? `≥ ${num(lo, 4)}` : `≤ ${num(hi, 4)}`)

export function InspectionDrawer({ open, onClose, inspection, canManage, onEdit, onDelete, onRaiseNcr, onOpenNcr }: { open: boolean; onClose: () => void; inspection: Inspection; canManage: boolean; onEdit: () => void; onDelete: () => void; onRaiseNcr: () => void; onOpenNcr: (n: Ncr) => void }) {
  const navigate = useNavigate()
  const s = useSession()
  const wo = useTable('work_orders').find((w) => w.id === inspection.work_order_id)
  const po = useTable('purchase_orders').find((p) => p.id === inspection.po_id)
  const ncrs = useTable('ncrs').filter((n) => n.inspection_id === inspection.id)
  const bad = inspection.parameters.filter((p) => !paramOk(p)).length
  const yieldPct = inspection.lot_qty ? (inspection.accepted_qty / inspection.lot_qty) * 100 : 0
  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="lg"
      title={`${inspection.insp_no} · ${INSPECTION_TYPE_LABEL[inspection.type]}`}
      subtitle={`${inspection.part_name} · ${fmtDate(inspection.date)}`}
      footer={
        canManage ? (
          <>
            <Menu align="left" items={[{ label: 'Delete inspection', icon: <Trash2 />, danger: true, onClick: onDelete }]} />
            <span className="flex-1" />
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            {inspection.result !== 'pass' && (
              <Button variant="danger" icon={<AlertOctagon className="h-4 w-4" />} onClick={onRaiseNcr}>
                Raise NCR
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={inspection.result} label={RESULT_LABEL[inspection.result]} className="text-[13px]" />
          <Badge tone="indigo">{INSPECTION_TYPE_LABEL[inspection.type]}</Badge>
          {inspection.lot_no && <Badge tone="slate">Lot {inspection.lot_no}</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="Lot qty" value={num(inspection.lot_qty, 0)} sub={`sample ${inspection.sample_size}`} />
          <Tile label="Accepted" value={num(inspection.accepted_qty, 0)} sub={`${yieldPct.toFixed(1)}%`} tone="green" />
          <Tile label="Rejected" value={num(inspection.rejected_qty, 0)} tone={inspection.rejected_qty ? 'red' : undefined} />
          <Tile label="Parameters" value={`${inspection.parameters.length - bad}/${inspection.parameters.length}`} sub="within spec" tone={bad ? 'red' : 'green'} />
        </div>

        <FormSection title="Parameters">
          <div className="overflow-x-auto rounded-lg border border-line bg-white scroll-thin">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  <th className="px-3 py-2">Parameter</th>
                  <th className="px-3 py-2">Spec</th>
                  <th className="px-3 py-2 text-right">Limits</th>
                  <th className="px-3 py-2 text-right">Measured</th>
                  <th className="px-3 py-2 text-center">OK</th>
                </tr>
              </thead>
              <tbody>
                {inspection.parameters.map((p, i) => {
                  const ok = paramOk(p)
                  return (
                    <tr key={i} className={cn('border-b border-line last:border-0', ok ? 'bg-emerald-50/40' : 'bg-rose-50/70')}>
                      <td className="px-3 py-2 font-medium text-ink">{p.name}</td>
                      <td className="px-3 py-2 text-ink-soft">{p.spec || '—'}</td>
                      <td className="num px-3 py-2 text-right text-ink-soft">{limits(p.lower, p.upper)}</td>
                      <td className={cn('num px-3 py-2 text-right font-semibold', ok ? 'text-emerald-700' : 'text-rose-700')}>{isAttribute(p) ? (p.ok ? 'OK' : 'NG') : num(p.measured, 4)}</td>
                      <td className="px-3 py-2 text-center">{ok ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" /> : <XCircle className="mx-auto h-4 w-4 text-rose-500" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection title="Details">
          <InfoGrid
            items={[
              [inspection.type === 'incoming' ? 'Purchase order' : 'Work order', wo && !s.canAny(['sales.view', 'sales.manage']) ? wo.wo_no : po && !s.canAny(['purchase.view', 'purchase.manage']) ? po.po_no : wo ? (
                <button key="wo" type="button" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline" onClick={() => navigate(`/admin/production?wo=${wo.id}`)}>
                  {wo.wo_no} <ExternalLink className="h-3 w-3" />
                </button>
              ) : po ? (
                <button key="po" type="button" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline" onClick={() => navigate(`/admin/purchase?po=${po.id}`)}>
                  {po.po_no} <ExternalLink className="h-3 w-3" />
                </button>
              ) : '—'],
              ['Inspector', <EmployeeCell key="i" id={inspection.inspector_id} size={26} />],
            ]}
          />
          {inspection.remarks && <p className="mt-3 whitespace-pre-line rounded-md bg-slate-50 px-3.5 py-2.5 text-[13px] text-ink">{inspection.remarks}</p>}
        </FormSection>

        <FormSection title={`NCRs (${ncrs.length})`}>
          {ncrs.length ? (
            <ul className="space-y-1.5">
              {ncrs.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onOpenNcr(n)} className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-left text-sm transition hover:border-line-strong">
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{n.ncr_no} · {DISPOSITION_LABEL[n.disposition]}</span>
                      <span className="block truncate text-[12px] text-ink-soft">{n.description}</span>
                    </span>
                    <StatusBadge status={n.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">{inspection.result === 'pass' ? 'No non-conformance.' : 'No NCR raised yet for this failure.'}</p>
          )}
        </FormSection>
      </div>
    </Modal>
  )
}

export function NcrDrawer({ open, onClose, ncr, canManage, onEdit, onCloseNcr, onOpenInspection }: { open: boolean; onClose: () => void; ncr: Ncr; canManage: boolean; onEdit: () => void; onCloseNcr: () => void; onOpenInspection: (id: string) => void }) {
  const insp = useTable('inspections').find((i) => i.id === ncr.inspection_id)
  const age = diffDays(ncr.date, ncr.closed_on ?? todayISO())
  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="md"
      title={ncr.ncr_no}
      subtitle={`${DISPOSITION_LABEL[ncr.disposition]} · ${fmtDate(ncr.date)}`}
      footer={
        canManage ? (
          <>
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            {ncr.status === 'open' && (
              <Button variant="success" icon={<Lock className="h-4 w-4" />} onClick={onCloseNcr}>
                Close NCR
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={ncr.status} />
          <Badge tone={ncr.status === 'open' && age > 14 ? 'red' : 'slate'}>{ncr.status === 'open' ? `Open ${age} d` : `Closed in ${age} d`}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="Qty affected" value={num(ncr.qty_affected, 0)} />
          <Tile label="Disposition" value={DISPOSITION_LABEL[ncr.disposition]} />
        </div>
        <FormSection title="Non-conformance">
          <p className="whitespace-pre-line text-sm text-ink">{ncr.description}</p>
        </FormSection>
        <FormSection title="Root cause">
          <p className="whitespace-pre-line text-sm text-ink">{ncr.root_cause || <span className="text-ink-faint">Not recorded yet</span>}</p>
        </FormSection>
        <FormSection title="Corrective action">
          <p className="whitespace-pre-line text-sm text-ink">{ncr.corrective_action || <span className="text-ink-faint">Required before closing</span>}</p>
        </FormSection>
        <InfoGrid
          items={[
            ['Owner', <EmployeeCell key="o" id={ncr.owner_id} size={26} />],
            ['Inspection', insp ? (
              <button key="i" type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => onOpenInspection(insp.id)}>
                {insp.insp_no} · {insp.part_name}
              </button>
            ) : '—'],
            ['Closed on', fmtDate(ncr.closed_on)],
          ]}
        />
      </div>
    </Modal>
  )
}
