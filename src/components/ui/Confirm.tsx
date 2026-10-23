import { useEffect, useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Field, Textarea } from './Field'

interface Req {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  /** Ask for a note/reason (e.g. rejection reason). `required` forces a value. */
  input?: { label: string; placeholder?: string; required?: boolean }
  resolve: (v: { ok: boolean; note: string }) => void
}

let setReq: ((r: Req | null) => void) | null = null

/**
 * Promise-based confirmation.
 *   if (await confirm({ title: 'Delete voucher?', danger: true })) …
 *   const r = await confirmWithNote({ title: 'Reject leave', input: { label: 'Reason', required: true } })
 *   if (r.ok) reject(r.note)
 */
export function confirmWithNote(opts: Omit<Req, 'resolve'>): Promise<{ ok: boolean; note: string }> {
  return new Promise((resolve) => setReq?.({ ...opts, resolve }))
}
export async function confirm(opts: Omit<Req, 'resolve' | 'input'>): Promise<boolean> {
  return (await confirmWithNote(opts)).ok
}

export function ConfirmHost() {
  const [req, set] = useState<Req | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    setReq = (r) => {
      setNote('')
      set(r)
    }
    return () => {
      setReq = null
    }
  }, [])
  const close = (ok: boolean) => {
    req?.resolve({ ok, note: note.trim() })
    set(null)
  }
  const invalid = !!req?.input?.required && !note.trim()
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      size="sm"
      title={
        <span className="flex items-center gap-2.5">
          {req?.danger ? <AlertTriangle className="h-5 w-5 text-rose-500" /> : <HelpCircle className="h-5 w-5 text-brand-600" />}
          {req?.title}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} disabled={invalid} onClick={() => close(true)}>
            {req?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {req?.message && <p className="text-sm leading-relaxed text-ink-soft">{req.message}</p>}
      {req?.input && (
        <Field label={req.input.label} required={req.input.required} className={req.message ? 'mt-4' : ''}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={req.input.placeholder} rows={3} />
        </Field>
      )}
    </Modal>
  )
}
