import { createClient, type Client, type InArgs, type ResultSet } from '@libsql/client'
import { app } from 'electron'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'
import { config } from '../env'
import { MIGRATIONS } from './schema'

export type Row = Record<string, any>

let client: Client | null = null
let mode: 'embedded' | 'remote' | 'local-only' = 'local-only'
let lastSyncAt: string | null = null
let lastSyncError: string | null = null
let connectError: string | null = null
let syncTimer: NodeJS.Timeout | null = null

export function dbMode(): typeof mode {
  return mode
}

export function dbStatus() {
  return {
    mode,
    connected: client !== null,
    lastSyncAt,
    lastSyncError,
    connectError,
    remoteConfigured: Boolean(config.tursoUrl)
  }
}

/* -------------------------------------------------------------------------- */
/*  Connection                                                                 */
/* -------------------------------------------------------------------------- */

/** Removes a local SQLite file and its -wal / -shm / replica metadata siblings. */
function wipeLocal(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-info', '-client_wal_index']) {
    const path = `${file}${suffix}`
    if (existsSync(path)) {
      try {
        rmSync(path, { recursive: true, force: true })
      } catch (err) {
        log.warn(`[db] could not remove ${path}`, err)
      }
    }
  }
}

export async function connect(): Promise<Client> {
  if (client) return client

  const dir = app.getPath('userData')
  // Distinct files: a plain offline database and a Turso replica are not
  // interchangeable, and pointing the replica at a plain file fails hard.
  const offlineFile = join(dir, 'krishna-mobile.db')
  // Read-replica file. A NEW name again: the previous `krishna-replica-lf.db`
  // was an offline-writes replica whose local history may have diverged from
  // the primary — it cannot be reused, only salvaged (see db/salvage.ts).
  const replicaFile = join(dir, 'krishna-replica-rw.db')
  const url = config.tursoUrl
  const token = config.tursoToken

  connectError = null

  // Reads local, writes forwarded to the primary. The earlier `offline: true`
  // (local-first) mode broke with two shops writing concurrently: WAL-frame
  // replication cannot merge diverged histories, so one PC's push was rejected
  // forever (InvalidPushFrameConflict) and its changes were stranded locally.
  // With write-forwarding every write serialises on the primary — divergence is
  // impossible — while reads stay instant from the local copy. A write costs a
  // network round-trip (~300ms) and needs the internet to be up.
  const embeddedOpts = {
    url: `file:${replicaFile}`,
    syncUrl: url,
    authToken: token || undefined,
    intMode: 'number' as const
  }

  if (url && config.useEmbeddedReplica) {
    mode = 'embedded'
    try {
      client = createClient(embeddedOpts)
    } catch (err: any) {
      // A half-written or mode-switched replica cannot be repaired in place.
      // Everything in it also lives in Turso, so rebuilding it is safe.
      log.warn(`[db] replica unusable (${err?.message}) — rebuilding from Turso`)
      wipeLocal(replicaFile)
      try {
        client = createClient(embeddedOpts)
      } catch (err2: any) {
        log.warn('[db] replica rebuild failed — falling back to a live connection', err2)
        mode = 'remote'
        client = createClient({ url, authToken: token || undefined, intMode: 'number' })
      }
    }
    log.info(`[db] ${mode} (reads local, writes to primary) — ${url}`)
  } else if (url) {
    mode = 'remote'
    client = createClient({ url, authToken: token || undefined, intMode: 'number' })
    log.info(`[db] remote ${url}`)
  } else {
    // No credentials yet: run entirely offline so the app is still usable.
    mode = 'local-only'
    client = createClient({ url: `file:${offlineFile}`, intMode: 'number' })
    log.warn('[db] TURSO_DATABASE_URL is not set — running local-only')
  }

  try {
    await client.execute('PRAGMA foreign_keys = ON')
  } catch (err: any) {
    connectError = err?.message ?? String(err)
    client.close()
    client = null
    throw err
  }

  await sync()
  return client
}

export function getClient(): Client {
  if (!client) throw new Error('Database is not connected yet')
  return client
}

export async function sync(): Promise<{ ok: boolean; error?: string }> {
  if (!client || mode !== 'embedded') return { ok: true }
  try {
    await client.sync()
    lastSyncAt = new Date().toISOString()
    lastSyncError = null
    return { ok: true }
  } catch (err: any) {
    lastSyncError = err?.message ?? String(err)
    log.warn('[db] sync failed', lastSyncError)
    return { ok: false, error: lastSyncError ?? undefined }
  }
}

export function startAutoSync(): void {
  const seconds = config.syncIntervalSeconds
  if (mode !== 'embedded' || seconds <= 0 || syncTimer) return
  syncTimer = setInterval(() => void sync(), seconds * 1000)
}

/**
 * Writes reach the primary immediately (write-forwarding), but the OTHER
 * shop's changes only arrive on a pull. After a write we schedule one debounced
 * background sync so both machines converge within a couple of seconds instead
 * of the full auto-sync interval.
 */
let pushTimer: NodeJS.Timeout | null = null
export function schedulePush(delayMs = 2000): void {
  if (mode !== 'embedded' || pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    void sync()
  }, delayMs)
}

export function stopAutoSync(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
}

export async function close(): Promise<void> {
  stopAutoSync()
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  await sync() // flush any un-pushed local writes to Turso before exit
  client?.close()
  client = null
}

/* -------------------------------------------------------------------------- */
/*  Query helpers                                                              */
/* -------------------------------------------------------------------------- */

function toObjects(rs: ResultSet): Row[] {
  return rs.rows.map((r) => {
    const o: Row = {}
    rs.columns.forEach((c, i) => {
      const v = r[i]
      o[c] = typeof v === 'bigint' ? Number(v) : v
    })
    return o
  })
}

/** Accepts positional (`?`) or named (`:name`) parameters. */
export async function all<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const rs = await getClient().execute({ sql, args })
  return toObjects(rs) as T[]
}

export async function one<T = Row>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await all<T>(sql, args)
  return rows[0] ?? null
}

export async function scalar<T = any>(sql: string, args: InArgs = []): Promise<T | null> {
  const rs = await getClient().execute({ sql, args })
  if (rs.rows.length === 0) return null
  const v = rs.rows[0][0]
  return (typeof v === 'bigint' ? Number(v) : v) as T
}

export async function run(sql: string, args: InArgs = []): Promise<ResultSet> {
  const rs = await getClient().execute({ sql, args })
  schedulePush()
  return rs
}

export interface Stmt {
  sql: string
  args?: InArgs
}

/**
 * Runs a set of statements atomically. libSQL's `batch(_, 'write')` wraps them
 * in a single transaction and rolls back entirely if any statement fails.
 */
export async function batch(stmts: Stmt[]): Promise<void> {
  if (stmts.length === 0) return
  await getClient().batch(
    stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    'write'
  )
  schedulePush()
}

/**
 * For flows that must read-then-write inside one transaction.
 */
export async function tx<T>(fn: (t: TxHandle) => Promise<T>): Promise<T> {
  const t = await getClient().transaction('write')
  const handle: TxHandle = {
    async all<R = Row>(sql: string, args: InArgs = []) {
      const rs = await t.execute({ sql, args })
      return toObjects(rs) as R[]
    },
    async one<R = Row>(sql: string, args: InArgs = []) {
      const rows = await handle.all<R>(sql, args)
      return rows[0] ?? null
    },
    async run(sql: string, args: InArgs = []) {
      await t.execute({ sql, args })
    }
  }
  try {
    const result = await fn(handle)
    await t.commit()
    schedulePush()
    return result
  } catch (err) {
    try {
      await t.rollback()
    } catch {
      /* already closed */
    }
    throw err
  }
}

export interface TxHandle {
  all<R = Row>(sql: string, args?: InArgs): Promise<R[]>
  one<R = Row>(sql: string, args?: InArgs): Promise<R | null>
  run(sql: string, args?: InArgs): Promise<void>
}

/* -------------------------------------------------------------------------- */
/*  Migrations                                                                 */
/* -------------------------------------------------------------------------- */

export async function migrate(): Promise<number> {
  const c = getClient()
  await c.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`
  )

  const applied = new Set(
    (await all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version)
  )

  let count = 0
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    log.info(`[db] applying migration ${m.version} — ${m.name}`)
    await c.executeMultiple(m.sql)
    await run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
      m.version,
      m.name,
      new Date().toISOString()
    ])
    count++
  }
  if (count > 0) await sync()
  return count
}
