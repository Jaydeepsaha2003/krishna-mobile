/**
 * Verifies migration V4 (service sales) on a throwaway local DB:
 *  - V1..V3 apply, seed a product sale + item (old schema, model_id NOT NULL)
 *  - V4 applies: sale_items is rebuilt, existing rows preserved as 'product'
 *  - a service line (model_id NULL) can now be inserted
 *  - sales.sale_type / service_title / service_details exist
 *  - service_catalog exists and accepts rows
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'mig-'))
const outfile = join(outdir, 'schema.mjs')
await build({
  entryPoints: ['src/main/db/schema.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent'
})
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

let failures = 0
const oks = []
function assert(cond, msg) {
  if (cond) oks.push(msg)
  else {
    failures++
    console.error(`  FAIL ${msg}`)
  }
}

const db = createClient({ url: `file:${join(outdir, 't.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')

const now = '2026-08-08T00:00:00.000Z'
async function apply(v) {
  const m = MIGRATIONS.find((x) => x.version === v)
  await db.executeMultiple(m.sql)
}

// V1..V3
await apply(1)
await apply(2)
await apply(3)
console.log('applied V1-V3')

// Seed a product sale + item on the OLD schema (model_id NOT NULL).
const companyId = randomUUID(), shopId = randomUUID(), brandId = randomUUID(), modelId = randomUUID()
const saleId = randomUUID(), itemId = randomUUID()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [companyId, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shopId, companyId, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brandId, companyId, 'Apple', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [modelId, companyId, brandId, 'iPhone', 'SKU1', 'Smartphone', now, now] })
await db.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [saleId, companyId, shopId, 'INV1', '2026-08-01', 1000, now, now] })
await db.execute({ sql: `INSERT INTO sale_items (id,sale_id,model_id,description,qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?)`, args: [itemId, saleId, modelId, 'iPhone', 1, 1000, 1000] })
console.log('seeded 1 product sale + item on old schema')

// V4 — the rebuild.
await apply(4)
console.log('applied V4')

// Existing item preserved, defaulted to line_type 'product', model_id intact.
const kept = (await db.execute('SELECT * FROM sale_items WHERE id = ?', [itemId])).rows[0]
assert(!!kept, 'existing sale_item survived the rebuild')
assert(kept?.model_id === modelId, 'model_id preserved on the rebuilt row')
assert(kept?.line_type === 'product', `existing row defaulted to line_type=product (${kept?.line_type})`)

// A service line (no model) can now be inserted — the whole point.
let serviceOk = true
try {
  await db.execute({
    sql: `INSERT INTO sale_items (id,sale_id,model_id,line_type,description,qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?,?)`,
    args: [randomUUID(), saleId, null, 'service', 'Repair labour', 1, 500, 500]
  })
} catch (e) {
  serviceOk = false
  console.error('   service insert error:', e.message)
}
assert(serviceOk, 'service line with NULL model_id inserts successfully')

// sales columns
const s = (await db.execute('SELECT sale_type, service_title, service_details FROM sales WHERE id = ?', [saleId])).rows[0]
assert(s?.sale_type === 'product', `sales.sale_type defaults to product (${s?.sale_type})`)
assert('service_title' in s && 'service_details' in s, 'sales has service_title + service_details')

// service_catalog
let catOk = true
try {
  await db.execute({
    sql: `INSERT INTO service_catalog (id,company_id,kind,name,default_price,gst_rate,is_active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,1,0,?,?)`,
    args: [randomUUID(), companyId, 'repair', 'Screen replace', 1500, 0, now, now]
  })
} catch (e) {
  catOk = false
  console.error('   catalog insert error:', e.message)
}
assert(catOk, 'service_catalog accepts a row')

// indexes present
const idx = (await db.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sale_items'")).rows.map((r) => r.name)
assert(idx.includes('ix_sale_items_sale'), 'ix_sale_items_sale recreated')
assert(idx.includes('ix_sale_items_model'), 'ix_sale_items_model recreated')

// cascade still works (delete sale removes items)
await db.execute('DELETE FROM sales WHERE id = ?', [saleId])
const remaining = (await db.execute('SELECT COUNT(*) n FROM sale_items WHERE sale_id = ?', [saleId])).rows[0].n
assert(remaining === 0, `ON DELETE CASCADE still works after rebuild (${remaining} left)`)

console.log(`\n${oks.length} checks passed, ${failures} failed`)
db.close()
process.exit(failures === 0 ? 0 : 1)
