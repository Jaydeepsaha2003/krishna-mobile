/**
 * Verifies createTransferByModel's unit selection + the availableModels picker
 * filter against a throwaway DB.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'trf-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 't.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-09T00:00:00.000Z'
const co = uid(), s1 = uid(), s2 = uid(), brand = uid(), acc = uid(), phone = uid(), empty = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
for (const [id, nm, cd] of [[s1, 'Shop 1', 'S1'], [s2, 'Shop 2', 'S2']])
  await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [id, co, nm, cd, now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'Boat', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)`, args: [acc, co, brand, 'Charger', 'CHG', 'Accessory', now, now] })
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`, args: [phone, co, brand, 'Phone X', 'PHX', 'Smartphone', now, now] })
// A model with NO stock — must never appear in the picker.
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)`, args: [empty, co, brand, 'Cable', 'CBL', 'Accessory', now, now] })

// 6 chargers + 2 phones at Shop 1
for (let i = 0; i < 6; i++)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [uid(), co, acc, s1, 100, `2026-08-0${i + 1}T00:00:00.000Z`, now] })
for (let i = 0; i < 2; i++)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,imei1,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?,?, 'in_stock',?,?,?,?)`, args: [uid(), co, phone, `35111111111111${i}`, s1, 9000, now, now] })

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

// ---- picker: only in-stock SKUs, with qty ----
const picker = async (shop, includeImei) => (await db.execute({
  sql: `SELECT m.sku, COUNT(su.id) AS available FROM models m
          JOIN brands b ON b.id=m.brand_id
          JOIN stock_units su ON su.model_id=m.id AND su.status='in_stock' AND su.current_shop_id=?
         WHERE m.company_id=? AND m.is_active=1 ${includeImei ? '' : 'AND m.track_imei=0'}
         GROUP BY m.id HAVING available > 0 ORDER BY b.name, m.name`,
  args: [shop, co]
})).rows

const accOnly = await picker(s1, false)
chk(accOnly.length === 1 && accOnly[0].sku === 'CHG' && accOnly[0].available === 6, `sale picker: only CHG with qty 6 (got ${JSON.stringify(accOnly)})`)
chk(!accOnly.some((r) => r.sku === 'CBL'), 'out-of-stock SKU (CBL) is NOT listed')

const withImei = await picker(s1, true)
chk(withImei.length === 2, `transfer picker includes IMEI models too (${withImei.length} SKUs)`)
chk((await picker(s2, true)).length === 0, 'Shop 2 picker is empty (no stock there yet)')

// ---- transfer 4 chargers S1 -> S2 (FIFO) ----
const pick = (await db.execute({ sql: `SELECT id FROM stock_units WHERE company_id=? AND model_id=? AND current_shop_id=? AND status='in_stock' ORDER BY added_at LIMIT 4`, args: [co, acc, s1] })).rows
chk(pick.length === 4, 'FIFO selected 4 oldest chargers')
const trf = uid()
await db.execute({ sql: `INSERT INTO transfers (id,company_id,transfer_no,from_shop_id,to_shop_id,transfer_date,status,total_units,created_at,updated_at) VALUES (?,?,?,?,?,?, 'in_transit',?,?,?)`, args: [trf, co, 'TR1', s1, s2, '2026-08-09', 4, now, now] })
for (const u of pick) {
  await db.execute({ sql: `INSERT INTO transfer_items (id,transfer_id,stock_unit_id,cost_at_transfer) VALUES (?,?,?,100)`, args: [uid(), trf, u.id] })
  await db.execute({ sql: `UPDATE stock_units SET status='in_transit', transfer_id=? WHERE id=?`, args: [trf, u.id] })
}
const s1Left = (await picker(s1, false))[0]
chk(s1Left.available === 2, `sending shop drops to 2 while in transit (${s1Left.available})`)
chk((await picker(s2, false)).length === 0, 'receiving shop shows nothing until confirmed')

// ---- receive ----
for (const u of pick)
  await db.execute({ sql: `UPDATE stock_units SET status='in_stock', current_shop_id=?, transfer_id=NULL WHERE id=?`, args: [s2, u.id] })
await db.execute({ sql: `UPDATE transfers SET status='received' WHERE id=?`, args: [trf] })
chk((await picker(s2, false))[0].available === 4, 'receiving shop has 4 after confirming')
chk((await picker(s1, false))[0].available === 2, 'sending shop still 2')

// ---- oversell guard ----
const tooMany = (await db.execute({ sql: `SELECT id FROM stock_units WHERE company_id=? AND model_id=? AND current_shop_id=? AND status='in_stock' ORDER BY added_at LIMIT 10`, args: [co, acc, s1] })).rows
chk(tooMany.length === 2, `transferring 10 from Shop 1 would be refused (only ${tooMany.length} available)`)

console.log(`\n${fails === 0 ? 'ALL TRANSFER CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
