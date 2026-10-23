import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/misc'

export function EmptyState({ title, description, icon, action, className }: { title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-white px-6 py-10 text-center', className)}>
      <span className="mb-3 text-ink-faint [&>svg]:h-7 [&>svg]:w-7">{icon ?? <Inbox className="h-7 w-7" />}</span>
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-soft">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
