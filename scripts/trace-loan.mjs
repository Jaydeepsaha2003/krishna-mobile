import MDBReader from 'mdb-reader'
import { readFileSync } from 'node:fs'
const reader = new MDBReader(readFileSync(process.argv[2]))
const loans = reader.getTable('LOAN TBL').getData()
const repayments = reader.getTable('LOAN REPAYMENT').getData()

const key = (r) => `${r['LOAN ID']}::${r['EMI NO']}`
const counts = new Map()
for (const r of repayments) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1)
const dupes = [...counts.entries()].filter(([, n]) => n > 1)
console.log('duplicate (loan,emi_no) pairs:', dupes.length, dupes.slice(0, 10))

const loan = loans.find((l) => l['LOAN ID'] === 'KL26-0010')
console.log('\nLoan KL26-0010:', JSON.stringify(loan, null, 2))
console.log('\nAll repayment rows for KL26-0010:')
console.log(repayments.filter((r) => r['LOAN ID'] === 'KL26-0010'))

const loan18 = loans.find((l) => l['LOAN ID'] === 'KL26-0018')
console.log('\nLoan KL26-0018 (the tenure mismatch one):', JSON.stringify(loan18, null, 2))
console.log('\nAll repayment rows for KL26-0018:')
console.log(repayments.filter((r) => r['LOAN ID'] === 'KL26-0018'))

const paidByLoanNoCarry = new Map()
const paidByLoanWithCarry = new Map()
for (const r of repayments) {
  const amt = Number(r['ACTUAL EMI PAID'] || 0)
  paidByLoanWithCarry.set(r['LOAN ID'], (paidByLoanWithCarry.get(r['LOAN ID']) ?? 0) + amt)
  if (r['PAY MODE'] !== 'CARRY FORWARD') {
    paidByLoanNoCarry.set(r['LOAN ID'], (paidByLoanNoCarry.get(r['LOAN ID']) ?? 0) + amt)
  }
}
let overpaidWith = 0, overpaidWithout = 0
for (const l of loans) {
  if ((paidByLoanWithCarry.get(l['LOAN ID']) ?? 0) - l['LOAN AMOUNT'] > 1) overpaidWith++
  if ((paidByLoanNoCarry.get(l['LOAN ID']) ?? 0) - l['LOAN AMOUNT'] > 1) overpaidWithout++
}
console.log('\noverpaid counting carry-forward rows:', overpaidWith)
console.log('overpaid EXCLUDING carry-forward rows:', overpaidWithout)

// Pick 3 more random loans with carry-forward rows to eyeball
const cfLoanIds = [...new Set(repayments.filter((r) => r['PAY MODE'] === 'CARRY FORWARD').map((r) => r['LOAN ID']))]
console.log('\nLoans with carry-forward rows:', cfLoanIds.length)
for (const id of cfLoanIds.slice(0, 2)) {
  const l = loans.find((x) => x['LOAN ID'] === id)
  console.log(`\n--- ${id} --- tenure=${l['LOAN TENURE']} monthlyEmi=${l['MONTHLY EMI']} loanAmt=${l['LOAN AMOUNT']}`)
  console.log(
    repayments
      .filter((r) => r['LOAN ID'] === id)
      .sort((a, b) => a['EMI NO'] - b['EMI NO'])
      .map((r) => ({
        emi: r['EMI NO'],
        date: r['REPAY DATE'],
        paid: r['ACTUAL EMI PAID'],
        mode: r['PAY MODE'],
        ref: r['PAY REFERENCE'],
        penaltyCharged: r['IS PENALTY CHARGED'],
        penaltyAmt: r['PENALTY AMOUNT']
      }))
  )
}
