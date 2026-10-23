/**
 * Sign-in and the current session.
 *
 * Static mode: e-mail + password checked against app_users (SHA-256 + salt) in this browser.
 * Supabase mode: Supabase Auth (email/password); app_users.auth_user_id links the login to a
 * role and, optionally, an employee record. RLS uses the same link on the server.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DATA_MODE } from '@/config/env'
import { bootStatic, bootSupabase, getSupabase } from '@/data/boot'
import { db, useTable } from '@/data/store'
import { runAutopilot } from '@/data/seed/autopilot'
import type { AppUser, Employee, Permission, Role } from '@/data/types'
import { sha256 } from '@/lib/misc'
import { uuid } from '@/lib/ids'

export interface Session {
  user: AppUser
  role: Role
  employee: Employee | null
  can: (p: Permission) => boolean
  canAny: (ps: Permission[]) => boolean
  isAdminPortal: boolean
}

let current: Session | null = null
/** Session for non-React code (services, audit). */
export function currentSession(): Session | null {
  return current
}

/**
 * Maker-checker: approvers may not decide their own leave, claims, advances, corrections or OT.
 * A Super Admin (settings access) has nobody above them, so they are exempt.
 */
export function selfApprovalBlock(employeeId: string, s: Session | null = current): string | null {
  if (!s?.employee || s.employee.id !== employeeId || s.can('settings.manage')) return null
  return 'You cannot approve your own request. Another approver has to decide it.'
}

function makeSession(user: AppUser, role: Role, employee: Employee | null): Session {
  const perms = new Set(role.permissions)
  return {
    user,
    role,
    employee,
    can: (p) => perms.has(p),
    canAny: (ps) => ps.some((p) => perms.has(p)),
    isAdminPortal: role.is_admin_portal,
  }
}

type Status = 'booting' | 'signed_out' | 'loading' | 'ready' | 'error'

interface AuthState {
  status: Status
  session: Session | null
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const STATIC_SESSION_KEY = 'melstar-erp-session'

function readStaticSession(): string | null {
  try {
    return localStorage.getItem(STATIC_SESSION_KEY)
  } catch {
    return null
  }
}
function writeStaticSession(id: string | null) {
  try {
    if (id) localStorage.setItem(STATIC_SESSION_KEY, id)
    else localStorage.removeItem(STATIC_SESSION_KEY)
  } catch {
    /* private mode — session lasts for this tab only */
  }
}

function logAudit(user: AppUser, action: 'login' | 'logout', summary: string) {
  db.insert('audit_logs', { at: new Date().toISOString(), user_id: user.id, user_name: user.display_name, action, entity: 'auth', entity_id: null, summary, changes: null })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('booting')
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const users = useTable('app_users')
  const roles = useTable('roles')
  const employees = useTable('employees')
  const booted = useRef(false)

  // Session is derived from live rows, so a role/permission change applies immediately.
  const session = useMemo(() => {
    if (!userId) return null
    const user = users.find((u) => u.id === userId)
    const role = user && roles.find((r) => r.id === user.role_id)
    if (!user || !role || !user.active) return null
    return makeSession(user, role, user.employee_id ? employees.find((e) => e.id === user.employee_id) ?? null : null)
  }, [userId, users, roles, employees])
  current = session

  // Demo autopilot (simulated biometric punches) once per signed-in session.
  const autopiloted = useRef<string | null>(null)
  useEffect(() => {
    if (status === 'ready' && session && autopiloted.current !== session.user.id) {
      autopiloted.current = session.user.id
      runAutopilot()
    }
  }, [status, session])

  // A deactivated user is signed out at once.
  useEffect(() => {
    if (status === 'ready' && userId && !session) {
      setUserId(null)
      setStatus('signed_out')
      writeStaticSession(null)
    }
  }, [status, userId, session])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    ;(async () => {
      try {
        if (DATA_MODE === 'static') {
          await bootStatic()
          const saved = readStaticSession()
          const u = saved ? db.get('app_users', saved) : undefined
          if (u?.active) {
            setUserId(u.id)
            setStatus('ready')
          } else setStatus('signed_out')
          return
        }
        const sb = await getSupabase()
        const { data } = await sb.auth.getSession()
        if (!data.session) return setStatus('signed_out')
        setStatus('loading')
        await bootSupabase()
        const me = db.find('app_users', (u) => u.auth_user_id === data.session!.user.id)
        if (!me) {
          await sb.auth.signOut()
          setError('Your login is not set up in Melstar ERP yet. Please contact the administrator.')
          return setStatus('signed_out')
        }
        setUserId(me.id)
        setStatus('ready')
        sb.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_OUT') {
            setUserId(null)
            setStatus('signed_out')
            db.clear()
          }
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      }
    })()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    const mail = email.trim().toLowerCase()
    if (DATA_MODE === 'static') {
      const u = db.find('app_users', (x) => x.email.toLowerCase() === mail)
      const ok = !!u && u.active && !!u.password_hash && (await sha256((u.password_salt ?? '') + password)) === u.password_hash
      if (!u || !ok) throw new Error('Incorrect e-mail or password.')
      db.update('app_users', u.id, { last_login_at: new Date().toISOString() })
      logAudit(u, 'login', 'Signed in')
      writeStaticSession(u.id)
      setUserId(u.id)
      setStatus('ready')
      return
    }
    const sb = await getSupabase()
    const { data, error: err } = await sb.auth.signInWithPassword({ email: mail, password })
    if (err) throw new Error(/invalid login/i.test(err.message) ? 'Incorrect e-mail or password.' : err.message)
    setStatus('loading')
    try {
      await bootSupabase()
    } catch (e) {
      setStatus('signed_out')
      throw e
    }
    const me = db.find('app_users', (u) => u.auth_user_id === data.user.id)
    if (!me || !me.active) {
      await sb.auth.signOut()
      db.clear()
      setStatus('signed_out')
      throw new Error('Your login is not set up in Melstar ERP yet. Please contact the administrator.')
    }
    await sb.rpc('touch_last_login')
    logAudit(me, 'login', 'Signed in')
    setUserId(me.id)
    setStatus('ready')
  }, [])

  const signOut = useCallback(async () => {
    const s = current
    if (s) logAudit(s.user, 'logout', 'Signed out')
    if (DATA_MODE === 'static') {
      writeStaticSession(null)
    } else {
      await db.flushed().catch(() => {})
      const sb = await getSupabase()
      await sb.auth.signOut()
      db.clear()
    }
    setUserId(null)
    setStatus('signed_out')
  }, [])

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const s = current
    if (!s) throw new Error('Not signed in')
    if (newPassword.length < 8) throw new Error('Use at least 8 characters.')
    if (DATA_MODE === 'static') {
      const ok = (await sha256((s.user.password_salt ?? '') + oldPassword)) === s.user.password_hash
      if (!ok) throw new Error('Current password is incorrect.')
      const salt = uuid().slice(0, 8)
      db.update('app_users', s.user.id, { password_salt: salt, password_hash: await sha256(salt + newPassword) })
      return
    }
    const sb = await getSupabase()
    const check = await sb.auth.signInWithPassword({ email: s.user.email, password: oldPassword })
    if (check.error) throw new Error('Current password is incorrect.')
    const { error: err } = await sb.auth.updateUser({ password: newPassword })
    if (err) throw new Error(err.message)
  }, [])

  const value = useMemo<AuthState>(() => ({ status, session, error, signIn, signOut, changePassword }), [status, session, error, signIn, signOut, changePassword])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

/** The signed-in session (only use inside routes that require login). */
export function useSession(): Session {
  const { session } = useAuth()
  if (!session) throw new Error('No session')
  return session
}
