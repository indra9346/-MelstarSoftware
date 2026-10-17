import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCenter, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type PointerSensorOptions, type TouchSensorOptions,
} from '@dnd-kit/core'
import { ArrowRight, Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Task, TaskStatus } from '@/data/types'
import { guard, toast, type MenuItem } from '@/components/ui'
import { useSession } from '@/services/session'
import { STATUS_META, TASK_STATUSES, canMoveTask, isOverdue, moveTask, sortTasks } from '@/services/tasks'
import { addDays, todayISO } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { TaskCard } from './TaskCard'

/* ── sensors: mouse/pen drag after a few px; touch needs a ~200 ms press so phones still scroll ── */

const NO_DRAG = 'button, a, input, textarea, select, [role="checkbox"], [data-no-dnd]'
const fromControl = (t: EventTarget | null) => t instanceof Element && !!t.closest(NO_DRAG)

class BoardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch' || fromControl(event.target)) return false
        onActivation?.({ event })
        return true
      },
    },
  ]
}

class BoardTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent: event }: ReactTouchEvent, { onActivation }: TouchSensorOptions) => {
        if (event.touches.length > 1 || fromControl(event.target)) return false
        onActivation?.({ event })
        return true
      },
    },
  ]
}

/**
 * Prefer the card under the pointer. In a column's empty space or the gap between cards, snap to the
 * nearest card of that column (so the drop lands where the user aimed), else the column itself.
 */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const cards = hits.filter((h) => !String(h.id).startsWith('col:'))
  if (cards.length) return cards
  const col = hits.find((h) => String(h.id).startsWith('col:'))
  if (col) {
    const status = String(col.id).slice(4)
    const inColumn = args.droppableContainers.filter((c) => {
      const d = c.data.current as DropData | undefined
      return d?.type === 'card' && d.status === status && c.id !== args.active.id
    })
    if (inColumn.length) {
      const near = closestCenter({ ...args, droppableContainers: inColumn })
      if (near.length) return near.slice(0, 1)
    }
    return [col]
  }
  return rectIntersection(args)
}

type DropData = { type: 'card' | 'column'; status: TaskStatus }
interface Target {
  status: TaskStatus
  cardId: string | null
  place: 'before' | 'after'
}

function resolveTarget(e: DragOverEvent | DragEndEvent): Target | null {
  const o = e.over
  const data = o?.data.current as DropData | undefined
  if (!o || !data) return null
  if (data.type === 'column') return { status: data.status, cardId: null, place: 'after' }
  const r = e.active.rect.current.translated
  const mid = r ? r.top + r.height / 2 : o.rect.top
  return { status: data.status, cardId: String(o.id), place: mid < o.rect.top + o.rect.height / 2 ? 'before' : 'after' }
}

export interface TaskBoardProps {
  tasks: readonly Task[]
  onOpen: (t: Task) => void
  onEdit?: (t: Task) => void
  onDelete?: (t: Task) => void
  /** Show a quick "+" in each column header. */
  onAdd?: (status: TaskStatus) => void
  /** Done column shows tasks completed in the last N days (older ones behind a button). */
  doneWindowDays?: number
  emptyText?: string
}

/** Kanban: To do · In progress · Review · Done. Drag between columns and reorder within one. */
export function TaskBoard({ tasks, onOpen, onEdit, onDelete, onAdd, doneWindowDays = 30, emptyText }: TaskBoardProps) {
  const s = useSession()
  const comments = useTable('task_comments')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [showOldDone, setShowOldDone] = useState(false)
  const lastDrop = useRef(0)

  const sensors = useSensors(
    useSensor(BoardPointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(BoardTouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const commentCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of comments) m.set(c.task_id, (m.get(c.task_id) ?? 0) + 1)
    return m
  }, [comments])

  const cutoff = addDays(todayISO(), -doneWindowDays)
  const columns = useMemo(() => {
    const out = {} as Record<TaskStatus, { all: Task[]; shown: Task[]; hidden: number }>
    for (const st of TASK_STATUSES) {
      const all = sortTasks(tasks.filter((t) => t.status === st))
      const shown = st === 'done' && !showOldDone ? all.filter((t) => !t.completed_at || t.completed_at.slice(0, 10) >= cutoff) : all
      out[st] = { all, shown, hidden: all.length - shown.length }
    }
    return out
  }, [tasks, showOldDone, cutoff])

  const active = activeId ? tasks.find((t) => t.id === activeId) ?? null : null

  const move = useCallback(
    (t: Task, status: TaskStatus, beforeId: string | number | null) => {
      void guard(() => {
        const row = moveTask(t.id, status, beforeId, tasks)
        if (row.status === 'done' && t.status !== 'done') toast.success(`${t.task_no} done`, t.title)
      })
    },
    [tasks],
  )

  const open = (t: Task) => {
    if (Date.now() - lastDrop.current < 250) return
    onOpen(t)
  }

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
    setTarget(null)
  }
  const onDragOver = (e: DragOverEvent) => {
    const next = resolveTarget(e)
    setTarget((cur) => (cur?.status === next?.status && cur?.cardId === next?.cardId && cur?.place === next?.place ? cur : next))
  }
  const onDragEnd = (e: DragEndEvent) => {
    lastDrop.current = Date.now()
    const t = active
    const to = resolveTarget(e)
    setActiveId(null)
    setTarget(null)
    if (!t || !to || to.cardId === t.id) return
    let beforeId: string | null = null
    if (to.cardId) {
      if (to.place === 'before') beforeId = to.cardId
      else {
        const col = columns[to.status].all.filter((x) => x.id !== t.id)
        const i = col.findIndex((x) => x.id === to.cardId)
        beforeId = col[i + 1]?.id ?? null
      }
    }
    move(t, to.status, beforeId)
  }

  const menuFor = (t: Task, movable: boolean): MenuItem[] => {
    const items: MenuItem[] = [{ label: 'Open', icon: <Eye />, onClick: () => onOpen(t) }]
    if (movable) for (const st of TASK_STATUSES) if (st !== t.status) items.push({ label: `Move to ${STATUS_META[st].label}`, icon: <ArrowRight />, onClick: () => move(t, st, 0) })
    if (onEdit) items.push({ label: 'Edit', icon: <Pencil />, onClick: () => onEdit(t) })
    if (onDelete) items.push({ label: 'Delete', icon: <Trash2 />, onClick: () => onDelete(t), danger: true })
    return items
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragMove={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setTarget(null)
      }}
    >
      <div
        className={cn(
          '-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 scroll-thin sm:-mx-0 sm:px-0 lg:grid lg:snap-none lg:grid-cols-4 lg:overflow-visible lg:pb-0',
          // snapping would fight auto-scroll while a card is being dragged
          activeId ? 'snap-none' : 'snap-x snap-mandatory',
        )}
      >
        {TASK_STATUSES.map((st) => (
          <Column
            key={st}
            status={st}
            count={columns[st].all.length}
            overdue={columns[st].all.filter((t) => isOverdue(t)).length}
            highlight={!!activeId && target?.status === st}
            onAdd={onAdd}
            footer={
              st === 'done' && (columns.done.hidden > 0 || showOldDone) && columns.done.all.length > 0 ? (
                <button type="button" onClick={() => setShowOldDone((v) => !v)} className="w-full rounded-xl py-2 text-[12px] font-semibold text-brand-indigo hover:bg-white/80">
                  {showOldDone ? `Hide tasks done before the last ${doneWindowDays} days` : `Show ${columns.done.hidden} older done`}
                </button>
              ) : null
            }
            empty={!columns[st].shown.length}
            emptyText={st === 'todo' && emptyText ? emptyText : undefined}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {columns[st].shown.map((t) => {
                const movable = canMoveTask(t, s)
                return (
                  <motion.div
                    key={t.id}
                    layout="position"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                    transition={{ type: 'spring', stiffness: 520, damping: 42 }}
                  >
                    <DraggableCard
                      task={t}
                      movable={movable}
                      comments={commentCount.get(t.id) ?? 0}
                      menu={menuFor(t, movable)}
                      indicator={activeId && activeId !== t.id && target?.cardId === t.id ? target.place : null}
                      onOpen={() => open(t)}
                    />
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null} zIndex={80}>
        {active ? <TaskCard task={active} comments={commentCount.get(active.id) ?? 0} lifted className="cursor-grabbing" /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  status, count, overdue, highlight, onAdd, children, footer, empty, emptyText,
}: {
  status: TaskStatus
  count: number
  overdue: number
  highlight: boolean
  onAdd?: (s: TaskStatus) => void
  children: React.ReactNode
  footer?: React.ReactNode
  empty: boolean
  emptyText?: string
}) {
  const meta = STATUS_META[status]
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { type: 'column', status } satisfies DropData })
  return (
    <section
      className={cn(
        'flex w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-[22px] border p-2.5 transition-colors duration-200 sm:w-[300px] lg:w-auto lg:min-w-0 lg:max-w-none',
        highlight || isOver ? 'border-brand-indigo/40 bg-indigo-50/80' : 'border-white/80 bg-white/50',
      )}
      aria-label={`${meta.label} column`}
    >
      <header className="mb-2 flex items-center gap-2 px-1.5 pt-0.5">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} />
        <h3 className="min-w-0 truncate text-[13.5px] font-semibold text-ink">{meta.label}</h3>
        <motion.span key={count} initial={{ scale: 0.7 }} animate={{ scale: 1 }} className="num rounded-full bg-white px-2 py-px text-[11.5px] font-bold text-ink-soft shadow-sm">
          {count}
        </motion.span>
        {overdue > 0 && <span className="num rounded-full bg-rose-50 px-1.5 py-px text-[10.5px] font-bold text-rose-600">{overdue} late</span>}
        {onAdd && status !== 'done' && (
          <button type="button" onClick={() => onAdd(status)} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-ink-soft transition hover:bg-white hover:text-brand-indigo" aria-label={`Add task to ${meta.label}`}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>
      <div className={cn('mb-2 h-[3px] rounded-full bg-gradient-to-r', meta.bar)} />
      <div ref={setNodeRef} className="relative flex min-h-[140px] flex-1 flex-col gap-2 rounded-2xl">
        {children}
        {empty && (
          <div className={cn('grid flex-1 place-items-center rounded-2xl border-2 border-dashed px-3 py-8 text-center text-[12px] font-medium transition-colors', highlight || isOver ? 'border-brand-indigo/40 text-brand-indigo' : 'border-indigo-100 text-ink-faint')}>
            {highlight || isOver ? 'Drop here' : emptyText ?? 'Nothing here'}
          </div>
        )}
        {footer}
      </div>
    </section>
  )
}

function DraggableCard({ task, movable, comments, menu, indicator, onOpen }: { task: Task; movable: boolean; comments: number; menu: MenuItem[]; indicator: 'before' | 'after' | null; onOpen: () => void }) {
  const drag = useDraggable({ id: task.id, data: { type: 'card', status: task.status } satisfies DropData, disabled: !movable })
  const drop = useDroppable({ id: task.id, data: { type: 'card', status: task.status } satisfies DropData })
  const { setNodeRef: setDrag } = drag
  const { setNodeRef: setDrop } = drop
  const ref = useCallback(
    (el: HTMLElement | null) => {
      setDrag(el)
      setDrop(el)
    },
    [setDrag, setDrop],
  )
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }
  return (
    <div
      ref={ref}
      {...drag.attributes}
      {...drag.listeners}
      role="button"
      tabIndex={0}
      aria-roledescription={movable ? 'draggable task' : 'task'}
      aria-label={`${task.task_no} ${task.title}`}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={cn(
        'relative select-none rounded-2xl outline-none [-webkit-touch-callout:none] focus-visible:ring-4 focus-visible:ring-indigo-500/25',
        movable ? 'cursor-grab touch-manipulation active:cursor-grabbing' : 'cursor-pointer',
        drag.isDragging && 'opacity-35',
      )}
    >
      {indicator && <span className={cn('pointer-events-none absolute inset-x-1 z-10 h-[3px] rounded-full bg-grad shadow-[0_0_10px_rgba(99,102,241,.6)]', indicator === 'before' ? '-top-[6px]' : '-bottom-[6px]')} aria-hidden />}
      <TaskCard task={task} comments={comments} menu={menu} dragHandle={movable} />
    </div>
  )
}
