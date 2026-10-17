import { Suspense, lazy, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { AuthProvider, useAuth } from '@/services/session'
import { AppShell } from '@/components/layout/AppShell'
import { AuroraBackground } from '@/components/brand'
import { ConfirmHost, Toaster } from '@/components/ui'
import { BootScreen, BootError } from '@/components/layout/BootScreen'
import type { Permission } from '@/data/types'
import LoginPage from '@/pages/auth/Login'

const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load)

// Admin portal
const AdminDashboard = page(() => import('@/pages/admin/Dashboard'))
const Approvals = page(() => import('@/pages/admin/Approvals'))
const Employees = page(() => import('@/pages/admin/Employees'))
const EmployeeDetail = page(() => import('@/pages/admin/EmployeeDetail'))
const Attendance = page(() => import('@/pages/admin/Attendance'))
const Leaves = page(() => import('@/pages/admin/Leaves'))
const Payroll = page(() => import('@/pages/admin/Payroll'))
const PayrollRun = page(() => import('@/pages/admin/PayrollRun'))
const PettyCash = page(() => import('@/pages/admin/PettyCash'))
const Tasks = page(() => import('@/pages/admin/Tasks'))
const Announcements = page(() => import('@/pages/admin/Announcements'))
const Machines = page(() => import('@/pages/admin/Machines'))
const Inventory = page(() => import('@/pages/admin/Inventory'))
const Purchase = page(() => import('@/pages/admin/Purchase'))
const Production = page(() => import('@/pages/admin/Production'))
const Quality = page(() => import('@/pages/admin/Quality'))
const Reports = page(() => import('@/pages/admin/Reports'))
const Users = page(() => import('@/pages/admin/Users'))
const Audit = page(() => import('@/pages/admin/Audit'))
const Settings = page(() => import('@/pages/admin/Settings'))
// Employee portal
const MyHome = page(() => import('@/pages/employee/Home'))
const MyAttendance = page(() => import('@/pages/employee/MyAttendance'))
const MyLeaves = page(() => import('@/pages/employee/MyLeaves'))
const MyPayslips = page(() => import('@/pages/employee/MyPayslips'))
const MyTasks = page(() => import('@/pages/employee/MyTasks'))
const MyClaims = page(() => import('@/pages/employee/MyClaims'))
const MyAnnouncements = page(() => import('@/pages/employee/MyAnnouncements'))
const Profile = page(() => import('@/pages/employee/Profile'))
// Shared
const Notifications = page(() => import('@/pages/shared/Notifications'))
const NotFound = page(() => import('@/pages/shared/NotFound'))

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuroraBackground />
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Gate />
        </BrowserRouter>
        <Toaster />
        <ConfirmHost />
      </AuthProvider>
    </MotionConfig>
  )
}

function Gate() {
  const { status, session, error } = useAuth()
  if (status === 'booting' || status === 'loading') return <BootScreen label={status === 'loading' ? 'Loading your workspace' : undefined} />
  if (status === 'error') return <BootError message={error ?? 'Something went wrong.'} />
  if (!session)
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  const home = session.isAdminPortal ? '/admin' : '/me'
  if (!session.isAdminPortal && !session.employee) return <UnlinkedLogin />
  return (
    <Suspense fallback={<BootScreen inline />}>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/login" element={<Navigate to={home} replace />} />
        {session.isAdminPortal && (
          <Route path="/admin" element={<AppShell portal="admin" />}>
            <Route index element={<Need p={['dashboard.view']}><AdminDashboard /></Need>} />
            <Route path="approvals" element={<Need p={['leaves.manage', 'attendance.manage', 'petty_cash.manage', 'payroll.manage', 'purchase.manage']}><Approvals /></Need>} />
            <Route path="employees" element={<Need p={['employees.view', 'employees.manage']}><Employees /></Need>} />
            <Route path="employees/:id" element={<Need p={['employees.view', 'employees.manage']}><EmployeeDetail /></Need>} />
            <Route path="attendance" element={<Need p={['attendance.view', 'attendance.manage']}><Attendance /></Need>} />
            <Route path="leaves" element={<Need p={['leaves.view', 'leaves.manage']}><Leaves /></Need>} />
            <Route path="payroll" element={<Need p={['payroll.view', 'payroll.manage']}><Payroll /></Need>} />
            <Route path="payroll/:runId" element={<Need p={['payroll.view', 'payroll.manage']}><PayrollRun /></Need>} />
            <Route path="petty-cash" element={<Need p={['petty_cash.view', 'petty_cash.manage']}><PettyCash /></Need>} />
            <Route path="tasks" element={<Need p={['tasks.view', 'tasks.manage']}><Tasks /></Need>} />
            <Route path="announcements" element={<Need p={['announcements.manage']}><Announcements /></Need>} />
            <Route path="machines" element={<Need p={['machines.view', 'machines.manage']}><Machines /></Need>} />
            <Route path="inventory" element={<Need p={['inventory.view', 'inventory.manage']}><Inventory /></Need>} />
            <Route path="purchase" element={<Need p={['purchase.view', 'purchase.manage']}><Purchase /></Need>} />
            <Route path="production" element={<Need p={['sales.view', 'sales.manage']}><Production /></Need>} />
            <Route path="quality" element={<Need p={['quality.view', 'quality.manage']}><Quality /></Need>} />
            <Route path="reports" element={<Need p={['reports.view']}><Reports /></Need>} />
            <Route path="users" element={<Need p={['users.manage']}><Users /></Need>} />
            <Route path="audit" element={<Need p={['audit.view']}><Audit /></Need>} />
            <Route path="settings" element={<Need p={['settings.manage']}><Settings /></Need>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profile" element={<Profile />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        )}
        <Route path="/me" element={session.employee ? <AppShell portal="employee" /> : <Navigate to={home} replace />}>
          <Route index element={<MyHome />} />
          <Route path="attendance" element={<MyAttendance />} />
          <Route path="leaves" element={<MyLeaves />} />
          <Route path="payslips" element={<MyPayslips />} />
          <Route path="tasks" element={<MyTasks />} />
          <Route path="claims" element={<MyClaims />} />
          <Route path="announcements" element={<MyAnnouncements />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Suspense>
  )
}

/** Route guard: shows the page only with one of the permissions. */
function Need({ p, children }: { p: Permission[]; children: ReactNode }) {
  const { session } = useAuth()
  if (!session?.canAny(p)) return <NoAccess />
  return <>{children}</>
}

function UnlinkedLogin() {
  const { signOut, session } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card max-w-md p-8 text-center">
        <p className="font-display text-lg font-semibold">Login not linked to an employee</p>
        <p className="mt-1 text-sm text-ink-soft">
          {session?.user.email} has self-service access, but no employee record is linked to it yet. Ask HR to link it in Users &amp; roles.
        </p>
        <button onClick={() => void signOut()} className="mt-5 text-sm font-semibold text-brand-indigo hover:underline">
          Sign out
        </button>
      </div>
    </div>
  )
}

function NoAccess() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <p className="font-display text-lg font-semibold">No access</p>
      <p className="mt-1 text-sm text-ink-soft">Your role does not include this module. Ask an administrator if you need it.</p>
    </div>
  )
}
