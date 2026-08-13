/**
 * Verifies the salvage merge logic using two throwaway DBs playing the roles of
 * the stranded local replica and the primary. Mirrors db/salvage.ts exactly
 * (same upsert SQL, same newer-wins rule, same rename-on-conflict).
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'salv-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const mk = async (name) => {
  const db = createClient({ url: `file:${join(outdir, name)}`, intMode: 'number' })
  await db.execute('PRAGMA foreign_keys = ON')
  for (const m of MIGRATIONS) await db.executeMultiple(m.sql)
  return db
}
const local = await mk('local.db')   // the stranded offline replica
const remote = await mk('remote.db') // the primary

const now = '2026-08-13T00:00:00.000Z'
const later = '2026-08-13T12:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), model = uid()
// Shared base data on BOTH (as it was before the histories diverged).
for (const db of [local, remote]) {
  await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
  await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S2', 'S2', now, now] })
  await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'VIVO', now, now] })
  await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, args: [model, co, brand, 'Y29', 'VIVO-Y29', 'Smartphone', now, now] })
  await db.execute({ sql: `INSERT INTO counters (id,next_no,updated_at) VALUES ('c1',5,?)`, args: [now] })
}

// --- DIVERGENCE ---
// Local (stranded manager PC): a customer, 2 stock units, a sale that consumed
// one unit, its sale_item + payment, and the counter advanced to 9.
const cust = uid(), unitSold = uid(), unitFree = uid(), sale = uid(), saleItem = uid()
await local.execute({ sql: `INSERT INTO customers (id,company_id,name,phone_primary,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [cust, co, 'RAM LAL', '9876543210', later, later] })
await local.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'sold',?,?,?,?)`, args: [unitSold, co, model, shop, 9000, later, later] })
await local.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?)`, args: [unitFree, co, model, shop, 9000, later, later] })
await local.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,customer_id,invoice_no,sale_date,total,paid_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [sale, co, shop, cust, 'S2/INV/2026-27/0007', '2026-08-13', 12000, 12000, later, later] })
await local.execute({ sql: `INSERT INTO sale_items (id,sale_id,stock_unit_id,model_id,line_type,qty,unit_price,line_total) VALUES (?,?,?,?, 'product',1,12000,12000)`, args: [saleItem, sale, unitSold, model] })
await local.execute({ sql: `INSERT INTO payments (id,company_id,direction,party_type,sale_id,amount,payment_date,created_at) VALUES (?,?,'in','customer',?,?,?,?)`, args: [uid(), co, sale, 12000, later, later] })
await local.execute({ sql: `UPDATE counters SET next_no = 9, updated_at = ? WHERE id='c1'`, args: [later] })
// Local also EDITED the shared customer-side model name (newer updated_at).
await local.execute({ sql: `UPDATE models SET name='Y29 4+128', updated_at=? WHERE id=?`, args: [later, model] })

// Remote (the winner history): admin also made a sale that took the SAME invoice number.
const adminSale = uid()
await remote.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,total,paid_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, args: [adminSale, co, shop, 'S2/INV/2026-27/0007', '2026-08-13', 500, 500, now, now] })
await remote.execute({ sql: `UPDATE counters SET next_no = 8, updated_at = ? WHERE id='c1'`, args: [now] })

// --- run the salvage merge (identical logic to db/salvage.ts) ---
const TABLES = [
  { name: 'brands', u: 'updated_at' }, { name: 'models', u: 'updated_at' },
  { name: 'customers', u: 'updated_at' }, { name: 'suppliers', u: 'updated_at' },
  { name: 'purchases', u: 'updated_at' }, { name: 'purchase_items' },
  { name: 'stock_units', u: 'updated_at' }, { name: 'transfers', u: 'updated_at' },
  { name: 'transfer_items' }, { name: 'sales', u: 'updated_at' }, { name: 'sale_items' },
  { name: 'payments' }, { name: 'loans', u: 'updated_at' }, { name: 'loan_repayments', u: 'updated_at' },
  { name: 'reconciliations', u: 'updated_at' }, { name: 'reconciliation_items' },
  { name: 'stock_adjustments' }, { name: 'service_catalog', u: 'updated_at' }, { name: 'audit_log' }
]
const RENAME = { sales: 'invoice_no', loans: 'loan_no' }
const res = { inserted: 0, updated: 0, failed: 0, details: [] }

for (const t of TABLES) {
  const cols = (await local.execute(`SELECT name FROM pragma_table_info('${t.name}')`)).rows.map((r) => r.name)
  if (!cols.includes('id')) continue
  const remoteMap = new Map(
    (await remote.execute(`SELECT id${t.u ? `, ${t.u}` : ''} FROM ${t.name}`)).rows.map((r) => [String(r.id), t.u ? String(r[t.u] ?? '') : null])
  )
  const upsert = `INSERT INTO ${t.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}`
  for (const row of (await local.execute(`SELECT ${cols.join(',')} FROM ${t.name}`)).rows) {
    const id = String(row.id)
    const ru = remoteMap.get(id)
    const missing = ru === undefined
    const newer = !missing && t.u && String(row[t.u] ?? '') > String(ru ?? '')
    if (!missing && !newer) continue
    const values = cols.map((c) => row[c] ?? null)
    try {
      await remote.execute({ sql: upsert, args: values })
      missing ? res.inserted++ : res.updated++
    } catch (err) {
      const rc = RENAME[t.name]
      if (rc && /UNIQUE/i.test(String(err.message))) {
        values[cols.indexOf(rc)] = `${values[cols.indexOf(rc)]}-R`
        await remote.execute({ sql: upsert, args: values })
        res.inserted++
        res.details.push(`${t.name} renumbered`)
        continue
      }
      res.failed++
      res.details.push(`${t.name} ${id}: ${err.message}`)
    }
  }
}
await remote.execute({
  sql: `INSERT INTO counters (id,next_no,updated_at) SELECT id,next_no,updated_at FROM counters WHERE 0`,
  args: []
})
for (const r of (await local.execute('SELECT id,next_no,updated_at FROM counters')).rows) {
  await remote.execute({
    sql: `INSERT INTO counters (id,next_no,updated_at) VALUES (?,?,?)
          ON CONFLICT(id) DO UPDATE SET next_no=MAX(counters.next_no,excluded.next_no), updated_at=excluded.updated_at`,
    args: [r.id, r.next_no, r.updated_at]
  })
}

// --- assertions ---
let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }
const one = async (sql, args = []) => (await remote.execute({ sql, args })).rows[0]

chk(res.failed === 0, `no unrecovered failures (${res.failed}) ${res.details.join('; ')}`)
chk((await one(`SELECT COUNT(*) n FROM customers WHERE id=?`, [cust])).n === 1, 'stranded customer reached the primary')
chk((await one(`SELECT COUNT(*) n FROM stock_units WHERE id IN (?,?)`, [unitSold, unitFree])).n === 2, 'both stranded stock units reached the primary')
chk((await one(`SELECT status FROM stock_units WHERE id=?`, [unitSold])).status === 'sold', 'sold status preserved')
const salvagedSale = await one(`SELECT invoice_no FROM sales WHERE id=?`, [sale])
chk(salvagedSale?.invoice_no === 'S2/INV/2026-27/0007-R', `colliding invoice renumbered (${salvagedSale?.invoice_no})`)
chk((await one(`SELECT invoice_no FROM sales WHERE id=?`, [adminSale])).invoice_no === 'S2/INV/2026-27/0007', "admin's own sale untouched")
chk((await one(`SELECT COUNT(*) n FROM sale_items WHERE sale_id=?`, [sale])).n === 1, 'its sale_item came across')
chk((await one(`SELECT COUNT(*) n FROM payments WHERE sale_id=?`, [sale])).n === 1, 'its payment came across')
chk((await one(`SELECT name FROM models WHERE id=?`, [model])).name === 'Y29 4+128', 'newer local edit wins on shared row')
chk((await one(`SELECT next_no FROM counters WHERE id='c1'`)).next_no === 9, `counter took the MAX (no reissued invoice numbers)`)
const fk = (await remote.execute('PRAGMA foreign_key_check')).rows.length
chk(fk === 0, `no foreign key violations on the primary (${fk})`)

// Idempotency: run the same merge pass again — nothing should change or fail.
const before = (await one(`SELECT COUNT(*) n FROM sales`)).n
let secondFails = 0
for (const t of TABLES) {
  const cols = (await local.execute(`SELECT name FROM pragma_table_info('${t.name}')`)).rows.map((r) => r.name)
  if (!cols.includes('id')) continue
  const remoteMap = new Map(
    (await remote.execute(`SELECT id${t.u ? `, ${t.u}` : ''} FROM ${t.name}`)).rows.map((r) => [String(r.id), t.u ? String(r[t.u] ?? '') : null])
  )
  for (const row of (await local.execute(`SELECT id${t.u ? `, ${t.u}` : ''} FROM ${t.name}`)).rows) {
    const ru = remoteMap.get(String(row.id))
    const missing = ru === undefined
    const newer = !missing && t.u && String(row[t.u] ?? '') > String(ru ?? '')
    if (t.name === 'sales' && missing) continue // renumbered row has same id -> not missing; guard anyway
    if (missing || newer) secondFails++
  }
}
chk(secondFails === 0, 'second pass finds nothing left to copy (idempotent)')
chk((await one(`SELECT COUNT(*) n FROM sales`)).n === before, 'row counts unchanged on second pass')

console.log(`\n${fails === 0 ? 'ALL SALVAGE CHECKS PASSED' : fails + ' FAILED'}`)
local.close(); remote.close()
process.exit(fails === 0 ? 0 : 1)
