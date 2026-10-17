import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarX2, Eye, Megaphone, Pencil, Pin, PinOff, Plus, Search, Send, Trash2, Users } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { Announcement, AnnouncementCategory } from '@/data/types'
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Menu, Modal, PageHeader, Progress, Segmented, StatCard, Switch, Tabs, Textarea, confirm, guard, toast, type MenuItem } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import {
  ANN_PRIORITIES, ANN_PRIORITY_META, CATEGORIES, CATEGORY_META, announcementErrors, audienceUsers, isExpired, publish, remove, setPinned, sortAnnouncements, update, type AnnouncementInput,
} from '@/services/announcements'
import { addDays, fmtDate, fmtDateTime, relativeTime, todayISO } from '@/lib/dates'
import { fullName, pct } from '@/lib/format'
import { cn } from '@/lib/misc'

type StatusFilter = 'active' | 'expired' | 'all'

export default function AnnouncementsPage() {
  const s = useSession()
  const L = useLookups()
  const announcements = useTable('announcements')
  const reads = useTable('announcement_reads')
  const users = useTable('app_users')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [category, setCategory] = useState<'' | AnnouncementCategory>('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ open: boolean; item: Announcement | null }>({ open: false, item: null })
  const [receiptsFor, setReceiptsFor] = useState<string | null>(null)
  const closeForm = useCallback(() => setForm((f) => ({ ...f, open: false })), [])
  const closeReceipts = useCallback(() => setReceiptsFor(null), [])

  const today = todayISO()
  // Supabase: app_users are only visible to Users & roles managers — without that, audience size is unknown.
  const audienceKnown = db.backend?.kind !== 'supabase' || s.can('users.manage')

  const readsBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of reads) m.set(r.announcement_id, (m.get(r.announcement_id) ?? 0) + 1)
    return m
  }, [reads])
  const audienceCount = useCallback((a: Pick<Announcement, 'audience_department_ids'>) => audienceUsers(a, users, L.emp).length, [users, L.emp])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sortAnnouncements(
      announcements.filter((a) => {
        const expired = isExpired(a, today)
        if (status === 'active' && expired) return false
        if (status === 'expired' && !expired) return false
        if (category && a.category !== category) return false
        if (needle && !`${a.title} ${a.body} ${a.author_name}`.toLowerCase().includes(needle)) return false
        return true
      }),
    )
  }, [announcements, status, category, q, today])

  const stats = useMemo(() => {
    const active = announcements.filter((a) => !isExpired(a, today))
    const rates = active.map((a) => {
      const n = audienceCount(a)
      return n ? Math.min(1, (readsBy.get(a.id) ?? 0) / n) : 0
    })
    return {
      active: active.length,
      pinned: active.filter((a) => a.pinned).length,
      expired: announcements.length - active.length,
      readRate: rates.length ? (rates.reduce((x, y) => x + y, 0) / rates.length) * 100 : 0,
    }
  }, [announcements, readsBy, audienceCount, today])

  const del = async (a: Announcement) => {
    const ok = await confirm({ title: 'Delete announcement?', message: `“${a.title}” will be removed from everyone’s feed along with its read receipts.`, danger: true, confirmLabel: 'Delete' })
    if (ok) await guard(() => remove(a.id), 'Announcement deleted')
  }

  return (
    <div>
      <PageHeader
        kicker="Communication"
        title="Announcements"
        subtitle="Notices for the plant — holidays, safety, HR and production updates. Staff are notified automatically."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true, item: null })}>
            New announcement
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Active notices" value={stats.active} icon={<Megaphone className="h-4 w-4" />} accent="indigo" onClick={() => setStatus('active')} />
        <StatCard label="Pinned" value={stats.pinned} icon={<Pin className="h-4 w-4" />} accent="pink" />
        <StatCard label="Average read rate" value={stats.readRate} format={(n) => (audienceKnown ? pct(n) : '—')} icon={<Eye className="h-4 w-4" />} accent="green" hint={audienceKnown ? 'Across active notices' : 'Needs Users & roles access'} />
        <StatCard label="Expired" value={stats.expired} icon={<CalendarX2 className="h-4 w-4" />} accent="amber" onClick={() => setStatus('expired')} />
      </div>

      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<StatusFilter>
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'expired', label: 'Expired' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="min-w-0 flex-1 basis-56">
            <Input value={q} onChange={(e) => setQ(e.target.value)} leading={<Search className="h-4 w-4" />} placeholder="Search announcements…" className="h-10 py-0 text-sm" type="search" aria-label="Search announcements" />
          </div>
        </div>
        <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <CategoryChip active={!category} onClick={() => setCategory('')} label="All" />
          {CATEGORIES.map((c) => {
            const Icon = CATEGORY_META[c].icon
            return <CategoryChip key={c} active={category === c} onClick={() => setCategory(category === c ? '' : c)} label={CATEGORY_META[c].label} icon={<Icon className="h-3.5 w-3.5" />} />
          })}
        </div>
      </Card>

      {!list.length ? (
        <EmptyState
          icon={<Megaphone className="h-6 w-6" />}
          title={announcements.length ? 'Nothing matches' : 'No announcements yet'}
          description={announcements.length ? 'Try another filter.' : 'Post holidays, safety alerts and plant news. Everyone in the audience gets a notification.'}
          action={
            !announcements.length ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ open: true, item: null })}>
                Post the first announcement
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AnimatePresence initial={false}>
            {list.map((a, i) => {
              const audience = audienceCount(a)
              const readN = readsBy.get(a.id) ?? 0
              const items: MenuItem[] = [
                { label: 'Edit', icon: <Pencil />, onClick: () => setForm({ open: true, item: a }) },
                { label: a.pinned ? 'Unpin' : 'Pin to top', icon: a.pinned ? <PinOff /> : <Pin />, onClick: () => void guard(() => setPinned(a.id, !a.pinned), a.pinned ? 'Unpinned' : 'Pinned to the top') },
                { label: 'Read receipts', icon: <Eye />, onClick: () => setReceiptsFor(a.id) },
                { label: 'Delete', icon: <Trash2 />, onClick: () => void del(a), danger: true },
              ]
              return (
                <motion.div key={a.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }} exit={{ opacity: 0, scale: 0.97 }} className="min-w-0">
                  <AnnouncementCard
                    a={a}
                    deptNames={a.audience_department_ids.map((d) => L.deptName(d))}
                    menu={items}
                    footer={
                      <button type="button" onClick={() => setReceiptsFor(a.id)} className="group/rr mt-4 block w-full rounded-xl bg-slate-50/80 px-3 py-2.5 text-left transition hover:bg-indigo-50">
                        <span className="flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="flex items-center gap-1.5 font-semibold text-ink">
                            <Eye className="h-3.5 w-3.5 text-brand-indigo" />
                            {audienceKnown ? `${readN} of ${audience} read` : `${readN} read`}
                          </span>
                          <span className="font-semibold text-brand-indigo opacity-70 transition group-hover/rr:opacity-100">Receipts →</span>
                        </span>
                        {audienceKnown && <Progress value={readN} max={Math.max(1, audience)} className="mt-2 h-1.5" />}
                      </button>
                    }
                  />
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <AnnouncementForm open={form.open} item={form.item} onClose={closeForm} audienceKnown={audienceKnown} />
      <ReadReceipts id={receiptsFor} onClose={closeReceipts} audienceKnown={audienceKnown} />
    </div>
  )
}

function CategoryChip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition', active ? 'bg-ink text-white shadow-soft' : 'bg-white text-ink-soft ring-1 ring-inset ring-indigo-100 hover:text-ink')}
    >
      {icon}
      {label}
    </button>
  )
}

/* ── card (also used as the live preview) ─────────────────────────────── */

function AnnouncementCard({ a, deptNames, menu, footer, preview }: { a: Pick<Announcement, 'title' | 'body' | 'category' | 'priority' | 'pinned' | 'expires_on' | 'author_name' | 'published_at'>; deptNames: string[]; menu?: MenuItem[]; footer?: ReactNode; preview?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const meta = CATEGORY_META[a.category]
  const Icon = meta.icon
  const expired = isExpired(a)
  const long = a.body.length > 320 || a.body.split('\n').length > 5
  return (
    <Card className={cn('relative h-full overflow-hidden', expired && !preview && 'opacity-75', a.priority === 'urgent' && 'ring-2 ring-rose-300/70')}>
      <span className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', meta.gradient)} aria-hidden />
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-soft', meta.gradient)}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider', meta.soft)}>{meta.label}</span>
              {a.priority !== 'normal' && <Badge tone={ANN_PRIORITY_META[a.priority].tone} dot>{ANN_PRIORITY_META[a.priority].label}</Badge>}
              {a.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-bold text-pink-600">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
              {expired && <Badge tone="slate">Expired</Badge>}
            </div>
            <h3 className="mt-1.5 break-words text-[17px] font-bold leading-snug text-ink">{a.title || 'Your headline'}</h3>
          </div>
          {menu && <Menu items={menu} />}
        </div>
        <p className={cn('mt-3 whitespace-pre-line break-words text-[14px] leading-relaxed text-ink-soft', !expanded && long && 'line-clamp-5')}>{a.body || 'Your message appears here.'}</p>
        {long && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-[12.5px] font-semibold text-brand-indigo hover:underline">
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={a.author_name || 'Admin'} size={20} />
            <span className="font-semibold text-ink-soft">{a.author_name || 'Admin'}</span>
          </span>
          <span title={fmtDateTime(a.published_at)}>{preview ? 'Just now' : relativeTime(a.published_at)}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {deptNames.length ? deptNames.join(', ') : 'Everyone'}
          </span>
          {a.expires_on && <span>{expired ? 'Expired' : 'Until'} {fmtDate(a.expires_on)}</span>}
        </div>
        {footer}
      </div>
    </Card>
  )
}

/* ── create / edit ───────────────────────────────────────────────────────── */

const blank = (): AnnouncementInput => ({ title: '', body: '', category: 'general', priority: 'normal', audience_department_ids: [], pinned: false, expires_on: null })

function AnnouncementForm({ open, item, onClose, audienceKnown }: { open: boolean; item: Announcement | null; onClose: () => void; audienceKnown: boolean }) {
  const s = useSession()
  const L = useLookups()
  const users = useTable('app_users')
  const departments = useTable('departments')
  const [v, setV] = useState<AnnouncementInput>(blank)
  const [everyone, setEveryone] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    const init = item
      ? { title: item.title, body: item.body, category: item.category, priority: item.priority, audience_department_ids: [...item.audience_department_ids], pinned: item.pinned, expires_on: item.expires_on }
      : blank()
    setV(init)
    setEveryone(!init.audience_department_ids.length)
    setSubmitted(false)
    setTouched(new Set())
  }, [open, item])

  const input: AnnouncementInput = { ...v, audience_department_ids: everyone ? [] : v.audience_department_ids }
  const errors = { ...announcementErrors(input, item), ...(!everyone && !v.audience_department_ids.length ? { audience_department_ids: 'Pick at least one department, or switch on “Everyone”.' } : {}) }
  const show = (k: keyof AnnouncementInput) => (submitted || touched.has(k) ? errors[k] : undefined)
  const touch = (k: string) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))
  const set = <K extends keyof AnnouncementInput>(k: K, val: AnnouncementInput[K]) => setV((p) => ({ ...p, [k]: val }))
  const valid = !Object.keys(errors).length
  const recipients = audienceUsers(input, users, L.emp).filter((u) => u.id !== s.user.id).length
  const today = todayISO()

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    setSubmitted(true)
    if (!valid) return
    try {
      if (item) {
        update(item.id, input)
        toast.success('Announcement updated')
      } else {
        publish(input)
        toast.success('Announcement published', audienceKnown ? `${recipients} people will be notified.` : 'The audience will be notified.')
      }
      onClose()
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : String(err))
    }
  }

  const expiryPresets = [
    { label: '1 week', value: addDays(today, 7) },
    { label: '2 weeks', value: addDays(today, 14) },
    { label: '1 month', value: addDays(today, 30) },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={item ? 'Edit announcement' : 'New announcement'}
      subtitle={item ? 'Edits show up immediately; nobody is notified again.' : `Posted as ${s.user.display_name}. ${audienceKnown ? `${recipients} people will be notified.` : 'The audience is notified automatically.'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Send className="h-4 w-4" />} onClick={() => submit()} disabled={submitted && !valid}>
            {item ? 'Save changes' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={submit} noValidate className="min-w-0 space-y-4">
          <Field label="Headline" required error={show('title')}>
            <Input value={v.title} maxLength={120} onChange={(e) => set('title', e.target.value)} onBlur={() => touch('title')} placeholder="e.g. Ayudha Pooja holidays — 19 & 20 Oct" invalid={!!show('title')} />
          </Field>
          <Field label="Category" required error={show('category')}>
            <div className="grid grid-cols-2 gap-2 xs:grid-cols-3">
              {CATEGORIES.map((c) => {
                const m = CATEGORY_META[c]
                const Icon = m.icon
                const on = v.category === c
                return (
                  <button key={c} type="button" onClick={() => set('category', c)} aria-pressed={on} className={cn('relative flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[13px] font-semibold transition', on ? 'border-transparent text-ink' : 'border-indigo-100 bg-white text-ink-soft hover:border-indigo-200')}>
                    {on && <motion.span layoutId="ann-cat" className="absolute inset-0 rounded-xl bg-indigo-50 ring-2 ring-brand-indigo/40" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    <span className={cn('relative grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white', m.gradient)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="relative truncate">{m.label}</span>
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Priority" required error={show('priority')}>
            <Segmented<Announcement['priority']> value={v.priority} onChange={(p) => set('priority', p)} options={ANN_PRIORITIES.map((p) => ({ value: p, label: ANN_PRIORITY_META[p].label }))} />
          </Field>
          <Field label="Message" required error={show('body')} hint={`${v.body.trim().length}/5000 · line breaks are kept`}>
            <Textarea value={v.body} rows={6} maxLength={5000} onChange={(e) => set('body', e.target.value)} onBlur={() => touch('body')} placeholder="Write the full notice. Keep it clear: what, when, who it affects." invalid={!!show('body')} />
          </Field>
          <div className="rounded-2xl border border-indigo-100 bg-white/70 p-3.5">
            <Switch
              checked={everyone}
              onChange={(on) => {
                setEveryone(on)
                touch('audience_department_ids')
              }}
              label="Everyone"
              description="Switch off to address selected departments only."
            />
            <AnimatePresence initial={false}>
              {!everyone && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="flex flex-wrap gap-1.5 pt-3">
                    {[...departments]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((d) => {
                        const on = v.audience_department_ids.includes(d.id)
                        return (
                          <button
                            key={d.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              set('audience_department_ids', on ? v.audience_department_ids.filter((x) => x !== d.id) : [...v.audience_department_ids, d.id])
                              touch('audience_department_ids')
                            }}
                            className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition', on ? 'bg-brand-indigo text-white shadow-soft' : 'bg-indigo-50 text-ink-soft hover:text-ink')}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ background: d.color || '#6366f1' }} />
                            {d.name}
                          </button>
                        )
                      })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {show('audience_department_ids') && <p className="mt-2 text-[12.5px] font-medium text-rose-600">{show('audience_department_ids')}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Expires on" error={show('expires_on')} hint={v.expires_on ? 'Hidden from the feed after this date' : 'Optional — stays until deleted'}>
              <Input type="date" value={v.expires_on ?? ''} min={today} onChange={(e) => set('expires_on', e.target.value || null)} onBlur={() => touch('expires_on')} invalid={!!show('expires_on')} />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {expiryPresets.map((p) => (
                  <button key={p.label} type="button" onClick={() => set('expires_on', p.value)} className={cn('rounded-lg px-2 py-0.5 text-[11.5px] font-semibold transition', v.expires_on === p.value ? 'bg-brand-indigo text-white' : 'bg-indigo-50 text-ink-soft hover:text-ink')}>
                    {p.label}
                  </button>
                ))}
                {v.expires_on && (
                  <button type="button" onClick={() => set('expires_on', null)} className="rounded-lg px-2 py-0.5 text-[11.5px] font-semibold text-ink-faint hover:text-ink">
                    No expiry
                  </button>
                )}
              </div>
            </Field>
            <div className="rounded-2xl border border-indigo-100 bg-white/70 p-3.5 sm:self-start">
              <Switch checked={v.pinned} onChange={(p) => set('pinned', p)} label="Pin to top" description="Pinned notices stay above newer ones." />
            </div>
          </div>
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
        <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Live preview</p>
          <AnnouncementCard
            a={{ ...input, author_name: item?.author_name || s.user.display_name, published_at: item?.published_at ?? new Date().toISOString() }}
            deptNames={input.audience_department_ids.map((d) => L.deptName(d))}
            preview
          />
          {audienceKnown && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-soft">
              <Users className="h-3.5 w-3.5" /> Reaches {recipients} {recipients === 1 ? 'person' : 'people'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ── read receipts ───────────────────────────────────────────────────────── */

function ReadReceipts({ id, onClose, audienceKnown }: { id: string | null; onClose: () => void; audienceKnown: boolean }) {
  const a = useTable('announcements').find((x) => x.id === id)
  const reads = useTable('announcement_reads')
  const users = useTable('app_users')
  const L = useLookups()
  const [tab, setTab] = useState<'read' | 'unread'>('read')
  useEffect(() => setTab('read'), [id])

  const data = useMemo(() => {
    if (!a) return { read: [], unread: [] }
    const mine = reads.filter((r) => r.announcement_id === a.id)
    const byUser = new Map(mine.map((r) => [r.user_id, r.read_at]))
    const userMap = new Map(users.map((u) => [u.id, u]))
    const audience = audienceUsers(a, users, L.emp)
    const label = (uid: string) => {
      const u = userMap.get(uid)
      const e = u?.employee_id ? L.emp.get(u.employee_id) : undefined
      return { id: uid, name: e ? fullName(e) : u?.display_name ?? 'Staff member', sub: e ? `${e.emp_code} · ${L.deptName(e.department_id)}` : u?.email ?? '', photo: e?.photo ?? null }
    }
    const read = mine.map((r) => ({ ...label(r.user_id), at: r.read_at })).sort((x, y) => y.at.localeCompare(x.at))
    const unread = audience.filter((u) => !byUser.has(u.id)).map((u) => ({ ...label(u.id), at: '' })).sort((x, y) => x.name.localeCompare(y.name))
    return { read, unread }
  }, [a, reads, users, L])

  const rows = tab === 'read' ? data.read : data.unread
  return (
    <Modal open={!!id && !!a} onClose={onClose} size="md" title="Read receipts" subtitle={a?.title}>
      {audienceKnown ? (
        <Tabs<'read' | 'unread'>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'read', label: 'Read', count: data.read.length },
            { value: 'unread', label: 'Not yet', count: data.unread.length },
          ]}
        />
      ) : (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">Names and the “not yet read” list need Users &amp; roles access. {data.read.length} people have read this.</p>
      )}
      {!rows.length ? (
        <EmptyState title={tab === 'read' ? 'Nobody has read it yet' : 'Everyone has read it'} className="py-8" />
      ) : (
        <ul className="divide-y divide-indigo-50">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={r.name} src={r.photo} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                {r.sub && <p className="truncate text-[12px] text-ink-soft">{r.sub}</p>}
              </div>
              {r.at ? <span className="shrink-0 text-[12px] text-ink-faint" title={fmtDateTime(r.at)}>{relativeTime(r.at)}</span> : <Badge tone="slate">Unread</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
