import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Banknote, Clock3, FileCheck2, Paperclip, Plus, ReceiptIndianRupee, Trash2, Wallet } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { PettyCashVoucher, VoucherStatus } from '@/data/types'
import { Button, Card, EmptyState, PageHeader, Segmented, StatCard, StatusBadge, confirm, guard, toast } from '@/components/ui'
import { VoucherForm } from '@/components/petty/VoucherForm'
import { VoucherTimeline } from '@/components/petty/VoucherTimeline'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { openFile } from '@/services/files'
import { withdrawClaim } from '@/services/pettyCash'
import { currentMonth, fmtDate } from '@/lib/dates'
import { inr, inr2 } from '@/lib/format'
import { sum } from '@/lib/misc'

type Filter = 'all' | VoucherStatus

export default function MyClaimsPage() {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const vouchers = useTable('petty_cash_vouchers')
  const me = s.employee
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const mine = useMemo(
    () => (me ? vouchers.filter((v) => v.employee_id === me.id).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)) : []),
    [vouchers, me],
  )
  const month = currentMonth()
  const stats = useMemo(() => {
    const pending = mine.filter((v) => v.status === 'pending')
    const approved = mine.filter((v) => v.status === 'approved')
    const paidMonth = mine.filter((v) => v.status === 'paid' && (v.paid_at ?? v.updated_at).slice(0, 7) === month)
    return {
      pendingAmt: sum(pending, (v) => v.amount),
      pendingN: pending.length,
      approvedAmt: sum(approved, (v) => v.amount),
      approvedN: approved.length,
      paidAmt: sum(paidMonth, (v) => v.amount),
      paidN: paidMonth.length,
    }
  }, [mine, month])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: mine.length, pending: 0, approved: 0, paid: 0, rejected: 0 }
    for (const v of mine) c[v.status]++
    return c
  }, [mine])
  const list = filter === 'all' ? mine : mine.filter((v) => v.status === filter)

  const withdraw = async (v: PettyCashVoucher) => {
    const ok = await confirm({ title: 'Withdraw this claim?', message: `${inr2(v.amount)} · ${v.category} · ${fmtDate(v.date)}. It will be deleted and Accounts will no longer see it.`, danger: true, confirmLabel: 'Withdraw claim' })
    if (ok) await guard(() => withdrawClaim(v), 'Claim withdrawn')
  }
  const reviewerName = (id: string | null) => {
    if (!id) return undefined
    const n = L.userName(id)
    return n !== '—' ? n : 'Accounts'
  }

  if (!me)
    return (
      <div>
        <PageHeader kicker="My space" title="Petty-cash claims" />
        <EmptyState icon={<Wallet className="h-6 w-6" />} title="No employee record linked" description="Claims are raised against an employee record. Ask HR to link your login to your employee profile." />
      </div>
    )

  return (
    <div>
      <PageHeader
        kicker="My space"
        title="Petty-cash claims"
        subtitle={`Claim small expenses you paid for the plant. Bills older than 30 days can't be claimed.`}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            New claim
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 xs:grid-cols-3 lg:gap-4">
        <StatCard label="Pending approval" value={stats.pendingAmt} format={inr} icon={<Clock3 className="h-4 w-4" />} accent="amber" hint={`${stats.pendingN} claim${stats.pendingN === 1 ? '' : 's'}`} onClick={() => setFilter('pending')} />
        <StatCard label="Approved · awaiting cash" value={stats.approvedAmt} format={inr} icon={<FileCheck2 className="h-4 w-4" />} accent="indigo" hint={stats.approvedN ? 'Collect from Accounts' : 'Nothing to collect'} onClick={() => setFilter('approved')} />
        <StatCard label="Paid this month" value={stats.paidAmt} format={inr} icon={<Banknote className="h-4 w-4" />} accent="green" hint={`${stats.paidN} claim${stats.paidN === 1 ? '' : 's'}`} onClick={() => setFilter('paid')} />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={(['all', 'pending', 'approved', 'paid', 'rejected'] as Filter[]).map((f) => ({ value: f, label: `${f === 'all' ? 'All' : f[0]!.toUpperCase() + f.slice(1)} · ${counts[f]}` }))}
        />
        <p className="text-[12px] text-ink-soft">Claims above {inr(settings.petty_cash_approval_limit)} need Super Admin approval.</p>
      </div>

      <div className="mt-3">
        {!list.length ? (
          <EmptyState
            icon={<ReceiptIndianRupee className="h-6 w-6" />}
            title={mine.length ? 'No claims with this status' : 'No claims yet'}
            description={mine.length ? undefined : 'Spent money on tea for a customer visit, a courier or shop-floor consumables? Raise a claim with the bill and get reimbursed from petty cash.'}
            action={
              !mine.length ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
                  Raise your first claim
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <AnimatePresence initial={false}>
              {list.map((v, i) => (
                <motion.li
                  key={v.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                  className="min-w-0"
                >
                  <Card className="h-full p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-white shadow-soft">
                        <ReceiptIndianRupee className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[14.5px] font-semibold text-ink">{v.description}</p>
                            <p className="truncate text-[12px] text-ink-soft">
                              {v.category} · {v.payee || '—'}
                              {v.bill_no ? ` · Bill ${v.bill_no}` : ''}
                            </p>
                          </div>
                          <p className="num shrink-0 font-display text-[18px] font-bold text-ink">{inr2(v.amount)}</p>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-faint">
                          <StatusBadge status={v.status} />
                          <span className="num font-semibold">{v.voucher_no}</span>
                          <span>· bill date {fmtDate(v.date)}</span>
                        </div>
                      </div>
                    </div>
                    <VoucherTimeline voucher={v} reviewer={reviewerName(v.reviewed_by)} className="mt-4" />
                    {(v.attachment || v.status === 'pending') && (
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-indigo-50 pt-3">
                        {v.attachment && (
                          <Button size="sm" variant="ghost" icon={<Paperclip className="h-4 w-4" />} onClick={() => void openFile(v.attachment).catch((e: unknown) => toast.error('Could not open the bill', e instanceof Error ? e.message : String(e)))}>
                            View bill
                          </Button>
                        )}
                        {v.status === 'pending' && (
                          <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="h-4 w-4" />} onClick={() => void withdraw(v)}>
                            Withdraw
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <VoucherForm open={open} onClose={close} mode="claim" employeeId={me.id} />
    </div>
  )
}
