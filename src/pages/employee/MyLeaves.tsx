import { useMemo, useState } from 'react'
import { Ban, CalendarOff, CalendarPlus, History, Paperclip, UserX } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Employee, LeaveStatus } from '@/data/types'
import { leaveBalances } from '@/lib/leaves'
import { dayOfWeek, diffDays, fmtMonth, fyLabel, fyOf, relativeTime, WEEKDAYS_LONG } from '@/lib/dates'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useSession } from '@/services/session'
import { openFile } from '@/services/files'
import { canCancelLeave, cancelLeave, fmtLeaveDates, isUnlimited } from '@/services/leaves'
import { Badge, Button, Card, CardBody, CardHeader, confirm, EmptyState, guard, PageHeader, Progress, Segmented, StatusBadge } from '@/components/ui'
import { LeaveApplyModal } from '@/components/attendance/LeaveApplyModal'
import { LeaveTypeChip, useToday } from '@/components/attendance/shared'

export default function MyLeavesPage() {
  const s = useSession()
  if (!s.employee)
    return (
      <div>
        <PageHeader kicker="Self-service" title="My leaves" />
        <EmptyState icon={<UserX className="h-6 w-6" />} title="No employee profile linked" description="Your login isn’t linked to an employee record. Ask HR to link it to apply for leave." />
      </div>
    )
  return <MyLeaves emp={s.employee} />
}

type Filter = 'all' | 'pending' | 'approved' | 'closed'

function MyLeaves({ emp }: { emp: Employee }) {
  const today = useToday()
  const types = useTable('leave_types')
  const balances = useTable('leave_balances')
  const requests = useTable('leave_requests')
  const holidays = useTable('holidays')
  const [apply, setApply] = useState<{ typeId?: string } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const fy = fyOf(today)

  const views = useMemo(() => leaveBalances(emp, fy, types, balances, requests).sort((a, b) => Number(isUnlimited(a.type)) - Number(isUnlimited(b.type)) || a.type.code.localeCompare(b.type.code)), [emp, fy, types, balances, requests])
  const typeOf = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const mine = useMemo(() => requests.filter((r) => r.employee_id === emp.id).sort((a, b) => b.from_date.localeCompare(a.from_date) || b.applied_at.localeCompare(a.applied_at)), [requests, emp.id])
  const closed: LeaveStatus[] = ['rejected', 'cancelled']
  const shown = mine.filter((r) => filter === 'all' || (filter === 'closed' ? closed.includes(r.status) : r.status === filter))
  const pendingCount = mine.filter((r) => r.status === 'pending').length
  const upcoming = useMemo(() => holidays.filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8), [holidays, today])
  const nextLeave = mine.filter((r) => r.status === 'approved' && r.to_date >= today).sort((a, b) => a.from_date.localeCompare(b.from_date))[0]

  const cancel = async (id: string) => {
    const r = mine.find((x) => x.id === id)
    if (!r) return
    const ok = await confirm({
      title: 'Cancel this leave?',
      message: `${typeOf.get(r.leave_type_id)?.name ?? 'Leave'} · ${fmtLeaveDates(r)}. ${r.status === 'approved' ? 'The days return to your balance and HR is notified.' : 'The request is withdrawn.'}`,
      confirmLabel: 'Cancel leave',
      danger: true,
    })
    if (ok) await guard(() => cancelLeave(r), 'Leave cancelled')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Self-service"
        title="My leaves"
        subtitle={`FY ${fyLabel(fy)} · working days exclude your week-offs and plant holidays`}
        actions={
          <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setApply({})}>
            Apply for leave
          </Button>
        }
      />

      {nextLeave && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line border-l-[3px] border-l-brand-600 bg-white px-4 py-3">
          <LeaveTypeChip type={typeOf.get(nextLeave.leave_type_id)} />
          <p className="min-w-0 flex-1 text-[13.5px] text-ink">
            {nextLeave.from_date <= today ? 'On leave' : 'Next approved leave'}: <b>{fmtLeaveDates(nextLeave)}</b>
            {nextLeave.from_date > today && <span className="text-ink-soft"> · in {diffDays(today, nextLeave.from_date)} day{diffDays(today, nextLeave.from_date) === 1 ? '' : 's'}</span>}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {views.map((v) => {
          const unlimited = isUnlimited(v.type)
          const consumed = v.used + v.pending
          return (
            <button
              key={v.type.id}
              type="button"
              onClick={() => setApply({ typeId: v.type.id })}
              className="card group relative min-w-0 overflow-hidden p-4 text-left sm:p-5"
              title={`Apply for ${v.type.name}`}
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: v.type.color }} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <LeaveTypeChip type={v.type} />
                  <p className="mt-1.5 truncate text-[13.5px] font-medium text-ink">{v.type.name}</p>
                </div>
                {!v.type.paid && <Badge tone="slate">Unpaid</Badge>}
              </div>
              {unlimited ? (
                <>
                  <p className="mt-3 text-[26px] font-semibold leading-none text-ink">No limit</p>
                  <p className="mt-2 text-[12.5px] text-ink-soft">
                    Used {num(v.used)}
                    {v.pending ? ` · ${num(v.pending)} pending` : ''} · deducted from salary
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-3 leading-none text-ink">
                    <span className={cn('num text-[30px] font-semibold', v.available < 0 && 'text-rose-600')}>{num(v.available)}</span>
                    <span className="num text-[14px] font-semibold text-ink-soft"> of {num(v.entitled)} available</span>
                  </p>
                  <Progress value={consumed} max={Math.max(v.entitled, consumed, 1)} className="mt-3" tone={v.type.color} />
                  <p className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-ink-soft">
                    <span>Used {num(v.used)}</span>
                    {v.pending > 0 && <span className="text-amber-700">Pending {num(v.pending)}</span>}
                    {v.opening > 0 && <span>Carried {num(v.opening)}</span>}
                    {v.adjustment !== 0 && <span>Adj {v.adjustment > 0 ? '+' : ''}{num(v.adjustment)}</span>}
                  </p>
                </>
              )}
            </button>
          )
        })}
        {!views.length && <EmptyState className="xs:col-span-2" title="No leave types available" description="Ask HR to set up leave types." />}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="My requests"
            subtitle={pendingCount ? `${pendingCount} waiting for HR` : 'All decided'}
            icon={<History className="h-4 w-4" />}
            actions={
              <Segmented<Filter>
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'closed', label: 'Closed' },
                ]}
              />
            }
          />
          <CardBody>
            {!shown.length ? (
              <EmptyState title={filter === 'all' ? 'No leave requests yet' : 'Nothing here'} description={filter === 'all' ? 'Tap “Apply for leave” to send your first request.' : undefined} />
            ) : (
              <ul className="space-y-2.5">
                {shown.map((r) => {
                  const t = typeOf.get(r.leave_type_id)
                  return (
                    <li key={r.id} className="rounded-lg border border-line bg-white p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <LeaveTypeChip type={t} />
                          <span className="text-[13.5px] font-medium text-ink">{fmtLeaveDates(r)}</span>
                          <span className="num text-[12.5px] text-ink-soft">
                            · {num(r.days)} day{r.days === 1 ? '' : 's'}
                          </span>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-1.5 text-[13px] text-ink-soft">“{r.reason}”</p>
                      {r.review_note && r.status !== 'pending' && <p className="mt-1 text-[12.5px] text-ink">HR: {r.review_note}</p>}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11.5px] text-ink-faint">
                          Applied {relativeTime(r.applied_at)}
                          {r.attachment && (
                            <button type="button" onClick={() => void guard(() => openFile(r.attachment))} className="ml-2 inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                              <Paperclip className="h-3 w-3" /> Attachment
                            </button>
                          )}
                        </span>
                        {canCancelLeave(r, today) && (
                          <Button size="sm" variant="ghost" className="h-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => void cancel(r.id)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader title="Upcoming holidays" subtitle="Plant closures and optional days" icon={<CalendarOff className="h-4 w-4" />} />
          <CardBody>
            {!upcoming.length ? (
              <EmptyState title="No upcoming holidays listed" />
            ) : (
              <ul className="space-y-2">
                {upcoming.map((h, i) => {
                  const days = diffDays(today, h.date)
                  const optional = h.type === 'optional'
                  return (
                    <li key={h.id} className={cn('flex items-center gap-3 rounded-lg border p-2.5', i === 0 && !optional ? 'border-brand-200 bg-slate-50' : 'border-line bg-white')}>
                      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-md text-center leading-none', optional ? 'border border-dashed border-sky-300 text-sky-700' : 'bg-brand-600 text-white')}>
                        <span>
                          <span className="num block text-[16px] font-semibold">{Number(h.date.slice(8))}</span>
                          <span className="block text-[9px] font-semibold uppercase">{fmtMonth(h.date.slice(0, 7), true).slice(0, 3)}</span>
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-ink">{h.name}</p>
                        <p className="truncate text-[12px] text-ink-soft">
                          {WEEKDAYS_LONG[dayOfWeek(h.date)]} · {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
                        </p>
                      </div>
                      {optional && <Badge tone="sky">Optional</Badge>}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-3 text-[11.5px] text-ink-faint">Optional holidays aren’t plant closures — apply for leave to take one.</p>
          </CardBody>
        </Card>
      </div>

      <LeaveApplyModal open={!!apply} onClose={() => setApply(null)} employee={emp} defaultTypeId={apply?.typeId} />
    </div>
  )
}
