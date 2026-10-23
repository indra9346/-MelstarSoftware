import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlarmClock, BookOpen, CalendarClock, Factory, Gauge, KanbanSquare, List, Plus, Search, Target, Users } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Customer, Priority, WorkOrder, WorkOrderStatus } from '@/data/types'
import { Badge, Button, DataTable, EmptyState, Input, Menu, PageHeader, Progress, Segmented, StatCard, StatusBadge, Tabs, confirm, confirmWithNote, guard, toast, type Column } from '@/components/ui'
import { useSession } from '@/services/session'
import { addDays, fmtDate, todayISO, toISODate } from '@/lib/dates'
import { inr, inrCompact, titleCase } from '@/lib/format'
import { cn } from '@/lib/misc'
import { OPEN_WO, PRIORITIES, WO_BOARD, WO_NEXT, WO_STATUS_LABEL, customerOrderValue, deleteCustomer, deleteWo, isWoLate, setWoStatus, woKpis, woValue } from '@/services/production'
import { useDialog, useLast, useQueryParam } from '@/components/ops/form'
import { FilterSelect, KpiGrid, ViewOnly } from '@/components/ops/kit'
import { CustomerForm, ProgressForm, WoForm } from '@/components/ops/production/ProductionForms'
import { CustomerDrawer, DueLabel, PRIORITY_TONE, RouteChips, WoDrawer } from '@/components/ops/production/ProductionDrawers'

type Tab = 'wos' | 'customers'
const COLUMN_TINT: Record<WorkOrderStatus, string> = {
  planned: '#94a3b8', in_progress: '#2f8f83', qc: '#7a5aa6', completed: '#3a8f5c', dispatched: '#2a56a1', on_hold: '#d08c1e', cancelled: '#c94a4a',
}
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export default function ProductionPage() {
  const s = useSession()
  const canManage = s.can('sales.manage')
  const wos = useTable('work_orders')
  const customers = useTable('customers')
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'customers' ? 'customers' : 'wos')

  const [woId, setWoId] = useQueryParam('wo')
  const liveWo = wos.find((w) => w.id === woId)
  const drawerWo = useLast(liveWo)
  useEffect(() => {
    if (woId && wos.length && !liveWo) {
      toast.error('Work order not found')
      setWoId(null)
    }
  }, [woId, wos.length, liveWo, setWoId])

  const woDlg = useDialog<{ wo: WorkOrder | null; customerId?: string }>()
  const progDlg = useDialog<WorkOrder>()
  const custDlg = useDialog<Customer>()
  const [custView, setCustView] = useState<string | null>(null)
  const liveCust = customers.find((c) => c.id === custView)
  const drawerCust = useLast(liveCust)

  const changeStatus = async (wo: WorkOrder, to: WorkOrderStatus) => {
    let note = ''
    if (to === 'on_hold' || to === 'cancelled') {
      const r = await confirmWithNote({ title: `${to === 'cancelled' ? 'Cancel' : 'Hold'} ${wo.wo_no}?`, message: to === 'cancelled' ? 'Cancelled work orders are closed for good.' : 'The order leaves the active board until resumed.', danger: to === 'cancelled', confirmLabel: to === 'cancelled' ? 'Cancel WO' : 'Put on hold', input: { label: 'Reason', required: true } })
      if (!r.ok) return
      note = r.note
    } else if (to === 'completed' && wo.completed_qty < wo.qty) {
      if (!(await confirm({ title: 'Close short?', message: `Only ${wo.completed_qty} of ${wo.qty} are completed. Mark ${wo.wo_no} completed anyway?`, confirmLabel: 'Mark completed' }))) return
    } else if (to === 'dispatched') {
      if (!(await confirm({ title: `Dispatch ${wo.wo_no}?`, message: `${wo.completed_qty} × ${wo.part_name} to ${customers.find((c) => c.id === wo.customer_id)?.name ?? 'customer'}.`, confirmLabel: 'Dispatch' }))) return
    }
    await guard(() => setWoStatus(wo, to, note), `${wo.wo_no} → ${WO_STATUS_LABEL[to]}`)
  }

  const kpi = useMemo(() => woKpis(wos, todayISO()), [wos])

  return (
    <div className="min-w-0">
      <PageHeader
        kicker="Operations"
        title={<span className="flex flex-wrap items-center gap-2">Customers & work orders <ViewOnly show={!canManage} /></span>}
        subtitle="Order book, shop-floor progress and on-time delivery"
        actions={
          canManage && (
            <>
              {tab === 'wos' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => woDlg.show({ wo: null })}>
                  New work order
                </Button>
              )}
              {tab === 'customers' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => custDlg.show()}>
                  Add customer
                </Button>
              )}
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'wos', label: 'Work orders', count: kpi.open },
          { value: 'customers', label: 'Customers' },
        ]}
      />

      {tab === 'wos' && <WorkOrdersTab kpi={kpi} canManage={canManage} onOpen={(w) => setWoId(w.id)} onStatus={changeStatus} onProgress={(w) => progDlg.show(w)} />}
      {tab === 'customers' && <CustomersTab onOpen={(c) => setCustView(c.id)} />}

      {drawerWo && (
        <WoDrawer
          open={!!liveWo}
          onClose={() => setWoId(null)}
          wo={liveWo ?? drawerWo}
          canManage={canManage}
          onEdit={() => woDlg.show({ wo: liveWo ?? drawerWo })}
          onProgress={() => progDlg.show(liveWo ?? drawerWo)}
          onStatus={(to) => void changeStatus(liveWo ?? drawerWo, to)}
          onDelete={async () => {
            const w = liveWo ?? drawerWo
            if (await confirm({ title: `Delete ${w.wo_no}?`, message: 'Only planned orders with nothing produced can be deleted.', danger: true, confirmLabel: 'Delete' })) {
              await guard(() => {
                deleteWo(w)
                setWoId(null)
              }, 'Work order deleted')
            }
          }}
          onOpenCustomer={(id) => setCustView(id)}
        />
      )}
      {drawerCust && (
        <CustomerDrawer
          open={!!liveCust}
          onClose={() => setCustView(null)}
          customer={liveCust ?? drawerCust}
          canManage={canManage}
          onEdit={() => custDlg.show(liveCust ?? drawerCust)}
          onOpenWo={(id) => {
            setCustView(null)
            setTab('wos')
            setWoId(id)
          }}
          onNewWo={() => {
            setCustView(null)
            woDlg.show({ wo: null, customerId: drawerCust.id })
          }}
          onDelete={async () => {
            const c = liveCust ?? drawerCust
            if (await confirm({ title: `Delete ${c.name}?`, message: 'Customers with work orders cannot be deleted — mark them inactive instead.', danger: true, confirmLabel: 'Delete' })) {
              if (await guard(() => deleteCustomer(c), 'Customer deleted')) setCustView(null)
            }
          }}
        />
      )}

      <WoForm key={`w${woDlg.key}`} open={woDlg.open} onClose={woDlg.close} wo={woDlg.data?.wo ?? null} customerId={woDlg.data?.customerId} onSaved={(w) => setWoId(w.id)} />
      {progDlg.data && <ProgressForm key={`p${progDlg.key}`} open={progDlg.open} onClose={progDlg.close} wo={progDlg.data} />}
      <CustomerForm key={`c${custDlg.key}`} open={custDlg.open} onClose={custDlg.close} customer={custDlg.data} />
    </div>
  )
}

/* ─────────────────────────── Work orders ─────────────────────────── */

function WorkOrdersTab({ kpi, canManage, onOpen, onStatus, onProgress }: { kpi: ReturnType<typeof woKpis>; canManage: boolean; onOpen: (w: WorkOrder) => void; onStatus: (w: WorkOrder, to: WorkOrderStatus) => void; onProgress: (w: WorkOrder) => void }) {
  const wos = useTable('work_orders')
  const customers = useTable('customers')
  const today = todayISO()
  const [view, setView] = useState<'board' | 'list'>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'list' : 'board'))
  const [q, setQ] = useState('')
  const [customer, setCustomer] = useState('')
  const [priority, setPriority] = useState<Priority | ''>('')
  const [status, setStatus] = useState<WorkOrderStatus | 'open' | ''>('open')
  const cMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return wos.filter(
      (w) =>
        (!customer || w.customer_id === customer) &&
        (!priority || w.priority === priority) &&
        (!needle || `${w.wo_no} ${w.part_no} ${w.part_name} ${w.customer_po_ref} ${w.material} ${cMap.get(w.customer_id)?.name ?? ''}`.toLowerCase().includes(needle)),
    )
  }, [wos, q, customer, priority, cMap])

  const sortWo = (a: WorkOrder, b: WorkOrder) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.due_date.localeCompare(b.due_date)
  const recent = addDays(today, -30)
  const board = useMemo(
    () =>
      WO_BOARD.map((st) => {
        const all = filtered.filter((w) => w.status === st).sort(sortWo)
        // keep the dispatched column short: last 30 days of activity
        const shown = st === 'dispatched' ? all.filter((w) => toISODate(new Date(w.updated_at)) >= recent) : all
        return { status: st, rows: shown, hidden: all.length - shown.length }
      }),
    [filtered, recent],
  )
  const listRows = useMemo(
    () => filtered.filter((w) => !status || (status === 'open' ? OPEN_WO.includes(w.status) : w.status === status)).sort((a, b) => (OPEN_WO.includes(a.status) === OPEN_WO.includes(b.status) ? a.due_date.localeCompare(b.due_date) : OPEN_WO.includes(a.status) ? -1 : 1)),
    [filtered, status],
  )

  const columns: Column<WorkOrder>[] = [
    { key: 'no', header: 'WO', value: (r) => r.wo_no, cell: (r) => <span className="whitespace-nowrap font-semibold text-ink">{r.wo_no}</span> },
    {
      key: 'part', header: 'Part', value: (r) => r.part_name,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block max-w-[220px] truncate font-medium">{r.part_name}</span>
          <span className="text-[12px] text-ink-faint">
            {r.part_no}
            {r.drawing_rev ? ` · rev ${r.drawing_rev}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'cust', header: 'Customer', value: (r) => cMap.get(r.customer_id)?.name ?? '', cell: (r) => <span className="block max-w-[180px] truncate">{cMap.get(r.customer_id)?.name}</span> },
    { key: 'route', header: 'Route', value: (r) => r.route_work_centre_ids.length, exportValue: (r) => r.route_work_centre_ids.length, cell: (r) => <RouteChips ids={r.route_work_centre_ids} />, hideOnMobile: true, sortable: false },
    {
      key: 'prog', header: 'Progress', value: (r) => (r.qty ? r.completed_qty / r.qty : 0), exportValue: (r) => `${r.completed_qty}/${r.qty}`,
      cell: (r) => (
        <span className="block w-32">
          <span className="num text-[12.5px] text-ink-soft">
            {r.completed_qty}/{r.qty}
            {r.rejected_qty ? <span className="text-rose-600"> · {r.rejected_qty} rej</span> : null}
          </span>
          <Progress value={r.completed_qty} max={r.qty} className="mt-1 h-1.5" />
        </span>
      ),
    },
    { key: 'value', header: 'Value', align: 'right', value: (r) => woValue(r), cell: (r) => inr(woValue(r)), hideOnMobile: true },
    { key: 'due', header: 'Due', value: (r) => r.due_date, exportValue: (r) => fmtDate(r.due_date), cell: (r) => <DueLabel wo={r} today={today} /> },
    { key: 'prio', header: 'Priority', value: (r) => PRIORITY_RANK[r.priority], exportValue: (r) => r.priority, cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{titleCase(r.priority)}</Badge>, hideOnMobile: true },
    { key: 'status', header: 'Status', value: (r) => WO_STATUS_LABEL[r.status], cell: (r) => <StatusBadge status={r.status} label={WO_STATUS_LABEL[r.status]} /> },
  ]

  return (
    <div className="min-w-0">
      <KpiGrid className="lg:grid-cols-5">
        <StatCard label="Open work orders" value={kpi.open} icon={<Factory className="h-4 w-4" />} accent="indigo" onClick={() => setStatus('open')} />
        <StatCard label="Due this week" value={kpi.dueThisWeek} icon={<CalendarClock className="h-4 w-4" />} accent="cyan" />
        <StatCard label="Overdue" value={kpi.overdue} icon={<AlarmClock className="h-4 w-4" />} accent={kpi.overdue ? 'red' : 'green'} hint="Open past due date" />
        <StatCard label="On-time delivery" value={kpi.onTimePct} format={(n) => `${Math.round(n)}%`} icon={<Target className="h-4 w-4" />} accent={kpi.onTimePct >= 90 ? 'green' : 'amber'} hint={`${kpi.doneCount} completed / dispatched`} />
        <StatCard label="Order book" value={kpi.orderBook} format={(n) => inrCompact(n)} icon={<BookOpen className="h-4 w-4" />} accent="pink" hint="Balance qty × unit price" className="xs:col-span-2 lg:col-span-1" />
      </KpiGrid>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: <span className="flex items-center gap-1.5"><KanbanSquare className="h-4 w-4" /> Board</span> },
            { value: 'list', label: <span className="flex items-center gap-1.5"><List className="h-4 w-4" /> List</span> },
          ]}
        />
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WO, part, customer PO…" className="h-10 py-0 pl-9 text-sm" aria-label="Search work orders" />
        </div>
        <FilterSelect label="Customer" value={customer} onChange={setCustomer} options={customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))} placeholder="All customers" />
        <FilterSelect label="Priority" value={priority} onChange={(v) => setPriority(v as Priority | '')} options={PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))} placeholder="Any priority" />
      </div>

      {view === 'board' ? (
        <div className="-mx-1 overflow-x-auto px-1 pb-2 scroll-thin">
          <div className="flex min-w-max gap-3">
            {board.map((col) => (
              <section key={col.status} className="flex w-[272px] shrink-0 flex-col rounded-lg border border-line bg-slate-50/70 p-2.5">
                <header className="mb-2 flex items-center justify-between gap-2 px-1">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLUMN_TINT[col.status] }} />
                    {WO_STATUS_LABEL[col.status]}
                  </span>
                  <span className="num rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold text-brand-700">{col.rows.length}</span>
                </header>
                <div className="flex min-h-[80px] flex-col gap-2">
                  {col.rows.map((w) => (
                    <WoCard key={w.id} wo={w} customer={cMap.get(w.customer_id)?.name ?? '—'} today={today} canManage={canManage} onOpen={() => onOpen(w)} onStatus={(to) => onStatus(w, to)} onProgress={() => onProgress(w)} />
                  ))}
                  {!col.rows.length && <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">Nothing here</p>}
                  {col.hidden > 0 && (
                    <button type="button" onClick={() => { setView('list'); setStatus(col.status) }} className="text-[12px] font-medium text-brand-600 hover:underline">
                      + {col.hidden} older — see list
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <DataTable
          rows={listRows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={onOpen}
          exportName="work-orders"
          toolbar={
            <FilterSelect
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as WorkOrderStatus | 'open' | '')}
              options={[{ value: 'open', label: 'Open' }, ...(Object.keys(WO_STATUS_LABEL) as WorkOrderStatus[]).map((st) => ({ value: st, label: WO_STATUS_LABEL[st] }))]}
              placeholder="All statuses"
            />
          }
          empty={<EmptyState title="No work orders" description="Nothing matches these filters." icon={<Factory className="h-6 w-6" />} />}
          mobileCard={(r) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink-faint">
                    {r.wo_no} · {cMap.get(r.customer_id)?.name}
                  </p>
                  <p className="truncate font-semibold text-ink">{r.part_name}</p>
                </div>
                <StatusBadge status={r.status} label={WO_STATUS_LABEL[r.status]} />
              </div>
              <Progress value={r.completed_qty} max={r.qty} className="h-1.5" />
              <div className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="num text-ink-soft">
                  {r.completed_qty}/{r.qty} · {inr(woValue(r))}
                </span>
                <DueLabel wo={r} today={today} />
              </div>
            </div>
          )}
        />
      )}
    </div>
  )
}

function WoCard({ wo, customer, today, canManage, onOpen, onStatus, onProgress }: { wo: WorkOrder; customer: string; today: string; canManage: boolean; onOpen: () => void; onStatus: (to: WorkOrderStatus) => void; onProgress: () => void }) {
  const late = isWoLate(wo, today)
  const next = WO_NEXT[wo.status]
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className={cn('cursor-pointer rounded-md border bg-white p-3 shadow-card transition-colors hover:border-line-strong', late ? 'border-red-300' : 'border-line')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink-faint">
            {wo.wo_no}
            <Badge tone={PRIORITY_TONE[wo.priority]} className="px-1.5 py-0 text-[10.5px]">
              {titleCase(wo.priority)}
            </Badge>
          </p>
          <p className="mt-0.5 line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">{wo.part_name}</p>
          <p className="truncate text-[12px] text-ink-soft">{customer}</p>
        </div>
        {canManage && (next.length > 0 || ['planned', 'in_progress', 'qc', 'on_hold'].includes(wo.status)) && (
          <Menu
            items={[
              ...(['planned', 'in_progress', 'qc', 'on_hold'].includes(wo.status) ? [{ label: 'Update progress', icon: <Gauge />, onClick: onProgress }] : []),
              ...next.map((to) => ({ label: `Move to ${WO_STATUS_LABEL[to]}`, onClick: () => onStatus(to), danger: to === 'cancelled' })),
            ]}
          />
        )}
      </div>
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[11.5px] text-ink-soft">
          <span className="num">
            {wo.completed_qty}/{wo.qty}
          </span>
          <span className="num">{inr(woValue(wo))}</span>
        </div>
        <Progress value={wo.completed_qty} max={wo.qty} className="h-1.5" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <RouteChips ids={wo.route_work_centre_ids} className="min-w-0" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
        <span className="text-ink-faint">Due</span>
        <DueLabel wo={wo} today={today} />
      </div>
    </div>
  )
}

/* ─────────────────────────── Customers ─────────────────────────── */

function CustomersTab({ onOpen }: { onOpen: (c: Customer) => void }) {
  const customers = useTable('customers')
  const wos = useTable('work_orders')
  const [showInactive, setShowInactive] = useState(false)
  const stats = useMemo(() => new Map(customers.map((c) => [c.id, customerOrderValue(c.id, wos)])), [customers, wos])
  const rows = useMemo(() => customers.filter((c) => showInactive || c.active).sort((a, b) => a.code.localeCompare(b.code)), [customers, showInactive])
  const columns: Column<Customer>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code, cell: (r) => <span className="font-semibold text-ink">{r.code}</span> },
    {
      key: 'name', header: 'Customer', value: (r) => r.name,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block max-w-[240px] truncate font-medium">
            {r.name}
            {!r.active && <Badge tone="slate" className="ml-2">Inactive</Badge>}
          </span>
          <span className="text-[12px] text-ink-faint">{r.contact_person || '—'}</span>
        </span>
      ),
    },
    { key: 'place', header: 'Location', value: (r) => `${r.city}, ${r.state}`, hideOnMobile: true },
    { key: 'gstin', header: 'GSTIN', value: (r) => r.gstin, cell: (r) => <span className="font-mono text-[12.5px] whitespace-nowrap">{r.gstin || '—'}</span>, hideOnMobile: true },
    { key: 'terms', header: 'Terms', value: (r) => r.payment_terms_days, cell: (r) => `${r.payment_terms_days} d`, hideOnMobile: true },
    { key: 'limit', header: 'Credit limit', align: 'right', value: (r) => r.credit_limit, cell: (r) => inr(r.credit_limit), hideOnMobile: true },
    { key: 'wos', header: 'WOs', align: 'right', value: (r) => stats.get(r.id)?.count ?? 0, cell: (r) => <span className="num">{stats.get(r.id)?.count ?? 0}{stats.get(r.id)?.open ? <span className="text-ink-faint"> ({stats.get(r.id)?.open} open)</span> : null}</span> },
    { key: 'value', header: 'Order value', align: 'right', value: (r) => stats.get(r.id)?.value ?? 0, cell: (r) => <span className="font-semibold">{inr(stats.get(r.id)?.value ?? 0)}</span> },
  ]
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={onOpen}
      searchText={(r) => `${r.code} ${r.name} ${r.contact_person} ${r.city} ${r.state} ${r.gstin} ${r.email} ${r.phone}`}
      searchPlaceholder="Search customer, city, GSTIN…"
      exportName="customers"
      toolbar={
        <label className="inline-flex cursor-pointer items-center gap-2 px-1 text-[13px] text-ink">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-[18px] w-[18px] accent-[#2a56a1]" />
          Show inactive
        </label>
      }
      empty={<EmptyState title="No customers" icon={<Users className="h-6 w-6" />} />}
      mobileCard={(r) => (
        <div className="space-y-1">
          <p className="text-[12px] font-medium text-ink-faint">{r.code}</p>
          <p className="truncate font-semibold text-ink">{r.name}</p>
          <div className="flex items-center justify-between text-[12.5px] text-ink-soft">
            <span>
              {r.city} · {stats.get(r.id)?.count ?? 0} WOs
            </span>
            <span className="num font-semibold text-ink">{inr(stats.get(r.id)?.value ?? 0)}</span>
          </div>
        </div>
      )}
    />
  )
}
