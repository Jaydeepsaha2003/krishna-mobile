/** Verifies buildEmiSchedule's math without needing Electron (pure logic, copied 1:1). */
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100 }
function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}
function buildEmiSchedule({ tenure, loanAmount, emiStartDate, monthlyEmiOverride }) {
  const flat = Boolean(monthlyEmiOverride && monthlyEmiOverride > 0)
  const monthlyEmi = flat ? round2(monthlyEmiOverride) : round2(loanAmount / tenure)
  const schedule = []
  if (flat) {
    for (let i = 1; i <= tenure; i++) schedule.push({ emiNo: i, dueDate: addMonths(emiStartDate, i - 1), scheduledEmi: monthlyEmi })
  } else {
    let allocated = 0
    for (let i = 1; i <= tenure; i++) {
      const scheduledEmi = i === tenure ? round2(loanAmount - allocated) : monthlyEmi
      allocated = round2(allocated + scheduledEmi)
      schedule.push({ emiNo: i, dueDate: addMonths(emiStartDate, i - 1), scheduledEmi })
    }
  }
  return { schedule, monthlyEmi, totalPayable: round2(schedule.reduce((a, r) => a + r.scheduledEmi, 0)), emiEndDate: schedule.at(-1).dueDate }
}

let failures = 0
function assert(cond, msg) { if (cond) console.log(`  OK   ${msg}`); else { failures++; console.error(`  FAIL ${msg}`) } }

console.log('1. The exact bug case: tenure=7, loanAmount=11000 (principal), EMI overridden to 1850')
const r1 = buildEmiSchedule({ tenure: 7, loanAmount: 11000, emiStartDate: '2026-02-01', monthlyEmiOverride: 1850 })
assert(r1.schedule.every((s) => s.scheduledEmi === 1850), 'every installment is flat 1850, including the last')
assert(r1.schedule.every((s) => s.scheduledEmi > 0), 'no installment is negative or zero')
assert(r1.totalPayable === 12950, `totalPayable is 1850*7=12950, exceeding the 11000 principal (${r1.totalPayable})`)
assert(r1.emiEndDate === '2026-08-01', `end date is 6 months after start (${r1.emiEndDate})`)

console.log('\n2. Old auto-calculate path is unaffected (no override given)')
const r2 = buildEmiSchedule({ tenure: 6, loanAmount: 15000, emiStartDate: '2026-01-01' })
assert(r2.monthlyEmi === 2500, `auto EMI = 15000/6 = 2500 (${r2.monthlyEmi})`)
assert(r2.totalPayable === 15000, `totalPayable reconciles exactly to the principal (${r2.totalPayable})`)

console.log('\n3. Auto-calculate WITH a rounding remainder (10000/3 does not divide evenly)')
const r3 = buildEmiSchedule({ tenure: 3, loanAmount: 10000, emiStartDate: '2026-01-05' })
const sum3 = round2(r3.schedule.reduce((a, s) => a + s.scheduledEmi, 0))
assert(sum3 === 10000, `schedule still sums exactly despite the remainder (${sum3})`)
assert(r3.schedule.slice(0, 2).every((s) => s.scheduledEmi === r3.monthlyEmi), 'first 2 installments are the flat auto EMI (3333.33)')
assert(r3.schedule[2].scheduledEmi !== r3.monthlyEmi, `last installment absorbs the remainder — ${r3.schedule[2].scheduledEmi} vs flat ${r3.monthlyEmi}`)

console.log('\n4. Override EMI lower than an even auto-split (markup could go either way)')
const r4 = buildEmiSchedule({ tenure: 5, loanAmount: 10000, emiStartDate: '2026-01-01', monthlyEmiOverride: 1500 })
assert(r4.totalPayable === 7500, `totalPayable (7500) can be LESS than principal (10000) too — a discount case (${r4.totalPayable})`)
assert(r4.schedule.every((s) => s.scheduledEmi === 1500), 'still flat, still all positive')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
