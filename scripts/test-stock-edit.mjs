/**
 * Verifies the admin stock-edit feature: per-unit price correction refuses on
 * sold units, and the model-level qty/rate correction (a) bulk-corrects price
 * on existing shelf units without touching sold/removed ones, (b) delegates
 * qty increases to addManualStock-style inserts using the inferred cost when
 * none is given, and (c) delegates qty decreases to FIFO removal.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'stockedit-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 's.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

const now = '2026-08-14T00:00:00.000Z'
const co = uid(), shop = uid(), brand = uid(), model = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })
await db.execute({ sql: `INSERT INTO shops (id,company_id,name,code,is_active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`, args: [shop, co, 'S1', 'S1', now, now] })
await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [brand, co, 'GENERIC', now, now] })
// A non-IMEI accessory: 5 chargers @ cost ₹100, sell ₹150.
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,default_price,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,150,1,?,?)`, args: [model, co, brand, 'CHARGER 25W', 'GEN-CHG', 'Accessory', now, now] })
const unitIds = []
for (let i = 0; i < 5; i++) {
  const id = uid()
  unitIds.push(id)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?,?)`, args: [id, co, model, shop, 100, 150, now, now] })
}
// A sold unit of the same model — must never be touched by any correction.
const soldId = uid()
await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?, 'sold',?,?,?,?,?)`, args: [soldId, co, model, shop, 100, 150, now, now] })

/* -------------------------------------------------------- per-unit edit -- */
console.log('--- per-unit edit (updateStockUnit logic) ---')
async function updateStockUnit(id, { costPrice, salePrice } = {}) {
  const unit = (await db.execute({ sql: `SELECT * FROM stock_units WHERE id=?`, args: [id] })).rows[0]
  if (unit.status === 'sold') throw new Error('BAD_STATUS: unit already sold')
  const cp = costPrice === undefined ? unit.cost_price : round2(costPrice)
  const sp = salePrice === undefined ? unit.sale_price : round2(salePrice)
  await db.execute({ sql: `UPDATE stock_units SET cost_price=?, sale_price=? WHERE id=?`, args: [cp, sp, id] })
  return { cp, sp }
}

await updateStockUnit(unitIds[0], { costPrice: 110, salePrice: 175 })
const u0 = (await db.execute({ sql: `SELECT cost_price, sale_price FROM stock_units WHERE id=?`, args: [unitIds[0]] })).rows[0]
chk(u0.cost_price === 110 && u0.sale_price === 175, 'in-stock unit price corrected (₹100→₹110, ₹150→₹175)')

let refused = false
try { await updateStockUnit(soldId, { costPrice: 999 }) } catch (e) { refused = /BAD_STATUS/.test(e.message) }
chk(refused, 'editing a SOLD unit is refused — its invoice already snapshotted the old cost')
const soldAfter = (await db.execute({ sql: `SELECT cost_price FROM stock_units WHERE id=?`, args: [soldId] })).rows[0]
chk(soldAfter.cost_price === 100, 'the sold unit keeps its original cost price untouched')

/* --------------------------------------------------- model-level correct - */
console.log('\n--- model-level qty/rate correction (editModelStock logic) ---')

async function currentQty(modelId, shopId) {
  return (await db.execute({ sql: `SELECT COUNT(*) n FROM stock_units WHERE model_id=? AND current_shop_id=? AND status='in_stock'`, args: [modelId, shopId] })).rows[0].n
}
async function priorAvgCost(modelId, shopId) {
  const r = (await db.execute({ sql: `SELECT AVG(cost_price) a FROM stock_units WHERE model_id=? AND current_shop_id=? AND status='in_stock'`, args: [modelId, shopId] })).rows[0]
  return r.a === null ? null : Number(r.a)
}
async function bulkCorrectPrice(modelId, shopId, { costPrice, salePrice }) {
  const sets = [], args = []
  if (costPrice !== undefined) { sets.push('cost_price=?'); args.push(round2(costPrice)) }
  if (salePrice !== undefined) { sets.push('sale_price=?'); args.push(round2(salePrice)) }
  if (!sets.length) return
  await db.execute({ sql: `UPDATE stock_units SET ${sets.join(',')} WHERE model_id=? AND current_shop_id=? AND status='in_stock'`, args: [...args, modelId, shopId] })
}
async function insertUnits(modelId, shopId, qty, costPrice, salePrice) {
  for (let i = 0; i < qty; i++)
    await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?,?)`, args: [uid(), co, modelId, shopId, round2(costPrice), round2(salePrice), now, now] })
}
async function removeUnitsFifo(modelId, shopId, qty, toStatus) {
  const ids = (await db.execute({ sql: `SELECT id FROM stock_units WHERE model_id=? AND current_shop_id=? AND status='in_stock' ORDER BY added_at LIMIT ?`, args: [modelId, shopId, qty] })).rows.map((r) => r.id)
  for (const id of ids) await db.execute({ sql: `UPDATE stock_units SET status=? WHERE id=?`, args: [toStatus, id] })
  return ids.length
}

/** Mirrors editModelStock: correct price on existing units first, then apply qty delta. */
async function editModelStock(modelId, shopId, { targetQty, costPrice, salePrice, toStatus }) {
  const before = await currentQty(modelId, shopId)
  const priorAvg = before > 0 ? await priorAvgCost(modelId, shopId) : null
  const rateGiven = costPrice !== undefined || salePrice !== undefined
  if (rateGiven && before > 0) await bulkCorrectPrice(modelId, shopId, { costPrice, salePrice })

  let delta = 0
  if (targetQty !== undefined) {
    delta = targetQty - before
    if (delta > 0) {
      const inferredCost = costPrice !== undefined ? costPrice : priorAvg
      if (inferredCost === null) throw new Error('VALIDATION: cost price required, nothing to infer from')
      await insertUnits(modelId, shopId, delta, inferredCost, salePrice ?? 150)
    } else if (delta < 0) {
      await removeUnitsFifo(modelId, shopId, -delta, toStatus ?? 'damaged')
    }
  }
  return { before, after: before + delta }
}

// 1) price-only correction: 5 in-stock units at ₹100→₹120, sold unit untouched.
let r = await editModelStock(model, shop, { costPrice: 120 })
let costs = (await db.execute({ sql: `SELECT cost_price FROM stock_units WHERE model_id=? AND status='in_stock'`, args: [model] })).rows.map((x) => x.cost_price)
chk(costs.every((c) => c === 120), `all 5 in-stock units corrected to ₹120 (${JSON.stringify(costs)})`)
let soldCost = (await db.execute({ sql: `SELECT cost_price FROM stock_units WHERE id=?`, args: [soldId] })).rows[0].cost_price
chk(soldCost === 100, 'sold unit still untouched by the bulk price correction')

// 2) qty increase without an explicit cost price -> infers the shelf's own average (₹120, post-correction).
r = await editModelStock(model, shop, { targetQty: 8 })
chk(r.before === 5 && r.after === 8, `qty corrected 5→8 (delegating to an add of 3)`)
const newUnits = (await db.execute({ sql: `SELECT cost_price FROM stock_units WHERE model_id=? AND status='in_stock' ORDER BY added_at DESC LIMIT 3`, args: [model] })).rows
chk(newUnits.every((u) => u.cost_price === 120), 'the 3 newly added units inherited the inferred cost price (₹120), not ₹0')

// 3) qty decrease -> FIFO removal, sold unit still never touched.
r = await editModelStock(model, shop, { targetQty: 3, toStatus: 'damaged' })
chk(r.before === 8 && r.after === 3, 'qty corrected 8→3 (delegating to a FIFO removal of 5)')
const remaining = await currentQty(model, shop)
chk(remaining === 3, `exactly 3 units remain in_stock (${remaining})`)
const damagedCount = (await db.execute({ sql: `SELECT COUNT(*) n FROM stock_units WHERE model_id=? AND status='damaged'`, args: [model] })).rows[0].n
chk(damagedCount === 5, `5 units moved to damaged (${damagedCount})`)
soldCost = (await db.execute({ sql: `SELECT status FROM stock_units WHERE id=?`, args: [soldId] })).rows[0].status
chk(soldCost === 'sold', 'the sold unit is still sold — qty correction never reaches it')

// 4) qty increase with NO existing stock and no cost price given -> must refuse, not silently insert at ₹0.
const emptyModel = uid()
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,default_price,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,50,1,?,?)`, args: [emptyModel, co, brand, 'CABLE 1M', 'GEN-CBL', 'Accessory', now, now] })
let refusedEmpty = false
try { await editModelStock(emptyModel, shop, { targetQty: 4 }) } catch (e) { refusedEmpty = /VALIDATION/.test(e.message) }
chk(refusedEmpty, 'qty increase on an empty shelf with no cost price is refused, not defaulted to ₹0')

/* ----------------------------------------------------- lot-wise rate edit - */
console.log('\n--- lot-wise stock view + per-lot rate edit (listStockLots / updateStockLotRate) ---')

const lotModel = uid()
await db.execute({ sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,track_imei,default_price,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,1000,1,?,?)`, args: [lotModel, co, brand, 'EARBUDS PRO', 'GEN-EBP', 'Accessory', now, now] })

// Lot A: a purchase bill of 4 units @ ₹500.
const supplier = uid(), purchase = uid()
await db.execute({ sql: `INSERT INTO suppliers (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [supplier, co, 'ACME DISTRIBUTORS', now, now] })
await db.execute({ sql: `INSERT INTO purchases (id,company_id,shop_id,supplier_id,invoice_no,purchase_date,subtotal,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [purchase, co, shop, supplier, 'SUP-001', '2026-08-01', 2000, 2000, now, now] })
for (let i = 0; i < 4; i++)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,purchase_id,supplier_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?,?,?,?)`, args: [uid(), co, lotModel, shop, purchase, supplier, 500, 800, '2026-08-01T10:00:00.000Z', now] })

// Lot B: a manual entry of 3 units @ ₹520, added later.
const manualTs = '2026-08-10T09:00:00.000Z'
for (let i = 0; i < 3; i++)
  await db.execute({ sql: `INSERT INTO stock_units (id,company_id,model_id,status,current_shop_id,cost_price,sale_price,added_at,updated_at) VALUES (?,?,?, 'in_stock',?,?,?,?,?)`, args: [uid(), co, lotModel, shop, 520, 850, manualTs, now] })

// Mirrors listStockLots's grouping query.
async function listStockLots(modelId, shopId) {
  return (await db.execute({
    sql: `SELECT su.purchase_id, su.added_at, su.cost_price, su.sale_price, COUNT(*) AS qty,
                 sp.name AS supplier_name, p.invoice_no
            FROM stock_units su
            LEFT JOIN suppliers sp ON sp.id = su.supplier_id
            LEFT JOIN purchases p ON p.id = su.purchase_id
           WHERE su.company_id = ? AND su.model_id = ? AND su.current_shop_id = ? AND su.status = 'in_stock'
           GROUP BY COALESCE(su.purchase_id, su.added_at), su.cost_price, su.sale_price
           ORDER BY su.added_at DESC`,
    args: [co, modelId, shopId]
  })).rows
}

let lots = await listStockLots(lotModel, shop)
chk(lots.length === 2, `two distinct lots reported (${lots.length})`)
const lotA = lots.find((l) => l.purchase_id === purchase)
const lotB = lots.find((l) => l.purchase_id === null)
chk(lotA?.qty === 4 && lotA?.cost_price === 500, `lot A (purchase bill): 4 units @ ₹500 (${JSON.stringify(lotA)})`)
chk(lotA?.invoice_no === 'SUP-001' && lotA?.supplier_name === 'ACME DISTRIBUTORS', 'lot A carries its purchase bill number and supplier')
chk(lotB?.qty === 3 && lotB?.cost_price === 520, `lot B (manual entry): 3 units @ ₹520 (${JSON.stringify(lotB)})`)
chk(lotB?.invoice_no == null, 'lot B has no bill number — it was a manual entry')

// Mirrors updateStockLotRate: corrects only the matching lot.
async function updateStockLotRate(modelId, shopId, { purchaseId, addedAt, costPrice, salePrice }) {
  const filter = purchaseId ? 'purchase_id = ?' : 'purchase_id IS NULL AND added_at = ?'
  const arg = purchaseId ?? addedAt
  const res = await db.execute({
    sql: `UPDATE stock_units SET cost_price=?, sale_price=? WHERE company_id=? AND model_id=? AND current_shop_id=? AND status='in_stock' AND ${filter}`,
    args: [round2(costPrice), round2(salePrice), co, modelId, shopId, arg]
  })
  return Number(res.rowsAffected ?? 0)
}

const updatedA = await updateStockLotRate(lotModel, shop, { purchaseId: purchase, costPrice: 550, salePrice: 850 })
chk(updatedA === 4, `editing lot A by purchaseId updates exactly its 4 units (${updatedA})`)
let after = await listStockLots(lotModel, shop)
const lotBStill = after.find((l) => l.purchase_id === null)
chk(lotBStill?.cost_price === 520, `lot B's rate (₹520) is untouched by editing lot A (${lotBStill?.cost_price})`)

const updatedB = await updateStockLotRate(lotModel, shop, { addedAt: manualTs, costPrice: 540, salePrice: 870 })
chk(updatedB === 3, `editing lot B by its added_at timestamp updates exactly its 3 units (${updatedB})`)
after = await listStockLots(lotModel, shop)
const lotAStill = after.find((l) => l.purchase_id === purchase)
chk(lotAStill?.cost_price === 550, `lot A's corrected rate (₹550) is untouched by editing lot B (${lotAStill?.cost_price})`)
const lotBNow = after.find((l) => l.purchase_id === null)
chk(lotBNow?.cost_price === 540, `lot B now shows its corrected rate ₹540 (${lotBNow?.cost_price})`)

console.log(`\n${fails === 0 ? 'ALL STOCK-EDIT CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
