import type { ReactNode } from 'react'
import { cn } from '@/lib/misc'
import { titleCase } from '@/lib/format'

export type Tone = 'indigo' | 'cyan' | 'pink' | 'green' | 'amber' | 'red' | 'slate' | 'violet' | 'sky'

// Muted status palette: neutral, blue (info / in progress), green, amber, red, plus purple and teal
// for the few statuses that need a sixth or seventh distinct value.
const tones: Record<Tone, string> = {
  indigo: 'bg-brand-50 text-brand-700 border-brand-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
  cyan: 'bg-teal-50 text-teal-800 border-teal-200',
  pink: 'bg-rose-50 text-rose-700 border-rose-200',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
}

export function Badge({ tone = 'indigo', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-px text-[12px] font-medium leading-[18px]', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />}
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
  draft: 'slate', processed: 'sky',
  // tasks
  todo: 'slate', in_progress: 'sky', review: 'violet', done: 'green',
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
