import { motion } from 'framer-motion'
import { Banknote, BadgeCheck, FilePen, Lock, type LucideIcon } from 'lucide-react'
import type { PayrollRun, PayrollRunStatus } from '@/data/types'
import { cn } from '@/lib/misc'
import { fmtDateTime } from '@/lib/dates'

export const RUN_STEPS: { key: PayrollRunStatus; label: string; icon: LucideIcon }[] = [
  { key: 'draft', label: 'Draft', icon: FilePen },
  { key: 'processed', label: 'Processed', icon: Lock },
  { key: 'approved', label: 'Approved', icon: BadgeCheck },
  { key: 'paid', label: 'Paid', icon: Banknote },
]

const TONE: Record<PayrollRunStatus, { bar: string; text: string }> = {
  draft: { bar: 'bg-slate-400', text: 'text-slate-600' },
  processed: { bar: 'bg-cyan-500', text: 'text-cyan-700' },
  approved: { bar: 'bg-emerald-500', text: 'text-emerald-700' },
  paid: { bar: 'bg-brand-indigo', text: 'text-indigo-700' },
}

export const stepIndex = (s: PayrollRunStatus) => RUN_STEPS.findIndex((x) => x.key === s)

/** Compact pill for tables: four segments filled up to the current step + label. */
export function RunStepBadge({ status, className }: { status: PayrollRunStatus; className?: string }) {
  const idx = stepIndex(status)
  const tone = TONE[status]
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white px-2.5 py-1 ring-1 ring-inset ring-indigo-100', className)} title={`Step ${idx + 1} of 4`}>
      <span className="flex gap-0.5" aria-hidden>
        {RUN_STEPS.map((s, i) => (
          <span key={s.key} className={cn('h-1.5 w-2.5 rounded-full', i <= idx ? tone.bar : 'bg-indigo-100')} />
        ))}
      </span>
      <span className={cn('text-[12px] font-semibold', tone.text)}>{RUN_STEPS[idx]?.label}</span>
    </span>
  )
}

/** Full stepper: Draft → Processed → Approved → Paid with who/when. */
export function RunStepper({ run, userName }: { run: PayrollRun; userName: (id: string | null) => string }) {
  const idx = stepIndex(run.status)
  const meta: Record<PayrollRunStatus, string | null> = {
    draft: run.created_at ? `Created ${fmtDateTime(run.created_at)}` : null,
    processed: run.processed_at ? `${fmtDateTime(run.processed_at)} · ${userName(run.processed_by)}` : null,
    approved: run.approved_at ? `${fmtDateTime(run.approved_at)} · ${userName(run.approved_by)}` : null,
    paid: run.paid_at ? `${fmtDateTime(run.paid_at)}${run.payment_ref ? ` · ${run.payment_ref}` : ''}` : null,
  }
  return (
    <ol className="grid grid-cols-4 gap-1 sm:gap-2" aria-label="Payroll run progress">
      {RUN_STEPS.map((s, i) => {
        const done = i < idx || run.status === 'paid'
        const current = i === idx
        const Icon = s.icon
        return (
          <li key={s.key} className="relative min-w-0">
            {i > 0 && (
              <span className="absolute left-[-50%] right-[50%] top-[17px] h-[3px] rounded-full bg-indigo-100" aria-hidden>
                <motion.span
                  className="block h-full rounded-full bg-grad"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: i <= idx ? 1 : 0 }}
                  style={{ transformOrigin: 'left' }}
                  transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
            )}
            <div className="relative flex flex-col items-center text-center">
              <motion.span
                initial={false}
                animate={{ scale: current ? 1.06 : 1 }}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full ring-4 ring-white transition-colors',
                  done || current ? 'bg-grad text-white shadow-btn' : 'bg-indigo-50 text-ink-faint',
                )}
              >
                <Icon className="h-4 w-4" />
              </motion.span>
              <span className={cn('mt-1.5 truncate text-[12px] font-semibold sm:text-[13px]', current ? 'text-ink' : done ? 'text-ink-soft' : 'text-ink-faint')}>{s.label}</span>
              <span className="mt-0.5 hidden max-w-full truncate text-[11px] text-ink-faint sm:block">{i <= idx ? meta[s.key] ?? '' : ''}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
