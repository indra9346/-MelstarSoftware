import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertOctagon, CheckCircle2, ClipboardCheck, ClipboardList, Lock, PackageX, Pencil, Plus } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Inspection, InspectionResult, InspectionType, Ncr, NcrDisposition } from '@/data/types'
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Menu, PageHeader, Ring, StatCard, StatusBadge, Tabs, confirm, confirmWithNote, guard, toast, type Column } from '@/components/ui'
import { ChartBox, axisProps, gridProps, tooltipProps } from '@/components/charts'
import { useLookups } from '@/hooks/useLookups'
import { useSession } from '@/services/session'
import { diffDays, fmtDate, fmtMonth, fyOf, fyRange, todayISO } from '@/lib/dates'
import { num, pct } from '@/lib/format'
import { DISPOSITION_LABEL, INSPECTION_TYPE_LABEL, RESULT_LABEL, closeNcr, deleteInspection, deleteNcr, qualityKpis, qualityTrend } from '@/services/quality'
import { useDialog, useLast, useQueryParam } from '@/components/ops/form'
import { DateRange, FilterSelect, KpiGrid, ViewOnly } from '@/components/ops/kit'
import { InspectionForm, NcrForm } from '@/components/ops/quality/QualityForms'
import { InspectionDrawer, NcrDrawer } from '@/components/ops/quality/QualityDrawers'

type Tab = 'inspections' | 'ncrs'
const TYPES = Object.keys(INSPECTION_TYPE_LABEL) as InspectionType[]

export default function QualityPage() {
  const s = useSession()
  const canManage = s.can('quality.manage')
  const inspections = useTable('inspections')
  const ncrs = useTable('ncrs')
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'ncrs' ? 'ncrs' : 'inspections')

  // ?insp=<id> opens an inspection; ?new=1&wo=<id> / &po=<id> starts one
  const [inspId, setInspId] = useQueryParam('insp')
  const liveInsp = inspections.find((i) => i.id === inspId)
  const drawerInsp = useLast(liveInsp)
  useEffect(() => {
    if (inspId && inspections.length && !liveInsp) {
      toast.error('Inspection not found')
      setInspId(null)
    }
  }, [inspId, inspections.length, liveInsp, setInspId])

  const inspDlg = useDialog<{ inspection: Inspection | null; woId?: string; poId?: string }>()
  const ncrDlg = useDialog<{ ncr: Ncr | null; from?: Inspection | null }>()
  const [ncrView, setNcrView] = useState<string | null>(null)
  const liveNcr = ncrs.find((n) => n.id === ncrView)
  const drawerNcr = useLast(liveNcr)

  const handledNew = useRef(false)
  const showInsp = inspDlg.show
  useEffect(() => {
    if (params.get('new') !== '1' || handledNew.current) return
    handledNew.current = true
    if (canManage) showInsp({ inspection: null, woId: params.get('wo') ?? undefined, poId: params.get('po') ?? undefined })
    else toast.error('You cannot record inspections')
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('new')
        n.delete('wo')
        n.delete('po')
        return n
      },
      { replace: true },
    )
  }, [params, canManage, showInsp, setParams])

  const afterSave = async (i: Inspection) => {
    setInspId(i.id)
    if (i.result === 'fail' && !ncrs.some((n) => n.inspection_id === i.id)) {
      const ok = await confirm({ title: `${i.insp_no} failed — raise an NCR?`, message: `${i.rejected_qty} rejected. An NCR records the root cause, disposition and corrective action.`, confirmLabel: 'Raise NCR', danger: true })
      if (ok) ncrDlg.show({ ncr: null, from: i })
    }
  }

  const doCloseNcr = async (n: Ncr) => {
    if (!n.corrective_action.trim()) {
      const r = await confirmWithNote({ title: `Close ${n.ncr_no}`, message: 'Record the corrective action that prevents a repeat.', confirmLabel: 'Close NCR', input: { label: 'Corrective action', required: true } })
      if (r.ok) await guard(() => closeNcr(n, r.note), `${n.ncr_no} closed`)
    } else if (await confirm({ title: `Close ${n.ncr_no}?`, message: `Corrective action: ${n.corrective_action}`, confirmLabel: 'Close NCR' })) {
      await guard(() => closeNcr(n), `${n.ncr_no} closed`)
    }
  }

  const kpi = useMemo(() => qualityKpis(inspections, ncrs, todayISO()), [inspections, ncrs])

  return (
    <div className="min-w-0">
      <PageHeader
        kicker="Operations"
        title={<span className="flex flex-wrap items-center gap-2">Quality <ViewOnly show={!canManage} /></span>}
        subtitle="Incoming, in-process, final and first-article inspection · non-conformance reports"
        actions={
          canManage && (
            <>
              <Button variant={tab === 'ncrs' ? 'primary' : 'secondary'} icon={<AlertOctagon className="h-4 w-4" />} onClick={() => ncrDlg.show({ ncr: null })}>
                Raise NCR
              </Button>
              {tab === 'inspections' && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => inspDlg.show({ inspection: null })}>
                  New inspection
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
          { value: 'inspections', label: 'Inspections', count: kpi.monthCount },
          { value: 'ncrs', label: 'NCRs', count: kpi.openNcrs },
        ]}
      />

      {tab === 'inspections' && <InspectionsTab kpi={kpi} onOpen={(i) => setInspId(i.id)} onGoNcrs={() => setTab('ncrs')} />}
      {tab === 'ncrs' && <NcrsTab canManage={canManage} onOpen={(n) => setNcrView(n.id)} onEdit={(n) => ncrDlg.show({ ncr: n })} onClose={(n) => void doCloseNcr(n)} />}

      {drawerInsp && (
        <InspectionDrawer
          open={!!liveInsp}
          onClose={() => setInspId(null)}
          inspection={liveInsp ?? drawerInsp}
          canManage={canManage}
          onEdit={() => inspDlg.show({ inspection: liveInsp ?? drawerInsp })}
          onDelete={async () => {
            const i = liveInsp ?? drawerInsp
            if (await confirm({ title: `Delete ${i.insp_no}?`, message: 'Inspections with NCRs cannot be deleted.', danger: true, confirmLabel: 'Delete' })) {
              await guard(() => {
                deleteInspection(i)
                setInspId(null)
              }, 'Inspection deleted')
            }
          }}
          onRaiseNcr={() => ncrDlg.show({ ncr: null, from: liveInsp ?? drawerInsp })}
          onOpenNcr={(n) => {
            setInspId(null)
            setNcrView(n.id)
          }}
        />
      )}
      {drawerNcr && (
        <NcrDrawer
          open={!!liveNcr}
          onClose={() => setNcrView(null)}
          ncr={liveNcr ?? drawerNcr}
          canManage={canManage}
          onEdit={() => ncrDlg.show({ ncr: liveNcr ?? drawerNcr })}
          onCloseNcr={() => void doCloseNcr(liveNcr ?? drawerNcr)}
          onOpenInspection={(id) => {
            setNcrView(null)
            setInspId(id)
          }}
        />
      )}

      <InspectionForm key={`i${inspDlg.key}`} open={inspDlg.open} onClose={inspDlg.close} inspection={inspDlg.data?.inspection ?? null} prefillWoId={inspDlg.data?.woId} prefillPoId={inspDlg.data?.poId} onSaved={(i) => void afterSave(i)} />
      <NcrForm key={`n${ncrDlg.key}`} open={ncrDlg.open} onClose={ncrDlg.close} ncr={ncrDlg.data?.ncr ?? null} fromInspection={ncrDlg.data?.from ?? null} />
    </div>
  )
}

/* ─────────────────────────── Inspections ─────────────────────────── */

function InspectionsTab({ kpi, onOpen, onGoNcrs }: { kpi: ReturnType<typeof qualityKpis>; onOpen: (i: Inspection) => void; onGoNcrs: () => void }) {
  const inspections = useTable('inspections')
  const wos = useTable('work_orders')
  const pos = useTable('purchase_orders')
  const L = useLookups()
  const today = todayISO()
  const [type, setType] = useState<InspectionType | ''>('')
  const [result, setResult] = useState<InspectionResult | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const woMap = useMemo(() => new Map(wos.map((w) => [w.id, w])), [wos])
  const poMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos])
  const trend = useMemo(() => qualityTrend(inspections, 6, today).map((t) => ({ ...t, label: fmtMonth(t.month, true).slice(0, 3) })), [inspections, today])
  const fy = fyRange(fyOf(today))
  const byType = useMemo(
    () =>
      TYPES.map((t) => {
        const rows = inspections.filter((i) => i.type === t && i.date >= fy.from)
        const pass = rows.filter((i) => i.result === 'pass').length
        return { type: t, count: rows.length, rate: rows.length ? (pass / rows.length) * 100 : 0 }
      }),
    [inspections, fy.from],
  )
  const rows = useMemo(
    () => inspections.filter((i) => (!type || i.type === type) && (!result || i.result === result) && (!from || i.date >= from) && (!to || i.date <= to)).sort((a, b) => (a.date === b.date ? b.insp_no.localeCompare(a.insp_no) : b.date.localeCompare(a.date))),
    [inspections, type, result, from, to],
  )
  const link = (i: Inspection) => (i.work_order_id ? woMap.get(i.work_order_id)?.wo_no : i.po_id ? poMap.get(i.po_id)?.po_no : null) ?? '—'

  const columns: Column<Inspection>[] = [
    { key: 'no', header: 'No.', value: (r) => r.insp_no, cell: (r) => <span className="whitespace-nowrap font-semibold text-ink">{r.insp_no}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, exportValue: (r) => fmtDate(r.date), cell: (r) => <span className="num whitespace-nowrap">{fmtDate(r.date)}</span> },
    { key: 'type', header: 'Type', value: (r) => INSPECTION_TYPE_LABEL[r.type], cell: (r) => <Badge tone={r.type === 'incoming' ? 'sky' : r.type === 'final' ? 'indigo' : r.type === 'first_article' ? 'violet' : 'cyan'}>{INSPECTION_TYPE_LABEL[r.type]}</Badge> },
    {
      key: 'part', header: 'Part', value: (r) => r.part_name,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block max-w-[220px] truncate font-medium">{r.part_name}</span>
          <span className="text-[12px] text-ink-faint">
            {link(r)}
            {r.lot_no ? ` · ${r.lot_no}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'lot', header: 'Lot / sample', value: (r) => r.lot_qty, exportValue: (r) => `${r.lot_qty}/${r.sample_size}`, cell: (r) => <span className="num">{r.lot_qty} / {r.sample_size}</span>, hideOnMobile: true },
    { key: 'acc', header: 'Accepted', align: 'right', value: (r) => r.accepted_qty, hideOnMobile: true },
    { key: 'rej', header: 'Rejected', align: 'right', value: (r) => r.rejected_qty, cell: (r) => <span className={r.rejected_qty ? 'font-semibold text-rose-600' : ''}>{r.rejected_qty}</span> },
    { key: 'result', header: 'Result', value: (r) => RESULT_LABEL[r.result], cell: (r) => <StatusBadge status={r.result} label={RESULT_LABEL[r.result]} /> },
    { key: 'insp', header: 'Inspector', value: (r) => L.empName(r.inspector_id), hideOnMobile: true },
  ]

  return (
    <div className="min-w-0">
      <KpiGrid>
        <StatCard label={`Inspections · ${fmtMonth(today.slice(0, 7), true)}`} value={kpi.monthCount} icon={<ClipboardList className="h-4 w-4" />} accent="indigo" />
        <StatCard label="Pass rate (month)" value={kpi.passRate} format={(n) => pct(n, 1)} icon={<CheckCircle2 className="h-4 w-4" />} accent={kpi.passRate >= 95 ? 'green' : kpi.passRate >= 85 ? 'amber' : 'red'} hint="Pass ÷ all results" />
        <StatCard label="Rejected qty (month)" value={kpi.rejectedQty} icon={<PackageX className="h-4 w-4" />} accent={kpi.rejectedQty ? 'pink' : 'green'} />
        <StatCard label="Open NCRs" value={kpi.openNcrs} icon={<AlertOctagon className="h-4 w-4" />} accent={kpi.openNcrs ? 'red' : 'green'} onClick={onGoNcrs} />
      </KpiGrid>

      <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Results by month" subtitle="Pass · conditional · fail — last 6 months" />
          <CardBody className="pt-2">
            <ChartBox height={220}>
              <BarChart data={trend} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="pass" name="Pass" stackId="r" fill="#10b981" maxBarSize={36} />
                <Bar dataKey="conditional" name="Conditional" stackId="r" fill="#f59e0b" maxBarSize={36} />
                <Bar dataKey="fail" name="Fail" stackId="r" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ChartBox>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-soft">
              {[['Pass', '#10b981'], ['Conditional', '#f59e0b'], ['Fail', '#f43f5e']].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Pass rate by stage" subtitle="This financial year" />
          <CardBody className="space-y-3 pt-3">
            {byType.map((t) => (
              <div key={t.type} className="flex items-center gap-3">
                <Ring value={t.rate} size={52} stroke={6} label={<span className="text-[12px]">{t.count ? Math.round(t.rate) : '—'}</span>} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{INSPECTION_TYPE_LABEL[t.type]}</p>
                  <p className="text-[12px] text-ink-soft">{t.count} inspection{t.count === 1 ? '' : 's'}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        searchText={(r) => `${r.insp_no} ${r.part_name} ${r.lot_no} ${link(r)} ${L.empName(r.inspector_id)} ${r.remarks}`}
        searchPlaceholder="Search no., part, lot, WO / PO…"
        exportName="inspections"
        toolbar={
          <>
            <FilterSelect label="Type" value={type} onChange={(v) => setType(v as InspectionType | '')} options={TYPES.map((t) => ({ value: t, label: INSPECTION_TYPE_LABEL[t] }))} placeholder="All types" />
            <FilterSelect label="Result" value={result} onChange={(v) => setResult(v as InspectionResult | '')} options={(['pass', 'conditional', 'fail'] as const).map((r) => ({ value: r, label: RESULT_LABEL[r] }))} placeholder="All results" />
            <DateRange
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f)
                setTo(t)
              }}
            />
          </>
        }
        empty={<EmptyState title="No inspections" description="Nothing matches these filters." icon={<ClipboardCheck className="h-6 w-6" />} />}
        mobileCard={(r) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink-faint">
                  {r.insp_no} · {fmtDate(r.date)} · {INSPECTION_TYPE_LABEL[r.type]}
                </p>
                <p className="truncate font-semibold text-ink">{r.part_name}</p>
              </div>
              <StatusBadge status={r.result} label={RESULT_LABEL[r.result]} />
            </div>
            <p className="text-[12.5px] text-ink-soft">
              {link(r)} · lot {r.lot_qty} · <span className={r.rejected_qty ? 'font-semibold text-rose-600' : ''}>{r.rejected_qty} rejected</span>
            </p>
          </div>
        )}
      />
    </div>
  )
}

/* ─────────────────────────── NCRs ─────────────────────────── */

function NcrsTab({ canManage, onOpen, onEdit, onClose }: { canManage: boolean; onOpen: (n: Ncr) => void; onEdit: (n: Ncr) => void; onClose: (n: Ncr) => void }) {
  const ncrs = useTable('ncrs')
  const inspections = useTable('inspections')
  const L = useLookups()
  const today = todayISO()
  const [status, setStatus] = useState<'open' | 'closed' | ''>('open')
  const [disp, setDisp] = useState<NcrDisposition | ''>('')
  const iMap = useMemo(() => new Map(inspections.map((i) => [i.id, i])), [inspections])
  const rows = useMemo(() => ncrs.filter((n) => (!status || n.status === status) && (!disp || n.disposition === disp)).sort((a, b) => b.ncr_no.localeCompare(a.ncr_no)), [ncrs, status, disp])

  const remove = async (n: Ncr) => {
    if (await confirm({ title: `Delete ${n.ncr_no}?`, message: 'NCRs are quality records — close them instead of deleting where possible.', danger: true, confirmLabel: 'Delete' })) await guard(() => deleteNcr(n), 'NCR deleted')
  }

  const columns: Column<Ncr>[] = [
    { key: 'no', header: 'NCR', value: (r) => r.ncr_no, cell: (r) => <span className="whitespace-nowrap font-semibold text-ink">{r.ncr_no}</span> },
    { key: 'date', header: 'Date', value: (r) => r.date, exportValue: (r) => fmtDate(r.date), cell: (r) => <span className="num whitespace-nowrap">{fmtDate(r.date)}</span> },
    { key: 'desc', header: 'Non-conformance', value: (r) => r.description, cell: (r) => <span className="block max-w-[320px] truncate" title={r.description}>{r.description}</span> },
    { key: 'insp', header: 'Inspection', value: (r) => iMap.get(r.inspection_id ?? '')?.insp_no ?? '', cell: (r) => iMap.get(r.inspection_id ?? '')?.insp_no ?? <span className="text-ink-faint">—</span>, hideOnMobile: true },
    { key: 'qty', header: 'Qty', align: 'right', value: (r) => r.qty_affected },
    { key: 'disp', header: 'Disposition', value: (r) => DISPOSITION_LABEL[r.disposition], cell: (r) => <Badge tone={r.disposition === 'scrap' ? 'red' : r.disposition === 'rework' ? 'amber' : r.disposition === 'return_to_vendor' ? 'violet' : 'sky'}>{DISPOSITION_LABEL[r.disposition]}</Badge> },
    { key: 'owner', header: 'Owner', value: (r) => L.empName(r.owner_id), hideOnMobile: true },
    {
      key: 'status', header: 'Status', value: (r) => r.status,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge status={r.status} />
          <span className="text-[11.5px] text-ink-faint">{r.status === 'open' ? `${diffDays(r.date, today)} d open` : `closed ${fmtDate(r.closed_on)}`}</span>
        </span>
      ),
    },
    {
      key: 'act', header: '', export: false, sortable: false, align: 'right',
      cell: (r) =>
        canManage ? (
          <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status === 'open' && (
              <Button size="sm" variant="secondary" icon={<Lock className="h-3.5 w-3.5" />} onClick={() => onClose(r)}>
                Close
              </Button>
            )}
            <Menu items={[{ label: 'Edit', icon: <Pencil />, onClick: () => onEdit(r) }, { label: 'Delete', icon: <AlertOctagon />, danger: true, onClick: () => void remove(r) }]} />
          </span>
        ) : null,
    },
  ]
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={onOpen}
      searchText={(r) => `${r.ncr_no} ${r.description} ${r.root_cause} ${r.corrective_action} ${L.empName(r.owner_id)} ${iMap.get(r.inspection_id ?? '')?.insp_no ?? ''}`}
      searchPlaceholder="Search NCR, description, cause…"
      exportName="ncr-register"
      toolbar={
        <>
          <FilterSelect label="Status" value={status} onChange={(v) => setStatus(v as 'open' | 'closed' | '')} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} placeholder="All" />
          <FilterSelect label="Disposition" value={disp} onChange={(v) => setDisp(v as NcrDisposition | '')} options={(Object.keys(DISPOSITION_LABEL) as NcrDisposition[]).map((d) => ({ value: d, label: DISPOSITION_LABEL[d] }))} placeholder="Any disposition" />
        </>
      }
      empty={<EmptyState title={status === 'open' ? 'No open NCRs' : 'No NCRs'} description={status === 'open' ? 'Every non-conformance has been closed.' : undefined} icon={<CheckCircle2 className="h-6 w-6" />} />}
      mobileCard={(r) => (
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] font-semibold text-ink-faint">
              {r.ncr_no} · {fmtDate(r.date)} · qty {num(r.qty_affected, 0)}
            </p>
            <StatusBadge status={r.status} />
          </div>
          <p className="line-clamp-2 text-sm font-medium text-ink">{r.description}</p>
          <p className="text-[12px] text-ink-soft">{DISPOSITION_LABEL[r.disposition]} · {L.empName(r.owner_id)}</p>
        </div>
      )}
    />
  )
}
