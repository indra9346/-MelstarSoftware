import { STUDIO } from '@/config/company'
import { cn } from '@/lib/misc'
import swanLogo from '@/assets/swan-logo.png'

/** Melstar hexagon mark (same shape as the company website), in the solid brand blue. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn('shrink-0', className)} aria-hidden>
      <path fill="#224584" d="M32 4l24 14v28L32 60 8 46V18z" />
      <path fill="#fff" d="M20 42V22l12 10 12-10v20h-5V32l-7 6-7-6v10z" />
    </svg>
  )
}

export function Logo({ sub = 'ERP', className }: { sub?: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="leading-none">
        <span className="block text-[16px] font-semibold text-ink">Melstar</span>
        <span className="mt-1 block text-[11px] font-medium text-ink-faint">{sub}</span>
      </span>
    </span>
  )
}

/** Studio credit: "Designed & developed by Swan Digital Solutions". */
export function SwanCredit({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <p className={cn('inline-flex flex-wrap items-center justify-center gap-1 text-[11.5px] text-ink-faint', className)}>
      <span>{compact ? 'Developed by' : 'Designed & developed by'}</span>
      <a href={STUDIO.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-ink-soft hover:text-ink hover:underline" aria-label="Swan Digital Solutions (opens in a new tab)">
        <img src={swanLogo} width={8} height={13} alt="" className="h-3 w-auto" />
        Swan Digital Solutions
      </a>
    </p>
  )
}
