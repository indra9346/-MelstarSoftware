import { generateSeed } from '../src/data/seed/index'
const t0 = Date.now()
const { tables } = await generateSeed(new Date())
console.log('generated in', Date.now() - t0, 'ms')
let bytes = 0
for (const [k, v] of Object.entries(tables)) { const n = JSON.stringify(v).length; bytes += n; console.log(k.padEnd(24), String(v!.length).padStart(6), (n / 1024).toFixed(0) + ' KB') }
console.log('total', (bytes / 1024 / 1024).toFixed(2), 'MB')
const runs = tables.payroll_runs as any[]
for (const r of runs) console.log(r.month, r.employee_count, r.total_gross, r.total_net)
const slips = (tables.payslips as any[]).filter((p) => p.month === runs[runs.length - 1].month).slice(0, 6)
for (const p of slips) console.log(p.paid_days, p.lop_days, p.gross_earnings, p.pf_employee, p.esi_employee, p.professional_tax, p.tds, p.net_pay, p.ot_hours)
