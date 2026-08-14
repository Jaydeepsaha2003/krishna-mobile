/**
 * Backfills profit on recharge bills already saved.
 *
 * Recharges used to record zero cost, so the whole amount the customer handed
 * over counted as profit (a ₹500 recharge showed ₹500 profit). This rewrites
 * each recharge bill so only the shop's commission is profit:
 *   service line  -> cost_price = max(0, line_total − commission)
 *   sale          -> total_cost = Σ item costs, total_profit = total − total_cost
 *
 *   node scripts/backfill-recharge-profit.mjs            # DRY RUN, shows the plan
 *   node scripts/backfill-recharge-profit.mjs --confirm  # apply
 *   node scripts/backfill-recharge-profit.mjs --confirm --profit 7
 *
 * Idempotent: re-running finds nothing left to change.
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
  intMode: 'number'
})

const argv = process.argv.slice(2)
const confirm = argv.includes('--confirm')
const pIdx = argv.indexOf('--profit')
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// Use the shop's configured commission unless one is passed explicitly.
let commission = 5
if (pIdx !== -1 && argv[pIdx + 1] !== undefined) {
  commission = Number(argv[pIdx + 1])
} else {
  const row = (await db.execute({
    sql: `SELECT value FROM settings WHERE key = ?`,
    args: ['sale.rechargeProfit']
  })).rows[0]
  if (row?.value !== undefined && row.value !== null) {
    try { commission = Number(JSON.parse(String(row.value))) } catch { commission = Number(row.value) }
  }
}
commission = Math.max(0, Number.isFinite(commission) ? commission : 5)
console.log(`commission per recharge: ₹${commission}`)
console.log(confirm ? '=== APPLYING ===\n' : '=== DRY RUN (no --confirm) ===\n')

const sales = (await db.execute(`
  SELECT id, invoice_no, sale_date, total, total_cost, total_profit
    FROM sales WHERE sale_type = 'recharge' AND status <> 'cancelled'
   ORDER BY sale_date, invoice_no`)).rows

if (!sales.length) {
  console.log('No recharge bills found.')
  db.close()
  process.exit(0)
}

let changed = 0
let profitBefore = 0
let profitAfter = 0
const preview = []

for (const s of sales) {
  const items = (await db.execute({
    sql: `SELECT id, line_type, line_total, cost_price, profit FROM sale_items WHERE sale_id = ?`,
    args: [s.id]
  })).rows

  const updates = []
  let newCostTotal = 0
  for (const it of items) {
    // Only the recharge (service) line changes; any goods line keeps its real cost.
    const isService = String(it.line_type) === 'service'
    const newCost = isService
      ? round2(Math.max(0, Number(it.line_total) - commission))
      : round2(Number(it.cost_price))
    const newProfit = round2(Number(it.line_total) - newCost)
    newCostTotal = round2(newCostTotal + newCost)
    if (isService && (round2(Number(it.cost_price)) !== newCost || round2(Number(it.profit)) !== newProfit)) {
      updates.push({ id: it.id, newCost, newProfit })
    }
  }

  const newTotalProfit = round2(Number(s.total) - newCostTotal)
  const saleNeedsUpdate =
    round2(Number(s.total_cost)) !== newCostTotal || round2(Number(s.total_profit)) !== newTotalProfit

  if (!updates.length && !saleNeedsUpdate) continue

  changed++
  profitBefore = round2(profitBefore + Number(s.total_profit))
  profitAfter = round2(profitAfter + newTotalProfit)
  if (preview.length < 10) {
    preview.push({
      invoice: s.invoice_no,
      date: s.sale_date,
      amount: Number(s.total),
      profit_before: Number(s.total_profit),
      profit_after: newTotalProfit
    })
  }

  if (confirm) {
    for (const u of updates) {
      await db.execute({
        sql: `UPDATE sale_items SET cost_price = ?, profit = ? WHERE id = ?`,
        args: [u.newCost, u.newProfit, u.id]
      })
    }
    await db.execute({
      sql: `UPDATE sales SET total_cost = ?, total_profit = ?, updated_at = ? WHERE id = ?`,
      args: [newCostTotal, newTotalProfit, new Date().toISOString(), s.id]
    })
  }
}

console.log(`recharge bills found   : ${sales.length}`)
console.log(`bills needing a change : ${changed}`)
console.log(`total profit before    : ₹${profitBefore}`)
console.log(`total profit after     : ₹${profitAfter}`)
console.log(`overstated profit removed: ₹${round2(profitBefore - profitAfter)}`)
if (preview.length) {
  console.log('\nsample:')
  console.table(preview)
}
if (!confirm) console.log('\nNothing changed. Re-run with --confirm to apply.')
else console.log('\nDone.')

db.close()
