import { Fragment, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ISODate, YearMonth } from '@/data/types'
import { addMonths, dayOfWeek, fmtMonth, monthDates, WEEKDAYS } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { Button } from '@/components/ui'

/**
 * Month grid: weekday header + one cell per date (rendered by the caller).
 * Monday-first by default — the plant's week-off (Sunday) sits at the end of each row.
 */
export function MonthGrid({ month, renderDay, weekStart = 1, className }: { month: YearMonth; renderDay: (date: ISODate) => ReactNode; weekStart?: 0 | 1; className?: string }) {
  const dates = monthDates(month)
  const lead = (dayOfWeek(dates[0]!) - weekStart + 7) % 7
  const order = weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  return (
    <div className={cn('grid grid-cols-7 gap-1 sm:gap-1.5', className)}>
      {order.map((d) => (
        <div key={d} className={cn('min-w-0 pb-1 text-center text-[10.5px] font-semibold uppercase tracking-wider', d === 0 ? 'text-rose-400' : 'text-ink-faint')}>
          <span className="sm:hidden">{WEEKDAYS[d]!.slice(0, 1)}</span>
          <span className="hidden sm:inline">{WEEKDAYS[d]}</span>
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`lead-${i}`} aria-hidden />
      ))}
      {dates.map((d) => (
        <Fragment key={d}>{renderDay(d)}</Fragment>
      ))}
    </div>
  )
}

/** ‹ October 2026 › with optional bounds. */
export function MonthNav({ month, onChange, min, max, className }: { month: YearMonth; onChange: (m: YearMonth) => void; min?: YearMonth; max?: YearMonth; className?: string }) {
  const canPrev = !min || month > min
  const canNext = !max || month < max
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Button size="icon-sm" variant="secondary" disabled={!canPrev} onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="relative h-8 min-w-[132px] overflow-hidden text-center">
          <span
            key={month}
            className="absolute inset-0 grid place-items-center text-[15px] font-semibold text-ink"
          >
            {fmtMonth(month)}
          </span>
      </div>
      <Button size="icon-sm" variant="secondary" disabled={!canNext} onClick={() => onChange(addMonths(month, 1))} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
