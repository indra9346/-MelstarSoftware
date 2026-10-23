import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/misc'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  )
}

/** Card title row: title, optional subtitle and actions on the right. */
export function CardHeader({ title, subtitle, actions, icon, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="shrink-0 text-ink-faint [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4 sm:p-5', className)}>{children}</div>
}

/** Label/value pairs, e.g. on detail drawers. */
export function InfoGrid({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 xs:grid-cols-2' : 'grid-cols-1 xs:grid-cols-2 lg:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] text-ink-faint">{k}</dt>
          <dd className="mt-0.5 break-words text-[13.5px] font-medium text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
