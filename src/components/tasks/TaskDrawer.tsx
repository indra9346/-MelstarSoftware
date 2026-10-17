import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarPlus, CheckCircle2, Factory, Lock, MessageSquare, Pencil, SendHorizontal, Tag, Trash2, UserRound } from 'lucide-react'
import { useRow, useTable } from '@/data/store'
import type { TaskStatus } from '@/data/types'
import { Avatar, Badge, Button, InfoGrid, Modal, Progress, Segmented, StatusBadge, guard } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import {
  PRIORITY_META, STATUS_META, TASK_STATUSES, addComment, canDeleteComment, canMoveTask, checklistProgress, deleteComment, isOverdue, moveTask, toggleChecklist,
} from '@/services/tasks'
import { fmtDate, fmtDateTime, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { CheckBubble } from './CheckBubble'
import { DueChip } from './TaskCard'

interface Props {
  taskId: string | null
  onClose: () => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
}

/** Side drawer: details, assignees, checklist, comments and activity for one task. */
export function TaskDrawer({ taskId, onClose, onEdit, onDelete }: Props) {
  const task = useRow('tasks', taskId)
  const allComments = useTable('task_comments')
  const s = useSession()
  const L = useLookups()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const comments = useMemo(() => (taskId ? allComments.filter((c) => c.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at)) : []), [allComments, taskId])
  const movable = task ? canMoveTask(task, s) : false
  const manage = s.can('tasks.manage')
  const progress = task ? checklistProgress(task) : { done: 0, total: 0 }

  useEffect(() => setDraft(''), [taskId])
  const lastCount = useRef(comments.length)
  useEffect(() => {
    if (comments.length > lastCount.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    lastCount.current = comments.length
  }, [comments.length])

  const send = async () => {
    if (!task || !draft.trim() || sending) return
    setSending(true)
    const ok = await guard(() => addComment(task.id, draft))
    setSending(false)
    if (ok) setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }
  const setStatus = (st: TaskStatus) => {
    if (!task || st === task.status) return
    void guard(() => moveTask(task.id, st, 0))
  }

  const creator = task?.created_by ? L.userName(task.created_by) : '—'
  const activity = task
    ? [
        { key: 'created', icon: <CalendarPlus className="h-3.5 w-3.5" />, text: `Created${creator !== '—' ? ` by ${creator}` : ''}`, at: task.created_at, tone: 'bg-indigo-100 text-indigo-600' },
        ...comments.map((c) => ({ key: c.id, icon: <MessageSquare className="h-3.5 w-3.5" />, text: `${c.author_name} commented`, at: c.created_at, tone: 'bg-sky-100 text-sky-600' })),
        ...(task.completed_at ? [{ key: 'done', icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: 'Marked done', at: task.completed_at, tone: 'bg-emerald-100 text-emerald-600' }] : []),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : []

  return (
    <Modal
      open={!!taskId && !!task}
      onClose={onClose}
      side
      size="lg"
      title={
        task && (
          <span className="block">
            <span className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="num text-[12px] font-semibold text-ink-faint">{task.task_no}</span>
              <StatusBadge status={task.status} label={STATUS_META[task.status].label} />
              <Badge tone={PRIORITY_META[task.priority].tone}>{PRIORITY_META[task.priority].label}</Badge>
              {isOverdue(task) && <Badge tone="red">Overdue</Badge>}
            </span>
            <span className="block break-words">{task.title}</span>
          </span>
        )
      }
      footer={
        task && manage && (onEdit || onDelete) ? (
          <>
            {onDelete && (
              <Button variant="ghost" className="mr-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(task.id)}>
                Delete
              </Button>
            )}
            {onEdit && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(task.id)}>
                Edit task
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {/* takes the dialog's initial focus so phones don't pop the keyboard open */}
      <input className="sr-only" readOnly tabIndex={-1} aria-hidden />
      {task && (
        <div className="space-y-6">
          <section>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Status</p>
            {movable ? (
              <Segmented<TaskStatus> value={task.status} onChange={setStatus} options={TASK_STATUSES.map((st) => ({ value: st, label: STATUS_META[st].label }))} size="sm" />
            ) : (
              <p className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
                <Lock className="h-3.5 w-3.5" /> Only the assignees or a task manager can move this task.
              </p>
            )}
          </section>

          <section>
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Description</p>
            {task.description ? <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink">{task.description}</p> : <p className="text-sm text-ink-faint">No description.</p>}
          </section>

          <InfoGrid
            items={[
              ['Due', task.due_date ? <DueChip task={task} className="text-[12px]" /> : 'No due date'],
              ['Work centre', task.work_centre_id ? <span className="inline-flex items-center gap-1.5"><Factory className="h-3.5 w-3.5 text-cyan-600" />{L.wcName(task.work_centre_id)}</span> : '—'],
              ['Created', `${fmtDate(task.created_at.slice(0, 10))}${creator !== '—' ? ` · ${creator}` : ''}`],
              ['Completed', task.completed_at ? fmtDateTime(task.completed_at) : '—'],
            ]}
          />

          {task.labels.length > 0 && (
            <section className="flex flex-wrap items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-ink-faint" />
              {task.labels.map((l) => (
                <span key={l} className="rounded-md bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold text-indigo-600">
                  #{l}
                </span>
              ))}
            </section>
          )}

          <section>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Assignees · {task.assignee_ids.length}</p>
            {task.assignee_ids.length ? (
              <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
                {task.assignee_ids.map((id) => (
                  <div key={id} className="min-w-0 rounded-xl border border-indigo-50 bg-white/70 px-2.5 py-2">
                    <EmployeeCell id={id} size={30} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-ink-faint">
                <UserRound className="h-4 w-4" /> Unassigned
              </p>
            )}
          </section>

          {progress.total > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Checklist</p>
                <span className="num text-[12px] font-semibold text-ink-soft">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <Progress value={progress.done} max={progress.total} tone={progress.done === progress.total ? '#10b981' : undefined} className="mb-3" />
              <ul className="space-y-1">
                {task.checklist.map((c) => (
                  <li key={c.id}>
                    <label className={cn('flex items-start gap-3 rounded-xl px-2 py-1.5 transition-colors', movable && 'cursor-pointer hover:bg-indigo-50/60')}>
                      <CheckBubble checked={c.done} disabled={!movable} label={c.text} size={20} onChange={() => void guard(() => toggleChecklist(task.id, c.id))} className="mt-px" />
                      <span className={cn('min-w-0 break-words text-sm transition-colors', c.done ? 'text-ink-faint line-through decoration-emerald-400/70' : 'text-ink')}>{c.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Comments · {comments.length}</p>
            {comments.length === 0 && <p className="mb-3 text-[13px] text-ink-faint">No comments yet — post an update for the team.</p>}
            <ul className="space-y-3">
              <AnimatePresence initial={false}>
                {comments.map((c) => {
                  const mine = c.author_user_id === s.user.id
                  return (
                    <motion.li key={c.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
                      <Avatar name={c.author_name} size={30} />
                      <div className={cn('group min-w-0 max-w-[85%] rounded-2xl px-3 py-2', mine ? 'rounded-tr-md bg-gradient-to-br from-indigo-500 to-violet-500 text-white' : 'rounded-tl-md bg-slate-100 text-ink')}>
                        <p className={cn('flex items-center gap-2 text-[11.5px] font-semibold', mine ? 'text-white/80' : 'text-ink-soft')}>
                          <span className="truncate">{mine ? 'You' : c.author_name}</span>
                          <span className="shrink-0 font-normal" title={fmtDateTime(c.created_at)}>
                            {relativeTime(c.created_at)}
                          </span>
                          {canDeleteComment(c, s) && (
                            <button type="button" onClick={() => void guard(() => deleteComment(c))} className={cn('ml-auto shrink-0 opacity-60 transition hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100', mine ? 'text-white' : 'text-ink-faint')} aria-label="Delete comment">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </p>
                        <p className="mt-0.5 whitespace-pre-line break-words text-[13.5px] leading-relaxed">{c.body}</p>
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
            <div ref={endRef} />
            <div className="mt-3 flex items-end gap-2 rounded-2xl border border-indigo-100 bg-white p-1.5 focus-within:border-brand-indigo focus-within:ring-4 focus-within:ring-indigo-500/15">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                maxLength={2000}
                placeholder="Write a comment… (Enter to send, Shift+Enter for a new line)"
                aria-label="Comment"
                className="max-h-36 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint [field-sizing:content]"
              />
              <Button size="icon" aria-label="Send comment" disabled={!draft.trim()} loading={sending} onClick={() => void send()}>
                {!sending && <SendHorizontal className="h-4 w-4" />}
              </Button>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Activity</p>
            <ol className="relative space-y-3 border-l-2 border-indigo-50 pl-4">
              {activity.map((a) => (
                <li key={a.key} className="relative">
                  <span className={cn('absolute -left-[27px] top-0 grid h-5 w-5 place-items-center rounded-full ring-4 ring-white', a.tone)}>{a.icon}</span>
                  <p className="text-[13px] text-ink">{a.text}</p>
                  <p className="text-[11.5px] text-ink-faint">{fmtDateTime(a.at)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  )
}
