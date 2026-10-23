import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { Avatar, toast } from '@/components/ui'
import { useStoredUrl } from '@/hooks/useStoredUrl'
import { cn } from '@/lib/misc'

export { useStoredUrl }

/** Avatar that also understands Supabase Storage paths. */
export function StoredAvatar({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const url = useStoredUrl(src)
  return <Avatar name={name} src={url} size={size} className={className} />
}

/** Large avatar with a camera button to upload / replace the photo. */
export function PhotoUpload({
  name, src, size = 96, canEdit, onUpload, onRemove, className,
}: {
  name: string
  src?: string | null
  size?: number
  canEdit: boolean
  onUpload: (file: File) => Promise<void>
  onRemove?: () => Promise<void>
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Choose an image', 'JPG, PNG or WebP photos only.')
    if (file.size > 10 * 1024 * 1024) return toast.error('Photo is too large', 'Use an image under 10 MB.')
    setBusy(true)
    try {
      await onUpload(file)
      toast.success('Photo updated')
    } catch (e) {
      toast.error('Could not upload the photo', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    if (!onRemove) return
    setBusy(true)
    try {
      await onRemove()
      toast.success('Photo removed')
    } catch (e) {
      toast.error('Could not remove the photo', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('group relative shrink-0', className)} style={{ width: size, height: size }}>
      <StoredAvatar name={name} src={src} size={size} className="relative" />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-[#172033]/45 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </span>
        )}
      {canEdit && (
        <>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Upload photo" />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-white text-ink-soft shadow-soft ring-1 ring-line transition-colors hover:text-ink disabled:opacity-60"
            title={src ? 'Change photo' : 'Upload photo'}
            aria-label={src ? 'Change photo' : 'Upload photo'}
          >
            <Camera className="h-4 w-4" />
          </button>
          {src && onRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="absolute -left-0.5 -top-0.5 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-white text-rose-500 opacity-0 shadow-soft transition hover:bg-rose-50 focus:opacity-100 group-hover:opacity-100"
              title="Remove photo"
              aria-label="Remove photo"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  )
}
