import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/misc'

export function EmptyState({ title, description, icon, action, className }: { title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200 bg-white/60 px-6 py-10 text-center', className)}>
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-50 to-indigo-100 text-brand-indigo">{icon ?? <Inbox className="h-6 w-6" />}</span>
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-soft">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
