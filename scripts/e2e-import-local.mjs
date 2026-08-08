/**
 * End-to-end write-path test for the Access importer against a THROWAWAY local
 * libSQL file. Uses the real migrations (src/main/db/schema.ts) and the real,
 * shared INSERT builders (importAccessCore) so this exercises the exact SQL the
 * app runs — but never touches Turso or the user's database.
 *
 *   node scripts/e2e-import-local.mjs "C:/Users/user/Downloads/krishna_mobile_database.accdb"
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const accdb = process.argv[2] || 'C:/Users/user/Downloads/krishna_mobile_database.accdb'
const outdir = mkdtempSync(join(tmpdir(), 'kimport-e2e-'))

// Bundle the pure core + the migrations into one ESM module we can import.
const outfile = join(outdir, 'bundle.mjs')
await build({
  stdin: {
    contents: `
      export * from './src/main/services/importAccessCore'
      export { MIGRATIONS } from './src/main/db/schema'
    `,
    resolveDir: '.',
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent'
})
const m = await import(pathToFileURL(outfile).href)

let failures = 0
const oks = []
function assert(cond, msg) {
  if (cond) oks.push(msg)
  else {
    failures++
    console.error(`  FAIL  ${msg}`)
  }
}

const db = createClient({ url: `file:${join(outdir, 'test.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')

// 1. Apply real migrations.
for (const mig of m.MIGRATIONS) await db.executeMultiple(mig.sql)

// 2. Seed a company + shop (minimum columns the schema requires).
const companyId = randomUUID()
const shopId = randomUUID()
const now = '2026-08-08T00:00:00.000Z'
await db.execute({
  sql: `INSERT INTO companies (id, name, invoice_prefix, fy_start_month, is_active, created_at, updated_at)
        VALUES (?,?, 'INV', 4, 1, ?, ?)`,
  args: [companyId, 'Test Co', now, now]
})
await db.execute({
  sql: `INSERT INTO shops (id, company_id, name, code, is_active, created_at, updated_at)
        VALUES (?,?,?,?,1,?,?)`,
  args: [shopId, companyId, 'Main Shop', 'M1', now, now]
})

async function loadExisting() {
  const cust = await db.execute('SELECT id, phone_primary, aadhaar FROM customers WHERE company_id = ?', [companyId])
  const phones = new Map()
  const aadhaars = new Map()
  for (const r of cust.rows) {
    if (r.phone_primary) phones.set(String(r.phone_primary), r.id)
    if (r.aadhaar) aadhaars.set(String(r.aadhaar), r.id)
  }
  const loans = await db.execute('SELECT loan_no FROM loans WHERE company_id = ?', [companyId])
  return { phones, aadhaars, loanNos: new Set(loans.rows.map((r) => r.loan_no)) }
}

async function runOnce() {
  const tables = m.readAccessFile(accdb)
  const existing = await loadExisting()
  const plan = m.buildImportPlan(tables, existing, randomUUID)
  const ctx = { companyId, shopId, userId: null, ts: now }
  const stmts = []
  for (const c of plan.customers) {
    if (c.action === 'match') continue
    stmts.push(m.customerInsertStmt(c, ctx))
  }
  for (const l of plan.loans) {
    const loanId = randomUUID()
    stmts.push(m.loanInsertStmt(l, loanId, ctx))
    for (const r of l.schedule) stmts.push(m.repaymentInsertStmt(r, loanId, randomUUID(), ctx))
  }
  await db.batch(stmts.map((s) => ({ sql: s.sql, args: s.args })), 'write')
  return plan
}

// 3. First import.
console.log('=== FIRST IMPORT ===')
const plan1 = await runOnce()

const custCount = (await db.execute('SELECT COUNT(*) n FROM customers WHERE company_id = ?', [companyId])).rows[0].n
const loanCount = (await db.execute('SELECT COUNT(*) n FROM loans WHERE company_id = ?', [companyId])).rows[0].n
const repayCount = (await db.execute(
  'SELECT COUNT(*) n FROM loan_repayments lr JOIN loans l ON l.id = lr.loan_id WHERE l.company_id = ?',
  [companyId]
)).rows[0].n

console.log(`customers=${custCount} loans=${loanCount} repayments=${repayCount}`)
assert(custCount === plan1.stats.customersToInsert, `DB customer count == plan (${custCount}/${plan1.stats.customersToInsert})`)
assert(loanCount === plan1.stats.loansToInsert, `DB loan count == plan (${loanCount}/${plan1.stats.loansToInsert})`)

// Every planned repayment row landed.
const plannedRepays = plan1.loans.reduce((a, l) => a + l.schedule.length, 0)
assert(repayCount === plannedRepays, `DB repayment count == planned schedule rows (${repayCount}/${plannedRepays})`)

// Aggregates reconcile.
const agg = (await db.execute(
  `SELECT ROUND(SUM(total_payable),2) tp, ROUND(SUM(current_outstanding),2) out,
          ROUND(SUM(penalty_collected),2) pen,
          SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) active,
          SUM(CASE WHEN status='CLOSED' THEN 1 ELSE 0 END) closed,
          SUM(CASE WHEN status='FORECLOSED' THEN 1 ELSE 0 END) fc
     FROM loans WHERE company_id = ?`,
  [companyId]
)).rows[0]
assert(Math.abs(agg.tp - plan1.stats.totalPayable) < 1, `SUM(total_payable) matches (${agg.tp}/${plan1.stats.totalPayable})`)
assert(Math.abs(agg.out - plan1.stats.totalOutstanding) < 1, `SUM(outstanding) matches (${agg.out}/${plan1.stats.totalOutstanding})`)
assert(agg.active === plan1.stats.active, `ACTIVE count matches (${agg.active}/${plan1.stats.active})`)
assert(agg.closed === plan1.stats.closed, `CLOSED count matches (${agg.closed}/${plan1.stats.closed})`)
assert(agg.fc === plan1.stats.foreclosed, `FORECLOSED count matches (${agg.fc}/${plan1.stats.foreclosed})`)

// Spot-check KL26-0010: closed, 7 installments summing to 12950, outstanding 0.
const k10 = (await db.execute('SELECT * FROM loans WHERE company_id = ? AND loan_no = ?', [companyId, 'KL26-0010'])).rows[0]
assert(!!k10, 'KL26-0010 row exists in DB')
if (k10) {
  assert(k10.status === 'CLOSED', `KL26-0010 status CLOSED (${k10.status})`)
  assert(k10.current_outstanding === 0, `KL26-0010 outstanding 0 (${k10.current_outstanding})`)
  assert(k10.total_payable === 12950, `KL26-0010 total_payable 12950 (${k10.total_payable})`)
  const sched = (await db.execute(
    'SELECT COUNT(*) n, ROUND(SUM(scheduled_emi),2) sched, ROUND(SUM(actual_emi_paid),2) paid FROM loan_repayments WHERE loan_id = ?',
    [k10.id]
  )).rows[0]
  assert(sched.n === 7, `KL26-0010 has 7 installments (${sched.n})`)
  assert(sched.sched === 12950, `KL26-0010 scheduled sum 12950 (${sched.sched})`)
  assert(sched.paid === 12950, `KL26-0010 paid sum 12950 (${sched.paid})`)
}

// FK integrity: every loan points at the seeded shop + a real customer.
const badFk = (await db.execute(
  `SELECT COUNT(*) n FROM loans l WHERE l.company_id = ?
     AND (l.shop_id <> ? OR NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = l.customer_id))`,
  [companyId, shopId]
)).rows[0].n
assert(badFk === 0, `all loans have valid shop + customer FKs (${badFk} bad)`)

// 4. Second import — must be a no-op (idempotent / additive-only).
console.log('\n=== SECOND IMPORT (idempotency) ===')
const plan2 = await runOnce()
const custCount2 = (await db.execute('SELECT COUNT(*) n FROM customers WHERE company_id = ?', [companyId])).rows[0].n
const loanCount2 = (await db.execute('SELECT COUNT(*) n FROM loans WHERE company_id = ?', [companyId])).rows[0].n
console.log(`after 2nd run: customers=${custCount2} loans=${loanCount2}`)
assert(plan2.stats.loansToInsert === 0, `2nd run inserts 0 new loans (${plan2.stats.loansToInsert})`)
assert(plan2.stats.loansSkippedExisting === plan1.stats.loansToInsert, `2nd run skips all previously-imported loans (${plan2.stats.loansSkippedExisting})`)
assert(plan2.stats.customersToInsert === 0, `2nd run inserts 0 new customers (${plan2.stats.customersToInsert})`)
assert(plan2.stats.customersMatchedExisting === plan1.stats.customersToInsert, `2nd run matches all existing customers by mobile`)
assert(custCount2 === custCount, `customer count unchanged after 2nd run (${custCount2}/${custCount})`)
assert(loanCount2 === loanCount, `loan count unchanged after 2nd run (${loanCount2}/${loanCount})`)

console.log(`\n${'='.repeat(60)}`)
console.log(`${oks.length} checks passed, ${failures} failed`)
db.close()
process.exit(failures === 0 ? 0 : 1)
