import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTable } from '@/data/store'
import { PageHeader, Tabs } from '@/components/ui'
import { LeaveRequestsTab } from '@/components/attendance/leaves/LeaveRequestsTab'
import { BalancesTab } from '@/components/attendance/leaves/BalancesTab'
import { LeaveCalendarTab } from '@/components/attendance/leaves/LeaveCalendarTab'
import { HolidaysTab } from '@/components/attendance/leaves/HolidaysTab'
import { LeaveTypesTab } from '@/components/attendance/leaves/LeaveTypesTab'

type Tab = 'requests' | 'balances' | 'calendar' | 'holidays' | 'types'
const TABS: Tab[] = ['requests', 'balances', 'calendar', 'holidays', 'types']

export default function LeavesPage() {
  const [params, setParams] = useSearchParams()
  const requests = useTable('leave_requests')
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'requests'
  const pending = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests])

  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'requests') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  return (
    <div>
      <PageHeader kicker="People" title="Leaves & holidays" subtitle="Requests, balances, the team calendar, plant holidays and leave policy." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'requests', label: 'Requests', count: pending },
          { value: 'balances', label: 'Balances' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'holidays', label: 'Holidays' },
          { value: 'types', label: 'Leave types' },
        ]}
      />
        <div key={tab} className="min-w-0">
          {tab === 'requests' && <LeaveRequestsTab />}
          {tab === 'balances' && <BalancesTab />}
          {tab === 'calendar' && <LeaveCalendarTab />}
          {tab === 'holidays' && <HolidaysTab />}
          {tab === 'types' && <LeaveTypesTab />}
        </div>
    </div>
  )
}
