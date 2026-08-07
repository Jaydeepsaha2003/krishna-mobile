/**
 * Demo data generator — a realistic July 2026 trading month.
 *
 *   node scripts/seed-demo.mjs           # insert
 *   node scripts/seed-demo.mjs --clear   # remove all trading data first
 *
 * Everything it writes is fictional. Names, addresses, Aadhaar and PAN numbers
 * are randomly generated; the Aadhaar numbers carry a valid Verhoeff checksum
 * purely so the app's validation accepts them.
 *
 * It runs the same arithmetic the app does — landed cost per unit, GST-inclusive
 * pricing, per-handset profit, invoice numbering — so the reports, credit book
 * and reconciliation all read exactly as they would after a real month.
 */

import { createClient } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
if (!env.TURSO_DATABASE_URL) {
  console.error('TURSO_DATABASE_URL is not set in .env')
  process.exit(1)
}

const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
  intMode: 'number'
})

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Deterministic PRNG so re-running produces the same month.
let seed = 20260731
const rnd = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const chance = (p) => rnd() < p
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const id = () => randomUUID()

const iso = (day, hour = 11, min = 0) =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`).toISOString()

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isWeekend = (day) => [0, 6].includes(new Date(`${day}T00:00:00`).getDay())

/* ---- Verhoeff (Aadhaar) --------------------------------------------------- */

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
]
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]

function makeAadhaar() {
  let body = String(int(2, 9))
  for (let i = 0; i < 10; i++) body += String(int(0, 9))
  let c = 0
  const rev = body.split('').reverse().map(Number)
  for (let i = 0; i < rev.length; i++) c = D[c][P[(i + 1) % 8][rev[i]]]
  const full = body + INV[c]
  if (!validAadhaar(full)) throw new Error(`generated a bad Aadhaar: ${full}`)
  return full
}

function validAadhaar(value) {
  if (!/^[2-9][0-9]{11}$/.test(value)) return false
  let c = 0
  const rev = value.split('').reverse().map(Number)
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][rev[i]]]
  return c === 0
}

/* ---- IMEI (Luhn) ---------------------------------------------------------- */

const TACS = ['35328711', '35847209', '86891404', '35692011', '86325504', '35174509']

function makeImei() {
  let body = pick(TACS)
  while (body.length < 14) body += String(int(0, 9))
  let sum = 0
  for (let i = 0; i < 14; i++) {
    let n = Number(body[i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return body + String((10 - (sum % 10)) % 10)
}

const makePan = () => {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const l = () => L[int(0, 25)]
  return `${l()}${l()}${l()}P${l()}${int(1000, 9999)}${l()}`
}

const makePhone = () => `${pick([6, 7, 8, 9])}${String(int(100000000, 999999999))}`

/* -------------------------------------------------------------------------- */
/*  Reference data                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Prices are what the counter actually charges — GST inclusive, as printed on
 * the box. The purchase cost is derived from it, because the app adds GST on
 * top of a purchase line: a unit's landed cost ends up at `price × margin`.
 *
 * Smartphone margins in Indian retail are genuinely thin — 6–9% gross is
 * normal, with the real money made on accessories.
 */
const PHONE_MARGIN = 0.92 // landed cost ≈ 92% of the shelf price
const ACCESSORY_MARGIN = 0.5

const costFrom = (price, gst, margin) => Math.round((price * margin) / (1 + gst / 100))

//                brand        model                 ram      storage   price   mrp    gst
const MODELS = [
  ['Samsung', 'Galaxy M14 5G', '4GB', '128GB', 13499, 14999, 18],
  ['Samsung', 'Galaxy A15 5G', '6GB', '128GB', 17499, 19499, 18],
  ['Samsung', 'Galaxy S23 FE', '8GB', '128GB', 44999, 49999, 18],
  ['Redmi', 'Redmi 13C', '6GB', '128GB', 10499, 11999, 18],
  ['Redmi', 'Redmi Note 13 Pro', '8GB', '256GB', 24999, 27999, 18],
  ['Realme', 'Narzo 60', '8GB', '128GB', 18499, 20999, 18],
  ['Realme', 'Realme C53', '6GB', '128GB', 11299, 12999, 18],
  ['Vivo', 'Vivo Y28 5G', '6GB', '128GB', 16499, 18499, 18],
  ['Vivo', 'Vivo T3 5G', '8GB', '128GB', 20999, 23999, 18],
  ['Oppo', 'Oppo A18', '4GB', '64GB', 9999, 11499, 18],
  ['OnePlus', 'Nord CE4', '8GB', '128GB', 24999, 27999, 18],
  ['Apple', 'iPhone 13', null, '128GB', 51999, 59900, 18],
  ['Apple', 'iPhone 15', null, '128GB', 70999, 79900, 18],
  ['Poco', 'Poco M6 Pro', '8GB', '256GB', 15499, 17999, 18],
  ['Motorola', 'Moto G84 5G', '12GB', '256GB', 19499, 22999, 18],
  ['Nothing', 'Phone 2a', '8GB', '128GB', 23999, 25999, 18]
].map(([b, n, ram, st, price, mrp, gst]) => [
  b, n, ram, st, costFrom(price, gst, PHONE_MARGIN), price, mrp, gst
])

const ACCESSORIES = [
  ['Accessories', 'Wireless Earbuds 141', 1299, 2990, 18],
  ['Accessories', 'Tempered Glass Guard', 199, 299, 18],
  ['Accessories', '33W Fast Charger', 899, 1199, 18],
  ['Accessories', 'Silicone Back Cover', 249, 399, 18]
].map(([b, n, price, mrp, gst]) => [b, n, costFrom(price, gst, ACCESSORY_MARGIN), price, mrp, gst])

const SUPPLIERS = [
  ['Shree Telecom Distributors', 'Mahesh Kulkarni', 'Distributor', 'Pune', '411002'],
  ['Nakoda Mobile Agencies', 'Rajesh Jain', 'Distributor', 'Mumbai', '400003'],
  ['Balaji Communications', 'Santosh Pawar', 'Dealer', 'Nashik', '422001'],
  ['Sai Enterprises', 'Prakash Shinde', 'Distributor', 'Pune', '411030']
]

const FIRST = ['Ramesh', 'Suresh', 'Anita', 'Priya', 'Vikas', 'Sunil', 'Kavita', 'Amol', 'Sneha',
  'Nitin', 'Pooja', 'Ganesh', 'Manoj', 'Swati', 'Rahul', 'Deepak', 'Rohini', 'Sachin', 'Meena',
  'Ajay', 'Shital', 'Prashant', 'Vaishali', 'Nilesh', 'Archana', 'Sandeep', 'Jyoti', 'Yogesh']

const LAST = ['Patil', 'Deshmukh', 'Jadhav', 'Kulkarni', 'Shinde', 'Pawar', 'More', 'Gaikwad',
  'Chavan', 'Sawant', 'Bhosale', 'Kadam', 'Thorat', 'Salunkhe', 'Mane', 'Wagh', 'Kale', 'Nikam']

const AREAS = ['Shivaji Nagar', 'Kothrud', 'Hadapsar', 'Wakad', 'Camp', 'Deccan', 'Baner',
  'Aundh', 'Karve Nagar', 'Viman Nagar', 'Katraj', 'Warje']

const CITIES = ['Pune', 'Pune', 'Pune', 'Pimpri-Chinchwad', 'Nashik', 'Satara']

const PAYMENT_MODES = ['Cash', 'UPI', 'UPI', 'UPI', 'Card', 'EMI / Finance', 'Bank Transfer']

/* -------------------------------------------------------------------------- */
/*  Write buffer                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Statements are grouped into phases and written in dependency order, because
 * stock units are only known once the whole month has been simulated, but
 * transfer_items and sale_items point at them.
 */
const PHASES = ['base', 'purchase', 'stock', 'move']
const buckets = Object.fromEntries(PHASES.map((p) => [p, []]))
let phase = 'base'
const setPhase = (p) => {
  phase = p
}
const push = (sql, args) => buckets[phase].push({ sql, args })

async function flush() {
  const stmts = PHASES.flatMap((p) => buckets[p])
  const CHUNK = 40
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const chunk = stmts.slice(i, i + CHUNK)
    try {
      await db.batch(chunk, 'write')
    } catch (err) {
      // Re-run one at a time so the offending statement is named, not guessed.
      console.error(`\nBatch starting at ${i} failed: ${err.message}`)
      for (const [n, s] of chunk.entries()) {
        try {
          await db.execute(s)
        } catch (e) {
          console.error(`\nFailing statement #${i + n}:\n${s.sql}\nargs: ${JSON.stringify(s.args)}`)
          throw e
        }
      }
      throw err
    }
    process.stdout.write(`\r  writing ${Math.min(i + CHUNK, stmts.length)} / ${stmts.length}`)
  }
  process.stdout.write('\n')
  for (const p of PHASES) buckets[p].length = 0
}

/* -------------------------------------------------------------------------- */
/*  Clear                                                                      */
/* -------------------------------------------------------------------------- */

async function clearTradingData() {
  const tables = [
    'payments', 'sale_items', 'sales', 'transfer_items', 'transfers',
    'stock_adjustments', 'reconciliation_items', 'reconciliations',
    'stock_units', 'purchase_items', 'purchases', 'customers', 'suppliers',
    'models', 'counters', 'notifications', 'audit_log'
  ]
  for (const t of tables) await db.execute(`DELETE FROM ${t}`)
  console.log('Cleared all trading data (companies, shops and users kept).')
}

/* -------------------------------------------------------------------------- */
/*  Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  if (process.argv.includes('--clear')) {
    await clearTradingData()
    if (process.argv.includes('--only-clear')) return
  }

  const company = (await db.execute('SELECT * FROM companies ORDER BY created_at LIMIT 1')).rows[0]
  if (!company) throw new Error('No company found — start the app once so it seeds itself.')
  const companyId = company.id

  const shopRows = (
    await db.execute({ sql: 'SELECT * FROM shops WHERE company_id = ? ORDER BY code', args: [companyId] })
  ).rows
  const shop1 = shopRows[0]
  const shop2 = shopRows[1] ?? shopRows[0]

  const admin = (await db.execute("SELECT id, name FROM users WHERE role = 'admin' LIMIT 1")).rows[0]
  const staff = (await db.execute('SELECT id, name FROM users WHERE is_active = 1')).rows
  const userIds = staff.map((u) => u.id)

  const existingSales = (await db.execute('SELECT COUNT(*) n FROM sales')).rows[0].n
  if (existingSales > 0 && !process.argv.includes('--clear')) {
    console.log(`There are already ${existingSales} sales. Run with --clear to replace them.`)
    return
  }

  const brands = Object.fromEntries(
    (await db.execute({ sql: 'SELECT id, name FROM brands WHERE company_id = ?', args: [companyId] }))
      .rows.map((b) => [b.name, b.id])
  )

  console.log(`Company "${company.name}" · shops ${shop1.code} / ${shop2.code}`)

  /* ---- models ------------------------------------------------------------ */

  const models = []
  const addModel = (brand, name, ram, storage, cost, price, mrp, gst, trackImei = true) => {
    const brandId = brands[brand]
    if (!brandId) throw new Error(`brand "${brand}" is missing`)
    const sku = [brand, name, ram, storage]
      .filter(Boolean)
      .map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
      .join('-')
    const m = {
      id: id(), brandId, brand, name, sku, ram, storage, cost, price, mrp, gst, trackImei,
      category: trackImei ? 'Smartphone' : 'Accessory'
    }
    models.push(m)
    push(
      `INSERT INTO models (id, company_id, brand_id, name, sku, category, hsn, ram, storage, color,
         gst_rate, default_cost, default_price, mrp, low_stock_alert, track_imei, warranty_months,
         is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,1,?,?)`,
      [m.id, companyId, brandId, name, sku, m.category, trackImei ? '85171300' : '85177090',
        ram, storage, gst, cost, price, mrp, trackImei ? 2 : 10, trackImei ? 1 : 0,
        trackImei ? 12 : 6, iso('2026-06-15'), iso('2026-06-15')]
    )
    return m
  }

  for (const [b, n, ram, st, c, p, mrp, g] of MODELS) addModel(b, n, ram, st, c, p, mrp, g)
  for (const [b, n, c, p, mrp, g] of ACCESSORIES) addModel(b, n, null, null, c, p, mrp, g, false)
  const phones = models.filter((m) => m.trackImei)
  const accessories = models.filter((m) => !m.trackImei)

  /* ---- suppliers --------------------------------------------------------- */

  const suppliers = SUPPLIERS.map(([name, contact, type, city, pincode]) => {
    const s = { id: id(), name, city }
    push(
      `INSERT INTO suppliers (id, company_id, name, contact_person, phone, alt_phone, email, gstin,
         pan, supplier_type, address_line1, address_line2, city, state, pincode, opening_balance,
         notes, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,NULL,?,NULL,?,?,?,NULL,?,'Maharashtra',?,0,NULL,1,?,?)`,
      [s.id, companyId, name, contact, makePhone(),
        `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.com`, makePan(), type,
        `${int(1, 90)}, ${pick(AREAS)}`, city, pincode, iso('2026-06-10'), iso('2026-06-10')]
    )
    return s
  })

  /* ---- customers --------------------------------------------------------- */

  const usedPhones = new Set()
  const customers = []
  for (let i = 0; i < 26; i++) {
    let phone = makePhone()
    while (usedPhones.has(phone)) phone = makePhone()
    usedPhones.add(phone)

    const name = `${pick(FIRST)} ${pick(LAST)}`
    const hasAadhaar = chance(0.75)
    const hasPan = chance(0.4)
    const c = {
      id: id(),
      name,
      phone,
      creditLimit: chance(0.35) ? pick([15000, 25000, 40000, 60000]) : 0
    }
    customers.push(c)
    push(
      `INSERT INTO customers (id, company_id, name, phone_primary, phone_secondary, email, aadhaar,
         pan, dob, gender, address_line1, address_line2, city, state, pincode, gstin, customer_type,
         credit_limit, notes, is_active, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,'Maharashtra',?,NULL,?,?,NULL,1,?,?,?)`,
      [c.id, companyId, name, phone, chance(0.3) ? makePhone() : null,
        chance(0.35) ? `${name.split(' ')[0].toLowerCase()}${int(10, 99)}@example.com` : null,
        hasAadhaar ? makeAadhaar() : null, hasPan ? makePan() : null,
        chance(0.5) ? `19${int(70, 99)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}` : null,
        pick(['Male', 'Male', 'Female', 'Female', null]),
        `${int(1, 200)}, ${pick(AREAS)}`, pick(CITIES), `4${int(11000, 22999)}`,
        chance(0.1) ? 'Dealer' : 'Retail', c.creditLimit, admin.id,
        iso(addDays('2026-06-01', int(0, 25))), iso('2026-06-30')]
    )
  }

  /* ---- purchases --------------------------------------------------------- */

  const stock = [] // in-memory ledger driving what can be sold

  function purchase({ shop, supplier, date, billNo, lines, otherCharges = 0, billDiscount = 0, paidRatio = 1 }) {
    const purchaseId = id()
    let subtotal = 0
    let taxTotal = 0
    const priced = lines.map(({ model, qty, unitCost }) => {
      const taxable = round2(unitCost * qty)
      const tax = round2((taxable * model.gst) / 100)
      subtotal += taxable
      taxTotal += tax
      return { model, qty, unitCost, taxable, tax, lineTotal: round2(taxable + tax) }
    })

    const total = round2(subtotal + taxTotal + otherCharges - billDiscount)
    const paid = round2(total * paidRatio)
    const due = round2(total - paid)
    const unitCount = priced.reduce((a, l) => a + l.qty, 0)
    // Bill-level charges are spread across units, exactly as the app does.
    const perUnitAdjust = unitCount ? round2((otherCharges - billDiscount) / unitCount) : 0

    push(
      `INSERT INTO purchases (id, company_id, shop_id, supplier_id, invoice_no, purchase_date,
         subtotal, discount, tax_amount, other_charges, round_off, total, paid_amount, due_amount,
         payment_mode, due_date, status, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,'completed',NULL,?,?,?)`,
      [purchaseId, companyId, shop.id, supplier.id, billNo, date, round2(subtotal), billDiscount,
        round2(taxTotal), otherCharges, total, paid, due, 'Bank Transfer',
        due > 0 ? addDays(date, 30) : null, admin.id, iso(date, 10), iso(date, 10)]
    )

    if (paid > 0) {
      push(
        `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id, sale_id,
           purchase_id, amount, payment_date, mode, reference, notes, created_by, created_at)
         VALUES (?,?,?,'out','supplier',?,NULL,?,?,?,'Bank Transfer',NULL,'Paid with purchase',?,?)`,
        [id(), companyId, shop.id, supplier.id, purchaseId, paid, date, admin.id, iso(date, 10)]
      )
    }

    for (const line of priced) {
      const itemId = id()
      push(
        `INSERT INTO purchase_items (id, purchase_id, model_id, qty, unit_cost, discount, gst_rate,
           tax_amount, line_total, notes) VALUES (?,?,?,?,?,0,?,?,?,NULL)`,
        [itemId, purchaseId, line.model.id, line.qty, line.unitCost, line.model.gst, line.tax, line.lineTotal]
      )

      const perUnitCost = round2(line.lineTotal / line.qty + perUnitAdjust)
      for (let i = 0; i < line.qty; i++) {
        const unit = {
          id: id(),
          model: line.model,
          imei: line.model.trackImei ? makeImei() : null,
          cost: perUnitCost,
          shopId: shop.id,
          status: 'in_stock',
          addedAt: iso(date, 10, i),
          purchaseId,
          purchaseItemId: itemId,
          supplierId: supplier.id,
          colour: line.model.trackImei ? pick(['Black', 'Blue', 'Green', 'Silver', 'Midnight']) : null
        }
        stock.push(unit)
      }
    }
    return { total, unitCount }
  }

  const bill = (n) => `${pick(['STD', 'NMA', 'BLC', 'SEN'])}/26-27/${String(n).padStart(4, '0')}`
  const some = (list, n) => {
    const out = []
    const pool = [...list]
    for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0])
    return out
  }
  const lines = (pool, count, qtyLo, qtyHi) =>
    some(pool, count).map((model) => ({
      model,
      qty: int(qtyLo, qtyHi),
      unitCost: round2(model.cost * (1 + (rnd() - 0.5) * 0.04))
    }))

  setPhase('purchase')

  // June — so 1 July has a real opening stock
  purchase({ shop: shop1, supplier: suppliers[0], date: '2026-06-20', billNo: bill(812), lines: lines(phones, 5, 2, 4) })
  purchase({ shop: shop1, supplier: suppliers[1], date: '2026-06-27', billNo: bill(1190), lines: lines(phones, 4, 2, 3) })
  purchase({ shop: shop2, supplier: suppliers[2], date: '2026-06-28', billNo: bill(377), lines: lines(phones, 3, 1, 2) })

  // July
  const julyPurchases = [
    [shop1, suppliers[0], '2026-07-02', 838, 6, 2, 4, 1],
    [shop1, suppliers[1], '2026-07-06', 1204, 5, 2, 3, 0.5],
    [shop2, suppliers[2], '2026-07-09', 391, 4, 1, 3, 1],
    [shop1, suppliers[0], '2026-07-14', 856, 5, 2, 4, 1],
    [shop1, suppliers[3], '2026-07-19', 512, 4, 2, 3, 0],
    [shop2, suppliers[1], '2026-07-23', 1231, 3, 1, 2, 1],
    [shop1, suppliers[0], '2026-07-28', 879, 5, 2, 4, 0.6]
  ]
  for (const [shop, supplier, date, no, count, lo, hi, paidRatio] of julyPurchases) {
    const pool = chance(0.5) ? phones : [...phones, ...accessories]
    purchase({
      shop, supplier, date, billNo: bill(no),
      lines: [
        ...lines(pool, count, lo, hi),
        ...(chance(0.6) ? lines(accessories, 2, 8, 20) : [])
      ],
      otherCharges: chance(0.5) ? int(200, 900) : 0,
      billDiscount: chance(0.35) ? int(300, 1500) : 0,
      paidRatio
    })
  }

  /* ---- transfers Shop 1 -> Shop 2 ---------------------------------------- */

  setPhase('move')

  let transferNo = 0
  function transfer(date, count) {
    const available = stock.filter(
      (u) => u.shopId === shop1.id && u.status === 'in_stock' && u.addedAt <= iso(date, 23) && u.model.trackImei
    )
    const moving = some(available, Math.min(count, available.length))
    if (!moving.length) return

    transferNo++
    const transferId = id()
    const no = `${shop1.invoice_prefix ?? shop1.code}/TR/2026-27/${String(transferNo).padStart(4, '0')}`
    const receivedOn = addDays(date, chance(0.6) ? 0 : 1)
    const totalValue = round2(moving.reduce((a, u) => a + u.cost, 0))

    push(
      `INSERT INTO transfers (id, company_id, transfer_no, from_shop_id, to_shop_id, transfer_date,
         status, total_units, total_value, notes, created_by, received_by, received_at,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,'received',?,?,?,?,?,?,?,?)`,
      [transferId, companyId, no, shop1.id, shop2.id, date, moving.length, totalValue,
        'Weekly stock balancing', admin.id, admin.id, iso(receivedOn, 12), iso(date, 9), iso(receivedOn, 12)]
    )

    for (const u of moving) {
      push(
        `INSERT INTO transfer_items (id, transfer_id, stock_unit_id, cost_at_transfer, transfer_price, received)
         VALUES (?,?,?,?,?,1)`,
        [id(), transferId, u.id, u.cost, u.cost]
      )
      u.shopId = shop2.id
      u.transferId = transferId
      u.transferredOn = receivedOn
    }
  }

  transfer('2026-07-05', 4)
  transfer('2026-07-12', 5)
  transfer('2026-07-20', 4)
  transfer('2026-07-27', 3)

  /* ---- sales -------------------------------------------------------------- */

  const counters = new Map() // shopId -> next number
  const nextInvoice = (shop) => {
    const n = (counters.get(shop.id) ?? 0) + 1
    counters.set(shop.id, n)
    return `${shop.invoice_prefix ?? shop.code}/${company.invoice_prefix ?? 'INV'}/2026-27/${String(n).padStart(4, '0')}`
  }

  const creditSales = []
  let saleCount = 0

  function sale(shop, date) {
    const available = stock.filter(
      (u) => u.shopId === shop.id && u.status === 'in_stock' &&
        (u.transferredOn ? u.transferredOn <= date : u.addedAt <= iso(date, 23))
    )
    const phonesAvailable = available.filter((u) => u.model.trackImei)
    if (!phonesAvailable.length) return

    const handset = pick(phonesAvailable)
    const items = [handset]
    // Roughly a third of customers add a case or glass at the counter.
    if (chance(0.35)) {
      const extra = available.find((u) => !u.model.trackImei && !items.includes(u))
      if (extra) items.push(extra)
    }

    const saleId = id()
    const invoiceNo = nextInvoice(shop)
    const walkIn = chance(0.18)
    const customer = walkIn ? null : pick(customers)
    const createdBy = pick(userIds)

    let itemsTotal = 0
    let taxableTotal = 0
    let taxTotal = 0
    let costTotal = 0
    const priced = items.map((u) => {
      // Counters negotiate a little, but never past the margin.
      const base = u.model.price
      const unitPrice = round2(base * (1 - rnd() * (u.model.trackImei ? 0.025 : 0.08)))
      const lineTotal = unitPrice
      const taxable = round2(lineTotal / (1 + u.model.gst / 100))
      const tax = round2(lineTotal - taxable)
      itemsTotal += lineTotal
      taxableTotal += taxable
      taxTotal += tax
      costTotal += u.cost
      return { unit: u, unitPrice, lineTotal, taxable, tax }
    })

    const billDiscount = chance(0.18) ? int(100, 400) : 0
    const total = round2(itemsTotal - billDiscount)
    const cost = round2(costTotal)
    const profit = round2(total - cost)

    // Credit is more likely on bigger tickets, as in a real shop.
    const onCredit = !walkIn && chance(total > 30000 ? 0.42 : 0.2)
    let paid = total
    let dueDate = null
    if (onCredit) {
      paid = chance(0.35) ? 0 : round2(total * pick([0.3, 0.4, 0.5, 0.6]))
      dueDate = addDays(date, pick([7, 10, 15, 15, 21, 30]))
    }
    const due = round2(total - paid)
    const mode = onCredit && paid === 0 ? 'Credit (Udhaar)' : pick(PAYMENT_MODES)

    push(
      `INSERT INTO sales (id, company_id, shop_id, customer_id, invoice_no, sale_date, subtotal,
         discount, tax_amount, other_charges, round_off, total, paid_amount, due_amount,
         payment_mode, is_credit, due_date, promised_note, status, total_cost, total_profit,
         notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
      [saleId, companyId, shop.id, customer?.id ?? null, invoiceNo, date, round2(taxableTotal),
        billDiscount, round2(taxTotal), total, paid, due, mode, due > 0.5 ? 1 : 0, dueDate,
        due > 0.5 ? pick(['Will pay after salary', 'Promised on phone', 'Regular customer', null]) : null,
        due > 0.5 ? (paid > 0 ? 'partially_paid' : 'unpaid') : 'completed',
        cost, profit, createdBy, iso(date, int(10, 20), int(0, 59)), iso(date, 20)]
    )

    for (const p of priced) {
      const itemId = id()
      push(
        `INSERT INTO sale_items (id, sale_id, stock_unit_id, model_id, imei1, description, qty,
           unit_price, discount, gst_rate, tax_amount, line_total, cost_price, profit)
         VALUES (?,?,?,?,?,?,1,?,0,?,?,?,?,?)`,
        [itemId, saleId, p.unit.id, p.unit.model.id, p.unit.imei,
          `${p.unit.model.brand} ${p.unit.model.name}${p.unit.colour ? ` · ${p.unit.colour}` : ''}`,
          p.unitPrice, p.unit.model.gst, p.tax, p.lineTotal, p.unit.cost, round2(p.lineTotal - p.unit.cost)]
      )
      p.unit.status = 'sold'
      p.unit.saleId = saleId
      p.unit.saleItemId = itemId
      p.unit.soldAt = date
      p.unit.salePrice = p.unitPrice
    }

    if (paid > 0) {
      push(
        `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id, sale_id,
           purchase_id, amount, payment_date, mode, reference, notes, created_by, created_at)
         VALUES (?,?,?,'in','customer',?,?,NULL,?,?,?,NULL,'Paid at billing',?,?)`,
        [id(), companyId, shop.id, customer?.id ?? null, saleId, paid, date, mode, createdBy, iso(date, 15)]
      )
    }

    if (due > 0.5) {
      creditSales.push({ saleId, shopId: shop.id, customerId: customer.id, total, paid, due, date, dueDate })
    }
    saleCount++
  }

  for (let d = 1; d <= 31; d++) {
    const date = `2026-07-${String(d).padStart(2, '0')}`
    const busy = isWeekend(date) ? 1.6 : 1
    for (let i = 0; i < Math.round(int(1, 3) * busy); i++) sale(shop1, date)
    for (let i = 0; i < Math.round(int(0, 2) * busy); i++) sale(shop2, date)
  }

  /* ---- credit recovery ---------------------------------------------------- */

  let collected = 0
  for (const c of creditSales) {
    // Most customers pay up; a few slip past the promised date.
    if (!chance(0.55)) continue
    const payDate = chance(0.7)
      ? addDays(c.dueDate, -int(0, 4))
      : addDays(c.dueDate, int(1, 9))
    if (payDate > '2026-08-06') continue

    const full = chance(0.7)
    const amount = full ? c.due : round2(c.due * pick([0.4, 0.5, 0.6]))
    const remaining = round2(c.due - amount)

    push(
      `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id, sale_id,
         purchase_id, amount, payment_date, mode, reference, notes, created_by, created_at)
       VALUES (?,?,?,'in','customer',?,?,NULL,?,?,?,?,'Credit recovery',?,?)`,
      [id(), companyId, c.shopId, c.customerId, c.saleId, amount, payDate,
        pick(['Cash', 'UPI', 'UPI', 'Bank Transfer']),
        chance(0.4) ? `UPI${int(100000, 999999)}` : null, admin.id, iso(payDate, 17)]
    )
    push(
      `UPDATE sales SET paid_amount = ?, due_amount = ?, status = ?, due_date = ?, updated_at = ?
        WHERE id = ?`,
      [round2(c.paid + amount), remaining, remaining > 0.5 ? 'partially_paid' : 'completed',
        remaining > 0.5 ? addDays(payDate, 15) : null, iso(payDate, 17), c.saleId]
    )
    collected += amount
    c.due = remaining
  }

  /* ---- stock units (final state) ------------------------------------------ */

  setPhase('stock')
  for (const u of stock) {
    push(
      `INSERT INTO stock_units (id, company_id, model_id, imei1, imei2, serial_no, color, condition,
         cost_price, sale_price, status, current_shop_id, origin_shop_id, purchase_id,
         purchase_item_id, supplier_id, sale_id, sale_item_id, sold_at, transfer_id,
         warranty_months, box_no, notes, added_at, updated_at)
       VALUES (?,?,?,?,NULL,NULL,?,'New',?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)`,
      [u.id, companyId, u.model.id, u.imei, u.colour, u.cost, u.salePrice ?? u.model.price,
        u.status, u.shopId, u.purchaseShopId ?? u.shopId, u.purchaseId, u.purchaseItemId,
        u.supplierId, u.saleId ?? null, u.saleItemId ?? null, u.soldAt ?? null, u.transferId ?? null,
        u.model.trackImei ? 12 : 6, u.addedAt, u.addedAt]
    )
  }

  /* ---- counters so the app keeps numbering from here ---------------------- */

  setPhase('move')
  for (const [shopId, n] of counters) {
    push(
      `INSERT INTO counters (id, next_no, updated_at) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET next_no = excluded.next_no`,
      [`${companyId}:${shopId}:sale:2026-27`, n + 1, iso('2026-08-01')]
    )
  }
  push(
    `INSERT INTO counters (id, next_no, updated_at) VALUES (?,?,?)
     ON CONFLICT(id) DO UPDATE SET next_no = excluded.next_no`,
    [`${companyId}:${shop1.id}:transfer:2026-27`, transferNo + 1, iso('2026-08-01')]
  )

  /* ---- write -------------------------------------------------------------- */

  console.log(
    `Prepared ${PHASES.reduce((a, p) => a + buckets[p].length, 0)} statements — writing to Turso…`
  )
  await flush()

  /* ---- summary ------------------------------------------------------------ */

  const q = async (sql) => (await db.execute(sql)).rows[0]
  const s = await q(`SELECT COUNT(*) bills, ROUND(SUM(total)) revenue, ROUND(SUM(total_profit)) profit,
                            ROUND(SUM(due_amount)) due
                       FROM sales WHERE sale_date BETWEEN '2026-07-01' AND '2026-07-31'`)
  const st = await q(`SELECT COUNT(*) units, ROUND(SUM(cost_price)) value
                        FROM stock_units WHERE status = 'in_stock'`)
  const od = await q(`SELECT COUNT(*) n, ROUND(SUM(due_amount)) amt FROM sales
                       WHERE due_amount > 0.5 AND due_date < '2026-08-07'`)

  console.log(`
July 2026
  Sales            ${s.bills} bills · ₹${Number(s.revenue).toLocaleString('en-IN')}
  Profit           ₹${Number(s.profit).toLocaleString('en-IN')}
  Credit recovered ₹${Math.round(collected).toLocaleString('en-IN')}
  Still owed       ₹${Number(s.due).toLocaleString('en-IN')}  (${od.n} bills overdue, ₹${Number(od.amt ?? 0).toLocaleString('en-IN')})

Now
  Stock on hand    ${st.units} units · ₹${Number(st.value).toLocaleString('en-IN')}
  Customers        ${customers.length}
  Models           ${models.length}   Suppliers ${suppliers.length}
`)
  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
