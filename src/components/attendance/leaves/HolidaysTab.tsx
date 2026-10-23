/**
 * Plant holiday list. National / festival / company holidays close the plant (attendance shows H,
 * leave days skip them); optional holidays are not closures.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarPlus, Info, Pencil, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Holiday, HolidayType } from '@/data/types'
import { diffDays, fmtDay, fmtMonth, monthOf, WEEKDAYS_LONG, dayOfWeek } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { useSession } from '@/services/session'
import { payrollLock } from '@/services/attendance'
import { deleteHoliday, HOLIDAY_TYPES, saveHoliday, validateHoliday, type HolidayInput } from '@/services/leaves'
import { Badge, Button, confirm, EmptyState, Field, Input, Menu, Modal, Select, Textarea, toast, type Tone } from '@/components/ui'
import { useToday } from '../shared'

const TYPE_TONE: Record<HolidayType, Tone> = { national: 'indigo', festival: 'pink', company: 'cyan', optional: 'slate' }

export function HolidaysTab() {
  const s = useSession()
  const today = useToday()
  const holidays = useTable('holidays')
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)
  const manage = s.can('leaves.manage')

  const years = useMemo(() => [...new Set([thisYear, thisYear + 1, ...holidays.map((h) => Number(h.date.slice(0, 4)))])].sort((a, b) => b - a), [holidays, thisYear])
  const list = useMemo(() => holidays.filter((h) => h.date.startsWith(String(year))).sort((a, b) => a.date.localeCompare(b.date)), [holidays, year])
  const nextId = useMemo(() => [...holidays].filter((h) => h.date >= today && h.type !== 'optional').sort((a, b) => a.date.localeCompare(b.date))[0]?.id, [holidays, today])
  const closures = list.filter((h) => h.type !== 'optional').length

  const remove = async (h: Holiday) => {
    const lock = payrollLock(monthOf(h.date))
    const ok = await confirm({
      title: `Delete ${h.name}?`,
      message: `${fmtDay(h.date)} will become a normal working day — anyone without a punch that day will show absent.${lock ? ` Payroll for ${fmtMonth(lock.month)} is already ${lock.status}; issued payslips won’t change.` : ''}`,
      danger: true,
      confirmLabel: 'Delete holiday',
    })
    if (!ok) return
    try {
      deleteHoliday(h)
      toast.success('Holiday deleted')
    } catch (e) {
      toast.error('Could not delete', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={years.map((y) => ({ value: String(y), label: String(y) }))} className="h-10 w-auto min-w-[110px] py-0 text-sm" aria-label="Year" />
        <span className="text-[13px] text-ink-soft">
          {list.length} holiday{list.length === 1 ? '' : 's'} · {closures} plant closure{closures === 1 ? '' : 's'}
        </span>
        {manage && (
          <Button size="sm" className="ml-auto" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add holiday
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <p className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2.5 text-[12.5px] text-brand-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> Optional holidays are not plant closures — employees who take one apply for leave.
        </p>
        <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Adding, moving or deleting a holiday changes attendance, leave day counts and payroll for months not yet paid.
        </p>
      </div>

      {!list.length ? (
        <EmptyState title={`No holidays for ${year}`} description={manage ? 'Add the plant holiday list for the year.' : undefined} />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {list.map((h) => {
            const days = diffDays(today, h.date)
            const upcoming = days >= 0
            const next = h.id === nextId
            return (
              <li
                key={h.id}
                className={cn('card flex min-w-0 items-center gap-3 p-3', !upcoming && 'opacity-60', next && 'ring-2 ring-brand-600/40')}
              >
                <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-md text-center leading-none', upcoming ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft')}>
                  <span>
                    <span className="num block text-[17px] font-semibold">{Number(h.date.slice(8))}</span>
                    <span className="block text-[9.5px] font-semibold uppercase">{fmtMonth(h.date.slice(0, 7), true).slice(0, 3)}</span>
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{h.name}</p>
                  <p className="truncate text-[12px] text-ink-soft">
                    {WEEKDAYS_LONG[dayOfWeek(h.date)]}
                    {h.description ? ` · ${h.description}` : ''}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={TYPE_TONE[h.type]}>{h.type === 'optional' ? 'Optional · not a closure' : h.type[0]!.toUpperCase() + h.type.slice(1)}</Badge>
                    {next && <Badge tone="indigo" dot>Next holiday</Badge>}
                    {upcoming && <Badge tone="slate">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days} days`}</Badge>}
                  </div>
                </div>
                {manage && (
                  <Menu
                    items={[
                      { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(h) },
                      { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => void remove(h) },
                    ]}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <HolidayModal editing={editing} onClose={() => setEditing(null)} defaultYear={year} />
    </div>
  )
}

function HolidayModal({ editing, onClose, defaultYear }: { editing: Holiday | 'new' | null; onClose: () => void; defaultYear: number }) {
  const today = useToday()
  const attendance = useTable('attendance')
  const [f, setF] = useState<HolidayInput>({ date: '', name: '', type: 'festival', description: '' })
  const [touched, setTouched] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!editing) return
    if (editing === 'new') setF({ date: String(defaultYear) === today.slice(0, 4) ? today : `${defaultYear}-01-01`, name: '', type: 'festival', description: '' })
    else setF({ date: editing.date, name: editing.name, type: editing.type, description: editing.description })
    setTouched(new Set())
  }, [editing, defaultYear, today])
  const errors = validateHoliday(f, editing && editing !== 'new' ? editing.id : undefined)
  const ok = Object.keys(errors).length === 0
  const set = <K extends keyof HolidayInput>(k: K, v: HolidayInput[K]) => {
    setF((p) => ({ ...p, [k]: v }))
    setTouched((t) => new Set(t).add(k))
  }
  const err = (k: keyof HolidayInput) => (touched.has(k) ? errors[k] : undefined)
  const lock = f.date ? payrollLock(monthOf(f.date)) : undefined
  const punches = f.date && f.type !== 'optional' ? attendance.filter((a) => a.date === f.date && a.check_in).length : 0

  const save = () => {
    setTouched(new Set(['date', 'name', 'type', 'description']))
    if (!ok) return
    try {
      saveHoliday(f, editing && editing !== 'new' ? editing : undefined)
      toast.success(editing === 'new' ? 'Holiday added' : 'Holiday updated', `${f.name.trim()} · ${fmtDay(f.date)}`)
      onClose()
    } catch (e) {
      toast.error('Could not save', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      size="sm"
      title={editing === 'new' ? 'Add holiday' : 'Edit holiday'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ok}>
            {editing === 'new' ? 'Add holiday' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Date" required error={err('date')} hint={f.date ? WEEKDAYS_LONG[dayOfWeek(f.date)] : undefined}>
          <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} invalid={!!err('date')} />
        </Field>
        <Field label="Name" required error={err('name')}>
          <Input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Kannada Rajyotsava" invalid={!!err('name')} />
        </Field>
        <Field label="Type" required error={err('type')} hint={f.type === 'optional' ? 'Optional holidays are not plant closures.' : 'The plant is closed — attendance shows H and leave skips this day.'}>
          <Select value={f.type} onChange={(e) => set('type', e.target.value as HolidayType)} options={HOLIDAY_TYPES} />
        </Field>
        <Field label="Description" error={err('description')}>
          <Textarea value={f.description} maxLength={200} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="e.g. Karnataka State holiday" />
        </Field>
        {lock && (
          <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Payroll for {fmtMonth(lock.month)} is already {lock.status} — issued payslips won’t change.
          </p>
        )}
        {punches > 0 && <p className="text-[12.5px] text-ink-soft">{punches} employee{punches === 1 ? '' : 's'} punched on this date — their attendance records still count as worked days.</p>}
      </div>
    </Modal>
  )
}
