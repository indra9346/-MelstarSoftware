import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronDown, CloudDownload, Download, FileClock, FileText, LogIn, PenLine, Search, X } from 'lucide-react'
import { Avatar, Button, Card, DataTable, EmptyState, InfoGrid, Input, Modal, PageHeader, Select, toast, type Column } from '@/components/ui'
import { AUDIT_ACTIONS, ActionBadge, AuditChanges, entityLabel } from '@/components/hr/AuditChanges'
import { DATA_MODE } from '@/config/env'
import { db, useTable } from '@/data/store'
import type { AuditAction, AuditLog } from '@/data/types'
import { addDays, fmtDate, fmtDateTime, relativeTime, toISODate, todayISO } from '@/lib/dates'
import { exportCsv, exportPdf, type ExportColumn } from '@/lib/export'
import { titleCase } from '@/lib/format'
import { cn } from '@/lib/misc'
import { audit } from '@/services/audit'

/** Supabase mode loads the last 120 days of audit entries (see supabaseBackend WINDOWS). */
const LIVE_WINDOW_DAYS = 120

type Row = AuditLog & { day: string }

export default function AuditPage() {
  const logs = useTable('audit_logs')
  const today = todayISO()
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<AuditLog | null>(null)
  const [loading, setLoading] = useState(false)

  const all = useMemo<Row[]>(() => logs.map((l) => ({ ...l, day: toISODate(new Date(l.at)) })).sort((a, b) => b.at.localeCompare(a.at)), [logs])
  const entities = useMemo(() => [...new Set(all.map((l) => l.entity))].sort().map((e) => ({ value: e, label: entityLabel(e) })), [all])
  const people = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of all) m.set(l.user_id ?? `name:${l.user_name}`, l.user_name || 'System')
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [all])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((l) => {
      if (action && l.action !== action) return false
      if (entity && l.entity !== entity) return false
      if (user && (l.user_id ?? `name:${l.user_name}`) !== user) return false
      if (from && l.day < from) return false
      if (to && l.day > to) return false
      if (needle && !`${l.summary} ${l.user_name} ${l.entity} ${l.action} ${l.entity_id ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [all, q, action, entity, user, from, to])

  const stats = useMemo(() => {
    const week = addDays(today, -6)
    return {
      today: all.filter((l) => l.day === today).length,
      week: all.filter((l) => l.day >= week).length,
      changes: all.filter((l) => l.day >= week && (l.action === 'create' || l.action === 'update' || l.action === 'delete')).length,
      logins: all.filter((l) => l.day === today && l.action === 'login').length,
    }
  }, [all, today])

  const filtered = !!(q || action || entity || user || from || to)
  const rangeError = from && to && from > to ? '“From” is after “To”' : null
  const windowStart = addDays(today, -LIVE_WINDOW_DAYS)
  const canFetchOlder = DATA_MODE === 'supabase' && !!db.backend?.loadRange && !!from && from < windowStart

  const fetchOlder = async () => {
    const b = db.backend
    if (!b?.loadRange || !from) return
    setLoading(true)
    try {
      const start = new Date(`${from}T00:00:00`).toISOString()
      const end = new Date(`${to && to < windowStart ? to : windowStart}T23:59:59.999`).toISOString()
      const older = await b.loadRange('audit_logs', 'at', start, end)
      db.batch(() => older.forEach((r) => db.ingest('audit_logs', r)))
      toast.success(`Loaded ${older.length} older entr${older.length === 1 ? 'y' : 'ies'}`)
    } catch (e) {
      toast.error('Could not load older entries', e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'at',
      header: 'Time',
      value: (l) => l.at,
      cell: (l) => (
        <span className="block whitespace-nowrap">
          <span className="num block text-[13px] text-ink">{fmtDateTime(l.at)}</span>
          <span className="block text-[11.5px] text-ink-faint">{relativeTime(l.at)}</span>
        </span>
      ),
    },
    {
      key: 'user',
      header: 'User',
      value: (l) => l.user_name,
      cell: (l) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={l.user_name || 'System'} size={26} />
          <span className="truncate">{l.user_name || 'System'}</span>
        </span>
      ),
    },
    { key: 'action', header: 'Action', value: (l) => l.action, cell: (l) => <ActionBadge action={l.action} /> },
    { key: 'entity', header: 'Entity', value: (l) => entityLabel(l.entity), cell: (l) => <span className="whitespace-nowrap text-ink-soft">{entityLabel(l.entity)}</span> },
    {
      key: 'summary',
      header: 'Summary',
      value: (l) => l.summary,
      cell: (l) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="line-clamp-2 max-w-[34rem]">{l.summary || '—'}</span>
          {l.changes && Object.keys(l.changes).length > 0 && <span className="shrink-0 rounded-full bg-sky-50 px-1.5 py-px text-[10.5px] font-semibold text-sky-700">{Object.keys(l.changes).length} Δ</span>}
        </span>
      ),
      sortable: false,
    },
  ]

  const exportCols: ExportColumn<Row>[] = [
    { header: 'Time', value: (l) => fmtDateTime(l.at) },
    { header: 'User', value: (l) => l.user_name || 'System' },
    { header: 'Action', value: (l) => titleCase(l.action) },
    { header: 'Entity', value: (l) => entityLabel(l.entity) },
    { header: 'Summary', value: (l) => l.summary },
    { header: 'Changed fields', value: (l) => (l.changes ? Object.keys(l.changes).join(', ') : '') },
    { header: 'Record ID', value: (l) => l.entity_id ?? '' },
  ]
  const filterLabel = [
    action && titleCase(action),
    entity && entityLabel(entity),
    user && people.find((p) => p.value === user)?.label,
    (from || to) && `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : 'today'}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const doExport = (kind: 'csv' | 'pdf') => {
    if (!rows.length) return toast.info('Nothing to export')
    if (kind === 'csv') exportCsv(`audit-log-${today}`, rows, exportCols)
    else void exportPdf({ filename: `audit-log-${today}`, title: 'Audit log', subtitle: filterLabel || 'All entries', rows, columns: exportCols.filter((c) => c.header !== 'Record ID'), landscape: true, summary: [['Entries', String(rows.length)]] })
    audit('export', 'audit_logs', null, `Exported ${rows.length} audit entries (${kind.toUpperCase()}${filterLabel ? ` · ${filterLabel}` : ''})`)
  }
  const clear = () => {
    setQ('')
    setAction('')
    setEntity('')
    setUser('')
    setFrom('')
    setTo('')
  }

  return (
    <div>
      <PageHeader kicker="Administration" title="Audit log" subtitle="Every create, change, approval, export and sign-in. Append-only, newest first." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['Today', stats.today, <CalendarClock key="a" className="h-4 w-4" />],
            ['Last 7 days', stats.week, <FileClock key="b" className="h-4 w-4" />],
            ['Record changes · 7 d', stats.changes, <PenLine key="c" className="h-4 w-4" />],
            ['Sign-ins today', stats.logins, <LogIn key="d" className="h-4 w-4" />],
          ] as const
        ).map(([k, v, icon]) => (
          <div key={k} className="card min-w-0 p-4">
            <p className="flex items-center justify-between gap-2 text-[13px] font-medium text-ink-soft">
              <span className="truncate">{k}</span>
              <span className="shrink-0 text-ink-faint">{icon}</span>
            </p>
            <p className="num mt-2 text-[22px] font-semibold leading-none text-ink">{v.toLocaleString('en-IN')}</p>
          </div>
        ))}
      </div>

      <Card className="mb-4 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative min-w-0 sm:col-span-2 lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search summary, user, record id…" className="field-input h-10 py-0 pl-9 text-sm" aria-label="Search audit log" />
          </div>
          <Select value={action} onChange={(e) => setAction(e.target.value)} options={AUDIT_ACTIONS.map((a) => ({ value: a, label: titleCase(a) }))} placeholder="All actions" className="h-10 py-0 text-sm" aria-label="Action" />
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} options={entities} placeholder="All entities" className="h-10 py-0 text-sm" aria-label="Entity" />
          <Select value={user} onChange={(e) => setUser(e.target.value)} options={people} placeholder="All users" className="h-10 py-0 text-sm sm:col-span-2 lg:col-span-1" aria-label="User" />
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
            <Input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="h-10 px-2 py-0 text-[13px]" aria-label="From date" title="From" invalid={!!rangeError} />
            <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className="h-10 px-2 py-0 text-[13px]" aria-label="To date" title="To" invalid={!!rangeError} />
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 px-0.5 text-[12.5px] text-ink-soft">
          <span>
            <b className="text-ink">{rows.length.toLocaleString('en-IN')}</b> of {all.length.toLocaleString('en-IN')} entries
            {filterLabel ? ` · ${filterLabel}` : ''}
          </span>
          {rangeError && <span className="font-semibold text-rose-600">{rangeError}</span>}
          {filtered && (
            <button className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline" onClick={clear}>
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          {canFetchOlder && (
            <Button size="sm" variant="outline" loading={loading} icon={<CloudDownload className="h-4 w-4" />} onClick={() => void fetchOlder()}>
              Load entries before {fmtDate(windowStart)}
            </Button>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => doExport('csv')}>
              CSV
            </Button>
            <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => doExport('pdf')}>
              PDF
            </Button>
          </div>
        </div>
        {DATA_MODE === 'supabase' && <p className="mt-1.5 px-0.5 text-[11.5px] text-ink-faint">The last {LIVE_WINDOW_DAYS} days are loaded; pick an earlier “From” date to fetch older entries.</p>}
      </Card>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(l) => l.id}
        onRowClick={(l) => setOpen(logs.find((x) => x.id === l.id) ?? null)}
        initialSort={{ key: 'at', dir: 'desc' }}
        dense
        pageSize={30}
        mobileCard={(l) => (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ActionBadge action={l.action} />
              <span className="text-[12px] font-medium text-ink-faint">{entityLabel(l.entity)}</span>
              <span className="ml-auto text-[11.5px] text-ink-faint">{relativeTime(l.at)}</span>
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink">{l.summary || '—'}</p>
            <p className="mt-1 text-[12px] text-ink-soft">{l.user_name || 'System'}</p>
          </div>
        )}
        empty={<EmptyState icon={<FileClock className="h-6 w-6" />} title={filtered ? 'No entries match' : 'No audit entries yet'} description={filtered ? 'Widen the date range or clear a filter.' : 'Entries appear as people use the ERP.'} />}
      />

      <EntryModal entry={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function EntryModal({ entry, onClose }: { entry: AuditLog | null; onClose: () => void }) {
  const [raw, setRaw] = useState(false)
  const employee = entry?.entity === 'employees' && entry.entity_id ? db.get('employees', entry.entity_id) : undefined
  const count = entry?.changes ? Object.keys(entry.changes).length : 0
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      size="lg"
      title={
        entry && (
          <span className="flex flex-wrap items-center gap-2">
            <ActionBadge action={entry.action as AuditAction} />
            <span>{entityLabel(entry.entity)}</span>
          </span>
        )
      }
      subtitle={entry ? `${fmtDateTime(entry.at)} · ${relativeTime(entry.at)}` : undefined}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {entry && (
        <div className="space-y-5">
          <p className="rounded-md border border-line bg-slate-50 px-4 py-3 text-[14px] font-medium text-ink">
            {entry.summary || '—'}
          </p>
          <InfoGrid
            cols={3}
            items={[
              ['User', entry.user_name || 'System'],
              ['Action', titleCase(entry.action)],
              ['Entity', entityLabel(entry.entity)],
              ['When', fmtDateTime(entry.at)],
              ['Record ID', entry.entity_id ? <span className="break-all font-mono text-[12px]">{entry.entity_id}</span> : '—'],
              ['Open', employee ? <Link className="text-brand-600 hover:underline" to={`/admin/employees/${employee.id}`} onClick={onClose}>{`${employee.first_name} ${employee.last_name}`.trim()}</Link> : '—'],
            ]}
          />
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">
              Changes {count > 0 && <span className="text-ink-faint">· {count} field{count === 1 ? '' : 's'}</span>}
            </p>
            <AuditChanges changes={entry.changes} />
          </div>
          <div>
            <button type="button" onClick={() => setRaw((r) => !r)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:underline" aria-expanded={raw}>
              <ChevronDown className={cn('h-4 w-4 transition-transform', raw && 'rotate-180')} /> Raw details
            </button>
            {raw && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-[#172033] p-4 text-[11.5px] leading-relaxed text-brand-100 scroll-thin">
                {JSON.stringify(entry, null, 2)}
              </pre>
            )}
          </div>
          <p className="text-[11.5px] text-ink-faint">Audit entries are append-only: they cannot be edited or deleted from the app.</p>
        </div>
      )}
    </Modal>
  )
}
