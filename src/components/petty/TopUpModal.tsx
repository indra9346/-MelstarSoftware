import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowDownToLine, IndianRupee, Wand2 } from 'lucide-react'
import { Button, Field, Input, KV, Modal, toast } from '@/components/ui'
import { topUp, topUpErrors, type TopUpInput } from '@/services/pettyCash'
import { todayISO } from '@/lib/dates'
import { amountInWords, inr, round2 } from '@/lib/format'

const PRESETS = ['Cash withdrawn from current account', 'Cheque encashed — imprest replenishment', 'Refund of unspent advance']

/** Cash received into the petty-cash box ('in' entry in the cash book). */
export function TopUpModal({ open, onClose, balance, imprest }: { open: boolean; onClose: () => void; balance: number; imprest: number }) {
  const [t, setT] = useState<TopUpInput>({ date: todayISO(), amount: null, description: PRESETS[0]! })
  const [amountText, setAmountText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setT({ date: todayISO(), amount: null, description: PRESETS[0]! })
    setAmountText('')
    setSubmitted(false)
    setTouched(new Set())
  }, [open])

  const errors = useMemo(() => topUpErrors(t), [t])
  const show = (k: keyof TopUpInput) => (submitted || touched.has(k) ? errors[k] : undefined)
  const touch = (k: string) => setTouched((s) => new Set(s).add(k))
  const shortfall = round2(imprest - balance)
  const valid = !Object.keys(errors).length

  const setAmount = (n: number | null) => {
    setAmountText(n == null ? '' : String(n))
    setT((p) => ({ ...p, amount: n }))
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (!valid) return
    try {
      const entry = topUp(t, /refund/i.test(t.description) ? 'Refund' : 'Imprest top-up')
      toast.success('Cash added to the box', `${entry.entry_no} · ${inr(entry.amount)}`)
      onClose()
    } catch (err) {
      toast.error('Could not record the top-up', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Top up petty cash"
      subtitle="Record cash put into the box. It appears as a receipt in the cash book."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} disabled={submitted && !valid} icon={<ArrowDownToLine className="h-4 w-4" />}>
            Add cash
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {shortfall > 0 && (
          <button
            type="button"
            onClick={() => setAmount(shortfall)}
            className="flex w-full items-center gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-r from-cyan-50 via-indigo-50 to-pink-50 px-3.5 py-3 text-left transition hover:shadow-soft"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-grad text-white">
              <Wand2 className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-ink">Top up to imprest</span>
              <span className="block text-[12px] text-ink-soft">
                {inr(imprest)} − {inr(balance)} in hand = <b className="num text-ink">{inr(shortfall)}</b>
              </span>
            </span>
          </button>
        )}
        <div className="grid grid-cols-1 gap-4 xs:grid-cols-2">
          <Field label="Date" required error={show('date')}>
            <Input type="date" value={t.date} max={todayISO()} onChange={(e) => setT((p) => ({ ...p, date: e.target.value }))} onBlur={() => touch('date')} invalid={!!show('date')} />
          </Field>
          <Field label="Amount (₹)" required error={show('amount')}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              leading={<IndianRupee className="h-4 w-4" />}
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value)
                setT((p) => ({ ...p, amount: e.target.value === '' ? null : Number(e.target.value) }))
              }}
              onBlur={() => touch('amount')}
              placeholder="0"
              invalid={!!show('amount')}
            />
          </Field>
        </div>
        <Field label="Source / mode" required error={show('description')}>
          <Input value={t.description} maxLength={200} list="petty-topup-presets" onChange={(e) => setT((p) => ({ ...p, description: e.target.value }))} onBlur={() => touch('description')} invalid={!!show('description')} />
          <datalist id="petty-topup-presets">
            {PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <div className="rounded-2xl bg-slate-50 px-3.5 py-2">
          <KV k="Cash in hand now" v={inr(balance)} />
          <KV k="After this top-up" v={inr(balance + (t.amount && t.amount > 0 ? t.amount : 0))} strong />
          {t.amount != null && t.amount > 0 && !errors.amount && <p className="pb-1 text-[11.5px] text-ink-faint">{amountInWords(t.amount)}</p>}
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
