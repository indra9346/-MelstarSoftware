import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarRange, CheckCircle2, Download, FileText, FilterX, KanbanSquare, List, ListTodo, Plus, Search } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Priority, Task, TaskStatus } from '@/data/types'
import { Badge, Button, Card, DataTable, EmptyState, Input, PageHeader, Segmented, Select, StatCard, StatusBadge, confirm, guard, toast, type Column } from '@/components/ui'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { TaskDrawer } from '@/components/tasks/TaskDrawer'
import { TaskForm } from '@/components/tasks/TaskForm'
import { AvatarStack, DueChip } from '@/components/tasks/TaskCard'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { audit } from '@/services/audit'
import { PRIORITIES, PRIORITY_META, STATUS_META, checklistProgress, deleteTask, isOverdue, sortTasks, weekRange } from '@/services/tasks'
import { addDays, fmtDate, fmtDateShort, todayISO } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'

type View = 'board' | 'list'
type DueFilter = '' | 'overdue' | 'week' | 'none'

export default function TasksPage() {
  const s = useSession()
  const L = useLookups()
  const tasks = useTable('tasks')
  const manage = s.can('tasks.manage')
  const [params, setParams] = useSearchParams()

  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem('melstar-tasks-view') === 'list' ? 'list' : 'board'
    } catch {
      return 'board'
    }
  })
  const [q, setQ] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState<'' | Priority>('')
  const [label, setLabel] = useState('')
  const [wc, setWc] = useState('')
  const [due, setDue] = useState<DueFilter>('')
  const [form, setForm] = useState<{ open: boolean; task: Task | null; status: TaskStatus }>({ open: false, task: null, status: 'todo' })

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
  const closeForm = useCallback(() => setForm((f) => ({ ...f, open: false })), [])

  useEffect(() => {
    try {
      localStorage.setItem('melstar-tasks-view', view)
    } catch {
      /* private mode */
    }
  }, [view])

  useEffect(() => {
    if (openId && tasks.length && !tasks.some((t) => t.id === openId)) setOpenId(null)
  }, [openId, tasks, setOpenId])

  const today = todayISO()
  const week = weekRange(today)

  const labels = useMemo(() => [...new Set(tasks.flatMap((t) => t.labels))].sort((a, b) => a.localeCompare(b)), [tasks])
  const assigneeOptions = useMemo(() => {
    const ids = new Set(tasks.flatMap((t) => t.assignee_ids))
    return L.employeeOptions((e) => ids.has(e.id))
  }, [tasks, L])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.filter((t) => {
      if (assignee && !t.assignee_ids.includes(assignee)) return false
      if (priority && t.priority !== priority) return false
      if (label && !t.labels.includes(label)) return false
      if (wc && t.work_centre_id !== wc) return false
      if (due === 'overdue' && !isOverdue(t, today)) return false
      if (due === 'week' && (!t.due_date || t.due_date < week.from || t.due_date > week.to)) return false
      if (due === 'none' && t.due_date) return false
      if (needle) {
        const hay = `${t.task_no} ${t.title} ${t.description} ${t.labels.join(' ')} ${t.assignee_ids.map((id) => L.empName(id)).join(' ')} ${L.wcName(t.work_centre_id)}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [tasks, q, assignee, priority, label, wc, due, today, week.from, week.to, L])
  const anyFilter = !!(q || assignee || priority || label || wc || due)
  const clear = () => {
    setQ('')
    setAssignee('')
    setPriority('')
    setLabel('')
    setWc('')
    setDue('')
  }

  const stats = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'done')
    return {
      open: open.length,
      overdue: open.filter((t) => isOverdue(t, today)).length,
      week: open.filter((t) => t.due_date && t.due_date >= week.from && t.due_date <= week.to).length,
      done30: tasks.filter((t) => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= addDays(today, -30)).length,
    }
  }, [tasks, today, week.from, week.to])

  const newTask = (status: TaskStatus = 'todo') => setForm({ open: true, task: null, status })
  const editTask = (t: Task) => setForm({ open: true, task: t, status: t.status })
  const removeTask = async (t: Task) => {
    const ok = await confirm({ title: `Delete ${t.task_no}?`, message: `“${t.title}” and its comments will be removed for everyone. This cannot be undone.`, danger: true, confirmLabel: 'Delete task' })
    if (!ok) return
    if (await guard(() => deleteTask(t.id), `${t.task_no} deleted`)) {
      if (openId === t.id) setOpenId(null)
    }
  }

  const doExport = (kind: 'csv' | 'pdf') => {
    const rows = sortTasks(filtered)
    if (!rows.length) return toast.info('Nothing to export', 'No tasks match the current filters.')
    const cols: ExportColumn<Task>[] = [
      { header: 'Task', value: (t) => t.task_no },
      { header: 'Title', value: (t) => t.title },
      { header: 'Status', value: (t) => STATUS_META[t.status].label },
      { header: 'Priority', value: (t) => PRIORITY_META[t.priority].label },
      { header: 'Assignees', value: (t) => t.assignee_ids.map((id) => L.empName(id)).join(', ') },
      { header: 'Due', value: (t) => (t.due_date ? fmtDate(t.due_date) : '') },
      { header: 'Checklist', value: (t) => (t.checklist.length ? `${checklistProgress(t).done}/${t.checklist.length}` : '') },
      { header: 'Labels', value: (t) => t.labels.join(', ') },
      { header: 'Work centre', value: (t) => (t.work_centre_id ? L.wcName(t.work_centre_id) : '') },
    ]
    const name = `tasks-${today}`
    if (kind === 'csv') exportCsv(name, rows, cols)
    else
      void exportPdf({
        filename: name,
        title: 'Tasks',
        subtitle: anyFilter ? `Filtered · ${rows.length} of ${tasks.length}` : `${rows.length} tasks`,
        rows,
        columns: cols,
        landscape: true,
        summary: [
          ['Open', String(rows.filter((t) => t.status !== 'done').length)],
          ['Overdue', String(rows.filter((t) => isOverdue(t, today)).length)],
          ['Done', String(rows.filter((t) => t.status === 'done').length)],
          ['As on', fmtDate(today)],
        ],
      })
    audit('export', 'tasks', null, `Exported ${rows.length} tasks (${kind.toUpperCase()})`)
  }

  const columns: Column<Task>[] = [
    {
      key: 'task',
      header: 'Task',
      value: (t) => t.task_no,
      exportValue: (t) => `${t.task_no} ${t.title}`,
      cell: (t) => (
        <span className="block min-w-0 max-w-[340px]">
          <span className="num block text-[11.5px] font-semibold text-ink-faint">{t.task_no}</span>
          <span className={cn('block truncate font-semibold', t.status === 'done' ? 'text-ink-soft' : 'text-ink')}>{t.title}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', value: (t) => t.status, exportValue: (t) => STATUS_META[t.status].label, cell: (t) => <StatusBadge status={t.status} label={STATUS_META[t.status].label} /> },
    { key: 'priority', header: 'Priority', value: (t) => PRIORITY_META[t.priority].rank, exportValue: (t) => PRIORITY_META[t.priority].label, cell: (t) => <Badge tone={PRIORITY_META[t.priority].tone}>{PRIORITY_META[t.priority].label}</Badge> },
    { key: 'assignees', header: 'Assignees', value: (t) => t.assignee_ids.map((id) => L.empName(id)).join(', '), cell: (t) => <AvatarStack ids={t.assignee_ids} max={4} /> },
    { key: 'due', header: 'Due', value: (t) => t.due_date, exportValue: (t) => (t.due_date ? fmtDate(t.due_date) : ''), cell: (t) => (t.due_date ? <DueChip task={t} /> : <span className="text-ink-faint">—</span>) },
    {
      key: 'check',
      header: 'Checklist',
      value: (t) => {
        const p = checklistProgress(t)
        return p.total ? p.done / p.total : null
      },
      exportValue: (t) => {
        const p = checklistProgress(t)
        return p.total ? `${p.done}/${p.total}` : ''
      },
      cell: (t) => {
        const p = checklistProgress(t)
        return p.total ? <span className="num text-[12.5px] font-semibold text-ink-soft">{p.done}/{p.total}</span> : <span className="text-ink-faint">—</span>
      },
      hideOnMobile: true,
    },
    { key: 'labels', header: 'Labels', value: (t) => t.labels.join(', '), cell: (t) => <span className="block max-w-[180px] truncate text-[12.5px] text-indigo-600">{t.labels.map((l) => `#${l}`).join(' ') || '—'}</span>, hideOnMobile: true },
    { key: 'wc', header: 'Work centre', value: (t) => (t.work_centre_id ? L.wcName(t.work_centre_id) : ''), hideOnMobile: true },
  ]

  return (
    <div>
      <PageHeader
        kicker="Operations"
        title="Tasks"
        subtitle="Shop-floor and office work across the plant — drag cards to update progress."
        actions={
          <>
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: <span className="inline-flex items-center gap-1.5"><KanbanSquare className="h-4 w-4" />Board</span> },
                { value: 'list', label: <span className="inline-flex items-center gap-1.5"><List className="h-4 w-4" />List</span> },
              ]}
            />
            {manage && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => newTask()}>
                New task
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Open tasks" value={stats.open} icon={<ListTodo className="h-4 w-4" />} accent="indigo" onClick={() => setDue('')} />
        <StatCard label="Overdue" value={stats.overdue} icon={<AlertTriangle className="h-4 w-4" />} accent={stats.overdue ? 'red' : 'green'} onClick={() => setDue('overdue')} hint="Past due, not done" />
        <StatCard label="Due this week" value={stats.week} icon={<CalendarRange className="h-4 w-4" />} accent="cyan" onClick={() => setDue('week')} hint={`${fmtDateShort(week.from)} – ${fmtDateShort(week.to)}`} />
        <StatCard label="Done · 30 days" value={stats.done30} icon={<CheckCircle2 className="h-4 w-4" />} accent="green" />
      </div>

      <Card className="mb-4 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="h-4 w-4" />} placeholder="Search tasks, people, labels…" className="h-10 py-0 text-sm" aria-label="Search tasks" type="search" />
          <Select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} options={assigneeOptions} placeholder="All assignees" className="h-10 py-0 text-sm" />
          <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as '' | Priority)} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))} placeholder="Any priority" className="h-10 py-0 text-sm" />
          <Select aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} options={labels.map((l) => ({ value: l, label: `#${l}` }))} placeholder="Any label" className="h-10 py-0 text-sm" />
          <Select aria-label="Work centre" value={wc} onChange={(e) => setWc(e.target.value)} options={[...L.wc.values()].sort((a, b) => a.name.localeCompare(b.name)).map((w) => ({ value: w.id, label: w.name }))} placeholder="All work centres" className="h-10 py-0 text-sm" />
          <Select
            aria-label="Due"
            value={due}
            onChange={(e) => setDue(e.target.value as DueFilter)}
            options={[
              { value: 'overdue', label: 'Overdue' },
              { value: 'week', label: 'Due this week' },
              { value: 'none', label: 'No due date' },
            ]}
            placeholder="Any due date"
            className="h-10 py-0 text-sm"
          />
          <Button size="sm" variant="ghost" className="h-10" icon={<FilterX className="h-4 w-4" />} disabled={!anyFilter} onClick={clear}>
            Clear
          </Button>
        </div>
        {anyFilter && (
          <p className="mt-2 px-1 text-[12.5px] text-ink-soft">
            Showing <b className="text-ink">{filtered.length}</b> of {tasks.length} tasks
          </p>
        )}
      </Card>

      {!tasks.length ? (
        <EmptyState
          icon={<KanbanSquare className="h-6 w-6" />}
          title="No tasks yet"
          description="Plan shop-floor jobs, audits and follow-ups, assign them to people and track them on the board."
          action={
            manage ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => newTask()}>
                Create the first task
              </Button>
            ) : undefined
          }
        />
      ) : view === 'board' ? (
        <TaskBoard
          tasks={filtered}
          onOpen={(t) => setOpenId(t.id)}
          onEdit={manage ? editTask : undefined}
          onDelete={manage ? (t) => void removeTask(t) : undefined}
          onAdd={manage ? newTask : undefined}
          emptyText={anyFilter ? 'No matching tasks' : undefined}
        />
      ) : (
        <Card className="min-w-0 p-3 sm:p-4">
          <DataTable
            rows={sortTasks(filtered)}
            columns={columns}
            rowKey={(t) => t.id}
            onRowClick={(t) => setOpenId(t.id)}
            toolbar={
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] text-ink-soft">
                  {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}
                </span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => doExport('csv')}>
                    CSV
                  </Button>
                  <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => doExport('pdf')}>
                    PDF
                  </Button>
                </div>
              </div>
            }
            initialSort={{ key: 'due', dir: 'asc' }}
            empty={<EmptyState title="No tasks match these filters" action={<Button size="sm" variant="secondary" onClick={clear}>Clear filters</Button>} />}
            mobileCard={(t) => (
              <div className={cn('space-y-2', isOverdue(t, today) && 'border-l-4 border-rose-400 pl-2.5')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-[11px] font-semibold text-ink-faint">{t.task_no}</p>
                    <p className="line-clamp-2 text-[14px] font-semibold text-ink">{t.title}</p>
                  </div>
                  <Badge tone={PRIORITY_META[t.priority].tone}>{PRIORITY_META[t.priority].label}</Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={t.status} label={STATUS_META[t.status].label} />
                    <DueChip task={t} />
                  </span>
                  <AvatarStack ids={t.assignee_ids} size={24} />
                </div>
              </div>
            )}
          />
        </Card>
      )}

      {!manage && (
        <p className="mt-3 text-[12.5px] text-ink-faint">View access — you can open tasks and comment; only assignees and task managers can move cards.</p>
      )}

      {manage && <TaskForm open={form.open} onClose={closeForm} task={form.task} initialStatus={form.status} />}
      <TaskDrawer
        taskId={openId}
        onClose={closeDrawer}
        onEdit={
          manage
            ? (id) => {
                const t = tasks.find((x) => x.id === id)
                if (t) editTask(t)
              }
            : undefined
        }
        onDelete={
          manage
            ? (id) => {
                const t = tasks.find((x) => x.id === id)
                if (t) void removeTask(t)
              }
            : undefined
        }
      />
    </div>
  )
}
