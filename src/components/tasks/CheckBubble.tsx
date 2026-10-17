import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/misc'

const PARTICLES = [0, 60, 120, 180, 240, 300]

/** Round animated checkbox: the tick draws itself and a small burst plays when it gets checked. */
export function CheckBubble({ checked, onChange, disabled, size = 22, label, className }: { checked: boolean; onChange?: () => void; disabled?: boolean; size?: number; label: string; className?: string }) {
  const [burst, setBurst] = useState(0)
  const prev = useRef(checked)
  useEffect(() => {
    if (checked && !prev.current) setBurst((b) => b + 1)
    prev.current = checked
  }, [checked])

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.()
      }}
      className={cn('relative grid shrink-0 place-items-center rounded-full outline-none transition-transform active:scale-90 disabled:cursor-not-allowed focus-visible:ring-4 focus-visible:ring-indigo-500/20', className)}
      style={{ width: size, height: size }}
    >
      <motion.span
        className={cn('absolute inset-0 rounded-full border-2', checked ? 'border-transparent' : disabled ? 'border-slate-200 bg-slate-50' : 'border-indigo-200 bg-white hover:border-brand-indigo')}
        animate={{ scale: checked ? [1, 1.18, 1] : 1 }}
        transition={{ duration: 0.32 }}
      />
      <motion.span
        className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_6px_14px_-6px_rgba(16,185,129,.9)]"
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      />
      <svg viewBox="0 0 24 24" className="relative" style={{ width: size * 0.62, height: size * 0.62 }} aria-hidden>
        <motion.path
          d="M5 12.5l4.2 4.2L19 7"
          fill="none"
          stroke="#fff"
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.28, delay: checked ? 0.08 : 0 }}
        />
      </svg>
      <AnimatePresence>
        {burst > 0 && checked && (
          <motion.span key={burst} className="pointer-events-none absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, delay: 0.25 }}>
            <motion.span className="absolute inset-0 rounded-full border-2 border-emerald-400" initial={{ scale: 1, opacity: 0.8 }} animate={{ scale: 2.1, opacity: 0 }} transition={{ duration: 0.55 }} />
            {PARTICLES.map((deg, i) => (
              <motion.span
                key={deg}
                className={cn('absolute left-[calc(50%-3px)] top-[calc(50%-3px)] h-1.5 w-1.5 rounded-full', ['bg-cyan-400', 'bg-indigo-400', 'bg-pink-400'][i % 3])}
                initial={{ x: 0, y: 0, scale: 1 }}
                animate={{ x: Math.cos((deg * Math.PI) / 180) * size * 0.95, y: Math.sin((deg * Math.PI) / 180) * size * 0.95, scale: 0.2 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}
