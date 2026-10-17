import { useCallback, useState } from 'react'
import { db } from '@/data/store'
import type { PettyCashVoucher } from '@/data/types'
import { confirm, confirmWithNote, guard, toast } from '@/components/ui'
import { approvalBlock, approveAndPay, approveVoucher, cashInHand, payBlock, payVoucher, rejectVoucher } from '@/services/pettyCash'
import { fullName, inr } from '@/lib/format'

const who = (v: PettyCashVoucher) => fullName(db.get('employees', v.employee_id))

/** Approve / reject / pay with the right confirmations and messages. `busy` = voucher id being paid. */
export function useVoucherActions() {
  const [busy, setBusy] = useState<string | null>(null)

  const approve = useCallback(async (v: PettyCashVoucher) => {
    const block = approvalBlock(v)
    if (block) return void toast.warning('Cannot approve', block)
    await guard(() => approveVoucher(v), `Approved ${v.voucher_no} · ${inr(v.amount)}`)
  }, [])

  const reject = useCallback(async (v: PettyCashVoucher) => {
    const r = await confirmWithNote({
      title: `Reject ${v.voucher_no}?`,
      message: `${inr(v.amount)} · ${v.category} · ${who(v)}. The employee sees your reason.`,
      danger: true,
      confirmLabel: 'Reject claim',
      input: { label: 'Reason', placeholder: 'e.g. Bill not attached / personal expense', required: true },
    })
    if (!r.ok) return
    await guard(() => rejectVoucher(v, r.note), `Rejected ${v.voucher_no}`)
  }, [])

  const pay = useCallback(async (v: PettyCashVoucher) => {
    const block = payBlock(v, cashInHand())
    if (block) return void toast.warning('Cannot pay yet', block)
    const ok = await confirm({
      title: `Pay ${inr(v.amount)} to ${who(v)}?`,
      message: `Hand over the cash and post it to the petty cash book as “${v.voucher_no} · ${v.description}”. This cannot be undone.`,
      confirmLabel: 'Pay from cash box',
    })
    if (!ok) return
    setBusy(v.id)
    await guard(() => payVoucher(v), `Paid ${inr(v.amount)} · cash book updated`)
    setBusy(null)
  }, [])

  const approvePay = useCallback(async (v: PettyCashVoucher) => {
    const block = approvalBlock(v)
    if (block) return void toast.warning('Cannot approve', block)
    const bal = cashInHand()
    if (v.amount > bal) return void toast.warning('Not enough cash in hand', `${inr(bal)} in the box — top up first, or approve now and pay later.`)
    const ok = await confirm({
      title: `Approve & pay ${inr(v.amount)}?`,
      message: `${v.voucher_no} · ${v.category} · ${who(v)}. Approves the claim and posts the cash payment in one step.`,
      confirmLabel: 'Approve & pay',
    })
    if (!ok) return
    setBusy(v.id)
    await guard(() => approveAndPay(v), `Approved & paid ${v.voucher_no}`)
    setBusy(null)
  }, [])

  return { approve, reject, pay, approvePay, busy }
}
