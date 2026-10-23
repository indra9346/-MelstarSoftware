import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, ListChecks, Plus, Search, X } from 'lucide-react'
import { useTable } from '@/data/store'
import type { ChecklistItem, Priority, Task, TaskStatus } from '@/data/types'
import { Avatar, Button, Field, Input, Modal, Segmented, Select, Textarea, toast } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { PRIORITIES, PRIORITY_META, STATUS_META, createTask, taskErrors, updateTask, type TaskInput } from '@/services/tasks'
import { todayISO } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { uuid } from '@/lib/ids'
import { cn } from '@/lib/misc'

const PRIORITY_DOT: Record<Priority, string> = { low: 'bg-slate-400', medium: 'bg-sky-500', high: 'bg-amber-500', urgent: 'bg-rose-500' }

function fromTask(t: Task | null | undefined): TaskInput {
  return t
    ? { title: t.title, description: t.description, priority: t.priority, assignee_ids: [...t.assignee_ids], due_date: t.due_date, labels: [...t.labels], work_centre_id: t.work_centre_id, checklist: t.checklist.map((c) => ({ ...c })) }
    : { title: '', description: '', priority: 'medium', assignee_ids: [], due_date: null, labels: [], work_centre_id: null, checklist: [] }
}

/** Create / edit a task (tasks.manage). */
export function TaskForm({ open, onClose, task, initialStatus = 'todo', onSaved }: { open: boolean; onClose: () => void; task?: Task | null; initialStatus?: TaskStatus; onSaved?: (t: Task) => void }) {
  const L = useLookups()
  const allTasks = useTable('tasks')
  const [v, setV] = useState<TaskInput>(() => fromTask(task))
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setV(fromTask(task))
    setSubmitted(false)
    setTouched(new Set())
  }, [open, task])

  const errors = useMemo(() => taskErrors(v, task), [v, task])
  const show = (k: keyof TaskInput) => (submitted || touched.has(k) ? errors[k] : undefined)
  const touch = (k: string) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))
  const set = <K extends keyof TaskInput>(k: K, val: TaskInput[K]) => setV((p) => ({ ...p, [k]: val }))
  const valid = !Object.keys(errors).length

  const knownLabels = useMemo(() => {
    const count = new Map<string, number>()
    for (const t of allTasks) for (const l of t.labels) count.set(l, (count.get(l) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l)
  }, [allTasks])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (!valid) return
    try {
      const row = task ? updateTask(task.id, v) : createTask(v, initialStatus)
      toast.success(task ? 'Task updated' : `Task ${row.task_no} created`, task ? row.title : `Assigned to ${row.assignee_ids.map((id) => L.empName(id)).join(', ')}`)
      onSaved?.(row)
      onClose()
    } catch (err) {
      toast.error('Could not save the task', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={task ? `Edit ${task.task_no}` : 'New task'}
      subtitle={task ? 'Assignees are notified when they are added.' : `Goes to “${STATUS_META[initialStatus].label}”. Assignees get a notification.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} disabled={submitted && !valid}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Title" required error={show('title')} className="sm:col-span-2">
          <Input value={v.title} maxLength={140} onChange={(e) => set('title', e.target.value)} onBlur={() => touch('title')} placeholder="e.g. First-article inspection — end caps WO-1042" invalid={!!show('title')} />
        </Field>
        <Field label="Description" error={show('description')} className="sm:col-span-2">
          <Textarea value={v.description} rows={3} maxLength={4000} onChange={(e) => set('description', e.target.value)} onBlur={() => touch('description')} placeholder="What needs to be done, acceptance criteria, references…" />
        </Field>
        <Field label="Priority" required error={show('priority')} className="sm:col-span-2">
          <Segmented<Priority>
            value={v.priority}
            onChange={(p) => set('priority', p)}
            options={PRIORITIES.map((p) => ({
              value: p,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', PRIORITY_DOT[p])} />
                  {PRIORITY_META[p].label}
                </span>
              ),
            }))}
          />
        </Field>
        <Field label="Due date" error={show('due_date')} hint={v.due_date ? undefined : 'Optional'}>
          <Input type="date" value={v.due_date ?? ''} min={todayISO()} onChange={(e) => set('due_date', e.target.value || null)} onBlur={() => touch('due_date')} invalid={!!show('due_date')} />
        </Field>
        <Field label="Work centre" hint="Optional">
          <Select value={v.work_centre_id ?? ''} onChange={(e) => set('work_centre_id', e.target.value || null)} options={[...L.wc.values()].sort((a, b) => a.name.localeCompare(b.name)).map((w) => ({ value: w.id, label: w.name }))} placeholder="None" />
        </Field>
        <Field label="Assignees" required error={show('assignee_ids')} className="sm:col-span-2">
          <AssigneePicker value={v.assignee_ids} onChange={(ids) => {
              set('assignee_ids', ids)
              touch('assignee_ids')
            }} invalid={!!show('assignee_ids')} />
        </Field>
        <Field label="Labels" error={show('labels')} hint="Enter or comma to add · e.g. quality, customer, 5S" className="sm:col-span-2">
          <LabelInput value={v.labels} onChange={(l) => set('labels', l)} suggestions={knownLabels} />
        </Field>
        <Field label="Checklist" error={show('checklist')} className="sm:col-span-2">
          <ChecklistEditor value={v.checklist} onChange={(c) => set('checklist', c)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

/* ── assignee multi-select ─────────────────────────────────────────────── */

function AssigneePicker({ value, onChange, invalid }: { value: string[]; onChange: (ids: string[]) => void; invalid?: boolean }) {
  const L = useLookups()
  const [q, setQ] = useState('')
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return L.employees
      .filter((e) => e.status !== 'exited' || value.includes(e.id))
      .filter((e) => !needle || `${fullName(e)} ${e.emp_code} ${L.desigTitle(e.designation_id)} ${L.deptName(e.department_id)}`.toLowerCase().includes(needle))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
  }, [L, q, value])
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  return (
    <div className={cn('rounded-lg border bg-white p-2', invalid ? 'border-rose-400' : 'border-brand-200/70')}>
      <div className="flex min-h-[32px] flex-wrap gap-1.5 px-1 pb-2">
          {value.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-1.5 text-[12.5px] font-medium text-brand-700">
              <Avatar name={L.empName(id)} src={L.emp.get(id)?.photo} size={22} />
              <span className="truncate">{L.empName(id)}</span>
              <button type="button" onClick={() => toggle(id)} className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-brand-100" aria-label={`Remove ${L.empName(id)}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        {!value.length && <span className="py-1 text-[12.5px] text-ink-faint">No one selected yet</span>}
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="h-4 w-4" />} placeholder="Search people, code, department…" className="h-10 py-0 text-sm" aria-label="Search employees" />
      <ul className="mt-1.5 max-h-52 overflow-y-auto overscroll-contain scroll-thin" role="listbox" aria-multiselectable>
        {people.map((e) => {
          const on = value.includes(e.id)
          return (
            <li key={e.id}>
              <button type="button" role="option" aria-selected={on} onClick={() => toggle(e.id)} className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors', on ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                <Avatar name={fullName(e)} src={e.photo} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{fullName(e)}</span>
                  <span className="block truncate text-[11.5px] text-ink-soft">
                    {e.emp_code} · {L.desigTitle(e.designation_id)}
                  </span>
                </span>
                <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-white')}>{on && <Check className="h-3.5 w-3.5" />}</span>
              </button>
            </li>
          )
        })}
        {!people.length && <li className="px-2 py-3 text-center text-[12.5px] text-ink-faint">No one matches “{q}”.</li>}
      </ul>
    </div>
  )
}

/* ── label chips ─────────────────────────────────────────────────────────── */

function LabelInput({ value, onChange, suggestions }: { value: string[]; onChange: (l: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const l = raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24)
    if (!l) return
    if (!value.some((x) => x.toLowerCase() === l.toLowerCase())) onChange([...value, l])
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  const sugg = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase()) && (!text || s.toLowerCase().includes(text.toLowerCase()))).slice(0, 8)
  return (
    <div>
      <div className="field-input flex min-h-[46px] flex-wrap items-center gap-1.5 py-1.5">
        {value.map((l) => (
          <span key={l} className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-0.5 pl-2 pr-1 text-[12.5px] font-medium text-brand-700">
            #{l}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== l))} className="grid h-4 w-4 place-items-center rounded hover:bg-brand-100" aria-label={`Remove label ${l}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setText(e.target.value))}
          onKeyDown={onKey}
          onBlur={() => text.trim() && add(text)}
          placeholder={value.length ? '' : 'Add a label…'}
          className="min-w-[90px] flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-faint"
          aria-label="Add label"
          maxLength={24}
        />
      </div>
      {sugg.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {sugg.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-md border border-dashed border-brand-200 px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-soft transition hover:border-brand-600 hover:text-brand-600">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── checklist editor ────────────────────────────────────────────────────── */

function ChecklistEditor({ value, onChange }: { value: ChecklistItem[]; onChange: (c: ChecklistItem[]) => void }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const add = () => {
    const t = text.trim()
    if (!t) return
    onChange([...value, { id: uuid(), text: t.slice(0, 200), done: false }])
    setText('')
    inputRef.current?.focus()
  }
  return (
    <div className="rounded-lg border border-brand-200/70 bg-white p-2">
      <ul className="space-y-1">
          {value.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold', c.done ? 'bg-emerald-500 text-white' : 'bg-brand-50 text-brand-600')}>{c.done ? <Check className="h-3 w-3" /> : i + 1}</span>
              <input
                value={c.text}
                maxLength={200}
                onChange={(e) => onChange(value.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))}
                className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 text-sm text-ink outline-none hover:bg-slate-50 focus:bg-slate-50"
                aria-label={`Checklist item ${i + 1}`}
              />
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== c.id))} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-rose-50 hover:text-rose-600" aria-label="Remove item">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
      </ul>
      <div className={cn('flex items-center gap-2', value.length > 0 && 'mt-1.5 border-t border-line pt-1.5')}>
        <ListChecks className="ml-1 h-4 w-4 shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Add a checklist item and press Enter"
          className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
          aria-label="New checklist item"
        />
        <Button size="icon-sm" variant="ghost" onClick={add} disabled={!text.trim()} aria-label="Add checklist item">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
