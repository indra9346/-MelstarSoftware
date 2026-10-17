/**
 * Static demo mode only: the same notification rules the database runs in Supabase mode
 * (supabase/migrations/…_notifications.sql), applied to local writes.
 */
import type { AnyRow } from '@/data/backend'
import { db } from '@/data/store'
import type { AppNotification, LeaveRequest, NotificationType, Permission, TableName } from '@/data/types'
import { fmtDateShort, fmtMonth } from '@/lib/dates'
import { fullName, inr } from '@/lib/format'
import { currentSession } from './session'

let installed = false

function usersWithPerm(perm: Permission) {
  const roles = new Set(db.all('roles').filter((r) => r.permissions.includes(perm)).map((r) => r.id))
  return db.all('app_users').filter((u) => u.active && roles.has(u.role_id))
}
function usersOfEmployee(employeeId: string) {
  return db.all('app_users').filter((u) => u.active && u.employee_id === employeeId)
}
function send(userIds: string[], type: NotificationType, title: string, body: string, link: string | null) {
  const me = currentSession()?.user.id
  const rows: Omit<AppNotification, 'id' | 'created_at' | 'updated_at'>[] = [...new Set(userIds)]
    .filter((id) => id !== me)
    .map((user_id) => ({ user_id, type, title, body, link, read: false }))
  for (const r of rows) db.insert('notifications', r)
}
const name = (employeeId: string) => fullName(db.get('employees', employeeId))
const statusChanged = (row: AnyRow, prev: AnyRow | null) => prev && row.status !== prev.status

export function installNotificationRules() {
  if (installed) return
  installed = true
  db.onLocalChange((table: TableName, row: AnyRow, prev: AnyRow | null) => {
    if (db.backend?.kind !== 'static') return
    const r = row as Record<string, unknown> & AnyRow
    switch (table) {
      case 'leave_requests': {
        const l = r as unknown as LeaveRequest
        const type = db.get('leave_types', l.leave_type_id)?.name ?? 'Leave'
        const dates = fmtDateShort(l.from_date) + (l.to_date !== l.from_date ? ` – ${fmtDateShort(l.to_date)}` : '')
        if (!prev && l.status === 'pending') send(usersWithPerm('leaves.manage').map((u) => u.id), 'leave', `Leave request — ${name(l.employee_id)}`, `${type} · ${dates} (${l.days} d)`, '/admin/approvals')
        else if (statusChanged(r, prev) && (l.status === 'approved' || l.status === 'rejected'))
          send(usersOfEmployee(l.employee_id).map((u) => u.id), 'leave', `Leave ${l.status}`, `${type} · ${dates}${l.review_note ? ' — ' + l.review_note : ''}`, '/me/leaves')
        break
      }
      case 'regularisations':
        if (!prev && r.status === 'pending') send(usersWithPerm('attendance.manage').map((u) => u.id), 'attendance', `Attendance correction — ${name(String(r.employee_id))}`, `${fmtDateShort(String(r.date))}: ${String(r.reason).slice(0, 80)}`, '/admin/approvals')
        else if (statusChanged(r, prev) && r.status !== 'pending') send(usersOfEmployee(String(r.employee_id)).map((u) => u.id), 'attendance', `Attendance correction ${r.status}`, fmtDateShort(String(r.date)), '/me/attendance')
        break
      case 'advances':
        if (!prev && r.status === 'pending') send(usersWithPerm('payroll.manage').map((u) => u.id), 'payroll', `Advance request — ${name(String(r.employee_id))}`, `${inr(Number(r.amount))} · ${String(r.reason).slice(0, 60)}`, '/admin/approvals')
        else if (statusChanged(r, prev) && (r.status === 'active' || r.status === 'rejected')) send(usersOfEmployee(String(r.employee_id)).map((u) => u.id), 'payroll', r.status === 'active' ? 'Advance approved' : 'Advance rejected', inr(Number(r.amount)), '/me/payslips')
        break
      case 'petty_cash_vouchers':
        if (!prev && r.status === 'pending') send(usersWithPerm('petty_cash.manage').map((u) => u.id), 'petty_cash', `Petty-cash claim — ${name(String(r.employee_id))}`, `${r.voucher_no} · ${inr(Number(r.amount))} · ${r.category}`, '/admin/approvals')
        else if (statusChanged(r, prev) && r.status !== 'pending') send(usersOfEmployee(String(r.employee_id)).map((u) => u.id), 'petty_cash', `Claim ${r.status} · ${r.voucher_no}`, `${inr(Number(r.amount))}${r.review_note ? ' — ' + r.review_note : ''}`, '/me/claims')
        break
      case 'tasks': {
        const before = new Set((prev?.assignee_ids as string[] | undefined) ?? [])
        const added = (r.assignee_ids as string[]).filter((id) => !before.has(id))
        if (added.length) send(added.flatMap((e) => usersOfEmployee(e).map((u) => u.id)), 'task', `New task assigned · ${r.task_no}`, `${r.title}${r.due_date ? ' · due ' + fmtDateShort(String(r.due_date)) : ''}`, '/me/tasks')
        break
      }
      case 'task_comments': {
        if (prev) break
        const t = db.get('tasks', String(r.task_id))
        if (!t) break
        const ids = [...t.assignee_ids.flatMap((e) => usersOfEmployee(e).map((u) => u.id)), ...(t.created_by ? [t.created_by] : [])]
        send(ids.filter((id) => id !== r.author_user_id), 'task', `${r.author_name} commented · ${t.task_no}`, String(r.body).slice(0, 120), '/me/tasks')
        break
      }
      case 'payslips':
        if (r.published && (!prev || !prev.published)) send(usersOfEmployee(String(r.employee_id)).map((u) => u.id), 'payroll', 'Payslip published', `Your payslip for ${fmtMonth(String(r.month))} is ready.`, '/me/payslips')
        break
      case 'announcements': {
        if (prev) break
        const audience = r.audience_department_ids as string[]
        const roles = new Map(db.all('roles').map((x) => [x.id, x]))
        for (const u of db.all('app_users')) {
          if (!u.active || u.id === r.created_by) continue
          const dept = u.employee_id ? db.get('employees', u.employee_id)?.department_id : null
          if (audience.length && (!dept || !audience.includes(dept))) continue
          send([u.id], 'announcement', String(r.title), String(r.body).slice(0, 140), roles.get(u.role_id)?.is_admin_portal ? '/admin/announcements' : '/me/announcements')
        }
        break
      }
    }
  })
}
