import { Loader2, RefreshCw } from 'lucide-react'
import { LogoMark } from '@/components/brand'
import { Button } from '@/components/ui'

/** Loading state: full screen while the session boots, inline while a lazy page loads. */
export function BootScreen({ label, inline }: { label?: string; inline?: boolean }) {
  if (inline)
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-faint" aria-label="Loading" />
      </div>
    )
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={44} />
        <p className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {label ?? 'Melstar ERP'}
        </p>
      </div>
    </div>
  )
}

export function BootError({ message }: { message: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-md p-8 text-center">
        <LogoMark size={40} className="mx-auto" />
        <p className="mt-4 text-[16px] font-semibold">Could not start Melstar ERP</p>
        <p className="mt-1 break-words text-sm text-ink-soft">{message}</p>
        <Button className="mt-5" icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  )
}
