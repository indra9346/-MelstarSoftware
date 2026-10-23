/** Report catalogue: grouped list on desktop, grouped select on phones / tablets. */
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
            <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">
              <GIcon className="h-3.5 w-3.5" />
              {g.label}
              <span className="num ml-auto rounded-full bg-brand-50 px-1.5 text-[10px] text-ink-soft">{g.reports.length}</span>
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
                  className={cn('group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors', on ? 'bg-brand-50 text-ink' : 'text-ink-soft hover:bg-slate-100 hover:text-ink')}
                >
                  {on && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-600" />}
                  <Icon className={cn('h-4 w-4 shrink-0', on ? 'text-brand-600' : 'text-ink-faint')} />
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{r.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-faint">{r.short}</span>
                  </span>
                  
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
      <Icon className="h-5 w-5 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <label htmlFor="report-picker" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">
          Report
        </label>
        <select id="report-picker" value={active} onChange={(e) => onSelect(e.target.value as ReportId)} className="field-input field-select font-medium">
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
