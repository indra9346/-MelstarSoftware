/**
 * Notice board. "Announcement posted" notifications are created by the database
 * (notificationRules in demo mode) — never insert them here.
 */
import type { LucideIcon } from 'lucide-react'
import { Award, CalendarDays, Factory, Megaphone, ShieldAlert, Users } from 'lucide-react'
import { db } from '@/data/store'
import type { Announcement, AnnouncementCategory, AppUser, Employee } from '@/data/types'
import { todayISO } from '@/lib/dates'
import type { Tone } from '@/components/ui'
import { audit, diff } from './audit'
import { currentSession, type Session } from './session'

/* ── meta ─────────────────────────────────────────────────────────────────── */

export const CATEGORIES: AnnouncementCategory[] = ['general', 'safety', 'hr', 'production', 'celebration', 'holiday']

export const CATEGORY_META: Record<AnnouncementCategory, { label: string; icon: LucideIcon; tone: Tone; bar: string; soft: string }> = {
  general: { label: 'General', icon: Megaphone, tone: 'indigo', bar: 'bg-brand-600', soft: 'bg-brand-50 text-brand-700' },
  safety: { label: 'Safety', icon: ShieldAlert, tone: 'red', bar: 'bg-red-600', soft: 'bg-red-50 text-red-700' },
  hr: { label: 'HR', icon: Users, tone: 'violet', bar: 'bg-violet-600', soft: 'bg-violet-50 text-violet-700' },
  production: { label: 'Production', icon: Factory, tone: 'cyan', bar: 'bg-teal-600', soft: 'bg-teal-50 text-teal-700' },
  celebration: { label: 'Celebration', icon: Award, tone: 'amber', bar: 'bg-amber-500', soft: 'bg-amber-50 text-amber-800' },
  holiday: { label: 'Holiday', icon: CalendarDays, tone: 'green', bar: 'bg-emerald-600', soft: 'bg-emerald-50 text-emerald-700' },
}

export const ANN_PRIORITIES: Announcement['priority'][] = ['normal', 'important', 'urgent']

export const ANN_PRIORITY_META: Record<Announcement['priority'], { label: string; tone: Tone }> = {
  normal: { label: 'Normal', tone: 'slate' },
  important: { label: 'Important', tone: 'amber' },
  urgent: { label: 'Urgent', tone: 'red' },
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

export function isExpired(a: Pick<Announcement, 'expires_on'>, today = todayISO()): boolean {
  return !!a.expires_on && a.expires_on < today
}

/** Pinned first, then newest. */
export function sortAnnouncements<T extends Pick<Announcement, 'pinned' | 'published_at'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.published_at.localeCompare(a.published_at))
}

/** Is the announcement addressed to someone in this department? (empty audience = everyone) */
export function isForDepartment(a: Pick<Announcement, 'audience_department_ids'>, departmentId: string | null | undefined): boolean {
  return !a.audience_department_ids.length || (!!departmentId && a.audience_department_ids.includes(departmentId))
}

/** Active app users the announcement is addressed to. */
export function audienceUsers(a: Pick<Announcement, 'audience_department_ids'>, users: readonly AppUser[], employees: ReadonlyMap<string, Employee>): AppUser[] {
  return users.filter((u) => {
    if (!u.active) return false
    if (!a.audience_department_ids.length) return true
    const dept = u.employee_id ? employees.get(u.employee_id)?.department_id : null
    return !!dept && a.audience_department_ids.includes(dept)
  })
}

/* ── validation ───────────────────────────────────────────────────────────── */

export interface AnnouncementInput {
  title: string
  body: string
  category: AnnouncementCategory
  priority: Announcement['priority']
  audience_department_ids: string[]
  pinned: boolean
  expires_on: string | null
}

export type AnnouncementErrors = Partial<Record<keyof AnnouncementInput, string>>

export function announcementErrors(a: AnnouncementInput, original?: Announcement | null): AnnouncementErrors {
  const e: AnnouncementErrors = {}
  const title = a.title.trim()
  if (title.length < 3) e.title = 'Give it a headline (at least 3 characters).'
  else if (title.length > 120) e.title = 'Keep the headline under 120 characters.'
  const body = a.body.trim()
  if (body.length < 10) e.body = 'Write the message (at least 10 characters).'
  else if (body.length > 5000) e.body = 'Keep the message under 5,000 characters.'
  if (!CATEGORIES.includes(a.category)) e.category = 'Choose a category.'
  if (!ANN_PRIORITIES.includes(a.priority)) e.priority = 'Choose a priority.'
  if (a.expires_on && a.expires_on < todayISO() && a.expires_on !== original?.expires_on) e.expires_on = 'The expiry date cannot be in the past.'
  return e
}

function clean(a: AnnouncementInput): AnnouncementInput {
  return {
    title: a.title.trim(),
    body: a.body.trim(),
    category: a.category,
    priority: a.priority,
    audience_department_ids: [...new Set(a.audience_department_ids)],
    pinned: a.pinned,
    expires_on: a.expires_on || null,
  }
}

function requireManage(): Session {
  const s = currentSession()
  if (!s) throw new Error('You are not signed in.')
  if (!s.can('announcements.manage')) throw new Error('You do not have permission to manage announcements.')
  return s
}

/* ── writes ───────────────────────────────────────────────────────────────── */

export function publish(input: AnnouncementInput): Announcement {
  const s = requireManage()
  const first = Object.values(announcementErrors(input))[0]
  if (first) throw new Error(first)
  const row = db.insert('announcements', {
    ...clean(input),
    published_at: new Date().toISOString(),
    created_by: s.user.id,
    author_name: s.user.display_name,
  })
  audit('create', 'announcements', row.id, `Published announcement “${row.title}”`)
  return row
}

export function update(id: string, input: AnnouncementInput): Announcement {
  requireManage()
  const before = db.get('announcements', id)
  if (!before) throw new Error('This announcement no longer exists.')
  const first = Object.values(announcementErrors(input, before))[0]
  if (first) throw new Error(first)
  const patch = clean(input)
  const changes = diff(before, patch)
  if (!changes) return before
  const changed = Object.fromEntries(Object.keys(changes).map((k) => [k, patch[k as keyof AnnouncementInput]])) as Partial<Announcement>
  const row = db.update('announcements', id, changed)
  audit('update', 'announcements', id, `Edited announcement “${row.title}”`, changes)
  return row
}

export function setPinned(id: string, pinned: boolean): Announcement {
  requireManage()
  const before = db.get('announcements', id)
  if (!before) throw new Error('This announcement no longer exists.')
  const row = db.update('announcements', id, { pinned })
  audit('update', 'announcements', id, `${pinned ? 'Pinned' : 'Unpinned'} announcement “${before.title}”`, { pinned: { from: before.pinned, to: pinned } })
  return row
}

export function remove(id: string) {
  requireManage()
  const a = db.get('announcements', id)
  if (!a) return
  const reads = db.where('announcement_reads', (r) => r.announcement_id === id)
  db.batch(() => {
    // read receipts cascade on the server; demo mode removes them locally
    for (const r of reads) {
      if (db.backend?.kind === 'supabase') db.forget('announcement_reads', r.id)
      else db.remove('announcement_reads', r.id)
    }
    db.remove('announcements', id)
  })
  audit('delete', 'announcements', id, `Deleted announcement “${a.title}”`)
}

/** Record read receipts for the signed-in user (once per announcement). Returns how many were new. */
export function markRead(ids: readonly string[]): number {
  const s = currentSession()
  if (!s || !ids.length) return 0
  const mine = new Set(db.where('announcement_reads', (r) => r.user_id === s.user.id).map((r) => r.announcement_id))
  const fresh = [...new Set(ids)].filter((id) => !mine.has(id) && db.get('announcements', id))
  if (!fresh.length) return 0
  const now = new Date().toISOString()
  db.batch(() => {
    for (const id of fresh) db.insert('announcement_reads', { announcement_id: id, user_id: s.user.id, read_at: now })
  })
  const first = db.get('announcements', fresh[0]!)
  audit('update', 'announcement_reads', fresh.length === 1 ? fresh[0]! : null, fresh.length === 1 ? `Read announcement “${first?.title ?? ''}”` : `Read ${fresh.length} announcements`)
  return fresh.length
}
