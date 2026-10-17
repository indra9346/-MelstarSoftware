/** Small UI pieces shared by the operations pages. */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Eye, Star } from 'lucide-react'
import { Badge, Button, Input, Select, type Option } from '@/components/ui'
import { cn } from '@/lib/misc'
import { num } from '@/lib/format'

/** Footer for form modals: validation hint on the left, Cancel + primary on the right. */
export function ModalActions({
  onCancel, onSubmit, label, disabled, hint, busy, variant = 'primary', icon, cancelLabel = 'Cancel',
}: {
  onCancel: () => void
  onSubmit?: () => void
  label?: string
  disabled?: boolean
  hint?: string | null
  busy?: boolean
  variant?: 'primary' | 'danger' | 'success'
  icon?: ReactNode
  cancelLabel?: string
}) {
  return (
    <>
      {hint && disabled && <p className="mr-auto min-w-0 flex-1 basis-full text-[12.5px] font-medium text-rose-600 sm:basis-auto sm:truncate">{hint}</p>}
      <Button variant="secondary" onClick={onCancel}>
        {cancelLabel}
      </Button>
      {onSubmit && (
        <Button variant={variant} onClick={onSubmit} disabled={disabled} loading={busy} icon={icon}>
          {label ?? 'Save'}
        </Button>
      )}
    </>
  )
}

/** KPI grid: 1 column at 320px, 2 from 400px, 4 on desktop. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-5 grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0', className)}>{children}</div>
}

export function ViewOnly({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <Badge tone="slate" className="gap-1">
      <Eye className="h-3 w-3" /> View only
    </Badge>
  )
}

/** <input type=number> that accepts decimals and keeps the value as text. */
export const NumInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode }>(function NumInput(props, ref) {
  return <Input ref={ref} type="number" step="any" inputMode="decimal" {...props} />
})

/** Compact select for table toolbars. */
export function FilterSelect({ value, onChange, options, placeholder, className, label }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; className?: string; label: string }) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options}
      placeholder={placeholder}
      className={cn('h-10 w-full py-0 text-sm xs:w-auto xs:min-w-[150px]', className)}
    />
  )
}

/** Stock level vs re-order level: thin bar + figures. */
export function StockBar({ qty, reorder, uom, className }: { qty: number; reorder: number; uom?: string; className?: string }) {
  const max = Math.max(reorder * 2, qty, 1)
  const pctv = Math.min(100, (qty / max) * 100)
  const tone = qty <= 0 ? '#f43f5e' : reorder > 0 && qty <= reorder ? '#f59e0b' : '#10b981'
  return (
    <div className={cn('min-w-[96px]', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-sm font-semibold text-ink">
          {num(qty, 3)}
          {uom && <span className="ml-1 text-[11.5px] font-medium text-ink-faint">{uom}</span>}
        </span>
        {reorder > 0 && <span className="num text-[11px] text-ink-faint">ROL {num(reorder, 3)}</span>}
      </div>
      <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div className="h-full rounded-full" style={{ background: tone }} initial={{ width: 0 }} animate={{ width: `${pctv}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
        {reorder > 0 && <span className="absolute inset-y-0 w-px bg-ink/40" style={{ left: `${Math.min(100, (reorder / max) * 100)}%` }} />}
      </div>
    </div>
  )
}

/** 1–5 star rating, editable when onChange is given. */
export function Stars({ value, onChange, size = 16 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? 'radiogroup' : undefined} aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value
        const star = <Star style={{ width: size, height: size }} className={cn('transition-colors', on ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(n)} className="rounded p-0.5 hover:scale-110 active:scale-95">
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </span>
  )
}

export const PALETTE = ['#06b6d4', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#0ea5e9', '#f97316', '#14b8a6', '#ef4444', '#64748b', '#a855f7']

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Colour ${c}`}
          className={cn('h-8 w-8 rounded-full ring-offset-2 transition hover:scale-110', value.toLowerCase() === c && 'ring-2 ring-ink')}
          style={{ background: c }}
        />
      ))}
      <label className="relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-indigo-300 text-[10px] font-semibold text-ink-soft" title="Custom colour">
        +
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#6366f1'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  )
}

/** Coloured chip (work centre, category …). */
export function Chip({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold', className)} style={{ borderColor: `${color}55`, background: `${color}12`, color: '#1e2b5c' }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Horizontal stacked bar for a status mix. */
export function MixBar({ parts, className }: { parts: { label: string; value: number; color: string }[]; className?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100', className)} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
      {total > 0 &&
        parts.filter((p) => p.value > 0).map((p) => (
          <motion.span key={p.label} title={`${p.label}: ${p.value}`} className="h-full" style={{ background: p.color }} initial={{ width: 0 }} animate={{ width: `${(p.value / total) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
        ))}
    </div>
  )
}

/** From/To date inputs for filters. */
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1.5 xs:w-auto">
      <Input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} className="h-10 min-w-0 flex-1 py-0 text-sm xs:w-[150px]" />
      <span className="text-ink-faint">–</span>
      <Input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} className="h-10 min-w-0 flex-1 py-0 text-sm xs:w-[150px]" />
    </div>
  )
}

/** Label + value tile used in drawers. */
export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  return (
    <div className={cn('min-w-0 rounded-2xl border bg-white/80 px-3.5 py-3', tone === 'red' ? 'border-rose-200' : tone === 'amber' ? 'border-amber-200' : tone === 'green' ? 'border-emerald-200' : 'border-indigo-100')}>
      <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="num mt-0.5 truncate font-display text-lg font-bold text-ink">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-ink-soft">{sub}</p>}
    </div>
  )
}

/** Section heading inside drawers / forms. */
export function FormSection({ title, children, action, className }: { title: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[.12em] text-brand-indigo">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Fade/slide-in wrapper for page sections (first render only). */
export function Reveal({ children, i = 0, className }: { children: ReactNode; i?: number; className?: string }) {
  return (
    <motion.div className={cn('min-w-0', className)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}
