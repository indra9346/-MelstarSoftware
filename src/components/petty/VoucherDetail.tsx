import { Banknote, Check, ShieldAlert, X, Zap } from 'lucide-react'
import { useRow } from '@/data/store'
import { Button, InfoGrid, Modal, StatusBadge } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { approvalBlock, payBlock } from '@/services/pettyCash'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { amountInWords, inr2 } from '@/lib/format'
import { BillPreview } from './BillPreview'
import { VoucherTimeline } from './VoucherTimeline'
import type { useVoucherActions } from './useVoucherActions'

/** Admin view of one voucher with bill preview, status timeline and approve / reject / pay. */
export function VoucherDetail({ id, onClose, balance, actions }: { id: string | null; onClose: () => void; balance: number; actions: ReturnType<typeof useVoucherActions> }) {
  const v = useRow('petty_cash_vouchers', id)
  const entry = useRow('petty_cash_entries', v?.ledger_entry_id)
  const s = useSession()
  const L = useLookups()
  const manage = s.can('petty_cash.manage')
  const approveBlock = v ? approvalBlock(v, s) : null
  const payBlocked = v ? payBlock(v, balance, s) : null
  const reviewer = v?.reviewed_by ? (L.userName(v.reviewed_by) !== '—' ? L.userName(v.reviewed_by) : 'Accounts') : undefined

  return (
    <Modal
      open={!!id && !!v}
      onClose={onClose}
      side
      size="md"
      title={
        v && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{v.voucher_no}</span>
            <StatusBadge status={v.status} />
          </span>
        )
      }
      subtitle={v ? `${v.category} · ${fmtDate(v.date)}` : undefined}
      footer={
        v && manage && (v.status === 'pending' || v.status === 'approved') ? (
          <>
            <Button variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<X className="h-4 w-4" />} onClick={() => void actions.reject(v)}>
              Reject
            </Button>
            {v.status === 'pending' && (
              <>
                <Button variant="secondary" icon={<Check className="h-4 w-4" />} disabled={!!approveBlock} title={approveBlock ?? undefined} onClick={() => void actions.approve(v)}>
                  Approve
                </Button>
                <Button icon={<Zap className="h-4 w-4" />} disabled={!!approveBlock} loading={actions.busy === v.id} onClick={() => void actions.approvePay(v)}>
                  Approve & pay
                </Button>
              </>
            )}
            {v.status === 'approved' && (
              <Button variant="success" icon={<Banknote className="h-4 w-4" />} disabled={!!payBlocked} title={payBlocked ?? undefined} loading={actions.busy === v.id} onClick={() => void actions.pay(v)}>
                Pay {inr2(v.amount)}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {v && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-gradient-to-br from-cyan-50 via-indigo-50 to-pink-50 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">Amount claimed</p>
            <p className="num font-display text-[30px] font-bold leading-tight text-ink">{inr2(v.amount)}</p>
            <p className="text-[12px] text-ink-soft">{amountInWords(v.amount)}</p>
          </div>

          <VoucherTimeline voucher={v} reviewer={reviewer} />

          {manage && v.status === 'pending' && approveBlock && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">
              <ShieldAlert className="mt-px h-4 w-4 shrink-0" /> {approveBlock}
            </p>
          )}
          {manage && v.status === 'approved' && payBlocked && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">
              <ShieldAlert className="mt-px h-4 w-4 shrink-0" /> {payBlocked}
            </p>
          )}

          <div>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Claimant</p>
            <EmployeeCell id={v.employee_id} sub="department" size={38} />
          </div>

          <InfoGrid
            items={[
              ['Bill date', fmtDate(v.date)],
              ['Category', v.category],
              ['Paid to', v.payee || '—'],
              ['Bill / receipt no.', v.bill_no || '—'],
              ['Submitted', fmtDateTime(v.created_at)],
              ['Reviewed', v.reviewed_at ? `${fmtDateTime(v.reviewed_at)}${reviewer ? ` · ${reviewer}` : ''}` : '—'],
              ['Paid', v.paid_at ? fmtDateTime(v.paid_at) : '—'],
              ['Cash book entry', entry ? `${entry.entry_no} · ${fmtDate(entry.date)}` : '—'],
            ]}
          />
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Description</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-sm text-ink">{v.description}</p>
          </div>
          <div>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Bill</p>
            <BillPreview stored={v.attachment} />
          </div>
        </div>
      )}
    </Modal>
  )
}
