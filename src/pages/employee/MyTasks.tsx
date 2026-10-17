import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Hand, KanbanSquare, ListTodo, Search, Timer } from 'lucide-react'
import { useTable } from '@/data/store'
import { EmptyState, Input, PageHeader, StatCard } from '@/components/ui'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { TaskDrawer } from '@/components/tasks/TaskDrawer'
import { TodoPanel } from '@/components/tasks/TodoPanel'
import { useSession } from '@/services/session'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { isOverdue } from '@/services/tasks'
import { addDays, todayISO } from '@/lib/dates'
import { useLookups } from '@/hooks/useLookups'

export default function MyTasksPage() {
  const s = useSession()
  const L = useLookups()
  const tasks = useTable('tasks')
  const todos = useTable('todos')
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const me = s.employee

  const openId = params.get('task')
  const setOpenId = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p)
          if (id) n.set('task', id)
          else n.delete('task')
          return n
        },
        { replace: true },
      ),
    [setParams],
  )
  const closeDrawer = useCallback(() => setOpenId(null), [setOpenId])

  const mine = useMemo(() => (me ? tasks.filter((t) => t.assignee_ids.includes(me.id)) : []), [tasks, me])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return mine
    return mine.filter((t) => `${t.task_no} ${t.title} ${t.description} ${t.labels.join(' ')} ${L.wcName(t.work_centre_id)}`.toLowerCase().includes(needle))
  }, [mine, q, L])

  useEffect(() => {
    if (openId && tasks.length && !tasks.some((t) => t.id === openId)) setOpenId(null)
  }, [openId, tasks, setOpenId])

  const today = todayISO()
  const stats = useMemo(() => {
    const open = mine.filter((t) => t.status !== 'done')
    return {
      open: open.length,
      inProgress: open.filter((t) => t.status === 'in_progress').length,
      overdue: open.filter((t) => isOverdue(t, today)).length,
      dueSoon: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 2)).length,
      done30: mine.filter((t) => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= addDays(today, -30)).length,
      todos: todos.filter((t) => t.user_id === s.user.id && !t.done).length,
    }
  }, [mine, todos, s.user.id, today])

  const first = (s.employee?.first_name ?? s.user.display_name).split(' ')[0]

  return (
    <div>
      <PageHeader kicker="My space" title="Tasks & to-dos" subtitle={me ? `Hi ${first} — drag a card to update its progress${mobile ? ' (press and hold)' : ''}, or open it to tick the checklist and comment.` : 'Your personal to-do list.'} />

      {me && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard label="Open tasks" value={stats.open} icon={<KanbanSquare className="h-4 w-4" />} accent="indigo" hint={`${stats.inProgress} in progress`} />
          <StatCard label="Overdue" value={stats.overdue} icon={<AlertTriangle className="h-4 w-4" />} accent={stats.overdue ? 'red' : 'green'} hint={stats.overdue ? 'Talk to your supervisor if blocked' : 'Nothing late'} />
          <StatCard label="Due in 2 days" value={stats.dueSoon} icon={<Timer className="h-4 w-4" />} accent="amber" />
          <StatCard label="Done · 30 days" value={stats.done30} icon={<CheckCircle2 className="h-4 w-4" />} accent="green" hint={`${stats.todos} to-dos open`} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1800px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {me ? (
            mine.length ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <Input value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="h-4 w-4" />} placeholder="Search my tasks…" className="h-10 py-0 text-sm" aria-label="Search my tasks" type="search" />
                  </div>
                  {mobile && (
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft">
                      <Hand className="h-3.5 w-3.5" /> Press & hold a card to drag · swipe to see columns
                    </span>
                  )}
                </div>
                <TaskBoard tasks={shown} onOpen={(t) => setOpenId(t.id)} emptyText={q ? 'No matching tasks' : undefined} />
              </>
            ) : (
              <EmptyState icon={<KanbanSquare className="h-6 w-6" />} title="No tasks assigned to you" description="When your supervisor assigns you a task it shows up here and you get a notification." />
            )
          ) : (
            <EmptyState icon={<ListTodo className="h-6 w-6" />} title="No employee record linked" description="Plant tasks are assigned to employees. Your login is not linked to one, so only your personal to-dos are shown." />
          )}
        </div>
        <TodoPanel className="min-[1800px]:sticky min-[1800px]:top-24 min-[1800px]:self-start" />
      </div>

      <TaskDrawer taskId={openId} onClose={closeDrawer} />
    </div>
  )
}
