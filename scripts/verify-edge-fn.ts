/**
 * Checks the admin-users Edge Function's guards without creating anything:
 * an employee is refused (403); an admin's invalid request is rejected by validation (400);
 * a request with no login is refused (401). Run: npx vite-node scripts/verify-edge-fn.ts
 */
import { createClient } from '@supabase/supabase-js'
import { DEMO_CREDENTIALS } from '../src/config/demoCredentials'
import { SUPABASE_URL, apiKeys } from './supabase-admin'

const key = apiKeys().publishable
async function call(who: 'admin' | 'employee' | null, body: Record<string, unknown>) {
  const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })
  if (who) await sb.auth.signInWithPassword({ email: DEMO_CREDENTIALS[who].email, password: DEMO_CREDENTIALS[who].password })
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${(await sb.auth.getSession()).data.session?.access_token ?? key}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (who) await sb.auth.signOut()
  return `${res.status} ${text.slice(0, 120)}`
}
console.log('no login       :', await call(null, { action: 'create', email: 'x@y.z' }))
console.log('employee       :', await call('employee', { action: 'create', email: 'x@y.z', password: 'xxxxxxxx', display_name: 'X', role_id: 'r' }))
console.log('admin, bad mail:', await call('admin', { action: 'create', email: 'not-an-email', password: 'xxxxxxxx', display_name: 'X', role_id: 'r' }))
console.log('admin, bad id  :', await call('admin', { action: 'reset_password', app_user_id: '00000000-0000-0000-0000-000000000000', password: 'abcdefgh1' }))
