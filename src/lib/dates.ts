/**
 * Date helpers. Dates are 'YYYY-MM-DD' strings in the plant's local time (IST for users in India);
 * timestamps are ISO strings. Plain functions, no library, so they work the same in the seed,
 * services and UI.
 */
import type { HHMM, ISODate, YearMonth } from '@/data/types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

/** Local midnight for a 'YYYY-MM-DD' string. */
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y!, m! - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** Whole days from a to b (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000)
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export function monthOf(s: ISODate): YearMonth {
  return s.slice(0, 7)
}

export function currentMonth(): YearMonth {
  return monthOf(todayISO())
}

export function daysInMonth(ym: YearMonth): number {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y!, m!, 0).getDate()
}

export function monthStart(ym: YearMonth): ISODate {
  return `${ym}-01`
}

export function monthEnd(ym: YearMonth): ISODate {
  return `${ym}-${pad(daysInMonth(ym))}`
}

export function monthDates(ym: YearMonth): ISODate[] {
  return eachDay(monthStart(ym), monthEnd(ym))
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(s: ISODate): number {
  return parseISODate(s).getDay()
}

/** Financial year (April–March) start year for a date. FY 2026-27 → 2026. */
export function fyOf(s: ISODate, startMonth = 4): number {
  const [y, m] = s.split('-').map(Number)
  return m! >= startMonth ? y! : y! - 1
}

export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function fyRange(startYear: number, startMonth = 4): { from: ISODate; to: ISODate } {
  const from = `${startYear}-${pad(startMonth)}-01`
  const end = new Date(startYear + 1, startMonth - 1, 0)
  return { from, to: toISODate(end) }
}

/** Months of a financial year, in order. */
export function fyMonths(startYear: number, startMonth = 4): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => addMonths(`${startYear}-${pad(startMonth)}`, i))
}

export function hhmmToMinutes(t: HHMM): number {
  const [h, m] = t.split(':').map(Number)
  return h! * 60 + (m ?? 0)
}

export function minutesToHHMM(min: number): HHMM {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** A local Date for a date + 'HH:MM'. */
export function combine(date: ISODate, time: HHMM): Date {
  const d = parseISODate(date)
  const [h, m] = time.split(':').map(Number)
  d.setHours(h!, m ?? 0, 0, 0)
  return d
}

/** Minutes since local midnight for an ISO timestamp. */
export function minuteOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export function minutesBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)
}

/* ── display ─────────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** '16 Oct 2026' */
export function fmtDate(s: ISODate | null | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return `${pad(d!)} ${MONTHS[m! - 1]} ${y}`
}

/** '16 Oct' */
export function fmtDateShort(s: ISODate | null | undefined): string {
  if (!s) return '—'
  const [, m, d] = s.slice(0, 10).split('-').map(Number)
  return `${pad(d!)} ${MONTHS[m! - 1]}`
}

/** 'Fri, 16 Oct' */
export function fmtDay(s: ISODate): string {
  return `${WEEKDAYS[dayOfWeek(s)]}, ${fmtDateShort(s)}`
}

/** 'October 2026' (or 'Oct 2026' when short) */
export function fmtMonth(ym: YearMonth, short = false): string {
  const [y, m] = ym.split('-').map(Number)
  return `${(short ? MONTHS : MONTHS_LONG)[m! - 1]} ${y}`
}

/** '09:02 AM' */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  let h = d.getHours()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${pad(h)}:${pad(d.getMinutes())} ${ap}`
}

/** '09:30' → '09:30 AM' */
export function fmtHHMM(t: HHMM | null | undefined): string {
  if (!t) return '—'
  const [hh, mm] = t.split(':').map(Number)
  const ap = hh! >= 12 ? 'PM' : 'AM'
  return `${pad(hh! % 12 || 12)}:${pad(mm ?? 0)} ${ap}`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${fmtDate(toISODate(new Date(iso)))}, ${fmtTime(iso)}`
}

/** 7h 45m */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (!h) return `${r}m`
  return r ? `${h}h ${r}m` : `${h}h`
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`
  return fmtDate(toISODate(new Date(iso)))
}

export function ageInYears(dob: ISODate, on: ISODate = todayISO()): number {
  const [y1, m1, d1] = dob.split('-').map(Number)
  const [y2, m2, d2] = on.split('-').map(Number)
  let age = y2! - y1!
  if (m2! < m1! || (m2 === m1 && d2! < d1!)) age--
  return age
}

/** Years + months of service, e.g. '4 yrs 3 mos'. */
export function tenure(from: ISODate, to: ISODate = todayISO()): string {
  const [y1, m1] = from.split('-').map(Number)
  const [y2, m2] = to.split('-').map(Number)
  let months = (y2! - y1!) * 12 + (m2! - m1!)
  if (months < 0) months = 0
  const y = Math.floor(months / 12)
  const m = months % 12
  if (!y) return `${m} mo${m === 1 ? '' : 's'}`
  return m ? `${y} yr${y === 1 ? '' : 's'} ${m} mo${m === 1 ? '' : 's'}` : `${y} yr${y === 1 ? '' : 's'}`
}

/** Plant open/closed for a moment, given open/close times and working weekdays. */
export function plantStatus(now: Date, open: HHMM, close: HHMM, workingDays: number[], isHoliday: boolean) {
  const mins = now.getHours() * 60 + now.getMinutes()
  const working = workingDays.includes(now.getDay()) && !isHoliday
  const o = hhmmToMinutes(open)
  const c = hhmmToMinutes(close)
  const isOpen = working && mins >= o && mins < c
  return { isOpen, working, minutesToClose: isOpen ? c - mins : 0, minutesToOpen: working && mins < o ? o - mins : 0 }
}
