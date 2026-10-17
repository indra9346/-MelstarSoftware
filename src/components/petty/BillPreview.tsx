import { useEffect, useState } from 'react'
import { ExternalLink, FileText, ImageOff } from 'lucide-react'
import { Button, Skeleton, toast } from '@/components/ui'
import { fileUrl, isImage, openFile } from '@/services/files'

/** Bill attachment: inline image preview (data URL or signed URL) or an "Open bill" button for PDFs. */
export function BillPreview({ stored, className }: { stored: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const image = isImage(stored)

  useEffect(() => {
    let live = true
    setUrl(null)
    if (!stored || !image) return
    setState('loading')
    fileUrl(stored)
      .then((u) => {
        if (!live) return
        setUrl(u)
        setState('idle')
      })
      .catch(() => {
        if (live) setState('error')
      })
    return () => {
      live = false
    }
  }, [stored, image])

  const open = () => openFile(stored).catch((e: unknown) => toast.error('Could not open the bill', e instanceof Error ? e.message : String(e)))

  if (!stored)
    return (
      <div className={className}>
        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-ink-soft">
          <ImageOff className="h-4 w-4 text-ink-faint" /> No bill attached
        </p>
      </div>
    )
  if (!image)
    return (
      <div className={className}>
        <Button variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => void open()}>
          Open bill (PDF)
        </Button>
      </div>
    )
  return (
    <div className={className}>
      {state === 'loading' && <Skeleton className="h-44 w-full rounded-2xl" />}
      {state === 'error' && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">Could not load the bill preview.</p>}
      {url && (
        <button type="button" onClick={() => void open()} className="group relative block w-full overflow-hidden rounded-2xl ring-1 ring-indigo-100" title="Open full size">
          <img src={url} alt="Bill" className="max-h-72 w-full bg-slate-50 object-contain transition-transform duration-500 group-hover:scale-[1.02]" />
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-[11.5px] font-semibold text-ink shadow-sm">
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </span>
        </button>
      )}
    </div>
  )
}
