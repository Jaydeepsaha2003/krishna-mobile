/**
 * Verifies migration V5 (GST defaults to 0) on a throwaway DB:
 *  - V1..V4 apply, seed models (18 default + an explicit 12) and dependent rows
 *  - V5 rebuilds models: default becomes 0, old 18 rows reset, 12 preserved
 *  - ids/rows preserved and every foreign-key reference still resolves
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'v5-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'v5.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
const apply = async (v) => db.executeMultiple(MIGRATIONS.find((m) => m.version === v).sql)
for (const v of [1, 2, 3, 4]) await apply(v)

const now = '2026-08-09T00:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), mDefault = uid(), m12 = uid(), sup = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'VIVO', now, now] })
// One model taking the OLD default (18), one with an explicit 12%.
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [mDefault, co, brand, 'Y29', 'VIVO-Y29', 'Smartphone', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,gst_rate,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, args: [m12, co, brand, 'T3X', 'VIVO-T3X', 'Smartphone', 12, now, now] })

const pre = (await db.execute({ sql: `SELECT gst_rate FROM models WHERE id=?`, args: [mDefault] })).rows[0].gst_rate
// Dependent rows that must survive the table rebuild.
const unit = uid(), purchase = uid(), sale = uid()
await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [unit, co, mDefault, shop, 9000, now, now] })
await db.execute({ sql: `INSERT INTO purchases (id,company_id,shop_id,invoice_no,purchase_date,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [purchase, co, shop, 'P1', '2026-08-01', 9000, now, now] })
await db.execute({ sql: `INSERT INTO purchase_items (id,purchase_id,model_id,qty,unit_cost,line_total) VALUES (?,?,?,1,9000,9000)`, args: [uid(), purchase, mDefault] })
await db.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [sale, co, shop, 'INV1', '2026-08-05', 12000, now, now] })
await db.execute({ sql: `INSERT INTO sale_items (id,sale_id,model_id,line_type,qty,unit_price,line_total) VALUES (?,?,?, 'product',1,12000,12000)`, args: [uid(), sale, mDefault] })
await db.execute({ sql: `INSERT INTO suppliers (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [sup, co, 'Sup', now, now] })

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }
chk(pre === 18, `before V5: a new model inherited the old 18% default (${pre})`)

await apply(5)
console.log('applied V5')

const after = async (id) => (await db.execute({ sql: `SELECT gst_rate FROM models WHERE id=?`, args: [id] })).rows[0]?.gst_rate
chk((await after(mDefault)) === 0, `old 18% model reset to 0 (${await after(mDefault)})`)
chk((await after(m12)) === 12, `explicit 12% preserved (${await after(m12)})`)

// New inserts now default to 0.
const fresh = uid()
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [fresh, co, brand, 'NEW', 'VIVO-NEW', 'Smartphone', now, now] })
chk((await after(fresh)) === 0, `new model defaults to 0% (${await after(fresh)})`)

// Rows + references intact.
const n = async (sql, args = []) => (await db.execute({ sql, args })).rows[0].n
chk((await n(`SELECT COUNT(*) n FROM models`)) === 3, 'all model rows preserved')
chk((await n(`SELECT COUNT(*) n FROM stock_units WHERE model_id=?`, [mDefault])) === 1, 'stock_unit still references its model')
chk((await n(`SELECT COUNT(*) n FROM purchase_items WHERE model_id=?`, [mDefault])) === 1, 'purchase_item reference intact')
chk((await n(`SELECT COUNT(*) n FROM sale_items WHERE model_id=?`, [mDefault])) === 1, 'sale_item reference intact')

// Joins still resolve (no orphaned ids after the rebuild).
chk((await n(`SELECT COUNT(*) n FROM stock_units su JOIN models m ON m.id=su.model_id JOIN brands b ON b.id=m.brand_id`)) === 1, 'stock -> model -> brand join resolves')

// Indexes recreated, and foreign keys are back ON.
const idx = (await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='models'`)).rows.map((r) => r.name)
chk(idx.includes('ux_models_company_sku') && idx.includes('ix_models_brand'), 'model indexes recreated')
const fk = (await db.execute('PRAGMA foreign_keys')).rows[0]
chk(Object.values(fk)[0] === 1, 'foreign_keys re-enabled after the rebuild')
const violations = (await db.execute('PRAGMA foreign_key_check')).rows.length
chk(violations === 0, `no foreign key violations (${violations})`)

// Unique SKU guard still enforced.
let dup = false
try { await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [uid(), co, brand, 'X', 'VIVO-NEW', 'Smartphone', now, now] }) } catch { dup = true }
chk(dup, 'duplicate SKU still rejected after rebuild')

console.log(`\n${fails === 0 ? 'ALL V5 CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
