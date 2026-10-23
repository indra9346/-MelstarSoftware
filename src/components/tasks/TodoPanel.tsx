import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence } from 'framer-motion'
import { CalendarDays, CheckCheck, ListTodo, Plus, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Todo } from '@/data/types'
import { Button, Card, CardHeader, Segmented, guard } from '@/components/ui'
import { useSession } from '@/services/session'
import { addTodo, deleteTodo, todoError, toggleTodo, updateTodo } from '@/services/tasks'
import { addDays, fmtDateShort, todayISO } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { CheckBubble } from './CheckBubble'

type Filter = 'today' | 'upcoming' | 'done'

/** Personal to-do list (todos where user_id = me). */
export function TodoPanel({ className }: { className?: string }) {
  const s = useSession()
  const all = useTable('todos')
  const [filter, setFilter] = useState<Filter>('today')
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  // items stay visible briefly after ticking so the animation can play before they move lists
  const [linger, setLinger] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const t = timers.current
    return () => t.forEach((x) => clearTimeout(x))
  }, [])

  const today = todayISO()
  const mine = useMemo(() => all.filter((t) => t.user_id === s.user.id), [all, s.user.id])
  const buckets = useMemo(() => {
    const open = mine.filter((t) => !t.done)
    const todayList = open.filter((t) => !t.due_date || t.due_date <= today)
    const upcoming = open.filter((t) => t.due_date && t.due_date > today)
    const done = mine.filter((t) => t.done)
    return {
      today: todayList.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.created_at.localeCompare(b.created_at)),
      upcoming: upcoming.sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
      done: done.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }
  }, [mine, today])

  const visible = useMemo(() => {
    const base = buckets[filter]
    const extra = mine.filter((t) => linger.has(t.id) && !base.some((b) => b.id === t.id))
    if (!extra.length) return base
    // keep lingering items where they were (top for simplicity, they leave in a moment)
    return [...extra, ...base]
  }, [buckets, filter, linger, mine])

  const add = (e?: FormEvent) => {
    e?.preventDefault()
    const err = todoError(text, due || null)
    if (err) return setError(err)
    void guard(() => {
      const row = addTodo(text, due || null)
      setText('')
      setError(null)
      if (row.due_date && row.due_date > today && filter === 'today') setFilter('upcoming')
      if (filter === 'done') setFilter(row.due_date && row.due_date > today ? 'upcoming' : 'today')
    })
  }

  const toggle = (t: Todo) => {
    void guard(() => toggleTodo(t.id))
    setLinger((l) => new Set(l).add(t.id))
    clearTimeout(timers.current.get(t.id))
    timers.current.set(
      t.id,
      setTimeout(() => {
        setLinger((l) => {
          const n = new Set(l)
          n.delete(t.id)
          return n
        })
        timers.current.delete(t.id)
      }, 900),
    )
  }

  const quickDates = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'Next week', value: addDays(today, 7) },
  ]

  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader title="My to-dos" subtitle="Private to you" icon={<ListTodo className="h-4 w-4" />} />
      <div className="p-4 sm:p-5">
        <form onSubmit={add} className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-brand-200/70 bg-white p-1.5 pl-3 focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-brand-500/15">
            <input
              value={text}
              maxLength={200}
              onChange={(e) => {
                setText(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Add a to-do…"
              aria-label="New to-do"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <Button type="submit" size="icon-sm" aria-label="Add to-do" disabled={!text.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-ink-faint" />
            {quickDates.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setDue(due === d.value ? '' : d.value)}
                className={cn('rounded-md px-2 py-0.5 text-[11.5px] font-semibold transition', due === d.value ? 'bg-brand-600 text-white' : 'bg-brand-50 text-ink-soft hover:text-ink')}
              >
                {d.label}
              </button>
            ))}
            <input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="h-7 min-w-0 rounded-md border border-line bg-white px-1.5 text-[11.5px] text-ink-soft outline-none focus:border-brand-600" />
          </div>
          {error && <p className="text-[12.5px] font-medium text-rose-600">{error}</p>}
        </form>

        <Segmented<Filter>
          className="mt-4 w-full"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'today', label: `Today · ${buckets.today.length}` },
            { value: 'upcoming', label: `Upcoming · ${buckets.upcoming.length}` },
            { value: 'done', label: `Done · ${buckets.done.length}` },
          ]}
        />

        <ul className="relative mt-3 space-y-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((t) => (
              <TodoRow key={t.id} todo={t} today={today} onToggle={() => toggle(t)} />
            ))}
          </AnimatePresence>
        </ul>
        {!visible.length && (
          <div className="mt-2 flex flex-col items-center rounded-lg border border-dashed border-brand-200 px-4 py-7 text-center">
            {filter === 'done' ? <CheckCheck className="h-6 w-6 text-ink-faint" /> : <ListTodo className="h-6 w-6 text-ink-faint" />}
            <p className="mt-2 text-[13px] font-medium text-ink">{filter === 'today' ? 'All clear for today' : filter === 'upcoming' ? 'Nothing scheduled ahead' : 'Nothing completed yet'}</p>
            <p className="text-[12px] text-ink-soft">{filter === 'done' ? 'Ticked items land here.' : 'Add a to-do above.'}</p>
          </div>
        )}
      </div>
    </Card>
  )
}

// forwardRef so AnimatePresence (popLayout) can measure the row as it leaves
const TodoRow = forwardRef<HTMLLIElement, { todo: Todo; today: string; onToggle: () => void }>(function TodoRow({ todo, today, onToggle }, ref) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(todo.text)
  const overdue = !todo.done && !!todo.due_date && todo.due_date < today
  const save = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== todo.text) void guard(() => updateTodo(todo.id, { text: value }))
    else setValue(todo.text)
  }
  return (
    <li
      ref={ref}
      className={cn('group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-slate-50', todo.done && 'opacity-80')}
    >
      <CheckBubble checked={todo.done} onChange={onToggle} label={todo.done ? `Mark “${todo.text}” not done` : `Mark “${todo.text}” done`} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') {
                setValue(todo.text)
                setEditing(false)
              }
            }}
            className="w-full rounded-md border border-brand-600 bg-white px-2 py-1 text-sm text-ink outline-none"
            aria-label="Edit to-do"
          />
        ) : (
          <button
            type="button"
            onClick={() => !todo.done && setEditing(true)}
            className={cn('relative block max-w-full text-left text-sm', todo.done ? 'cursor-default text-ink-faint' : 'text-ink')}
            title={todo.done ? undefined : 'Click to edit'}
          >
            <span className="break-words">{todo.text}</span>
            <span className="absolute left-0 top-1/2 h-px bg-ink-faint" style={{ width: todo.done ? '100%' : '0%' }} aria-hidden />
          </button>
        )}
        {todo.due_date && (
          <p className={cn('mt-0.5 text-[11.5px] font-medium', overdue ? 'text-rose-600' : todo.due_date === today ? 'text-amber-600' : 'text-ink-faint')}>
            {overdue ? `Overdue · ${fmtDateShort(todo.due_date)}` : todo.due_date === today ? 'Today' : fmtDateShort(todo.due_date)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void guard(() => deleteTodo(todo.id))}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
        aria-label="Delete to-do"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  )
})
