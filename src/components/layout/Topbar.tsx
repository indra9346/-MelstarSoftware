import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, CheckCheck, Cloud, HardDrive, Search } from 'lucide-react'
import { db, useSettings, useTable } from '@/data/store'
import { useSession } from '@/services/session'
import { useNow } from '@/hooks/useClock'
import { cn } from '@/lib/misc'
import { WEEKDAYS_LONG, plantStatus, relativeTime, toISODate } from '@/lib/dates'
import { DATA_MODE } from '@/config/env'
import { SearchButton } from './AppShell'

export function Topbar({ portal, onSearch, menuButton }: { portal: 'admin' | 'employee'; onMenu: () => void; onSearch: () => void; menuButton: ReactNode }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-white">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-3 sm:px-6 lg:px-8">
        {menuButton}
        <SearchButton onClick={onSearch} />
        <button onClick={onSearch} className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-slate-100 md:hidden" aria-label="Search">
          <Search className="h-5 w-5" />
        </button>
        <div className="flex-1" />
        <PlantClock />
        <ModePill />
        <NotificationBell portal={portal} />
      </div>
    </header>
  )
}

function PlantClock() {
  const now = useNow(1000)
  const s = useSettings()
  const holidays = useTable('holidays')
  const today = toISODate(now)
  const holiday = holidays.find((h) => h.date === today && h.type !== 'optional')
  const st = plantStatus(now, s.plant_open, s.plant_close, s.working_days, !!holiday)
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return (
    <div className="hidden items-center gap-2.5 border-r border-line pr-3 sm:flex">
      <span className={cn('h-2 w-2 rounded-full', st.isOpen ? 'bg-emerald-500' : 'bg-slate-400')} />
      <div className="text-right leading-tight">
        <p className="num text-[13px] font-medium text-ink">{time}</p>
        <p className="text-[11px] text-ink-soft">
          {holiday ? `${holiday.name} · closed` : st.isOpen ? `Plant open · closes ${s.plant_close}` : st.working ? (st.minutesToOpen ? `Opens ${s.plant_open}` : 'Plant closed') : `${WEEKDAYS_LONG[now.getDay()]} · closed`}
        </p>
      </div>
    </div>
  )
}

function ModePill() {
  const live = DATA_MODE === 'supabase'
  return (
    <span
      title={live ? 'Connected to the live Supabase database · changes sync in real time' : 'Offline demo · data is stored in this browser'}
      className={cn('hidden items-center gap-1.5 rounded border px-2 py-0.5 text-[11.5px] font-medium xl:inline-flex', live ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}
    >
      {live ? <Cloud className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}
      {live ? 'Live data' : 'Demo data'}
    </span>
  )
}

function NotificationBell({ portal }: { portal: 'admin' | 'employee' }) {
  const s = useSession()
  const all = useTable('notifications')
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mine = useMemo(() => all.filter((n) => n.user_id === s.user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)), [all, s.user.id])
  const unread = mine.filter((n) => !n.read).length
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const markAll = () => db.batch(() => mine.filter((n) => !n.read).forEach((n) => db.update('notifications', n.id, { read: true })))
  const base = portal === 'admin' ? '/admin' : '/me'
  const go = (link: string | null, id: string) => {
    db.update('notifications', id, { read: true })
    setOpen(false)
    if (!link) return
    // keep admins inside the admin portal when a link points at /me
    nav(portal === 'admin' && link.startsWith('/me') ? link.replace('/me', '/admin') : link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-slate-100 hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="num absolute right-0.5 top-0.5 min-w-[17px] rounded-full bg-red-600 px-1 text-center text-[10px] font-medium leading-[17px] text-white ring-2 ring-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed inset-x-2 top-[60px] z-50 overflow-hidden rounded-md border border-line bg-white shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[380px]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-[14px] font-semibold">Notifications</p>
              {unread > 0 && (
                <button onClick={markAll} className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-[60dvh] overflow-y-auto scroll-thin">
              {mine.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <button onClick={() => go(n.link, n.id)} className={cn('flex w-full gap-3 border-b border-line/70 px-4 py-2.5 text-left transition-colors hover:bg-slate-50', !n.read && 'bg-slate-50')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-600')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-ink">{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-ink-faint">{relativeTime(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!mine.length && <li className="px-4 py-10 text-center text-sm text-ink-soft">No notifications</li>}
            </ul>
            <Link to={`${base}/notifications`} onClick={() => setOpen(false)} className="block bg-slate-50 py-2 text-center text-[12.5px] font-medium text-brand-600 hover:bg-slate-100">
              View all
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
