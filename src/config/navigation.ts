import type { LucideIcon } from 'lucide-react'
import {
  Banknote, BarChart3, Bell, Boxes, CalendarCheck2, CalendarDays, ClipboardCheck, Cog, Factory, FileClock, Gauge, Home, Inbox, KanbanSquare,
  LayoutDashboard, Megaphone, ReceiptIndianRupee, ShieldCheck, ShoppingCart, User, Users, Wallet, Wrench,
} from 'lucide-react'
import type { Permission } from '@/data/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Any of these permissions shows the item. Empty = everyone in the portal. */
  perms?: Permission[]
  /** Badge key for live counts (see useNavBadges). */
  badge?: 'approvals' | 'notifications' | 'myTasks'
  mobile?: boolean // pinned in the phone bottom bar
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.view'], mobile: true },
      { to: '/admin/approvals', label: 'Approvals', icon: Inbox, perms: ['leaves.manage', 'attendance.manage', 'petty_cash.manage', 'payroll.manage', 'purchase.manage'], badge: 'approvals', mobile: true },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/admin/employees', label: 'Employees', icon: Users, perms: ['employees.view', 'employees.manage'], mobile: true },
      { to: '/admin/attendance', label: 'Attendance', icon: CalendarCheck2, perms: ['attendance.view', 'attendance.manage'] },
      { to: '/admin/leaves', label: 'Leaves & holidays', icon: CalendarDays, perms: ['leaves.view', 'leaves.manage'] },
      { to: '/admin/payroll', label: 'Payroll', icon: Banknote, perms: ['payroll.view', 'payroll.manage'] },
    ],
  },
  {
    label: 'Work',
    items: [
      { to: '/admin/tasks', label: 'Tasks', icon: KanbanSquare, perms: ['tasks.view', 'tasks.manage'], mobile: true },
      { to: '/admin/announcements', label: 'Announcements', icon: Megaphone, perms: ['announcements.manage'] },
    ],
  },
  {
    label: 'Plant',
    items: [
      { to: '/admin/machines', label: 'Machines & maintenance', icon: Wrench, perms: ['machines.view', 'machines.manage'] },
      { to: '/admin/production', label: 'Customers & work orders', icon: Factory, perms: ['sales.view', 'sales.manage'] },
      { to: '/admin/quality', label: 'Quality', icon: ClipboardCheck, perms: ['quality.view', 'quality.manage'] },
      { to: '/admin/inventory', label: 'Inventory & assets', icon: Boxes, perms: ['inventory.view', 'inventory.manage'] },
      { to: '/admin/purchase', label: 'Vendors & purchase', icon: ShoppingCart, perms: ['purchase.view', 'purchase.manage'] },
    ],
  },
  {
    label: 'Finance',
    items: [{ to: '/admin/petty-cash', label: 'Petty cash', icon: Wallet, perms: ['petty_cash.view', 'petty_cash.manage'] }],
  },
  {
    label: 'Insights & admin',
    items: [
      { to: '/admin/reports', label: 'Reports', icon: BarChart3, perms: ['reports.view'] },
      { to: '/admin/users', label: 'Users & roles', icon: ShieldCheck, perms: ['users.manage'] },
      { to: '/admin/audit', label: 'Audit log', icon: FileClock, perms: ['audit.view'] },
      { to: '/admin/settings', label: 'Settings', icon: Cog, perms: ['settings.manage'] },
    ],
  },
]

export const EMPLOYEE_NAV: NavGroup[] = [
  {
    label: 'My space',
    items: [
      { to: '/me', label: 'Home', icon: Home, mobile: true },
      { to: '/me/attendance', label: 'Attendance', icon: Gauge, mobile: true },
      { to: '/me/leaves', label: 'Leaves', icon: CalendarDays, mobile: true },
      { to: '/me/tasks', label: 'Tasks & to-dos', icon: KanbanSquare, badge: 'myTasks', mobile: true },
      { to: '/me/payslips', label: 'Payslips & advances', icon: ReceiptIndianRupee },
      { to: '/me/claims', label: 'Petty-cash claims', icon: Wallet },
      { to: '/me/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/me/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
      { to: '/me/profile', label: 'My profile', icon: User },
    ],
  },
]

export function visibleNav(groups: NavGroup[], can: (p: Permission) => boolean): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perms?.length || i.perms.some(can)) }))
    .filter((g) => g.items.length)
}
