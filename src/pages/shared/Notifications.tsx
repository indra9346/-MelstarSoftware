import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, CalendarDays, CheckCheck, ClipboardCheck, Clock3, KanbanSquare, Megaphone, Package, ReceiptIndianRupee, ShoppingCart, Trash2, Wallet, Wrench } from 'lucide-react'
import { db, useTable } from '@/data/store'
import type { NotificationType } from '@/data/types'
import { useSession } from '@/services/session'
import { relativeTime, fmtDateTime } from '@/lib/dates'
import { cn } from '@/lib/misc'
import { Button, EmptyState, PageHeader, Segmented } from '@/components/ui'

const ICONS: Record<NotificationType, typeof Bell> = {
  leave: CalendarDays, attendance: Clock3, task: KanbanSquare, payroll: ReceiptIndianRupee, petty_cash: Wallet, announcement: Megaphone,
  maintenance: Wrench, inventory: Package, purchase: ShoppingCart, quality: ClipboardCheck, system: Bell,
}
const TONES: Record<NotificationType, string> = {
  leave: 'from-cyan-400 to-sky-500', attendance: 'from-indigo-400 to-violet-500', task: 'from-amber-400 to-orange-500', payroll: 'from-emerald-400 to-teal-500',
  petty_cash: 'from-pink-400 to-rose-500', announcement: 'from-violet-400 to-fuchsia-500', maintenance: 'from-orange-400 to-red-500', inventory: 'from-teal-400 to-cyan-500',
  purchase: 'from-sky-400 to-indigo-500', quality: 'from-fuchsia-400 to-pink-500', system: 'from-slate-400 to-slate-500',
}

export default function NotificationsPage() {
  const s = useSession()
  const all = useTable('notifications')
  const nav = useNavigate()
  const inAdmin = useLocation().pathname.startsWith('/admin')
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const mine = useMemo(() => all.filter((n) => n.user_id === s.user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)), [all, s.user.id])
  const list = filter === 'unread' ? mine.filter((n) => !n.read) : mine
  const unread = mine.filter((n) => !n.read).length

  const open = (id: string, link: string | null) => {
    db.update('notifications', id, { read: true })
    if (link) nav(inAdmin && link.startsWith('/me') ? link.replace('/me', '/admin') : link)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'You’re all caught up'}
        actions={
          <>
            <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: `Unread${unread ? ` (${unread})` : ''}` }]} />
            {unread > 0 && (
              <Button variant="secondary" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={() => db.batch(() => mine.filter((n) => !n.read).forEach((n) => db.update('notifications', n.id, { read: true })))}>
                Mark all read
              </Button>
            )}
          </>
        }
      />
      {!list.length ? (
        <EmptyState icon={<Bell className="h-6 w-6" />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} description="Approvals, task assignments, payslips and announcements will show up here." />
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {list.map((n, i) => {
              const Icon = ICONS[n.type] ?? Bell
              return (
                <motion.li key={n.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.03 } }} exit={{ opacity: 0, x: 30 }}>
                  <div className={cn('card group flex items-start gap-3 p-3.5 transition hover:shadow-lift', !n.read && 'ring-1 ring-indigo-200')}>
                    <button onClick={() => open(n.id, n.link)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-soft', TONES[n.type])}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-ink">{n.title}</span>
                          {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-grad" />}
                        </span>
                        {n.body && <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{n.body}</span>}
                        <span className="mt-1 block text-[11.5px] text-ink-faint" title={fmtDateTime(n.created_at)}>
                          {relativeTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                    <button onClick={() => db.remove('notifications', n.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint opacity-60 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100" aria-label="Delete notification">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}
