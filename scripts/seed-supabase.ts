/**
 * Load the Melstar demo data into Supabase and create the Supabase Auth logins.
 *
 *   npx vite-node scripts/seed-supabase.ts            # refuses if data already exists
 *   npx vite-node scripts/seed-supabase.ts --reset    # wipes ERP tables + demo logins, then seeds
 *
 * Uses the service key (read via the Supabase CLI), so RLS is bypassed for the load.
 * Afterwards it writes .env.local (URL + publishable key) for the web app.
 */
import { writeFileSync } from 'node:fs'
import type { AnyRow } from '../src/data/backend'
import { generateSeed } from '../src/data/seed/index'
import { DEMO_CREDENTIALS, DEMO_DEFAULT_EMPLOYEE_PASSWORD } from '../src/config/demoCredentials'
import type { TableName } from '../src/data/types'
import { PROJECT_REF, SUPABASE_URL, adminClient, apiKeys } from './supabase-admin'

const reset = process.argv.includes('--reset')
const sb = adminClient()

/** Insert order respects foreign keys; cyclic columns are patched in phase 2. */
const ORDER: TableName[] = [
  'company_settings', 'directors', 'roles', 'departments', 'shifts', 'work_centres', 'designations', 'employees', 'app_users',
  'audit_logs', 'notifications', 'emergency_contacts', 'employee_documents', 'attendance', 'regularisations', 'leave_types',
  'leave_balances', 'leave_requests', 'holidays', 'salary_structures', 'payroll_runs', 'payslips', 'advances', 'advance_recoveries',
  'petty_cash_vouchers', 'petty_cash_entries', 'tasks', 'task_comments', 'todos', 'announcements', 'announcement_reads',
  'machines', 'maintenance_schedules', 'maintenance_logs', 'vendors', 'customers', 'inventory_items', 'stock_movements',
  'tool_issues', 'assets', 'purchase_orders', 'purchase_order_lines', 'work_orders', 'inspections', 'ncrs',
]
const CYCLIC: Partial<Record<TableName, string[]>> = {
  departments: ['head_employee_id'],
  work_centres: ['supervisor_id'],
  employees: ['reporting_to'],
  petty_cash_vouchers: ['ledger_entry_id'],
}

async function insertChunks(table: TableName, rows: AnyRow[], upsert = false) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = upsert ? await sb.from(table).upsert(chunk, { onConflict: 'id' }) : await sb.from(table).insert(chunk)
    if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`)
  }
}

async function wipe() {
  const { data: users } = await sb.from('app_users').select('auth_user_id')
  for (const t of [...ORDER].reverse()) {
    if (t === 'petty_cash_vouchers') await sb.from('petty_cash_vouchers').update({ ledger_entry_id: null }).not('id', 'is', null)
    if (t === 'employees') {
      await sb.from('departments').update({ head_employee_id: null }).not('id', 'is', null)
      await sb.from('work_centres').update({ supervisor_id: null }).not('id', 'is', null)
      await sb.from('employees').update({ reporting_to: null }).not('id', 'is', null)
    }
    const { error } = await sb.from(t).delete().not('id', 'is', null)
    if (error) throw new Error(`wipe ${t}: ${error.message}`)
  }
  for (const u of users ?? []) if (u.auth_user_id) await sb.auth.admin.deleteUser(u.auth_user_id)
  console.log('  wiped existing ERP data and demo logins')
}

async function ensureAuthUser(email: string, password: string, displayName: string): Promise<string> {
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } })
  if (!created.error) return created.data.user.id
  // already exists → find it and reset the password
  for (let page = 1; page < 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase())
    if (u) {
      await sb.auth.admin.updateUserById(u.id, { password, email_confirm: true })
      return u.id
    }
    if (data.users.length < 200) break
  }
  throw new Error(`Could not create auth user ${email}: ${created.error.message}`)
}

async function main() {
  console.log(`Seeding Supabase project ${PROJECT_REF} …`)
  const { count } = await sb.from('employees').select('id', { count: 'exact', head: true })
  if (count && !reset) {
    console.log(`  ${count} employees already exist — nothing done. Re-run with --reset to wipe and re-seed.`)
    return
  }
  if (reset) await wipe()

  const { tables } = await generateSeed(new Date())
  // Supabase Auth owns passwords: never store the static-mode hashes.
  for (const u of tables.app_users ?? []) Object.assign(u, { password_hash: null, password_salt: null, auth_user_id: null })

  const patches: [TableName, AnyRow[]][] = []
  for (const t of ORDER) {
    const rows = tables[t] ?? []
    if (!rows.length) continue
    const cyc = CYCLIC[t]
    if (cyc) {
      patches.push([t, rows.map((r) => ({ ...r }))])
      await insertChunks(t, rows.map((r) => ({ ...r, ...Object.fromEntries(cyc.map((c) => [c, null])) })))
    } else {
      await insertChunks(t, rows)
    }
    process.stdout.write(`  ${t.padEnd(24)} ${String(rows.length).padStart(5)}\n`)
  }
  for (const [t, rows] of patches) await insertChunks(t, rows, true)
  console.log('  linked departments, supervisors, reporting lines and petty-cash ledger')

  // Supabase Auth logins for every app user
  const passwords: Record<string, string> = {
    [DEMO_CREDENTIALS.admin.email]: DEMO_CREDENTIALS.admin.password,
    [DEMO_CREDENTIALS.employee.email]: DEMO_CREDENTIALS.employee.password,
  }
  for (const u of tables.app_users ?? []) {
    const email = String(u.email)
    const id = await ensureAuthUser(email, passwords[email] ?? DEMO_DEFAULT_EMPLOYEE_PASSWORD, String(u.display_name))
    const { error } = await sb.from('app_users').update({ auth_user_id: id }).eq('id', u.id)
    if (error) throw new Error(`link ${email}: ${error.message}`)
    console.log(`  login ready: ${email}`)
  }

  const { publishable } = apiKeys()
  writeFileSync(
    '.env.local',
    `# Written by scripts/seed-supabase.ts — public values only (safe for the browser).\nVITE_STATIC_DATA_MODE=false\nVITE_MELSTAR_SUPABASE_URL=${SUPABASE_URL}\nVITE_MELSTAR_SUPABASE_KEY=${publishable}\n# demo: one-tap role logins on the sign-in page (set false at go-live)\nVITE_SHOW_DEMO_LOGINS=true\n`,
  )
  console.log('  wrote .env.local (Supabase mode)')
  console.log('Done.')
}

main().catch((e) => {
  console.error('Seed failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
