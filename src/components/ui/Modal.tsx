import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/misc'
import { useMediaQuery } from '@/hooks/useMediaQuery'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Slide-in panel from the right on desktop (detail views). */
  side?: boolean
  /** Focus the first field when opened (default true). */
  initialFocus?: boolean
}

const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }

/**
 * Dialog. Desktop: centred card (or right-side drawer with `side`). Phones: bottom sheet that
 * can be swiped down. Esc / backdrop click closes. Body scroll is locked while open.
 */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', side, initialFocus = true }: ModalProps) {
  const mobile = useMediaQuery('(max-width: 639px)')
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useDragControls()
  // keep the latest onClose without re-running the open effect (which would steal focus)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // no auto-focus on phones: it would pop the keyboard over the sheet
    const t = initialFocus && !mobile ? setTimeout(() => panelRef.current?.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea')?.focus({ preventScroll: true }), 220) : undefined
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      if (t) clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const asSheet = mobile
  const asDrawer = side && !mobile

  return createPortal(
    <AnimatePresence>
      {open && (
        <div key="modal" className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 bg-[#1e2b5c]/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-white bg-white shadow-lift',
              asSheet && 'rounded-t-[26px]',
              !asSheet && !asDrawer && cn('rounded-[24px]', widths[size]),
              asDrawer && cn('ml-auto h-[calc(100dvh-2rem)] max-h-none rounded-[24px]', widths[size === 'sm' ? 'md' : size]),
            )}
            initial={asSheet ? { y: '100%' } : asDrawer ? { x: 60, opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
            animate={asSheet ? { y: 0 } : asDrawer ? { x: 0, opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={asSheet ? { y: '100%' } : asDrawer ? { x: 60, opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
            drag={asSheet ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragListener={false}
            dragControls={drag}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose()
            }}
          >
            {asSheet && (
              <div className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 active:cursor-grabbing" onPointerDown={(e) => drag.start(e)}>
                <span className="h-1.5 w-11 rounded-full bg-slate-300" />
              </div>
            )}
            {(title || subtitle) && (
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-indigo-50 px-5 pb-3.5 pt-3 sm:pt-5">
                <div className="min-w-0">
                  {title && <h2 className="text-lg font-semibold leading-snug text-ink">{title}</h2>}
                  {subtitle && <p className="mt-0.5 text-[13px] text-ink-soft">{subtitle}</p>}
                </div>
                <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-soft transition hover:bg-indigo-50 hover:text-ink" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 scroll-thin">{children}</div>
            {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-indigo-50 bg-slate-50/60 px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
