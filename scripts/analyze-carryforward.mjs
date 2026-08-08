import MDBReader from 'mdb-reader'
import { readFileSync } from 'node:fs'
const reader = new MDBReader(readFileSync(process.argv[2]))
const loans = reader.getTable('LOAN TBL').getData()
const repayments = reader.getTable('LOAN REPAYMENT').getData()

const byLoan = new Map()
for (const r of repayments) {
  const id = r['LOAN ID']
  if (!byLoan.has(id)) byLoan.set(id, [])
  byLoan.get(id).push(r)
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }

// The correct payable baseline is tenure x monthly EMI, NOT the bare principal.
let overshootWith = 0
let overshootWithout = 0
let matchWithout = 0
let underWithout = 0
const overshootExamples = []
const carryMattersExamples = []

for (const l of loans) {
  const id = l['LOAN ID']
  const tenure = Number(l['LOAN TENURE'] || 0)
  const emi = Number(l['MONTHLY EMI'] || 0)
  const principal = Number(l['LOAN AMOUNT'] || 0)
  const rows = byLoan.get(id) ?? []

  const paidWith = round2(rows.reduce((a, r) => a + Number(r['ACTUAL EMI PAID'] || 0), 0))
  const paidWithout = round2(
    rows.filter((r) => r['PAY MODE'] !== 'CARRY FORWARD').reduce((a, r) => a + Number(r['ACTUAL EMI PAID'] || 0), 0)
  )
  // payable that the fresh schedule will sum to, if we keep the EMI flat over tenure
  const payable = emi > 0 ? round2(emi * tenure) : principal

  if (paidWith - payable > 1) overshootWith++
  if (paidWithout - payable > 1) {
    overshootWithout++
    if (overshootExamples.length < 8)
      overshootExamples.push({ id, tenure, emi, principal, payable, paidWithout, paidWith })
  } else if (Math.abs(paidWithout - payable) <= 1) {
    matchWithout++
  } else {
    underWithout++
  }

  // Where does excluding carry-forward actually change the closed/overshoot verdict?
  const carryTotal = round2(paidWith - paidWithout)
  if (carryTotal > 1 && (paidWith - payable > 1) !== (paidWithout - payable > 1)) {
    if (carryMattersExamples.length < 10)
      carryMattersExamples.push({ id, tenure, emi, payable, paidWith, paidWithout, carryTotal })
  }
}

console.log('=== Against the CORRECT baseline (tenure x MONTHLY EMI) ===')
console.log('loans total:', loans.length)
console.log('paid overshoots payable, INCLUDING carry-forward:', overshootWith)
console.log('paid overshoots payable, EXCLUDING carry-forward:', overshootWithout)
console.log('paid ~matches payable (within Rs1), excluding carry-forward:', matchWithout)
console.log('paid under payable (still owing), excluding carry-forward:', underWithout)

console.log('\n=== Loans where the carry-forward decision FLIPS the overshoot verdict ===')
console.log('count:', carryMattersExamples.length)
console.log(carryMattersExamples)

console.log('\n=== Remaining overshoot examples EXCLUDING carry-forward (real anomalies?) ===')
console.log(overshootExamples)

// How much do carry-forward rows total across all loans, and how many loans have them
const cfRows = repayments.filter((r) => r['PAY MODE'] === 'CARRY FORWARD')
const cfLoans = new Set(cfRows.map((r) => r['LOAN ID']))
console.log('\ncarry-forward rows:', cfRows.length, 'across', cfLoans.size, 'loans')
console.log('carry-forward total amount:', round2(cfRows.reduce((a, r) => a + Number(r['ACTUAL EMI PAID'] || 0), 0)))
