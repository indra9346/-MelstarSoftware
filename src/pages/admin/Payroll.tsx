import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Play } from 'lucide-react'
import { useTable } from '@/data/store'
import { Button, PageHeader, Tabs } from '@/components/ui'
import { RunsTab } from '@/components/payroll/RunsTab'
import { StructuresTab } from '@/components/payroll/StructuresTab'
import { AdvancesTab } from '@/components/payroll/AdvancesTab'
import { StatutoryTab } from '@/components/payroll/StatutoryTab'
import { todayISO } from '@/lib/dates'
import { currentStructure } from '@/services/payroll'
import { useSession } from '@/services/session'

type Tab = 'runs' | 'structures' | 'advances' | 'statutory'
const TABS: Tab[] = ['runs', 'structures', 'advances', 'statutory']

export default function PayrollPage() {
  const s = useSession()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'runs'
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    if (t === 'runs') next.delete('tab')
    else next.set('tab', t)
    setParams(next, { replace: true })
  }
  const [runOpen, setRunOpen] = useState(false)

  const advances = useTable('advances')
  const employees = useTable('employees')
  const structures = useTable('salary_structures')
  const pending = advances.filter((a) => a.status === 'pending').length
  const missing = useMemo(() => {
    const today = todayISO()
    return employees.filter((e) => e.status !== 'exited' && !currentStructure(e.id, structures, today)).length
  }, [employees, structures])

  return (
    <div>
      <PageHeader
        kicker="People"
        title="Payroll"
        subtitle="Monthly runs, salary structures, advances and statutory registers (PF · ESI · PT · TDS)"
        actions={
          s.can('payroll.manage') && (
            <Button
              icon={<Play className="h-4 w-4" />}
              onClick={() => {
                setTab('runs')
                setRunOpen(true)
              }}
            >
              Run payroll
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'runs', label: 'Runs' },
          { value: 'structures', label: 'Salary structures', count: missing },
          { value: 'advances', label: 'Advances & loans', count: pending },
          { value: 'statutory', label: 'Statutory' },
        ]}
      />
        <div key={tab}>
          {tab === 'runs' && <RunsTab runOpen={runOpen} setRunOpen={setRunOpen} />}
          {tab === 'structures' && <StructuresTab />}
          {tab === 'advances' && <AdvancesTab />}
          {tab === 'statutory' && <StatutoryTab />}
        </div>
    </div>
  )
}
