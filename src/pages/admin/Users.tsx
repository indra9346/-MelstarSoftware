import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import {
  Check, CheckCircle2, Copy, KeyRound, Lock, Pencil, Plus, Power, ShieldCheck, ShieldPlus, Trash2, UserPlus, Users as UsersIcon, UserX,
} from 'lucide-react'
import {
  Avatar, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, Input, Menu, Modal, PageHeader, Select, StatusBadge, Switch, Tabs, Textarea,
  confirm, guard, toast, type Column,
} from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { PasswordField } from '@/components/hr/inputs'
import { DATA_MODE } from '@/config/env'
import { db, useTable } from '@/data/store'
import type { AppUser, Permission, Role } from '@/data/types'
import { useLookups } from '@/hooks/useLookups'
import { fmtDateTime, relativeTime } from '@/lib/dates'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/misc'
import {
  ALL_PERMISSIONS, PERMISSION_MODULES, RE, createRole, deleteRole, slugify, updateRole, userManagersExcept, validateRole, type RoleFormValues,
} from '@/services/hr'
import { useSession } from '@/services/session'
import { createLogin, deleteLogin, resetPassword, setActive, updateLogin } from '@/services/users'

type Tab = 'logins' | 'roles'

export default function UsersPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'roles' ? 'roles' : 'logins'
  const setTab = (t: Tab) => setParams(t === 'logins' ? {} : { tab: t }, { replace: true })
  const users = useTable('app_users')
  const roles = useTable('roles')
  const [creating, setCreating] = useState(false)
  const [creatingRole, setCreatingRole] = useState(false)
  const [selectedRole, setSelectedRole] = useState<string | null>(null)

  return (
    <div>
      <PageHeader
        kicker="Administration"
        title="Users & roles"
        subtitle={`${users.filter((u) => u.active).length} active logins · ${roles.length} roles · ${DATA_MODE === 'supabase' ? 'Supabase Auth' : 'offline demo logins'}`}
        actions={
          tab === 'logins' ? (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New login
            </Button>
          ) : (
            <Button icon={<ShieldPlus className="h-4 w-4" />} onClick={() => setCreatingRole(true)}>
              New role
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { value: 'logins', label: 'Logins', count: users.length },
          { value: 'roles', label: 'Roles & permissions', count: roles.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div key={tab}>
        {tab === 'logins' ? <Logins onCreate={() => setCreating(true)} /> : <Roles selected={selectedRole} onSelect={setSelectedRole} />}
      </div>
      <CreateLoginModal open={creating} onClose={() => setCreating(false)} />
      <CreateRoleModal
        open={creatingRole}
        onClose={() => setCreatingRole(false)}
        onCreated={(r) => {
          setSelectedRole(r.id)
          setTab('roles')
        }}
      />
    </div>
  )
}

/* ─────────────────────────────── Logins ─────────────────────────────── */

const roleHas = (roleId: string, p: Permission) => !!db.get('roles', roleId)?.permissions.includes(p)

function Logins({ onCreate }: { onCreate: () => void }) {
  const s = useSession()
  const users = useTable('app_users')
  const roles = useTable('roles')
  const roleMap = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const [role, setRole] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [resetting, setResetting] = useState<AppUser | null>(null)

  const rows = useMemo(
    () =>
      users
        .filter((u) => (!role || u.role_id === role) && (status === 'all' || (status === 'active' ? u.active : !u.active)))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.display_name.localeCompare(b.display_name)),
    [users, role, status],
  )

  const toggle = async (u: AppUser) => {
    if (u.id === s.user.id) return toast.error('You cannot deactivate yourself')
    if (u.active && roleHas(u.role_id, 'users.manage') && userManagersExcept(u.id) === 0) return toast.error('Keep at least one user administrator', 'This is the only active login that can manage users.')
    if (u.active && !(await confirm({ title: `Deactivate ${u.display_name}?`, message: 'They are signed out at once and cannot sign in until re-activated. Their history is kept.', danger: true, confirmLabel: 'Deactivate' }))) return
    await guard(() => setActive(u.id, !u.active), u.active ? `${u.display_name} deactivated` : `${u.display_name} can sign in again`)
  }
  const remove = async (u: AppUser) => {
    if (u.id === s.user.id) return toast.error('You cannot delete your own login')
    if (roleHas(u.role_id, 'users.manage') && u.active && userManagersExcept(u.id) === 0) return toast.error('Keep at least one user administrator', 'This is the only active login that can manage users.')
    const ok = await confirm({
      title: `Delete the login ${u.email}?`,
      message: 'The login is removed permanently; the employee record and audit history stay. Deactivating is usually enough.',
      danger: true,
      confirmLabel: 'Delete login',
    })
    if (ok) await guard(() => deleteLogin(u.id), 'Login deleted')
  }

  const columns: Column<AppUser>[] = [
    {
      key: 'name',
      header: 'User',
      value: (u) => u.display_name,
      cell: (u) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={u.display_name} size={32} className={cn(!u.active && 'opacity-50 grayscale')} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-ink">{u.display_name}</span>
              {u.id === s.user.id && <Badge tone="cyan">You</Badge>}
            </span>
            <span className="block truncate text-[12px] text-ink-soft">{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      value: (u) => roleMap.get(u.role_id)?.name ?? '',
      cell: (u) => {
        const r = roleMap.get(u.role_id)
        return r ? <Badge tone={r.key === 'super_admin' ? 'pink' : r.is_admin_portal ? 'indigo' : 'slate'}>{r.name}</Badge> : <span className="text-ink-faint">—</span>
      },
    },
    { key: 'emp', header: 'Employee', value: (u) => (u.employee_id ? fullName(db.get('employees', u.employee_id)) : ''), cell: (u) => (u.employee_id ? <EmployeeCell id={u.employee_id} size={28} sub="code" /> : <span className="text-ink-faint">Not linked</span>) },
    { key: 'active', header: 'Status', value: (u) => (u.active ? 'Active' : 'Inactive'), cell: (u) => <StatusBadge status={u.active ? 'active' : 'closed'} label={u.active ? 'Active' : 'Inactive'} /> },
    { key: 'last', header: 'Last sign-in', value: (u) => u.last_login_at ?? '', cell: (u) => (u.last_login_at ? <span className="whitespace-nowrap text-ink-soft" title={fmtDateTime(u.last_login_at)}>{relativeTime(u.last_login_at)}</span> : <span className="text-ink-faint">Never</span>) },
    {
      key: 'actions',
      header: '',
      sortable: false,
      align: 'right',
      cell: (u) => (
        <Menu
          items={[
            { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(u) },
            { label: 'Reset password', icon: <KeyRound />, onClick: () => setResetting(u) },
            { label: u.active ? 'Deactivate' : 'Activate', icon: <Power />, disabled: u.id === s.user.id, onClick: () => void toggle(u) },
            { label: 'Delete login', icon: <Trash2 />, danger: true, disabled: u.id === s.user.id, onClick: () => void remove(u) },
          ]}
        />
      ),
    },
  ]

  const counts = {
    active: users.filter((u) => u.active).length,
    admin: users.filter((u) => u.active && roleMap.get(u.role_id)?.is_admin_portal).length,
    never: users.filter((u) => u.active && !u.last_login_at).length,
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-3">
        {[
          ['Active logins', counts.active],
          ['Admin portal', counts.admin],
          ['Never signed in', counts.never],
        ].map(([k, v]) => (
          <div key={k} className="card min-w-0 p-4">
            <p className="truncate text-[13px] font-medium text-ink-soft">{k}</p>
            <p className="num mt-2 text-[22px] font-semibold leading-none text-ink">{v}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardBody>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(u) => u.id}
            searchText={(u) => `${u.display_name} ${u.email} ${roleMap.get(u.role_id)?.name ?? ''} ${u.employee_id ? fullName(db.get('employees', u.employee_id)) : ''}`}
            searchPlaceholder="Search name, e-mail, role…"
            onRowClick={(u) => setEditing(u)}
            toolbar={
              <>
                <Select value={role} onChange={(e) => setRole(e.target.value)} options={roles.map((r) => ({ value: r.id, label: r.name }))} placeholder="All roles" className="h-10 w-auto min-w-[9rem] flex-1 py-0 text-sm sm:flex-none" aria-label="Role" />
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  options={[
                    { value: 'all', label: 'Any status' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                  className="h-10 w-auto min-w-[8rem] flex-1 py-0 text-sm sm:flex-none"
                  aria-label="Status"
                />
              </>
            }
            empty={
              <EmptyState
                icon={<UsersIcon className="h-6 w-6" />}
                title={role || status !== 'all' ? 'No logins match' : 'No logins yet'}
                action={
                  <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={onCreate}>
                    New login
                  </Button>
                }
              />
            }
          />
        </CardBody>
      </Card>
      <EditLoginModal user={editing} onClose={() => setEditing(null)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </div>
  )
}

/** Employees that can still be linked (no login yet, on rolls) — plus the current link. */
function useLinkableEmployees(currentId: string | null) {
  const L = useLookups()
  const users = useTable('app_users')
  return useMemo(() => {
    const taken = new Set(users.map((u) => u.employee_id).filter((x): x is string => !!x && x !== currentId))
    return L.employeeOptions((e) => !taken.has(e.id) && (e.status !== 'exited' || e.id === currentId))
  }, [L, users, currentId])
}

function roleOptions(roles: Role[]) {
  return [...roles]
    .sort((a, b) => Number(b.is_admin_portal) - Number(a.is_admin_portal) || a.name.localeCompare(b.name))
    .map((r) => ({ value: r.id, label: `${r.name} · ${r.is_admin_portal ? 'Admin portal' : 'Self-service'}` }))
}

function CredentialsPanel({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`E-mail: ${email}\nPassword: ${password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy is blocked by the browser', 'Select the text and copy it manually.')
    }
  }
  return (
    <div className="text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
      <p className="mt-3 text-sm text-ink-soft">Share these details privately (in person or by phone). They can change the password from My profile.</p>
      <div className="mt-4 space-y-2 rounded-lg border border-line bg-slate-50 p-4 text-left">
        <p className="flex min-w-0 justify-between gap-3 text-sm">
          <span className="text-ink-soft">E-mail</span>
          <span className="min-w-0 break-all font-semibold text-ink">{email}</span>
        </p>
        <p className="flex min-w-0 justify-between gap-3 text-sm">
          <span className="text-ink-soft">Password</span>
          <span className="min-w-0 break-all font-mono font-semibold text-ink">{password}</span>
        </p>
      </div>
      <Button className="mt-3" size="sm" variant="secondary" icon={copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy both'}
      </Button>
    </div>
  )
}

interface LoginForm {
  employee_id: string
  display_name: string
  email: string
  role_id: string
  password: string
}

function validateLogin(f: LoginForm, opts: { existing?: AppUser; needPassword: boolean }) {
  const e: Partial<Record<keyof LoginForm, string>> = {}
  const name = f.display_name.trim()
  if (!name) e.display_name = 'Display name is required'
  else if (name.length > 80) e.display_name = 'Keep it under 80 characters'
  if (!opts.existing) {
    const mail = f.email.trim().toLowerCase()
    if (!mail) e.email = 'E-mail is required'
    else if (!RE.email.test(mail)) e.email = 'Enter a valid e-mail address'
    else if (db.find('app_users', (u) => u.email.toLowerCase() === mail)) e.email = 'A login with this e-mail already exists'
  }
  const role = db.get('roles', f.role_id)
  if (!role) e.role_id = 'Select a role'
  else if (!role.is_admin_portal && !f.employee_id) e.role_id = 'Self-service roles need a linked employee'
  if (f.employee_id && db.find('app_users', (u) => u.employee_id === f.employee_id && u.id !== opts.existing?.id)) e.employee_id = 'This employee already has a login'
  if (opts.existing && role && roleHas(opts.existing.role_id, 'users.manage') && !role.permissions.includes('users.manage') && opts.existing.active && userManagersExcept(opts.existing.id) === 0)
    e.role_id = 'This is the only user administrator — keep a role with Users & roles access'
  if (opts.needPassword) {
    if (f.password.length < 8) e.password = 'Use at least 8 characters'
    else if (f.password.length > 72) e.password = 'Keep it under 72 characters'
  }
  return e
}

function CreateLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useTable('roles')
  const employees = useLinkableEmployees(null)
  const defaultRole = roles.find((r) => r.key === 'employee')?.id ?? ''
  const blank = (): LoginForm => ({ employee_id: '', display_name: '', email: '', role_id: defaultRole, password: '' })
  const [f, setF] = useState<LoginForm>(blank)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ email: string; password: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setF(blank())
    setTouched(new Set())
    setDone(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const errors = validateLogin(f, { needPassword: true })
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof LoginForm) => (touched.has(k) ? errors[k] : undefined)
  const touch = (k: keyof LoginForm) => setTouched((t) => new Set(t).add(k))

  const pickEmployee = (id: string) => {
    const e = db.get('employees', id)
    setF((p) => ({ ...p, employee_id: id, display_name: e ? fullName(e) : p.display_name, email: e?.email ? e.email : p.email }))
    touch('employee_id')
  }

  const save = async () => {
    if (invalid) return setTouched(new Set(Object.keys(f)))
    setBusy(true)
    try {
      const u = await createLogin({ email: f.email, password: f.password, display_name: f.display_name.trim(), role_id: f.role_id, employee_id: f.employee_id || null })
      toast.success('Login created', u.email)
      setDone({ email: u.email, password: f.password })
    } catch (e) {
      toast.error('Could not create the login', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const role = roles.find((r) => r.id === f.role_id)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={done ? 'Login ready' : 'New login'}
      subtitle={done ? undefined : 'Link an employee to prefill the name and official e-mail'}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={invalid}>
              Create login
            </Button>
          </>
        )
      }
    >
      {done ? (
        <CredentialsPanel email={done.email} password={done.password} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Employee" error={err('employee_id')} hint="Needed for the self-service portal" className="sm:col-span-2" htmlFor="nl-emp">
            <Select id="nl-emp" value={f.employee_id} onChange={(e) => pickEmployee(e.target.value)} options={employees} placeholder="No employee (admin-only login)" />
          </Field>
          <Field label="Display name" required error={err('display_name')} htmlFor="nl-name">
            <Input id="nl-name" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} onBlur={() => touch('display_name')} invalid={!!err('display_name')} />
          </Field>
          <Field label="E-mail (sign-in ID)" required error={err('email')} htmlFor="nl-email">
            <Input id="nl-email" type="email" inputMode="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onBlur={() => touch('email')} invalid={!!err('email')} placeholder="name@melstarmanufacturing.in" />
          </Field>
          <Field label="Role" required error={err('role_id')} hint={role?.description} className="sm:col-span-2" htmlFor="nl-role">
            <Select
              id="nl-role"
              value={f.role_id}
              onChange={(e) => {
                setF({ ...f, role_id: e.target.value })
                touch('role_id')
              }}
              invalid={!!err('role_id')}
              options={roleOptions(roles)}
              placeholder="Select…"
            />
          </Field>
          <Field label="Password" required error={err('password')} hint="Minimum 8 characters — use Generate for a strong one" className="sm:col-span-2" htmlFor="nl-pw">
            <PasswordField id="nl-pw" value={f.password} onChange={(password) => setF({ ...f, password })} onBlur={() => touch('password')} invalid={!!err('password')} generate />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function EditLoginModal({ user, onClose }: { user: AppUser | null; onClose: () => void }) {
  const s = useSession()
  const roles = useTable('roles')
  const employees = useLinkableEmployees(user?.employee_id ?? null)
  const [f, setF] = useState<LoginForm>({ employee_id: '', display_name: '', email: '', role_id: '', password: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) setF({ employee_id: user.employee_id ?? '', display_name: user.display_name, email: user.email, role_id: user.role_id, password: '' })
  }, [user])

  const errors = user ? validateLogin(f, { existing: user, needPassword: false }) : {}
  const invalid = Object.keys(errors).length > 0
  const self = user?.id === s.user.id
  const dirty = !!user && (f.display_name.trim() !== user.display_name || f.role_id !== user.role_id || (f.employee_id || null) !== user.employee_id)
  const role = roles.find((r) => r.id === f.role_id)

  const save = async () => {
    if (!user || invalid) return
    setBusy(true)
    const ok = await guard(() => updateLogin(user.id, { display_name: f.display_name.trim(), role_id: f.role_id, employee_id: f.employee_id || null }), 'Login updated')
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={user ? `Edit ${user.display_name}` : ''}
      subtitle={user?.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={invalid || !dirty}>
            Save
          </Button>
        </>
      }
    >
      {user && (
        <div className="grid grid-cols-1 gap-4">
          <Field label="Display name" required error={errors.display_name} htmlFor="el-name">
            <Input id="el-name" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} invalid={!!errors.display_name} />
          </Field>
          <Field label="E-mail (sign-in ID)" hint="The sign-in e-mail cannot be changed — create a new login instead.">
            <Input value={user.email} disabled />
          </Field>
          <Field label="Role" required error={errors.role_id} hint={self ? 'You cannot change your own role.' : role?.description} htmlFor="el-role">
            <Select id="el-role" value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })} options={roleOptions(roles)} disabled={self} invalid={!!errors.role_id} />
          </Field>
          <Field label="Linked employee" error={errors.employee_id} hint="Gives access to self-service (attendance, leave, payslips)" htmlFor="el-emp">
            <Select id="el-emp" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} options={employees} placeholder="No linked employee" />
          </Field>
          <p className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            <Lock className="h-3.5 w-3.5" /> Last sign-in {user.last_login_at ? fmtDateTime(user.last_login_at) : 'never'} · {user.active ? 'active' : 'deactivated'}
          </p>
        </div>
      )}
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose }: { user: AppUser | null; onClose: () => void }) {
  const s = useSession()
  const [pw, setPw] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    setPw('')
    setTouched(false)
    setDone(null)
  }, [user])

  const error = pw.length < 8 ? 'Use at least 8 characters' : pw.length > 72 ? 'Keep it under 72 characters' : undefined

  const save = async () => {
    setTouched(true)
    if (!user || error) return
    setBusy(true)
    try {
      await resetPassword(user.id, pw)
      toast.success('Password reset', user.email)
      setDone(pw)
    } catch (e) {
      toast.error('Could not reset the password', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="sm"
      title={done ? 'Password reset' : `Reset password`}
      subtitle={user ? `${user.display_name} · ${user.email}` : undefined}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!!error}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {done && user ? (
        <CredentialsPanel email={user.email} password={done} />
      ) : (
        <div className="space-y-3">
          {user?.id === s.user.id && <p className="rounded-md bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">This is your own login — you can also change it from My profile.</p>}
          <Field label="New password" required error={touched ? error : undefined} htmlFor="rp-pw">
            <PasswordField id="rp-pw" value={pw} onChange={setPw} onBlur={() => setTouched(true)} invalid={touched && !!error} generate />
          </Field>
          <p className="text-[12px] text-ink-faint">The user keeps their role and history; only the password changes.</p>
        </div>
      )}
    </Modal>
  )
}

/* ─────────────────────────────── Roles ─────────────────────────────── */

function Roles({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const roles = useTable('roles')
  const users = useTable('app_users')
  const sorted = useMemo(() => [...roles].sort((a, b) => Number(b.is_system) - Number(a.is_system) || Number(b.is_admin_portal) - Number(a.is_admin_portal) || a.name.localeCompare(b.name)), [roles])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of users) m.set(u.role_id, (m.get(u.role_id) ?? 0) + 1)
    return m
  }, [users])
  const current = sorted.find((r) => r.id === selected) ?? sorted[0]
  const [dirty, setDirty] = useState(false)

  const choose = async (id: string) => {
    if (id === current?.id) return
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'Your permission changes to this role have not been saved.', danger: true, confirmLabel: 'Discard' }))) return
    setDirty(false)
    onSelect(id)
  }

  if (!current) return <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No roles" />

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <ul className="flex gap-2 overflow-x-auto pb-1 no-scrollbar lg:flex-col lg:overflow-visible">
          {sorted.map((r) => {
            const active = r.id === current.id
            return (
              <li key={r.id} className="w-[15rem] shrink-0 lg:w-auto">
                <button
                  type="button"
                  onClick={() => void choose(r.id)}
                  className={cn('relative w-full rounded-md border p-3.5 text-left transition-colors', active ? 'border-brand-300 bg-brand-50/60' : 'border-transparent hover:bg-white')}
                >
                  {active && <span className="absolute inset-y-3 left-0 w-[3px] rounded-r bg-brand-600" />}
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-ink">{r.name}</span>
                    {r.key === 'super_admin' ? <Lock className="h-3.5 w-3.5 shrink-0 text-rose-500" /> : r.is_system ? <Badge tone="slate">System</Badge> : <Badge tone="violet">Custom</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-faint">{r.key}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">{counts.get(r.id) ?? 0} users</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                      {r.permissions.length}/{ALL_PERMISSIONS.length} perms
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 font-semibold', r.is_admin_portal ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700')}>{r.is_admin_portal ? 'Admin' : 'Self-service'}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <div key={current.id} className="min-w-0">
          <RoleEditor key={`${current.id}-${current.updated_at}`} role={current} userCount={counts.get(current.id) ?? 0} onDirty={setDirty} onDeleted={() => onSelect(sorted.find((r) => r.id !== current.id)?.id ?? '')} />
        </div>
      </AnimatePresence>
    </div>
  )
}

function RoleEditor({ role, userCount, onDirty, onDeleted }: { role: Role; userCount: number; onDirty: (d: boolean) => void; onDeleted: () => void }) {
  const s = useSession()
  const users = useTable('app_users')
  const locked = role.key === 'super_admin'
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description)
  const [perms, setPerms] = useState<Set<Permission>>(new Set(locked ? ALL_PERMISSIONS : role.permissions))
  const [portal, setPortal] = useState(locked ? true : role.is_admin_portal)
  const [busy, setBusy] = useState(false)

  const errors = validateRole({ key: role.key, name, description }, role)
  const permList = ALL_PERMISSIONS.filter((p) => perms.has(p))
  const dirty = name.trim() !== role.name || description.trim() !== role.description || portal !== role.is_admin_portal || JSON.stringify(permList) !== JSON.stringify(ALL_PERMISSIONS.filter((p) => role.permissions.includes(p)))
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  const toggle = (p: Permission, on: boolean, mod: (typeof PERMISSION_MODULES)[number]) => {
    setPerms((prev) => {
      const next = new Set(prev)
      if (on) {
        next.add(p)
        if (p === mod.manage && mod.view) next.add(mod.view) // manage implies view
      } else {
        next.delete(p)
      }
      return next
    })
  }
  const members = users.filter((u) => u.role_id === role.id)
  const own = s.role.id === role.id

  const save = async () => {
    setBusy(true)
    const ok = await guard(() => updateRole(role, { name, description, permissions: permList, is_admin_portal: portal }), `${name.trim()} saved`)
    setBusy(false)
    if (ok) onDirty(false)
  }
  const remove = async () => {
    if (!(await confirm({ title: `Delete the ${role.name} role?`, message: 'No login uses it. This cannot be undone.', danger: true, confirmLabel: 'Delete role' }))) return
    if (await guard(() => deleteRole(role), 'Role deleted')) onDeleted()
  }
  const reset = () => {
    setName(role.name)
    setDescription(role.description)
    setPerms(new Set(role.permissions))
    setPortal(role.is_admin_portal)
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {role.name}
            {locked && <Badge tone="pink">Locked</Badge>}
            {own && <Badge tone="cyan">Your role</Badge>}
          </span>
        }
        subtitle={`${userCount} login${userCount === 1 ? '' : 's'} · ${permList.length} of ${ALL_PERMISSIONS.length} permissions`}
        icon={<ShieldCheck className="h-4 w-4" />}
        actions={
          !role.is_system && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={userCount > 0} title={userCount ? 'Move its users to another role first' : 'Delete role'} onClick={() => void remove()}>
              Delete
            </Button>
          )
        }
      />
      <CardBody className="space-y-5">
        {locked && <p className="rounded-md bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800">Super Admin always has every permission and the Admin portal. Only the name and description can change.</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} htmlFor="role-name">
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} />
          </Field>
          <Field label="Key" hint="Used by the database — cannot change">
            <Input value={role.key} disabled className="font-mono" />
          </Field>
          <Field label="Description" error={errors.description} className="sm:col-span-2" htmlFor="role-desc">
            <Textarea id="role-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} invalid={!!errors.description} />
          </Field>
        </div>
        <div className="rounded-lg border border-line bg-white p-3.5">
          <Switch
            checked={portal}
            onChange={setPortal}
            disabled={locked || own}
            label="Admin portal"
            description={own && !locked ? 'Your own role must keep the Admin portal.' : portal ? 'Opens the Admin portal (and self-service when linked to an employee).' : 'Self-service only — My space. Needs a linked employee.'}
          />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-ink">Permissions</p>
            {!locked && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setPerms(new Set([...perms, ...PERMISSION_MODULES.map((m) => m.view).filter((p): p is Permission => !!p)]))}>
                  All view
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPerms(new Set(own ? (['users.manage'] as Permission[]) : []))}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 border-b border-line bg-slate-50 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft sm:grid-cols-[minmax(0,1fr)_5rem_5rem]">
              <span>Module</span>
              <span className="text-center">View</span>
              <span className="text-center">Manage</span>
            </div>
            <ul className="divide-y divide-line">
              {PERMISSION_MODULES.map((m) => (
                <li key={m.key} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_5rem_5rem]">
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{m.label}</span>
                  {([m.view, m.manage] as (Permission | undefined)[]).map((p, i) => (
                    <span key={i} className="flex justify-center">
                      {p ? (
                        <span title={p}>
                          <Switch checked={perms.has(p)} disabled={locked || (own && p === 'users.manage')} onChange={(v) => toggle(p, v, m)} />
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">Turning on “manage” also turns on “view”. Changes apply immediately to everyone with this role after saving — on the server too (Row Level Security).</p>
        </div>

        {members.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">People with this role</p>
            <div className="flex flex-wrap gap-1.5">
              {members.slice(0, 24).map((u) => (
                <span key={u.id} className={cn('inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-0.5 pr-2.5 text-[12.5px] font-medium text-ink', !u.active && 'opacity-50')}>
                  <Avatar name={u.display_name} size={22} />
                  {u.display_name}
                  {!u.active && <UserX className="h-3 w-3 text-ink-faint" />}
                </span>
              ))}
              {members.length > 24 && <span className="text-[12.5px] text-ink-soft">+{members.length - 24} more</span>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {dirty && <span className="mr-auto text-[12.5px] font-medium text-amber-600">Unsaved changes</span>}
          <Button variant="secondary" onClick={reset} disabled={!dirty || busy}>
            Discard
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!dirty || Object.keys(errors).length > 0}>
            Save role
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function CreateRoleModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: Role) => void }) {
  const roles = useTable('roles')
  const [f, setF] = useState<RoleFormValues>({ key: '', name: '', description: '' })
  const [keyEdited, setKeyEdited] = useState(false)
  const [base, setBase] = useState('')
  const [portal, setPortal] = useState(true)
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setF({ key: '', name: '', description: '' })
    setKeyEdited(false)
    setBase('')
    setPortal(true)
    setTouched(new Set())
  }, [open])

  const errors = validateRole(f)
  const invalid = Object.keys(errors).length > 0
  const err = (k: keyof RoleFormValues) => (touched.has(k) ? errors[k] : undefined)
  const baseRole = roles.find((r) => r.id === base)

  const save = async () => {
    if (invalid) return setTouched(new Set(['key', 'name', 'description']))
    let created: Role | null = null
    const ok = await guard(() => {
      created = createRole(f, baseRole ? baseRole.permissions : ['dashboard.view'], portal)
    }, 'Role created — now tick its permissions')
    if (ok && created) {
      onCreated(created)
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New role"
      subtitle="Start from an existing role and fine-tune its permissions"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => void save()} disabled={invalid}>
            Create role
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required error={err('name')} htmlFor="nr-name">
          <Input
            id="nr-name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value, key: keyEdited ? f.key : slugify(e.target.value) })}
            onBlur={() => setTouched((t) => new Set(t).add('name'))}
            invalid={!!err('name')}
            placeholder="Stores In-charge"
          />
        </Field>
        <Field label="Key" required error={err('key') ?? (f.key && errors.key) ?? undefined} hint="Lowercase, digits and _ (e.g. stores_incharge)" htmlFor="nr-key">
          <Input
            id="nr-key"
            value={f.key}
            onChange={(e) => {
              setKeyEdited(true)
              setF({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) })
            }}
            onBlur={() => setTouched((t) => new Set(t).add('key'))}
            invalid={!!(err('key') ?? (f.key && errors.key))}
            className="font-mono"
          />
        </Field>
        <Field label="Description" error={err('description')} className="sm:col-span-2" htmlFor="nr-desc">
          <Textarea id="nr-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What people with this role do" />
        </Field>
        <Field label="Copy permissions from" hint={baseRole ? `${baseRole.permissions.length} permissions` : 'Starts with Dashboard only'} htmlFor="nr-base">
          <Select
            id="nr-base"
            value={base}
            onChange={(e) => {
              setBase(e.target.value)
              const r = roles.find((x) => x.id === e.target.value)
              if (r) setPortal(r.is_admin_portal)
            }}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
            placeholder="Blank role"
          />
        </Field>
        <div className="flex items-end">
          <div className="w-full rounded-lg border border-line bg-white p-3">
            <Switch checked={portal} onChange={setPortal} label="Admin portal" description={portal ? 'Back-office access' : 'Self-service only'} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
