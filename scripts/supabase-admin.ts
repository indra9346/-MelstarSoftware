/**
 * Shared helpers for the one-off admin scripts (run with `npx vite-node scripts/<name>.ts`).
 * Keys are read through the logged-in Supabase CLI at run time and are never written to disk,
 * except the public URL + publishable key that go into .env.local for the web app.
 */
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'tdykidrgeewhzkvaivts'
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`

interface ApiKey { name: string; type: string; api_key: string }

export function apiKeys() {
  const out = execSync(`npx supabase projects api-keys --project-ref ${PROJECT_REF} --reveal -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const keys = JSON.parse(out) as ApiKey[]
  const find = (pred: (k: ApiKey) => boolean) => keys.find(pred)?.api_key ?? ''
  return {
    publishable: find((k) => k.type === 'publishable') || find((k) => k.name === 'anon'),
    secret: find((k) => k.type === 'secret') || find((k) => k.name === 'service_role'),
  }
}

export function adminClient() {
  const { secret } = apiKeys()
  if (!secret) throw new Error('Could not read the service key — run `npx supabase login` first.')
  return createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}
