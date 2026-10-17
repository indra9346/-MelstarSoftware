/**
 * Bringing the data layer up.
 *  - Static mode: IndexedDB → (seed if empty / outdated) → memory store. Runs before sign-in,
 *    because the demo logins themselves live in app_users.
 *  - Supabase mode: runs after sign-in; RLS decides what this user loads.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/config/env'
import { db } from './store'
import { LocalBackend } from './local/localBackend'
import { SupabaseBackend } from './supabase/supabaseBackend'
import { installNotificationRules } from '@/services/notificationRules'

let local: LocalBackend | null = null
let supa: SupabaseBackend | null = null
let client: SupabaseClient | null = null

export async function getSupabase(): Promise<SupabaseClient> {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'melstar-erp-auth' },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  }
  return client
}

export async function bootStatic(force = false): Promise<void> {
  local ??= new LocalBackend((t) => db.rows(t))
  const { tables, meta } = await local.load()
  // the demo generator is only needed offline, so it is loaded on demand
  const { SEED_VERSION, generateSeed } = await import('./seed/index')
  if (force || !meta || meta.seed_version !== SEED_VERSION) {
    const seed = await generateSeed(new Date())
    await local.replaceAll(seed.tables, seed.meta)
    db.hydrate(seed.tables)
  } else {
    db.hydrate(tables)
  }
  if (!db.backend) {
    db.attach(local)
    installNotificationRules()
  }
}

/** Wipe the browser copy and regenerate the demo (Settings → Data). */
export async function resetStaticDemo() {
  await bootStatic(true)
}

export async function bootSupabase(): Promise<void> {
  const sb = await getSupabase()
  supa ??= new SupabaseBackend(sb)
  const { tables } = await supa.load()
  db.clear()
  db.hydrate(tables)
  if (!db.backend) db.attach(supa)
}

export function supabaseBackend() {
  return supa
}
