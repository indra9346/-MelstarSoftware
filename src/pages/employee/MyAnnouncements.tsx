import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BellRing, Megaphone, Pin, Users } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Announcement, AnnouncementCategory } from '@/data/types'
import { Avatar, Badge, Card, EmptyState, Modal, PageHeader } from '@/components/ui'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { ANN_PRIORITY_META, CATEGORIES, CATEGORY_META, isExpired, isForDepartment, markRead, sortAnnouncements } from '@/services/announcements'
import { fmtDate, fmtDateTime, relativeTime, todayISO } from '@/lib/dates'
import { cn } from '@/lib/misc'

export default function MyAnnouncementsPage() {
  const s = useSession()
  const L = useLookups()
  const announcements = useTable('announcements')
  const reads = useTable('announcement_reads')
  const [category, setCategory] = useState<'' | AnnouncementCategory>('')
  const [openId, setOpenId] = useState<string | null>(null)
  // ids that were unread when they first appeared on this visit — they keep their "New" marker until you leave
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  const today = todayISO()
  const dept = s.employee?.department_id ?? null
  const feed = useMemo(() => sortAnnouncements(announcements.filter((a) => !isExpired(a, today) && isForDepartment(a, dept))), [announcements, today, dept])
  const readIds = useMemo(() => new Set(reads.filter((r) => r.user_id === s.user.id).map((r) => r.announcement_id)), [reads, s.user.id])

  useEffect(() => {
    const unread = feed.filter((a) => !readIds.has(a.id)).map((a) => a.id)
    if (!unread.length) return
    setFresh((f) => {
      const add = unread.filter((id) => !f.has(id))
      return add.length ? new Set([...f, ...add]) : f
    })
    // viewing the feed counts as reading it (one receipt per announcement)
    const t = setTimeout(() => markRead(unread), 1500)
    return () => clearTimeout(t)
  }, [feed, readIds])

  const open = (a: Announcement) => {
    setOpenId(a.id)
    if (!readIds.has(a.id)) markRead([a.id])
  }

  const shown = category ? feed.filter((a) => a.category === category) : feed
  const counts = useMemo(() => {
    const m = new Map<AnnouncementCategory, number>()
    for (const a of feed) m.set(a.category, (m.get(a.category) ?? 0) + 1)
    return m
  }, [feed])
  const newCount = feed.filter((a) => fresh.has(a.id)).length
  const current = feed.find((a) => a.id === openId) ?? announcements.find((a) => a.id === openId)
  const audienceLabel = (a: Announcement) => (a.audience_department_ids.length ? a.audience_department_ids.map((d) => L.deptName(d)).join(', ') : 'Everyone')

  return (
    <div>
      <PageHeader
        kicker="Self-service"
        title="Announcements"
        subtitle="Plant notices: holidays, safety, HR and production updates."
        actions={
          newCount > 0 ? (
            <Badge tone="indigo">
              <BellRing className="mr-1 inline h-3.5 w-3.5" />
              {newCount} new
            </Badge>
          ) : undefined
        }
      />

      {feed.length > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <Chip active={!category} onClick={() => setCategory('')}>
            All · {feed.length}
          </Chip>
          {CATEGORIES.filter((c) => counts.get(c)).map((c) => {
            const Icon = CATEGORY_META[c].icon
            return (
              <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? '' : c)}>
                <Icon className="h-3.5 w-3.5" /> {CATEGORY_META[c].label} · {counts.get(c)}
              </Chip>
            )
          })}
        </div>
      )}

      {!shown.length ? (
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={feed.length ? 'Nothing in this category' : 'No announcements right now'} description={feed.length ? undefined : 'Holidays, safety alerts and plant news appear here. You also receive a notification.'} />
      ) : (
        <ul className="mx-auto grid max-w-3xl grid-cols-1 gap-3.5">
            {shown.map((a) => {
              const meta = CATEGORY_META[a.category]
              const Icon = meta.icon
              const isNew = fresh.has(a.id)
              return (
                <li key={a.id} className="min-w-0">
                  <Card className={cn('relative overflow-hidden', a.priority === 'urgent' && 'border-red-300')}>
                    <span className={cn('absolute inset-y-0 left-0 w-[3px]', meta.bar)} aria-hidden />
                    <button type="button" onClick={() => open(a)} className="block w-full p-4 pl-5 text-left transition-colors hover:bg-slate-50 sm:p-5 sm:pl-6">
                      <div className="flex items-start gap-3">
                        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-md', meta.soft)}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {a.priority !== 'normal' && (
                              <Badge tone={ANN_PRIORITY_META[a.priority].tone} dot>
                                {ANN_PRIORITY_META[a.priority].label}
                              </Badge>
                            )}
                            {a.pinned && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600">
                                <Pin className="h-3 w-3" /> Pinned
                              </span>
                            )}
                              {isNew && (
                                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-white">
                                  New
                                </span>
                              )}
                          </div>
                          <h3 className="mt-1.5 break-words text-[16.5px] font-semibold leading-snug text-ink">{a.title}</h3>
                          <p className="mt-1.5 line-clamp-3 whitespace-pre-line break-words text-[14px] leading-relaxed text-ink-soft">{a.body}</p>
                          <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-faint">
                            <span className="font-semibold text-ink-soft">{a.author_name || 'HR & Administration'}</span>
                            <span title={fmtDateTime(a.published_at)}>{relativeTime(a.published_at)}</span>
                            {a.expires_on && <span>until {fmtDate(a.expires_on)}</span>}
                            <span className="font-semibold text-brand-600">Read →</span>
                          </p>
                        </div>
                      </div>
                    </button>
                  </Card>
                </li>
              )
            })}
        </ul>
      )}

      <Modal open={!!openId && !!current} onClose={() => setOpenId(null)} size="md" title={current?.title} subtitle={current ? `${CATEGORY_META[current.category].label} · ${fmtDateTime(current.published_at)}` : undefined}>
        {current && (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {(() => {
                const Icon = CATEGORY_META[current.category].icon
                return (
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold', CATEGORY_META[current.category].soft)}>
                    <Icon className="h-3.5 w-3.5" /> {CATEGORY_META[current.category].label}
                  </span>
                )
              })()}
              {current.priority !== 'normal' && (
                <Badge tone={ANN_PRIORITY_META[current.priority].tone} dot>
                  {ANN_PRIORITY_META[current.priority].label}
                </Badge>
              )}
              {current.pinned && <Badge tone="pink">Pinned</Badge>}
            </div>
            <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-ink">{current.body}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-[12.5px] text-ink-soft">
              <span className="inline-flex items-center gap-2">
                <Avatar name={current.author_name || 'HR'} size={26} />
                <span className="font-semibold text-ink">{current.author_name || 'HR & Administration'}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {audienceLabel(current)}
              </span>
              {current.expires_on && <span>Valid until {fmtDate(current.expires_on)}</span>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition', active ? 'bg-ink text-white shadow-soft' : 'bg-white text-ink-soft ring-1 ring-inset ring-line hover:text-ink')}
    >
      {children}
    </button>
  )
}
