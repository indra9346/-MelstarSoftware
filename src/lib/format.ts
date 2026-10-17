/** Number / currency / name formatting (Indian numbering: 1,23,45,678). */

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inrFmt2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** ₹1,23,456 */
export function inr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return inrFmt.format(Math.round(n))
}

/** ₹1,23,456.50 */
export function inr2(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return inrFmt2.format(n)
}

/** Compact: ₹4.2L, ₹1.1Cr, ₹38.5K */
export function inrCompact(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`
  return `${sign}₹${Math.round(a)}`
}
const trim = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '')

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return digits === 2 ? numFmt.format(n) : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n)
}

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

/** Round to paise. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function fullName(e: { first_name: string; last_name: string } | null | undefined): string {
  if (!e) return '—'
  return `${e.first_name} ${e.last_name}`.trim()
}

export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${num(n)} ${n === 1 ? word : pluralWord}`
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Mask all but the last 4 characters: XXXXXX1234 */
export function maskTail(s: string, keep = 4): string {
  if (!s) return '—'
  return s.length <= keep ? s : 'X'.repeat(Math.min(8, s.length - keep)) + s.slice(-keep)
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* ── Amount in words (Indian system) for payslips and vouchers ─────────────── */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!
  return TENS[Math.floor(n / 10)]! + (n % 10 ? ' ' + ONES[n % 10] : '')
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? ONES[h] + ' Hundred' : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ')
}

export function amountInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - n) * 100)
  if (n === 0 && !paise) return 'Rupees Zero Only'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7)
  n %= 1e7
  const lakh = Math.floor(n / 1e5)
  n %= 1e5
  const thousand = Math.floor(n / 1e3)
  n %= 1e3
  if (crore) parts.push(threeDigits(crore) + ' Crore')
  if (lakh) parts.push(twoDigits(lakh) + ' Lakh')
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand')
  if (n) parts.push(threeDigits(n))
  let s = 'Rupees ' + (parts.join(' ') || 'Zero')
  if (paise) s += ' and ' + twoDigits(paise) + ' Paise'
  return s + ' Only'
}
