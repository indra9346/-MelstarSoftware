/**
 * Purchase-order PDF (A4 portrait): brand header, buyer and vendor blocks, GST lines,
 * rate-wise tax summary, totals, amount in words, terms and signatory.
 * jsPDF + autotable are lazy-loaded so they stay out of the main bundle.
 */
import { db } from '@/data/store'
import type { PurchaseOrder } from '@/data/types'
import { computeTotals, lineTax } from '@/services/purchase'
import { pdfFooter, pdfHeader } from './export'
import { fmtDate } from './dates'
import { amountInWords } from './format'

// jsPDF's built-in fonts have no ₹ glyph, so amounts are plain Indian-format numbers under "INR".
const money = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const qtyFmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n)

const INK: [number, number, number] = [23, 32, 51]
const SOFT: [number, number, number] = [74, 84, 104]
const LINE: [number, number, number] = [225, 228, 233]

export async function downloadPoPdf(po: PurchaseOrder) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 40
  const settings = db.settings()
  const vendor = db.get('vendors', po.vendor_id)
  const lines = db.where('purchase_order_lines', (l) => l.po_id === po.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const totals = computeTotals(lines, po.intra_state)
  const lastY = (fallback: number) => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback

  const status = po.status === 'draft' ? 'DRAFT — NOT APPROVED' : po.status === 'cancelled' ? 'CANCELLED' : ''
  pdfHeader(doc, 'PURCHASE ORDER', `${po.po_no}  ·  ${fmtDate(po.date)}`)
  if (status) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(225, 29, 72)
    doc.text(status, W - M, 72, { align: 'right' })
  }

  /* ── buyer / vendor blocks ── */
  const colW = (W - M * 2 - 16) / 2
  const block = (x: number, y: number, heading: string, title: string, rows: string[]) => {
    doc.setFillColor(246, 247, 249)
    doc.setDrawColor(...LINE)
    const wrapped = rows.filter(Boolean).flatMap((r) => doc.splitTextToSize(r, colW - 20) as string[])
    const h = 40 + wrapped.length * 11
    doc.roundedRect(x, y, colW, h, 3, 3, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(42, 86, 161)
    doc.text(heading.toUpperCase(), x + 10, y + 14)
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(title, colW - 20)[0] as string, x + 10, y + 28)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...SOFT)
    wrapped.forEach((r, i) => doc.text(r, x + 10, y + 41 + i * 11))
    return h
  }
  let y = 108
  const hb = block(M, y, 'Buyer / ship to', settings.legal_name, [
    settings.plant_address,
    settings.gstin ? `GSTIN: ${settings.gstin}` : '',
    settings.pan ? `PAN: ${settings.pan}` : '',
    [settings.phone, settings.email].filter(Boolean).join('  ·  '),
  ])
  const hv = block(M + colW + 16, y, 'Vendor', vendor ? `${vendor.name} (${vendor.code})` : 'Vendor', vendor
    ? [
        [vendor.address, vendor.city].filter(Boolean).join(', ') + (vendor.state ? `, ${vendor.state}` : ''),
        vendor.gstin ? `GSTIN: ${vendor.gstin}` : 'GSTIN: not registered',
        vendor.contact_person ? `Attn: ${vendor.contact_person}` : '',
        [vendor.phone, vendor.email].filter(Boolean).join('  ·  '),
      ]
    : [])
  y += Math.max(hb, hv) + 12

  /* ── PO facts ── */
  const facts: [string, string][] = [
    ['PO number', po.po_no],
    ['PO date', fmtDate(po.date)],
    ['Delivery by', po.expected_date ? fmtDate(po.expected_date) : 'As agreed'],
    ['Payment terms', vendor ? (vendor.payment_terms_days ? `${vendor.payment_terms_days} days` : 'Advance / on delivery') : '—'],
    ['Tax', po.intra_state ? 'CGST + SGST (intra-state)' : 'IGST (inter-state)'],
  ]
  const fw = (W - M * 2) / facts.length
  facts.forEach(([k, v], i) => {
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...SOFT)
    doc.text(k.toUpperCase(), M + i * fw, y + 8)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(v, fw - 6)[0] as string, M + i * fw, y + 21)
  })
  y += 34

  /* ── lines ── */
  const taxHead = po.intra_state ? ['CGST', 'SGST'] : ['IGST']
  autoTable(doc, {
    startY: y,
    head: [['#', 'Description', 'HSN', 'Qty', 'UoM', 'Rate', 'Taxable', 'GST %', ...taxHead, 'Amount']],
    body: lines.map((l, i) => {
      const item = l.item_id ? db.get('inventory_items', l.item_id) : undefined
      const t = lineTax(l, po.intra_state)
      return [
        String(i + 1),
        item ? `${l.description}\n${item.sku}` : l.description,
        item?.hsn || '—',
        qtyFmt(l.qty),
        l.uom,
        money(l.rate),
        money(t.taxable),
        `${l.gst_rate}%`,
        ...(po.intra_state ? [money(t.cgst), money(t.sgst)] : [money(t.igst)]),
        money(t.taxable + t.tax),
      ]
    }),
    styles: { fontSize: 7.8, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5, valign: 'middle' },
    headStyles: { fillColor: [42, 86, 161], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [246, 247, 249] },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'center' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
    },
    margin: { left: M, right: M, bottom: 56, top: 40 },
    didDrawPage: () => pdfFooter(doc),
  })
  y = lastY(y) + 14

  /* ── tax summary + totals ── */
  const needPage = (h: number) => {
    if (y + h > H - 60) {
      doc.addPage()
      pdfFooter(doc)
      y = 50
    }
  }
  needPage(120)
  const sumW = (W - M * 2) * 0.56
  autoTable(doc, {
    startY: y,
    tableWidth: sumW,
    head: [['GST %', 'Taxable', ...(po.intra_state ? ['CGST', 'SGST'] : ['IGST']), 'Tax']],
    body: totals.byRate.map((r) => [`${r.rate}%`, money(r.taxable), ...(po.intra_state ? [money(r.cgst), money(r.sgst)] : [money(r.igst)]), money(r.cgst + r.sgst + r.igst)]),
    styles: { fontSize: 7.8, cellPadding: 3.5, textColor: INK, lineColor: LINE, lineWidth: 0.5, halign: 'right' },
    headStyles: { fillColor: [239, 244, 251], textColor: INK, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'center' } },
    margin: { left: M, right: M, bottom: 56 },
    didDrawPage: () => pdfFooter(doc),
  })
  const summaryEnd = lastY(y)

  const tx = M + sumW + 16
  const tw = W - M - tx
  const rows: [string, string, boolean?][] = [
    ['Sub-total', money(totals.subtotal)],
    ...(po.intra_state
      ? ([['CGST', money(totals.cgst)], ['SGST', money(totals.sgst)]] as [string, string][])
      : ([['IGST', money(totals.igst)]] as [string, string][])),
    ['Grand total (INR)', money(totals.total), true],
  ]
  let ty = y + 4
  for (const [k, v, strong] of rows) {
    if (strong) {
      doc.setFillColor(42, 86, 161)
      doc.roundedRect(tx, ty - 2, tw, 22, 2, 2, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.text(k, tx + 8, ty + 12)
      doc.text(v, tx + tw - 8, ty + 12, { align: 'right' })
      ty += 26
    } else {
      doc.setTextColor(...SOFT)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(k, tx + 8, ty + 10)
      doc.setTextColor(...INK)
      doc.text(v, tx + tw - 8, ty + 10, { align: 'right' })
      doc.setDrawColor(...LINE)
      doc.line(tx, ty + 15, tx + tw, ty + 15)
      ty += 18
    }
  }
  y = Math.max(summaryEnd, ty) + 14

  needPage(40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text('Amount in words:', M, y)
  doc.setFont('helvetica', 'normal')
  const words = doc.splitTextToSize(amountInWords(totals.total), W - M * 2 - 84) as string[]
  doc.text(words, M + 84, y)
  y += words.length * 11 + 12

  /* ── terms ── */
  const terms = [
    `Delivery: ${po.expected_date ? `on or before ${fmtDate(po.expected_date)}` : 'as agreed'} at our plant — ${settings.plant_address}.`,
    `Payment: ${vendor?.payment_terms_days ? `${vendor.payment_terms_days} days from receipt of goods and a valid GST invoice` : 'as agreed'}.`,
    `Quote PO number ${po.po_no} on the invoice, delivery challan and all correspondence.`,
    'Material must conform to the agreed specification; test / calibration certificates to accompany the supply where applicable.',
    'Goods are subject to our incoming inspection; rejected material will be returned at the supplier’s cost.',
    ...(po.notes.trim() ? [`Notes: ${po.notes.trim().replace(/\n+/g, ' · ')}`] : []),
  ]
  const termLines = terms.flatMap((t, i) => doc.splitTextToSize(`${i + 1}. ${t}`, W - M * 2) as string[])
  needPage(24 + termLines.length * 10.5 + 70)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text('Terms & conditions', M, y)
  y += 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(...SOFT)
  doc.text(termLines, M, y)
  y += termLines.length * 10.5 + 26

  /* ── signatory ── */
  const approver = po.approved_by ? db.get('app_users', po.approved_by)?.display_name : null
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(`For ${settings.legal_name}`, W - M, y, { align: 'right' })
  doc.setDrawColor(...LINE)
  doc.line(W - M - 170, y + 34, W - M, y + 34)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...SOFT)
  doc.text(approver ? `Authorised signatory · ${approver}` : 'Authorised signatory', W - M, y + 46, { align: 'right' })
  doc.text('This is a computer-generated purchase order.', M, y + 46)

  // every page already carries the footer (autotable pages via didDrawPage, added pages via needPage)
  doc.save(`${po.po_no.replace(/\//g, '-')}.pdf`)
}
