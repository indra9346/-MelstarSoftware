import { useRef } from 'react'
import { db } from '@/data/store'
import type { YearMonth } from '@/data/types'
import { toast } from '@/components/ui'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'
import { addMonths, fmtMonth, fyLabel, fyOf } from '@/lib/dates'
import { SaveFailed } from '@/services/payroll'
import { audit } from '@/services/audit'

/**
 * Run a payroll action, wait until every write reached the backend, then toast success.
 * Validation errors are toasted here; failed writes were already rolled back and toasted by the store.
 */
export async function commit<T>(fn: () => T | Promise<T>, success?: string | ((r: T) => string), body?: string | ((r: T) => string | undefined)): Promise<{ ok: true; value: T } | { ok: false }> {
  let value: T
  try {
    value = await fn()
  } catch (e) {
    if (!(e instanceof SaveFailed)) toast.error(e instanceof Error ? e.message : String(e))
    return { ok: false }
  }
  try {
    await db.flushed()
  } catch {
    return { ok: false }
  }
  if (success) toast.success(typeof success === 'function' ? success(value) : success, typeof body === 'function' ? body(value) : body)
  return { ok: true, value }
}

/** 12,345 — plain Indian grouping for PDFs (standard PDF fonts have no ₹ glyph). */
const grp = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
export const plain = (n: number) => grp.format(n)

/** Parse a form number; '' → NaN so required checks fail. */
export const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s))

export function fyOfMonth(month: YearMonth, startMonth = 4) {
  return fyOf(`${month}-01`, startMonth)
}

export function fyOptions(years: number[]) {
  return [...new Set(years)].sort((a, b) => b - a).map((y) => ({ value: String(y), label: `FY ${fyLabel(y)}` }))
}

/** Months from `from` for `count` months (ascending). */
export function monthRange(from: YearMonth, count: number): YearMonth[] {
  return Array.from({ length: count }, (_, i) => addMonths(from, i))
}

export const monthOption = (m: YearMonth) => ({ value: m, label: fmtMonth(m) })

/** Export column; `money` columns are grouped (12,345) in the PDF and raw numbers in CSV. */
export type XCol<T> = ExportColumn<T> & { money?: boolean }

/** CSV (with a totals row) + audit. */
export function exportTableCsv<T>(file: string, rows: T[], cols: XCol<T>[], totals?: T, entity = 'payroll') {
  exportCsv(file, totals ? [...rows, totals] : rows, cols)
  audit('export', entity, null, `Exported ${file.replace(/[-_]/g, ' ')} (CSV, ${rows.length} rows)`)
}

/** Branded PDF table (money grouped) + audit. */
export async function exportTablePdf<T>(opts: { file: string; title: string; subtitle?: string; rows: T[]; cols: XCol<T>[]; totals?: T; summary?: [string, string][]; landscape?: boolean; entity?: string }) {
  const columns: ExportColumn<T>[] = opts.cols.map((c) =>
    c.money
      ? {
          ...c,
          value: (r: T) => {
            const v = c.value(r)
            return typeof v === 'number' ? plain(v) : v
          },
        }
      : c,
  )
  await exportPdf({
    filename: opts.file,
    title: opts.title,
    subtitle: opts.subtitle,
    rows: opts.totals ? [...opts.rows, opts.totals] : opts.rows,
    columns,
    landscape: opts.landscape ?? columns.length > 7,
    summary: opts.summary,
  })
  audit('export', opts.entity ?? 'payroll', null, `Exported ${opts.title} (PDF, ${opts.rows.length} rows)`)
}

/** Summary pairs for PDFs: amounts as "Rs. 12,345". */
export const rs = (n: number) => `Rs. ${plain(n)}`

/** Remembers the last non-null value, so a dialog keeps its content while it animates closed. */
export function useSticky<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null)
  if (value != null) ref.current = value
  return ref.current
}
