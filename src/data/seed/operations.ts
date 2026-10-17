/** Demo data for machines, maintenance, inventory, tool crib, assets, purchase, production and quality. */
import type { AppUser, Employee, InventoryItem, Machine, Row, WorkCentre } from '../types'
import { addDays, combine, dayOfWeek, eachDay, fyLabel } from '@/lib/dates'
import { seededRandom } from '@/lib/ids'
import type { SeedBuilder } from './index'

const at = (date: string, time = '10:00') => combine(date, time).toISOString()

export function seedOperations(
  b: SeedBuilder,
  o: { byCode: Record<string, Employee>; today: string; admin: AppUser; wcs: Record<string, WorkCentre>; fy: number },
) {
  const r = seededRandom(5150)
  const E = (c: string) => o.byCode[c]!.id
  const d = (n: number) => addDays(o.today, n)
  const lbl = fyLabel(o.fy)

  /* ── vendors & customers (fictional demo businesses) ── */
  const vendorSpec: [string, string, string, string, string, number, number][] = [
    ['V001', 'Sri Lakshmi Steels', 'Steel & raw material', 'Peenya Industrial Area, Bengaluru', 'Bengaluru', 30, 4],
    ['V002', 'Precision Tooling Solutions', 'Cutting tools', 'KIADB Bommasandra, Bengaluru', 'Bengaluru', 30, 5],
    ['V003', 'Vinayaka Industrial Supplies', 'Consumables', 'Main Road, Doddaballapura', 'Doddaballapura', 15, 4],
    ['V004', 'Karnataka Industrial Gases', 'Gases & welding', 'Nelamangala Industrial Area', 'Nelamangala', 15, 4],
    ['V005', 'Shree Balaji Hydraulics & Spares', 'Machine spares', 'Rajajinagar Industrial Estate, Bengaluru', 'Bengaluru', 30, 3],
    ['V006', 'Metrocal Calibration Lab', 'Services', 'Peenya 2nd Stage, Bengaluru', 'Bengaluru', 30, 5],
    ['V007', 'Doddaballapura Packaging Works', 'Packing material', 'Apparel Park Road, Doddaballapura', 'Doddaballapura', 15, 4],
    ['V008', 'Hosur Alloy Castings', 'Castings & forgings', 'SIPCOT Phase II, Hosur', 'Hosur', 45, 3],
  ]
  const vendors = Object.fromEntries(
    vendorSpec.map(([code, name, category, address, city, terms, rating], i) => [
      code,
      b.add('vendors', {
        code, name, category, contact_person: ['Ramesh', 'Sunil', 'Vinay', 'Prakash', 'Mahadev', 'Shreyas', 'Nagesh', 'Karthik'][i]!, phone: `+91 98${r.int(100, 999)} ${r.int(10000, 99999)}`,
        email: `sales@${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16)}.example.in`, gstin: `${city === 'Hosur' ? '33' : '29'}AA${String.fromCharCode(65 + i)}FS${r.int(1000, 9999)}${String.fromCharCode(70 + i)}1Z${r.int(1, 9)}`,
        address, city, state: city === 'Hosur' ? 'Tamil Nadu' : 'Karnataka', payment_terms_days: terms, rating, active: true, notes: 'Demo vendor',
      }, at('2024-04-01')),
    ]),
  )
  const custSpec: [string, string, string, string, string, number, number][] = [
    ['C001', 'Vajra Hydraulics Pvt Ltd', 'Hydraulic cylinders', 'Bommasandra Industrial Area', 'Bengaluru', 45, 2500000],
    ['C002', 'Tunga Conveyor Systems', 'Conveyor rollers & idlers', 'Ballari Road', 'Ballari', 30, 1200000],
    ['C003', 'Karavali Pumpworks', 'Pumps & valves', 'Baikampady Industrial Area', 'Mangaluru', 45, 1500000],
    ['C004', 'Sahyadri Earthmoving Equipment', 'Construction equipment', 'Belur Industrial Area', 'Dharwad', 60, 3000000],
    ['C005', 'Kaveri Automation Systems', 'Special-purpose machines', 'Hebbal Industrial Area', 'Mysuru', 30, 1000000],
    ['C006', 'Hosur Gearcraft', 'Gearboxes', 'SIPCOT Phase I', 'Hosur', 45, 1800000],
    ['C007', 'Nandi Agri Machines', 'Farm equipment', 'KIADB Gauribidanur', 'Gauribidanur', 30, 800000],
  ]
  const customers = Object.fromEntries(
    custSpec.map(([code, name, note, address, city, terms, limit], i) => [
      code,
      b.add('customers', {
        code, name, contact_person: ['Mr. Anil Shetty (SQA)', 'Ms. Rekha (Purchase)', 'Mr. Dinesh Pai', 'Mr. Vivek Desai', 'Ms. Nandini', 'Mr. Senthil', 'Mr. Basavaraj'][i]!,
        phone: `+91 97${r.int(100, 999)} ${r.int(10000, 99999)}`, email: `purchase@${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.example.in`,
        gstin: `${city === 'Hosur' ? '33' : '29'}AB${String.fromCharCode(66 + i)}CK${r.int(1000, 9999)}${String.fromCharCode(72 + i)}1Z${r.int(1, 9)}`,
        address: `${address}, ${city}`, city, state: city === 'Hosur' ? 'Tamil Nadu' : 'Karnataka', payment_terms_days: terms, credit_limit: limit, active: true, notes: `${note} · demo customer`,
      }, at('2023-06-01')),
    ]),
  )

  /* ── inventory ── */
  const itemSpec: [string, string, InventoryItem['category'], string, number, number, number, string, string, string][] = [
    ['RM-EN8-40', 'EN8 round bar Ø40 mm', 'raw_material', 'kg', 640, 400, 78, 'Bar rack A1', '72142090', 'V001'],
    ['RM-EN8-60', 'EN8 round bar Ø60 mm', 'raw_material', 'kg', 910, 500, 78, 'Bar rack A2', '72142090', 'V001'],
    ['RM-EN19-50', 'EN19 round bar Ø50 mm', 'raw_material', 'kg', 220, 300, 112, 'Bar rack A3', '72284000', 'V001'],
    ['RM-SS304-25', 'SS304 round bar Ø25 mm', 'raw_material', 'kg', 140, 100, 265, 'Bar rack B1', '72222011', 'V001'],
    ['RM-MS-SH3', 'MS sheet 3 mm (2500×1250)', 'raw_material', 'sheet', 34, 20, 4650, 'Sheet stack C1', '72085190', 'V001'],
    ['RM-MS-PL10', 'MS plate 10 mm', 'raw_material', 'kg', 1180, 800, 68, 'Plate yard', '72085120', 'V001'],
    ['RM-AL6061', 'Aluminium 6061 block 100×100', 'raw_material', 'kg', 86, 60, 340, 'Rack B2', '76042990', 'V001'],
    ['RM-CI-HSG', 'Pump housing casting (CI FG260)', 'raw_material', 'nos', 160, 120, 1450, 'Casting yard', '73259999', 'V008'],
    ['TL-CNMG-120408', 'Insert CNMG 120408 (P25)', 'tooling', 'nos', 34, 50, 395, 'Tool crib T1', '82090090', 'V002'],
    ['TL-DNMG-150608', 'Insert DNMG 150608', 'tooling', 'nos', 62, 40, 430, 'Tool crib T1', '82090090', 'V002'],
    ['TL-TNMG-160404', 'Insert TNMG 160404', 'tooling', 'nos', 48, 30, 360, 'Tool crib T1', '82090090', 'V002'],
    ['TL-APKT-1604', 'Face-mill insert APKT 1604', 'tooling', 'nos', 18, 30, 520, 'Tool crib T2', '82090090', 'V002'],
    ['TL-EM-10', 'Carbide end mill Ø10 4F', 'tooling', 'nos', 9, 6, 2150, 'Tool crib T2', '82077010', 'V002'],
    ['TL-EM-16', 'Carbide end mill Ø16 4F', 'tooling', 'nos', 5, 4, 3600, 'Tool crib T2', '82077010', 'V002'],
    ['TL-DR-8.5', 'Drill Ø8.5 HSS-Co', 'tooling', 'nos', 22, 15, 340, 'Tool crib T3', '82075000', 'V002'],
    ['TL-TAP-M10', 'Machine tap M10×1.5', 'tooling', 'nos', 7, 10, 620, 'Tool crib T3', '82074010', 'V002'],
    ['CN-MIG-ER70', 'MIG wire ER70S-6 1.2 mm', 'consumable', 'kg', 75, 60, 145, 'Welding store', '83112000', 'V004'],
    ['CN-ARGON', 'Argon cylinder (7 m³)', 'consumable', 'nos', 3, 4, 2100, 'Gas bank', '28042100', 'V004'],
    ['CN-COOLANT', 'Water-soluble coolant', 'consumable', 'ltr', 160, 100, 210, 'Oil store', '34031900', 'V003'],
    ['CN-HYD68', 'Hydraulic oil ISO VG 68', 'consumable', 'ltr', 140, 80, 165, 'Oil store', '27101980', 'V003'],
    ['CN-DISC4', 'Grinding disc 4"', 'consumable', 'nos', 110, 80, 38, 'Consumables rack', '68042210', 'V003'],
    ['CN-COTTON', 'Cotton waste', 'consumable', 'kg', 26, 30, 95, 'Consumables rack', '52029900', 'V003'],
    ['SP-VBELT-B52', 'V-belt B-52', 'spare', 'nos', 6, 4, 420, 'Spares rack S1', '40103290', 'V005'],
    ['SP-BRG-7014', 'Spindle bearing 7014 (pair)', 'spare', 'nos', 1, 2, 18500, 'Spares rack S1', '84822090', 'V005'],
    ['SP-PROX-M18', 'Proximity sensor M18 PNP', 'spare', 'nos', 4, 3, 1350, 'Spares rack S2', '85365090', 'V005'],
    ['SP-SEAL-KIT', 'Hydraulic cylinder seal kit (press brake)', 'spare', 'nos', 2, 1, 6400, 'Spares rack S2', '40169320', 'V005'],
    ['SP-DRAWBAR', 'Drawbar disc-spring kit (BT40)', 'spare', 'nos', 0, 1, 14800, 'Spares rack S2', '84669390', 'V005'],
    ['PK-PALLET', 'Wooden pallet 1200×1000', 'packing', 'nos', 28, 20, 650, 'Dispatch bay', '44152000', 'V007'],
    ['PK-VCI', 'VCI poly bag 18×24', 'packing', 'nos', 420, 300, 9, 'Dispatch bay', '39232100', 'V007'],
    ['FG-ENDCAP-80', 'End cap Ø80 — machined (Vajra)', 'finished_good', 'nos', 140, 0, 685, 'FG store', '84129090', ''],
    ['FG-IDLER-40', 'Idler shaft Ø40 — machined (Tunga)', 'finished_good', 'nos', 260, 0, 310, 'FG store', '84313910', ''],
  ]
  const items: Record<string, InventoryItem> = {}
  for (const [sku, name, category, uom, qty, reorder, cost, loc, hsn, vend] of itemSpec) {
    items[sku] = b.add('inventory_items', { sku, name, category, uom, stock_qty: qty, reorder_level: reorder, unit_cost: cost, location: loc, hsn, preferred_vendor_id: vend ? vendors[vend]!.id : null, active: true }, at('2024-04-01'))
  }
  // movement history: work backwards from today's stock so balances reconcile exactly
  const fyStart = `${o.fy}-04-01`
  for (const it of Object.values(items)) {
    const events: { date: string; type: 'in' | 'out'; qty: number; ref: string; reason: string }[] = []
    const n = it.category === 'finished_good' ? 6 : r.int(3, 8)
    const workdays = eachDay(fyStart, addDays(o.today, -1)).filter((x) => dayOfWeek(x) !== 0)
    for (let k = 0; k < n; k++) {
      const isIn = r.chance(0.35)
      const step = Math.max(1, Math.round((it.reorder_level || 40) * (isIn ? r.int(80, 150) / 100 : r.int(10, 40) / 100)))
      events.push({
        date: workdays[r.int(0, workdays.length - 1)]!, type: isIn ? 'in' : 'out', qty: step,
        ref: isIn ? (it.category === 'finished_good' ? `WO-${r.int(1030, 1045)}` : `PO/${lbl}/00${r.int(10, 30)}`) : it.category === 'finished_good' ? `DC/${lbl}/0${r.int(100, 180)}` : `WO-${r.int(1030, 1048)}`,
        reason: isIn ? (it.category === 'finished_good' ? 'Production receipt' : 'Goods receipt') : it.category === 'finished_good' ? 'Dispatched to customer' : r.pick(['Issued to production', 'Issued to maintenance', 'Issued to tool crib']),
      })
    }
    // receipts before issues on the same day; opening stock large enough that no issue ever
    // draws from an empty bin, so every balance_after in the ledger reconciles exactly
    events.sort((a, c) => a.date.localeCompare(c.date) || (a.type === c.type ? 0 : a.type === 'in' ? -1 : 1))
    const net = events.reduce((s, e) => s + (e.type === 'in' ? e.qty : -e.qty), 0)
    let run = 0
    let lowest = 0
    for (const e of events) {
      run += e.type === 'in' ? e.qty : -e.qty
      lowest = Math.min(lowest, run)
    }
    let bal = Math.max(it.stock_qty - net, -lowest)
    b.add('stock_movements', { item_id: it.id, date: fyStart, type: 'adjust', qty: bal, balance_after: bal, reference: 'OPENING', reason: `Opening stock FY ${lbl}`, by_user_id: o.admin.id }, at(fyStart, '09:00'))
    for (const e of events) {
      bal = e.type === 'in' ? bal + e.qty : bal - e.qty
      b.add('stock_movements', { item_id: it.id, date: e.date, type: e.type, qty: e.qty, balance_after: bal, reference: e.ref, reason: e.reason, by_user_id: o.admin.id }, at(e.date, e.type === 'in' ? '10:30' : '15:00'))
    }
    if (bal !== it.stock_qty) Object.assign(it, { stock_qty: bal })
  }

  /* ── purchase orders ── */
  const poSpec: [string, number, Row<'purchase_orders'>['status'], [string, number][], string][] = [
    ['V001', -150, 'received', [['RM-EN8-40', 500], ['RM-EN8-60', 600]], 'Monthly bar stock'],
    ['V002', -128, 'received', [['TL-CNMG-120408', 60], ['TL-DNMG-150608', 40], ['TL-EM-10', 6]], ''],
    ['V004', -96, 'received', [['CN-MIG-ER70', 90], ['CN-ARGON', 4]], ''],
    ['V008', -70, 'received', [['RM-CI-HSG', 200]], 'Karavali impeller housing castings'],
    ['V005', -45, 'received', [['SP-VBELT-B52', 6], ['SP-PROX-M18', 4]], ''],
    ['V001', -30, 'partial', [['RM-MS-PL10', 1000], ['RM-MS-SH3', 30], ['RM-EN19-50', 300]], 'Plate received; EN19 pending'],
    ['V006', -12, 'sent', [['', 1]], 'Annual calibration — micrometers, bore gauge, height gauge'],
    ['V002', -1, 'approved', [['TL-CNMG-120408', 100], ['TL-APKT-1604', 40], ['TL-TAP-M10', 12]], 'Urgent — CNMG below reorder'],
    ['V005', 0, 'draft', [['SP-DRAWBAR', 1], ['SP-BRG-7014', 1]], 'VMC-02 breakdown spares'],
    ['V003', -20, 'received', [['CN-COOLANT', 200], ['CN-COTTON', 40], ['CN-DISC4', 100]], ''],
  ]
  let poNo = 0
  const pos: Row<'purchase_orders'>[] = []
  for (const [vend, ago, status, lines, notes] of poSpec) {
    const date = d(ago)
    const v = vendors[vend]!
    const intra = v.state === 'Karnataka'
    const po = b.add('purchase_orders', {
      po_no: `PO/${lbl}/${String(++poNo).padStart(4, '0')}`, vendor_id: v.id, date, expected_date: addDays(date, 10), status, subtotal: 0, tax_total: 0, total: 0, intra_state: intra,
      notes, created_by: o.admin.id, approved_by: status === 'draft' ? null : o.admin.id, approved_at: status === 'draft' ? null : at(date, '16:00'),
    }, at(date, '11:00'))
    let sub = 0
    let tax = 0
    for (const [sku, qty] of lines) {
      const it = sku ? items[sku]! : null
      const rate = it ? it.unit_cost : 14500
      const gst = 18
      const received = status === 'received' ? qty : status === 'partial' ? (sku === 'RM-EN19-50' ? 0 : qty) : 0
      b.add('purchase_order_lines', { po_id: po.id, item_id: it?.id ?? null, description: it ? it.name : 'Calibration service (NABL) — 8 instruments', qty, uom: it?.uom ?? 'job', rate, gst_rate: gst, received_qty: received }, po.created_at)
      sub += qty * rate
      tax += (qty * rate * gst) / 100
    }
    Object.assign(po, { subtotal: Math.round(sub * 100) / 100, tax_total: Math.round(tax * 100) / 100, total: Math.round((sub + tax) * 100) / 100 })
    pos.push(po)
  }

  /* ── work orders ── */
  const W = (c: string) => o.wcs[c]!.id
  const woSpec: [string, string, string, string, string, string, number, number, number, number, string[], number, number, Row<'work_orders'>['status'], Row<'work_orders'>['priority']][] = [
    ['C001', 'VH/PO/26-0912', 'VH-EC-080', 'Hydraulic cylinder end cap Ø80', 'C', 'EN8', 600, 140, 2, 685, ['CNC', 'VMC', 'QAI'], -18, 8, 'in_progress', 'high'],
    ['C002', 'TCS/4471', 'TC-IS-040', 'Conveyor idler shaft Ø40 × 620', 'B', 'EN8', 400, 0, 0, 310, ['CNC', 'QAI'], -3, 14, 'in_progress', 'high'],
    ['C003', 'KP/PO/1189', 'KP-IH-150', 'Pump impeller housing (machined casting)', 'A', 'CI FG260', 200, 60, 3, 2150, ['VMC', 'QAI'], -25, 10, 'in_progress', 'medium'],
    ['C004', 'SEE/26/0381', 'SE-BF-1200', 'Fabricated base frame 1200×800', 'D', 'MS IS2062', 24, 24, 0, 18400, ['PRB', 'WLD', 'QAI'], -40, -6, 'completed', 'medium'],
    ['C005', 'KAS/PO/772', 'KA-VB-016', 'Valve block sub-assembly', 'C', 'Al 6061', 50, 50, 1, 5600, ['VMC', 'SAL', 'QAI'], -35, -10, 'dispatched', 'high'],
    ['C006', 'HG/26/2290', 'HG-MB-210', 'Gearbox mounting bracket', 'B', 'MS 10 mm', 300, 0, 0, 940, ['PRB', 'WLD', 'VMC', 'QAI'], 4, 25, 'planned', 'medium'],
    ['C007', 'NAM/115', 'NA-PN-030', 'Hitch pin Ø30 (induction hardened)', 'A', 'EN19', 1000, 1000, 6, 145, ['CNC', 'QAI'], -60, -28, 'dispatched', 'low'],
    ['C001', 'VH/PO/26-0977', 'VH-RB-050', 'Piston rod end bush', 'A', 'SS304', 300, 0, 0, 520, ['CNC', 'QAI'], 6, 30, 'planned', 'medium'],
    ['C004', 'SEE/26/0402', 'SE-BP-075', 'Bucket pin Ø75', 'B', 'EN19', 120, 40, 0, 1650, ['CNC', 'QAI'], -10, 12, 'on_hold', 'medium'],
    ['C005', 'KAS/PO/801', 'KA-FX-200', 'Fixture plate 400×300 (ground)', 'A', 'MS 25 mm', 10, 10, 0, 7800, ['VMC', 'QAI'], -14, -2, 'qc', 'high'],
  ]
  let woNo = 1040
  const wos: Row<'work_orders'>[] = []
  for (const [cust, poRef, partNo, partName, rev, mat, qty, done, rej, price, route, startIn, dueIn, status, prio] of woSpec) {
    wos.push(b.add('work_orders', {
      wo_no: `WO-${++woNo}`, customer_id: customers[cust]!.id, customer_po_ref: poRef, part_no: partNo, part_name: partName, drawing_rev: rev, material: mat, qty,
      completed_qty: done, rejected_qty: rej, unit_price: price, route_work_centre_ids: route.map(W), start_date: d(startIn), due_date: d(dueIn), status, priority: prio,
      notes: status === 'on_hold' ? 'Awaiting customer drawing revision C' : '',
      completed_on: status === 'completed' || status === 'dispatched' ? d(dueIn - (status === 'dispatched' ? 2 : 2)) : null,
      dispatched_on: status === 'dispatched' ? d(dueIn - 1) : null,
    }, at(d(startIn - 3), '12:00')))
  }

  /* ── machines ── */
  const mSpec: [string, string, string, string, string, Machine['status'], Machine['criticality'], number, string, string][] = [
    ['MC-CNC-01', 'CNC Turning Centre 1', 'ACE Micromatic', 'Jobber XL', 'CNC', 'running', 'A', 18640, '2015-04-20', 'Ø400 swing, 8-station turret, Fanuc 0i-TF'],
    ['MC-CNC-02', 'CNC Turning Centre 2', 'LMW', 'Smarturn', 'CNC', 'running', 'A', 12210, '2018-09-10', 'Ø350 swing, Siemens 828D'],
    ['MC-CNC-03', 'CNC Turning Centre 3', 'ACE Micromatic', 'Jobber', 'CNC', 'maintenance', 'B', 22980, '2012-11-05', 'Ø300 swing, Fanuc 0i-TD'],
    ['MC-VMC-01', 'Vertical Machining Centre 1', 'BFW', 'Gaurav VMC 800', 'VMC', 'running', 'A', 15400, '2016-02-15', '800×500×500, BT40, 24-tool ATC'],
    ['MC-VMC-02', 'Vertical Machining Centre 2', 'BFW', 'Akshay VMC 640', 'VMC', 'breakdown', 'A', 9875, '2020-01-22', '640×400×450, BT40, 4th-axis ready'],
    ['MC-VMC-03', 'Vertical Machining Centre 3', 'ACE Micromatic', 'MCV 450', 'VMC', 'idle', 'B', 7120, '2022-06-30', '450×400×450, BT30, high-speed'],
    ['MC-PRB-01', 'Hydraulic Press Brake', 'Hindustan Hydraulics', 'HPB 80/2500', 'PRB', 'running', 'A', 10450, '2014-08-11', '80 T × 2.5 m, NC back-gauge'],
    ['MC-PRB-02', 'Hydraulic Shearing Machine', 'Hindustan Hydraulics', 'HHS 6×2500', 'PRB', 'idle', 'B', 8800, '2014-08-11', '6 mm × 2.5 m'],
    ['MC-PRB-03', 'Power Press 40 T', 'Bharat Press', 'C-frame 40T', 'PRB', 'running', 'C', 14200, '2013-03-02', 'Mechanical, 40 T'],
    ['MC-WLD-01', 'MIG Welding Station 1', 'ESAB', 'Warrior 400i', 'WLD', 'running', 'B', 6400, '2019-05-14', '400 A, synergic'],
    ['MC-WLD-02', 'TIG Welding Station', 'Ador Welding', 'Champ TIG 400', 'WLD', 'running', 'C', 4100, '2017-07-03', '400 A AC/DC'],
    ['MC-WLD-03', 'Plasma Cutter', 'Hypertherm', 'Powermax 65', 'WLD', 'idle', 'C', 2300, '2021-10-18', '20 mm cut capacity'],
    ['MC-SAL-01', 'Pneumatic Press 5 T', 'Pneumech', 'PP-5T', 'SAL', 'running', 'B', 5300, '2018-03-12', 'Bearing & bush pressing'],
    ['MC-SAL-02', 'DC Torque Station', 'Atlas Copco', 'Tensor STR', 'SAL', 'running', 'B', 3900, '2021-01-08', 'Data-logged tightening, 5–80 Nm'],
    ['MC-SAL-03', 'Leak Test Bench', 'In-house', 'LTB-02', 'SAL', 'running', 'B', 2600, '2020-08-24', 'Air decay, 0–10 bar'],
    ['MC-QAI-01', 'Coordinate Measuring Machine', 'Mitutoyo', 'Crysta-Apex S 574', 'QAI', 'running', 'A', 7800, '2019-11-29', '500×700×400 mm, MCOSMOS'],
    ['MC-QAI-02', 'Surface Roughness Tester', 'Mitutoyo', 'Surftest SJ-210', 'QAI', 'running', 'C', 1600, '2019-11-29', 'Ra / Rz'],
    ['MC-QAI-03', 'Profile Projector', 'Sipcon', 'PP-300', 'QAI', 'idle', 'C', 2900, '2016-04-04', '300 mm screen, 10×/20×/50×'],
  ]
  const machines: Record<string, Machine> = {}
  for (const [code, name, make, model, wc, status, crit, hours, install, specs] of mSpec) {
    machines[code] = b.add('machines', { asset_code: code, name, make, model, serial_no: `${make.slice(0, 3).toUpperCase()}${r.int(10000, 99999)}`, work_centre_id: W(wc), install_date: install, status, criticality: crit, hour_meter: hours, specs, notes: '' }, at(install))
  }

  /* ── maintenance schedules & logs ── */
  const tech: Record<string, string> = { CNC: 'MMS-1025', VMC: 'MMS-1025', PRB: 'MMS-1027', WLD: 'MMS-1026', SAL: 'MMS-1027', QAI: 'MMS-1023' }
  const freqDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 91, half_yearly: 182, yearly: 365 } as const
  let logNo = 0
  const nextLog = () => `MNT-${String(++logNo).padStart(4, '0')}`
  for (const [code, m] of Object.entries(machines)) {
    const wc = code.split('-')[1]!
    const plans: [string, keyof typeof freqDays, string[]][] =
      wc === 'QAI'
        ? [['Monthly accuracy check', 'monthly', ['Clean guideways / stage', 'Check with reference artefact', 'Record temperature & humidity']]]
        : wc === 'WLD'
          ? [['Monthly torch & cable inspection', 'monthly', ['Torch liner and nozzle', 'Earth clamp and cables', 'Gas leak test']]]
          : [
              ['Monthly preventive maintenance', 'monthly', ['Lubrication points', 'Way-cover & wipers', 'Coolant tank cleaning', 'Belt tension', 'Electrical panel cleaning']],
              ['Quarterly geometry & hydraulics check', 'quarterly', ['Spindle run-out', 'Backlash X/Z', 'Hydraulic oil level & filter', 'Chuck/clamp pressure']],
            ]
    for (const [title, freq, checklist] of plans) {
      const period = freqDays[freq]
      const offset = r.int(-6, period - 2) // some overdue, most upcoming
      const next = d(offset)
      const last = addDays(next, -period)
      const sch = b.add('maintenance_schedules', { machine_id: m.id, title, frequency: freq, last_done: last, next_due: next, checklist, assigned_to: E(tech[wc]!), active: true }, at('2026-04-01'))
      // history of completed PMs for this schedule since April
      for (let dd = last; dd >= fyStart; dd = addDays(dd, -period)) {
        const start = at(dd, '08:15')
        const mins = r.int(45, 150)
        b.add('maintenance_logs', {
          log_no: '', machine_id: m.id, type: 'preventive', schedule_id: sch.id, reported_at: start, started_at: start, completed_at: new Date(new Date(start).getTime() + mins * 60000).toISOString(),
          downtime_minutes: mins, problem: title, action_taken: 'Checklist completed — ' + checklist.slice(0, 3).join(', ').toLowerCase(), root_cause: '', technician_id: E(tech[wc]!),
          spares: r.chance(0.3) && wc !== 'QAI' ? [{ item_id: items['CN-HYD68']!.id, qty: r.int(2, 8) }] : [], cost: r.chance(0.3) ? r.int(300, 2500) : 0, status: 'closed',
        }, start)
      }
    }
  }
  // breakdowns
  const bd: [string, number, number, string, string, string, string, [string, number][], number, 'closed' | 'in_progress' | 'open'][] = [
    ['MC-CNC-01', -120, 210, 'Turret not indexing — alarm 1001', 'Replaced turret clamp proximity sensor', 'Sensor damaged by coolant ingress', 'MMS-1026', [['SP-PROX-M18', 1]], 1350, 'closed'],
    ['MC-PRB-01', -88, 480, 'Ram drifting down under load', 'Replaced main cylinder seal kit, bled hydraulics', 'Worn piston seals (6 years)', 'MMS-1025', [['SP-SEAL-KIT', 1], ['CN-HYD68', 20]], 9700, 'closed'],
    ['MC-VMC-01', -64, 95, 'Coolant pump not running', 'Reset overload, cleaned pump inlet strainer', 'Chips blocking inlet', 'MMS-1027', [], 0, 'closed'],
    ['MC-CNC-02', -41, 160, 'Spindle belt slipping — poor finish', 'Replaced V-belts and re-tensioned', 'Belt wear', 'MMS-1027', [['SP-VBELT-B52', 2]], 840, 'closed'],
    ['MC-WLD-01', -19, 60, 'Wire feed erratic', 'Replaced liner and drive rolls', 'Worn liner', 'MMS-1026', [], 1200, 'closed'],
    ['MC-SAL-02', -7, 45, 'Torque controller communication error', 'Re-seated controller cable, updated parameters', 'Loose connector', 'MMS-1026', [], 0, 'closed'],
  ]
  for (const [code, ago, mins, problem, action, cause, techCode, spares, cost, status] of bd) {
    const rep = at(d(ago), '10:40')
    b.add('maintenance_logs', {
      log_no: '', machine_id: machines[code]!.id, type: 'breakdown', schedule_id: null, reported_at: rep, started_at: rep,
      completed_at: new Date(new Date(rep).getTime() + mins * 60000).toISOString(), downtime_minutes: mins, problem, action_taken: action, root_cause: cause,
      technician_id: E(techCode), spares: spares.map(([sku, qty]) => ({ item_id: items[sku]!.id, qty })), cost, status,
    }, rep)
  }
  // currently open: VMC-02 breakdown (yesterday), CNC-03 PM in progress (today)
  const vmcRep = at(d(-1), '14:25')
  b.add('maintenance_logs', { log_no: '', machine_id: machines['MC-VMC-02']!.id, type: 'breakdown', schedule_id: null, reported_at: vmcRep, started_at: at(d(-1), '14:50'), completed_at: null, downtime_minutes: 0, problem: 'Tool unclamp alarm — spindle drawbar not releasing tool', action_taken: 'Air pressure verified at 6 bar; disc springs suspected. Spare kit requested (draft PO).', root_cause: '', technician_id: E('MMS-1025'), spares: [], cost: 0, status: 'in_progress' }, vmcRep)
  b.add('maintenance_logs', { log_no: '', machine_id: machines['MC-CNC-03']!.id, type: 'preventive', schedule_id: null, reported_at: at(o.today, '08:10'), started_at: at(o.today, '08:20'), completed_at: null, downtime_minutes: 0, problem: 'Annual overhaul — headstock bearing noise check', action_taken: 'Headstock cover opened; bearing pre-load being checked.', root_cause: '', technician_id: E('MMS-1025'), spares: [], cost: 0, status: 'in_progress' }, at(o.today, '08:10'))
  // number the logs chronologically
  const logs = b.all('maintenance_logs').sort((a, c) => a.reported_at.localeCompare(c.reported_at))
  for (const l of logs) Object.assign(l, { log_no: nextLog() })

  /* ── assets & calibration ── */
  const assetSpec: [string, string, Row<'assets'>['category'], string, string, number, string, string | null, boolean, number, number | null][] = [
    ['AS-IT-001', 'CAD workstation', 'it', 'HP Z2 G9', '2023-05-10', 168000, 'Design office', 'MMS-1003', false, 0, null],
    ['AS-IT-002', 'Laptop', 'it', 'Dell Latitude 5440', '2024-02-02', 78000, 'Accounts', 'MMS-1032', false, 0, null],
    ['AS-IT-003', 'Laptop', 'it', 'Lenovo ThinkPad E14', '2022-08-19', 61000, 'Plant office', 'MMS-1001', false, 0, null],
    ['AS-IT-004', 'Biometric attendance terminal', 'it', 'eSSL X990', '2021-01-15', 14500, 'Main gate', 'MMS-1030', false, 0, null],
    ['AS-GA-001', 'Digital vernier caliper 0–150 mm', 'gauge', 'Mitutoyo 500-196', '2022-04-11', 7800, 'CNC cell', 'MMS-1005', true, 365, -40],
    ['AS-GA-002', 'Outside micrometer 0–25 mm', 'gauge', 'Mitutoyo 293-821', '2021-06-30', 9400, 'QA room', 'MMS-1023', true, 365, 9],
    ['AS-GA-003', 'Outside micrometer 25–50 mm', 'gauge', 'Mitutoyo 293-831', '2021-06-30', 10100, 'QA room', 'MMS-1023', true, 365, 9],
    ['AS-GA-004', 'Bore gauge 50–150 mm', 'gauge', 'Mitutoyo 511-712', '2020-12-14', 21500, 'QA room', 'MMS-1022', true, 365, -3],
    ['AS-GA-005', 'Height gauge 300 mm', 'gauge', 'Mitutoyo 570-302', '2019-11-29', 48500, 'QA room', 'MMS-1024', true, 365, 22],
    ['AS-GA-006', 'Thread plug gauge M10×1.5 6H', 'gauge', 'Kudale', '2024-07-20', 2600, 'VMC cell', 'MMS-1010', true, 180, 51],
    ['AS-GA-007', 'Slip gauge set (87 pcs, Grade 1)', 'gauge', 'Mitutoyo 516-940', '2018-03-01', 62000, 'QA room', 'MMS-1022', true, 730, 140],
    ['AS-IN-001', 'Torque wrench 20–100 Nm', 'instrument', 'Stahlwille 730/10', '2021-09-09', 18200, 'Sub-assembly', 'MMS-1018', true, 365, 74],
    ['AS-IN-002', 'Pressure gauge 0–16 bar (master)', 'instrument', 'Baumer', '2022-01-05', 4800, 'Maintenance', 'MMS-1025', true, 365, -12],
    ['AS-EQ-001', 'Battery forklift 2 T', 'vehicle', 'Godrej GX 200E', '2020-07-17', 1150000, 'Stores', 'MMS-1029', false, 0, null],
    ['AS-EQ-002', 'Screw air compressor 15 HP', 'equipment', 'ELGi EG 11', '2016-05-23', 465000, 'Utility room', 'MMS-1026', false, 0, null],
    ['AS-EQ-003', 'DG set 125 kVA', 'equipment', 'Kirloskar KG1-125', '2014-02-10', 1280000, 'Utility yard', 'MMS-1026', false, 0, null],
    ['AS-VH-001', 'Pickup vehicle', 'vehicle', 'Tata Ace Gold', '2022-11-28', 615000, 'Dispatch', 'MMS-1029', false, 0, null],
  ]
  for (const [code, name, category, make, bought, cost, loc, cust, calib, interval, dueIn] of assetSpec) {
    const due = dueIn == null ? null : d(dueIn)
    b.add('assets', {
      asset_code: code, name, category, make, serial_no: `${code.replace(/-/g, '')}${r.int(100, 999)}`, purchase_date: bought, cost, location: loc, custodian_id: cust ? E(cust) : null,
      calibration_required: calib, calibration_interval_days: interval, last_calibrated: due ? addDays(due, -interval) : null, calibration_due: due,
      certificate_no: calib ? `MCL/${o.fy}/${r.int(1000, 9999)}` : '', status: 'in_use',
    }, at(bought))
  }

  /* ── tool crib issues ── */
  const issues: [string, string, number, number, number | null, Row<'tool_issues'>['status'], Row<'tool_issues'>['condition']][] = [
    ['TL-CNMG-120408', 'MMS-1007', 10, -6, -1, 'returned', 'worn'], ['TL-CNMG-120408', 'MMS-1009', 10, -2, null, 'issued', null],
    ['TL-EM-10', 'MMS-1011', 2, -9, -3, 'returned', 'worn'], ['TL-EM-16', 'MMS-1012', 1, -4, null, 'issued', null],
    ['TL-DR-8.5', 'MMS-1011', 3, -1, null, 'issued', null], ['TL-TAP-M10', 'MMS-1010', 2, -15, -14, 'returned', 'broken'],
    ['TL-DNMG-150608', 'MMS-1005', 10, -3, null, 'issued', null], ['TL-APKT-1604', 'MMS-1012', 10, -20, -12, 'returned', 'worn'],
  ]
  for (const [sku, code, qty, issued, returned, status, cond] of issues) {
    b.add('tool_issues', { item_id: items[sku]!.id, employee_id: E(code), qty, issued_on: d(issued), due_back: d(issued + 7), returned_on: returned == null ? null : d(returned), returned_qty: status === 'returned' ? qty : 0, condition: cond, status, remarks: cond === 'broken' ? 'Tap broke in blind hole — chip packing' : '' }, at(d(issued), '09:30'))
  }

  /* ── quality inspections & NCRs ── */
  let qiNo = 0
  const nextQi = () => `QI-${String(++qiNo).padStart(4, '0')}`
  const inspectors = ['MMS-1023', 'MMS-1024', 'MMS-1022', 'MMS-1036']
  const params = (kind: string, fail: boolean): Row<'inspections'>['parameters'] => {
    const P = (name: string, spec: string, lo: number, hi: number, bad = false) => {
      const mid = (lo + hi) / 2
      const measured = bad ? Math.round((hi + (hi - lo) * 0.4) * 1000) / 1000 : Math.round((mid + (r.next() - 0.5) * (hi - lo) * 0.6) * 1000) / 1000
      return { name, spec, lower: lo, upper: hi, measured, ok: measured >= lo && measured <= hi }
    }
    if (kind === 'bar') return [P('Diameter', 'Ø40 h9', 39.938, 40.0), P('Hardness', '201–255 HB', 201, 255), P('Straightness (mm/m)', '≤ 1.0', 0, 1.0)]
    if (kind === 'cap') return [P('Bore', 'Ø80 H7', 80.0, 80.03, fail), P('OD', 'Ø110 h8', 109.946, 110.0), P('Length', '45 ± 0.05', 44.95, 45.05), P('Surface finish Ra', '≤ 0.8 µm', 0, 0.8)]
    if (kind === 'shaft') return [P('Diameter', 'Ø40 g6', 39.975, 39.991), P('Length', '620 ± 0.2', 619.8, 620.2), P('Run-out', '≤ 0.02', 0, 0.02, fail)]
    if (kind === 'housing') return [P('Bore A', 'Ø62 H7', 62.0, 62.03), P('Bore spacing', '120 ± 0.02', 119.98, 120.02, fail), P('Face flatness', '≤ 0.03', 0, 0.03)]
    return [P('Diagonal difference', '≤ 2 mm', 0, 2), P('Weld size', '6 mm fillet', 5.5, 7), P('Overall length', '1200 ± 1', 1199, 1201)]
  }
  const qi = (type: Row<'inspections'>['type'], ago: number, part: string, kind: string, lot: number, sample: number, fail: boolean, woIdx: number | null, poIdx: number | null) => {
    const ps = params(kind, fail)
    const rejected = fail ? Math.max(1, Math.round(lot * 0.04)) : 0
    return b.add('inspections', {
      insp_no: nextQi(), date: d(ago), type, work_order_id: woIdx == null ? null : wos[woIdx]!.id, po_id: poIdx == null ? null : pos[poIdx]!.id, part_name: part,
      lot_no: `L${d(ago).replace(/-/g, '').slice(2)}-${r.int(10, 99)}`, lot_qty: lot, sample_size: sample, accepted_qty: lot - rejected, rejected_qty: rejected,
      result: fail ? 'fail' : 'pass', inspector_id: E(r.pick(inspectors)), parameters: ps, remarks: fail ? 'Out-of-tolerance found — NCR raised' : 'All parameters within specification',
    }, at(d(ago), '15:30'))
  }
  qi('incoming', -148, 'EN8 round bar Ø40', 'bar', 500, 5, false, null, 0)
  qi('incoming', -68, 'Pump housing casting', 'housing', 200, 8, false, null, 3)
  qi('incoming', -29, 'MS plate 10 mm', 'frame', 1000, 3, false, null, 5)
  qi('final', -55, 'Hitch pin Ø30', 'shaft', 1000, 32, false, 6, null)
  qi('first_article', -24, 'Pump impeller housing', 'housing', 5, 5, false, 2, null)
  const failHousing = qi('in_process', -12, 'Pump impeller housing', 'housing', 40, 8, true, 2, null)
  qi('final', -9, 'Fabricated base frame', 'frame', 24, 24, false, 3, null)
  qi('final', -11, 'Valve block sub-assembly', 'housing', 50, 13, false, 4, null)
  qi('first_article', -16, 'End cap Ø80', 'cap', 5, 5, false, 0, null)
  const failCap = qi('in_process', -4, 'End cap Ø80', 'cap', 60, 8, true, 0, null)
  qi('in_process', -1, 'End cap Ø80', 'cap', 80, 8, false, 0, null)
  qi('first_article', -2, 'Conveyor idler shaft', 'shaft', 5, 5, false, 1, null)
  qi('final', -3, 'Fixture plate 400×300', 'frame', 10, 10, false, 9, null)

  b.add('ncrs', { ncr_no: 'NCR-0001', inspection_id: failHousing.id, date: failHousing.date, description: 'Bore spacing 120 ± 0.02 out of tolerance on 2 of 8 samples (VMC-02).', qty_affected: failHousing.rejected_qty, root_cause: 'Fixture locating pin wear — 0.03 mm play', corrective_action: 'Replaced locating pins; added pin check to daily set-up checklist', disposition: 'rework', owner_id: E('MMS-1010'), status: 'closed', closed_on: addDays(failHousing.date, 3) }, at(failHousing.date, '16:30'))
  b.add('ncrs', { ncr_no: 'NCR-0002', inspection_id: failCap.id, date: failCap.date, description: 'Bore Ø80 H7 oversize by 0.01–0.012 mm on 3 pieces.', qty_affected: failCap.rejected_qty, root_cause: 'Under investigation — suspected boring-bar insert wear', corrective_action: 'Tool-life counter reduced to 40 parts; 100% bore check for this lot', disposition: 'scrap', owner_id: E('MMS-1005'), status: 'open', closed_on: null }, at(failCap.date, '16:45'))
  b.add('ncrs', { ncr_no: 'NCR-0003', inspection_id: null, date: d(-33), description: 'Supplier casting porosity found during machining (5 nos).', qty_affected: 5, root_cause: 'Foundry gating issue at vendor', corrective_action: 'Returned to Hosur Alloy Castings; vendor 8D received', disposition: 'return_to_vendor', owner_id: E('MMS-1028'), status: 'closed', closed_on: d(-20) }, at(d(-33), '12:00'))

}
