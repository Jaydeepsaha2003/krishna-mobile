/**
 * Removes the demo/trading data from the live database in .env, so the shop can
 * start from a clean slate before importing real history.
 *
 *   node scripts/reset-live-data.mjs             # DRY RUN — shows the plan only
 *   node scripts/reset-live-data.mjs --confirm   # actually delete
 *
 * KEEPS (real + system): companies, shops, users + their access mappings,
 * brands (the default catalogue), reconciliation reasons, settings, migrations.
 * DELETES (fictional trading data): everything else listed below.
 */
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
if (!env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL is not set in .env')
  process.exit(1)
}
const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
  intMode: 'number'
})

// Child-before-parent order so foreign keys never block a delete.
const DELETE = [
  'payments',
  'sale_items',
  'sales',
  'transfer_items',
  'transfers',
  'stock_adjustments',
  'reconciliation_items',
  'reconciliations',
  'loan_repayments',
  'loans',
  'stock_units',
  'purchase_items',
  'purchases',
  'customers',
  'suppliers',
  'models',
  'counters',
  'notifications',
  'audit_log'
]
const KEEP = ['companies', 'shops', 'users', 'user_companies', 'user_shops', 'brands', 'recon_reasons', 'settings', 'schema_migrations']

const confirm = process.argv.includes('--confirm')

async function counts(tables) {
  const out = {}
  for (const t of tables) {
    try {
      out[t] = (await db.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n
    } catch (err) {
      out[t] = `err: ${err.message}`
    }
  }
  return out
}

console.log(confirm ? '=== DELETING ===' : '=== DRY RUN (no --confirm) ===')
console.log('\nBefore — tables to DELETE:')
console.table(await counts(DELETE))
console.log('Tables to KEEP:')
console.table(await counts(KEEP))

if (!confirm) {
  console.log('\nNothing deleted. Re-run with --confirm to apply.')
  db.close()
  process.exit(0)
}

await db.execute('PRAGMA foreign_keys = ON')
for (const t of DELETE) {
  const res = await db.execute(`DELETE FROM ${t}`)
  console.log(`deleted from ${t}`)
}

console.log('\nAfter — deleted tables (should all be 0):')
console.table(await counts(DELETE))
console.log('Kept tables (unchanged):')
console.table(await counts(KEEP))

db.close()
console.log('\nDone. Relaunch the app (it will re-sync the clean data).')
