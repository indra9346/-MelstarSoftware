/**
 * Demo autopilot — keeps a demo looking alive when nobody uses the biometric terminal.
 *
 * While company_settings.demo_autopilot is on, an admin session fills in simulated biometric
 * punches for past days that have none (and today's arrivals so far), for every employee
 * except those who have a login (so the demo employee's own check-in stays manual).
 * Switch it off in Settings → Data before go-live; real punches are never overwritten.
 */
import { db } from '../store'
import type { Employee, ISODate } from '../types'
import { addDays, dayOfWeek, eachDay, monthOf, todayISO } from '@/lib/dates'
import { simulateDay } from './simulate'
import { computePunch } from '@/lib/attendance'
import { currentSession } from '@/services/session'

let running = false

export function runAutopilot() {
  if (running) return
  const s = db.all('company_settings')[0]
  if (!s?.demo_autopilot) return
  // Supabase mode: only someone allowed to edit attendance may write punches.
  if (db.backend?.kind === 'supabase' && !currentSession()?.can('attendance.manage')) return
  running = true
  try {
    const today = todayISO()
    const from = s.demo_autopilot_through ? addDays(s.demo_autopilot_through, 1) : addDays(today, -1)
    const days: ISODate[] = from <= today ? eachDay(from, today) : [today]
    if (days[days.length - 1] !== today) days.push(today)
    const holidays = new Set(db.all('holidays').filter((h) => h.type !== 'optional').map((h) => h.date))
    const shifts = new Map(db.all('shifts').map((x) => [x.id, x]))
    const withLogin = new Set(db.all('app_users').map((u) => u.employee_id).filter(Boolean))
    const existing = new Set(db.all('attendance').map((a) => `${a.employee_id}|${a.date}`))
    const leaves = db.all('leave_requests').filter((l) => l.status === 'approved')
    const structures = db.all('salary_structures')
    const now = new Date()
    const employees = db.all('employees').filter((e: Employee) => e.status !== 'exited' && e.dob)
    let added = 0
    db.batch(() => {
      for (const d of days) {
        if (holidays.has(d)) continue
        for (const e of employees) {
          if (withLogin.has(e.id) || d < e.date_of_joining || (e.date_of_exit && d > e.date_of_exit)) continue
          const shift = shifts.get(e.shift_id)
          if (!shift || shift.weekly_offs.includes(dayOfWeek(d))) continue
          if (existing.has(`${e.id}|${d}`)) continue
          const leave = leaves.find((l) => l.employee_id === e.id && l.from_date <= d && l.to_date >= d)
          if (leave && !leave.half_day) continue
          const ot = structures.find((x) => x.employee_id === e.id)?.ot_eligible ?? false
          const rec = simulateDay(e, d, shift, s.attendance, {
            cutoff: d === today ? now : undefined,
            halfDay: !!leave?.half_day,
            otStatus: 'pending',
            otEligible: ot,
          })
          if (rec) {
            db.insert('attendance', rec)
            added++
          }
        }
      }
      // close yesterday's open punches that were captured mid-day
      for (const a of db.all('attendance')) {
        if (a.check_in && !a.check_out && a.date < today && a.source === 'biometric' && !withLogin.has(a.employee_id)) {
          const e = db.get('employees', a.employee_id)
          const shift = e && shifts.get(e.shift_id)
          if (!e || !shift) continue
          const sim = simulateDay(e, a.date, shift, s.attendance, { otStatus: 'pending', otEligible: false })
          if (!sim?.check_out) continue
          const calc = computePunch(a.date, shift, a.check_in, sim.check_out, s.attendance)
          db.update('attendance', a.id, { check_out: sim.check_out, ...calc, ot_status: calc.ot_minutes > 0 ? 'pending' : 'none' })
        }
      }
      if (s.demo_autopilot_through !== today) db.update('company_settings', s.id, { demo_autopilot_through: today })
    })
    if (added) console.info(`[demo autopilot] simulated ${added} biometric punches through ${monthOf(today)}`)
  } finally {
    running = false
  }
}
