import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { EmptyState, PageHeader } from '@/components/ui'
import { useSession } from '@/services/session'
import { visibleCatalogue, type ReportId } from '@/services/reports'
import { REPORT_VIEWS } from '@/components/reports/registry'
import { ReportCatalogue, ReportPicker } from '@/components/reports/Catalogue'
import { ReportPrintStyles } from '@/components/reports/ReportKit'

/** Reports hub — read-only MIS across people, payroll, finance and the plant. Deep link: /admin/reports?r=<report-id>. */
export default function ReportsPage() {
  const s = useSession()
  const groups = useMemo(() => visibleCatalogue(s.canAny), [s])
  const all = useMemo(() => groups.flatMap((g) => g.reports), [groups])
  const [params, setParams] = useSearchParams()
  const active = all.find((r) => r.id === params.get('r')) ?? all[0]
  const select = (id: ReportId) => setParams({ r: id }, { replace: true })

  if (!active) {
    return (
      <div className="min-w-0">
        <PageHeader kicker="Insights" title="Reports" subtitle="Live MIS reports" />
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No reports for your role" description="Reports appear here for the modules your role can view. Ask the ERP administrator if you need access." />
      </div>
    )
  }

  const { icon: Icon, View } = REPORT_VIEWS[active.id]
  const groupLabel = groups.find((g) => g.id === active.group)?.label ?? ''
  return (
    <div data-report-root className="min-w-0">
      <ReportPrintStyles />
      <div className="no-print">
        <PageHeader
          kicker="Insights"
          title="Reports"
          subtitle={`${all.length} live reports across ${groups.map((g) => g.label.toLowerCase()).join(', ')} — filter, print or export to CSV / PDF.`}
        />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="no-print hidden min-w-0 xl:block">
          <ReportCatalogue groups={groups} active={active.id} onSelect={select} />
        </aside>
        <div className="min-w-0">
          <div className="no-print mb-4 xl:hidden">
            <ReportPicker groups={groups} active={active.id} onSelect={select} />
          </div>
            <div
              key={active.id}
              className="min-w-0"
            >
              <View def={active} icon={<Icon />} groupLabel={groupLabel} />
            </div>
        </div>
      </div>
    </div>
  )
}
