import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { db } from '@/data/store'

type Kind = 'success' | 'error' | 'info' | 'warning'
interface ToastItem {
  id: number
  kind: Kind
  title: string
  body?: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function push(kind: Kind, title: string, body?: string, ms = 3800) {
  const id = nextId++
  items = [...items.slice(-3), { id, kind, title, body }]
  emit()
  setTimeout(() => dismiss(id), kind === 'error' ? ms + 2500 : ms)
}
function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

/** toast.success('Leave approved') · toast.error('Could not save', 'details') */
export const toast = {
  success: (t: string, b?: string) => push('success', t, b),
  error: (t: string, b?: string) => push('error', t, b),
  info: (t: string, b?: string) => push('info', t, b),
  warning: (t: string, b?: string) => push('warning', t, b),
}

/** Run an action and toast its error, e.g. `await guard(() => service.approve(id))`. Returns false on failure. */
export async function guard(fn: () => unknown | Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn()
    if (success) toast.success(success)
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
    return false
  }
}

const icons = {
  success: <CheckCircle2 className="h-[18px] w-[18px] text-emerald-600" />,
  error: <XCircle className="h-[18px] w-[18px] text-red-600" />,
  info: <Info className="h-[18px] w-[18px] text-brand-600" />,
  warning: <AlertTriangle className="h-[18px] w-[18px] text-amber-600" />,
}

export function Toaster() {
  const [, setV] = useState(0)
  useEffect(() => {
    const l = () => setV((v) => v + 1)
    listeners.add(l)
    const off = db.onError((m) => toast.error(m))
    return () => {
      listeners.delete(l)
      off()
    }
  }, [])
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex flex-col items-center gap-2 px-3 sm:bottom-5 sm:left-auto sm:right-5 sm:top-auto sm:items-end">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-line bg-white p-3 pr-2 shadow-lift"
            role="status"
          >
            <span className="mt-px shrink-0">{icons[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[13px] text-ink-soft">{t.body}</p>}
            </div>
            <button className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-faint hover:bg-slate-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
