/**
 * Payslip PDF (A4 portrait) — one page per employee, same layout as the on-screen payslip
 * (components/payroll/PayslipView). jsPDF is lazy-loaded so it stays out of the main bundle.
 *
 * Standard PDF fonts have no ₹ glyph, so amounts print as "Rs. 12,345".
 */
import type { CompanySettings, Employee, Payslip } from '@/data/types'
import { pdfFooter, pdfHeader } from './export'
import { fmtDate, fmtMonth, monthEnd, monthStart } from './dates'
import { amountInWords, fullName, maskTail } from './format'

type Doc = import('jspdf').jsPDF

export interface PayslipPdfData {
  company: { name: string; address: string; cin: string; pf_code: string; esi_code: string }
  employee: {
    name: string
    code: string
    designation: string
    department: string
    doj: string
    pan: string
    uan: string
    esic: string
    bank: string
    /** Already masked (XXXXXXXX1234). */
    account: string
    ifsc: string
  }
  slip: Payslip
}

export interface PayLine {
  label: string
  amount: number
  note?: string
}

type SettingsLike = Pick<CompanySettings, 'legal_name' | 'registered_office' | 'cin' | 'pf_establishment_code' | 'esi_employer_code'>

/** Everything a payslip shows, from the payslip row, the employee and company settings. */
export function payslipData(slip: Payslip, emp: Employee | undefined, ctx: { designation: string; department: string; settings: SettingsLike }): PayslipPdfData {
  const s = ctx.settings
  return {
    company: { name: s.legal_name, address: s.registered_office, cin: s.cin, pf_code: s.pf_establishment_code, esi_code: s.esi_employer_code },
    employee: {
      name: emp ? fullName(emp) : '—',
      code: emp?.emp_code ?? '—',
      designation: ctx.designation || '—',
      department: ctx.department || '—',
      doj: emp?.date_of_joining ? fmtDate(emp.date_of_joining) : '—',
      pan: emp?.pan || '—',
      uan: emp?.uan || '—',
      esic: emp?.esic_no || '—',
      bank: emp?.bank_name || '—',
      account: emp?.bank_account ? maskTail(emp.bank_account) : '—',
      ifsc: emp?.ifsc || '—',
    },
    slip,
  }
}

const num0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
/** 12,345 (Indian grouping, no symbol). */
export const pdfNum = (n: number) => num0.format(n)
/** Rs. 12,345 */
export const pdfInr = (n: number) => `Rs. ${pdfNum(n)}`

/** Earnings and deductions rows — non-zero only, Basic always. */
export function payslipLines(p: Payslip): { earnings: PayLine[]; deductions: PayLine[] } {
  const earnings: PayLine[] = [
    { label: 'Basic', amount: p.basic },
    { label: 'Dearness allowance', amount: p.da },
    { label: 'House rent allowance', amount: p.hra },
    { label: 'Conveyance', amount: p.conveyance },
    { label: 'Special allowance', amount: p.special_allowance },
    { label: 'Other allowance', amount: p.other_allowance },
    { label: 'Overtime', amount: p.ot_pay, note: p.ot_hours ? `${pdfNum(p.ot_hours)} h` : undefined },
    { label: 'Bonus', amount: p.bonus },
    { label: 'Arrears', amount: p.arrears },
  ].filter((l, i) => i === 0 || l.amount !== 0)
  const deductions: PayLine[] = [
    { label: 'Provident fund (EPF)', amount: p.pf_employee },
    { label: 'ESI', amount: p.esi_employee },
    { label: 'Professional tax', amount: p.professional_tax },
    { label: 'Income tax (TDS)', amount: p.tds },
    { label: 'Salary advance recovery', amount: p.advance_recovery },
    { label: 'Loan recovery', amount: p.loan_recovery },
    { label: 'Other deductions', amount: p.other_deductions },
  ].filter((l) => l.amount !== 0)
  return { earnings, deductions }
}

export function employerContributions(p: Payslip) {
  const pf = p.pf_employer_epf + p.pf_employer_eps + p.pf_edli + p.pf_admin
  return { epf: p.pf_employer_epf, eps: p.pf_employer_eps, edli: p.pf_edli, admin: p.pf_admin, pf, esi: p.esi_employer, total: pf + p.esi_employer }
}

export function payslipFileName(d: PayslipPdfData) {
  return `Payslip_${d.employee.code.replace(/[^\w-]+/g, '')}_${d.slip.month}.pdf`
}

/** Standard PDF fonts are WinAnsi: swap the few characters they cannot draw. */
const pdfText = (s: string) => s.replace(/[—–]/g, '-').replace(/₹\s?/g, 'Rs. ').replace(/[‘’]/g, "'")

const INK: [number, number, number] = [30, 43, 92]
const SOFT: [number, number, number] = [85, 98, 143]
const FAINT: [number, number, number] = [138, 148, 184]
const LINE: [number, number, number] = [226, 232, 248]
const TINT: [number, number, number] = [246, 248, 255]
const INDIGO: [number, number, number] = [99, 102, 241]

/** Draw one payslip on the current page of `doc` (pt units, A4 portrait). */
export function buildPayslipPage(doc: Doc, d: PayslipPdfData) {
  const p = d.slip
  const W = doc.internal.pageSize.getWidth()
  const L = 40
  const R = W - 40
  const CW = R - L
  pdfHeader(doc, 'Payslip', fmtMonth(p.month))

  // employer line (from Settings)
  let y = 110
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...SOFT)
  const employer = pdfText([`Employer: ${d.company.name}`, d.company.address && `Regd. office: ${d.company.address}`].filter(Boolean).join(' · '))
  const empLines = doc.splitTextToSize(employer, CW) as string[]
  doc.text(empLines.slice(0, 2), L, y)
  y += Math.min(2, empLines.length) * 10
  const codes = [d.company.pf_code && `PF code ${d.company.pf_code}`, d.company.esi_code && `ESI code ${d.company.esi_code}`, `Pay period ${fmtDate(monthStart(p.month))} - ${fmtDate(monthEnd(p.month))}`].filter(Boolean).join(' · ')
  doc.text(codes, L, y)
  y += 12

  // employee block
  const left: [string, string][] = [
    ['Employee', d.employee.name],
    ['Employee code', d.employee.code],
    ['Designation', d.employee.designation],
    ['Department', d.employee.department],
    ['Date of joining', d.employee.doj],
    ['PAN', d.employee.pan],
    ['UAN', d.employee.uan],
  ]
  const right: [string, string][] = [
    ['ESIC no.', d.employee.esic],
    ['Bank', d.employee.bank],
    ['Account no.', d.employee.account],
    ['Days in month', pdfNum(p.days_in_month)],
    ['Paid days', pdfNum(p.paid_days)],
    ['LOP days', pdfNum(p.lop_days)],
    ['Tax regime', p.tax_regime === 'old' ? 'Old regime' : 'New regime'],
  ]
  const rowH = 15
  const boxH = left.length * rowH + 14
  doc.setFillColor(...TINT)
  doc.setDrawColor(...LINE)
  doc.roundedRect(L, y, CW, boxH, 8, 8, 'FD')
  const colW = CW / 2
  const drawKv = (items: [string, string][], x: number) => {
    items.forEach(([k, v], i) => {
      const yy = y + 18 + i * rowH
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...SOFT)
      doc.text(k, x, yy)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      const val = (doc.splitTextToSize(pdfText(v) || '-', colW - 112) as string[])[0] ?? '-'
      doc.text(val, x + 92, yy)
    })
  }
  drawKv(left, L + 12)
  drawKv(right, L + colW + 8)
  y += boxH + 16

  // earnings vs deductions
  const { earnings, deductions } = payslipLines(p)
  const gap = 12
  const tW = (CW - gap) / 2
  const lineH = 17
  const rows = Math.max(earnings.length, deductions.length)
  const table = (x: number, title: string, lines: PayLine[], totalLabel: string, total: number) => {
    doc.setFillColor(...INDIGO)
    doc.roundedRect(x, y, tW, lineH + 2, 4, 4, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(255, 255, 255)
    doc.text(title, x + 8, y + 12)
    doc.text('AMOUNT (Rs.)', x + tW - 8, y + 12, { align: 'right' })
    for (let i = 0; i < rows; i++) {
      const yy = y + lineH + 2 + i * lineH
      if (i % 2 === 1) {
        doc.setFillColor(...TINT)
        doc.rect(x, yy, tW, lineH, 'F')
      }
      const l = lines[i]
      if (!l) continue
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK)
      doc.text(l.label, x + 8, yy + 12)
      const labelW = doc.getTextWidth(l.label)
      if (l.note) {
        doc.setFontSize(7.5)
        doc.setTextColor(...FAINT)
        doc.text(l.note, x + 8 + labelW + 5, yy + 12)
        doc.setFontSize(9)
        doc.setTextColor(...INK)
      }
      doc.text(pdfNum(l.amount), x + tW - 8, yy + 12, { align: 'right' })
    }
    const ty = y + lineH + 2 + rows * lineH
    doc.setDrawColor(...LINE)
    doc.line(x, ty, x + tW, ty)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(totalLabel, x + 8, ty + 14)
    doc.text(pdfNum(total), x + tW - 8, ty + 14, { align: 'right' })
    doc.setDrawColor(...LINE)
    doc.roundedRect(x, y, tW, ty + 22 - y, 4, 4, 'S')
  }
  table(L, 'EARNINGS', earnings, 'Gross earnings', p.gross_earnings)
  table(L + tW + gap, 'DEDUCTIONS', deductions.length ? deductions : [], 'Total deductions', p.total_deductions)
  if (!deductions.length) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(...FAINT)
    doc.text('No deductions this month', L + tW + gap + 8, y + lineH + 14)
  }
  y += lineH + 2 + rows * lineH + 22 + 16

  // net pay band
  doc.setFillColor(...INDIGO)
  doc.roundedRect(L, y, CW, 46, 8, 8, 'F')
  doc.setFillColor(6, 182, 212)
  doc.roundedRect(L, y, 6, 46, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('NET PAY', L + 18, y + 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Gross ${pdfInr(p.gross_earnings)}  -  Deductions ${pdfInr(p.total_deductions)}`, L + 18, y + 34)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(pdfInr(p.net_pay), R - 16, y + 29, { align: 'right' })
  y += 46 + 16
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  const words = doc.splitTextToSize(`Net pay in words: ${amountInWords(p.net_pay)}`, CW) as string[]
  doc.text(words, L, y)
  y += words.length * 12 + 8

  // attendance + employer contributions
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...SOFT)
  const att = [
    `Working days ${pdfNum(p.working_days)}`,
    `Present ${pdfNum(p.present_days)}`,
    `Paid leave ${pdfNum(p.paid_leave_days)}`,
    `Holidays ${pdfNum(p.holidays)}`,
    `Week offs ${pdfNum(p.week_offs)}`,
    `Late marks ${pdfNum(p.late_marks)}`,
    `OT ${pdfNum(p.ot_hours)} h`,
  ].join(' · ')
  doc.text(`Attendance: ${att}`, L, y)
  y += 14
  const er = employerContributions(p)
  const erText =
    `Employer contributions (not deducted from pay): EPF ${pdfInr(er.epf)} · EPS ${pdfInr(er.eps)} · EDLI ${pdfInr(er.edli)} · ` +
    `Admin ${pdfInr(er.admin)} · ESI ${pdfInr(er.esi)} · Cost to company this month ${pdfInr(p.employer_cost)}`
  const erLines = doc.splitTextToSize(erText, CW) as string[]
  doc.text(erLines, L, y)
  y += erLines.length * 11 + 4
  if (p.remarks) {
    doc.setTextColor(...INK)
    const rem = doc.splitTextToSize(pdfText(`Remarks: ${p.remarks}`), CW) as string[]
    doc.text(rem.slice(0, 3), L, y)
    y += Math.min(3, rem.length) * 11 + 4
  }

  y += 12
  doc.setDrawColor(...LINE)
  doc.line(L, y, R, y)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...FAINT)
  doc.text('This is a computer-generated payslip and does not require a signature.', W / 2, y + 14, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  pdfFooter(doc)
}

/** A jsPDF document with one page per payslip. */
export async function payslipsDocument(list: PayslipPdfData[]): Promise<Doc> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  list.forEach((d, i) => {
    if (i > 0) doc.addPage()
    buildPayslipPage(doc, d)
  })
  return doc
}

export async function downloadPayslip(d: PayslipPdfData) {
  const doc = await payslipsDocument([d])
  doc.save(payslipFileName(d))
}

export async function downloadPayslips(list: PayslipPdfData[], filename: string) {
  if (!list.length) throw new Error('No payslips to download.')
  const doc = await payslipsDocument(list)
  doc.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}
