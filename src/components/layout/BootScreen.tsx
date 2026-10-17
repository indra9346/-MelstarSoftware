import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { LogoMark } from '@/components/brand'
import { Button } from '@/components/ui'

/** Branded loader: the Melstar hexagon filling with the brand gradient. */
export function BootScreen({ label, inline }: { label?: string; inline?: boolean }) {
  return (
    <div className={inline ? 'grid min-h-[50vh] place-items-center' : 'grid min-h-dvh place-items-center'}>
      <div className="flex flex-col items-center gap-4">
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} className="relative">
          <LogoMark size={inline ? 40 : 56} />
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: '0 0 0 0 rgba(99,102,241,.35)' }}
            animate={{ boxShadow: ['0 0 0 0 rgba(99,102,241,.35)', '0 0 0 18px rgba(99,102,241,0)'] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        </motion.div>
        {!inline && <p className="text-[12px] font-semibold uppercase tracking-[.3em] text-ink-soft">{label ?? 'Melstar ERP'}</p>}
      </div>
    </div>
  )
}

export function BootError({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-md p-8 text-center">
        <LogoMark size={44} className="mx-auto" />
        <p className="mt-4 font-display text-lg font-semibold">Could not start Melstar ERP</p>
        <p className="mt-1 break-words text-sm text-ink-soft">{message}</p>
        <Button className="mt-5" icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  )
}
