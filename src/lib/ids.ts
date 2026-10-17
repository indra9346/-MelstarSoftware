import { fyLabel, fyOf, todayISO } from './dates'

/** RFC 4122 v4 uuid (Postgres uuid compatible). Falls back when crypto.randomUUID is unavailable (plain-http LAN). */
export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * Next running number for a document series.
 *   nextNumber('T-', codes, 4)                → 'T-0042'
 *   nextFyNumber('PCV', codes)                → 'PCV/2026-27/0013'  (resets every financial year)
 */
export function nextNumber(prefix: string, existing: string[], width = 4): string {
  let max = 0
  for (const code of existing) {
    if (!code.startsWith(prefix)) continue
    const n = parseInt(code.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return prefix + String(max + 1).padStart(width, '0')
}

export function nextFyNumber(series: string, existing: string[], date = todayISO(), width = 4): string {
  return nextNumber(`${series}/${fyLabel(fyOf(date))}/`, existing, width)
}

/** Deterministic PRNG for the demo seed (mulberry32). */
export function seededRandom(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
  }
}

/** Stable small hash of a string (for per-employee/per-day deterministic randomness). */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
