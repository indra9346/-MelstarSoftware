/**
 * Signs in with every demo login (read-only) and prints the role and portal each one gets.
 * Run: npx vite-node scripts/verify-logins.ts
 */
import { createClient } from '@supabase/supabase-js'
import { DEMO_LOGINS } from '../src/config/demoCredentials'
import { SUPABASE_URL, apiKeys } from './supabase-admin'

const key = apiKeys().publishable
for (const d of DEMO_LOGINS) {
  const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: d.email, password: d.password })
  if (error) {
    console.log(`${d.role.padEnd(22)} FAILED  ${error.message}`)
    continue
  }
  const { data: me } = await sb.from('app_users').select('display_name, employee_id, roles(name, is_admin_portal, permissions)').eq('auth_user_id', data.user.id).single()
  const role = (me as { roles?: { name: string; is_admin_portal: boolean; permissions: string[] } } | null)?.roles
  console.log(`${d.role.padEnd(22)} ok      ${String(me?.display_name).padEnd(16)} role=${role?.name} · ${role?.is_admin_portal ? 'admin portal' : 'employee portal'} · ${role?.permissions.length ?? 0} permissions${me?.employee_id ? ' · has My space' : ''}`)
  await sb.auth.signOut()
}
