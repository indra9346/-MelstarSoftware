// Melstar ERP — login management (Supabase Edge Function).
// Creating Supabase Auth users and resetting passwords needs the service key, which must never
// reach the browser. The web app calls this function with the signed-in user's token; it checks
// that the caller's role has the 'users.manage' permission before doing anything.
//
// Deploy: npx supabase functions deploy admin-users --project-ref <ref> --use-api
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // who is calling?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !caller.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await admin.from('app_users').select('id, display_name, active, roles(permissions)').eq('auth_user_id', caller.user.id).maybeSingle()
  const perms: string[] = (me as { roles?: { permissions?: string[] } } | null)?.roles?.permissions ?? []
  if (!me || !me.active || !perms.includes('users.manage')) return json({ error: 'You do not have permission to manage logins' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const action = String(body.action ?? '')

  try {
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const display_name = String(body.display_name ?? '').trim()
      const role_id = String(body.role_id ?? '')
      const employee_id = body.employee_id ? String(body.employee_id) : null
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid e-mail address' }, 400)
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
      if (!display_name || !role_id) return json({ error: 'Name and role are required' }, 400)

      const { data: existing } = await admin.from('app_users').select('id').ilike('email', email).maybeSingle()
      if (existing) return json({ error: 'A login with this e-mail already exists' }, 409)

      const { data: row, error: insErr } = await admin
        .from('app_users')
        .insert({ email, display_name, role_id, employee_id, active: true, password_hash: null, password_salt: null })
        .select()
        .single()
      if (insErr) return json({ error: insErr.message }, 400)

      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name } })
      if (created.error) {
        await admin.from('app_users').delete().eq('id', row.id)
        return json({ error: created.error.message }, 400)
      }
      const { data: linked } = await admin.from('app_users').update({ auth_user_id: created.data.user.id }).eq('id', row.id).select().single()
      await audit(admin, me, 'create', row.id, `Created login ${email}`)
      return json({ user: linked })
    }

    const userId = String(body.app_user_id ?? '')
    const { data: target } = await admin.from('app_users').select('*').eq('id', userId).maybeSingle()
    if (!target) return json({ error: 'Login not found' }, 404)

    if (action === 'reset_password') {
      const password = String(body.password ?? '')
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)
      if (!target.auth_user_id) return json({ error: 'This login has no Supabase account yet' }, 400)
      const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password })
      if (error) return json({ error: error.message }, 400)
      await audit(admin, me, 'update', target.id, `Reset password for ${target.email}`)
      return json({ ok: true })
    }

    if (action === 'set_active') {
      const active = !!body.active
      if (target.id === me.id && !active) return json({ error: 'You cannot deactivate your own login' }, 400)
      if (target.auth_user_id) await admin.auth.admin.updateUserById(target.auth_user_id, { ban_duration: active ? 'none' : '876000h' })
      const { data: updated } = await admin.from('app_users').update({ active }).eq('id', target.id).select().single()
      await audit(admin, me, 'update', target.id, `${active ? 'Activated' : 'Deactivated'} login ${target.email}`)
      return json({ user: updated })
    }

    if (action === 'delete') {
      if (target.id === me.id) return json({ error: 'You cannot delete your own login' }, 400)
      if (target.auth_user_id) await admin.auth.admin.deleteUser(target.auth_user_id)
      await admin.from('app_users').delete().eq('id', target.id)
      await audit(admin, me, 'delete', target.id, `Deleted login ${target.email}`)
      return json({ ok: true })
    }

    return json({ error: `Unknown action "${action}"` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// deno-lint-ignore no-explicit-any
async function audit(admin: any, me: { id: string; display_name: string }, action: string, entityId: string, summary: string) {
  await admin.from('audit_logs').insert({ at: new Date().toISOString(), user_id: me.id, user_name: me.display_name, action, entity: 'app_users', entity_id: entityId, summary })
}
