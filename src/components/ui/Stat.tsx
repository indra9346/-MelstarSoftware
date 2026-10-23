import type { ReactNode } from 'react'
import { cn } from '@/lib/misc'

const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-IN')

/** Icon colour per accent; the card itself stays neutral. */
const accents = {
  indigo: 'text-brand-600',
  cyan: 'text-teal-600',
  pink: 'text-slate-500',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
} as const

export interface StatProps {
  label: string
  value: number
  format?: (n: number) => string
  icon?: ReactNode
  accent?: keyof typeof accents
  hint?: ReactNode
  onClick?: () => void
  className?: string
}

export function StatCard({ label, value, format = defaultFormat, icon, accent = 'indigo', hint, onClick, className }: StatProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'card relative flex w-full flex-col items-stretch justify-start p-4 text-left transition-colors',
        onClick && 'cursor-pointer hover:border-line-strong hover:bg-slate-50/60',
        accent === 'red' && 'border-l-[3px] border-l-red-500',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-soft">{label}</p>
        {icon && <span className={cn('shrink-0 [&>svg]:h-4 [&>svg]:w-4', accents[accent])}>{icon}</span>}
      </div>
      <p className="num mt-2 text-[24px] font-semibold leading-none tracking-tight text-ink">{format(value)}</p>
      {hint && <div className="mt-2 text-[12px] text-ink-soft">{hint}</div>}
    </Tag>
  )
}

/** Thin progress bar. `tone` overrides the brand colour (any CSS colour). */
export function Progress({ value, max = 100, className, tone }: { value: number; max?: number; className?: string; tone?: string }) {
  const pctv = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80', className)} role="progressbar" aria-valuenow={Math.round(pctv)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${pctv}%`, ...(tone ? { background: tone } : null) }} />
    </div>
  )
}

/** Circular progress ring (attendance %, OEE …). */
export function Ring({ value, size = 92, stroke = 8, label, sub }: { value: number; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e8ed" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#2a56a1"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num text-lg font-semibold leading-none text-ink">{label ?? `${Math.round(v)}%`}</div>
          {sub && <div className="mt-0.5 text-[10.5px] font-medium text-ink-soft">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
