import { useEffect, useState } from 'react'
import { fileUrl } from '@/services/files'

/* Signed Storage URLs live 10 minutes; cache them for 8 so lists don't re-sign every render. */
const cache = new Map<string, { url: string; at: number }>()
const TTL = 8 * 60_000

/** Browser-usable URL for a stored file (data/http URL as-is, or a signed Supabase Storage URL). */
export function useStoredUrl(stored: string | null | undefined): string | null {
  const isStorage = !!stored && stored.startsWith('storage:')
  const [resolved, setResolved] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!stored || !isStorage) return
    const hit = cache.get(stored)
    if (hit && Date.now() - hit.at < TTL) {
      setResolved({ key: stored, url: hit.url })
      return
    }
    let alive = true
    fileUrl(stored)
      .then((url) => {
        if (url) cache.set(stored, { url, at: Date.now() })
        if (alive) setResolved({ key: stored, url })
      })
      .catch(() => {
        if (alive) setResolved({ key: stored, url: null })
      })
    return () => {
      alive = false
    }
  }, [stored, isStorage])

  if (!stored) return null
  if (!isStorage) return stored
  if (resolved?.key === stored) return resolved.url
  return cache.get(stored)?.url ?? null
}
