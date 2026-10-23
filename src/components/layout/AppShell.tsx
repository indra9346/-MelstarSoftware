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
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-w)] flex-col border-r border-line bg-white lg:flex">
        <Sidebar groups={groups} portal={portal} />
      </aside>

      {/* phone / tablet drawer */}
      <AnimatePresence>
        {drawer && (
          <div key="drawer" className="fixed inset-0 z-[60] lg:hidden">
            <motion.div className="absolute inset-0 bg-slate-900/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={() => setDrawer(false)} />
            <motion.aside
              className="absolute inset-y-0 left-0 flex w-[min(86vw,280px)] flex-col border-r border-line bg-white shadow-lift"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            >
              <button onClick={() => setDrawer(false)} className="absolute right-2 top-3 grid h-8 w-8 place-items-center rounded-md text-ink-soft hover:bg-slate-100" aria-label="Close menu">
                <X className="h-[18px] w-[18px]" />
              </button>
              <Sidebar groups={groups} portal={portal} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="lg:pl-[var(--sidebar-w)] print:!pl-0">
        <Topbar
          portal={portal}
          onMenu={() => setDrawer(true)}
          onSearch={() => setPalette(true)}
          menuButton={
            <button onClick={() => setDrawer(true)} className="grid h-9 w-9 place-items-center rounded-md text-ink hover:bg-slate-100 lg:hidden" aria-label="Open menu">
              <MenuIcon className="h-5 w-5" />
            </button>
          }
        />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10">
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<BootScreen inline />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
          <div className="mt-10 flex justify-center lg:hidden">
            <SwanCredit />
          </div>
        </main>
      </div>

      {/* phone bottom bar */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Quick navigation">
        {mobileItems.map((i) => (
          <BottomItem key={i.to} item={i} end={i.to === '/admin' || i.to === '/me'} />
        ))}
        <button onClick={() => setDrawer(true)} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium text-ink-soft">
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} groups={groups} />
    </div>
  )
}

function Count({ n }: { n: number }) {
  if (!n) return null
  return <span className="num ml-auto min-w-[20px] rounded-full bg-red-600 px-1.5 text-center text-[11px] font-medium leading-[18px] text-white">{n > 99 ? '99+' : n}</span>
}

function Sidebar({ groups, portal }: { groups: NavGroup[]; portal: 'admin' | 'employee' }) {
  const s = useSession()
  const { signOut } = useAuth()
  const badges = useNavBadges()
  const nav = useNavigate()
  const name = s.employee ? fullName(s.employee) : s.user.display_name
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-line px-4">
        <Logo sub={portal === 'admin' ? 'ERP · Administration' : 'ERP · Employee self-service'} />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3 scroll-thin" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[.06em] text-ink-faint">{g.label}</p>
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/admin' || i.to === '/me'}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-9 items-center gap-2.5 rounded-md px-3 text-[13.5px] transition-colors',
                    isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-ink-soft hover:bg-slate-100 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-600" />}
                    <i.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand-600' : 'text-ink-faint')} />
                    <span className="truncate">{i.label}</span>
                    {i.badge && <Count n={badges[i.badge]} />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={name} src={s.employee?.photo} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{name}</p>
            <p className="truncate text-[11.5px] text-ink-soft">{s.role.name}</p>
          </div>
          <button onClick={() => void signOut()} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-slate-100 hover:text-ink" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {s.isAdminPortal && s.employee && (
          <button onClick={() => nav(portal === 'admin' ? '/me' : '/admin')} className="mt-2.5 flex h-8 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-white text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-slate-50 hover:text-ink">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            {portal === 'admin' ? 'Switch to self-service' : 'Switch to administration'}
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
      className={({ isActive }) => cn('relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors', isActive ? 'text-brand-700' : 'text-ink-soft')}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-x-3 top-0 h-[2px] bg-brand-600" />}
          <span className="relative">
            <item.icon className="h-5 w-5" />
            {n > 0 && <span className="absolute -right-2 -top-1.5 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[9.5px] font-medium leading-4 text-white">{n > 9 ? '9+' : n}</span>}
          </span>
          <span className="relative max-w-full truncate px-1">{item.label.split(' ')[0]}</span>
        </>
      )}
    </NavLink>
  )
}

export function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="hidden h-9 w-64 items-center gap-2 rounded-md border border-line-strong bg-white px-3 text-[13px] text-ink-faint transition-colors hover:border-slate-400 md:flex xl:w-80">
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd className="rounded border border-line bg-slate-50 px-1.5 font-sans text-[11px] text-ink-soft">Ctrl K</kbd>
    </button>
  )
}
