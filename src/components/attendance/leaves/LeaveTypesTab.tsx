/**
 * Leave type master — quota, paid/unpaid, carry forward, half-day, documents, gender.
 */
import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Gender, LeaveType } from '@/data/types'
import { num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { useSession } from '@/services/session'
import { deleteLeaveType, saveLeaveType, validateLeaveType, type LeaveTypeInput } from '@/services/leaves'
import { Badge, Button, confirm, DataTable, Field, Input, Menu, Modal, Select, Switch, toast, type Column } from '@/components/ui'
import { LeaveTypeChip } from '../shared'

const COLORS = ['#2f8f83', '#a0627f', '#2a56a1', '#3a8f5c', '#8c6bb1', '#d08c1e', '#c56a2d', '#94a3b8']
const BLANK: LeaveTypeInput = { code: '', name: '', annual_quota: 0, paid: true, carry_forward: false, max_carry_forward: 0, allow_half_day: true, document_after_days: 0, gender: null, color: '#2a56a1', active: true }

export function LeaveTypesTab() {
  const s = useSession()
  const types = useTable('leave_types')
  const requests = useTable('leave_requests')
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null)
  const manage = s.can('leaves.manage')
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of requests) m.set(r.leave_type_id, (m.get(r.leave_type_id) ?? 0) + 1)
    return m
  }, [requests])
  const rows = [...types].sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code))

  const remove = async (t: LeaveType) => {
    const ok = await confirm({ title: `Delete ${t.code} · ${t.name}?`, message: 'Balances for this type are removed too. Types that have been used can only be deactivated.', danger: true, confirmLabel: 'Delete' })
    if (!ok) return
    try {
      deleteLeaveType(t)
      toast.success(`${t.code} deleted`)
    } catch (e) {
      toast.error('Can’t delete', e instanceof Error ? e.message : String(e))
    }
  }

  const yes = (v: boolean) => (v ? <Badge tone="green">Yes</Badge> : <Badge tone="slate">No</Badge>)
  const columns: Column<LeaveType>[] = [
    {
      key: 'type',
      header: 'Leave type',
      cell: (t) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <LeaveTypeChip type={t} />
          <span className={cn('truncate font-semibold', t.active ? 'text-ink' : 'text-ink-faint line-through')}>{t.name}</span>
        </span>
      ),
      value: (t) => t.code,
      exportValue: (t) => `${t.code} · ${t.name}`,
    },
    { key: 'quota', header: 'Quota / yr', align: 'right', value: (t) => t.annual_quota, cell: (t) => (t.code === 'LOP' ? <span className="text-ink-faint">No limit</span> : <span className="num font-semibold">{num(t.annual_quota)}</span>) },
    { key: 'paid', header: 'Paid', cell: (t) => yes(t.paid), value: (t) => (t.paid ? 'Yes' : 'No') },
    { key: 'cf', header: 'Carry forward', cell: (t) => (t.carry_forward ? <Badge tone="indigo">Up to {num(t.max_carry_forward)}</Badge> : <Badge tone="slate">No</Badge>), value: (t) => (t.carry_forward ? `Up to ${t.max_carry_forward}` : 'No') },
    { key: 'half', header: 'Half day', cell: (t) => yes(t.allow_half_day), value: (t) => (t.allow_half_day ? 'Yes' : 'No'), hideOnMobile: true },
    { key: 'doc', header: 'Document', cell: (t) => (t.document_after_days > 0 ? `After ${t.document_after_days} d` : <span className="text-ink-faint">—</span>), value: (t) => t.document_after_days, hideOnMobile: true },
    { key: 'gender', header: 'For', value: (t) => (t.gender ? t.gender[0]!.toUpperCase() + t.gender.slice(1) : 'All'), hideOnMobile: true },
    { key: 'used', header: 'Requests', align: 'right', value: (t) => usage.get(t.id) ?? 0, hideOnMobile: true },
    { key: 'active', header: 'Status', cell: (t) => (t.active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="slate" dot>Inactive</Badge>), value: (t) => (t.active ? 'Active' : 'Inactive') },
    ...(manage
      ? [
          {
            key: 'act',
            header: '',
            export: false,
            sortable: false,
            cell: (t: LeaveType) => (
              <Menu
                items={[
                  { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(t) },
                  { label: 'Delete', icon: <Trash2 />, danger: true, disabled: (usage.get(t.id) ?? 0) > 0, onClick: () => void remove(t) },
                ]}
              />
            ),
          } satisfies Column<LeaveType>,
        ]
      : []),
  ]

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(t) => t.id}
        exportName="leave-types"
        onRowClick={manage ? (t) => setEditing(t) : undefined}
        toolbar={
          manage ? (
            <Button size="sm" className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              New leave type
            </Button>
          ) : undefined
        }
      />
      <LeaveTypeModal editing={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function LeaveTypeModal({ editing, onClose }: { editing: LeaveType | 'new' | null; onClose: () => void }) {
  const [f, setF] = useState<LeaveTypeInput>(BLANK)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!editing) return
    if (editing === 'new') setF(BLANK)
    else
      setF({
        code: editing.code, name: editing.name, annual_quota: editing.annual_quota, paid: editing.paid, carry_forward: editing.carry_forward, max_carry_forward: editing.max_carry_forward,
        allow_half_day: editing.allow_half_day, document_after_days: editing.document_after_days, gender: editing.gender, color: editing.color, active: editing.active,
      })
    setTouched(new Set())
  }, [editing])
  const errors = validateLeaveType(f, editing && editing !== 'new' ? editing.id : undefined)
  const ok = Object.keys(errors).length === 0
  const set = <K extends keyof LeaveTypeInput>(k: K, v: LeaveTypeInput[K]) => {
    setF((p) => ({ ...p, [k]: v }))
    setTouched((t) => new Set(t).add(k))
  }
  const err = (k: keyof LeaveTypeInput) => (touched.has(k) ? errors[k] : undefined)
  const numVal = (n: number) => (Number.isFinite(n) ? n : '')
  const toNum = (s: string) => (s === '' ? NaN : Number(s))

  const save = () => {
    setTouched(new Set(Object.keys(BLANK)))
    if (!ok) return
    try {
      const row = saveLeaveType(f, editing && editing !== 'new' ? editing : undefined)
      toast.success(editing === 'new' ? `${row.code} created` : `${row.code} updated`)
      onClose()
    } catch (e) {
      toast.error('Could not save', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      title={editing === 'new' ? 'New leave type' : `Edit ${editing ? (editing as LeaveType).code : ''}`}
      subtitle="Quota changes apply to balances that aren’t set explicitly; use Balances to adjust individuals."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ok}>
            {editing === 'new' ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <Field label="Code" required error={err('code')}>
            <Input value={f.code} maxLength={6} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="CL" invalid={!!err('code')} />
          </Field>
          <Field label="Name" required error={err('name')}>
            <Input value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="Casual Leave" invalid={!!err('name')} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-3">
          <Field label="Annual quota" required error={err('annual_quota')} hint="Days per FY">
            <Input type="number" min={0} step={0.5} value={numVal(f.annual_quota)} onChange={(e) => set('annual_quota', toNum(e.target.value))} invalid={!!err('annual_quota')} />
          </Field>
          <Field label="Document after" error={err('document_after_days')} hint="Days · 0 = never">
            <Input type="number" min={0} step={1} value={numVal(f.document_after_days)} onChange={(e) => set('document_after_days', toNum(e.target.value))} invalid={!!err('document_after_days')} />
          </Field>
          <Field label="Applies to" error={err('gender')}>
            <Select
              value={f.gender ?? ''}
              onChange={(e) => set('gender', (e.target.value || null) as Gender | null)}
              options={[
                { value: '', label: 'Everyone' },
                { value: 'female', label: 'Women' },
                { value: 'male', label: 'Men' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-white p-3.5 sm:grid-cols-2">
          <Switch checked={f.paid} onChange={(v) => set('paid', v)} label="Paid leave" description={f.paid ? 'Counts as paid days in payroll' : 'Deducted as loss of pay'} />
          <Switch checked={f.allow_half_day} onChange={(v) => set('allow_half_day', v)} label="Allow half day" description="First or second half" />
          <Switch checked={f.carry_forward} onChange={(v) => set('carry_forward', v)} label="Carry forward" description="Unused days roll into next FY" />
          <Switch checked={f.active} onChange={(v) => set('active', v)} label="Active" description="Inactive types can’t be applied for" />
        </div>
        {f.carry_forward && (
          <Field label="Max carry forward" required error={err('max_carry_forward')} hint="Days that can roll over at year end">
            <Input type="number" min={0} step={0.5} value={numVal(f.max_carry_forward)} onChange={(e) => set('max_carry_forward', toNum(e.target.value))} invalid={!!err('max_carry_forward')} />
          </Field>
        )}
        <Field label="Colour" error={err('color')}>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set('color', c)} aria-label={`Colour ${c}`} className={cn('h-8 w-8 rounded-full ring-offset-2 transition', f.color === c && 'ring-2 ring-ink')} style={{ background: c }} />
            ))}
            <input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} className="h-8 w-10 cursor-pointer rounded-md border border-line bg-white" aria-label="Custom colour" />
            <LeaveTypeChip type={{ code: f.code || 'XX', name: f.name, color: f.color }} className="ml-2" />
          </div>
        </Field>
      </div>
    </Modal>
  )
}
