import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/misc'
import { initials } from '@/lib/format'
import { useStoredUrl } from '@/hooks/useStoredUrl'

/* ── Page header ─────────────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions, kicker }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        {kicker && <p className="kicker mb-1">{kicker}</p>}
        <h1 className="text-[24px] font-bold leading-tight text-ink sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */
const AV = ['from-cyan-400 to-indigo-500', 'from-indigo-400 to-violet-500', 'from-pink-400 to-rose-500', 'from-emerald-400 to-teal-500', 'from-amber-400 to-orange-500', 'from-sky-400 to-cyan-500']
export function Avatar({ name, src: stored, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const src = useStoredUrl(stored)
  const idx = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AV.length
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.36) }
  if (src && (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')))
    return <img src={src} alt={name} style={style} className={cn('shrink-0 rounded-full object-cover ring-2 ring-white', className)} />
  return (
    <span style={style} className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-display font-semibold text-white ring-2 ring-white', AV[idx], className)} aria-hidden>
      {initials(name)}
    </span>
  )
}

/* ── Tabs with animated indicator ────────────────────────────────────────── */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  const id = useRef(`tabs-${Math.random().toString(36).slice(2)}`).current
  return (
    <div className={cn('-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-indigo-100 px-1 no-scrollbar', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn('relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-1.5 text-[13.5px] font-semibold transition-colors', value === t.value ? 'text-ink' : 'text-ink-soft hover:text-ink')}
        >
          {t.label}
          {t.count != null && t.count > 0 && <span className={cn('num rounded-full px-1.5 py-px text-[11px]', value === t.value ? 'bg-brand-indigo text-white' : 'bg-indigo-100 text-indigo-700')}>{t.count}</span>}
          {value === t.value && <motion.span layoutId={id} className="absolute inset-x-1 -bottom-px h-[3px] rounded-full bg-grad" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  )
}

/* ── Overflow menu ───────────────────────────────────────────────────────── */
export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}
export function Menu({ items, trigger, align = 'right' }: { items: MenuItem[]; trigger?: ReactNode; align?: 'left' | 'right' }) {
  const [pos, setPos] = useState<{ top: number; left: number; right: number; up: boolean } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const open = !!pos
  const toggle = () => {
    if (pos) return setPos(null)
    const r = btn.current!.getBoundingClientRect()
    // open upwards when there isn't room below (e.g. above the phone bottom bar)
    const up = window.innerHeight - r.bottom < Math.min(320, items.length * 40 + 24)
    setPos({ top: up ? r.top : r.bottom, left: r.left, right: window.innerWidth - r.right, up })
  }
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setPos(null)
    }
    const dismiss = () => setPos(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])
  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button ref={btn} type="button" onClick={toggle} className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft transition hover:bg-indigo-50 hover:text-ink" aria-label="More actions" aria-expanded={open}>
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={panel}
              initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
                ...(align === 'right' ? { right: Math.max(8, pos.right) } : { left: Math.max(8, pos.left) }),
              }}
              className="z-[75] min-w-[180px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-indigo-100 bg-white p-1 shadow-lift"
              role="menu"
            >
              {items.map((it, i) => (
                <button
                  key={i}
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setPos(null)
                    it.onClick()
                  }}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition disabled:opacity-40', it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink hover:bg-indigo-50')}
                >
                  {it.icon && <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>}
                  {it.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

/* ── Staggered list entrance (cheap: opacity + translate only, first render) ── */
export const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04, duration: 0.45, ease: [0.22, 1, 0.36, 1] } }),
}

/* ── Section title inside pages ──────────────────────────────────────────── */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-1 flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  )
}

/* ── Key/value row ───────────────────────────────────────────────────────── */
export function KV({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-soft">{k}</span>
      <span className={cn('num text-right', strong ? 'font-semibold text-ink' : 'text-ink')}>{v}</span>
    </div>
  )
}
