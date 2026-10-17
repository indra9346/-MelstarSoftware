/** Report catalogue: grouped list on desktop, grouped select on phones / tablets. */
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/misc'
import type { ReportId, VisibleGroup } from '@/services/reports'
import { GROUP_ICONS, REPORT_VIEWS } from './registry'

export function ReportCatalogue({ groups, active, onSelect }: { groups: VisibleGroup[]; active: ReportId; onSelect: (id: ReportId) => void }) {
  return (
    <nav className="card p-2.5 xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto scroll-thin" aria-label="Reports">
      {groups.map((g) => {
        const GIcon = GROUP_ICONS[g.id]
        return (
          <div key={g.id} className="mb-2 last:mb-0">
            <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[.16em] text-ink-faint">
              <GIcon className="h-3.5 w-3.5" />
              {g.label}
              <span className="num ml-auto rounded-full bg-indigo-50 px-1.5 text-[10px] text-ink-soft">{g.reports.length}</span>
            </p>
            {g.reports.map((r) => {
              const Icon = REPORT_VIEWS[r.id].icon
              const on = r.id === active
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelect(r.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn('group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors', on ? 'text-ink' : 'text-ink-soft hover:bg-indigo-50/60 hover:text-ink')}
                >
                  {on && <motion.span layoutId="report-active" className="absolute inset-0 rounded-xl bg-white shadow-soft ring-1 ring-indigo-100" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span className={cn('relative grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors', on ? 'bg-gradient-to-br from-cyan-500 to-indigo-500 text-white' : 'bg-indigo-50 text-brand-indigo')}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{r.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-faint">{r.short}</span>
                  </span>
                  <ChevronRight className={cn('relative h-4 w-4 shrink-0 transition-opacity', on ? 'text-brand-indigo opacity-100' : 'opacity-0 group-hover:opacity-60')} />
                </button>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

/** Native grouped select (optgroups) styled like the kit's Select. */
export function ReportPicker({ groups, active, onSelect }: { groups: VisibleGroup[]; active: ReportId; onSelect: (id: ReportId) => void }) {
  const Icon = REPORT_VIEWS[active].icon
  return (
    <div className="card flex items-center gap-3 p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-white">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor="report-picker" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">
          Report
        </label>
        <select id="report-picker" value={active} onChange={(e) => onSelect(e.target.value as ReportId)} className="field-input field-select h-10 py-0 text-sm font-semibold">
          {groups.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  )
}
