import type { ReactNode } from 'react'
import { CalendarClock, CheckSquare, Factory, GripVertical, MessageSquare } from 'lucide-react'
import type { Task } from '@/data/types'
import { Avatar, Badge, Menu, type MenuItem } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { PRIORITY_META, checklistProgress, isOverdue } from '@/services/tasks'
import { fmtDateShort, todayISO } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/misc'

/** Overlapping avatars for a task's assignees. */
export function AvatarStack({ ids, max = 3, size = 26 }: { ids: string[]; max?: number; size?: number }) {
  const L = useLookups()
  const shown = ids.slice(0, max)
  const names = ids.map((id) => L.empName(id)).join(', ')
  if (!ids.length) return <span className="text-[11.5px] font-medium text-ink-faint">Unassigned</span>
  return (
    <span className="flex items-center" title={names} aria-label={`Assigned to ${names}`}>
      {shown.map((id, i) => {
        const e = L.emp.get(id)
        return <Avatar key={id} name={e ? fullName(e) : '?'} src={e?.photo} size={size} className={cn(i > 0 && '-ml-2')} />
      })}
      {ids.length > max && (
        <span className="-ml-2 grid place-items-center rounded-full bg-brand-100 font-semibold text-brand-700 ring-2 ring-white" style={{ width: size, height: size, fontSize: size * 0.38 }}>
          +{ids.length - max}
        </span>
      )}
    </span>
  )
}

export function DueChip({ task, className }: { task: Pick<Task, 'due_date' | 'status'>; className?: string }) {
  if (!task.due_date) return null
  const today = todayISO()
  const overdue = isOverdue(task, today)
  const isToday = task.due_date === today && task.status !== 'done'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
        overdue ? 'bg-rose-50 text-rose-600' : isToday ? 'bg-amber-50 text-amber-700' : task.status === 'done' ? 'bg-slate-50 text-ink-faint' : 'bg-slate-50 text-ink-soft',
        className,
      )}
    >
      <CalendarClock className="h-3 w-3" />
      {overdue ? `Overdue · ${fmtDateShort(task.due_date)}` : isToday ? 'Due today' : fmtDateShort(task.due_date)}
    </span>
  )
}

/** Kanban card. Purely presentational — drag & drop is wired by TaskBoard. */
export function TaskCard({ task, comments = 0, menu, lifted, dragHandle, className }: { task: Task; comments?: number; menu?: MenuItem[]; lifted?: boolean; dragHandle?: boolean; className?: string }) {
  const L = useLookups()
  const overdue = isOverdue(task)
  const { done, total } = checklistProgress(task)
  const pm = PRIORITY_META[task.priority]
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-md border bg-white p-3 pl-3.5 text-left transition-shadow duration-150',
        overdue ? 'border-rose-200' : 'border-line',
        lifted ? 'shadow-lift ring-2 ring-brand-600/30' : 'hover:border-line-strong',
        task.status === 'done' && !lifted && 'bg-white',
        className,
      )}
    >
      <span className={cn('absolute inset-y-2 left-0 w-1 rounded-r-full', overdue ? 'bg-rose-500' : task.priority === 'urgent' ? 'bg-rose-300' : task.priority === 'high' ? 'bg-amber-300' : 'bg-transparent')} aria-hidden />
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="num text-[11px] font-semibold text-ink-faint">{task.task_no}</span>
            <Badge tone={pm.tone} className="px-2 py-0 text-[10.5px]">
              {pm.label}
            </Badge>
          </div>
          <p className={cn('mt-1 line-clamp-2 text-[13.5px] font-medium leading-snug', task.status === 'done' ? 'text-ink-soft' : 'text-ink')}>{task.title}</p>
        </div>
        {dragHandle && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
        {menu && <Menu items={menu} />}
      </div>

      {(task.labels.length > 0 || task.work_centre_id) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.work_centre_id && (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-teal-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-teal-700">
              <Factory className="h-3 w-3 shrink-0" />
              <span className="truncate">{L.wcName(task.work_centre_id)}</span>
            </span>
          )}
          {task.labels.slice(0, 3).map((l) => (
            <span key={l} className="max-w-[120px] truncate rounded-md bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-600">
              #{l}
            </span>
          ))}
          {task.labels.length > 3 && <span className="text-[10.5px] font-semibold text-ink-faint">+{task.labels.length - 3}</span>}
        </div>
      )}

      {total > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
            <div className={cn('h-full rounded-full transition-[width] duration-500', done === total ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="num text-[10.5px] font-semibold text-ink-soft">
            {done}/{total}
          </span>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <DueChip task={task} />
          {comments > 0 && <Meta icon={<MessageSquare className="h-3 w-3" />}>{comments}</Meta>}
          {total > 0 && done === total && <Meta icon={<CheckSquare className="h-3 w-3 text-emerald-500" />}>done</Meta>}
        </div>
        <AvatarStack ids={task.assignee_ids} size={24} />
      </div>
    </div>
  )
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="num inline-flex items-center gap-1 text-[11px] font-semibold text-ink-faint">
      {icon}
      {children}
    </span>
  )
}
