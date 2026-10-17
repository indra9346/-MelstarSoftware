/**
 * Read-only RLS smoke test: signs in as the demo employee and the demo admin with the public
 * key and counts what each can see. Run: npx vite-node scripts/verify-rls.ts
 */
import { createClient } from '@supabase/supabase-js'
import { DEMO_CREDENTIALS } from '../src/config/demoCredentials'
import { SUPABASE_URL, apiKeys } from './supabase-admin'

const TABLES = ['employees', 'employee_directory', 'app_users', 'attendance', 'payslips', 'salary_structures', 'leave_requests', 'petty_cash_vouchers', 'petty_cash_entries', 'payroll_runs', 'tasks', 'notifications', 'audit_logs', 'machines', 'inventory_items', 'company_settings', 'announcements', 'advances']

async function counts(email: string, password: string) {
  const sb = createClient(SUPABASE_URL, apiKeys().publishable, { auth: { persistSession: false } })
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`${email}: ${error.message}`)
  const out: Record<string, number | string> = {}
  for (const t of TABLES) {
    const { count, error: e } = await sb.from(t).select('*', { count: 'exact', head: true })
    out[t] = e ? `ERR ${e.message}` : count ?? 0
  }
  // tamper attempts — only for the self-service login (admins are allowed to edit, so never write as admin)
  if (email === DEMO_CREDENTIALS.employee.email) {
    const own = await sb.from('employees').select('id, bank_account').limit(1)
    const me = own.data?.[0]
    if (me) {
      const t1 = await sb.from('employees').update({ bank_account: String(me.bank_account) + '9' }).eq('id', me.id).select('id')
      out['tamper: edit own bank a/c'] = t1.error ? 'blocked' : 'ALLOWED'
    }
    const t2 = await sb.from('payslips').update({ remarks: 'x' }).eq('published', true).select('id')
    out['tamper: edit payslips'] = t2.error ? 'blocked' : `${t2.data?.length ?? 0} rows changed`
  }
  await sb.auth.signOut()
  return out
}

const emp = await counts(DEMO_CREDENTIALS.employee.email, DEMO_CREDENTIALS.employee.password)
const adm = await counts(DEMO_CREDENTIALS.admin.email, DEMO_CREDENTIALS.admin.password)
console.log('table'.padEnd(28), 'employee'.padStart(10), 'admin'.padStart(10))
for (const k of Object.keys(emp)) console.log(k.padEnd(28), String(emp[k]).padStart(10), String(adm[k]).padStart(10))
