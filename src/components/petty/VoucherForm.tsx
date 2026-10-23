import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { FileText, ImagePlus, IndianRupee, Paperclip, ShieldAlert, Trash2 } from 'lucide-react'
import { useSettings } from '@/data/store'
import type { PettyCashVoucher } from '@/data/types'
import { Button, Field, Input, Modal, Select, Switch, Textarea, toast } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { MAX_FILE_BYTES, storeFile } from '@/services/files'
import { approvalBlock, createVoucher, voucherErrors, type VoucherInput } from '@/services/pettyCash'
import { addDays, todayISO } from '@/lib/dates'
import { amountInWords, fileSize, inr } from '@/lib/format'
import { cn } from '@/lib/misc'

interface Props {
  open: boolean
  onClose: () => void
  /** claim = employee's own claim (self-service); admin = recorded on behalf of an employee. */
  mode: 'claim' | 'admin'
  employeeId?: string | null
  onSaved?: (v: PettyCashVoucher) => void
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'

function blank(employeeId: string): VoucherInput {
  return { employee_id: employeeId, date: todayISO(), category: '', amount: null, payee: '', bill_no: '', description: '', attachment: null }
}

/** New petty-cash claim / voucher with bill photo or PDF. */
export function VoucherForm({ open, onClose, mode, employeeId, onSaved }: Props) {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const [v, setV] = useState<VoucherInput>(() => blank(employeeId ?? ''))
  const [amountText, setAmountText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [approveNow, setApproveNow] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setV(blank(employeeId ?? ''))
    setAmountText('')
    setFile(null)
    setFileError(null)
    setApproveNow(false)
    setTouched(new Set())
    setSubmitted(false)
  }, [open, employeeId])

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const errors = useMemo(() => voucherErrors(v, mode), [v, mode])
  const show = (k: keyof VoucherInput) => (submitted || touched.has(k) ? errors[k] : undefined)
  const touch = (k: string) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))
  const set = <K extends keyof VoucherInput>(k: K, val: VoucherInput[K]) => setV((p) => ({ ...p, [k]: val }))
  const valid = !Object.keys(errors).length && !fileError

  const limit = settings.petty_cash_approval_limit
  const overLimit = v.amount != null && v.amount > limit
  const draft = { ...v, amount: v.amount ?? 0, id: '', created_at: '', updated_at: '', voucher_no: '', status: 'pending' as const, reviewed_by: null, reviewed_at: null, review_note: '', paid_at: null, ledger_entry_id: null }
  const approveBlocked = mode === 'admin' ? approvalBlock(draft, s) : null

  const pickFile = (f: File | null) => {
    setFileError(null)
    if (!f) return setFile(null)
    if (!/^image\//.test(f.type) && f.type !== 'application/pdf') {
      setFileError('Attach a photo (JPG/PNG/WebP) or a PDF of the bill.')
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`The file is ${fileSize(f.size)} — the limit is ${fileSize(MAX_FILE_BYTES)}.`)
      return
    }
    setFile(f)
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (!valid) return
    setBusy(true)
    try {
      const attachment = file ? await storeFile(file, v.employee_id, 'petty-cash') : null
      const row = createVoucher({ ...v, attachment }, { mode, approve: approveNow && !approveBlocked })
      toast.success(mode === 'claim' ? 'Claim submitted' : 'Voucher recorded', mode === 'claim' ? `${inr(row.amount)} · ${row.category}. You will be notified once it is reviewed.` : `${inr(row.amount)} for ${L.empName(row.employee_id)}${row.status === 'approved' ? ' · approved' : ''}`)
      onSaved?.(row)
      onClose()
    } catch (err) {
      toast.error('Could not save the claim', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const today = todayISO()
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'claim' ? 'New petty-cash claim' : 'New voucher on behalf'}
      subtitle={mode === 'claim' ? 'Claim money you spent for the plant. Attach the bill so Accounts can approve it quickly.' : 'Record an expense paid by an employee from their pocket.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={submitted && !valid}>
            {mode === 'claim' ? 'Submit claim' : approveNow && !approveBlocked ? 'Save & approve' : 'Save voucher'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {mode === 'admin' && (
          <Field label="Employee" required error={show('employee_id')} className="sm:col-span-2">
            <Select value={v.employee_id} onChange={(e) => set('employee_id', e.target.value)} onBlur={() => touch('employee_id')} options={L.employeeOptions()} placeholder="Choose employee…" invalid={!!show('employee_id')} />
          </Field>
        )}
        <Field label="Bill date" required error={show('date')} hint={mode === 'claim' ? 'Within the last 30 days' : undefined}>
          <Input type="date" value={v.date} max={today} min={mode === 'claim' ? addDays(today, -30) : undefined} onChange={(e) => set('date', e.target.value)} onBlur={() => touch('date')} invalid={!!show('date')} />
        </Field>
        <Field label="Category" required error={show('category')}>
          <Select value={v.category} onChange={(e) => set('category', e.target.value)} onBlur={() => touch('category')} options={settings.petty_cash_categories.map((c) => ({ value: c, label: c }))} placeholder="Choose…" invalid={!!show('category')} />
        </Field>
        <Field label="Amount (₹)" required error={show('amount')} hint={v.amount && v.amount > 0 && !errors.amount ? amountInWords(v.amount) : undefined}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            leading={<IndianRupee className="h-4 w-4" />}
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value)
              set('amount', e.target.value === '' ? null : Number(e.target.value))
            }}
            onBlur={() => touch('amount')}
            placeholder="0"
            invalid={!!show('amount')}
          />
        </Field>
        <Field label="Paid to" required error={show('payee')} hint="Shop, vendor or person">
          <Input value={v.payee} maxLength={120} onChange={(e) => set('payee', e.target.value)} onBlur={() => touch('payee')} placeholder="e.g. Vinayaka Hardware" invalid={!!show('payee')} />
        </Field>
        <Field label="Bill / receipt no." error={show('bill_no')} hint="Leave blank if there is no bill (bus/auto fare)">
          <Input value={v.bill_no} maxLength={40} onChange={(e) => set('bill_no', e.target.value)} onBlur={() => touch('bill_no')} placeholder="e.g. 4521" />
        </Field>
        <div className="hidden sm:block" />
        <Field label="What was it for?" required error={show('description')} className="sm:col-span-2" hint={`${v.description.trim().length}/300`}>
          <Textarea value={v.description} maxLength={300} rows={2} onChange={(e) => set('description', e.target.value)} onBlur={() => touch('description')} placeholder="e.g. Emery sheets and cotton waste for CNC cell" invalid={!!show('description')} />
        </Field>

        <div className="sm:col-span-2">
          <p className="label">Bill photo / PDF</p>
          <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            {file ? (
              <div key="file" className="flex items-center gap-3 rounded-lg border border-line bg-white p-2.5">
                {preview ? (
                  <img src={preview} alt="Bill preview" className="h-20 w-20 shrink-0 rounded-md object-cover ring-1 ring-line" />
                ) : (
                  <span className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-rose-50 text-rose-500">
                    <FileText className="h-8 w-8" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{file.name}</p>
                  <p className="text-[12px] text-ink-soft">{fileSize(file.size)} · {file.type === 'application/pdf' ? 'PDF' : 'Image'}</p>
                  <button type="button" onClick={() => fileRef.current?.click()} className="mt-1 text-[13px] font-medium text-brand-600 hover:underline">
                    Replace
                  </button>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove attachment"
                  onClick={() => {
                    setFile(null)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <button
                key="pick"
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn('flex w-full items-center gap-3 rounded-md border border-dashed px-4 py-3.5 text-left transition-colors hover:border-brand-500 hover:bg-slate-50', fileError ? 'border-red-400' : 'border-line-strong')}
              >
                <ImagePlus className="h-5 w-5 shrink-0 text-ink-faint" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">Take a photo or attach the bill</span>
                  <span className="block text-[12px] text-ink-soft">JPG, PNG or PDF · up to {fileSize(MAX_FILE_BYTES)}</span>
                </span>
                <Paperclip className="ml-auto h-4 w-4 shrink-0 text-ink-faint" />
              </button>
            )}
          {fileError && <p className="mt-1 text-[12.5px] font-medium text-rose-600">{fileError}</p>}
        </div>

        {overLimit && (
          <div className="flex items-start gap-2.5 rounded-md bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800 sm:col-span-2">
            <ShieldAlert className="mt-px h-4 w-4 shrink-0" />
            <span>Above the {inr(limit)} petty-cash limit — this claim needs Super Admin approval and may take longer.</span>
          </div>
        )}
        {mode === 'admin' && (
          <div className="rounded-lg border border-line bg-slate-50 p-3.5 sm:col-span-2">
            <Switch
              checked={approveNow && !approveBlocked}
              disabled={!!approveBlocked && !!v.amount}
              onChange={setApproveNow}
              label="Approve now"
              description={approveBlocked && v.amount ? approveBlocked : 'Skip the pending step — you can pay it from the voucher list.'}
            />
          </div>
        )}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
