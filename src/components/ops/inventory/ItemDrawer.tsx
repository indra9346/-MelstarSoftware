/** Inventory item drawer: stock position, running-balance chart, movement history, open POs, tools on issue. */
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Scale, ShoppingCart } from 'lucide-react'
import { useTable } from '@/data/store'
import type { InventoryItem, StockMovement, StockMovementType } from '@/data/types'
import { Badge, Button, EmptyState, InfoGrid, Modal } from '@/components/ui'
import { ChartBox, ChartGradients, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, fmtDateShort } from '@/lib/dates'
import { inr } from '@/lib/format'
import { cn } from '@/lib/misc'
import { ITEM_CATEGORY_LABEL, fmtQty, isLowStock, itemValue, round3, signedQty } from '@/services/inventory'
import { OPEN_PO, remainingQty } from '@/services/purchase'
import { FormSection, StockBar, Tile } from '../kit'

export const MOVE_TONE: Record<StockMovementType, 'green' | 'amber' | 'violet'> = { in: 'green', out: 'amber', adjust: 'violet' }
export const MOVE_LABEL: Record<StockMovementType, string> = { in: 'In', out: 'Out', adjust: 'Adjust' }

export function SignedQty({ m, uom }: { m: StockMovement; uom?: string }) {
  const q = signedQty(m)
  return (
    <span className={cn('num font-semibold', q > 0 ? 'text-emerald-700' : q < 0 ? 'text-amber-700' : 'text-ink')}>
      {q > 0 ? '+' : q < 0 ? '−' : ''}
      {fmtQty(Math.abs(q))}
      {uom && <span className="ml-1 text-[11.5px] font-medium text-ink-faint">{uom}</span>}
    </span>
  )
}

export function ItemDrawer({
  open, onClose, item, canManage, canPo, onMove, onEdit, onRaisePo,
}: {
  open: boolean
  onClose: () => void
  item: InventoryItem
  canManage: boolean
  canPo: boolean
  onMove: (mode: StockMovementType) => void
  onEdit: () => void
  onRaisePo: () => void
}) {
  const L = useLookups()
  const movements = useTable('stock_movements')
  const vendors = useTable('vendors')
  const pos = useTable('purchase_orders')
  const lines = useTable('purchase_order_lines')
  const issues = useTable('tool_issues')
  const history = useMemo(() => movements.filter((m) => m.item_id === item.id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [movements, item.id])
  const chart = useMemo(() => history.map((m) => ({ label: fmtDateShort(m.date), balance: m.balance_after, ref: m.reference })), [history])
  const onOrder = useMemo(() => {
    const open = new Map(pos.filter((p) => OPEN_PO.includes(p.status)).map((p) => [p.id, p]))
    return lines.filter((l) => l.item_id === item.id && open.has(l.po_id) && remainingQty(l) > 0).map((l) => ({ line: l, po: open.get(l.po_id)! }))
  }, [pos, lines, item.id])
  const onIssue = issues.filter((t) => t.item_id === item.id && t.status === 'issued')
  const vendor = vendors.find((v) => v.id === item.preferred_vendor_id)
  const low = isLowStock(item)
  const onOrderQty = round3(onOrder.reduce((s, o) => s + remainingQty(o.line), 0))

  return (
    <Modal
      open={open}
      onClose={onClose}
      side
      size="lg"
      title={item.name}
      subtitle={`${item.sku} · ${ITEM_CATEGORY_LABEL[item.category]}${item.active ? '' : ' · inactive'}`}
      footer={
        <>
          {canManage && (
            <Button variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={onEdit} className="mr-auto">
              Edit
            </Button>
          )}
          {canPo && (low || item.stock_qty <= 0) && (
            <Button variant="outline" icon={<ShoppingCart className="h-4 w-4" />} onClick={onRaisePo}>
              Raise PO
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="secondary" icon={<Scale className="h-4 w-4" />} onClick={() => onMove('adjust')}>
                Adjust
              </Button>
              <Button variant="secondary" icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => onMove('out')} disabled={item.stock_qty <= 0}>
                Out
              </Button>
              <Button variant="success" icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => onMove('in')}>
                In
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
          <StockBar qty={item.stock_qty} reorder={item.reorder_level} uom={item.uom} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.stock_qty <= 0 ? <Badge tone="red" dot>Out of stock</Badge> : low ? <Badge tone="amber" dot>Low stock</Badge> : <Badge tone="green" dot>Healthy</Badge>}
            {onOrderQty > 0 && <Badge tone="sky">On order {fmtQty(onOrderQty)} {item.uom}</Badge>}
            {onIssue.length > 0 && <Badge tone="violet">{onIssue.length} on issue</Badge>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile label="In stock" value={`${fmtQty(item.stock_qty)} ${item.uom}`} tone={item.stock_qty <= 0 ? 'red' : low ? 'amber' : undefined} />
          <Tile label="Value" value={inr(itemValue(item))} sub={`${inr(item.unit_cost)}/${item.uom}`} />
          <Tile label="Re-order level" value={fmtQty(item.reorder_level)} />
          <Tile label="Movements" value={history.length} />
        </div>

        <FormSection title="Running balance">
          {chart.length > 1 ? (
            <ChartBox height={200}>
              <AreaChart data={chart} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                <ChartGradients />
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} allowDecimals={false} width={48} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`${fmtQty(v)} ${item.uom}`, 'Balance']} labelFormatter={(l, p) => `${l}${p?.[0]?.payload?.ref ? ` · ${p[0].payload.ref}` : ''}`} />
                {item.reorder_level > 0 && <ReferenceLine y={item.reorder_level} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'ROL', fill: '#b45309', fontSize: 11, position: 'insideTopRight' }} />}
                <Area type="stepAfter" dataKey="balance" stroke="#6366f1" strokeWidth={2.2} fill="url(#gIndigo)" />
              </AreaChart>
            </ChartBox>
          ) : (
            <p className="text-sm text-ink-faint">Not enough movements to chart yet.</p>
          )}
        </FormSection>

        <FormSection title="Details">
          <InfoGrid
            items={[
              ['Location', item.location || '—'],
              ['HSN', item.hsn || '—'],
              ['Preferred vendor', vendor ? `${vendor.code} — ${vendor.name}` : '—'],
              ['Status', item.active ? 'Active' : 'Inactive'],
            ]}
          />
        </FormSection>

        {onOrder.length > 0 && (
          <FormSection title="On order">
            <ul className="space-y-1.5">
              {onOrder.map(({ line, po }) => (
                <li key={line.id} className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{po.po_no}</span>
                  <span className="num shrink-0 text-ink-soft">
                    {fmtQty(remainingQty(line))} {line.uom} · due {fmtDate(po.expected_date)}
                  </span>
                </li>
              ))}
            </ul>
          </FormSection>
        )}

        {onIssue.length > 0 && (
          <FormSection title="On issue (tool crib)">
            <ul className="space-y-1.5">
              {onIssue.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{L.empName(t.employee_id)}</span>
                  <span className="num shrink-0 text-ink-soft">
                    {fmtQty(t.qty)} · since {fmtDate(t.issued_on)}
                  </span>
                </li>
              ))}
            </ul>
          </FormSection>
        )}

        <FormSection title={`Movement history (${history.length})`}>
          {history.length ? (
            <ul className="divide-y divide-indigo-50 overflow-hidden rounded-2xl border border-indigo-100 bg-white/80">
              {history
                .slice()
                .reverse()
                .slice(0, 40)
                .map((m) => (
                  <li key={m.id} className="flex items-start gap-3 px-3.5 py-2.5">
                    <Badge tone={MOVE_TONE[m.type]} className="mt-0.5 w-[58px] justify-center">
                      {MOVE_LABEL[m.type]}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{m.reference || '—'}</span>
                      <span className="block truncate text-[12px] text-ink-soft">
                        {fmtDate(m.date)} · {m.reason || '—'} · {L.userName(m.by_user_id)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <SignedQty m={m} />
                      <span className="num block text-[12px] text-ink-faint">bal {fmtQty(m.balance_after)}</span>
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <EmptyState title="No movements yet" />
          )}
        </FormSection>
      </div>
    </Modal>
  )
}
