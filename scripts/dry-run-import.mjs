/**
 * Dry-run verification for the Access importer. Bundles the PURE planner
 * (src/main/services/importAccessCore.ts) with esbuild so we exercise the exact
 * production code — no reimplementation, no drift — then asserts invariants
 * against the real .accdb. Writes NOTHING.
 *
 *   node scripts/dry-run-import.mjs "C:/Users/user/Downloads/krishna_mobile_database.accdb"
 */
import { build } from 'esbuild'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const accdb = process.argv[2] || 'C:/Users/user/Downloads/krishna_mobile_database.accdb'

// 1. Transpile the pure core to a temp ESM bundle (mdb-reader kept external).
const outdir = mkdtempSync(join(tmpdir(), 'kimport-'))
const outfile = join(outdir, 'core.mjs')
await build({
  entryPoints: ['src/main/services/importAccessCore.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent'
})
const core = await import(pathToFileURL(outfile).href)

// 2. Run the planner with EMPTY existing-state (everything is a fresh insert)
//    and a deterministic id factory.
let n = 0
const makeId = () => `id-${++n}`
const tables = core.readAccessFile(accdb)
const plan = core.buildImportPlan(tables, { phones: new Map(), aadhaars: new Map(), loanNos: new Set() }, makeId)
const { customers, loans, warnings, stats } = plan
const round2 = core.round2
const addMonths = core.addMonths

// 3. Assertions.
let failures = 0
const oks = []
function assert(cond, msg) {
  if (cond) oks.push(msg)
  else {
    failures++
    console.error(`  FAIL  ${msg}`)
  }
}

console.log('=== FILE COUNTS ===')
console.log(stats)

assert(stats.customersInFile === 197, `197 customers in file (${stats.customersInFile})`)
assert(stats.loansInFile === 241, `241 loans in file (${stats.loansInFile})`)
assert(stats.repaymentsInFile === 1222, `1222 repayment rows in file (${stats.repaymentsInFile})`)
assert(stats.carryForwardRowsExcluded === 65, `65 carry-forward rows excluded (${stats.carryForwardRowsExcluded})`)
assert(stats.foreclosed === 3, `3 foreclosed loans (matches source FORECLOSURE flag) (${stats.foreclosed})`)

// Customer accounting: insert + match == file rows; no dupes -> match 0.
assert(
  stats.customersToInsert + stats.customersMatchedExisting === stats.customersInFile,
  `customer insert(${stats.customersToInsert}) + match(${stats.customersMatchedExisting}) == file(${stats.customersInFile})`
)
assert(stats.customersMatchedExisting === 0, `no phone collisions within the file (${stats.customersMatchedExisting} matched)`)

// Loan accounting: every non-orphan, non-blank loan is inserted.
const orphanWarnings = warnings.filter((w) => w.code === 'LOAN_ORPHAN').length
const blankWarnings = warnings.filter((w) => w.code === 'LOAN_NO_BLANK').length
assert(orphanWarnings === 0, `no orphan loans (all CUS IDs resolved) (${orphanWarnings})`)
assert(
  stats.loansToInsert === stats.loansInFile - orphanWarnings - blankWarnings,
  `loansToInsert(${stats.loansToInsert}) == file(${stats.loansInFile}) - orphans(${orphanWarnings}) - blanks(${blankWarnings})`
)
assert(stats.active + stats.closed + stats.foreclosed === stats.loansToInsert, `status breakdown sums to loansToInsert`)

// Every customerId referenced by a loan exists in the planned customer set.
const custIds = new Set(customers.map((c) => c.newId))
assert(loans.every((l) => custIds.has(l.customerId)), `every loan.customerId resolves to a planned customer`)

// Per-loan structural invariants.
let negInstallment = 0
let scheduleLenMismatch = 0
let payableMismatch = 0
let overpaidInstallment = 0
let outstandingNeg = 0
let outstandingFormula = 0
let closedNotFullyPaid = 0
let penaltyMismatch = 0
let dueDateNonMonotonic = 0
let endDateMismatch = 0
let statusBad = 0
let paidExceedsPayable = 0

for (const l of loans) {
  if (!['ACTIVE', 'CLOSED', 'FORECLOSED'].includes(l.status)) statusBad++
  if (l.schedule.length !== l.tenure) scheduleLenMismatch++
  if (l.schedule.some((s) => s.scheduledEmi < 0)) negInstallment++
  if (l.schedule.some((s) => s.actualEmiPaid > s.scheduledEmi + 0.01)) overpaidInstallment++

  const schedSum = round2(l.schedule.reduce((a, s) => a + s.scheduledEmi, 0))
  if (Math.abs(schedSum - l.totalPayable) > 0.01) payableMismatch++

  const paidToSchedule = round2(l.schedule.reduce((a, s) => a + s.actualEmiPaid, 0))
  if (paidToSchedule > l.totalPayable + 0.01) paidExceedsPayable++

  if (l.currentOutstanding < 0) outstandingNeg++
  if (l.status === 'ACTIVE') {
    if (Math.abs(l.currentOutstanding - round2(l.totalPayable - paidToSchedule)) > 0.01) outstandingFormula++
  } else {
    if (l.currentOutstanding !== 0) outstandingFormula++
  }
  if (l.status === 'CLOSED' && paidToSchedule < l.totalPayable - 0.5) closedNotFullyPaid++

  const penSum = round2(l.schedule.reduce((a, s) => a + s.penaltyAmount, 0))
  if (Math.abs(penSum - l.penaltyCollected) > 0.01) penaltyMismatch++

  for (let i = 1; i < l.schedule.length; i++) {
    if (l.schedule[i].dueDate <= l.schedule[i - 1].dueDate) dueDateNonMonotonic++
  }
  if (l.schedule.length) {
    if (l.schedule[0].dueDate !== l.emiStartDate) endDateMismatch++
    if (l.emiEndDate !== l.schedule[l.schedule.length - 1].dueDate) endDateMismatch++
    if (l.emiEndDate !== addMonths(l.emiStartDate, l.tenure - 1)) endDateMismatch++
  }
}

assert(statusBad === 0, `all loan statuses are valid (${statusBad} bad)`)
assert(scheduleLenMismatch === 0, `schedule length == tenure for every loan (${scheduleLenMismatch} mismatches)`)
assert(negInstallment === 0, `no negative installment amounts (${negInstallment})`)
assert(overpaidInstallment === 0, `no installment paid beyond its scheduled amount (${overpaidInstallment})`)
assert(payableMismatch === 0, `schedule sums exactly to totalPayable for every loan (${payableMismatch})`)
assert(paidExceedsPayable === 0, `paid-to-schedule never exceeds totalPayable (${paidExceedsPayable})`)
assert(outstandingNeg === 0, `no negative outstanding (${outstandingNeg})`)
assert(outstandingFormula === 0, `outstanding matches totalPayable - paid (ACTIVE) / 0 (closed) (${outstandingFormula})`)
assert(closedNotFullyPaid === 0, `every CLOSED loan is actually fully paid (${closedNotFullyPaid})`)
assert(penaltyMismatch === 0, `per-installment penalties sum to loan penalty_collected (${penaltyMismatch})`)
assert(dueDateNonMonotonic === 0, `due dates strictly increase within each schedule (${dueDateNonMonotonic})`)
assert(endDateMismatch === 0, `emiStartDate/emiEndDate line up with the generated schedule (${endDateMismatch})`)

// Spot checks on known loans.
function findLoan(no) {
  return loans.find((l) => l.loanNo === no)
}
const k10 = findLoan('KL26-0010')
assert(!!k10, 'KL26-0010 present')
if (k10) {
  assert(k10.tenure === 7 && k10.monthlyEmi === 1850, `KL26-0010 tenure 7 x 1850`)
  assert(k10.totalPayable === 12950, `KL26-0010 totalPayable 12950 (${k10.totalPayable})`)
  assert(k10.status === 'CLOSED', `KL26-0010 CLOSED (${k10.status})`)
  assert(k10.currentOutstanding === 0, `KL26-0010 outstanding 0 (${k10.currentOutstanding})`)
}
const k18 = findLoan('KL26-0018')
assert(!!k18, 'KL26-0018 present (the tenure-mismatch loan)')
if (k18) {
  assert(k18.tenure === 6, `KL26-0018 tenure 6 (${k18.tenure})`)
  assert(k18.schedule.length === 6, `KL26-0018 schedule capped at tenure (${k18.schedule.length})`)
  assert(k18.currentOutstanding >= 0, `KL26-0018 outstanding non-negative (${k18.currentOutstanding})`)
}

console.log(`\n=== STATUS BREAKDOWN ===`)
console.log(`ACTIVE ${stats.active}  CLOSED ${stats.closed}  FORECLOSED ${stats.foreclosed}`)
console.log(`financed ₹${stats.totalFinanced}  payable ₹${stats.totalPayable}  outstanding ₹${stats.totalOutstanding}`)
console.log(`penalty collected ₹${stats.penaltyCollected}`)
console.log(`overshoot loans ${stats.overshootLoans}, total excess ₹${stats.overshootTotal}`)

console.log(`\n=== WARNINGS (${warnings.length}) ===`)
const byCode = {}
for (const w of warnings) byCode[w.code] = (byCode[w.code] ?? 0) + 1
console.log(byCode)
for (const w of warnings.slice(0, 12)) console.log(`  [${w.code}] ${w.message}`)

console.log(`\n=== SAMPLE LOANS ===`)
for (const l of loans.slice(0, 6)) {
  const paid = round2(l.totalPayable - l.currentOutstanding)
  console.log(
    `${l.loanNo}  ${(l.brand ?? '') + ' ' + (l.modelName ?? '')}`.padEnd(40),
    `t=${l.tenure} emi=${l.monthlyEmi} payable=${l.totalPayable} paid=${paid} out=${l.currentOutstanding} ${l.status}`
  )
}

console.log(`\n${'='.repeat(60)}`)
console.log(`${oks.length} checks passed, ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
