import { useEffect, useId, useRef, type ReactNode } from 'react'
import { animate, motion, useInView, useMotionValue, useTransform } from 'framer-motion'
import { cn } from '@/lib/misc'

/** Number that counts up when it first appears and animates to new values (live dashboards). */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => format(v))
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true })
  useEffect(() => {
    if (!seen) return
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] })
    return () => c.stop()
  }, [value, seen, mv])
  return <motion.span ref={ref} className={cn('num', className)}>{text}</motion.span>
}

const accents = {
  indigo: 'from-indigo-500 to-violet-500',
  cyan: 'from-cyan-500 to-sky-500',
  pink: 'from-pink-500 to-rose-500',
  green: 'from-emerald-500 to-teal-500',
  amber: 'from-amber-500 to-orange-500',
  red: 'from-rose-500 to-red-500',
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

export function StatCard({ label, value, format, icon, accent = 'indigo', hint, onClick, className }: StatProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'card group relative w-full overflow-hidden p-4 text-left transition-all duration-500 ease-brand sm:p-5',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lift active:scale-[.99]',
        className,
      )}
    >
      <span className={cn('pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-[.12] transition-transform duration-700 group-hover:scale-125', accents[accent])} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-semibold text-ink-soft">{label}</p>
        {icon && <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', accents[accent])}>{icon}</span>}
      </div>
      <p className="mt-1.5 font-display text-[26px] font-bold leading-tight text-ink sm:text-[28px]">
        <AnimatedNumber value={value} format={format} />
      </p>
      {hint && <div className="mt-1 text-[12px] text-ink-soft">{hint}</div>}
    </Tag>
  )
}

/** Thin progress bar with brand gradient. */
export function Progress({ value, max = 100, className, tone }: { value: number; max?: number; className?: string; tone?: string }) {
  const pctv = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-indigo-100/70', className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: tone ?? 'linear-gradient(90deg,#06b6d4,#6366f1,#ec4899)' }}
        initial={{ width: 0 }}
        animate={{ width: `${pctv}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}

/** Circular progress ring (attendance %, OEE …). */
export function Ring({ value, size = 92, stroke = 9, label, sub }: { value: number; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value))
  const gid = `ring-${useId().replace(/:/g, '')}`
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#06b6d4" />
            <stop offset=".55" stopColor="#6366f1" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(99,102,241,.12)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v / 100) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-display text-lg font-bold leading-none text-ink">{label ?? `${Math.round(v)}%`}</div>
          {sub && <div className="mt-0.5 text-[10.5px] font-medium text-ink-soft">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
