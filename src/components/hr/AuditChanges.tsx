import { ArrowRight } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui'
import { db } from '@/data/store'
import type { AuditAction, AuditLog } from '@/data/types'
import { fullName, titleCase } from '@/lib/format'

export const AUDIT_ACTIONS: AuditAction[] = ['create', 'update', 'delete', 'approve', 'reject', 'cancel', 'login', 'logout', 'export', 'process', 'pay', 'check_in', 'check_out', 'reset']

export const ACTION_TONES: Record<AuditAction, Tone> = {
  create: 'green', update: 'sky', delete: 'red', approve: 'green', reject: 'red', cancel: 'slate', login: 'cyan', logout: 'slate',
  export: 'violet', process: 'indigo', pay: 'indigo', check_in: 'green', check_out: 'amber', reset: 'pink',
}

export function ActionBadge({ action }: { action: AuditAction }) {
  return (
    <Badge tone={ACTION_TONES[action] ?? 'slate'} dot>
      {titleCase(action)}
    </Badge>
  )
}

/** Human label for an audit entity (table name). */
export const entityLabel = (e: string) => titleCase(e.replace(/_/g, ' '))

const REF: Record<string, (id: string) => string | undefined> = {
  department_id: (id) => db.get('departments', id)?.name,
  designation_id: (id) => db.get('designations', id)?.title,
  shift_id: (id) => db.get('shifts', id)?.name,
  work_centre_id: (id) => db.get('work_centres', id)?.name,
  role_id: (id) => db.get('roles', id)?.name,
  leave_type_id: (id) => db.get('leave_types', id)?.name,
  employee_id: (id) => emp(id),
  reporting_to: (id) => emp(id),
  head_employee_id: (id) => emp(id),
  custodian_id: (id) => emp(id),
  supervisor_id: (id) => emp(id),
}
const emp = (id: string) => {
  const e = db.get('employees', id)
  return e ? `${fullName(e)} (${e.emp_code})` : undefined
}

/** Readable value for the before/after columns (ids resolved to names where possible). */
export function formatAuditValue(v: unknown, field?: string): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length ? v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  if (s.startsWith('data:')) return '(file)'
  const key = field?.split('.').pop()
  if (key && REF[key] && /^[0-9a-f-]{36}$/i.test(s)) return REF[key]!(s) ?? s
  return s.length > 400 ? `${s.slice(0, 400)}…` : s
}

/** field: from → to table for an audit entry's `changes`. */
export function AuditChanges({ changes }: { changes: AuditLog['changes'] }) {
  const rows = Object.entries(changes ?? {})
  if (!rows.length) return <p className="rounded-md bg-slate-50 px-3.5 py-3 text-[13px] text-ink-soft">No field-level changes were recorded for this entry.</p>
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
      {rows.map(([field, c]) => (
        <li key={field} className="grid grid-cols-1 gap-1.5 px-3.5 py-2.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-3">
          <span className="min-w-0 break-words text-[12.5px] font-medium text-ink-soft">{titleCase(field.replace(/\./g, ' › '))}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
            <span className="min-w-0 max-w-full break-words rounded-md bg-rose-50 px-2 py-0.5 text-rose-700 line-through decoration-rose-300">{formatAuditValue(c?.from, field)}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            <span className="min-w-0 max-w-full break-words rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{formatAuditValue(c?.to, field)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
