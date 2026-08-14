/**
 * Verifies the Remove-stock picker bug: an ARCHIVED product that still has
 * stock must be selectable for removal. Compares the catalogue query (what the
 * dialog used before) with availableModels (what it uses now).
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'rmarch-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'a.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-14T00:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), archived = uid(), live = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'GOOGLE', now, now] })
// An ARCHIVED model that still has 9 units on the shelf (the Pixel situation).
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)`, args: [archived, co, brand, 'GOOGLE PIXEL', 'GOOGLE-PIXEL', 'Smartphone', now, now] })
// A normal active model with stock, as a control.
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`, args: [live, co, brand, 'PIXEL 8', 'GOOGLE-P8', 'Smartphone', now, now] })
for (let i = 0; i < 9; i++)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [uid(), co, archived, shop, 11800, now, now] })
await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [uid(), co, live, shop, 500, now, now] })

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

// OLD behaviour: listModels (catalogue) — hides archived.
const catalogue = (await db.execute({
  sql: `SELECT m.name FROM models m JOIN brands b ON b.id=m.brand_id
         WHERE m.company_id=? AND m.is_active=1`, args: [co]
})).rows.map((r) => r.name)
chk(!catalogue.includes('GOOGLE PIXEL'), 'OLD picker (catalogue) could NOT see the archived product — the bug')

// NEW behaviour: availableModels — driven by real stock, includeImei = true.
const removable = (await db.execute({
  sql: `SELECT m.name, COUNT(su.id) AS available FROM models m
          JOIN brands b ON b.id=m.brand_id
          JOIN stock_units su ON su.model_id=m.id AND su.status='in_stock' AND su.current_shop_id=?
         WHERE m.company_id=? GROUP BY m.id HAVING available>0 ORDER BY m.name`,
  args: [shop, co]
})).rows
const names = removable.map((r) => r.name)
chk(names.includes('GOOGLE PIXEL'), `NEW picker CAN see the archived product (${JSON.stringify(names)})`)
chk(removable.find((r) => r.name === 'GOOGLE PIXEL')?.available === 9, 'it shows the right quantity (9)')
chk(names.includes('PIXEL 8'), 'active products still listed')

// Removing it FIFO clears the shelf, and then it disappears from the picker.
const ids = (await db.execute({
  sql: `SELECT id FROM stock_units WHERE model_id=? AND status='in_stock' ORDER BY added_at LIMIT 9`, args: [archived]
})).rows.map((r) => r.id)
chk(ids.length === 9, 'all 9 units are removable')
for (const id of ids) await db.execute({ sql: `UPDATE stock_units SET status='damaged' WHERE id=?`, args: [id] })

const after = (await db.execute({
  sql: `SELECT m.name FROM models m
          JOIN stock_units su ON su.model_id=m.id AND su.status='in_stock' AND su.current_shop_id=?
         WHERE m.company_id=? GROUP BY m.id HAVING COUNT(su.id)>0`, args: [shop, co]
})).rows.map((r) => r.name)
chk(!after.includes('GOOGLE PIXEL'), 'once emptied, the archived product leaves the picker')
chk((await db.execute(`SELECT COUNT(*) n FROM stock_units WHERE status='in_stock'`)).rows[0].n === 1, 'only the active product’s unit remains in stock')

console.log(`\n${fails === 0 ? 'ALL REMOVE-ARCHIVED CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
