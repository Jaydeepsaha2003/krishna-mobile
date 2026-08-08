/**
 * READ-ONLY snapshot of the live database configured in .env. Counts rows per
 * table and shows a few samples so we can tell demo data from real data.
 * Writes nothing.
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

const tables = [
  'companies', 'shops', 'users',
  'brands', 'models', 'suppliers', 'customers',
  'purchases', 'purchase_items', 'stock_units',
  'transfers', 'transfer_items',
  'sales', 'sale_items', 'payments',
  'reconciliations', 'reconciliation_items', 'stock_adjustments',
  'loans', 'loan_repayments',
  'notifications', 'audit_log', 'counters'
]

console.log('=== ROW COUNTS (live DB from .env) ===')
for (const t of tables) {
  try {
    const n = (await db.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n
    console.log(`${t.padEnd(24)} ${n}`)
  } catch (err) {
    console.log(`${t.padEnd(24)} (error: ${err.message})`)
  }
}

console.log('\n=== companies ===')
console.log((await db.execute('SELECT id, name, created_at FROM companies')).rows)
console.log('\n=== shops ===')
console.log((await db.execute('SELECT id, company_id, name, code FROM shops')).rows)
console.log('\n=== users ===')
console.log((await db.execute('SELECT id, name, username, role, is_system FROM users')).rows)

console.log('\n=== customers (first 8) ===')
console.log((await db.execute('SELECT name, phone_primary, created_at FROM customers ORDER BY created_at LIMIT 8')).rows)

console.log('\n=== loans (first 8) ===')
console.log((await db.execute('SELECT loan_no, brand, model_name, status, loan_date, notes FROM loans ORDER BY created_at LIMIT 8')).rows)

console.log('\n=== sales (first 5) ===')
console.log((await db.execute('SELECT invoice_no, sale_date, total FROM sales ORDER BY created_at LIMIT 5')).rows)

db.close()
