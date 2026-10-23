import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { AnyRow, Change, DataBackend } from './backend'
import { TABLE_NAMES, type NewRow, type Row, type TableName } from './types'
import { uuid } from '@/lib/ids'

type Listener = () => void
type ErrorListener = (message: string) => void
type ChangeListener = (table: TableName, row: AnyRow, prev: AnyRow | null) => void

/**
 * In-memory, reactive table store — the single data API every page and service uses.
 *
 *   db.all('employees')            → Employee[] (stable array until the table changes)
 *   db.get('employees', id)        → Employee | undefined
 *   db.insert('tasks', {...})      → Task (id + timestamps filled in)
 *   db.update('tasks', id, patch)  → Task
 *   db.remove('tasks', id)
 *   db.batch(() => { ...many writes... })  → listeners fire once
 *
 * Writes apply to memory synchronously (so the UI updates instantly) and are persisted by the
 * backend in the background. A write waits for any in-flight write to the same row or to a row it
 * references (e.g. a PO line after its PO, an approval after the request insert), so dependent
 * writes reach the server in order. A failed write is rolled back and reported through onError.
 * React components read through the hooks at the bottom (useTable / useRow / useSettings).
 */
class Store {
  private tables = new Map<TableName, Map<string, AnyRow>>()
  private snapshots = new Map<TableName, AnyRow[]>()
  private listeners = new Map<TableName, Set<Listener>>()
  private pending = new Set<TableName>()
  private flushQueued = false
  private batchDepth = 0
  private errorListeners = new Set<ErrorListener>()
  private version = 0
  private versionListeners = new Set<Listener>()
  backend: DataBackend | null = null

  constructor() {
    for (const t of TABLE_NAMES) this.tables.set(t, new Map())
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  attach(backend: DataBackend) {
    this.backend = backend
    backend.onRemote((c) => this.applyRemote(c))
  }

  /** Replace table contents wholesale (initial load / seed). No persistence. */
  hydrate(snapshot: Partial<Record<TableName, AnyRow[]>>) {
    for (const t of TABLE_NAMES) {
      const rows = snapshot[t]
      if (!rows) continue
      const m = new Map<string, AnyRow>()
      for (const r of rows) m.set(r.id, r)
      this.tables.set(t, m)
      this.touch(t)
    }
  }

  dump(): Partial<Record<TableName, AnyRow[]>> {
    const out: Partial<Record<TableName, AnyRow[]>> = {}
    for (const t of TABLE_NAMES) out[t] = [...this.tables.get(t)!.values()]
    return out
  }

  /** Raw rows for a table (used by the static backend when flushing to IndexedDB). */
  rows(t: TableName): AnyRow[] {
    return [...this.tables.get(t)!.values()]
  }

  /* ── reads ─────────────────────────────────────────────────────────────── */

  all<T extends TableName>(t: T): Row<T>[] {
    let snap = this.snapshots.get(t)
    if (!snap) {
      snap = [...this.tables.get(t)!.values()]
      this.snapshots.set(t, snap)
    }
    return snap as unknown as Row<T>[]
  }

  get<T extends TableName>(t: T, id: string | null | undefined): Row<T> | undefined {
    if (!id) return undefined
    return this.tables.get(t)!.get(id) as unknown as Row<T> | undefined
  }

  where<T extends TableName>(t: T, pred: (r: Row<T>) => boolean): Row<T>[] {
    return this.all(t).filter(pred)
  }

  find<T extends TableName>(t: T, pred: (r: Row<T>) => boolean): Row<T> | undefined {
    return this.all(t).find(pred)
  }

  count<T extends TableName>(t: T, pred?: (r: Row<T>) => boolean): number {
    return pred ? this.all(t).filter(pred).length : this.tables.get(t)!.size
  }

  /* ── writes ────────────────────────────────────────────────────────────── */

  insert<T extends TableName>(t: T, input: NewRow<T>): Row<T> {
    const now = new Date().toISOString()
    const row = { ...input, id: input.id ?? uuid(), created_at: input.created_at ?? now, updated_at: input.updated_at ?? now } as unknown as AnyRow
    this.tables.get(t)!.set(row.id, row)
    this.touch(t)
    this.persist({ table: t, op: 'insert', row }, () => {
      this.tables.get(t)!.delete(row.id)
      this.touch(t)
    })
    this.changeListeners.forEach((cb) => cb(t, row, null))
    return row as unknown as Row<T>
  }

  insertMany<T extends TableName>(t: T, inputs: NewRow<T>[]): Row<T>[] {
    return this.batch(() => inputs.map((i) => this.insert(t, i)))
  }

  update<T extends TableName>(t: T, id: string, patch: Partial<Row<T>>): Row<T> {
    const prev = this.tables.get(t)!.get(id)
    if (!prev) throw new Error(`${t} ${id} not found`)
    const row = { ...prev, ...(patch as Record<string, unknown>), id, updated_at: new Date().toISOString() } as AnyRow
    this.tables.get(t)!.set(id, row)
    this.touch(t)
    this.persist({ table: t, op: 'update', row, patch: patch as Record<string, unknown> }, () => {
      this.tables.get(t)!.set(id, prev)
      this.touch(t)
    })
    this.changeListeners.forEach((cb) => cb(t, row, prev))
    return row as unknown as Row<T>
  }

  remove<T extends TableName>(t: T, id: string) {
    const prev = this.tables.get(t)!.get(id)
    if (!prev) return
    this.tables.get(t)!.delete(id)
    this.touch(t)
    this.persist({ table: t, op: 'delete', id }, () => {
      this.tables.get(t)!.set(id, prev)
      this.touch(t)
    })
  }

  /** Group many writes so subscribers re-render once. */
  batch<R>(fn: () => R): R {
    this.batchDepth++
    try {
      return fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0) this.queueFlush()
    }
  }

  /* ── settings shortcut ─────────────────────────────────────────────────── */

  settings() {
    const s = this.all('company_settings')[0]
    if (!s) throw new Error('Company settings missing')
    return s
  }

  /* ── subscriptions ─────────────────────────────────────────────────────── */

  subscribe(tables: TableName | TableName[], cb: Listener): () => void {
    const list = Array.isArray(tables) ? tables : [tables]
    for (const t of list) {
      let set = this.listeners.get(t)
      if (!set) this.listeners.set(t, (set = new Set()))
      set.add(cb)
    }
    return () => list.forEach((t) => this.listeners.get(t)?.delete(cb))
  }

  /** Bumps on any change — for whole-app derived views. */
  subscribeAll(cb: Listener) {
    this.versionListeners.add(cb)
    return () => void this.versionListeners.delete(cb)
  }
  getVersion = () => this.version

  /** Local inserts/updates (not remote ones) — used for static-mode notification rules. */
  onLocalChange(cb: ChangeListener) {
    this.changeListeners.add(cb)
    return () => void this.changeListeners.delete(cb)
  }
  private changeListeners = new Set<ChangeListener>()

  onError(cb: ErrorListener) {
    this.errorListeners.add(cb)
    return () => void this.errorListeners.delete(cb)
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private touch(t: TableName) {
    this.snapshots.delete(t)
    this.pending.add(t)
    if (this.batchDepth === 0) this.queueFlush()
  }

  private queueFlush() {
    if (this.flushQueued || !this.pending.size) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      const tables = [...this.pending]
      this.pending.clear()
      const called = new Set<Listener>()
      for (const t of tables) {
        this.listeners.get(t)?.forEach((cb) => {
          if (!called.has(cb)) {
            called.add(cb)
            cb()
          }
        })
      }
      this.version++
      this.versionListeners.forEach((cb) => cb())
    })
  }

  private persist(change: Change, rollback: () => void) {
    const backend = this.backend
    if (!backend) return
    // ids are UUIDs, so any string value matching a row with a write in flight is a reference to it
    const own = change.op === 'delete' ? change.id : change.row.id
    const refs = change.op === 'insert' ? change.row : change.op === 'update' ? change.patch : {}
    const deps = [own, ...Object.values(refs).filter((v): v is string => typeof v === 'string' && v !== own)]
      .map((id) => this.lastWrite.get(id))
      .filter((d): d is Promise<void> => !!d)
    const p = Promise.all(deps)
      .then(() => backend.persist(change))
      .then((serverRow) => {
        // adopt server-assigned values (e.g. voucher numbers) without re-persisting
        if (serverRow && change.op !== 'delete' && this.tables.get(change.table)!.has(serverRow.id)) this.ingest(change.table, serverRow)
      })
      .catch((err: unknown) => {
        rollback()
        const msg = friendlyError(err)
        this.errorListeners.forEach((cb) => cb(`Could not save ${change.table.replace(/_/g, ' ')}: ${msg}`))
        throw err
      })
    this.inflight.add(p)
    const settled = p.catch(() => {})
    this.lastWrite.set(own, settled)
    void settled.finally(() => {
      this.inflight.delete(p)
      if (this.lastWrite.get(own) === settled) this.lastWrite.delete(own)
    })
  }

  private inflight = new Set<Promise<unknown>>()
  /** Latest write per row id (settles, never rejects): later writes that depend on the row chain after it. */
  private lastWrite = new Map<string, Promise<void>>()

  /** Resolves when every pending write has reached the backend (rejects if any failed). */
  async flushed(): Promise<void> {
    await Promise.all([...this.inflight])
  }

  /** Put a server row into the cache without persisting it (RPC results, older pages, realtime). */
  ingest<T extends TableName>(t: T, row: AnyRow | Row<T>) {
    const r = row as AnyRow
    this.tables.get(t)!.set(r.id, r)
    this.touch(t)
  }

  /** Drop a row from the cache without persisting (already deleted on the server). */
  forget<T extends TableName>(t: T, id: string) {
    if (this.tables.get(t)!.delete(id)) this.touch(t)
  }

  /** Empty every table (sign-out in Supabase mode). */
  clear() {
    for (const t of TABLE_NAMES) {
      this.tables.set(t, new Map())
      this.touch(t)
    }
  }

  private applyRemote(c: Change) {
    const m = this.tables.get(c.table)
    if (!m) return
    if (c.op === 'delete') m.delete(c.id)
    else m.set(c.row.id, c.row)
    this.touch(c.table)
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/row-level security|permission denied|42501/i.test(msg)) return 'you do not have permission for this action'
  if (/duplicate key/i.test(msg)) return 'a record with the same number already exists'
  if (/violates check constraint/i.test(msg)) return 'a value is outside the allowed range'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'network unavailable — please retry'
  return msg
}

export const db = new Store()

/* ── React hooks ───────────────────────────────────────────────────────────── */

/** All rows of a table; re-renders when that table changes (locally, another tab, or realtime). */
export function useTable<T extends TableName>(t: T): Row<T>[] {
  const subscribe = useCallback((cb: Listener) => db.subscribe(t, cb), [t])
  return useSyncExternalStore(subscribe, () => db.all(t))
}

export function useRow<T extends TableName>(t: T, id: string | null | undefined): Row<T> | undefined {
  const rows = useTable(t)
  return useMemo(() => (id ? rows.find((r) => r.id === id) : undefined), [rows, id])
}

export function useSettings() {
  const rows = useTable('company_settings')
  const s = rows[0]
  if (!s) throw new Error('Company settings missing')
  return s
}

/** Re-render when any of the listed tables change; returns a version key to use in memo deps. */
export function useTables(tables: TableName[]): string {
  const key = tables.join(',')
  const subscribe = useCallback((cb: Listener) => db.subscribe(key.split(',') as TableName[], cb), [key])
  return useSyncExternalStore(subscribe, () => tables.map(snapshotId).join('-'))
}

const ids = new WeakMap<object, number>()
let nextId = 1
function snapshotId(t: TableName) {
  const arr = db.all(t)
  let id = ids.get(arr)
  if (!id) {
    id = nextId++
    ids.set(arr, id)
  }
  return id
}
