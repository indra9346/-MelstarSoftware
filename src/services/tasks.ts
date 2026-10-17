/**
 * Tasks (kanban), task comments and personal to-dos.
 * "Task assigned" / "commented" notifications are created by the database (notificationRules in demo mode).
 *
 * Self-service rule (enforced by RLS + guard_tasks): an assignee may only change
 * status, checklist, sort_order and completed_at — so moves and checklist ticks send only those fields.
 */
import { db } from '@/data/store'
import type { ChecklistItem, Priority, Task, TaskComment, TaskStatus, Todo } from '@/data/types'
import { addDays, dayOfWeek, todayISO } from '@/lib/dates'
import { uuid, nextNumber } from '@/lib/ids'
import type { Tone } from '@/components/ui'
import { audit, diff } from './audit'
import { currentSession, type Session } from './session'

/* ── meta ─────────────────────────────────────────────────────────────────── */

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done']

export const STATUS_META: Record<TaskStatus, { label: string; tone: Tone; dot: string; bar: string }> = {
  todo: { label: 'To do', tone: 'slate', dot: 'bg-slate-400', bar: 'from-slate-300 to-slate-400' },
  in_progress: { label: 'In progress', tone: 'cyan', dot: 'bg-cyan-500', bar: 'from-cyan-400 to-sky-500' },
  review: { label: 'Review', tone: 'violet', dot: 'bg-violet-500', bar: 'from-indigo-400 to-violet-500' },
  done: { label: 'Done', tone: 'green', dot: 'bg-emerald-500', bar: 'from-emerald-400 to-teal-500' },
}

export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']

export const PRIORITY_META: Record<Priority, { label: string; tone: Tone; rank: number }> = {
  low: { label: 'Low', tone: 'slate', rank: 0 },
  medium: { label: 'Medium', tone: 'sky', rank: 1 },
  high: { label: 'High', tone: 'amber', rank: 2 },
  urgent: { label: 'Urgent', tone: 'red', rank: 3 },
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function isOverdue(t: Pick<Task, 'due_date' | 'status'>, today = todayISO()): boolean {
  return !!t.due_date && t.due_date < today && t.status !== 'done'
}

/** Monday–Sunday of the week containing `day`. */
export function weekRange(day = todayISO()): { from: string; to: string } {
  const from = addDays(day, -((dayOfWeek(day) + 6) % 7))
  return { from, to: addDays(from, 6) }
}

export function checklistProgress(t: Pick<Task, 'checklist'>): { done: number; total: number } {
  return { done: t.checklist.filter((c) => c.done).length, total: t.checklist.length }
}

export function canManageTasks(s: Session | null = currentSession()): boolean {
  return !!s?.can('tasks.manage')
}

/** Managers move anything; anyone else only the tasks assigned to them. */
export function canMoveTask(t: Pick<Task, 'assignee_ids'>, s: Session | null = currentSession()): boolean {
  if (!s) return false
  if (s.can('tasks.manage')) return true
  return !!s.employee && t.assignee_ids.includes(s.employee.id)
}

function requireSession(): Session {
  const s = currentSession()
  if (!s) throw new Error('You are not signed in.')
  return s
}

function requireManage(): Session {
  const s = requireSession()
  if (!s.can('tasks.manage')) throw new Error('You do not have permission to manage tasks.')
  return s
}

function getTask(id: string): Task {
  const t = db.get('tasks', id)
  if (!t) throw new Error('This task no longer exists.')
  return t
}

/* ── create / edit ────────────────────────────────────────────────────────── */

export interface TaskInput {
  title: string
  description: string
  priority: Priority
  assignee_ids: string[]
  due_date: string | null
  labels: string[]
  work_centre_id: string | null
  checklist: ChecklistItem[]
}

export type TaskErrors = Partial<Record<keyof TaskInput, string>>

export function taskErrors(t: TaskInput, original?: Task | null): TaskErrors {
  const e: TaskErrors = {}
  const title = t.title.trim()
  if (title.length < 3) e.title = 'Give the task a short title (at least 3 characters).'
  else if (title.length > 140) e.title = 'Keep the title under 140 characters.'
  if (t.description.length > 4000) e.description = 'Keep the description under 4,000 characters.'
  if (!PRIORITIES.includes(t.priority)) e.priority = 'Choose a priority.'
  if (!t.assignee_ids.length) e.assignee_ids = 'Assign the task to at least one person.'
  else if (t.assignee_ids.length > 12) e.assignee_ids = 'Assign at most 12 people.'
  if (t.due_date && t.due_date < todayISO() && t.due_date !== original?.due_date) e.due_date = 'The due date cannot be in the past.'
  if (t.labels.length > 8) e.labels = 'Use at most 8 labels.'
  else if (t.labels.some((l) => l.length > 24)) e.labels = 'Keep each label under 24 characters.'
  const items = t.checklist.filter((c) => c.text.trim())
  if (items.length > 30) e.checklist = 'Use at most 30 checklist items.'
  else if (items.some((c) => c.text.trim().length > 200)) e.checklist = 'Keep each checklist item under 200 characters.'
  return e
}

function clean(t: TaskInput): TaskInput {
  const seen = new Set<string>()
  return {
    title: t.title.trim(),
    description: t.description.trim(),
    priority: t.priority,
    assignee_ids: [...new Set(t.assignee_ids)],
    due_date: t.due_date || null,
    labels: t.labels.map((l) => l.trim()).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase())),
    work_centre_id: t.work_centre_id || null,
    checklist: t.checklist.filter((c) => c.text.trim()).map((c) => ({ id: c.id || uuid(), text: c.text.trim(), done: c.done })),
  }
}

export function createTask(input: TaskInput, status: TaskStatus = 'todo'): Task {
  const s = requireManage()
  const first = Object.values(taskErrors(input))[0]
  if (first) throw new Error(first)
  const all = db.all('tasks')
  const column = all.filter((x) => x.status === status)
  const top = column.length ? Math.min(...column.map((x) => x.sort_order)) - 1 : 0
  const row = db.insert('tasks', {
    ...clean(input),
    task_no: nextNumber('T-', all.map((x) => x.task_no)),
    status,
    created_by: s.user.id,
    sort_order: top,
    completed_at: status === 'done' ? new Date().toISOString() : null,
  })
  audit('create', 'tasks', row.id, `Created task ${row.task_no} · ${row.title}`)
  return row
}

export function updateTask(id: string, input: TaskInput): Task {
  requireManage()
  const before = getTask(id)
  const first = Object.values(taskErrors(input, before))[0]
  if (first) throw new Error(first)
  const patch = clean(input)
  const changes = diff(before, patch)
  if (!changes) return before
  const changed = Object.fromEntries(Object.keys(changes).map((k) => [k, patch[k as keyof TaskInput]])) as Partial<Task>
  const row = db.update('tasks', id, changed)
  audit('update', 'tasks', id, `Edited task ${before.task_no} · ${row.title}`, changes)
  return row
}

export function deleteTask(id: string) {
  requireManage()
  const t = getTask(id)
  const comments = db.where('task_comments', (c) => c.task_id === id)
  db.batch(() => {
    // the server cascades comments; locally (demo mode) they are removed with the task
    for (const c of comments) {
      if (db.backend?.kind === 'supabase') db.forget('task_comments', c.id)
      else db.remove('task_comments', c.id)
    }
    db.remove('tasks', id)
  })
  audit('delete', 'tasks', id, `Deleted task ${t.task_no} · ${t.title}`)
}

/* ── move / reorder ──────────────────────────────────────────────────────── */

/**
 * Move a task to a column and position.
 *   target: id of the task it should sit before · index in the target column · null = bottom.
 *   context: the tasks the user is looking at (filtered board); defaults to every task.
 * sort_order is a float, so only the moved task changes (midpoint of its new neighbours).
 */
export function moveTask(id: string, status: TaskStatus, target: string | number | null = null, context?: readonly Task[]): Task {
  const s = requireSession()
  const t = getTask(id)
  if (!canMoveTask(t, s)) throw new Error('Only the assignees or a task manager can move this task.')
  const column = sortTasks((context ?? db.all('tasks')).filter((x) => x.status === status && x.id !== id))
  let index = typeof target === 'number' ? Math.max(0, Math.min(target, column.length)) : target ? column.findIndex((x) => x.id === target) : column.length
  if (index < 0) index = column.length

  if (t.status === status) {
    const current = sortTasks([...column, t]).findIndex((x) => x.id === id)
    if (current === index) return t
  }

  const prev = column[index - 1]
  const next = column[index]
  const sort_order = prev && next ? (prev.sort_order + next.sort_order) / 2 : prev ? prev.sort_order + 1 : next ? next.sort_order - 1 : t.sort_order
  const patch: Partial<Task> = { status, sort_order }
  if (status !== t.status && (status === 'done' || t.status === 'done')) patch.completed_at = status === 'done' ? new Date().toISOString() : null
  const row = db.update('tasks', id, patch)
  if (status !== t.status) audit('update', 'tasks', id, `Moved ${t.task_no} from ${STATUS_META[t.status].label} to ${STATUS_META[status].label}`, { status: { from: t.status, to: status } })
  else audit('update', 'tasks', id, `Reordered ${t.task_no} in ${STATUS_META[status].label}`)
  return row
}

export function toggleChecklist(id: string, itemId: string): Task {
  const s = requireSession()
  const t = getTask(id)
  if (!canMoveTask(t, s)) throw new Error('Only the assignees or a task manager can tick the checklist.')
  const item = t.checklist.find((c) => c.id === itemId)
  if (!item) throw new Error('Checklist item not found.')
  const checklist = t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c))
  const row = db.update('tasks', id, { checklist })
  audit('update', 'tasks', id, `${t.task_no}: ${item.done ? 'unticked' : 'ticked'} “${item.text}”`)
  return row
}

/* ── comments ─────────────────────────────────────────────────────────────── */

export function addComment(taskId: string, body: string): TaskComment {
  const s = requireSession()
  const t = getTask(taskId)
  const text = body.trim()
  if (!text) throw new Error('Write a comment first.')
  if (text.length > 2000) throw new Error('Keep comments under 2,000 characters.')
  const row = db.insert('task_comments', { task_id: taskId, author_user_id: s.user.id, author_name: s.user.display_name, body: text })
  audit('create', 'task_comments', row.id, `Commented on ${t.task_no}: ${text.slice(0, 80)}`)
  return row
}

export function canDeleteComment(c: TaskComment, s: Session | null = currentSession()): boolean {
  return !!s && (c.author_user_id === s.user.id || s.can('tasks.manage'))
}

export function deleteComment(c: TaskComment) {
  const s = requireSession()
  if (!canDeleteComment(c, s)) throw new Error('You can only delete your own comments.')
  db.remove('task_comments', c.id)
  const t = db.get('tasks', c.task_id)
  audit('delete', 'task_comments', c.id, `Deleted a comment on ${t?.task_no ?? 'a task'}`)
}

/* ── personal to-dos ──────────────────────────────────────────────────────── */

export function todoError(text: string, due: string | null): string | null {
  const t = text.trim()
  if (!t) return 'Write what you need to do.'
  if (t.length > 200) return 'Keep it under 200 characters.'
  if (due && due < todayISO()) return 'The due date cannot be in the past.'
  return null
}

export function addTodo(text: string, due_date: string | null = null): Todo {
  const s = requireSession()
  const err = todoError(text, due_date)
  if (err) throw new Error(err)
  const row = db.insert('todos', { user_id: s.user.id, text: text.trim(), done: false, due_date: due_date || null })
  audit('create', 'todos', row.id, `Added a to-do: ${row.text.slice(0, 80)}`)
  return row
}

function ownTodo(id: string): Todo {
  const s = requireSession()
  const t = db.get('todos', id)
  if (!t || t.user_id !== s.user.id) throw new Error('To-do not found.')
  return t
}

export function updateTodo(id: string, patch: Partial<Pick<Todo, 'text' | 'due_date'>>): Todo {
  const t = ownTodo(id)
  const next = { text: patch.text ?? t.text, due_date: patch.due_date === undefined ? t.due_date : patch.due_date }
  const err = next.text.trim() ? (next.text.trim().length > 200 ? 'Keep it under 200 characters.' : null) : 'Write what you need to do.'
  if (err) throw new Error(err)
  const clean = { text: next.text.trim(), due_date: next.due_date || null }
  const changes = diff(t, clean)
  if (!changes) return t
  const row = db.update('todos', id, clean)
  audit('update', 'todos', id, `Edited a to-do: ${row.text.slice(0, 80)}`, changes)
  return row
}

export function toggleTodo(id: string): Todo {
  const t = ownTodo(id)
  const row = db.update('todos', id, { done: !t.done })
  audit('update', 'todos', id, `${t.done ? 'Reopened' : 'Completed'} a to-do: ${t.text.slice(0, 80)}`)
  return row
}

export function deleteTodo(id: string) {
  const t = ownTodo(id)
  db.remove('todos', id)
  audit('delete', 'todos', id, `Deleted a to-do: ${t.text.slice(0, 80)}`)
}
