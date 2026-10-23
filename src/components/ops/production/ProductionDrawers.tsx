/** Work-order drawer (route, progress, status flow, linked inspections) and customer drawer. */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, FilePlus2, Gauge, Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'
import type { Customer, WorkOrder, WorkOrderStatus } from '@/data/types'
import { Badge, Button, EmptyState, InfoGrid, Menu, Modal, Progress, StatusBadge } from '@/components/ui'
import { diffDays, fmtDate, todayISO } from '@/lib/dates'
import { inr, titleCase } from '@/lib/format'
import { cn } from '@/lib/misc'
import { INSPECTION_TYPE_LABEL, RESULT_LABEL } from '@/services/quality'
import { WO_NEXT, WO_STATUS_LABEL, customerOrderValue, isOpenWo, isWoLate, woBalanceValue, woValue } from '@/services/production'
import { FormSection, Tile } from '../kit'

export const PRIORITY_TONE = { low: 'slate', medium: 'sky', high: 'amber', urgent: 'red' } as const

export function RouteChips({ ids, className }: { ids: string[]; className?: string }) {
  const wcs = useTable('work_centres')
  return (
    <ol className={cn('flex flex-wrap items-center gap-1', className)}>
      {ids.map((id, i) => {
        const w = wcs.find((x) => x.id === id)
        return (
          <li key={`${id}-${i}`} className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2 py-0.5 text-[11.5px] font-semibold text-ink" style={{ borderColor: `${w?.color ?? '#94a3b8'}66` }}>
              <span className="h-2 w-2 rounded-full" style={{ background: w?.color ?? '#94a3b8' }} />
              {w?.code ?? '?'}
            </span>
            {i < ids.length - 1 && <ArrowRight className="h-3 w-3 text-ink-faint" />}
          </li>
        )
      })}
    </ol>
  )
}

export function DueLabel({ wo, today = todayISO() }: { wo: WorkOrder; today?: string }) {
  if (isWoLate(wo, today)) return <Badge tone="red" dot>{diffDays(wo.due_date, today)} d late</Badge>
  if (isOpenWo(wo)) {
    const d = diffDays(today, wo.due_date)
    if (d <= 7) return <Badge tone="amber">{d === 0 ? 'Due today' : `Due in ${d} d`}</Badge>
  }
  return <span className="num text-[12.5px] text-ink-soft">{fmtDate(wo.due_date)}</span>
}

export function WoDrawer({
  open, onClose, wo, canManage, onEdit, onProgress, onStatus, onDelete, onOpenCustomer,
}: {
  open: boolean
  onClose: () => void
  wo: WorkOrder
  canManage: boolean
  onEdit: () => void
  onProgress: () => void
  onStatus: (to: WorkOrderStatus) => void
  onDelete: () => void
  onOpenCustomer: (id: string) => void
}) {
  const navigate = useNavigate()
  const s = useSession()
  const canSeeQa = s.canAny(['quality.view', 'quality.manage'])
  const canInspect = s.can('quality.manage')
  const customer = useTable('customers').find((c) => c.id === wo.customer_id)
  const wcs = useTable('work_centres')
  const inspections = useTable('inspections')
  const linked = useMemo(() => inspections.filter((i) => i.work_order_id === wo.id).sort((a, b) => b.date.localeCompare(a.date)), [inspections, wo.id])
  const today = todayISO()
  const next = WO_NEXT[wo.status]
  const done = wo.qty ? (wo.completed_qty / wo.qty) * 100 : 0
  const yieldPct = wo.completed_qty + wo.rejected_qty > 0 ? (wo.completed_qty / (wo.completed_qty + wo.rejected_qty)) * 100 : 100
  const editable = !['dispatched', 'cancelled'].includes(wo.status)

  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="lg"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{wo.wo_no}</span>
          <Badge tone={PRIORITY_TONE[wo.priority]}>{titleCase(wo.priority)}</Badge>
        </span>
      }
      subtitle={`${wo.part_no} · ${wo.part_name}`}
      footer={
        canManage && editable ? (
          <>
            <Menu align="left" items={[{ label: 'Delete work order', icon: <Trash2 />, danger: true, onClick: onDelete, disabled: wo.status !== 'planned' }]} />
            <span className="flex-1" />
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            {['planned', 'in_progress', 'qc', 'on_hold'].includes(wo.status) && (
              <Button icon={<Gauge className="h-4 w-4" />} onClick={onProgress}>
                Update progress
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={wo.status} label={WO_STATUS_LABEL[wo.status]} />
          <DueLabel wo={wo} today={today} />
        </div>

        {canManage && next.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Move to</p>
            <div className="flex flex-wrap gap-1.5">
              {next.map((st) => (
                <Button key={st} size="sm" variant={st === 'cancelled' ? 'ghost' : st === 'on_hold' ? 'secondary' : 'outline'} onClick={() => onStatus(st)} className={cn(st === 'cancelled' && 'text-rose-600 hover:bg-rose-50')}>
                  {WO_STATUS_LABEL[st]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-line bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="num text-2xl font-semibold text-ink">
              {wo.completed_qty}
              <span className="text-base font-semibold text-ink-faint"> / {wo.qty} nos</span>
            </span>
            <span className="num text-sm font-medium text-ink-soft">{Math.round(done)}%</span>
          </div>
          <Progress value={wo.completed_qty} max={wo.qty} className="h-2.5" />
          <p className="mt-2 text-[12.5px] text-ink-soft">
            {wo.rejected_qty} rejected · yield {yieldPct.toFixed(1)}% · balance {Math.max(0, wo.qty - wo.completed_qty)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="Order value" value={inr(woValue(wo))} sub={`${inr(wo.unit_price)} / pc`} />
          <Tile label="Balance value" value={inr(woBalanceValue(wo))} />
          <Tile label="Start" value={fmtDate(wo.start_date)} />
          <Tile label="Due" value={fmtDate(wo.due_date)} tone={isWoLate(wo, today) ? 'red' : undefined} />
        </div>

        <FormSection title="Route">
          <ol className="space-y-1.5">
            {wo.route_work_centre_ids.map((id, i) => {
              const w = wcs.find((x) => x.id === id)
              return (
                <li key={`${id}-${i}`} className="flex items-center gap-3 rounded-md border border-line bg-white px-3 py-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: w?.color ?? '#94a3b8' }}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{w?.name ?? 'Removed work centre'}</span>
                  <span className="ml-auto text-[12px] font-medium text-ink-faint">{w?.code}</span>
                </li>
              )
            })}
          </ol>
        </FormSection>

        <FormSection title="Order">
          <InfoGrid
            items={[
              ['Customer', customer ? <button key="c" type="button" className="text-left font-semibold text-brand-600 hover:underline" onClick={() => onOpenCustomer(customer.id)}>{customer.name}</button> : '—'],
              ['Customer PO', wo.customer_po_ref || '—'],
              ['Drawing rev.', wo.drawing_rev || '—'],
              ['Material', wo.material || '—'],
            ]}
          />
          {wo.notes && <p className="mt-3 whitespace-pre-line rounded-md bg-slate-50 px-3.5 py-2.5 text-[13px] text-ink">{wo.notes}</p>}
        </FormSection>

        {canSeeQa && (
          <FormSection
            title={`Inspections (${linked.length})`}
            action={
              canInspect && wo.status !== 'cancelled' && (
                <Button size="sm" variant="outline" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => navigate(`/admin/quality?new=1&wo=${wo.id}`)}>
                  Inspect
                </Button>
              )
            }
          >
            {linked.length ? (
              <ul className="space-y-1.5">
                {linked.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => navigate(`/admin/quality?insp=${i.id}`)} className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-left text-sm transition hover:border-line-strong">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">
                          {i.insp_no} · {INSPECTION_TYPE_LABEL[i.type]}
                        </span>
                        <span className="text-[12px] text-ink-soft">
                          {fmtDate(i.date)} · lot {i.lot_qty} · {i.rejected_qty} rejected
                        </span>
                      </span>
                      <StatusBadge status={i.result} label={RESULT_LABEL[i.result]} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No inspections yet" description="First-article, in-process and final inspections appear here." icon={<ClipboardCheck className="h-6 w-6" />} />
            )}
          </FormSection>
        )}
      </div>
    </Modal>
  )
}

export function CustomerDrawer({ open, onClose, customer, canManage, onEdit, onOpenWo, onNewWo, onDelete }: { open: boolean; onClose: () => void; customer: Customer; canManage: boolean; onEdit: () => void; onOpenWo: (id: string) => void; onNewWo: () => void; onDelete: () => void }) {
  const wos = useTable('work_orders')
  const mine = useMemo(() => wos.filter((w) => w.customer_id === customer.id).sort((a, b) => b.created_at.localeCompare(a.created_at)), [wos, customer.id])
  const stats = customerOrderValue(customer.id, wos)
  const book = mine.filter(isOpenWo).reduce((s, w) => s + woBalanceValue(w), 0)
  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="md"
      title={customer.name}
      subtitle={`${customer.code}${customer.active ? '' : ' · inactive'}`}
      footer={
        canManage ? (
          <>
            <Menu align="left" items={[{ label: 'Delete customer', icon: <Trash2 />, danger: true, onClick: onDelete }]} />
            <span className="flex-1" />
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
            {customer.active && (
              <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={onNewWo}>
                New WO
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label="Work orders" value={stats.count} sub={`${stats.open} open`} />
          <Tile label="Order value" value={inr(stats.value)} />
          <Tile label="Order book" value={inr(book)} tone={customer.credit_limit > 0 && book > customer.credit_limit ? 'amber' : undefined} sub={customer.credit_limit ? `limit ${inr(customer.credit_limit)}` : undefined} />
        </div>
        <FormSection title="Contact">
          <ul className="space-y-1.5 text-sm text-ink">
            {customer.contact_person && <li className="font-medium">{customer.contact_person}</li>}
            {customer.phone && (
              <li className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-ink-faint" />
                <a href={`tel:${customer.phone.replace(/\s/g, '')}`} className="hover:text-brand-600">{customer.phone}</a>
              </li>
            )}
            {customer.email && (
              <li className="flex min-w-0 items-center gap-2">
                <Mail className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <a href={`mailto:${customer.email}`} className="truncate hover:text-brand-600">{customer.email}</a>
              </li>
            )}
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span>{[customer.address, customer.state].filter(Boolean).join(', ') || '—'}</span>
            </li>
          </ul>
          <div className="mt-3">
            <InfoGrid items={[['GSTIN', customer.gstin || '—'], ['Payment terms', `${customer.payment_terms_days} days`]]} />
          </div>
          {customer.notes && <p className="mt-3 rounded-md bg-slate-50 px-3.5 py-2.5 text-[13px]">{customer.notes}</p>}
        </FormSection>
        <FormSection title={`Work orders (${mine.length})`}>
          {mine.length ? (
            <ul className="space-y-1.5">
              {mine.map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => onOpenWo(w.id)} className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-left text-sm transition hover:border-line-strong">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">
                        {w.wo_no} · {w.part_name}
                      </span>
                      <span className="text-[12px] text-ink-soft">
                        {w.completed_qty}/{w.qty} · due {fmtDate(w.due_date)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="num font-semibold">{inr(woValue(w))}</span>
                      <StatusBadge status={w.status} label={WO_STATUS_LABEL[w.status]} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No work orders yet" />
          )}
        </FormSection>
      </div>
    </Modal>
  )
}
