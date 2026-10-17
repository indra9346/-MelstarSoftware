import { useLookups } from '@/hooks/useLookups'
import { fullName } from '@/lib/format'
import { Avatar } from './ui'

/** Avatar + name + code/designation, for tables and lists. */
export function EmployeeCell({ id, sub = 'designation', size = 32 }: { id: string | null | undefined; sub?: 'designation' | 'code' | 'department' | 'none'; size?: number }) {
  const L = useLookups()
  const e = id ? L.emp.get(id) : undefined
  if (!e) return <span className="text-ink-faint">—</span>
  const name = fullName(e)
  const subText = sub === 'designation' ? L.desigTitle(e.designation_id) : sub === 'code' ? e.emp_code : sub === 'department' ? L.deptName(e.department_id) : null
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={e.photo} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink">{name}</span>
        {subText && <span className="block truncate text-[12px] text-ink-soft">{subText}</span>}
      </span>
    </span>
  )
}
