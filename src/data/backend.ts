import type { BaseRow, TableName } from './types'

export type AnyRow = BaseRow & Record<string, unknown>
export type TableSnapshot = Partial<Record<TableName, AnyRow[]>>

export type Change =
  | { table: TableName; op: 'insert'; row: AnyRow }
  | { table: TableName; op: 'update'; row: AnyRow; patch: Record<string, unknown> }
  | { table: TableName; op: 'delete'; id: string }

/**
 * Persistence backend behind the in-memory store.
 *
 * The store keeps every table the signed-in user can see in memory (a ~40-person plant
 * produces a few thousand rows a year), so pages read synchronously and re-render instantly.
 * A backend only has to load tables, persist individual changes and report remote changes.
 *
 *  - LocalBackend  → IndexedDB + BroadcastChannel (static demo mode, no server).
 *  - SupabaseBackend → Postgres tables from supabase/migrations + Realtime.
 */
export interface DataBackend {
  readonly kind: 'static' | 'supabase'
  /** Load all tables. `empty` = nothing stored yet (static mode seeds demo data). */
  load(): Promise<{ tables: TableSnapshot; empty: boolean; meta: BackendMeta | null }>
  /** Persist one change. May resolve with the server's version of the row (defaults, numbers). */
  persist(change: Change): Promise<AnyRow | void>
  /** Changes made elsewhere (another tab, another user). Returns an unsubscribe fn. */
  onRemote(cb: (change: Change) => void): () => void
  /** Replace everything (seed / reset). Static mode only. */
  replaceAll?(tables: TableSnapshot, meta: BackendMeta): Promise<void>
  saveMeta?(meta: BackendMeta): Promise<void>
  /** Fetch an older slice of a large table (e.g. attendance before the loaded window). */
  loadRange?(table: TableName, column: string, from: string, to: string): Promise<AnyRow[]>
  /** Call a server function (Supabase RPC). */
  rpc?<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
}

export interface BackendMeta {
  seed_version: number
  seeded_at: string
  /** Last date the demo autopilot generated biometric punches for. */
  autopilot_through: string
}
