/** Sanity-checks the generated month against the numbers the app will show. */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, intMode: 'number' })

const rows = async (sql) => (await db.execute(sql)).rows
const inr = (n) => `₹${Math.round(Number(n ?? 0)).toLocaleString('en-IN')}`
const table = (title, data) => {
  console.log(`\n${title}`)
  console.table(data)
}

table('Per shop — July 2026', (await rows(`
  SELECT sh.code shop, COUNT(s.id) bills, ROUND(SUM(s.total)) revenue,
         ROUND(SUM(s.total_cost)) cost, ROUND(SUM(s.total_profit)) profit,
         ROUND(100.0 * SUM(s.total_profit) / SUM(s.total), 1) margin_pct,
         ROUND(SUM(s.due_amount)) credit_out
    FROM sales s JOIN shops sh ON sh.id = s.shop_id
   WHERE s.sale_date BETWEEN '2026-07-01' AND '2026-07-31' AND s.status <> 'cancelled'
   GROUP BY sh.id ORDER BY sh.code`)).map((r) => ({
  shop: r.shop, bills: r.bills, revenue: inr(r.revenue), cost: inr(r.cost),
  profit: inr(r.profit), margin: `${r.margin_pct}%`, credit: inr(r.credit_out)
})))

table('Stock by shop and status', (await rows(`
  SELECT sh.code shop, su.status, COUNT(*) units, ROUND(SUM(su.cost_price)) value
    FROM stock_units su LEFT JOIN shops sh ON sh.id = su.current_shop_id
   GROUP BY sh.code, su.status ORDER BY sh.code, su.status`)).map((r) => ({
  shop: r.shop, status: r.status, units: r.units, value: inr(r.value)
})))

table('Transfers Shop 1 → Shop 2', (await rows(`
  SELECT t.transfer_no, t.transfer_date, t.total_units, ROUND(t.total_value) value, t.status
    FROM transfers t ORDER BY t.transfer_date`)).map((r) => ({
  no: r.transfer_no, date: r.transfer_date, units: r.total_units, value: inr(r.value), status: r.status
})))

table('Purchases', (await rows(`
  SELECT p.purchase_date date, s.name supplier, sh.code shop,
         (SELECT COUNT(*) FROM stock_units su WHERE su.purchase_id = p.id) units,
         ROUND(p.total) total, ROUND(p.due_amount) payable
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN shops sh ON sh.id = p.shop_id
   ORDER BY p.purchase_date`)).map((r) => ({
  date: r.date, supplier: r.supplier, shop: r.shop, units: r.units,
  total: inr(r.total), payable: inr(r.payable)
})))

table('Credit still outstanding', (await rows(`
  SELECT c.name customer, c.phone_primary phone, s.invoice_no, s.due_date,
         ROUND(s.due_amount) due,
         CAST(julianday('2026-08-07') - julianday(s.due_date) AS INTEGER) days_late
    FROM sales s JOIN customers c ON c.id = s.customer_id
   WHERE s.due_amount > 0.5 ORDER BY s.due_date`)).map((r) => ({
  customer: r.customer, phone: r.phone, invoice: r.invoice_no,
  promised: r.due_date, due: inr(r.due), late: r.days_late > 0 ? `${r.days_late}d` : '—'
})))

table('Top models sold', (await rows(`
  SELECT b.name || ' ' || m.name model, COUNT(*) units, ROUND(SUM(si.line_total)) revenue,
         ROUND(SUM(si.profit)) profit
    FROM sale_items si JOIN models m ON m.id = si.model_id JOIN brands b ON b.id = m.brand_id
    JOIN sales s ON s.id = si.sale_id
   WHERE s.sale_date BETWEEN '2026-07-01' AND '2026-07-31'
   GROUP BY m.id ORDER BY revenue DESC LIMIT 8`)).map((r) => ({
  model: r.model, units: r.units, revenue: inr(r.revenue), profit: inr(r.profit)
})))

const bad = await rows(`SELECT COUNT(*) n FROM sale_items WHERE profit < 0`)
const orphan = await rows(`
  SELECT (SELECT COUNT(*) FROM sale_items si LEFT JOIN stock_units su ON su.id = si.stock_unit_id
           WHERE su.id IS NULL) a,
         (SELECT COUNT(*) FROM stock_units WHERE status = 'sold' AND sale_id IS NULL) b,
         (SELECT COUNT(*) FROM sales s WHERE ABS(s.total - s.paid_amount - s.due_amount) > 0.5) c`)

console.log(`\nIntegrity`)
console.log(`  loss-making lines      ${bad[0].n}`)
console.log(`  sale items w/o unit    ${orphan[0].a}`)
console.log(`  sold units w/o sale    ${orphan[0].b}`)
console.log(`  bills that don't add up ${orphan[0].c}`)

db.close()
