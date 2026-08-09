/**
 * Verifies deleteSale / deletePurchase logic against a throwaway DB:
 *  - deleting a sale returns its units to stock and cascade-removes items+payments
 *  - deleting a purchase is blocked while a unit is sold, and once clear it
 *    removes the units and cascade-removes items+payments
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'del-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'd.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-09T00:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), model = uid(), purchase = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'Oppo', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [model, co, brand, 'A5', 'A5', 'Smartphone', now, now] })
// A purchase that created 3 units.
await db.execute({ sql: `INSERT INTO purchases (id,company_id,shop_id,invoice_no,purchase_date,total,paid_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, args: [purchase, co, shop, 'P1', '2026-08-01', 30000, 30000, now, now] })
const pItem = uid()
await db.execute({ sql: `INSERT INTO purchase_items (id,purchase_id,model_id,qty,unit_cost,line_total) VALUES (?,?,?,?,?,?)`, args: [pItem, purchase, model, 3, 10000, 30000] })
await db.execute({ sql: `INSERT INTO payments (id,company_id,direction,party_type,purchase_id,amount,payment_date,created_at) VALUES (?,?,'out','supplier',?,?,?,?)`, args: [uid(), co, purchase, 30000, now, now] })
const units = []
for (let i = 0; i < 3; i++) {
  const id = uid(); units.push(id)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,sale_price,purchase_id,purchase_item_id,added_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, args: [id, co, model, 'in_stock', shop, 10000, 12000, purchase, pItem, now, now] })
}

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }
const count = async (sql, args = []) => (await db.execute({ sql, args })).rows[0].n

// ---- SALE: sell 2 of the 3 units ----
const sale = uid(), si1 = uid(), si2 = uid()
await db.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,total,paid_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, args: [sale, co, shop, 'INV1', '2026-08-05', 24000, 24000, now, now] })
for (const [siId, u] of [[si1, units[0]], [si2, units[1]]]) {
  await db.execute({ sql: `INSERT INTO sale_items (id,sale_id,stock_unit_id,model_id,line_type,qty,unit_price,line_total,cost_price,profit) VALUES (?,?,?,?, 'product',1,12000,12000,10000,2000)`, args: [siId, sale, u, model] })
  await db.execute({ sql: `UPDATE stock_units SET status='sold', sale_id=?, sale_item_id=?, sold_at=? WHERE id=?`, args: [sale, siId, now, u] })
}
await db.execute({ sql: `INSERT INTO payments (id,company_id,direction,party_type,sale_id,amount,payment_date,created_at) VALUES (?,?,'in','customer',?,?,?,?)`, args: [uid(), co, sale, 24000, now, now] })

chk((await count(`SELECT COUNT(*) n FROM sale_items WHERE sale_id=?`, [sale])) === 2, 'sale has 2 items')
chk((await count(`SELECT COUNT(*) n FROM payments WHERE sale_id=?`, [sale])) === 1, 'sale has 1 payment')
chk((await count(`SELECT COUNT(*) n FROM stock_units WHERE status='in_stock' AND current_shop_id=?`, [shop])) === 1, '1 unit still in stock after sale')

// deleteSale logic
await db.execute({ sql: `UPDATE stock_units SET status='in_stock', sale_id=NULL, sale_item_id=NULL, sold_at=NULL, updated_at=? WHERE sale_id=?`, args: [now, sale] })
await db.execute({ sql: `DELETE FROM sales WHERE id=?`, args: [sale] })

chk((await count(`SELECT COUNT(*) n FROM sales WHERE id=?`, [sale])) === 0, 'sale row deleted')
chk((await count(`SELECT COUNT(*) n FROM sale_items WHERE sale_id=?`, [sale])) === 0, 'sale_items cascade-deleted')
chk((await count(`SELECT COUNT(*) n FROM payments WHERE sale_id=?`, [sale])) === 0, 'sale payment cascade-deleted')
chk((await count(`SELECT COUNT(*) n FROM stock_units WHERE status='in_stock'`)) === 3, 'all 3 units back in stock after sale delete')

// ---- PURCHASE delete guard: block while a unit is sold ----
await db.execute({ sql: `UPDATE stock_units SET status='sold' WHERE id=?`, args: [units[0]] })
const blocked = await count(
  `SELECT COUNT(*) n FROM stock_units su WHERE su.purchase_id=? AND (su.status<>'in_stock'
     OR EXISTS (SELECT 1 FROM sale_items si WHERE si.stock_unit_id=su.id)
     OR EXISTS (SELECT 1 FROM transfer_items ti WHERE ti.stock_unit_id=su.id))`, [purchase])
chk(blocked > 0, `purchase delete is blocked while a unit is sold (blocked=${blocked})`)
// restore
await db.execute({ sql: `UPDATE stock_units SET status='in_stock' WHERE id=?`, args: [units[0]] })
const blocked2 = await count(
  `SELECT COUNT(*) n FROM stock_units su WHERE su.purchase_id=? AND (su.status<>'in_stock'
     OR EXISTS (SELECT 1 FROM sale_items si WHERE si.stock_unit_id=su.id)
     OR EXISTS (SELECT 1 FROM transfer_items ti WHERE ti.stock_unit_id=su.id))`, [purchase])
chk(blocked2 === 0, 'purchase delete allowed once all units are back in stock')

// deletePurchase logic
await db.execute({ sql: `DELETE FROM stock_units WHERE purchase_id=?`, args: [purchase] })
await db.execute({ sql: `DELETE FROM purchases WHERE id=?`, args: [purchase] })
chk((await count(`SELECT COUNT(*) n FROM purchases WHERE id=?`, [purchase])) === 0, 'purchase row deleted')
chk((await count(`SELECT COUNT(*) n FROM purchase_items WHERE purchase_id=?`, [purchase])) === 0, 'purchase_items cascade-deleted')
chk((await count(`SELECT COUNT(*) n FROM payments WHERE purchase_id=?`, [purchase])) === 0, 'purchase payment cascade-deleted')
chk((await count(`SELECT COUNT(*) n FROM stock_units WHERE purchase_id=?`, [purchase])) === 0, 'purchase units removed')

console.log(`\n${fails === 0 ? 'ALL DELETE CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
