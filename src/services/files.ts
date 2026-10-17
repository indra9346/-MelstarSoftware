/**
 * File attachments (employee documents, bills, leave certificates, photos).
 *  - Static mode: stored inline as data URLs (images downscaled).
 *  - Supabase mode: uploaded to the private "erp-files" bucket under <employee_id>/<area>/…;
 *    the row keeps "storage:<path>" and the UI asks for a short-lived signed URL to open it.
 */
import { getSupabase } from '@/data/boot'
import { db } from '@/data/store'
import { readFileAsDataUrl } from '@/lib/misc'
import { uuid } from '@/lib/ids'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
const PREFIX = 'storage:'

export async function storeFile(file: File, employeeId: string, area: string): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 10 MB.')
  if (db.backend?.kind !== 'supabase') return readFileAsDataUrl(file)
  const sb = await getSupabase()
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80)
  const path = `${employeeId}/${area}/${uuid()}-${safe}`
  const { error } = await sb.storage.from('erp-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error(error.message)
  return PREFIX + path
}

/** A URL the browser can open (data URL as-is, or a 10-minute signed URL). */
export async function fileUrl(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null
  if (!stored.startsWith(PREFIX)) return stored
  const sb = await getSupabase()
  const { data, error } = await sb.storage.from('erp-files').createSignedUrl(stored.slice(PREFIX.length), 600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

/** Open in a new tab. Data URLs go through a blob URL (browsers block top-level data: navigation). */
export async function openFile(stored: string | null | undefined) {
  if (!stored) return
  if (stored.startsWith('data:')) {
    const blob = await (await fetch(stored)).blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  const url = await fileUrl(stored)
  if (url) window.open(url, '_blank', 'noopener')
}

export function isImage(stored: string | null | undefined) {
  return !!stored && (/^data:image\//.test(stored) || /\.(png|jpe?g|webp|gif)$/i.test(stored))
}
