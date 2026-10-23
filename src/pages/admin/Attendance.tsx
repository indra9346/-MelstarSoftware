import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'
import { PageHeader, Tabs } from '@/components/ui'
import { LiveBoard } from '@/components/attendance/admin/LiveBoard'
import { DailyTab } from '@/components/attendance/admin/DailyTab'
import { RegisterTab } from '@/components/attendance/admin/RegisterTab'
import { RegularisationsTab } from '@/components/attendance/admin/RegularisationsTab'
import { OvertimeTab } from '@/components/attendance/admin/OvertimeTab'
import { ShiftsTab } from '@/components/attendance/admin/ShiftsTab'
import { MarkAttendanceModal, type MarkTarget } from '@/components/attendance/MarkAttendanceModal'

type Tab = 'live' | 'daily' | 'register' | 'regularisations' | 'overtime' | 'shifts'
const TABS: Tab[] = ['live', 'daily', 'register', 'regularisations', 'overtime', 'shifts']

export default function AttendancePage() {
  const s = useSession()
  const [params, setParams] = useSearchParams()
  const regs = useTable('regularisations')
  const attendance = useTable('attendance')
  const [mark, setMark] = useState<MarkTarget | null>(null)
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'live'

  const pendingRegs = useMemo(() => regs.filter((r) => r.status === 'pending').length, [regs])
  const pendingOt = useMemo(() => attendance.filter((a) => a.ot_status === 'pending' && a.ot_minutes > 0).length, [attendance])

  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'live') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  const onMark = (t: MarkTarget) => {
    if (s.can('attendance.manage')) setMark(t)
  }

  return (
    <div>
      <PageHeader kicker="People" title="Attendance" subtitle="Live floor status, daily sheet, muster register, corrections, overtime and shifts." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'live', label: 'Live board' },
          { value: 'daily', label: 'Daily' },
          { value: 'register', label: 'Monthly register' },
          { value: 'regularisations', label: 'Regularisations', count: pendingRegs },
          { value: 'overtime', label: 'Overtime', count: pendingOt },
          { value: 'shifts', label: 'Shifts' },
        ]}
      />
        <div key={tab} className="min-w-0">
          {tab === 'live' && <LiveBoard onMark={onMark} />}
          {tab === 'daily' && <DailyTab onMark={onMark} />}
          {tab === 'register' && <RegisterTab onMark={onMark} />}
          {tab === 'regularisations' && <RegularisationsTab />}
          {tab === 'overtime' && <OvertimeTab />}
          {tab === 'shifts' && <ShiftsTab />}
        </div>
      <MarkAttendanceModal target={mark} onClose={() => setMark(null)} />
    </div>
  )
}
