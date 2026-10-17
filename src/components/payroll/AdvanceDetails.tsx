import { useMemo } from 'react'
import { CalendarClock, CheckCircle2 } from 'lucide-react'
import { useTable } from '@/data/store'
import type { Advance, PayrollRun } from '@/data/types'
import { Badge, InfoGrid, Progress, StatusBadge } from '@/components/ui'
import { EmployeeCell } from '@/components/EmployeeCell'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, fmtDateTime, fmtMonth } from '@/lib/dates'
import { inr } from '@/lib/format'
import { ADVANCE_TYPE_LABEL, advanceProgress } from '@/services/payroll'
import { useSession } from '@/services/session'

const NO_RUNS: PayrollRun[] = []

/** Recovery schedule of an advance/loan: summary, details, recoveries so far and projected EMIs. */
export function AdvanceDetails({ advance: a, showEmployee }: { advance: Advance; showEmployee?: boolean }) {
  const recoveries = useTable('advance_recoveries')
  const allRuns = useTable('payroll_runs')
  const s = useSession()
  const L = useLookups()
  // payroll runs are payroll staff data — self-service views never read them
  const runs = s.canAny(['payroll.view', 'payroll.manage']) ? allRuns : NO_RUNS
  const prog = useMemo(() => advanceProgress(a, recoveries, new Set(runs.filter((r) => r.status === 'paid').map((r) => r.month))), [a, recoveries, runs])
  const reviewer = a.approved_by ? L.user.get(a.approved_by)?.display_name ?? 'HR' : '—'
  const lastEmi = a.installments > 1 ? a.amount - a.emi_amount * (a.installments - 1) : a.amount

  return (
    <div className="space-y-5">
      {showEmployee && <EmployeeCell id={a.employee_id} size={40} />}

      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge tone={a.type === 'loan' ? 'violet' : 'cyan'}>{ADVANCE_TYPE_LABEL[a.type]}</Badge>
            <StatusBadge status={a.status} />
          </div>
          <span className="num font-display text-xl font-bold text-ink">{inr(a.amount)}</span>
        </div>
        {(a.status === 'active' || a.status === 'closed' || a.status === 'approved') && (
          <>
            <Progress value={prog.recovered} max={a.amount} className="mt-3" />
            <div className="mt-2 grid grid-cols-1 gap-2 text-[12.5px] xs:grid-cols-3">
              <span className="text-ink-soft">
                Recovered <b className="num text-ink">{inr(prog.recovered)}</b>
              </span>
              <span className="text-ink-soft xs:text-center">
                Outstanding <b className="num text-ink">{inr(prog.outstanding)}</b>
              </span>
              <span className="text-ink-soft xs:text-right">
                Next EMI <b className="text-ink">{prog.next ? fmtMonth(prog.next, true) : '—'}</b>
              </span>
            </div>
            {a.status === 'closed' && prog.balance > 0 && <p className="mt-2 text-[12px] text-ink-soft">Closed early — {inr(prog.balance)} was settled outside payroll.</p>}
          </>
        )}
      </div>

      <InfoGrid
        items={[
          ['EMI', `${inr(a.emi_amount)} × ${a.installments}${lastEmi !== a.emi_amount && lastEmi > 0 ? ` (last ${inr(lastEmi)})` : ''}`],
          ['Recovery starts', fmtMonth(a.start_month)],
          ['Requested on', fmtDate(a.requested_on)],
          ['Disbursed on', fmtDate(a.disbursed_on)],
          [a.status === 'rejected' ? 'Rejected by' : 'Approved by', a.approved_at ? `${reviewer} · ${fmtDateTime(a.approved_at)}` : '—'],
          ['Reason', a.reason],
          ...(a.review_note ? ([['Review note', a.review_note]] as [string, string][]) : []),
        ]}
      />

      <div>
        <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Recovered through payroll
        </p>
        {prog.recoveries.length ? (
          <ul className="divide-y divide-indigo-50 rounded-xl border border-indigo-100 bg-white">
            {prog.recoveries.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]">
                <span className="text-ink">{fmtMonth(r.month)}</span>
                <span className="num font-semibold text-ink">{inr(r.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-ink-soft">Nothing recovered yet.</p>
        )}
      </div>

      {prog.schedule.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
            <CalendarClock className="h-4 w-4 text-brand-indigo" /> Upcoming EMIs
          </p>
          <ul className="grid grid-cols-1 gap-1.5 xs:grid-cols-2">
            {prog.schedule.slice(0, 12).map((x, i) => (
              <li key={x.month} className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-white px-3 py-2 text-[13px]">
                <span className="text-ink-soft">
                  {i === 0 && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-indigo align-middle" />}
                  {fmtMonth(x.month, true)}
                </span>
                <span className="num font-semibold text-ink">{inr(x.amount)}</span>
              </li>
            ))}
          </ul>
          {prog.schedule.length > 12 && <p className="mt-1.5 text-[12px] text-ink-faint">+ {prog.schedule.length - 12} more months</p>}
        </div>
      )}
    </div>
  )
}
