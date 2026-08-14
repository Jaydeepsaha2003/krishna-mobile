/**
 * Verifies repair profit accounting: the manually entered repair cost and the
 * landed cost of any stock parts both reduce profit, and nothing else changes.
 * Mirrors createSale's per-line cost rules.
 */
let fails = 0
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

/**
 * total     = labour + parts charged to the customer
 * costTotal = repairCost (service line) + Σ part landed costs
 */
function repairBill({ labour = 0, repairCost = 0, parts = [] }) {
  const partsCharged = parts.reduce((a, p) => a + p.price * (p.qty ?? 1), 0)
  const partsCost = parts.reduce((a, p) => a + p.cost * (p.qty ?? 1), 0)
  const total = round2(labour + partsCharged)
  const costTotal = round2(repairCost + partsCost)
  return { total, costTotal, profit: round2(total - costTotal) }
}

console.log('--- labour only ---')
let r = repairBill({ labour: 500 })
chk(r.profit === 500, 'labour ₹500, no cost entered -> profit ₹500')

r = repairBill({ labour: 500, repairCost: 200 })
chk(r.costTotal === 200 && r.profit === 300, 'labour ₹500 with ₹200 cost -> profit ₹300')

console.log('\n--- labour + a part taken from stock ---')
r = repairBill({ labour: 300, parts: [{ price: 900, cost: 600 }] })
chk(r.total === 1200, 'customer pays ₹1200 (₹300 labour + ₹900 part)')
chk(r.costTotal === 600, 'cost is the part’s landed cost ₹600')
chk(r.profit === 600, 'profit ₹600')

console.log('\n--- both: outside technician AND a stock part ---')
r = repairBill({ labour: 300, repairCost: 150, parts: [{ price: 900, cost: 600 }] })
chk(r.costTotal === 750, 'costs add up: ₹150 repair + ₹600 part = ₹750')
chk(r.profit === 450, 'profit ₹450 (₹1200 − ₹750)')

console.log('\n--- multiple parts with quantity ---')
r = repairBill({ labour: 100, repairCost: 50, parts: [{ price: 200, cost: 120, qty: 3 }] })
chk(r.total === 700, 'total ₹700 (₹100 + 3×₹200)')
chk(r.costTotal === 410, 'cost ₹410 (₹50 + 3×₹120)')
chk(r.profit === 290, 'profit ₹290')

console.log('\n--- edge cases ---')
r = repairBill({ labour: 500, repairCost: 500 })
chk(r.profit === 0, 'cost equal to the charge -> zero profit, not negative-by-accident')
r = repairBill({ labour: 300, repairCost: 500 })
chk(r.profit === -200, 'a loss is reported honestly as −₹200, not hidden')
r = repairBill({ labour: 0, repairCost: 0, parts: [{ price: 250, cost: 150 }] })
chk(r.profit === 100, 'parts-only repair (no labour) still correct: ₹100')
r = repairBill({ labour: 500, repairCost: 0 })
chk(r.costTotal === 0 && r.profit === 500, 'blank cost field behaves as ₹0')

console.log('\n--- decimals ---')
r = repairBill({ labour: 199.5, repairCost: 49.25 })
chk(r.profit === 150.25, `decimal amounts round correctly (₹${r.profit})`)

console.log(`\n${fails === 0 ? 'ALL REPAIR COST CHECKS PASSED' : fails + ' FAILED'}`)
process.exit(fails === 0 ? 0 : 1)
