import { db } from '@/data/store'
import type { AuditAction } from '@/data/types'
import { currentSession } from './session'

/**
 * Append an audit-trail entry for the signed-in user.
 *   audit('approve', 'leave_requests', req.id, 'Approved CL for Ravi Kumar M (23 Oct)')
 * Pass `changes` (from diff()) for edits so the audit log shows before → after.
 */
export function audit(action: AuditAction, entity: string, entityId: string | null, summary: string, changes: Record<string, { from: unknown; to: unknown }> | null = null) {
  const s = currentSession()
  db.insert('audit_logs', {
    at: new Date().toISOString(),
    user_id: s?.user.id ?? null,
    user_name: s?.user.display_name ?? 'System',
    action,
    entity,
    entity_id: entityId,
    summary,
    changes,
  })
}

/** Field-level differences between two versions of a row (ignores timestamps). */
export function diff<T extends object>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> | null {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const [k, v] of Object.entries(after)) {
    if (k === 'updated_at' || k === 'created_at') continue
    const prev = (before as Record<string, unknown>)[k]
    if (JSON.stringify(prev) !== JSON.stringify(v)) out[k] = { from: prev, to: v }
  }
  return Object.keys(out).length ? out : null
}
