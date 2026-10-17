import type { ReactNode } from 'react'
import { cn } from '@/lib/misc'
import { titleCase } from '@/lib/format'

export type Tone = 'indigo' | 'cyan' | 'pink' | 'green' | 'amber' | 'red' | 'slate' | 'violet' | 'sky'

const tones: Record<Tone, string> = {
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200/70',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200/70',
  pink: 'bg-pink-50 text-pink-700 ring-pink-200/70',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200/80',
  red: 'bg-rose-50 text-rose-700 ring-rose-200/70',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200/70',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200/70',
}

export function Badge({ tone = 'indigo', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Consistent colours for every status value used across modules. */
const STATUS_TONES: Record<string, Tone> = {
  // generic approval
  pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate', paid: 'indigo', active: 'green', closed: 'slate',
  // employees
  on_notice: 'amber', exited: 'slate',
  // payroll
  draft: 'slate', processed: 'cyan',
  // tasks
  todo: 'slate', in_progress: 'cyan', review: 'violet', done: 'green',
  // priority
  low: 'slate', medium: 'sky', high: 'amber', urgent: 'red',
  // machines
  running: 'green', idle: 'slate', breakdown: 'red', maintenance: 'amber',
  open: 'red', // maintenance log / NCR
  // purchase
  sent: 'sky', partial: 'amber', received: 'green',
  // work orders
  planned: 'slate', qc: 'violet', completed: 'green', dispatched: 'indigo', on_hold: 'amber',
  // quality
  pass: 'green', fail: 'red', conditional: 'amber',
  // tools / assets
  issued: 'amber', returned: 'green', lost: 'red', in_use: 'green', in_store: 'slate', repair: 'amber', disposed: 'slate',
  // attendance
  present: 'green', half_day: 'amber', absent: 'red', on_duty: 'cyan', none: 'slate',
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'slate'} dot className={className}>
      {label ?? titleCase(status)}
    </Badge>
  )
}
