import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Search, User } from 'lucide-react'
import type { NavGroup } from '@/config/navigation'
import { useTable } from '@/data/store'
import { useSession } from '@/services/session'
import { fullName } from '@/lib/format'
import { cn } from '@/lib/misc'

interface Hit {
  key: string
  label: string
  sub: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

/** Ctrl/⌘ + K: jump to any page, employee, work order, PO or machine. */
export function CommandPalette({ open, onClose, groups }: { open: boolean; onClose: () => void; groups: NavGroup[] }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const nav = useNavigate()
  const s = useSession()
  const input = useRef<HTMLInputElement>(null)
  const employees = useTable('employees')
  const wos = useTable('work_orders')
  const pos = useTable('purchase_orders')
  const machines = useTable('machines')

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      setTimeout(() => input.current?.focus(), 30)
    }
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase()
    const pages: Hit[] = groups.flatMap((g) => g.items.map((i) => ({ key: i.to, label: i.label, sub: g.label, to: i.to, icon: i.icon })))
    const out = pages.filter((p) => !needle || p.label.toLowerCase().includes(needle) || p.sub.toLowerCase().includes(needle))
    if (needle.length >= 2 && s.isAdminPortal) {
      if (s.canAny(['employees.view', 'employees.manage']))
        for (const e of employees) {
          if (`${fullName(e)} ${e.emp_code}`.toLowerCase().includes(needle)) out.push({ key: e.id, label: fullName(e), sub: `Employee · ${e.emp_code}`, to: `/admin/employees/${e.id}`, icon: User })
        }
      if (s.canAny(['sales.view', 'sales.manage']))
        for (const w of wos) if (`${w.wo_no} ${w.part_name} ${w.part_no}`.toLowerCase().includes(needle)) out.push({ key: w.id, label: `${w.wo_no} · ${w.part_name}`, sub: 'Work order', to: `/admin/production?wo=${w.id}`, icon: Search })
      if (s.canAny(['purchase.view', 'purchase.manage']))
        for (const p of pos) if (p.po_no.toLowerCase().includes(needle)) out.push({ key: p.id, label: p.po_no, sub: 'Purchase order', to: `/admin/purchase?po=${p.id}`, icon: Search })
      if (s.canAny(['machines.view', 'machines.manage']))
        for (const m of machines) if (`${m.asset_code} ${m.name} ${m.make} ${m.model}`.toLowerCase().includes(needle)) out.push({ key: m.id, label: `${m.asset_code} · ${m.name}`, sub: `${m.make} ${m.model}`, to: `/admin/machines?m=${m.id}`, icon: Search })
    }
    return out.slice(0, 14)
  }, [q, groups, employees, wos, pos, machines, s])

  const go = (h: Hit | undefined) => {
    if (!h) return
    onClose()
    nav(h.to)
  }

  return (
    <AnimatePresence>
      {open && (
        <div key="palette" className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[10vh]">
          <motion.div className="absolute inset-0 bg-slate-900/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="relative w-full max-w-xl overflow-hidden rounded-lg border border-line bg-white shadow-lift"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-[18px] w-[18px] text-ink-faint" />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setIdx(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(hits.length - 1, i + 1)))
                  else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
                  else if (e.key === 'Enter') go(hits[idx])
                  else if (e.key === 'Escape') onClose()
                }}
                placeholder="Search pages, employees, work orders, POs, machines…"
                className="h-12 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <ul className="max-h-[55dvh] overflow-y-auto py-1.5 scroll-thin">
              {hits.map((h, i) => (
                <li key={h.key + i}>
                  <button
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => go(h)}
                    className={cn('flex w-full items-center gap-3 px-4 py-2 text-left', i === idx ? 'bg-brand-50' : '')}
                  >
                    <h.icon className={cn('h-4 w-4 shrink-0', i === idx ? 'text-brand-600' : 'text-ink-faint')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{h.label}</span>
                      <span className="block truncate text-[12px] text-ink-soft">{h.sub}</span>
                    </span>
                    {i === idx && <CornerDownLeft className="h-4 w-4 text-ink-faint" />}
                  </button>
                </li>
              ))}
              {!hits.length && <li className="px-3 py-8 text-center text-sm text-ink-soft">No results for “{q}”</li>}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
