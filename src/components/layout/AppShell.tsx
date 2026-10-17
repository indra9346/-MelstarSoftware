import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeftRight, LogOut, Menu as MenuIcon, MoreHorizontal, Search, X } from 'lucide-react'
import { ADMIN_NAV, EMPLOYEE_NAV, visibleNav, type NavGroup, type NavItem } from '@/config/navigation'
import { useSession, useAuth } from '@/services/session'
import { useNavBadges } from '@/hooks/useNavBadges'
import { cn } from '@/lib/misc'
import { fullName } from '@/lib/format'
import { Avatar } from '@/components/ui'
import { Logo, SwanCredit } from '@/components/brand'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { BootScreen } from './BootScreen'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export function AppShell({ portal }: { portal: 'admin' | 'employee' }) {
  const s = useSession()
  const groups = useMemo(() => visibleNav(portal === 'admin' ? ADMIN_NAV : EMPLOYEE_NAV, s.can), [portal, s.can])
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const loc = useLocation()

  useEffect(() => setDrawer(false), [loc.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [loc.pathname])

  const mobileItems = groups.flatMap((g) => g.items).filter((i) => i.mobile).slice(0, 4)

  return (
    <div className="min-h-dvh">
      {/* desktop sidebar */}
      <aside className="no-print glass fixed inset-y-3 left-3 z-40 hidden w-[var(--sidebar-w)] flex-col rounded-[26px] shadow-glass lg:flex">
        <Sidebar groups={groups} portal={portal} />
      </aside>

      {/* phone / tablet drawer */}
      <AnimatePresence>
        {drawer && (
          <div key="drawer" className="fixed inset-0 z-[60] lg:hidden">
            <motion.div className="absolute inset-0 bg-[#1e2b5c]/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside
              className="absolute inset-y-0 left-0 flex w-[min(86vw,300px)] flex-col bg-white shadow-lift"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            >
              <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-xl text-ink-soft hover:bg-indigo-50" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
              <Sidebar groups={groups} portal={portal} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="lg:pl-[calc(var(--sidebar-w)+12px)] print:!pl-0">
        <Topbar
          portal={portal}
          onMenu={() => setDrawer(true)}
          onSearch={() => setPalette(true)}
          menuButton={
            <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-white/70 lg:hidden" aria-label="Open menu">
              <MenuIcon className="h-5 w-5" />
            </button>
          }
        />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-4 sm:px-6 lg:px-8 lg:pb-10">
          {/* entry-only transition (no exit phase to get stuck); lazy pages load inside the shell */}
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            <ErrorBoundary key={loc.pathname}>
              <Suspense fallback={<BootScreen inline />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
          <div className="mt-10 flex justify-center lg:hidden">
            <SwanCredit />
          </div>
        </main>
      </div>

      {/* phone bottom bar */}
      <nav className="no-print glass fixed inset-x-2 bottom-2 z-40 flex items-stretch justify-around rounded-[22px] px-1 pb-[max(4px,env(safe-area-inset-bottom))] pt-1 shadow-glass lg:hidden" aria-label="Quick navigation">
        {mobileItems.map((i) => (
          <BottomItem key={i.to} item={i} end={i.to === '/admin' || i.to === '/me'} />
        ))}
        <button onClick={() => setDrawer(true)} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-semibold text-ink-soft">
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} groups={groups} />
    </div>
  )
}

function Badge({ n }: { n: number }) {
  if (!n) return null
  return <span className="num ml-auto min-w-[20px] rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-1.5 py-px text-center text-[11px] font-bold text-white shadow-[0_4px_10px_-4px_rgba(236,72,153,.8)]">{n > 99 ? '99+' : n}</span>
}

function Sidebar({ groups, portal }: { groups: NavGroup[]; portal: 'admin' | 'employee' }) {
  const s = useSession()
  const { signOut } = useAuth()
  const badges = useNavBadges()
  const nav = useNavigate()
  const name = s.employee ? fullName(s.employee) : s.user.display_name
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 pb-3 pt-5">
        <Logo sub={portal === 'admin' ? 'ERP · Admin' : 'ERP · My space'} />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[.16em] text-ink-faint">{g.label}</p>
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/admin' || i.to === '/me'}
                className={({ isActive }) =>
                  cn('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-colors', isActive ? 'text-ink' : 'text-ink-soft hover:bg-white/70 hover:text-ink')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId={`nav-active-${portal}`} className="absolute inset-0 rounded-xl bg-white shadow-soft" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <i.icon className={cn('relative h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-indigo' : 'text-ink-faint group-hover:text-ink-soft')} />
                    <span className="relative truncate">{i.label}</span>
                    {i.badge && (
                      <span className="relative ml-auto">
                        <Badge n={badges[i.badge]} />
                      </span>
                    )}
                    {isActive && <span className="relative ml-auto h-1.5 w-1.5 rounded-full bg-grad" style={i.badge && badges[i.badge] ? { display: 'none' } : undefined} />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/80 p-3">
        <div className="flex items-center gap-2.5 rounded-2xl bg-white/70 p-2.5">
          <Avatar name={name} src={s.employee?.photo} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
            <p className="truncate text-[11.5px] text-ink-soft">{s.role.name}</p>
          </div>
          <button onClick={() => void signOut()} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-soft transition hover:bg-rose-50 hover:text-rose-600" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {s.isAdminPortal && s.employee && (
          <button onClick={() => nav(portal === 'admin' ? '/me' : '/admin')} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-100 bg-white/60 py-2 text-[12.5px] font-semibold text-brand-indigo transition hover:bg-white">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {portal === 'admin' ? 'Switch to My space' : 'Switch to Admin'}
          </button>
        )}
        <div className="mt-3 hidden justify-center lg:flex">
          <SwanCredit compact />
        </div>
      </div>
    </div>
  )
}

function BottomItem({ item, end }: { item: NavItem; end?: boolean }): ReactNode {
  const badges = useNavBadges()
  const n = item.badge ? badges[item.badge] : 0
  return (
    <NavLink
      to={item.to}
      end={end}
      className={({ isActive }) => cn('relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[10.5px] font-semibold transition-colors', isActive ? 'text-brand-indigo' : 'text-ink-soft')}
    >
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="bottom-active" className="absolute inset-0 rounded-2xl bg-white shadow-soft" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          <span className="relative">
            <item.icon className="h-5 w-5" />
            {n > 0 && <span className="absolute -right-2 -top-1.5 min-w-[16px] rounded-full bg-rose-500 px-1 text-center text-[9.5px] font-bold leading-4 text-white">{n > 9 ? '9+' : n}</span>}
          </span>
          <span className="relative max-w-full truncate px-1">{item.label.split(' ')[0]}</span>
        </>
      )}
    </NavLink>
  )
}

export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="hidden h-10 w-56 items-center gap-2 rounded-xl border border-white bg-white/70 px-3 text-[13px] text-ink-faint shadow-sm transition hover:bg-white md:flex xl:w-72">
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd className="rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-px font-sans text-[10.5px] font-semibold text-ink-soft">Ctrl K</kbd>
    </button>
  )
}
