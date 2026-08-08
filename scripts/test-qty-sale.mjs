/**
 * Verifies the "sell by quantity" stock consumption + oversell guard using the
 * exact FIFO selection query from createSale, against a throwaway DB.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'qty-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'q.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-08T00:00:00.000Z'
const companyId = randomUUID(), shopId = randomUUID(), brandId = randomUUID(), modelId = randomUUID()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [companyId, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shopId, companyId, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brandId, companyId, 'Boat', now, now] })
// A non-IMEI accessory model (track_imei = 0).
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,low_stock_alert,default_price,gst_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?,?,?)`, args: [modelId, companyId, brandId, 'Charger 25W', 'CHG25', 'Accessory', 2, 250, 18, now, now] })

// 8 chargers in stock, added at increasing times so FIFO order is deterministic.
const unitIds = []
for (let i = 0; i < 8; i++) {
  const id = randomUUID()
  unitIds.push(id)
  await db.execute({
    sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [id, companyId, modelId, 'in_stock', shopId, 150, 250, `2026-08-0${i + 1}T00:00:00.000Z`, now]
  })
}

let failures = 0
const assert = (c, m) => { if (c) console.log(`OK   ${m}`); else { failures++; console.error(`FAIL ${m}`) } }

async function availableModelsCount() {
  const r = await db.execute({
    sql: `SELECT COUNT(su.id) AS n FROM models m
            JOIN stock_units su ON su.model_id=m.id AND su.status='in_stock' AND su.current_shop_id=?
           WHERE m.company_id=? AND m.is_active=1 AND m.track_imei=0 GROUP BY m.id`,
    args: [shopId, companyId]
  })
  return r.rows[0]?.n ?? 0
}

assert((await availableModelsCount()) === 8, 'availableModels shows 8 chargers')

// --- Simulate selling qty 5 via the exact FIFO query in createSale ---
async function sellQty(qty) {
  const avail = (await db.execute({
    sql: `SELECT id, cost_price FROM stock_units WHERE company_id=? AND model_id=? AND current_shop_id=? AND status='in_stock' ORDER BY added_at LIMIT ?`,
    args: [companyId, modelId, shopId, qty]
  })).rows
  if (avail.length < qty) return { ok: false, avail: avail.length }
  const saleId = randomUUID()
  for (const u of avail) {
    await db.execute({ sql: `UPDATE stock_units SET status='sold', sale_id=?, sold_at=? WHERE id=?`, args: [saleId, now, u.id] })
  }
  return { ok: true, consumed: avail.map((u) => u.id), cost: avail.reduce((a, u) => a + u.cost_price, 0) }
}

const sale1 = await sellQty(5)
assert(sale1.ok, 'sell 5 chargers succeeds (5 <= 8)')
assert(JSON.stringify(sale1.consumed) === JSON.stringify(unitIds.slice(0, 5)), 'FIFO: consumed the 5 oldest units')
assert(sale1.cost === 750, `line cost = 5 x 150 = 750 (${sale1.cost})`)
assert((await availableModelsCount()) === 3, 'stock drops to 3 after selling 5')

// --- Oversell guard: try to sell 5 when only 3 remain ---
const sale2 = await sellQty(5)
assert(!sale2.ok && sale2.avail === 3, 'selling 5 is refused when only 3 remain (no oversell)')
assert((await availableModelsCount()) === 3, 'stock unchanged after the refused oversell')

// Selling exactly the remaining 3 works.
const sale3 = await sellQty(3)
assert(sale3.ok, 'selling the remaining 3 succeeds')
assert((await availableModelsCount()) === 0, 'stock now 0')

console.log(`\n${failures === 0 ? 'ALL QUANTITY-SALE CHECKS PASSED' : failures + ' FAILED'}`)
db.close()
process.exit(failures === 0 ? 0 : 1)
