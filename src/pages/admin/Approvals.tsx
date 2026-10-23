import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Banknote, CalendarDays, Check, CheckCheck, CheckCircle2, Clock3, FileText, Paperclip, ShoppingCart, Timer, Wallet, X } from 'lucide-react'
import { useSettings, useTable } from '@/data/store'
import type { Advance, AttendanceRecord, LeaveRequest, PettyCashVoucher, PurchaseOrder, Regularisation } from '@/data/types'
import { useSession } from '@/services/session'
import { useLookups } from '@/hooks/useLookups'
import { approvalPreview, approveLeave, fmtLeaveDates, rejectLeave } from '@/services/leaves'
import { approveRegularisation, decideOvertime, describeRegularisation, rejectRegularisation } from '@/services/attendance'
import { approvalBlock, approveAndPay, approveVoucher, payBlock, payVoucher, rejectVoucher, cashInHand } from '@/services/pettyCash'
import { approveAdvance, rejectAdvance } from '@/services/payroll'
import { approvePo } from '@/services/purchase'
import { openFile } from '@/services/files'
import { fmtDate, fmtDateShort, fmtMonth, fmtTime, relativeTime } from '@/lib/dates'
import { inr, num } from '@/lib/format'
import { cn, sum } from '@/lib/misc'
import { Badge, Button, EmptyState, PageHeader, Tabs, confirm, confirmWithNote, guard, toast } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'

type Kind = 'all' | 'leave' | 'regularisation' | 'overtime' | 'voucher' | 'advance' | 'purchase'

export default function ApprovalsPage() {
  const s = useSession()
  const settings = useSettings()
  const L = useLookups()
  const leaves = useTable('leave_requests')
  const regs = useTable('regularisations')
  const attendance = useTable('attendance')
  const vouchers = useTable('petty_cash_vouchers')
  const advances = useTable('advances')
  const pos = useTable('purchase_orders')
  const entries = useTable('petty_cash_entries')
  const leaveTypes = useTable('leave_types')
  const vendors = useTable('vendors')
  const [tab, setTab] = useState<Kind>('all')

  const data = useMemo(() => {
    const byDate = <T,>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => key(a).localeCompare(key(b)))
    return {
      leave: s.can('leaves.manage') ? byDate(leaves.filter((l) => l.status === 'pending'), (l) => l.from_date) : [],
      regularisation: s.can('attendance.manage') ? byDate(regs.filter((r) => r.status === 'pending'), (r) => r.date) : [],
      overtime: s.can('attendance.manage') ? byDate(attendance.filter((a) => a.ot_status === 'pending' && a.ot_minutes > 0), (a) => a.date) : [],
      voucher: s.can('petty_cash.manage') ? byDate(vouchers.filter((v) => v.status === 'pending' || v.status === 'approved'), (v) => v.date) : [],
      advance: s.can('payroll.manage') ? byDate(advances.filter((a) => a.status === 'pending'), (a) => a.requested_on) : [],
      purchase: s.can('purchase.manage') ? byDate(pos.filter((p) => p.status === 'draft'), (p) => p.date) : [],
    }
  }, [s, leaves, regs, attendance, vouchers, advances, pos])

  const counts = {
    leave: data.leave.length, regularisation: data.regularisation.length, overtime: data.overtime.length,
    voucher: data.voucher.length, advance: data.advance.length, purchase: data.purchase.length,
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const cash = useMemo(() => cashInHand(entries), [entries])
  const show = (k: Exclude<Kind, 'all'>) => (tab === 'all' || tab === k) && counts[k] > 0

  const tabs = [
    { value: 'all' as const, label: 'All', count: total },
    ...(s.can('leaves.manage') ? [{ value: 'leave' as const, label: 'Leave', count: counts.leave }] : []),
    ...(s.can('attendance.manage') ? [{ value: 'regularisation' as const, label: 'Corrections', count: counts.regularisation }, { value: 'overtime' as const, label: 'Overtime', count: counts.overtime }] : []),
    ...(s.can('petty_cash.manage') ? [{ value: 'voucher' as const, label: 'Petty cash', count: counts.voucher }] : []),
    ...(s.can('payroll.manage') ? [{ value: 'advance' as const, label: 'Advances', count: counts.advance }] : []),
    ...(s.can('purchase.manage') ? [{ value: 'purchase' as const, label: 'Purchase', count: counts.purchase }] : []),
  ]

  /* ── actions ── */
  const decideLeave = async (l: LeaveRequest, ok: boolean) => {
    const name = L.empName(l.employee_id)
    if (!ok) {
      const r = await confirmWithNote({ title: `Reject leave — ${name}`, input: { label: 'Reason (shown to the employee)', required: true }, confirmLabel: 'Reject', danger: true })
      if (r.ok) await guard(() => rejectLeave(l, r.note), 'Leave rejected')
      return
    }
    const p = approvalPreview(l)
    if (p.clash) return toast.error('Overlaps an approved leave', fmtLeaveDates(p.clash))
    if (p.goesNegative) {
      const yes = await confirm({ title: 'Balance will go negative', message: `Approving takes ${name}'s ${p.type?.code} balance to ${num(p.after)} day(s). Approve anyway?`, confirmLabel: 'Approve anyway' })
      if (!yes) return
    }
    await guard(() => approveLeave(l, '', { allowNegative: true }), `Leave approved for ${name}`)
  }
  const decideReg = async (r: Regularisation, ok: boolean) => {
    if (ok) return void (await guard(() => approveRegularisation(r), 'Correction approved — attendance updated'))
    const n = await confirmWithNote({ title: 'Reject attendance correction', input: { label: 'Reason', required: true }, confirmLabel: 'Reject', danger: true })
    if (n.ok) await guard(() => rejectRegularisation(r, n.note), 'Correction rejected')
  }
  const decideOt = (recs: AttendanceRecord[], ok: boolean) => guard(() => decideOvertime(recs, ok ? 'approved' : 'rejected'), ok ? `Overtime approved (${recs.length})` : 'Overtime rejected')
  const decideVoucher = async (v: PettyCashVoucher, action: 'approve' | 'pay' | 'approve_pay' | 'reject') => {
    if (action === 'reject') {
      const n = await confirmWithNote({ title: `Reject ${v.voucher_no}`, input: { label: 'Reason', required: true }, confirmLabel: 'Reject', danger: true })
      if (n.ok) await guard(() => rejectVoucher(v, n.note), 'Claim rejected')
      return
    }
    if (action === 'approve') return void (await guard(() => approveVoucher(v), `${v.voucher_no} approved`))
    if (action === 'pay') return void (await guard(() => payVoucher(v), `${v.voucher_no} paid from the cash box`))
    await guard(() => approveAndPay(v), `${v.voucher_no} approved and paid`)
  }
  const decideAdvance = async (a: Advance, ok: boolean) => {
    if (ok) return void (await guard(() => approveAdvance(a), 'Advance approved — recovery scheduled in payroll'))
    const n = await confirmWithNote({ title: 'Reject advance request', input: { label: 'Reason', required: true }, confirmLabel: 'Reject', danger: true })
    if (n.ok) await guard(() => rejectAdvance(a, n.note), 'Advance rejected')
  }
  const decidePo = (p: PurchaseOrder) => guard(() => approvePo(p), `${p.po_no} approved`)

  return (
    <div>
      <PageHeader kicker="Inbox" title="Approvals" subtitle={total ? `${total} item${total === 1 ? '' : 's'} waiting for a decision` : 'Nothing is waiting — great work.'} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {!total || (tab !== 'all' && !counts[tab]) ? (
        <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing pending" description="New leave requests, corrections, overtime, claims, advances and draft POs appear here the moment they are submitted." />
      ) : (
        <div className="space-y-6">
          {show('leave') && (
            <Section icon={<CalendarDays className="h-4 w-4" />} title="Leave requests" count={counts.leave} link="/admin/leaves">
              {data.leave.map((l) => {
                const type = leaveTypes.find((t) => t.id === l.leave_type_id)
                const p = approvalPreview(l)
                return (
                  <Item key={l.id} who={l.employee_id} when={l.applied_at} actions={<Decide onApprove={() => decideLeave(l, true)} onReject={() => decideLeave(l, false)} />}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-[12px] font-medium text-white" style={{ background: type?.color ?? '#2a56a1' }}>
                        {type?.code}
                      </span>
                      <span className="font-semibold text-ink">{fmtLeaveDates(l)}</span>
                      <Badge tone="slate">{num(l.days)} day{l.days === 1 ? '' : 's'}</Badge>
                      {!p.unlimited && <Badge tone={p.goesNegative ? 'red' : 'green'}>balance after {num(p.after)}</Badge>}
                      {p.clash && <Badge tone="red">overlaps approved leave</Badge>}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-soft">“{l.reason}”</p>
                    {l.attachment && (
                      <button onClick={() => void openFile(l.attachment)} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
                        <Paperclip className="h-3.5 w-3.5" /> Attachment
                      </button>
                    )}
                  </Item>
                )
              })}
            </Section>
          )}

          {show('regularisation') && (
            <Section icon={<Clock3 className="h-4 w-4" />} title="Attendance corrections" count={counts.regularisation} link="/admin/attendance">
              {data.regularisation.map((r) => (
                <Item key={r.id} who={r.employee_id} when={r.created_at} actions={<Decide onApprove={() => decideReg(r, true)} onReject={() => decideReg(r, false)} />}>
                  <p className="font-semibold text-ink">
                    {fmtDate(r.date)} · <span className="font-medium text-ink-soft">{describeRegularisation(r)}</span>
                  </p>
                  <p className="mt-1 text-[13px] text-ink-soft">“{r.reason}”</p>
                </Item>
              ))}
            </Section>
          )}

          {show('overtime') && (
            <Section
              icon={<Timer className="h-4 w-4" />}
              title="Overtime"
              count={counts.overtime}
              link="/admin/attendance"
              extra={
                <Button size="sm" variant="success" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void decideOt(data.overtime, true)}>
                  Approve all ({num(sum(data.overtime, (a) => a.ot_minutes) / 60)} h)
                </Button>
              }
            >
              {data.overtime.slice(0, 40).map((a) => (
                <Item key={a.id} who={a.employee_id} when={a.check_out ?? a.updated_at} actions={<Decide onApprove={() => void decideOt([a], true)} onReject={() => void decideOt([a], false)} />}>
                  <p className="font-semibold text-ink">
                    {fmtDateShort(a.date)} · {num(a.ot_minutes / 60)} h beyond shift
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-soft">
                    In {fmtTime(a.check_in)} · Out {fmtTime(a.check_out)} · worked {num(a.worked_minutes / 60)} h
                  </p>
                </Item>
              ))}
              {data.overtime.length > 40 && <p className="px-1 text-[12.5px] text-ink-soft">+ {data.overtime.length - 40} more — use “Approve all” or the Attendance → Overtime tab.</p>}
            </Section>
          )}

          {show('voucher') && (
            <Section icon={<Wallet className="h-4 w-4" />} title="Petty-cash claims" count={counts.voucher} link="/admin/petty-cash" extra={<Badge tone={cash < settings.petty_cash_low_alert ? 'red' : 'indigo'}>Cash in hand {inr(cash)}</Badge>}>
              {data.voucher.map((v) => {
                const aBlock = v.status === 'pending' ? approvalBlock(v, s) : null
                const pBlock = v.status === 'approved' ? payBlock(v, cash, s) : null
                return (
                  <Item
                    key={v.id}
                    who={v.employee_id}
                    when={v.created_at}
                    actions={
                      v.status === 'pending' ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => void decideVoucher(v, 'reject')}>
                            Reject
                          </Button>
                          <Button size="sm" variant="secondary" disabled={!!aBlock} title={aBlock ?? undefined} onClick={() => void decideVoucher(v, 'approve')}>
                            Approve
                          </Button>
                          <Button size="sm" variant="success" disabled={!!aBlock} title={aBlock ?? undefined} icon={<Check className="h-4 w-4" />} onClick={() => void decideVoucher(v, 'approve_pay')}>
                            Approve & pay
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => void decideVoucher(v, 'reject')}>
                            Reject
                          </Button>
                          <Button size="sm" disabled={!!pBlock} title={pBlock ?? undefined} icon={<Banknote className="h-4 w-4" />} onClick={() => void decideVoucher(v, 'pay')}>
                            Pay {inr(v.amount)}
                          </Button>
                        </div>
                      )
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{inr(v.amount)}</span>
                      <Badge tone="slate">{v.category}</Badge>
                      <span className="text-[12.5px] text-ink-faint">{v.voucher_no}</span>
                      {v.status === 'approved' && <Badge tone="green">approved · awaiting payment</Badge>}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-soft">
                      {v.description}
                      {v.payee && ` · ${v.payee}`}
                      {v.bill_no && ` · bill ${v.bill_no}`}
                    </p>
                    {v.attachment && (
                      <button onClick={() => void openFile(v.attachment)} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
                        <Paperclip className="h-3.5 w-3.5" /> View bill
                      </button>
                    )}
                    {(aBlock || pBlock) && <p className="mt-1 text-[12px] font-medium text-amber-700">{aBlock ?? pBlock}</p>}
                  </Item>
                )
              })}
            </Section>
          )}

          {show('advance') && (
            <Section icon={<Banknote className="h-4 w-4" />} title="Advances & loans" count={counts.advance} link="/admin/payroll">
              {data.advance.map((a) => (
                <Item key={a.id} who={a.employee_id} when={a.created_at} actions={<Decide onApprove={() => decideAdvance(a, true)} onReject={() => decideAdvance(a, false)} />}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{inr(a.amount)}</span>
                    <Badge tone={a.type === 'loan' ? 'violet' : 'cyan'}>{a.type === 'loan' ? 'Loan' : 'Salary advance'}</Badge>
                    <span className="text-[12.5px] text-ink-soft">
                      {a.installments} × {inr(a.emi_amount)} from {fmtMonth(a.start_month, true)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-ink-soft">“{a.reason}”</p>
                </Item>
              ))}
            </Section>
          )}

          {show('purchase') && (
            <Section icon={<ShoppingCart className="h-4 w-4" />} title="Draft purchase orders" count={counts.purchase} link="/admin/purchase">
              {data.purchase.map((p) => (
                <Item
                  key={p.id}
                  title={
                    <span>
                      <span className="block font-semibold text-ink">{p.po_no}</span>
                      <span className="block text-[12px] text-ink-soft">{vendors.find((v) => v.id === p.vendor_id)?.name ?? '—'}</span>
                    </span>
                  }
                  when={p.created_at}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/admin/purchase?po=${p.id}`}>
                        <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />}>
                          Open
                        </Button>
                      </Link>
                      <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => void decidePo(p)}>
                        Approve
                      </Button>
                    </div>
                  }
                >
                  <p className="font-semibold text-ink">{inr(p.total)} <span className="text-[12.5px] font-medium text-ink-soft">incl. GST · dated {fmtDate(p.date)}</span></p>
                  {p.notes && <p className="mt-1 text-[13px] text-ink-soft">{p.notes}</p>}
                </Item>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, count, link, extra, children }: { icon: ReactNode; title: string; count: number; link: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-600">{icon}</span>
          {title}
          <span className="num rounded-full bg-brand-100 px-2 py-px text-[11.5px] font-semibold text-brand-700">{count}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <Link to={link} className="text-[13px] font-medium text-brand-600 hover:underline">
            Open module →
          </Link>
        </div>
      </div>
      <ul className="space-y-2.5">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </section>
  )
}

function Item({ who, title, when, actions, children }: { who?: string; title?: ReactNode; when: string; actions: ReactNode; children: ReactNode }) {
  return (
    <li className="card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="w-full shrink-0 md:w-56">
          {who ? <EmployeeCell id={who} /> : title}
          <p className="mt-1 text-[11.5px] text-ink-faint">{relativeTime(when)}</p>
        </div>
        <div className="min-w-0 flex-1 text-sm">{children}</div>
        <div className={cn('shrink-0')}>{actions}</div>
      </div>
    </li>
  )
}

function Decide({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={onReject}>
        Reject
      </Button>
      <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={onApprove}>
        Approve
      </Button>
    </div>
  )
}

