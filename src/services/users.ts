/**
 * Login management (Users & roles page).
 * Supabase mode goes through the `admin-users` Edge Function (needs the service key server-side);
 * static mode edits app_users directly with salted SHA-256 hashes.
 */
import { DATA_MODE } from '@/config/env'
import { getSupabase } from '@/data/boot'
import { db } from '@/data/store'
import type { AppUser } from '@/data/types'
import { sha256 } from '@/lib/misc'
import { uuid } from '@/lib/ids'
import { audit } from './audit'

async function callFn<T>(body: Record<string, unknown>): Promise<T> {
  const sb = await getSupabase()
  const { data, error } = await sb.functions.invoke('admin-users', { body })
  if (error) {
    // surface the function's own message when there is one
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const j = await ctx.json().catch(() => null)
      if (j?.error) throw new Error(j.error)
    }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

export interface NewLogin {
  email: string
  password: string
  display_name: string
  role_id: string
  employee_id: string | null
}

export async function createLogin(input: NewLogin): Promise<AppUser> {
  const email = input.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid e-mail address.')
  if (input.password.length < 8) throw new Error('Password must be at least 8 characters.')
  if (db.find('app_users', (u) => u.email.toLowerCase() === email)) throw new Error('A login with this e-mail already exists.')
  if (input.employee_id && db.find('app_users', (u) => u.employee_id === input.employee_id)) throw new Error('This employee already has a login.')
  if (DATA_MODE === 'supabase') {
    const { user } = await callFn<{ user: AppUser }>({ action: 'create', ...input, email })
    db.ingest('app_users', user)
    return user
  }
  const salt = uuid().slice(0, 8)
  const row = db.insert('app_users', {
    email, display_name: input.display_name.trim(), role_id: input.role_id, employee_id: input.employee_id, password_salt: salt,
    password_hash: await sha256(salt + input.password), active: true, last_login_at: null, auth_user_id: null,
  })
  audit('create', 'app_users', row.id, `Created login ${email}`)
  return row
}

/** Name / role / linked employee. */
export function updateLogin(id: string, patch: Pick<Partial<AppUser>, 'display_name' | 'role_id' | 'employee_id'>) {
  const before = db.get('app_users', id)
  if (!before) throw new Error('Login not found')
  const row = db.update('app_users', id, patch)
  audit('update', 'app_users', id, `Updated login ${before.email}`)
  return row
}

export async function resetPassword(id: string, password: string) {
  if (password.length < 8) throw new Error('Password must be at least 8 characters.')
  const u = db.get('app_users', id)
  if (!u) throw new Error('Login not found')
  if (DATA_MODE === 'supabase') return void (await callFn({ action: 'reset_password', app_user_id: id, password }))
  const salt = uuid().slice(0, 8)
  db.update('app_users', id, { password_salt: salt, password_hash: await sha256(salt + password) })
  audit('update', 'app_users', id, `Reset password for ${u.email}`)
}

export async function setActive(id: string, active: boolean) {
  const u = db.get('app_users', id)
  if (!u) throw new Error('Login not found')
  if (DATA_MODE === 'supabase') {
    const { user } = await callFn<{ user: AppUser }>({ action: 'set_active', app_user_id: id, active })
    db.ingest('app_users', user)
    return
  }
  db.update('app_users', id, { active })
  audit('update', 'app_users', id, `${active ? 'Activated' : 'Deactivated'} login ${u.email}`)
}

export async function deleteLogin(id: string) {
  const u = db.get('app_users', id)
  if (!u) return
  if (DATA_MODE === 'supabase') {
    await callFn({ action: 'delete', app_user_id: id })
    // the server already removed it; drop it locally without a second delete
    db.forget('app_users', id) // the Edge Function writes the audit entry
    return
  }
  db.remove('app_users', id)
  audit('delete', 'app_users', id, `Deleted login ${u.email}`)
}
