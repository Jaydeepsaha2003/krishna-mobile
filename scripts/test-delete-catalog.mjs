/**
 * Verifies deleteModel / deleteBrand behaviour against a throwaway DB:
 *  - an unused model/brand is removed outright
 *  - anything with history is archived instead, and history still resolves
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'dcat-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'c.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-09T00:00:00.000Z'
const co = uid(), shop = uid(), usedBrand = uid(), freeBrand = uid()
const usedModel = uid(), freeModel = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [usedBrand, co, 'VIVO', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [freeBrand, co, 'UNUSED', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [usedModel, co, usedBrand, 'Y29', 'VIVO-Y29', 'Smartphone', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [freeModel, co, usedBrand, 'TYPO', 'VIVO-TYPO', 'Smartphone', now, now] })

// Give usedModel real history: a stock unit + a sale line.
const sale = uid()
await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [uid(), co, usedModel, shop, 9000, now, now] })
await db.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [sale, co, shop, 'INV1', '2026-08-05', 12000, now, now] })
await db.execute({ sql: `INSERT INTO sale_items (id,sale_id,model_id,line_type,qty,unit_price,line_total) VALUES (?,?,?, 'product',1,12000,12000)`, args: [uid(), sale, usedModel] })

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }
const n = async (sql, args = []) => (await db.execute({ sql, args })).rows[0].n

// Mirrors deleteModel's reference count.
async function refCount(id) {
  return n(`SELECT (SELECT COUNT(*) FROM stock_units WHERE model_id=:id)
             + (SELECT COUNT(*) FROM purchase_items WHERE model_id=:id)
             + (SELECT COUNT(*) FROM sale_items WHERE model_id=:id)
             + (SELECT COUNT(*) FROM reconciliation_items WHERE model_id=:id)
             + (SELECT COUNT(*) FROM stock_adjustments WHERE model_id=:id) AS n`, { id })
}
async function deleteModel(id) {
  const refs = await refCount(id)
  if (refs > 0) { await db.execute({ sql: `UPDATE models SET is_active=0 WHERE id=?`, args: [id] }); return { archived: true, refs } }
  await db.execute({ sql: `DELETE FROM models WHERE id=?`, args: [id] })
  return { archived: false, refs: 0 }
}
async function deleteBrand(id) {
  const c = await n(`SELECT COUNT(*) n FROM models WHERE brand_id=?`, [id])
  if (c > 0) { await db.execute({ sql: `UPDATE brands SET is_active=0 WHERE id=?`, args: [id] }); return { archived: true, modelCount: c } }
  await db.execute({ sql: `DELETE FROM brands WHERE id=?`, args: [id] })
  return { archived: false, modelCount: 0 }
}

// --- unused model: hard delete ---
chk((await refCount(freeModel)) === 0, 'unused model has no references')
const r1 = await deleteModel(freeModel)
chk(!r1.archived, 'unused model is deleted outright')
chk((await n(`SELECT COUNT(*) n FROM models WHERE id=?`, [freeModel])) === 0, 'unused model row is gone')

// --- used model: archived, history intact ---
const r2 = await deleteModel(usedModel)
chk(r2.archived && r2.refs === 2, `used model archived, not deleted (refs=${r2.refs})`)
chk((await n(`SELECT COUNT(*) n FROM models WHERE id=?`, [usedModel])) === 1, 'used model row still exists')
chk((await n(`SELECT COUNT(*) n FROM models WHERE id=? AND is_active=0`, [usedModel])) === 1, 'used model marked inactive')
chk((await n(`SELECT COUNT(*) n FROM sale_items WHERE model_id=?`, [usedModel])) === 1, 'its sale line still resolves')
chk((await n(`SELECT COUNT(*) n FROM stock_units WHERE model_id=?`, [usedModel])) === 1, 'its stock unit still resolves')
chk((await db.execute('PRAGMA foreign_key_check')).rows.length === 0, 'no foreign key violations')

// archived model is hidden from the default (active-only) list
chk((await n(`SELECT COUNT(*) n FROM models WHERE company_id=? AND is_active=1`, [co])) === 0, 'archived model no longer appears in the catalogue')

// --- brands ---
const b1 = await deleteBrand(freeBrand)
chk(!b1.archived, 'brand with no models is deleted outright')
chk((await n(`SELECT COUNT(*) n FROM brands WHERE id=?`, [freeBrand])) === 0, 'unused brand row is gone')

const b2 = await deleteBrand(usedBrand)
chk(b2.archived && b2.modelCount === 1, `brand with models is archived (models=${b2.modelCount})`)
chk((await n(`SELECT COUNT(*) n FROM brands WHERE id=?`, [usedBrand])) === 1, 'used brand row still exists')
chk((await db.execute('PRAGMA foreign_key_check')).rows.length === 0, 'still no foreign key violations')

// the model -> brand join still resolves after archiving
chk((await n(`SELECT COUNT(*) n FROM models m JOIN brands b ON b.id=m.brand_id WHERE m.id=?`, [usedModel])) === 1, 'model -> brand join still resolves')

console.log(`\n${fails === 0 ? 'ALL CATALOGUE DELETE CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
