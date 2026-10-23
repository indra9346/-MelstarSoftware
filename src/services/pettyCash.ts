/**
 * Petty cash: the imprest cash box (petty_cash_entries = cash book) and expense claims
 * (petty_cash_vouchers). Claim notifications are created by the database / notificationRules.
 */
import { db } from '@/data/store'
import type { PettyCashEntry, PettyCashVoucher } from '@/data/types'
import { addDays, fmtDate, todayISO } from '@/lib/dates'
import { fullName, inr, round2 } from '@/lib/format'
import { nextFyNumber } from '@/lib/ids'
import { audit } from './audit'
import { currentSession, selfApprovalBlock, type Session } from './session'

/* ── cash book ─────────────────────────────────────────────────────────── */

/** Chronological order: date, then time of entry, then entry number. */
export function sortEntries(entries: readonly PettyCashEntry[]): PettyCashEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || a.entry_no.localeCompare(b.entry_no, 'en-IN', { numeric: true }))
}

const signed = (e: PettyCashEntry) => (e.type === 'in' ? e.amount : -e.amount)

/** Cash in hand = receipts − payments over the whole cash book (optionally up to a date). */
export function cashInHand(entries: readonly PettyCashEntry[] = db.all('petty_cash_entries'), upTo?: string): number {
  let bal = 0
  for (const e of entries) if (!upTo || e.date <= upTo) bal += signed(e)
  return round2(bal)
}

export interface LedgerRow extends PettyCashEntry {
  receipt: number
  payment: number
  balance: number
}

export interface Ledger {
  opening: number
  rows: LedgerRow[]
  receipts: number
  payments: number
  closing: number
}

/** Cash-book rows within [from, to] with a running balance and the opening balance carried in. */
export function ledgerWithBalance(entries: readonly PettyCashEntry[], from?: string | null, to?: string | null): Ledger {
  const sorted = sortEntries(entries)
  let opening = 0
  let bal = 0
  let receipts = 0
  let payments = 0
  const rows: LedgerRow[] = []
  for (const e of sorted) {
    if (from && e.date < from) {
      opening += signed(e)
      continue
    }
    if (to && e.date > to) continue
    if (!rows.length) bal = opening
    bal += signed(e)
    const receipt = e.type === 'in' ? e.amount : 0
    const payment = e.type === 'out' ? e.amount : 0
    receipts += receipt
    payments += payment
    rows.push({ ...e, receipt, payment, balance: round2(bal) })
  }
  opening = round2(opening)
  return { opening, rows, receipts: round2(receipts), payments: round2(payments), closing: round2(opening + receipts - payments) }
}

/* ── permission helpers ─────────────────────────────────────────────────── */

function requireSession(): Session {
  const s = currentSession()
  if (!s) throw new Error('You are not signed in.')
  return s
}

function requireManage(): Session {
  const s = requireSession()
  if (!s.can('petty_cash.manage')) throw new Error('You do not have permission to manage petty cash.')
  return s
}

/** Why the signed-in user cannot approve this voucher (null = can approve). */
export function approvalBlock(v: PettyCashVoucher, s: Session | null = currentSession()): string | null {
  if (!s?.can('petty_cash.manage')) return 'You do not have petty-cash approval rights.'
  if (v.status !== 'pending') return `This voucher is already ${v.status}.`
  const own = selfApprovalBlock(v.employee_id, s)
  if (own) return own
  const limit = db.settings().petty_cash_approval_limit
  if (v.amount > limit && !s.can('settings.manage')) return `Above the ${inr(limit)} approval limit — needs a Super Admin (settings access) to approve.`
  return null
}

/** Why this voucher cannot be paid out now (null = can pay). */
export function payBlock(v: PettyCashVoucher, balance = cashInHand(), s: Session | null = currentSession()): string | null {
  if (!s?.can('petty_cash.manage')) return 'You do not have petty-cash rights.'
  if (v.status !== 'approved') return v.status === 'paid' ? 'Already paid.' : 'Approve the voucher first.'
  if (v.ledger_entry_id) return 'Already posted to the cash book.'
  if (v.amount > balance) return `Not enough cash in hand (${inr(balance)}). Top up the cash box first.`
  return null
}

/* ── voucher validation ─────────────────────────────────────────────────── */

export interface VoucherInput {
  employee_id: string
  date: string
  category: string
  amount: number | null
  payee: string
  bill_no: string
  description: string
  attachment: string | null
}

export type VoucherErrors = Partial<Record<keyof VoucherInput, string>>

/** Field errors for a claim. `claim` mode = employee self-service (date within the last 30 days). */
export function voucherErrors(v: VoucherInput, mode: 'claim' | 'admin'): VoucherErrors {
  const e: VoucherErrors = {}
  const today = todayISO()
  if (!v.employee_id) e.employee_id = 'Choose the employee who spent the money.'
  if (!v.date) e.date = 'Enter the bill date.'
  else if (v.date > today) e.date = 'The bill date cannot be in the future.'
  else if (mode === 'claim' && v.date < addDays(today, -30)) e.date = `Claims must be raised within 30 days (on or after ${fmtDate(addDays(today, -30))}).`
  if (!v.category) e.category = 'Choose a category.'
  else if (!db.settings().petty_cash_categories.includes(v.category)) e.category = 'Choose a category from the list.'
  if (v.amount == null || !Number.isFinite(v.amount)) e.amount = 'Enter the amount.'
  else if (v.amount <= 0) e.amount = 'Amount must be more than zero.'
  else if (round2(v.amount) !== v.amount) e.amount = 'Use at most 2 decimal places.'
  else if (v.amount > 100000) e.amount = 'Petty cash is for small expenses — use a purchase order above ₹1,00,000.'
  if (v.payee.trim().length < 2) e.payee = 'Who was paid? (shop, vendor or person)'
  else if (v.payee.length > 120) e.payee = 'Keep it under 120 characters.'
  if (v.bill_no.length > 40) e.bill_no = 'Keep it under 40 characters.'
  const d = v.description.trim()
  if (d.length < 3) e.description = 'Describe the expense (at least 3 characters).'
  else if (d.length > 300) e.description = 'Keep it under 300 characters.'
  return e
}

/* ── voucher actions ─────────────────────────────────────────────────────── */

const empName = (id: string) => fullName(db.get('employees', id))

/**
 * Create a claim. Employees create their own (status pending); petty-cash managers can record
 * one on behalf of an employee and optionally approve it straight away.
 * The voucher number is provisional — in Supabase mode the server assigns the real one.
 */
export function createVoucher(input: VoucherInput, opts: { mode: 'claim' | 'admin'; approve?: boolean }): PettyCashVoucher {
  const s = requireSession()
  if (opts.mode === 'admin' && !s.can('petty_cash.manage')) throw new Error('You do not have permission to record vouchers for others.')
  if (opts.mode === 'claim' && s.employee?.id !== input.employee_id) throw new Error('You can only claim for yourself.')
  const errs = voucherErrors(input, opts.mode)
  const first = Object.values(errs)[0]
  if (first) throw new Error(first)
  const voucher_no = nextFyNumber('PCV', db.all('petty_cash_vouchers').map((v) => v.voucher_no), input.date)
  const base = {
    voucher_no,
    employee_id: input.employee_id,
    date: input.date,
    category: input.category,
    amount: round2(input.amount!),
    payee: input.payee.trim(),
    description: input.description.trim(),
    bill_no: input.bill_no.trim(),
    attachment: input.attachment,
    status: 'pending' as const,
    reviewed_by: null,
    reviewed_at: null,
    review_note: '',
    paid_at: null,
    ledger_entry_id: null,
  }
  const draft = { ...base, id: '', created_at: '', updated_at: '' }
  const approveNow = opts.mode === 'admin' && opts.approve && !approvalBlock(draft, s)
  const row = db.insert('petty_cash_vouchers', approveNow ? { ...base, status: 'approved', reviewed_by: s.user.id, reviewed_at: new Date().toISOString() } : base)
  const who = empName(input.employee_id)
  audit('create', 'petty_cash_vouchers', row.id, `${opts.mode === 'claim' ? 'Submitted' : 'Recorded'} petty-cash claim · ${inr(row.amount)} · ${row.category}${opts.mode === 'admin' ? ` for ${who}` : ''}${approveNow ? ' (approved)' : ''}`)
  return row
}

export function approveVoucher(v: PettyCashVoucher, note = ''): PettyCashVoucher {
  const s = requireManage()
  const cur = db.get('petty_cash_vouchers', v.id) ?? v
  const block = approvalBlock(cur, s)
  if (block) throw new Error(block)
  const patch = { status: 'approved' as const, reviewed_by: s.user.id, reviewed_at: new Date().toISOString(), review_note: note.trim() }
  const row = db.update('petty_cash_vouchers', cur.id, patch)
  audit('approve', 'petty_cash_vouchers', cur.id, `Approved ${cur.voucher_no} · ${inr(cur.amount)} · ${empName(cur.employee_id)}`)
  return row
}

export function rejectVoucher(v: PettyCashVoucher, reason: string): PettyCashVoucher {
  const s = requireManage()
  const cur = db.get('petty_cash_vouchers', v.id) ?? v
  if (cur.status !== 'pending' && cur.status !== 'approved') throw new Error(`This voucher is already ${cur.status}.`)
  if (!reason.trim()) throw new Error('Give a reason for rejecting.')
  const row = db.update('petty_cash_vouchers', cur.id, { status: 'rejected', reviewed_by: s.user.id, reviewed_at: new Date().toISOString(), review_note: reason.trim() })
  audit('reject', 'petty_cash_vouchers', cur.id, `Rejected ${cur.voucher_no} · ${inr(cur.amount)} — ${reason.trim()}`)
  return row
}

/**
 * Pay an approved voucher from the cash box: posts an 'out' entry in the cash book and marks the
 * voucher paid. Waits for the server so the two rows stay consistent.
 */
export async function payVoucher(v: PettyCashVoucher): Promise<PettyCashVoucher> {
  const s = requireManage()
  const cur = db.get('petty_cash_vouchers', v.id) ?? v
  const block = payBlock(cur, cashInHand(), s)
  if (block) throw new Error(block)
  // Supabase: one server transaction posts the entry and marks the voucher paid.
  const backend = db.backend
  if (backend?.kind === 'supabase' && backend.rpc) {
    await settle()
    const res = await backend.rpc<{ voucher: PettyCashVoucher; entry: PettyCashEntry }>('petty_cash_pay', { p_voucher: cur.id })
    db.ingest('petty_cash_entries', res.entry)
    db.ingest('petty_cash_vouchers', res.voucher)
    audit('pay', 'petty_cash_vouchers', cur.id, `Paid ${cur.voucher_no} · ${inr(cur.amount)} to ${empName(cur.employee_id)} (cash book ${res.entry.entry_no})`)
    return res.voucher
  }
  const date = todayISO()
  const entries = db.all('petty_cash_entries')
  const entry = db.insert('petty_cash_entries', {
    entry_no: nextFyNumber('PC', entries.map((e) => e.entry_no), date),
    date,
    type: 'out',
    amount: cur.amount,
    category: cur.category,
    description: `${cur.voucher_no} · ${cur.description}`,
    voucher_id: cur.id,
    created_by: s.user.id,
  })
  await settle()
  // a failed write is rolled back by the store, so presence = saved
  if (!db.get('petty_cash_entries', entry.id)) throw new Error('Could not post the payment to the cash book — nothing was paid.')
  db.update('petty_cash_vouchers', cur.id, { status: 'paid', paid_at: new Date().toISOString(), ledger_entry_id: entry.id })
  await settle()
  const row = db.get('petty_cash_vouchers', cur.id)
  if (row?.status !== 'paid') {
    db.remove('petty_cash_entries', entry.id)
    throw new Error('Could not mark the voucher as paid — the cash-book entry was reversed.')
  }
  audit('pay', 'petty_cash_vouchers', cur.id, `Paid ${cur.voucher_no} · ${inr(cur.amount)} to ${empName(cur.employee_id)} (cash book ${entry.entry_no})`)
  return row
}

/** Wait until every in-flight write has settled (db.flushed() rejects early when one fails). */
async function settle() {
  for (let i = 0; i < 6; i++) {
    try {
      await db.flushed()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

/** Approve and pay in one step (small, routine claims). */
export async function approveAndPay(v: PettyCashVoucher): Promise<PettyCashVoucher> {
  const approved = approveVoucher(v)
  const block = payBlock(approved, cashInHand())
  if (block) throw new Error(`Approved, but not paid: ${block}`)
  return payVoucher(approved)
}

export interface TopUpInput {
  date: string
  amount: number | null
  description: string
}

export function topUpErrors(t: TopUpInput): Partial<Record<keyof TopUpInput, string>> {
  const e: Partial<Record<keyof TopUpInput, string>> = {}
  if (!t.date) e.date = 'Enter the date.'
  else if (t.date > todayISO()) e.date = 'The date cannot be in the future.'
  if (t.amount == null || !Number.isFinite(t.amount)) e.amount = 'Enter the amount.'
  else if (t.amount <= 0) e.amount = 'Amount must be more than zero.'
  else if (round2(t.amount) !== t.amount) e.amount = 'Use at most 2 decimal places.'
  else if (t.amount > 500000) e.amount = 'That is far above the imprest — check the amount.'
  const d = t.description.trim()
  if (d.length < 3) e.description = 'Say where the cash came from (at least 3 characters).'
  else if (d.length > 200) e.description = 'Keep it under 200 characters.'
  return e
}

/** Cash received into the box (imprest top-up, refund …). */
export function topUp(input: TopUpInput, category = 'Imprest top-up'): PettyCashEntry {
  const s = requireManage()
  const first = Object.values(topUpErrors(input))[0]
  if (first) throw new Error(first)
  const entry = db.insert('petty_cash_entries', {
    entry_no: nextFyNumber('PC', db.all('petty_cash_entries').map((e) => e.entry_no), input.date),
    date: input.date,
    type: 'in',
    amount: round2(input.amount!),
    category,
    description: input.description.trim(),
    voucher_id: null,
    created_by: s.user.id,
  })
  audit('create', 'petty_cash_entries', entry.id, `Cash top-up ${entry.entry_no} · ${inr(entry.amount)} — ${entry.description}`)
  return entry
}

/** Employee withdraws their own pending claim. */
export function withdrawClaim(v: PettyCashVoucher) {
  const s = requireSession()
  const cur = db.get('petty_cash_vouchers', v.id)
  if (!cur) return
  if (cur.status !== 'pending') throw new Error('Only pending claims can be withdrawn.')
  if (cur.employee_id !== s.employee?.id && !s.can('petty_cash.manage')) throw new Error('You can only withdraw your own claims.')
  db.remove('petty_cash_vouchers', cur.id)
  audit('delete', 'petty_cash_vouchers', cur.id, `Withdrew petty-cash claim ${cur.voucher_no} · ${inr(cur.amount)} · ${cur.category}`)
}
