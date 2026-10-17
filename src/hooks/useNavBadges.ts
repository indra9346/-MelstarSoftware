import { useMemo } from 'react'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'

/** Live counts for nav badges and the dashboard "needs attention" tiles. */
export function usePendingApprovals() {
  const s = useSession()
  const leaves = useTable('leave_requests')
  const regs = useTable('regularisations')
  const vouchers = useTable('petty_cash_vouchers')
  const advances = useTable('advances')
  const attendance = useTable('attendance')
  const pos = useTable('purchase_orders')
  return useMemo(() => {
    const leave = s.can('leaves.manage') ? leaves.filter((l) => l.status === 'pending').length : 0
    const regularisation = s.can('attendance.manage') ? regs.filter((r) => r.status === 'pending').length : 0
    const overtime = s.can('attendance.manage') ? attendance.filter((a) => a.ot_status === 'pending').length : 0
    const voucher = s.can('petty_cash.manage') ? vouchers.filter((v) => v.status === 'pending' || v.status === 'approved').length : 0
    const advance = s.can('payroll.manage') ? advances.filter((a) => a.status === 'pending').length : 0
    const purchase = s.can('purchase.manage') ? pos.filter((p) => p.status === 'draft').length : 0
    return { leave, regularisation, overtime, voucher, advance, purchase, total: leave + regularisation + overtime + voucher + advance + purchase }
  }, [s, leaves, regs, vouchers, advances, attendance, pos])
}

export function useNavBadges() {
  const s = useSession()
  const approvals = usePendingApprovals()
  const notes = useTable('notifications')
  const tasks = useTable('tasks')
  return useMemo(
    () => ({
      approvals: approvals.total,
      notifications: notes.filter((n) => n.user_id === s.user.id && !n.read).length,
      myTasks: s.employee ? tasks.filter((t) => t.status !== 'done' && t.assignee_ids.includes(s.employee!.id)).length : 0,
    }),
    [approvals.total, notes, tasks, s],
  )
}
