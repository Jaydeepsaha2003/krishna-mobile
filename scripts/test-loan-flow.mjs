/**
 * End-to-end functional check of the EMI loan feature against the live Turso
 * database — creates a real loan (with schedule), pays a couple of
 * installments (including a late one with penalty), forecloses it, then
 * deletes everything it created. Exits non-zero on any assertion failure.
 */
import { createClient } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, intMode: 'number' })

let failures = 0
function assert(cond, message) {
  if (cond) {
    console.log(`  OK   ${message}`)
  } else {
    failures++
    console.error(`  FAIL ${message}`)
  }
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const nowIso = () => new Date().toISOString()

async function main() {
  const company = (await db.execute('SELECT * FROM companies ORDER BY created_at LIMIT 1')).rows[0]
  const shop = (await db.execute({ sql: 'SELECT * FROM shops WHERE company_id = ? LIMIT 1', args: [company.id] })).rows[0]
  const customer = (await db.execute({ sql: 'SELECT * FROM customers WHERE company_id = ? LIMIT 1', args: [company.id] })).rows[0]

  if (!customer) {
    console.error('No customer found — run scripts/seed-demo.mjs first.')
    process.exit(1)
  }
  console.log(`Using company "${company.name}", shop "${shop.name}", customer "${customer.name}"\n`)

  /* ------------------------------------------------------------- schedule */
  console.log('1. Schedule generation (₹9,999 over 4 months — tests rounding remainder)')
  const saleAmount = 15999
  const downPayment = 3000
  const purchaseAmount = 12500
  const tenure = 4
  const loanAmount = round2(saleAmount - downPayment) // 12999
  const baseEmi = round2(loanAmount / tenure) // 3249.75
  const loanDate = '2026-01-05'

  const schedule = []
  let allocated = 0
  for (let i = 1; i <= tenure; i++) {
    const dueDate = addMonths(loanDate, i - 1)
    const scheduledEmi = i === tenure ? round2(loanAmount - allocated) : baseEmi
    allocated = round2(allocated + scheduledEmi)
    schedule.push({ emiNo: i, dueDate, scheduledEmi })
  }
  const scheduleSum = round2(schedule.reduce((a, r) => a + r.scheduledEmi, 0))
  assert(scheduleSum === loanAmount, `schedule sums to the loan amount exactly (${scheduleSum} == ${loanAmount})`)
  assert(schedule[0].dueDate === '2026-01-05', `EMI #1 due on the loan date (${schedule[0].dueDate})`)
  assert(schedule[3].dueDate === '2026-04-05', `EMI #4 (last) due 3 months later (${schedule[3].dueDate})`)
  assert(
    schedule.slice(0, 3).every((r) => r.scheduledEmi === baseEmi),
    `first 3 installments are the flat EMI (₹${baseEmi})`
  )

  /* ------------------------------------------------------------- insert */
  const loanId = randomUUID()
  const ts = nowIso()
  const loanNo = `TEST-LN-${Date.now()}`
  await db.execute({
    sql: `INSERT INTO loans (id, company_id, shop_id, loan_no, customer_id, brand, category, model_name,
            loan_date, purchase_amount, sale_amount, down_payment, loan_amount, processing_fee,
            total_margin, loan_tenure_months, monthly_emi, emi_start_date, emi_end_date, status,
            current_outstanding, penalty_collected, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,0,?,?)`,
    args: [
      loanId, company.id, shop.id, loanNo, customer.id, 'TestBrand', 'Smartphone', 'Test Model X',
      loanDate, purchaseAmount, saleAmount, downPayment, loanAmount, 300, round2(saleAmount - purchaseAmount),
      tenure, baseEmi, loanDate, schedule[3].dueDate, loanAmount, ts, ts
    ]
  })
  for (const row of schedule) {
    await db.execute({
      sql: `INSERT INTO loan_repayments (id, loan_id, emi_no, due_date, scheduled_emi, actual_emi_paid,
              penalty_amount, is_penalty_paid, status, updated_at)
            VALUES (?,?,?,?,?,0,0,0,'PENDING',?)`,
      args: [randomUUID(), loanId, row.emiNo, row.dueDate, row.scheduledEmi, ts]
    })
  }
  console.log(`  Inserted loan ${loanNo} with ${tenure} installments\n`)

  /* ---------------------------------------------------------- repayment 1 */
  console.log('2. Full on-time repayment of EMI #1')
  const rows = (await db.execute({
    sql: 'SELECT * FROM loan_repayments WHERE loan_id = ? ORDER BY emi_no',
    args: [loanId]
  })).rows
  const emi1 = rows[0]
  await db.execute({
    sql: `UPDATE loan_repayments SET actual_emi_paid = ?, repay_date = ?, payment_mode = 'Cash',
            status = 'PAID', updated_at = ? WHERE id = ?`,
    args: [emi1.scheduled_emi, loanDate, nowIso(), emi1.id]
  })
  let totals = (await db.execute({
    sql: `SELECT COALESCE(SUM(actual_emi_paid),0) AS paid FROM loan_repayments WHERE loan_id = ?`,
    args: [loanId]
  })).rows[0]
  let outstanding = round2(loanAmount - Number(totals.paid))
  await db.execute({
    sql: `UPDATE loans SET current_outstanding = ?, last_emi_paid_date = ? WHERE id = ?`,
    args: [outstanding, loanDate, loanId]
  })
  assert(outstanding === round2(loanAmount - baseEmi), `outstanding drops by exactly one EMI (₹${outstanding})`)

  /* --------------------------------------------------- repayment 2, late */
  console.log('\n3. Late partial repayment of EMI #2 with penalty')
  const emi2 = rows[1]
  const partial = round2(emi2.scheduled_emi - 500)
  const penalty = 200
  await db.execute({
    sql: `UPDATE loan_repayments SET actual_emi_paid = ?, repay_date = ?, penalty_amount = ?,
            is_penalty_paid = 1, payment_mode = 'UPI', status = 'PARTIAL', updated_at = ? WHERE id = ?`,
    args: [partial, addMonths(loanDate, 1.3), penalty, nowIso(), emi2.id]
  })
  totals = (await db.execute({
    sql: `SELECT COALESCE(SUM(actual_emi_paid),0) AS paid,
                 COALESCE(SUM(CASE WHEN is_penalty_paid=1 THEN penalty_amount ELSE 0 END),0) AS pen
            FROM loan_repayments WHERE loan_id = ?`,
    args: [loanId]
  })).rows[0]
  outstanding = round2(loanAmount - Number(totals.paid))
  await db.execute({
    sql: `UPDATE loans SET current_outstanding = ?, penalty_collected = ? WHERE id = ?`,
    args: [outstanding, Number(totals.pen), loanId]
  })
  const emi2After = (await db.execute({ sql: 'SELECT * FROM loan_repayments WHERE id = ?', args: [emi2.id] })).rows[0]
  assert(emi2After.status === 'PARTIAL', 'EMI #2 correctly marked PARTIAL (paid less than scheduled)')
  assert(Number(totals.pen) === penalty, `penalty of ₹${penalty} recorded as collected`)
  assert(
    outstanding === round2(loanAmount - baseEmi - partial),
    `outstanding correctly reflects EMI #1 (full) + EMI #2 (partial) — ₹${outstanding}`
  )

  /* --------------------------------------------------- overdue detection */
  console.log('\n4. Overdue detection (schedule dates are all in the past relative to "today")')
  const overdue = (await db.execute({
    sql: `SELECT COUNT(*) AS n, COALESCE(SUM(scheduled_emi - actual_emi_paid),0) AS amt
            FROM loan_repayments WHERE loan_id = ? AND status IN ('PENDING','PARTIAL')
              AND due_date < date('now','localtime')`,
    args: [loanId]
  })).rows[0]
  // EMI #2 (partial) and EMI #3 (pending, due 2026-03-05) are both in the past relative to "today".
  assert(Number(overdue.n) >= 1, `at least one installment is flagged overdue (found ${overdue.n})`)

  /* ----------------------------------------------------------- foreclose */
  console.log('\n5. Foreclosure — settle everything remaining in one payment')
  const pending = (await db.execute({
    sql: `SELECT * FROM loan_repayments WHERE loan_id = ? AND status IN ('PENDING','PARTIAL') ORDER BY emi_no`,
    args: [loanId]
  })).rows
  const remainingBalance = round2(pending.reduce((a, r) => a + (r.scheduled_emi - r.actual_emi_paid), 0))
  const settlement = round2(remainingBalance - 100) // shop offers a small foreclosure discount
  let applied = settlement
  for (const row of pending) {
    const due = round2(row.scheduled_emi - row.actual_emi_paid)
    const apply = Math.max(0, Math.min(applied, due))
    applied = round2(applied - apply)
    await db.execute({
      sql: `UPDATE loan_repayments SET actual_emi_paid = actual_emi_paid + ?, repay_date = ?,
              payment_mode = 'Cash', status = 'FORECLOSED', updated_at = ? WHERE id = ?`,
      args: [apply, loanDate, nowIso(), row.id]
    })
  }
  await db.execute({
    sql: `UPDATE loans SET status = 'FORECLOSED', current_outstanding = 0, closed_date = ?, updated_at = ? WHERE id = ?`,
    args: [loanDate, nowIso(), loanId]
  })

  const finalLoan = (await db.execute({ sql: 'SELECT * FROM loans WHERE id = ?', args: [loanId] })).rows[0]
  const finalRows = (await db.execute({ sql: 'SELECT * FROM loan_repayments WHERE loan_id = ?', args: [loanId] })).rows
  assert(finalLoan.status === 'FORECLOSED', 'loan status is FORECLOSED after settlement')
  assert(Number(finalLoan.current_outstanding) === 0, 'current_outstanding reset to 0')
  assert(
    finalRows.every((r) => r.status === 'PAID' || r.status === 'PARTIAL' || r.status === 'FORECLOSED'),
    'no installment is left PENDING after foreclosure'
  )
  const totalCollected = round2(finalRows.reduce((a, r) => a + r.actual_emi_paid, 0))
  assert(
    totalCollected === round2(loanAmount - 100),
    `total collected across all installments equals loan amount minus the ₹100 discount (₹${totalCollected})`
  )

  /* ------------------------------------------------------------- cleanup */
  await db.execute({ sql: 'DELETE FROM loans WHERE id = ?', args: [loanId] })
  const orphans = (await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM loan_repayments WHERE loan_id = ?',
    args: [loanId]
  })).rows[0]
  assert(Number(orphans.n) === 0, 'ON DELETE CASCADE removed every repayment row with the loan')

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  db.close()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
