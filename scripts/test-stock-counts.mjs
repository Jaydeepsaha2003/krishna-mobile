/**
 * Verifies the Stock "by model" count drops correctly after a sale, after a
 * repair part is consumed, and after an adjustment — using the EXACT grouped
 * summary SQL from inventory.ts against a throwaway local DB.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'stk-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 's.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-08T00:00:00.000Z'
const companyId = randomUUID(), shopId = randomUUID(), brandId = randomUUID(), modelId = randomUUID()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [companyId, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shopId, companyId, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brandId, companyId, 'Oppo', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,low_stock_alert,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, args: [modelId, companyId, brandId, 'A5X', 'A5X', 'Smartphone', 2, now, now] })

const units = []
for (let i = 0; i < 5; i++) {
  const id = randomUUID()
  units.push(id)
  await db.execute({
    sql: `INSERT INTO stock_units (id,company_id,model_id,imei1,status,current_shop_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [id, companyId, modelId, `35000000000000${i}`, 'in_stock', shopId, 10000, 12000, now, now]
  })
}

// The exact grouped-summary count from inventory.ts stockSummary().
async function inStockQty() {
  const r = await db.execute({
    sql: `SELECT COUNT(su.id) AS qty FROM models m JOIN brands b ON b.id = m.brand_id
            LEFT JOIN stock_units su ON su.model_id = m.id AND su.status = 'in_stock'
              AND (? = '' OR su.current_shop_id = ?)
           WHERE m.company_id = ? AND m.is_active = 1 GROUP BY m.id`,
    args: [shopId, shopId, companyId]
  })
  return r.rows[0]?.qty ?? 0
}
// The units-list total (listStock) also filters status = 'in_stock'.
async function listTotal() {
  const r = await db.execute({
    sql: `SELECT COUNT(*) n FROM stock_units su JOIN models m ON m.id = su.model_id
           WHERE su.company_id = ? AND su.current_shop_id = ? AND su.status = 'in_stock'`,
    args: [companyId, shopId]
  })
  return r.rows[0].n
}

let failures = 0
const chk = async (label, expected) => {
  const [q, t] = [await inStockQty(), await listTotal()]
  const ok = q === expected && t === expected
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(34)} grouped=${q} list=${t} (expected ${expected})`)
}

await chk('start: 5 units in stock', 5)

// A sale marks the unit sold (createSale).
await db.execute({ sql: `UPDATE stock_units SET status='sold', sold_at=? WHERE id=?`, args: [now, units[0]] })
await chk('after 1 sale', 4)

// A repair consuming a part marks it sold the same way.
await db.execute({ sql: `UPDATE stock_units SET status='sold', sold_at=? WHERE id=?`, args: [now, units[1]] })
await chk('after 1 repair part used', 3)

// An adjustment moves a unit out of 'in_stock'.
await db.execute({ sql: `UPDATE stock_units SET status='damaged' WHERE id=?`, args: [units[2]] })
await chk('after 1 damaged adjustment', 2)

// A cancelled sale returns the unit to stock.
await db.execute({ sql: `UPDATE stock_units SET status='in_stock', sold_at=NULL WHERE id=?`, args: [units[0]] })
await chk('after sale cancelled (unit returns)', 3)

console.log(`\n${failures === 0 ? 'ALL COUNTS CORRECT' : failures + ' FAILED'}`)
db.close()
process.exit(failures === 0 ? 0 : 1)
