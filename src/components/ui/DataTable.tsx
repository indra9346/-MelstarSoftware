import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, FileText, Search } from 'lucide-react'
import { cn } from '@/lib/misc'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { EmptyState } from './EmptyState'
import { Button } from './Button'
import { audit } from '@/services/audit'

export interface Column<T> {
  key: string
  header: string
  /** Cell content. Defaults to the export/sort value. */
  cell?: (row: T) => ReactNode
  /** Value used for sorting (and for export when exportValue is absent). */
  value?: (row: T) => string | number | null | undefined
  /** Plain value for CSV/PDF. Set `export: false` to leave a column out. */
  exportValue?: (row: T) => string | number | null | undefined
  export?: boolean
  align?: 'left' | 'right' | 'center'
  className?: string
  /** Hide on the phone card layout. */
  hideOnMobile?: boolean
  sortable?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** Text the search box matches against. Omit to hide search. */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  /** Filters / buttons shown next to search. */
  toolbar?: ReactNode
  onRowClick?: (row: T) => void
  /** Enables CSV + PDF export buttons; used as file name and PDF title. */
  exportName?: string
  exportSubtitle?: string
  pageSize?: number
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: ReactNode
  /** Phone layout for one row; default stacks the columns as label/value. */
  mobileCard?: (row: T) => ReactNode
  className?: string
  dense?: boolean
  footer?: ReactNode
}

export function DataTable<T>({
  rows, columns, rowKey, searchText, searchPlaceholder = 'Search…', toolbar, onRowClick, exportName, exportSubtitle, pageSize = 25,
  initialSort, empty, mobileCard, className, dense, footer,
}: DataTableProps<T>) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const mobile = useIsMobile()

  const filtered = useMemo(() => {
    let out = rows
    const needle = q.trim().toLowerCase()
    if (needle && searchText) out = out.filter((r) => searchText(r).toLowerCase().includes(needle))
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      const val = col?.value ?? col?.exportValue
      if (val) {
        const m = sort.dir === 'asc' ? 1 : -1
        out = [...out].sort((a, b) => {
          const x = val(a)
          const y = val(b)
          if (x == null && y == null) return 0
          if (x == null) return 1
          if (y == null) return -1
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * m
        })
      }
    }
    return out
  }, [rows, q, sort, columns, searchText])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const p = Math.min(page, pages - 1)
  const visible = filtered.slice(p * pageSize, p * pageSize + pageSize)

  const exportCols: ExportColumn<T>[] = columns
    .filter((c) => c.export !== false && (c.exportValue || c.value))
    .map((c) => ({ header: c.header, value: (c.exportValue ?? c.value)!, align: c.align }))

  const toggleSort = (c: Column<T>) => {
    if (c.sortable === false || !(c.value || c.exportValue)) return
    setSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }))
  }

  return (
    <div className={cn('min-w-0', className)}>
      {(searchText || toolbar || exportName) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchText && (
            <div className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(0)
                }}
                placeholder={searchPlaceholder}
                className="field-input h-10 py-0 pl-9 text-sm"
                type="search"
              />
            </div>
          )}
          {toolbar}
          {exportName && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => {
                  exportCsv(exportName, filtered, exportCols)
                  audit('export', 'reports', null, `Exported ${exportName} (CSV, ${filtered.length} rows)`)
                }} title="Export CSV">
                CSV
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<FileText className="h-4 w-4" />}
                onClick={() => {
                  void exportPdf({ filename: exportName, title: exportName.replace(/[-_]/g, ' '), subtitle: exportSubtitle, rows: filtered, columns: exportCols, landscape: exportCols.length > 6 })
                  audit('export', 'reports', null, `Exported ${exportName} (PDF, ${filtered.length} rows)`)
                }}
                title="Export PDF"
              >
                PDF
              </Button>
            </div>
          )}
        </div>
      )}

      {!filtered.length ? (
        empty ?? <EmptyState title={q ? 'No matches' : 'Nothing here yet'} description={q ? `Nothing matches “${q}”.` : undefined} />
      ) : mobile ? (
        <ul className="space-y-2.5">
          {visible.map((r) => (
            <li
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('rounded-2xl border border-indigo-100/80 bg-white/90 p-3.5 shadow-sm', onRowClick && 'cursor-pointer active:scale-[.99] transition-transform')}
            >
              {mobileCard ? (
                mobileCard(r)
              ) : (
                <div className="space-y-1.5">
                  {columns
                    .filter((c) => !c.hideOnMobile)
                    .map((c, i) => (
                      <div key={c.key} className={cn('flex items-start justify-between gap-3', i === 0 && 'pb-1')}>
                        {i > 0 && <span className="shrink-0 text-[12px] font-medium text-ink-faint">{c.header}</span>}
                        <span className={cn('min-w-0 text-sm', i === 0 ? 'font-semibold text-ink' : 'text-right text-ink')}>{c.cell ? c.cell(r) : String((c.value ?? c.exportValue)?.(r) ?? '—')}</span>
                      </div>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-indigo-100/80 bg-white/85 scroll-thin">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-indigo-100 bg-indigo-50/50">
                {columns.map((c) => {
                  const active = sort?.key === c.key
                  const sortable = c.sortable !== false && !!(c.value || c.exportValue)
                  return (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c)}
                      className={cn(
                        'whitespace-nowrap px-3.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft',
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                        sortable && 'cursor-pointer select-none hover:text-ink',
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.header}
                        {active && (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn('border-b border-indigo-50 last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-indigo-50/50')}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-3.5 align-middle text-ink',
                        dense ? 'py-2' : 'py-3',
                        c.align === 'right' ? 'text-right num' : c.align === 'center' ? 'text-center' : 'text-left',
                        c.className,
                      )}
                    >
                      {c.cell ? c.cell(r) : String((c.value ?? c.exportValue)?.(r) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer}</tfoot>}
          </table>
        </div>
      )}

      {filtered.length > pageSize && (
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-ink-soft">
          <span className="num">
            {p * pageSize + 1}–{Math.min(filtered.length, (p + 1) * pageSize)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="icon-sm" variant="secondary" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="num px-1.5">
              {p + 1} / {pages}
            </span>
            <Button size="icon-sm" variant="secondary" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
