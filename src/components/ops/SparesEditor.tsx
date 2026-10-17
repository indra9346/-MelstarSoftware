/** Spares-used rows (item + qty ≤ stock) for PM completion and breakdown closure. */
import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { SpareUsed } from '@/data/types'
import { Button, Select } from '@/components/ui'
import { inr, num } from '@/lib/format'
import { uuid } from '@/lib/ids'
import { round3 } from '@/services/inventory'
import { NumInput } from './kit'
import { toNum } from './form'

export interface SpareRow {
  key: string
  item_id: string
  qty: string
}

export const newSpareRow = (): SpareRow => ({ key: uuid(), item_id: '', qty: '' })
export const rowsFromSpares = (s: SpareUsed[]): SpareRow[] => s.map((x) => ({ key: uuid(), item_id: x.item_id, qty: String(x.qty) }))
export const sparesFromRows = (rows: SpareRow[]): SpareUsed[] =>
  rows.filter((r) => r.item_id && (toNum(r.qty) ?? 0) > 0).map((r) => ({ item_id: r.item_id, qty: round3(toNum(r.qty)!) }))

/** Per-row error messages; `already` = spares this job has already drawn (they count as available). */
export function sparesErrors(rows: SpareRow[], stock: Map<string, number>, already: SpareUsed[] = []): (string | null)[] {
  const total = new Map<string, number>()
  for (const r of rows) {
    const q = toNum(r.qty)
    if (r.item_id && q != null && q > 0) total.set(r.item_id, round3((total.get(r.item_id) ?? 0) + q))
  }
  const prior = new Map<string, number>()
  for (const s of already) prior.set(s.item_id, round3((prior.get(s.item_id) ?? 0) + s.qty))
  return rows.map((r) => {
    const q = toNum(r.qty)
    if (!r.item_id && !r.qty) return null
    if (!r.item_id) return 'Pick an item'
    if (q == null) return 'Enter the quantity'
    if (q <= 0) return 'Must be greater than zero'
    const avail = round3((stock.get(r.item_id) ?? 0) + (prior.get(r.item_id) ?? 0))
    if ((total.get(r.item_id) ?? 0) > avail) return `Only ${num(avail, 3)} available`
    return null
  })
}

export function SparesEditor({ rows, onChange, already = [], disabled }: { rows: SpareRow[]; onChange: (rows: SpareRow[]) => void; already?: SpareUsed[]; disabled?: boolean }) {
  const items = useTable('inventory_items')
  const options = useMemo(
    () =>
      items
        .filter((i) => i.active || rows.some((r) => r.item_id === i.id))
        .sort((a, b) => (a.category === b.category ? a.sku.localeCompare(b.sku) : a.category === 'spare' ? -1 : b.category === 'spare' ? 1 : a.category.localeCompare(b.category)))
        .map((i) => ({ value: i.id, label: `${i.sku} — ${i.name} (${num(i.stock_qty, 3)} ${i.uom})` })),
    [items, rows],
  )
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const stock = useMemo(() => new Map(items.map((i) => [i.id, i.stock_qty])), [items])
  const errors = sparesErrors(rows, stock, already)
  const value = rows.reduce((s, r) => s + (toNum(r.qty) ?? 0) * (byId.get(r.item_id)?.unit_cost ?? 0), 0)
  const upd = (key: string, p: Partial<SpareRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)))

  return (
    <div className="min-w-0 space-y-2">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => {
          const it = byId.get(r.item_id)
          return (
            <motion.div key={r.key} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="min-w-0">
              <div className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-start gap-2">
                <Select aria-label={`Spare ${i + 1}`} value={r.item_id} onChange={(e) => upd(r.key, { item_id: e.target.value })} options={options} placeholder="Choose item…" disabled={disabled} invalid={!!errors[i] && !r.item_id} className="text-sm" />
                <NumInput aria-label={`Quantity ${i + 1}`} value={r.qty} min={0} onChange={(e) => upd(r.key, { qty: e.target.value })} placeholder={it ? it.uom : 'Qty'} disabled={disabled} invalid={!!errors[i] && !!r.item_id} className="text-sm" />
                <Button size="icon" variant="ghost" onClick={() => onChange(rows.filter((x) => x.key !== r.key))} aria-label="Remove spare" disabled={disabled}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {errors[i] && <p className="mt-1 text-[12px] font-medium text-rose-600">{errors[i]}</p>}
            </motion.div>
          )
        })}
      </AnimatePresence>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, newSpareRow()])} disabled={disabled}>
          Add spare
        </Button>
        {value > 0 && <span className="text-[12.5px] text-ink-soft">Spares at stock cost: <b className="num text-ink">{inr(value)}</b></span>}
      </div>
    </div>
  )
}
