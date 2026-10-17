import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import type { AdvanceType } from '@/data/types'
import { Button, Field, Input, Modal, Segmented, Select, Textarea } from '@/components/ui'
import { addMonths, currentMonth, fmtMonth } from '@/lib/dates'
import { inr } from '@/lib/format'
import { advanceRequestErrors, emiFor, requestAdvance } from '@/services/payroll'
import { commit, monthOption, monthRange, toNum } from './utils'

/** Employee self-service: ask HR for a salary advance or a loan. */
export function RequestAdvanceModal({ open, onClose, monthlyGross }: { open: boolean; onClose: () => void; monthlyGross: number | null }) {
  const minStart = addMonths(currentMonth(), 1)
  const [type, setType] = useState<AdvanceType>('salary_advance')
  const [amount, setAmount] = useState('')
  const [n, setN] = useState('3')
  const [start, setStart] = useState(minStart)
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setType('salary_advance')
    setAmount('')
    setN('3')
    setStart(addMonths(currentMonth(), 1))
    setReason('')
    setTried(false)
  }, [open])

  const input = { type, amount: toNum(amount), installments: toNum(n), start_month: start, reason }
  const errs = advanceRequestErrors(input, { monthlyGross, minStart, maxInstallments: 24 })
  const valid = !Object.keys(errs).length
  const emi = input.amount > 0 && !errs.installments ? emiFor(input.amount, input.installments) : 0
  const max = monthlyGross != null ? monthlyGross * 3 : null
  // amount errors show as soon as a value is typed; the rest after the first submit
  const show = (k: keyof typeof errs) => (tried || (k === 'amount' && amount.trim() !== '') ? errs[k] : null)

  const submit = async () => {
    setTried(true)
    if (!valid) return
    setBusy(true)
    const res = await commit(() => requestAdvance(input), 'Request sent to HR', 'You will be notified once it is reviewed.')
    setBusy(false)
    if (res.ok) onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request an advance"
      subtitle="Interest-free · recovered from your salary in monthly EMIs"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={tried && !valid} icon={<Send className="h-4 w-4" />}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Type">
          <Segmented value={type} onChange={setType} options={[{ value: 'salary_advance', label: 'Salary advance' }, { value: 'loan', label: 'Loan' }]} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount (₹)" required error={show('amount')} hint={type === 'salary_advance' && max != null ? `Up to ${inr(max)} (3 months’ gross)` : 'HR decides loan amounts case by case'}>
            <Input type="number" inputMode="decimal" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 10000" invalid={!!show('amount')} />
          </Field>
          <Field label="Installments" required error={show('installments')} hint="1 to 24 months">
            <Input type="number" inputMode="numeric" min={1} max={24} step={1} value={n} onChange={(e) => setN(e.target.value)} invalid={!!show('installments')} />
          </Field>
        </div>
        <Field label="Recovery starts" required error={show('start_month')} hint="Earliest is next month">
          <Select value={start} onChange={(e) => setStart(e.target.value)} options={monthRange(minStart, 6).map(monthOption)} />
        </Field>
        <Field label="Reason" required error={show('reason')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Child’s school fees for the second term" maxLength={300} />
        </Field>
        <div className="rounded-2xl bg-grad p-4 text-white">
          <p className="text-[11.5px] font-semibold uppercase tracking-[.14em] text-white/80">EMI preview</p>
          <p className="num mt-1 font-display text-2xl font-bold">{emi ? `${inr(emi)} × ${input.installments}` : '—'}</p>
          <p className="text-[12.5px] text-white/85">
            {emi ? `${fmtMonth(start)} → ${fmtMonth(addMonths(start, input.installments - 1))} · deducted from your salary` : 'Enter an amount and installments'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
