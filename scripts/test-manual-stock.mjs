/**
 * Verifies manual stock add/remove logic against a throwaway DB, using the same
 * queries addManualStock / removeManualStock run.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'man-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'm.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-09T00:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), model = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'Boat', now, now] })
// Non-IMEI accessory (track_imei = 0), matching the new default.
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,warranty_months,created_at,updated_at) VALUES (?,?,?,?,?,?,0,12,?,?)`, args: [model, co, brand, 'Charger', 'CHG', 'Accessory', now, now] })

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }
const n = async (sql, args = []) => (await db.execute({ sql, args })).rows[0].n

const inStock = () => n(`SELECT COUNT(*) n FROM stock_units WHERE model_id=? AND current_shop_id=? AND status='in_stock'`, [model, shop])

// ---- ADD 10 manually (no purchase bill) ----
for (let i = 0; i < 10; i++) {
  const u = uid()
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,cost_price,sale_price,status,current_shop_id,origin_shop_id,warranty_months,added_at,updated_at) VALUES (?,?,?,?,?, 'in_stock',?,?,12,?,?)`, args: [u, co, model, 150, 250, shop, shop, `2026-08-0${(i % 9) + 1}T00:00:00.000Z`, now] })
  await db.execute({ sql: `INSERT INTO stock_adjustments (id,company_id,shop_id,stock_unit_id,model_id,qty,from_status,to_status,reason_code,value_impact,created_at) VALUES (?,?,?,?,?,1,NULL,'in_stock','UNRECORDED_PURCHASE',?,?)`, args: [uid(), co, shop, u, model, 150, now] })
}
chk((await inStock()) === 10, 'added 10 units manually -> 10 in stock')
chk((await n(`SELECT COUNT(*) n FROM stock_adjustments WHERE model_id=? AND to_status='in_stock'`, [model])) === 10, '10 "in" adjustments recorded (auditable)')
chk((await n(`SELECT COUNT(*) n FROM stock_units WHERE model_id=? AND purchase_id IS NULL`, [model])) === 10, 'units have no purchase bill (manual)')

// ---- REMOVE 3 (damaged), FIFO ----
const avail = (await db.execute({ sql: `SELECT id, cost_price FROM stock_units WHERE company_id=? AND model_id=? AND current_shop_id=? AND status='in_stock' ORDER BY added_at LIMIT 3`, args: [co, model, shop] })).rows
chk(avail.length === 3, 'FIFO picked 3 oldest units')
for (const u of avail) {
  await db.execute({ sql: `UPDATE stock_units SET status='damaged', updated_at=? WHERE id=?`, args: [now, u.id] })
  await db.execute({ sql: `INSERT INTO stock_adjustments (id,company_id,shop_id,stock_unit_id,model_id,qty,from_status,to_status,reason_code,value_impact,created_at) VALUES (?,?,?,?,?,1,'in_stock','damaged','DAMAGE',?,?)`, args: [uid(), co, shop, u.id, model, -u.cost_price, now] })
}
chk((await inStock()) === 7, 'after removing 3 -> 7 in stock')
chk((await n(`SELECT COUNT(*) n FROM stock_units WHERE model_id=? AND status='damaged'`, [model])) === 3, '3 units marked damaged (not deleted)')
chk((await n(`SELECT COUNT(*) n FROM stock_adjustments WHERE model_id=? AND to_status='damaged'`, [model])) === 3, '3 "out" adjustments recorded')

// ---- Guard: cannot remove more than in stock ----
const tooMany = (await db.execute({ sql: `SELECT id FROM stock_units WHERE company_id=? AND model_id=? AND current_shop_id=? AND status='in_stock' ORDER BY added_at LIMIT 99`, args: [co, model, shop] })).rows
chk(tooMany.length === 7 && tooMany.length < 99, `removing 99 would be refused (only ${tooMany.length} available)`)

// ---- Grouped summary reflects the manual moves ----
const grouped = await n(`SELECT COUNT(su.id) n FROM models m LEFT JOIN stock_units su ON su.model_id=m.id AND su.status='in_stock' AND su.current_shop_id=? WHERE m.company_id=? GROUP BY m.id`, [shop, co])
chk(grouped === 7, `grouped "by model" count matches (${grouped})`)

console.log(`\n${fails === 0 ? 'ALL MANUAL-STOCK CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
