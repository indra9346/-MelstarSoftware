import { useId } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { STUDIO } from '@/config/company'
import { cn } from '@/lib/misc'
import swanLogo from '@/assets/swan-logo.png'

/** Melstar hexagon mark (same as the company website). */
export function LogoMark({ size = 34, className }: { size?: number; className?: string }) {
  // unique gradient id per instance: a duplicate id inside a hidden copy would blank this one
  const gid = `mlogo-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#06b6d4" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gid})`} d="M32 4l24 14v28L32 60 8 46V18z" />
      <path fill="#fff" d="M20 42V22l12 10 12-10v20h-5V32l-7 6-7-6v10z" />
    </svg>
  )
}

export function Logo({ sub = 'ERP', className }: { sub?: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="leading-none">
        <span className="block font-display text-[17px] font-bold tracking-tight text-ink">Melstar</span>
        <span className="mt-1 block text-[9.5px] font-semibold uppercase tracking-[.2em] text-ink-soft">{sub}</span>
      </span>
    </span>
  )
}

export function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden>
      <i className="a1" />
      <i className="a2" />
      <i className="a3" />
      <div className="grid" />
    </div>
  )
}

/** "Designed & Developed with ♥ by Swan Digital Solutions" — studio credit. */
export function SwanCredit({ compact, className }: { compact?: boolean; className?: string }) {
  const hid = `hg-${useId().replace(/:/g, '')}`
  return (
    <p className={cn('inline-flex flex-wrap items-center justify-center gap-1.5 text-[12px] font-medium text-ink-soft', className)}>
      <span>{compact ? 'Crafted with' : 'Designed & Developed with'}</span>
      <svg viewBox="0 0 24 24" className="heart-beat h-[14px] w-[14px] shrink-0" role="img" aria-label="love">
        <defs>
          <linearGradient id={hid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5a7a" />
            <stop offset="1" stopColor="#e0112b" />
          </linearGradient>
        </defs>
        <path fill={`url(#${hid})`} d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
      <span>by</span>
      <a
        href={STUDIO.url}
        target="_blank"
        rel="noopener"
        className="group inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-gradient-to-br from-white to-rose-50 px-2 py-0.5 font-display text-[12.5px] font-bold text-ink transition hover:-translate-y-px hover:border-rose-300 hover:shadow-[0_8px_18px_-10px_rgba(224,17,43,.5)]"
        aria-label="Swan Digital Solutions — opens in a new tab"
      >
        <img src={swanLogo} width={10} height={16} alt="" className="h-4 w-auto transition-transform duration-500 group-hover:-rotate-6" />
        <span>
          Swan Digital <em className="bg-gradient-to-r from-[#e0112b] to-[#ff5a7a] bg-clip-text not-italic text-transparent">Solutions</em>
        </span>
        <ArrowUpRight className="h-3 w-3 text-[#e0112b] transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
      </a>
    </p>
  )
}
