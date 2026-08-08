import MDBReader from 'mdb-reader'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
const buffer = readFileSync(path)
const reader = new MDBReader(buffer)

const loans = reader.getTable('LOAN TBL').getData()
const customers = reader.getTable('CUSTOMER TBL').getData()
const products = reader.getTable('PRODUCT TBL').getData()
const repayments = reader.getTable('LOAN REPAYMENT').getData()

const count = (arr) => arr.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map())
const show = (map, n = 20) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

console.log('--- FORECLOSURE distinct values ---')
console.log(show(count(loans.map((l) => JSON.stringify(l.FORECLOSURE)))))

console.log('\n--- LOAN ID uniqueness ---')
const loanIds = loans.map((l) => l['LOAN ID'])
console.log('total loans:', loans.length, 'distinct LOAN ID:', new Set(loanIds).size)
console.log('any null/blank LOAN ID:', loans.filter((l) => !l['LOAN ID']).length)

console.log('\n--- CUS ID orphans (loan references missing customer) ---')
const custIds = new Set(customers.map((c) => c.ID))
const orphanLoans = loans.filter((l) => l['CUS ID'] != null && !custIds.has(l['CUS ID']))
console.log('orphan loans:', orphanLoans.length, orphanLoans.slice(0, 3))
console.log('loans with null CUS ID:', loans.filter((l) => l['CUS ID'] == null).length)

console.log('\n--- Repayment LOAN ID orphans (repayment references missing loan) ---')
const loanIdSet = new Set(loanIds)
const orphanRepay = repayments.filter((r) => !loanIdSet.has(r['LOAN ID']))
console.log('orphan repayments:', orphanRepay.length, orphanRepay.slice(0, 3))

console.log('\n--- Phone validity (customers) ---')
const phoneOk = (p) => /^[6-9][0-9]{9}$/.test(String(p ?? '').replace(/\D/g, ''))
const custPhones = customers.map((c) => c['MOBILE NO'])
console.log('valid 10-digit 6-9 pattern:', custPhones.filter(phoneOk).length, '/', custPhones.length)
console.log('blank/null phone:', custPhones.filter((p) => !p || !String(p).trim()).length)
console.log('sample invalid phones:', custPhones.filter((p) => p && !phoneOk(p)).slice(0, 10))

console.log('\n--- Duplicate phones within CUSTOMER TBL ---')
const phoneCounts = count(custPhones.filter(Boolean))
const dupes = [...phoneCounts.entries()].filter(([, n]) => n > 1)
console.log('duplicate phone numbers:', dupes.length, dupes.slice(0, 10))

console.log('\n--- Aadhaar / PAN fill rate (customers) ---')
console.log('non-blank aadhar:', customers.filter((c) => c['AADHAR NUMBER']?.trim()).length)
console.log('non-blank pan:', customers.filter((c) => c['PAN NO']?.trim()).length)
const aadhaarSample = customers.filter((c) => c['AADHAR NUMBER']?.trim()).slice(0, 5).map((c) => c['AADHAR NUMBER'])
console.log('aadhaar samples:', aadhaarSample)

console.log('\n--- LOAN TBL: customer fields present when CUSTOMER TBL blank? ---')
const loanAadhaarFilled = loans.filter((l) => l['AADHAR NUMBER']?.trim()).length
console.log('loans with non-blank AADHAR NUMBER:', loanAadhaarFilled, '/', loans.length)

console.log('\n--- Repayments per loan vs tenure ---')
const repayByLoan = new Map()
for (const r of repayments) {
  const arr = repayByLoan.get(r['LOAN ID']) ?? []
  arr.push(r)
  repayByLoan.set(r['LOAN ID'], arr)
}
let mismatchExamples = []
for (const l of loans.slice(0, 400)) {
  const rows = repayByLoan.get(l['LOAN ID']) ?? []
  const distinctEmiNo = new Set(rows.map((r) => r['EMI NO'])).size
  if (distinctEmiNo > l['LOAN TENURE']) mismatchExamples.push({ loanId: l['LOAN ID'], tenure: l['LOAN TENURE'], distinctEmiNo })
}
console.log('loans where distinct EMI NO paid > tenure:', mismatchExamples.length, mismatchExamples.slice(0, 5))

console.log('\n--- IS PENALTY CHARGED distinct + PENALTY AMOUNT stats ---')
console.log(show(count(repayments.map((r) => r['IS PENALTY CHARGED']))))
console.log('repayments with penalty > 0:', repayments.filter((r) => Number(r['PENALTY AMOUNT']) > 0).length)

console.log('\n--- CLEAR AMT OF EMI non-zero? ---')
console.log('non-zero:', repayments.filter((r) => Number(r['CLEAR AMT OF EMI']) !== 0).length)
console.log('sample non-zero rows:', repayments.filter((r) => Number(r['CLEAR AMT OF EMI']) !== 0).slice(0, 3))

console.log('\n--- PAY MODE distinct values ---')
console.log(show(count(repayments.map((r) => r['PAY MODE']))))

console.log('\n--- Product brand/category/model overlap with loans BRAND/PRODUCT/MODEL ---')
console.log('distinct PRODUCT TBL brands:', new Set(products.map((p) => p['PRODUCT BRAND'])).size)
console.log('distinct LOAN TBL brands:', new Set(loans.map((l) => l['BRAND'])).size)
console.log('sample loan brand/product/model triples:', loans.slice(0, 5).map((l) => ({ brand: l.BRAND, product: l.PRODUCT, model: l.MODEL })))

console.log('\n--- Loan outstanding vs paid sum (compute status) ---')
const paidByLoan = new Map()
for (const r of repayments) {
  paidByLoan.set(r['LOAN ID'], (paidByLoan.get(r['LOAN ID']) ?? 0) + Number(r['ACTUAL EMI PAID'] || 0))
}
let active = 0, closed = 0, overpaid = 0
for (const l of loans) {
  const paid = paidByLoan.get(l['LOAN ID']) ?? 0
  const outstanding = Number(l['LOAN AMOUNT']) - paid
  if (outstanding <= 0) closed++
  else active++
  if (outstanding < -1) overpaid++
}
console.log({ active, closed, overpaid, totalLoans: loans.length })

console.log('\n--- IMEI fill rate ---')
console.log('non-blank IMEI:', loans.filter((l) => l['IMEI NO']?.trim()).length, '/', loans.length)
