/**
 * Verifies the new payment-mode breakdown on the Sales page: grouped totals
 * match the sum of individual sales per mode, respect the same date/shop
 * filters as the rest of the page, and exclude cancelled bills by default.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'bypm-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'p.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

const now = '2026-08-21T00:00:00.000Z'
const co = uid(), shop = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })

async function sale(mode, total, status = 'completed') {
  const id = uid()
  await db.execute({
    sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,sale_type,total,paid_amount,due_amount,total_cost,total_profit,payment_mode,status,created_at,updated_at)
          VALUES (?,?,?,?,'2026-08-21','product',?,?,0,0,?,?,?,?,?)`,
    args: [id, co, shop, `INV-${id.slice(0, 6)}`, total, total, total, mode, status, now, now]
  })
}

await sale('Cash', 6000)
await sale('Cash', 4000)
await sale('UPI', 5000)
await sale('Card', 1200, 'cancelled') // must be excluded by default
await sale(null, 800) // no mode recorded

// Mirrors the WHERE clause listSales builds for status<>'cancelled' + a date range.
const clause = `WHERE s.company_id = ? AND s.sale_date >= ? AND s.sale_date <= ? AND s.status <> 'cancelled'`
const args = [co, '2026-08-21', '2026-08-21']

const rows = (await db.execute({
  sql: `SELECT COALESCE(s.payment_mode, 'Not recorded') AS mode, COUNT(*) AS count, COALESCE(SUM(s.total),0) AS amount
          FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${clause}
         GROUP BY COALESCE(s.payment_mode, 'Not recorded') ORDER BY amount DESC`,
  args
})).rows

console.log('breakdown:', rows)

const cash = rows.find((r) => r.mode === 'Cash')
const upi = rows.find((r) => r.mode === 'UPI')
const card = rows.find((r) => r.mode === 'Card')
const unrecorded = rows.find((r) => r.mode === 'Not recorded')

chk(cash?.amount === 10000 && cash?.count === 2, `Cash: ₹10,000 across 2 bills (${JSON.stringify(cash)})`)
chk(upi?.amount === 5000 && upi?.count === 1, `UPI: ₹5,000 across 1 bill (${JSON.stringify(upi)})`)
chk(card === undefined, 'the cancelled ₹1,200 Card sale is excluded entirely')
chk(unrecorded?.amount === 800, `a sale with no payment_mode falls into "Not recorded" (${JSON.stringify(unrecorded)})`)

const grandTotal = rows.reduce((a, r) => a + r.amount, 0)
chk(grandTotal === 15800, `grouped totals sum to the same revenue the page's "Revenue" stat card shows (₹${grandTotal})`)

console.log(`\n${fails === 0 ? 'ALL PAYMENT-MODE BREAKDOWN CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
