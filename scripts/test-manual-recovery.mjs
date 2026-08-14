/**
 * Verifies manual backup recovery: a RENAMED backup file (what the automatic
 * salvage skips) is merged correctly, a non-app file is rejected, and re-running
 * changes nothing.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync, renameSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'mrec-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const mk = async (file) => {
  const db = createClient({ url: `file:${join(outdir, file)}`, intMode: 'number' })
  await db.execute('PRAGMA foreign_keys = ON')
  for (const m of MIGRATIONS) await db.executeMultiple(m.sql)
  return db
}
let backup = await mk('backup.db')
const remote = await mk('primary.db')

const now = '2026-08-13T00:00:00.000Z', later = '2026-08-13T18:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), model = uid()
for (const db of [backup, remote]) {
  await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
  await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S2', 'S2', now, now] })
  await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'VIVO', now, now] })
  await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [model, co, brand, 'Y29', 'VIVO-Y29', 'Smartphone', now, now] })
}
// Offline-only work in the backup: 12 stock units the cloud never saw.
const unitIds = []
for (let i = 0; i < 12; i++) {
  const id = uid(); unitIds.push(id)
  await backup.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [id, co, model, shop, 500, later, later] })
}
backup.close()

// Rename it the way the app does — this is the file the automatic salvage skips.
// Windows releases the SQLite handle lazily after close(), so retry briefly.
const renamed = join(outdir, 'krishna-replica-lf.db.salvaged-2026-08-13T13-25-45-339Z')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let attempt = 0; attempt < 10; attempt++) {
  try {
    renameSync(join(outdir, 'backup.db'), renamed)
    break
  } catch {
    await sleep(300)
  }
}

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }
const n = async (db, sql, args = []) => (await db.execute({ sql, args })).rows[0].n

chk(existsSync(renamed), 'renamed backup file exists')
chk((await n(remote, `SELECT COUNT(*) n FROM stock_units`)) === 0, 'cloud starts with 0 stock units')

// --- the merge (identical logic to mergeBackupIntoPrimary) ---
const TABLES = [
  { name: 'brands', u: 'updated_at' }, { name: 'models', u: 'updated_at' },
  { name: 'customers', u: 'updated_at' }, { name: 'suppliers', u: 'updated_at' },
  { name: 'purchases', u: 'updated_at' }, { name: 'purchase_items' },
  { name: 'stock_units', u: 'updated_at' }, { name: 'sales', u: 'updated_at' },
  { name: 'sale_items' }, { name: 'payments' }, { name: 'audit_log' }
]
async function merge(file) {
  const local = createClient({ url: `file:${file}`, intMode: 'number' })
  // Guard: must look like our database.
  const looksOurs = (await local.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stock_units'")).rows.length > 0
  if (!looksOurs) { local.close(); throw new Error('This file does not look like a Krishna Mobile database backup.') }
  const res = { inserted: 0, updated: 0, failed: 0 }
  for (const t of TABLES) {
    const cols = (await local.execute(`SELECT name FROM pragma_table_info('${t.name}')`)).rows.map((r) => r.name)
    if (!cols.includes('id')) continue
    const rmap = new Map((await remote.execute(`SELECT id${t.u ? `, ${t.u}` : ''} FROM ${t.name}`)).rows.map((r) => [String(r.id), t.u ? String(r[t.u] ?? '') : null]))
    const upsert = `INSERT INTO ${t.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}`
    for (const row of (await local.execute(`SELECT ${cols.join(',')} FROM ${t.name}`)).rows) {
      const ru = rmap.get(String(row.id))
      const missing = ru === undefined
      const newer = !missing && t.u && String(row[t.u] ?? '') > String(ru ?? '')
      if (!missing && !newer) continue
      try {
        await remote.execute({ sql: upsert, args: cols.map((c) => row[c] ?? null) })
        missing ? res.inserted++ : res.updated++
      } catch { res.failed++ }
    }
  }
  local.close()
  return res
}

const sizeBefore = statSync(renamed).size
const r1 = await merge(renamed)
chk(r1.inserted === 12 && r1.failed === 0, `12 offline stock units recovered from the RENAMED file (inserted=${r1.inserted}, failed=${r1.failed})`)
chk((await n(remote, `SELECT COUNT(*) n FROM stock_units`)) === 12, 'cloud now has all 12 units')
chk((await n(remote, `SELECT COUNT(*) n FROM stock_units WHERE current_shop_id=? AND status='in_stock'`, [shop])) === 12, 'they are in stock at the right shop')
chk((await remote.execute('PRAGMA foreign_key_check')).rows.length === 0, 'no foreign key violations')
chk(statSync(renamed).size === sizeBefore, 'the backup file was NOT modified')

// Re-running must be a no-op.
const r2 = await merge(renamed)
chk(r2.inserted === 0 && r2.updated === 0 && r2.failed === 0, 'second run recovers nothing (safe to re-run)')
chk((await n(remote, `SELECT COUNT(*) n FROM stock_units`)) === 12, 'still exactly 12 units — no duplicates')

// A wrong file must be rejected, not half-merged.
const junk = await mk('junk.db')
await junk.execute('CREATE TABLE unrelated (id TEXT)')
await junk.execute('DROP TABLE stock_units')
junk.close()
let rejected = false
try { await merge(join(outdir, 'junk.db')) } catch (e) { rejected = /does not look like/.test(e.message) }
chk(rejected, 'a file that is not an app database is rejected with a clear message')

console.log(`\n${fails === 0 ? 'ALL MANUAL RECOVERY CHECKS PASSED' : fails + ' FAILED'}`)
remote.close()
process.exit(fails === 0 ? 0 : 1)
