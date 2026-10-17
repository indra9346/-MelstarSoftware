export { clsx as cn } from 'clsx'

/** Great-circle distance in metres (check-in geofence). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

/** SHA-256 hex (static-mode password hashes). */
export async function sha256(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Plain-http fallback (no SubtleCrypto): FNV-based digest — demo only.
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619)
    h2 = Math.imul(h2 + text.charCodeAt(i), 2246822507)
  }
  return 'fnv' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)
}

/** Read a File as a data URL; images are downscaled so IndexedDB stays small. */
export function readFileAsDataUrl(file: File, maxImageSide = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const url = String(reader.result)
      if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return resolve(url)
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxImageSide / Math.max(img.width, img.height))
        if (scale === 1 && file.size < 400_000) return resolve(url)
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => resolve(url)
      img.src = url
    }
    reader.readAsDataURL(file)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 500)
}

export function sum<T>(rows: readonly T[], f: (r: T) => number): number {
  let s = 0
  for (const r of rows) s += f(r) || 0
  return s
}

export function groupBy<T, K extends string | number>(rows: readonly T[], key: (r: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const r of rows) (out[key(r)] ||= []).push(r)
  return out
}

export function sortBy<T>(rows: readonly T[], key: (r: T) => string | number | null | undefined, dir: 'asc' | 'desc' = 'asc'): T[] {
  const m = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return x < y ? -m : x > y ? m : 0
  })
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}
