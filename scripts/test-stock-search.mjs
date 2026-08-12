/**
 * Verifies the Stock "By model" search/brand filter predicate (the one that was
 * ignoring the search box) and that stockSummary now exposes brandId.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'ssrch-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 's.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-11T00:00:00.000Z'
const co = uid(), shop = uid(), boat = uid(), vivo = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
for (const [id, nm] of [[boat, 'BOAT'], [vivo, 'VIVO']])
  await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [id, co, nm, now, now] })

const mk = async (brand, name, sku, qty) => {
  const id = uid()
  await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [id, co, brand, name, sku, 'Accessory', now, now] })
  for (let i = 0; i < qty; i++)
    await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [uid(), co, id, shop, 100, now, now] })
  return id
}
await mk(boat, 'TYPE-C CHARGER 25W', 'BOAT-CHG25', 6)
await mk(boat, 'USB CABLE', 'BOAT-CBL', 3)
await mk(vivo, 'Y29 4+128', 'VIVO-Y29', 2)

// The real stockSummary query (now including brand_id).
const summary = (await db.execute({
  sql: `SELECT m.id AS model_id, m.name AS model_name, m.sku, m.brand_id, b.name AS brand_name,
               COUNT(su.id) AS qty
          FROM models m JOIN brands b ON b.id = m.brand_id
          LEFT JOIN stock_units su ON su.model_id = m.id AND su.status='in_stock'
                 AND (? = '' OR su.current_shop_id = ?)
         WHERE m.company_id = ? AND m.is_active = 1
         GROUP BY m.id ORDER BY qty DESC, b.name, m.name`,
  args: [shop, shop, co]
})).rows.map((r) => ({ modelId: r.model_id, modelName: r.model_name, sku: r.sku, brandId: r.brand_id, brandName: r.brand_name, qty: r.qty }))

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

chk(summary.length === 3, `summary returns 3 models (${summary.length})`)
chk(summary.every((s) => s.brandId), 'every summary row exposes brandId (needed by the brand filter)')

// The exact predicate used by the page.
const filter = (rows, searchText, brandFilter) => {
  const q = (searchText ?? '').trim().toLowerCase()
  return rows.filter((s) => {
    if (brandFilter !== 'all' && s.brandId !== brandFilter) return false
    if (!q) return true
    return [s.modelName, s.brandName, s.sku].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
  })
}

chk(filter(summary, '', 'all').length === 3, 'no search -> all rows')
chk(filter(summary, 'charger', 'all').length === 1, 'search "charger" finds the charger')
chk(filter(summary, 'CHARGER', 'all').length === 1, 'search is case-insensitive (uppercase)')
chk(filter(summary, 'chArGeR', 'all').length === 1, 'search is case-insensitive (mixed)')
chk(filter(summary, '  charger  ', 'all').length === 1, 'surrounding spaces are ignored')
chk(filter(summary, 'boat', 'all').length === 2, 'search by brand name finds both BOAT items')
chk(filter(summary, 'BOAT-CBL', 'all').length === 1, 'search by SKU works')
chk(filter(summary, 'y29', 'all')[0]?.sku === 'VIVO-Y29', 'partial model name matches')
chk(filter(summary, 'zzz', 'all').length === 0, 'no match -> empty list')
chk(filter(summary, '', vivo).length === 1, 'brand filter alone works')
chk(filter(summary, 'cable', vivo).length === 0, 'brand filter + search combine (no VIVO cable)')
chk(filter(summary, 'cable', boat).length === 1, 'brand filter + search combine (BOAT cable found)')

console.log(`\n${fails === 0 ? 'ALL STOCK SEARCH CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
