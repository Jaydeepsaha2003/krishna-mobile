/**
 * Rescues data stranded in the old offline-writes replica.
 *
 * v1.1.0–v1.1.5 ran the database local-first (`offline: true`). With two shops
 * writing concurrently their WAL histories diverged, and one machine's push was
 * rejected by the primary forever (InvalidPushFrameConflict) — every record it
 * made after that point existed only in its local `krishna-replica-lf.db`.
 *
 * This runs once on startup, before the new read-replica opens: it opens that
 * old file as a plain SQLite database, compares it row-by-row with the primary,
 * and logically upserts anything the primary is missing (new rows, and rows
 * with a newer updated_at). Then the old file is renamed `.salvaged-<ts>` and
 * kept as a backup. Machines whose pushes all succeeded simply find nothing to
 * copy. Runs are idempotent — a crash mid-way just means some rows are already
 * there next time.
 */
import { createClient, type Client } from '@libsql/client'
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log/main'
import { config } from '../env'

/** UUID-keyed tables, parents before children so foreign keys resolve. */
const TABLES: Array<{ name: string; updatedCol?: string }> = [
  { name: 'brands', updatedCol: 'updated_at' },
  { name: 'models', updatedCol: 'updated_at' },
  { name: 'customers', updatedCol: 'updated_at' },
  { name: 'suppliers', updatedCol: 'updated_at' },
  { name: 'purchases', updatedCol: 'updated_at' },
  { name: 'purchase_items' },
  { name: 'stock_units', updatedCol: 'updated_at' },
  { name: 'transfers', updatedCol: 'updated_at' },
  { name: 'transfer_items' },
  { name: 'sales', updatedCol: 'updated_at' },
  { name: 'sale_items' },
  { name: 'payments' },
  { name: 'loans', updatedCol: 'updated_at' },
  { name: 'loan_repayments', updatedCol: 'updated_at' },
  { name: 'reconciliations', updatedCol: 'updated_at' },
  { name: 'reconciliation_items' },
  { name: 'stock_adjustments' },
  { name: 'service_catalog', updatedCol: 'updated_at' },
  { name: 'audit_log' }
]

/** Unique business numbers that could collide with rows the other shop made. */
const RENAME_ON_CONFLICT: Record<string, string> = {
  sales: 'invoice_no',
  loans: 'loan_no'
}

interface SalvageResult {
  attempted: boolean
  inserted: number
  updated: number
  failed: number
  details: string[]
}

async function tableExists(db: Client, name: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name]
  })
  return r.rows.length > 0
}

async function columnsOf(db: Client, table: string): Promise<string[]> {
  const r = await db.execute(`SELECT name FROM pragma_table_info('${table}')`)
  return r.rows.map((row) => String(row[0] ?? (row as any).name))
}

function upsertSql(table: string, cols: string[]): string {
  const sets = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  return `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
          ON CONFLICT(id) DO UPDATE SET ${sets}`
}

async function salvageTable(
  local: Client,
  remote: Client,
  table: { name: string; updatedCol?: string },
  result: SalvageResult
): Promise<void> {
  if (!(await tableExists(local, table.name))) return
  const cols = await columnsOf(local, table.name)
  if (!cols.includes('id')) return

  // What the primary already has (id -> updated_at when the table carries one).
  const remoteRows = await remote.execute(
    `SELECT id${table.updatedCol ? `, ${table.updatedCol}` : ''} FROM ${table.name}`
  )
  const remoteMap = new Map<string, string | null>()
  for (const r of remoteRows.rows) {
    remoteMap.set(String((r as any).id), table.updatedCol ? String((r as any)[table.updatedCol] ?? '') : null)
  }

  const localRows = await local.execute(`SELECT ${cols.join(',')} FROM ${table.name}`)
  for (const row of localRows.rows) {
    const id = String((row as any).id)
    const remoteUpdated = remoteMap.get(id)
    const isMissing = remoteUpdated === undefined
    const isNewer =
      !isMissing &&
      table.updatedCol !== undefined &&
      String((row as any)[table.updatedCol] ?? '') > String(remoteUpdated ?? '')
    if (!isMissing && !isNewer) continue

    const values = cols.map((c) => (row as any)[c] ?? null)
    try {
      await remote.execute({ sql: upsertSql(table.name, cols), args: values })
      if (isMissing) result.inserted++
      else result.updated++
    } catch (err: any) {
      // A unique business number (invoice/loan no.) may clash with one the
      // other shop issued while this machine was stranded. Re-number with a
      // "-R" (recovered) suffix rather than dropping the record.
      const renameCol = RENAME_ON_CONFLICT[table.name]
      if (renameCol && /UNIQUE/i.test(String(err?.message))) {
        try {
          const idx = cols.indexOf(renameCol)
          values[idx] = `${values[idx]}-R`
          await remote.execute({ sql: upsertSql(table.name, cols), args: values })
          result.inserted++
          result.details.push(`${table.name} ${id}: renumbered ${renameCol} to ${values[idx]}`)
          continue
        } catch {
          /* fall through to the failure log */
        }
      }
      result.failed++
      result.details.push(`${table.name} ${id}: ${err?.message ?? err}`)
    }
  }
}

/** Invoice counters must never go backwards, or numbers get reissued. */
async function salvageCounters(local: Client, remote: Client, result: SalvageResult): Promise<void> {
  if (!(await tableExists(local, 'counters'))) return
  const rows = await local.execute('SELECT id, next_no, updated_at FROM counters')
  for (const r of rows.rows) {
    try {
      await remote.execute({
        sql: `INSERT INTO counters (id, next_no, updated_at) VALUES (?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                next_no = MAX(counters.next_no, excluded.next_no),
                updated_at = excluded.updated_at`,
        args: [(r as any).id, (r as any).next_no, (r as any).updated_at]
      })
    } catch (err: any) {
      result.failed++
      result.details.push(`counters ${(r as any).id}: ${err?.message ?? err}`)
    }
  }
}

/**
 * Renames the old replica (and its WAL siblings) out of the way, kept as
 * backup. Windows may hold the handle for a moment after close() (EBUSY), so
 * each rename retries briefly. Returns true when nothing is left in place.
 */
async function retireFile(base: string): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let allGone = true
  for (const suffix of ['', '-wal', '-shm', '-info', '-client_wal_index']) {
    const p = `${base}${suffix}`
    if (!existsSync(p)) continue
    let done = false
    for (let attempt = 0; attempt < 6 && !done; attempt++) {
      try {
        renameSync(p, `${base}.salvaged-${stamp}${suffix}`)
        done = true
      } catch {
        await sleep(400)
      }
    }
    if (!done) {
      allGone = false
      log.warn(`[salvage] ${p} still locked — will retire it on a later launch`)
    }
  }
  return allGone
}

/** Written once the merge has fully succeeded, so it is never repeated. */
const markerOf = (base: string) => `${base}.salvage-done`

/**
 * Merges ANY SQLite backup of this app's database into the primary — the same
 * row-by-row logic the automatic salvage uses. Powers the manual
 * "Recover data from a backup file" action, for backups the automatic path
 * cannot see (renamed .salvaged-* files, manual copies, old replicas). The
 * picked file is read-only here: it is never modified, renamed or deleted.
 */
export async function mergeBackupIntoPrimary(filePath: string): Promise<SalvageResult> {
  const result: SalvageResult = { attempted: true, inserted: 0, updated: 0, failed: 0, details: [] }
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  if (!config.tursoUrl) throw new Error('TURSO_DATABASE_URL is not configured.')

  log.info(`[salvage] manual recovery from ${filePath}`)
  let local: Client | null = null
  let remote: Client | null = null
  try {
    local = createClient({ url: `file:${filePath}`, intMode: 'number' })
    remote = createClient({
      url: config.tursoUrl,
      authToken: config.tursoToken || undefined,
      intMode: 'number'
    })
    await remote.execute('SELECT 1')
    // Prove the picked file is actually one of ours before touching anything.
    if (!(await tableExists(local, 'stock_units')) && !(await tableExists(local, 'sales'))) {
      throw new Error('This file does not look like a Krishna Mobile database backup.')
    }

    for (const table of TABLES) await salvageTable(local, remote, table, result)
    await salvageCounters(local, remote, result)

    log.info(
      `[salvage] manual recovery done — ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed`
    )
    for (const d of result.details.slice(0, 50)) log.info(`[salvage]   ${d}`)
  } finally {
    local?.close()
    remote?.close()
  }
  return result
}

export async function salvageOfflineReplica(): Promise<SalvageResult> {
  const result: SalvageResult = { attempted: false, inserted: 0, updated: 0, failed: 0, details: [] }

  const oldFile = join(app.getPath('userData'), 'krishna-replica-lf.db')
  if (!existsSync(oldFile)) {
    // Nothing left to salvage — clear a stale marker if one remains.
    if (existsSync(markerOf(oldFile))) rmSync(markerOf(oldFile), { force: true })
    return result
  }
  // Already merged on a previous launch; only the locked file rename remains.
  if (existsSync(markerOf(oldFile))) {
    if (await retireFile(oldFile)) rmSync(markerOf(oldFile), { force: true })
    return result
  }
  if (!config.tursoUrl) {
    log.warn('[salvage] old offline replica present but no TURSO_DATABASE_URL — will retry next launch')
    return result
  }

  result.attempted = true
  log.info('[salvage] old offline replica found — copying stranded records to the primary')

  let local: Client | null = null
  let remote: Client | null = null
  try {
    local = createClient({ url: `file:${oldFile}`, intMode: 'number' })
    remote = createClient({
      url: config.tursoUrl,
      authToken: config.tursoToken || undefined,
      intMode: 'number'
    })
    // Prove the network is up before deciding anything.
    await remote.execute('SELECT 1')

    for (const table of TABLES) await salvageTable(local, remote, table, result)
    await salvageCounters(local, remote, result)

    log.info(
      `[salvage] done — ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed`
    )
    for (const d of result.details.slice(0, 50)) log.info(`[salvage]   ${d}`)

    // Release the SQLite handle BEFORE renaming — Windows refuses (EBUSY) to
    // rename a file that is still open.
    local.close()
    local = null

    // Only retire the old file when nothing failed; otherwise keep it so the
    // next launch retries the remainder (upserts make that safe). The marker
    // records that the merge itself is complete, so even if the rename stays
    // locked until a later launch, the data is never merged twice.
    if (result.failed === 0) {
      writeFileSync(markerOf(oldFile), new Date().toISOString())
      if (await retireFile(oldFile)) rmSync(markerOf(oldFile), { force: true })
    } else {
      log.warn('[salvage] failures above — keeping the old replica to retry next launch')
    }
  } catch (err: any) {
    log.warn(`[salvage] could not reach the primary (${err?.message ?? err}) — will retry next launch`)
  } finally {
    local?.close()
    remote?.close()
  }
  return result
}
