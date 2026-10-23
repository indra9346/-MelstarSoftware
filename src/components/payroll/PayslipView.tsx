import { useCallback, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { useSettings } from '@/data/store'
import type { Payslip } from '@/data/types'
import { Button, Modal, toast } from '@/components/ui'
import { LogoMark } from '@/components/brand'
import { useLookups } from '@/hooks/useLookups'
import { fmtDate, fmtMonth, monthEnd, monthStart } from '@/lib/dates'
import { amountInWords, inr, num } from '@/lib/format'
import { cn } from '@/lib/misc'
import { downloadPayslip, employerContributions, payslipData, payslipLines, type PayLine, type PayslipPdfData } from '@/lib/payslipPdf'
import { audit } from '@/services/audit'
import { useSticky } from './utils'

/** slip → everything the payslip shows (employee, company from Settings). */
export function usePayslipData() {
  const L = useLookups()
  const settings = useSettings()
  return useCallback(
    (slip: Payslip): PayslipPdfData => {
      const e = L.emp.get(slip.employee_id)
      return payslipData(slip, e, { designation: e ? L.desigTitle(e.designation_id) : '—', department: e ? L.deptName(e.department_id) : '—', settings })
    },
    [L, settings],
  )
}

function Lines({ title, lines, totalLabel, total, empty }: { title: string; lines: PayLine[]; totalLabel: string; total: number; empty?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between bg-brand-600 px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-wider text-white">
        <span>{title}</span>
        <span>Amount</span>
      </div>
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.label} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13.5px]">
            <span className="min-w-0 truncate text-ink">
              {l.label}
              {l.note && <span className="ml-1.5 text-[11.5px] text-ink-faint">{l.note}</span>}
            </span>
            <span className="num shrink-0 text-ink">{inr(l.amount)}</span>
          </li>
        ))}
        {!lines.length && empty && <li className="px-3.5 py-2 text-[13px] italic text-ink-faint">{empty}</li>}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-line bg-slate-50 px-3.5 py-2.5 text-[13.5px] font-medium text-ink">
        <span>{totalLabel}</span>
        <span className="num">{inr(total)}</span>
      </div>
    </div>
  )
}

/** On-screen payslip — the same blocks, in the same order, as the PDF. */
export function PayslipView({ data }: { data: PayslipPdfData }) {
  const p = data.slip
  const { earnings, deductions } = payslipLines(p)
  const er = employerContributions(p)
  const items: [string, ReactNode][] = [
    ['Employee', data.employee.name],
    ['Employee code', data.employee.code],
    ['Designation', data.employee.designation],
    ['Department', data.employee.department],
    ['Date of joining', data.employee.doj],
    ['PAN', data.employee.pan],
    ['UAN', data.employee.uan],
    ['ESIC no.', data.employee.esic],
    ['Bank', data.employee.bank],
    ['Account no.', data.employee.account],
    ['Days in month', num(p.days_in_month)],
    ['Paid days', num(p.paid_days)],
    ['LOP days', num(p.lop_days)],
    ['Tax regime', p.tax_regime === 'old' ? 'Old regime' : 'New regime'],
  ]
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="h-1.5 bg-brand-600" />
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <LogoMark size={38} />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug text-ink">{data.company.name}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{data.company.address}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="kicker">Payslip</p>
            <p className="text-lg font-semibold text-ink">{fmtMonth(p.month)}</p>
            <p className="text-[11.5px] text-ink-faint">
              {fmtDate(monthStart(p.month))} – {fmtDate(monthEnd(p.month))}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-lg border border-line bg-slate-50 p-4 xs:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 xs:block">
            <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{k}</dt>
            <dd className="min-w-0 truncate text-right text-[13.5px] font-medium text-ink xs:text-left">{v || '—'}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Lines title="Earnings" lines={earnings} totalLabel="Gross earnings" total={p.gross_earnings} />
        <Lines title="Deductions" lines={deductions} totalLabel="Total deductions" total={p.total_deductions} empty="No deductions this month" />
      </div>

      <div
        className="relative overflow-hidden rounded-lg bg-brand-600 p-4 text-white"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-white/80">Net pay</p>
            <p className="text-[12px] text-white/80">
              {inr(p.gross_earnings)} − {inr(p.total_deductions)}
            </p>
          </div>
          <p className="num text-[28px] font-semibold leading-none sm:text-[32px]">{inr(p.net_pay)}</p>
        </div>
        <p className="mt-2 text-[12.5px] italic text-white/90">{amountInWords(p.net_pay)}</p>
      </div>

      <div className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-soft">
        <p>
          <span className="font-semibold text-ink">Attendance:</span> working days {num(p.working_days)} · present {num(p.present_days)} · paid leave {num(p.paid_leave_days)} · holidays {num(p.holidays)} · week offs{' '}
          {num(p.week_offs)} · late marks {num(p.late_marks)} · OT {num(p.ot_hours)} h
        </p>
        <p>
          <span className="font-semibold text-ink">Employer contributions</span> (not deducted from pay): EPF {inr(er.epf)} · EPS {inr(er.eps)} · EDLI {inr(er.edli)} · admin {inr(er.admin)} · ESI {inr(er.esi)} · cost to company this month{' '}
          <span className="num font-semibold text-ink">{inr(p.employer_cost)}</span>
        </p>
        {p.remarks && (
          <p>
            <span className="font-semibold text-ink">Remarks:</span> {p.remarks}
          </p>
        )}
      </div>
      <p className="border-t border-line pt-3 text-center text-[11.5px] italic text-ink-faint">This is a computer-generated payslip and does not require a signature.</p>
    </div>
  )
}

export function DownloadPayslipButton({ data, size = 'md', variant = 'primary', label = 'Download PDF' }: { data: PayslipPdfData; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary'; label?: string }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await downloadPayslip(data)
      audit('export', 'payslips', data.slip.id, `Downloaded payslip — ${data.employee.name} · ${fmtMonth(data.slip.month)}`)
    } catch (e) {
      toast.error('Could not create the PDF', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size={size} variant={variant} loading={busy} icon={<Download className="h-4 w-4" />} onClick={go}>
      {label}
    </Button>
  )
}

/** Payslip preview dialog with Download PDF (+ optional extra footer actions). */
export function PayslipModal({ slip, onClose, actions, banner }: { slip: Payslip | null; onClose: () => void; actions?: ReactNode; banner?: ReactNode }) {
  const toData = usePayslipData()
  const shown = useSticky(slip)
  const data = shown ? toData(shown) : null
  return (
    <Modal
      open={!!slip}
      onClose={onClose}
      size="lg"
      title={data ? `${data.employee.name} · ${fmtMonth(data.slip.month)}` : 'Payslip'}
      subtitle={data ? `${data.employee.code} · ${data.employee.designation}` : undefined}
      footer={
        data && (
          <div className={cn('flex w-full flex-wrap items-center gap-2', actions ? 'justify-between' : 'justify-end')}>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <DownloadPayslipButton data={data} />
            </div>
          </div>
        )
      }
    >
      {banner}
      {data && <PayslipView data={data} />}
    </Modal>
  )
}
