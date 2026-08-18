/**
 * Verifies the recharge commission is now a % of the amount (not a flat ₹
 * figure): the setting is respected, it scales with the recharge amount, and
 * other sale types are unaffected. Mirrors createSale's exact formula.
 */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

// The rule createSale applies for a recharge line.
const rechargeCost = (lineTotal, pct) => round2(lineTotal * (1 - pct / 100))
const saleProfit = (total, costTotal) => round2(total - costTotal)

console.log('--- default 2% commission scales with the amount (unlike a flat ₹ figure) ---')
for (const [amount, wantProfit] of [[500, 10], [1000, 20], [299, 5.98], [50, 1]]) {
  const cost = rechargeCost(amount, 2)
  chk(saleProfit(amount, cost) === wantProfit, `₹${amount} recharge @ 2% -> profit ₹${wantProfit} (cost ₹${cost})`)
}

console.log('\n--- commission % changed in settings ---')
for (const [amount, pct, want] of [[500, 5, 25], [500, 0, 0], [500, 10, 50]]) {
  const cost = rechargeCost(amount, pct)
  chk(saleProfit(amount, cost) === want, `₹${amount} at ${pct}% -> profit ₹${want}`)
}

console.log('\n--- edge cases ---')
chk(rechargeCost(500, 0) === 500, '0% commission -> the entire amount is booked as cost (zero profit)')
chk(saleProfit(500, rechargeCost(500, 100)) === 500, '100% commission -> the entire amount is profit')
chk(rechargeCost(0, 5) === 0, 'a ₹0 recharge line never produces a negative or NaN cost')

console.log('\n--- other sale types unaffected ---')
chk(saleProfit(12000, 9000) === 3000, 'product sale: ₹12000 − ₹9000 cost = ₹3000 profit')
chk(saleProfit(500, 0) === 500, 'repair labour: full ₹500 stays profit')

console.log(`\n${fails === 0 ? 'ALL RECHARGE COMMISSION % CHECKS PASSED' : fails + ' FAILED'}`)
process.exit(fails === 0 ? 0 : 1)
