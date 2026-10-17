/**
 * Demo logins — one per role, for showing the client what each person sees.
 *
 * Created by the demo seed: in the browser for offline mode (src/data/seed/index.ts) and in
 * Supabase Auth by scripts/seed-supabase.ts. Also listed in README.md.
 * The sign-in page shows them as one-tap buttons in offline mode, and in Supabase mode when
 * VITE_SHOW_DEMO_LOGINS=true. Switch that off and change these passwords at go-live.
 */
export const DEMO_CREDENTIALS = {
  admin: {
    email: 'admin@melstarmanufacturing.in',
    password: 'Melstar@Admin2026',
    displayName: 'Melstar Admin',
    role: 'Super Admin',
  },
  employee: {
    email: 'ravi.kumar@melstarmanufacturing.in',
    password: 'Ravi@Melstar2026',
    displayName: 'Ravi Kumar M',
    role: 'Employee · Production Supervisor, CNC Turning Cell',
  },
} as const

/** Every other seeded employee who is given a login uses this password. */
export const DEMO_DEFAULT_EMPLOYEE_PASSWORD = 'Welcome@Melstar1'

export interface DemoLogin {
  role: string
  person: string
  email: string
  password: string
  /** What this login is for, shown to the client. */
  sees: string
}

/** All demo logins, in the order shown on the sign-in page and in the README. */
export const DEMO_LOGINS: DemoLogin[] = [
  {
    role: 'Super Admin',
    person: DEMO_CREDENTIALS.admin.displayName,
    email: DEMO_CREDENTIALS.admin.email,
    password: DEMO_CREDENTIALS.admin.password,
    sees: 'Everything — every module, users & roles, audit log and settings',
  },
  {
    role: 'Plant Head',
    person: 'Prakash Hegde',
    email: 'prakash.hegde@melstarmanufacturing.in',
    password: DEMO_DEFAULT_EMPLOYEE_PASSWORD,
    sees: 'Super Admin who is also an employee — can switch to his own “My space”',
  },
  {
    role: 'HR Manager',
    person: 'Lakshmi Narayan',
    email: 'lakshmi.narayan@melstarmanufacturing.in',
    password: DEMO_DEFAULT_EMPLOYEE_PASSWORD,
    sees: 'Employees, attendance, leave & holidays, announcements; payroll read-only',
  },
  {
    role: 'Accounts',
    person: 'Vinay Kamath',
    email: 'vinay.kamath@melstarmanufacturing.in',
    password: DEMO_DEFAULT_EMPLOYEE_PASSWORD,
    sees: 'Payroll runs, petty cash, vendors & purchase orders, finance reports',
  },
  {
    role: 'Production Supervisor',
    person: 'Ramesh Babu',
    email: 'ramesh.babu@melstarmanufacturing.in',
    password: DEMO_DEFAULT_EMPLOYEE_PASSWORD,
    sees: 'Tasks, machines & maintenance, inventory, quality, team attendance',
  },
  {
    role: 'Employee',
    person: DEMO_CREDENTIALS.employee.displayName,
    email: DEMO_CREDENTIALS.employee.email,
    password: DEMO_CREDENTIALS.employee.password,
    sees: 'Own space only — check-in, attendance, leave, payslips, tasks, claims',
  },
]
