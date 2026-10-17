import { COMPANY } from '@/config/company'
import { fmtDateTime } from './dates'
import { downloadBlob } from './misc'

export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
  /** PDF column alignment */
  align?: 'left' | 'right' | 'center'
}

function cell(v: string | number | null | undefined): string {
  if (v == null) return ''
  return String(v)
}

/** The built-in PDF fonts have no ₹ glyph (and no Indic scripts): print "Rs." instead. */
export function pdfText(s: string): string {
  return s.replace(/₹\s?/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '|').replace(/[^\u0000-ÿ]/g, '')
}

/** CSV with a UTF-8 BOM so Excel opens ₹ and Kannada text correctly. */
export function exportCsv<T>(filename: string, rows: T[], columns: ExportColumn<T>[]) {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [columns.map((c) => esc(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => esc(cell(c.value(r)))).join(','))
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename.endsWith('.csv') ? filename : filename + '.csv')
}

/** Branded A4 PDF table (lazy-loads jsPDF so it is not in the main bundle). */
export async function exportPdf<T>(opts: {
  filename: string
  title: string
  subtitle?: string
  rows: T[]
  columns: ExportColumn<T>[]
  landscape?: boolean
  summary?: [string, string][]
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: opts.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  pdfHeader(doc, opts.title, opts.subtitle)
  let y = 108
  if (opts.summary?.length) {
    doc.setFontSize(9)
    opts.summary.forEach(([k, v], i) => {
      const x = 40 + (i % 4) * ((W - 80) / 4)
      const yy = y + Math.floor(i / 4) * 30
      doc.setTextColor(85, 98, 143)
      doc.text(k.toUpperCase(), x, yy)
      doc.setTextColor(30, 43, 92)
      doc.setFont('helvetica', 'bold')
      doc.text(pdfText(v), x, yy + 13)
      doc.setFont('helvetica', 'normal')
    })
    y += Math.ceil(opts.summary.length / 4) * 30 + 6
  }
  autoTable(doc, {
    startY: y,
    head: [opts.columns.map((c) => c.header)],
    body: opts.rows.map((r) => opts.columns.map((c) => pdfText(cell(c.value(r))))),
    styles: { fontSize: 8, cellPadding: 4, textColor: [30, 43, 92], lineColor: [226, 232, 248], lineWidth: 0.5 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 255] },
    columnStyles: Object.fromEntries(opts.columns.map((c, i) => [i, { halign: c.align ?? 'left' }])),
    margin: { left: 40, right: 40, bottom: 50 },
    didDrawPage: () => pdfFooter(doc),
  })
  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : opts.filename + '.pdf')
}

type Doc = import('jspdf').jsPDF

/** Brand header used by every generated PDF. */
export function pdfHeader(doc: Doc, title: string, subtitle?: string) {
  const W = doc.internal.pageSize.getWidth()
  // gradient bar (approximated with 3 bands)
  const bands: [number, number, number][] = [[6, 182, 212], [99, 102, 241], [236, 72, 153]]
  bands.forEach((c, i) => {
    doc.setFillColor(...c)
    doc.rect((W / 3) * i, 0, W / 3 + 1, 6, 'F')
  })
  // hexagon mark
  doc.setFillColor(99, 102, 241)
  const cx = 52, cy = 44, r = 16
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
  })
  doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]), pts[0]![0], pts[0]![1], [1, 1], 'F', true)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('M', cx, cy + 4, { align: 'center' })
  doc.setTextColor(30, 43, 92)
  doc.setFontSize(13)
  doc.text(COMPANY.legal_name, 78, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(85, 98, 143)
  doc.text(`CIN ${COMPANY.cin} · Plant: Plot No. 15, KIADB Obadenahalli, Doddaballapura 562163`, 78, 53)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 43, 92)
  doc.text(pdfText(title), 40, 86)
  doc.setFont('helvetica', 'normal')
  if (subtitle) {
    doc.setFontSize(9)
    doc.setTextColor(85, 98, 143)
    doc.text(pdfText(subtitle), W - 40, 86, { align: 'right' })
  }
  doc.setDrawColor(226, 232, 248)
  doc.line(40, 94, W - 40, 94)
}

export function pdfFooter(doc: Doc) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  doc.setFontSize(7.5)
  doc.setTextColor(138, 148, 184)
  doc.text(`Generated ${fmtDateTime(new Date().toISOString())} · Melstar ERP`, 40, H - 24)
  doc.text('Designed & Developed by Swan Digital Solutions · swandigitalsolutions.com', W - 40, H - 24, { align: 'right' })
}
