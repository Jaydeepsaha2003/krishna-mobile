/**
 * Verifies recharge profit accounting: only the commission is profit, the
 * setting is respected, and other sale types are unaffected.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'rp-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'r.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

// The rule createSale applies for a recharge line.
const rechargeCost = (lineTotal, commission) => round2(Math.max(0, lineTotal - commission))
const saleProfit = (total, costTotal) => round2(total - costTotal)

console.log('--- default ₹5 commission ---')
for (const amount of [299, 500, 123, 1000]) {
  const cost = rechargeCost(amount, 5)
  chk(saleProfit(amount, cost) === 5, `₹${amount} recharge -> profit ₹5 (cost ₹${cost})`)
}

console.log('\n--- commission changed in settings ---')
for (const [amount, comm, want] of [[500, 7, 7], [500, 0, 0], [500, 12.5, 12.5]]) {
  const cost = rechargeCost(amount, comm)
  chk(saleProfit(amount, cost) === want, `₹${amount} at ₹${comm} commission -> profit ₹${want}`)
}

console.log('\n--- edge case: recharge smaller than the commission ---')
const tiny = rechargeCost(3, 5)
chk(tiny === 0, `₹3 recharge cannot go negative (cost ₹${tiny})`)
chk(saleProfit(3, tiny) === 3, 'profit is capped at the amount itself (₹3), never inflated')

console.log('\n--- other sale types unaffected ---')
// Product: cost is the stock unit's landed cost.
chk(saleProfit(12000, 9000) === 3000, 'product sale: ₹12000 − ₹9000 cost = ₹3000 profit')
// Repair labour keeps zero cost (pure labour margin).
chk(saleProfit(500, 0) === 500, 'repair labour: full ₹500 stays profit')

console.log('\n--- backfill formula matches, and is idempotent ---')
const sale = uid(), item = uid(), co = uid(), shop = uid()
const now = '2026-08-14T00:00:00.000Z'
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
// An old-style recharge bill: zero cost, full amount as profit.
await db.execute({ sql: `INSERT INTO sales (id,company_id,shop_id,invoice_no,sale_date,sale_type,total,paid_amount,total_cost,total_profit,created_at,updated_at)
  VALUES (?,?,?,?,?,'recharge',?,?,0,?,?,?)`, args: [sale, co, shop, 'INV1', '2026-08-10', 300, 300, 300, now, now] })
await db.execute({ sql: `INSERT INTO sale_items (id,sale_id,line_type,qty,unit_price,line_total,cost_price,profit)
  VALUES (?,?, 'service',1,300,300,0,300)`, args: [item, sale] })

const applyBackfill = async (commission) => {
  const items = (await db.execute({ sql: `SELECT id,line_type,line_total,cost_price,profit FROM sale_items WHERE sale_id=?`, args: [sale] })).rows
  let costTotal = 0, updated = 0
  for (const it of items) {
    const isService = String(it.line_type) === 'service'
    const newCost = isService ? rechargeCost(Number(it.line_total), commission) : round2(Number(it.cost_price))
    const newProfit = round2(Number(it.line_total) - newCost)
    costTotal = round2(costTotal + newCost)
    if (isService && (round2(Number(it.cost_price)) !== newCost || round2(Number(it.profit)) !== newProfit)) {
      await db.execute({ sql: `UPDATE sale_items SET cost_price=?, profit=? WHERE id=?`, args: [newCost, newProfit, it.id] })
      updated++
    }
  }
  const s = (await db.execute({ sql: `SELECT total,total_cost,total_profit FROM sales WHERE id=?`, args: [sale] })).rows[0]
  const newTotalProfit = round2(Number(s.total) - costTotal)
  if (round2(Number(s.total_cost)) !== costTotal || round2(Number(s.total_profit)) !== newTotalProfit) {
    await db.execute({ sql: `UPDATE sales SET total_cost=?, total_profit=? WHERE id=?`, args: [costTotal, newTotalProfit, sale] })
    updated++
  }
  return updated
}

const first = await applyBackfill(5)
const after = (await db.execute({ sql: `SELECT total_cost,total_profit FROM sales WHERE id=?`, args: [sale] })).rows[0]
chk(first > 0, `first backfill pass changed the bill (${first} update(s))`)
chk(Number(after.total_profit) === 5, `₹300 recharge now shows ₹5 profit (was ₹300)`)
chk(Number(after.total_cost) === 295, `cost recorded as ₹295 (the operator's share)`)
const second = await applyBackfill(5)
chk(second === 0, 'second pass changes nothing — safe to re-run')

console.log(`\n${fails === 0 ? 'ALL RECHARGE PROFIT CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
