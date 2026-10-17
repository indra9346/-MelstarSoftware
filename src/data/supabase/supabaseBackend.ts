import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnyRow, Change, DataBackend, TableSnapshot } from '../backend'
import { TABLE_NAMES, type TableName } from '../types'
import { addDays, todayISO } from '@/lib/dates'

/**
 * Supabase mode. Same contract as the static backend:
 *  - load(): reads every table the signed-in user may see. Row Level Security
 *    (supabase/migrations/…_security.sql) decides what an employee vs. an admin gets back.
 *  - persist(): one insert / update / delete per change; returns the server row so
 *    server-assigned values (e.g. petty-cash voucher numbers) reach the UI.
 *  - onRemote(): Supabase Realtime keeps every open screen live.
 *
 * Large, ever-growing tables are loaded in a rolling window; older slices are fetched on demand
 * with loadRange() (e.g. the attendance register for a month last year).
 */
const WINDOWS: Partial<Record<TableName, { column: string; days: number }>> = {
  attendance: { column: 'date', days: 400 },
  audit_logs: { column: 'at', days: 120 },
  notifications: { column: 'created_at', days: 90 },
  stock_movements: { column: 'date', days: 730 },
}

/**
 * Append-only / cross-user tables: the writer may insert but not necessarily read the row back
 * (e.g. an employee's audit entry), so these inserts don't ask for the row in the response.
 */
const INSERT_WITHOUT_RETURN = new Set<TableName>(['audit_logs', 'notifications'])

/**
 * Top-level numeric columns (from src/data/types.ts). Postgres numeric can arrive as a string
 * (e.g. "1450.00") over Realtime; the app does arithmetic on these, so they're coerced back.
 */
const NUMERIC_FIELDS = new Set<string>(['accepted_qty', 'adjustment', 'advance_recovery', 'allotted', 'amount', 'annual_quota', 'arrears', 'authorised_capital', 'balance_after', 'basic', 'bonus', 'break_minutes', 'calibration_interval_days', 'check_in_distance_m', 'check_in_lat', 'check_in_lng', 'completed_qty', 'conveyance', 'cost', 'credit_limit', 'ctc_annual', 'da', 'days', 'days_in_month', 'declared_deductions', 'document_after_days', 'downtime_minutes', 'early_exit_minutes', 'emi_amount', 'employee_count', 'employer_cost', 'esi_employee', 'esi_employee_rate', 'esi_employer', 'esi_employer_rate', 'esi_wage_threshold', 'esi_wages', 'file_size', 'financial_year_start_month', 'full_day_minutes', 'geofence_radius_m', 'grace_minutes', 'gross_earnings', 'gst_rate', 'half_day_minutes', 'holidays', 'hour_meter', 'hra', 'installments', 'late_marks', 'late_marks_per_half_day', 'late_minutes', 'loan_recovery', 'lop_days', 'lot_qty', 'max_carry_forward', 'min_ot_minutes', 'net_pay', 'opening', 'ot_base_days', 'ot_hours', 'ot_hours_per_day', 'ot_minutes', 'ot_multiplier', 'ot_pay', 'ot_rate_per_hour', 'other_allowance', 'other_deductions', 'paid_days', 'paid_leave_days', 'paid_up_capital', 'pay_day', 'payment_terms_days', 'petty_cash_approval_limit', 'petty_cash_imprest', 'petty_cash_low_alert', 'pf_admin', 'pf_admin_rate', 'pf_edli', 'pf_edli_rate', 'pf_employee', 'pf_employee_rate', 'pf_employer_epf', 'pf_employer_epf_rate', 'pf_employer_eps', 'pf_employer_eps_rate', 'pf_wage_ceiling', 'pf_wages', 'plant_lat', 'plant_lng', 'present_days', 'professional_tax', 'qty', 'qty_affected', 'rate', 'rating', 'received_qty', 'rejected_qty', 'reorder_level', 'returned_qty', 'sample_size', 'sort_order', 'special_allowance', 'stock_qty', 'subtotal', 'tax_total', 'tds', 'tds_cess_rate', 'tds_new_rebate_limit', 'tds_new_standard_deduction', 'tds_old_rebate_limit', 'tds_old_standard_deduction', 'total', 'total_deductions', 'total_employer_cost', 'total_gross', 'total_net', 'unit_cost', 'unit_price', 'week_offs', 'worked_minutes', 'working_days', 'year'])

export function normalizeRow(row: AnyRow): AnyRow {
  let out: AnyRow | null = null
  for (const k in row) {
    const v = row[k]
    if (typeof v === 'string' && NUMERIC_FIELDS.has(k) && v !== '' && !Number.isNaN(Number(v))) {
      out ??= { ...row }
      ;(out as Record<string, unknown>)[k] = Number(v)
    }
  }
  return out ?? row
}

/** Fields a directory row lacks; filled so pages can rely on the Employee shape. */
const DIRECTORY_DEFAULTS = {
  dob: '', personal_email: '', address: '', city: '', state: '', pincode: '', exit_reason: '', blood_group: '', marital_status: 'single',
  pan: '', aadhaar_masked: '', uan: '', esic_no: '', bank_name: '', bank_account: '', ifsc: '', tax_regime: 'new', declared_deductions: 0, notes: '',
}

export class SupabaseBackend implements DataBackend {
  readonly kind = 'supabase' as const
  constructor(public client: SupabaseClient) {}

  private async fetchAll(table: string, filter?: { column: string; from: string; to?: string }): Promise<AnyRow[]> {
    const rows: AnyRow[] = []
    const page = 1000
    for (let from = 0; ; from += page) {
      let q = this.client.from(table).select('*').order('id').range(from, from + page - 1)
      if (filter) {
        q = q.gte(filter.column, filter.from)
        if (filter.to) q = q.lte(filter.column, filter.to)
      }
      const { data, error } = await q
      if (error) {
        // A table this role cannot read simply stays empty.
        if (!/permission denied/i.test(error.message)) console.warn(`[supabase] ${table}: ${error.message}`)
        break
      }
      rows.push(...((data ?? []) as AnyRow[]).map(normalizeRow))
      if (!data || data.length < page) break
    }
    return rows
  }

  async load() {
    const tables: TableSnapshot = {}
    const today = todayISO()
    await Promise.all(
      TABLE_NAMES.map(async (t) => {
        const w = WINDOWS[t]
        tables[t] = await this.fetchAll(t, w ? { column: w.column, from: addDays(today, -w.days) } : undefined)
      }),
    )
    // Self-service users only get their own full employee row; everyone else comes from the
    // employee_directory view (names, department, designation — no salary / ID / bank data).
    const full = new Set((tables.employees ?? []).map((e) => e.id))
    const directory = await this.fetchAll('employee_directory')
    for (const d of directory) if (!full.has(d.id)) (tables.employees ??= []).push({ ...DIRECTORY_DEFAULTS, ...d } as AnyRow)
    return { tables, empty: false, meta: null }
  }

  async loadRange(table: TableName, column: string, from: string, to: string) {
    return this.fetchAll(table, { column, from, to })
  }

  async persist(change: Change): Promise<AnyRow | void> {
    const q = this.client.from(change.table)
    if (change.op === 'insert') {
      if (INSERT_WITHOUT_RETURN.has(change.table)) {
        const { error } = await q.insert(change.row)
        if (error) throw new Error(error.message)
        return
      }
      const { data, error } = await q.insert(change.row).select().maybeSingle()
      if (error) throw new Error(error.message)
      return (data as AnyRow | null) ?? undefined
    }
    if (change.op === 'update') {
      const { data, error } = await q.update(change.patch).eq('id', change.row.id).select().maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('permission denied (no row updated)')
      return data as AnyRow
    }
    const { error } = await q.delete().eq('id', change.id)
    if (error) throw new Error(error.message)
  }

  async rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args ?? {})
    if (error) throw new Error(error.message)
    return data as T
  }

  onRemote(cb: (change: Change) => void) {
    const channel = this.client.channel('melstar-erp-db')
    channel.on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      const table = payload.table as TableName
      if (!TABLE_NAMES.includes(table)) return
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as Partial<AnyRow>).id
        if (id) cb({ table, op: 'delete', id })
      } else {
        const row = normalizeRow(payload.new as AnyRow)
        cb({ table, op: payload.eventType === 'INSERT' ? 'insert' : 'update', row, patch: row } as Change)
      }
    })
    channel.subscribe()
    return () => void this.client.removeChannel(channel)
  }
}
