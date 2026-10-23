import { Banknote, Check, Clock3, FileCheck2, Send, X } from 'lucide-react'
import type { PettyCashVoucher } from '@/data/types'
import { fmtDateTime } from '@/lib/dates'
import { cn } from '@/lib/misc'

interface Step {
  key: string
  label: string
  at: string | null
  state: 'done' | 'current' | 'todo' | 'failed'
  icon: typeof Check
}

function steps(v: PettyCashVoucher): Step[] {
  const submitted: Step = { key: 'submitted', label: 'Submitted', at: v.created_at, state: 'done', icon: Send }
  if (v.status === 'rejected') return [submitted, { key: 'rejected', label: 'Rejected', at: v.reviewed_at, state: 'failed', icon: X }]
  const approved: Step = {
    key: 'approved',
    label: v.status === 'pending' ? 'Awaiting approval' : 'Approved',
    at: v.status === 'pending' ? null : v.reviewed_at,
    state: v.status === 'pending' ? 'current' : 'done',
    icon: v.status === 'pending' ? Clock3 : FileCheck2,
  }
  const paid: Step = {
    key: 'paid',
    label: v.status === 'paid' ? 'Paid' : v.status === 'approved' ? 'Awaiting payment' : 'Payment',
    at: v.paid_at,
    state: v.status === 'paid' ? 'done' : v.status === 'approved' ? 'current' : 'todo',
    icon: Banknote,
  }
  return [submitted, approved, paid]
}

const dotTone = {
  done: 'bg-emerald-600 text-white',
  current: 'bg-white text-amber-700 ring-2 ring-amber-400',
  todo: 'bg-slate-100 text-slate-400',
  failed: 'bg-red-600 text-white',
} as const

/** Submitted → approved → paid (or rejected + note), with timestamps. */
export function VoucherTimeline({ voucher, reviewer, className }: { voucher: PettyCashVoucher; reviewer?: string; className?: string }) {
  const list = steps(voucher)
  return (
    <div className={cn('min-w-0', className)}>
      <ol className="flex items-start">
        {list.map((st, i) => (
          <li key={st.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {i > 0 && (
              <span className="absolute right-1/2 top-[13px] h-[2px] w-full -translate-y-1/2 overflow-hidden bg-slate-200" aria-hidden>
                <span
                  className={cn('block h-full', st.state === 'failed' ? 'bg-red-300' : 'bg-emerald-500')} style={{ width: st.state === 'todo' ? '0%' : '100%' }}
                />
              </span>
            )}
            <span
              className={cn('relative z-[1] grid h-[26px] w-[26px] place-items-center rounded-full', dotTone[st.state])}
            >
              <st.icon className="h-3.5 w-3.5" />
            </span>
            <span className={cn('mt-1.5 px-1 text-[11.5px] font-semibold leading-tight', st.state === 'failed' ? 'text-rose-600' : st.state === 'todo' ? 'text-ink-faint' : 'text-ink')}>{st.label}</span>
            {st.at && <span className="num px-1 text-[10.5px] leading-tight text-ink-soft">{fmtDateTime(st.at)}</span>}
          </li>
        ))}
      </ol>
      {voucher.status === 'rejected' && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
          <b>Reason:</b> {voucher.review_note || 'No reason given.'}
          {reviewer && <span className="text-rose-500"> — {reviewer}</span>}
        </p>
      )}
      {voucher.status !== 'rejected' && voucher.review_note && (
        <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-[12.5px] text-ink-soft">
          <b className="text-ink">Note:</b> {voucher.review_note}
          {reviewer && <span> — {reviewer}</span>}
        </p>
      )}
    </div>
  )
}
