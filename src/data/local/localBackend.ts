import type { AnyRow, BackendMeta, Change, DataBackend, TableSnapshot } from '../backend'
import { TABLE_NAMES, type TableName } from '../types'

/**
 * Static data mode: every table is stored in IndexedDB (one record per table), so the demo
 * survives reloads and holds far more than localStorage's 5 MB. A BroadcastChannel mirrors
 * every change to other open tabs, which is what makes the admin and employee dashboards
 * update live side by side.
 */
const DB_NAME = 'melstar-erp'
const STORE = 'kv'
const CHANNEL = 'melstar-erp-sync'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const s = t.objectStore(STORE)
    const req = fn(s)
    t.oncomplete = () => resolve(req ? (req.result as T) : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export class LocalBackend implements DataBackend {
  readonly kind = 'static' as const
  private db: IDBDatabase | null = null
  private channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  private dirty = new Set<TableName>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private memoryOnly = false

  /** The store hands us a reader so we can snapshot whole tables when flushing. */
  constructor(private readTable: (t: TableName) => AnyRow[]) {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush()
      })
    }
  }

  private async conn() {
    if (this.memoryOnly) return null
    if (!this.db) {
      try {
        this.db = await openDb()
      } catch {
        // Private windows on some browsers block IndexedDB: keep working in memory.
        this.memoryOnly = true
        return null
      }
    }
    return this.db
  }

  async load() {
    const db = await this.conn()
    if (!db) return { tables: {}, empty: true, meta: null }
    const meta = (await tx<BackendMeta>(db, 'readonly', (s) => s.get('meta'))) ?? null
    const tables: TableSnapshot = {}
    await Promise.all(
      TABLE_NAMES.map(async (t) => {
        const rows = await tx<AnyRow[]>(db, 'readonly', (s) => s.get('table:' + t))
        if (rows) tables[t] = rows
      }),
    )
    return { tables, empty: !meta, meta }
  }

  async replaceAll(tables: TableSnapshot, meta: BackendMeta) {
    const db = await this.conn()
    if (!db) return
    await tx(db, 'readwrite', (s) => {
      s.clear()
      for (const t of TABLE_NAMES) s.put(tables[t] ?? [], 'table:' + t)
      s.put(meta, 'meta')
    })
    this.channel?.postMessage({ kind: 'reload' })
  }

  async saveMeta(meta: BackendMeta) {
    const db = await this.conn()
    if (db) await tx(db, 'readwrite', (s) => s.put(meta, 'meta'))
  }

  async persist(change: Change) {
    this.dirty.add(change.table)
    this.channel?.postMessage({ kind: 'change', change })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 120)
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty.size) return
    const db = await this.conn()
    const tables = [...this.dirty]
    this.dirty.clear()
    if (!db) return
    await tx(db, 'readwrite', (s) => {
      for (const t of tables) s.put(this.readTable(t), 'table:' + t)
    })
  }

  onRemote(cb: (change: Change) => void) {
    if (!this.channel) return () => {}
    const handler = (e: MessageEvent) => {
      const msg = e.data as { kind: 'change'; change: Change } | { kind: 'reload' }
      if (msg.kind === 'change') cb(msg.change)
      else if (msg.kind === 'reload') window.location.reload()
    }
    this.channel.addEventListener('message', handler)
    return () => this.channel?.removeEventListener('message', handler)
  }
}
