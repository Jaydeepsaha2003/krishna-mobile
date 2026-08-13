import { all, one, run, scalar, tx } from '../db'
import {
  AppError,
  newId,
  nextDocumentNumber,
  nowIso,
  nullify,
  num,
  round2,
  today
} from '../utils'
import { requireCompany, requirePermission, requireSession } from './session'
import { logAudit } from './audit'

/* ========================================================================== */
/*  CREATE SALE                                                               */
/* ========================================================================== */

export type SaleType = 'product' | 'recharge' | 'repair'
export type LineType = 'product' | 'service' | 'part'

export interface SaleItemInput {
  stockUnitId?: string
  /** Optional now — a service line (labour, recharge) has no catalogue model. */
  modelId?: string
  /** 'product' (goods), 'service' (labour / recharge), 'part' (repair part from stock). */
  lineType?: LineType
  description?: string
  qty?: number
  /** Price actually charged to the customer, GST inclusive. */
  unitPrice: number
  discount?: number
  gstRate?: number
  /** Cost for a non-stock line (a service usually costs the shop nothing). */
  costPrice?: number
}

export interface SaleInput {
  shopId: string
  customerId?: string
  saleDate: string
  saleType?: SaleType
  serviceTitle?: string
  serviceDetails?: string
  items: SaleItemInput[]
  discount?: number
  otherCharges?: number
  roundOff?: number
  paidAmount: number
  paymentMode?: string
  isCredit?: boolean
  dueDate?: string
  promisedNote?: string
  notes?: string
}

export async function createSale(input: SaleInput) {
  requirePermission('sale.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  if (!input.shopId) throw new AppError('Choose the shop making this sale.', 'VALIDATION')
  if (!input.items?.length) throw new AppError('Add at least one item to the bill.', 'VALIDATION')

  const billDiscount = num(input.discount)
  if (billDiscount > 0) requirePermission('sale.discount')

  /* ---- resolve every line -------------------------------------------------- */
  const unitIds = input.items.map((i) => i.stockUnitId).filter(Boolean) as string[]
  const units = unitIds.length
    ? await all<any>(
        `SELECT su.*, m.name AS model_name, m.gst_rate, b.name AS brand_name
           FROM stock_units su
           JOIN models m ON m.id = su.model_id
           JOIN brands b ON b.id = m.brand_id
          WHERE su.company_id = ? AND su.id IN (${unitIds.map(() => '?').join(',')})`,
        [companyId, ...unitIds]
      )
    : []
  const unitMap = new Map(units.map((u) => [u.id, u]))

  if (new Set(unitIds).size !== unitIds.length)
    throw new AppError('The same handset is added twice on this bill.', 'DUPLICATE')

  let itemsTotal = 0
  let taxTotal = 0
  let taxableTotal = 0

  const lines = input.items.map((item) => {
    const unit = item.stockUnitId ? unitMap.get(item.stockUnitId) : null
    // A line is a "service" when it carries neither a stock unit nor a model —
    // a labour charge or a recharge. Everything else is goods (product/part).
    const lineType: LineType =
      item.lineType ?? (unit || item.modelId ? 'product' : 'service')
    const isService = lineType === 'service'

    const qty = Math.max(1, Math.floor(num(item.qty, 1)))
    const unitPrice = num(item.unitPrice)
    if (unitPrice <= 0) throw new AppError('Enter a price for every line.', 'VALIDATION')

    const lineDiscount = num(item.discount)
    if (lineDiscount > 0) requirePermission('sale.discount')

    if (item.stockUnitId) {
      if (!unit) throw new AppError('A selected item no longer exists.', 'VALIDATION')
      if (unit.status !== 'in_stock')
        throw new AppError(
          `${unit.brand_name} ${unit.model_name} (${unit.imei1 ?? 'no IMEI'}) is "${unit.status}" and cannot be sold.`,
          'BAD_STATUS'
        )
      if (unit.current_shop_id !== input.shopId)
        throw new AppError(
          `${unit.brand_name} ${unit.model_name} is not in this shop's stock.`,
          'BAD_SHOP'
        )
    } else if (!isService && !item.modelId) {
      throw new AppError('A goods line needs a product — pick one from stock.', 'VALIDATION')
    }

    // GST defaults to 0 everywhere; a rate is only applied when the model
    // carries one (or the cashier types it on the line).
    const gstRate = num(item.gstRate, isService ? 0 : num(unit?.gst_rate, 0))
    const lineTotal = round2(unitPrice * qty - lineDiscount)
    // Prices are GST inclusive, as printed on the box.
    const taxable = round2(lineTotal / (1 + gstRate / 100))
    const tax = round2(lineTotal - taxable)

    itemsTotal += lineTotal
    taxableTotal += taxable
    taxTotal += tax

    return { item, unit, lineType, qty, unitPrice, lineDiscount, gstRate, lineTotal, taxable, tax }
  })

  const otherCharges = num(input.otherCharges)
  const roundOff = num(input.roundOff)
  const total = round2(itemsTotal - billDiscount + otherCharges + roundOff)
  const paid = Math.max(0, Math.min(num(input.paidAmount), total))
  const due = round2(total - paid)
  const isCredit = due > 0.5

  if (isCredit) {
    requirePermission('sale.credit')
    if (!input.customerId)
      throw new AppError('A credit sale must be linked to a customer.', 'VALIDATION')
    if (!input.dueDate)
      throw new AppError('Enter the promised payment date for this credit sale.', 'VALIDATION')
    if (input.dueDate < (input.saleDate || today()))
      throw new AppError('The promised date cannot be before the sale date.', 'VALIDATION')

    const cust = await one<any>('SELECT name, credit_limit FROM customers WHERE id = ?', [
      input.customerId
    ])
    const existingDue =
      (await scalar<number>(
        `SELECT COALESCE(SUM(due_amount),0) FROM sales WHERE customer_id = ? AND status <> 'cancelled'`,
        [input.customerId]
      )) ?? 0
    const limit = num(cust?.credit_limit)
    if (limit > 0 && existingDue + due > limit)
      throw new AppError(
        `${cust?.name} would owe ₹${round2(existingDue + due)}, above their ₹${limit} credit limit.`,
        'CREDIT_LIMIT'
      )
  }

  const saleDate = input.saleDate || today()
  const saleType: SaleType = input.saleType ?? 'product'
  // Cost (and therefore profit) is resolved inside the transaction, because a
  // quantity line consumes real stock units whose landed cost we only know once
  // we pick them.
  let costTotal = 0
  let totalProfit = 0

  const shop = await one<{ invoice_prefix: string; code: string }>(
    'SELECT invoice_prefix, code FROM shops WHERE id = ?',
    [input.shopId]
  )
  const company = await one<{ invoice_prefix: string; fy_start_month: number }>(
    'SELECT invoice_prefix, fy_start_month FROM companies WHERE id = ?',
    [companyId]
  )
  const invoiceNo = await nextDocumentNumber({
    companyId,
    shopId: input.shopId,
    kind: 'sale',
    date: saleDate,
    prefix: `${shop?.invoice_prefix ?? shop?.code ?? 'S'}/${company?.invoice_prefix ?? 'INV'}`,
    fyStartMonth: company?.fy_start_month ?? 4
  })

  const saleId = newId()
  const ts = nowIso()

  await tx(async (t) => {
    // Phase 1 — resolve each line's cost and the exact stock units it consumes.
    // A quantity line (a model, no specific unit) pulls `qty` in-stock units of
    // that model at this shop, oldest first. If there aren't enough, the whole
    // bill is refused — this is what prevents overselling.
    const resolved: Array<{
      line: (typeof lines)[number]
      itemId: string
      cost: number
      unitIds: string[]
      imei1: string | null
      description: string
    }> = []

    for (const line of lines) {
      const itemId = newId()
      const description =
        line.item.description ??
        (line.unit ? `${line.unit.brand_name} ${line.unit.model_name}` : 'Item')
      let cost = 0
      let consume: string[] = []
      let imei1: string | null = null

      if (line.unit) {
        cost = round2(num(line.unit.cost_price))
        consume = [line.unit.id]
        imei1 = line.unit.imei1 ?? null
      } else if (line.lineType !== 'service' && line.item.modelId) {
        const avail = await t.all<{ id: string; cost_price: number }>(
          `SELECT id, cost_price FROM stock_units
             WHERE company_id = ? AND model_id = ? AND current_shop_id = ? AND status = 'in_stock'
             ORDER BY added_at LIMIT ?`,
          [companyId, line.item.modelId, input.shopId, line.qty]
        )
        if (avail.length < line.qty)
          throw new AppError(
            `Only ${avail.length} of "${description}" in stock — cannot sell ${line.qty}.`,
            'NO_STOCK'
          )
        cost = round2(avail.reduce((a, u) => a + num(u.cost_price), 0))
        consume = avail.map((u) => u.id)
      } else {
        // Service line (labour / recharge) — no stock consumed.
        cost = round2(num(line.item.costPrice))
      }

      costTotal = round2(costTotal + cost)
      resolved.push({ line, itemId, cost, unitIds: consume, imei1, description })
    }
    totalProfit = round2(total - costTotal)

    await t.run(
      `INSERT INTO sales (id, company_id, shop_id, customer_id, invoice_no, sale_date, sale_type,
         service_title, service_details, subtotal, discount, tax_amount, other_charges, round_off,
         total, paid_amount, due_amount, payment_mode, is_credit, due_date, promised_note, status,
         total_cost, total_profit, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        saleId,
        companyId,
        input.shopId,
        nullify(input.customerId),
        invoiceNo,
        saleDate,
        saleType,
        nullify(input.serviceTitle),
        nullify(input.serviceDetails),
        round2(taxableTotal),
        billDiscount,
        round2(taxTotal),
        otherCharges,
        roundOff,
        total,
        paid,
        due,
        nullify(input.paymentMode),
        isCredit ? 1 : 0,
        isCredit ? nullify(input.dueDate) : null,
        nullify(input.promisedNote),
        due > 0.5 ? (paid > 0 ? 'partially_paid' : 'unpaid') : 'completed',
        round2(costTotal),
        totalProfit,
        nullify(input.notes),
        session.user.id,
        ts,
        ts
      ]
    )

    for (const r of resolved) {
      await t.run(
        `INSERT INTO sale_items (id, sale_id, stock_unit_id, model_id, line_type, imei1, description,
           qty, unit_price, discount, gst_rate, tax_amount, line_total, cost_price, profit)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          r.itemId,
          saleId,
          // Only a single-unit line pins one stock unit; a quantity line spans
          // several, tracked via each unit's sale_id instead.
          nullify(r.unitIds.length === 1 ? r.unitIds[0] : null),
          nullify(r.line.item.modelId ?? r.line.unit?.model_id),
          r.line.lineType,
          nullify(r.imei1),
          r.description,
          r.line.qty,
          r.line.unitPrice,
          r.line.lineDiscount,
          r.line.gstRate,
          r.line.tax,
          r.line.lineTotal,
          r.cost,
          round2(r.line.lineTotal - r.cost)
        ]
      )

      for (const uid of r.unitIds) {
        await t.run(
          `UPDATE stock_units SET status = 'sold', sale_id = ?, sale_item_id = ?, sold_at = ?,
                  sale_price = ?, updated_at = ? WHERE id = ?`,
          [saleId, r.itemId, saleDate, r.line.unitPrice, ts, uid]
        )
      }
    }

    if (paid > 0) {
      await t.run(
        `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id, sale_id,
           amount, payment_date, mode, notes, created_by, created_at)
         VALUES (?,?,?,'in','customer',?,?,?,?,?,?,?,?)`,
        [
          newId(),
          companyId,
          input.shopId,
          nullify(input.customerId),
          saleId,
          paid,
          saleDate,
          nullify(input.paymentMode),
          'Paid at billing',
          session.user.id,
          ts
        ]
      )
    }
  })

  await logAudit({
    action: 'sale.create',
    entity: 'sale',
    entityId: saleId,
    summary: `${invoiceNo} — ₹${total}${isCredit ? ` (credit ₹${due} due ${input.dueDate})` : ''}`,
    shopId: input.shopId
  })

  return { id: saleId, invoiceNo, total, due, profit: totalProfit }
}

/* ========================================================================== */
/*  READ                                                                      */
/* ========================================================================== */

export interface SaleFilter {
  shopId?: string
  customerId?: string
  from?: string
  to?: string
  search?: string
  status?: string
  saleType?: string
  onlyCredit?: boolean
  onlyOverdue?: boolean
  createdBy?: string
  limit?: number
  offset?: number
}

function saleWhere(companyId: string, f: SaleFilter) {
  const where = ['s.company_id = ?']
  const args: any[] = [companyId]

  if (f.shopId) {
    where.push('s.shop_id = ?')
    args.push(f.shopId)
  }
  if (f.customerId) {
    where.push('s.customer_id = ?')
    args.push(f.customerId)
  }
  if (f.from) {
    where.push('s.sale_date >= ?')
    args.push(f.from)
  }
  if (f.to) {
    where.push('s.sale_date <= ?')
    args.push(f.to)
  }
  if (f.status && f.status !== 'all') {
    where.push('s.status = ?')
    args.push(f.status)
  } else {
    where.push("s.status <> 'cancelled'")
  }
  if (f.saleType && f.saleType !== 'all') {
    where.push('s.sale_type = ?')
    args.push(f.saleType)
  }
  if (f.createdBy) {
    where.push('s.created_by = ?')
    args.push(f.createdBy)
  }
  if (f.onlyCredit) where.push('s.due_amount > 0.5')
  if (f.onlyOverdue) where.push("s.due_amount > 0.5 AND s.due_date < date('now','localtime')")
  if (f.search) {
    const q = `%${f.search.trim()}%`
    where.push(
      `(s.invoice_no LIKE ? OR c.name LIKE ? OR c.phone_primary LIKE ?
        OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id
                   AND (si.imei1 LIKE ? OR si.description LIKE ?)))`
    )
    args.push(q, q, q, q, q)
  }
  return { clause: `WHERE ${where.join(' AND ')}`, args }
}

export async function listSales(f: SaleFilter) {
  requirePermission('sale.view')
  const { companyId } = requireCompany()
  const { clause, args } = saleWhere(companyId, f)

  const rows = await all<any>(
    `SELECT s.*, c.name AS customer_name, c.phone_primary AS customer_phone,
            sh.name AS shop_name, sh.code AS shop_code, u.name AS created_by_name,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
            (SELECT group_concat(si.description, ', ') FROM sale_items si WHERE si.sale_id = s.id) AS items_label
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN shops sh ON sh.id = s.shop_id
       LEFT JOIN users u ON u.id = s.created_by
       ${clause}
       ORDER BY s.sale_date DESC, s.created_at DESC LIMIT ? OFFSET ?`,
    [...args, f.limit ?? 100, f.offset ?? 0]
  )

  const summary = await one<any>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total,
            COALESCE(SUM(s.due_amount),0) AS due, COALESCE(SUM(s.total_profit),0) AS profit,
            COALESCE(SUM(s.total_cost),0) AS cost
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${clause}`,
    args
  )

  return { rows: rows.map(shapeSale), summary }
}

function shapeSale(r: any) {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    saleDate: r.sale_date,
    saleType: r.sale_type ?? 'product',
    serviceTitle: r.service_title,
    serviceDetails: r.service_details,
    customerId: r.customer_id,
    customerName: r.customer_name ?? 'Walk-in customer',
    customerPhone: r.customer_phone,
    shopId: r.shop_id,
    shopName: r.shop_name,
    shopCode: r.shop_code,
    subtotal: r.subtotal,
    discount: r.discount,
    taxAmount: r.tax_amount,
    otherCharges: r.other_charges,
    roundOff: r.round_off,
    total: r.total,
    paidAmount: r.paid_amount,
    dueAmount: r.due_amount,
    paymentMode: r.payment_mode,
    isCredit: !!r.is_credit,
    dueDate: r.due_date,
    promisedNote: r.promised_note,
    status: r.status,
    totalCost: r.total_cost,
    totalProfit: r.total_profit,
    notes: r.notes,
    itemCount: r.item_count ?? 0,
    itemsLabel: r.items_label,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    overdueDays:
      r.due_amount > 0.5 && r.due_date
        ? Math.floor((Date.now() - new Date(`${r.due_date}T23:59:59`).getTime()) / 86400000)
        : 0
  }
}

export async function getSale(id: string) {
  requirePermission('sale.view')
  const sale = await one<any>(
    `SELECT s.*, c.name AS customer_name, c.phone_primary AS customer_phone, c.aadhaar,
            c.address_line1, c.city, c.state, c.pincode, c.gstin AS customer_gstin,
            sh.name AS shop_name, sh.code AS shop_code, sh.address_line1 AS shop_address,
            sh.city AS shop_city, sh.state AS shop_state, sh.phone AS shop_phone,
            sh.gstin AS shop_gstin, u.name AS created_by_name,
            co.name AS company_name, co.gstin AS company_gstin, co.logo_data_url, co.terms
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN shops sh ON sh.id = s.shop_id
       JOIN companies co ON co.id = s.company_id
       LEFT JOIN users u ON u.id = s.created_by
      WHERE s.id = ?`,
    [id]
  )
  if (!sale) throw new AppError('Sale not found.', 'NOT_FOUND')

  const items = await all<any>(
    `SELECT si.*, m.name AS model_name, m.sku, m.hsn, b.name AS brand_name, su.warranty_months
       FROM sale_items si
       LEFT JOIN models m ON m.id = si.model_id
       LEFT JOIN brands b ON b.id = m.brand_id
       LEFT JOIN stock_units su ON su.id = si.stock_unit_id
      WHERE si.sale_id = ?`,
    [id]
  )
  const payments = await all<any>(
    'SELECT * FROM payments WHERE sale_id = ? ORDER BY payment_date, created_at',
    [id]
  )
  return { sale: shapeSale(sale), raw: sale, items, payments }
}

/* ========================================================================== */
/*  CREDIT & PAYMENTS                                                         */
/* ========================================================================== */

export async function recordPayment(input: {
  saleId: string
  amount: number
  paymentDate?: string
  mode?: string
  reference?: string
  notes?: string
  /** Optional new promise date when the customer pays only part of the due. */
  newDueDate?: string
}) {
  requirePermission('payment.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  const sale = await one<any>('SELECT * FROM sales WHERE id = ? AND company_id = ?', [
    input.saleId,
    companyId
  ])
  if (!sale) throw new AppError('Sale not found.', 'NOT_FOUND')
  if (sale.status === 'cancelled') throw new AppError('This sale was cancelled.', 'CANCELLED')

  const amount = round2(num(input.amount))
  if (amount <= 0) throw new AppError('Enter an amount greater than zero.', 'VALIDATION')
  if (amount > num(sale.due_amount) + 0.5)
    throw new AppError(
      `Only ₹${round2(num(sale.due_amount))} is outstanding on this bill.`,
      'OVERPAY'
    )

  const paid = round2(num(sale.paid_amount) + amount)
  const due = round2(num(sale.total) - paid)
  const ts = nowIso()
  const paymentDate = input.paymentDate || today()

  await tx(async (t) => {
    await t.run(
      `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id, sale_id,
         amount, payment_date, mode, reference, notes, created_by, created_at)
       VALUES (?,?,?,'in','customer',?,?,?,?,?,?,?,?,?)`,
      [
        newId(),
        companyId,
        sale.shop_id,
        sale.customer_id,
        input.saleId,
        amount,
        paymentDate,
        nullify(input.mode),
        nullify(input.reference),
        nullify(input.notes),
        session.user.id,
        ts
      ]
    )
    await t.run(
      `UPDATE sales SET paid_amount = ?, due_amount = ?, status = ?, due_date = ?, updated_at = ?
        WHERE id = ?`,
      [
        paid,
        due,
        due > 0.5 ? 'partially_paid' : 'completed',
        due > 0.5 ? (input.newDueDate ?? sale.due_date) : null,
        ts,
        input.saleId
      ]
    )
  })

  await logAudit({
    action: 'payment.receive',
    entity: 'sale',
    entityId: input.saleId,
    summary: `Received ₹${amount} against ${sale.invoice_no}; ₹${due} remaining`,
    shopId: sale.shop_id
  })

  return { paid, due, cleared: due <= 0.5 }
}

export async function recordSupplierPayment(input: {
  purchaseId: string
  amount: number
  paymentDate?: string
  mode?: string
  reference?: string
  notes?: string
}) {
  requirePermission('payment.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  const p = await one<any>('SELECT * FROM purchases WHERE id = ? AND company_id = ?', [
    input.purchaseId,
    companyId
  ])
  if (!p) throw new AppError('Purchase not found.', 'NOT_FOUND')

  const amount = round2(num(input.amount))
  if (amount <= 0) throw new AppError('Enter an amount greater than zero.', 'VALIDATION')
  if (amount > num(p.due_amount) + 0.5)
    throw new AppError(`Only ₹${round2(num(p.due_amount))} is payable on this bill.`, 'OVERPAY')

  const paid = round2(num(p.paid_amount) + amount)
  const due = round2(num(p.total) - paid)
  const ts = nowIso()

  await tx(async (t) => {
    await t.run(
      `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id, purchase_id,
         amount, payment_date, mode, reference, notes, created_by, created_at)
       VALUES (?,?,?,'out','supplier',?,?,?,?,?,?,?,?,?)`,
      [
        newId(),
        companyId,
        p.shop_id,
        p.supplier_id,
        input.purchaseId,
        amount,
        input.paymentDate || today(),
        nullify(input.mode),
        nullify(input.reference),
        nullify(input.notes),
        session.user.id,
        ts
      ]
    )
    await t.run('UPDATE purchases SET paid_amount = ?, due_amount = ?, updated_at = ? WHERE id = ?', [
      paid,
      due,
      ts,
      input.purchaseId
    ])
  })

  await logAudit({
    action: 'payment.pay',
    entity: 'purchase',
    entityId: input.purchaseId,
    summary: `Paid ₹${amount} against ${p.invoice_no}`,
    shopId: p.shop_id
  })
  return { paid, due }
}

/** Everything the Credit / Udhaar screen needs in one call. */
export async function creditBook(params: { shopId?: string; bucket?: string; search?: string }) {
  requirePermission('sale.view')
  const { companyId } = requireCompany()
  const where = ["s.company_id = ?", 's.due_amount > 0.5', "s.status <> 'cancelled'"]
  const args: any[] = [companyId]

  if (params.shopId) {
    where.push('s.shop_id = ?')
    args.push(params.shopId)
  }
  if (params.search) {
    const q = `%${params.search.trim()}%`
    where.push('(c.name LIKE ? OR c.phone_primary LIKE ? OR s.invoice_no LIKE ?)')
    args.push(q, q, q)
  }

  const rows = await all<any>(
    `SELECT s.*, c.name AS customer_name, c.phone_primary AS customer_phone,
            c.phone_secondary AS customer_alt_phone, sh.name AS shop_name, sh.code AS shop_code,
            CAST(julianday('now','localtime') - julianday(s.due_date) AS INTEGER) AS overdue_days
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       JOIN shops sh ON sh.id = s.shop_id
      WHERE ${where.join(' AND ')}
      ORDER BY (s.due_date IS NULL), s.due_date`,
    args
  )

  const shaped = rows.map((r) => {
    const overdue = num(r.overdue_days)
    const bucket =
      !r.due_date ? 'no_date' : overdue <= 0 ? 'upcoming' : overdue <= 7 ? 'due_1_7' : overdue <= 30 ? 'due_8_30' : 'due_30_plus'
    return { ...shapeSale(r), overdueDays: Math.max(0, overdue), bucket, customerAltPhone: r.customer_alt_phone }
  })

  const filtered = params.bucket && params.bucket !== 'all'
    ? shaped.filter((s) => s.bucket === params.bucket)
    : shaped

  const totals = {
    outstanding: round2(shaped.reduce((a, s) => a + num(s.dueAmount), 0)),
    overdue: round2(shaped.filter((s) => s.overdueDays > 0).reduce((a, s) => a + num(s.dueAmount), 0)),
    upcoming: round2(shaped.filter((s) => s.bucket === 'upcoming').reduce((a, s) => a + num(s.dueAmount), 0)),
    count: shaped.length,
    overdueCount: shaped.filter((s) => s.overdueDays > 0).length,
    buckets: {
      upcoming: shaped.filter((s) => s.bucket === 'upcoming').length,
      due_1_7: shaped.filter((s) => s.bucket === 'due_1_7').length,
      due_8_30: shaped.filter((s) => s.bucket === 'due_8_30').length,
      due_30_plus: shaped.filter((s) => s.bucket === 'due_30_plus').length,
      no_date: shaped.filter((s) => s.bucket === 'no_date').length
    }
  }

  return { rows: filtered, totals }
}

/* ========================================================================== */
/*  CANCEL / RETURN                                                           */
/* ========================================================================== */

export async function cancelSale(saleId: string, reason: string) {
  requirePermission('sale.manage')
  const { companyId } = requireCompany()
  const sale = await one<any>('SELECT * FROM sales WHERE id = ? AND company_id = ?', [
    saleId,
    companyId
  ])
  if (!sale) throw new AppError('Sale not found.', 'NOT_FOUND')
  if (sale.status === 'cancelled') throw new AppError('Already cancelled.', 'ALREADY_DONE')
  if (!reason?.trim()) throw new AppError('A reason is required to cancel a bill.', 'VALIDATION')

  const ts = nowIso()
  await tx(async (t) => {
    const units = await t.all<any>('SELECT id FROM stock_units WHERE sale_id = ?', [saleId])
    for (const u of units) {
      await t.run(
        `UPDATE stock_units SET status = 'in_stock', sale_id = NULL, sale_item_id = NULL,
                sold_at = NULL, updated_at = ? WHERE id = ?`,
        [ts, u.id]
      )
    }
    await t.run('DELETE FROM payments WHERE sale_id = ?', [saleId])
    await t.run(
      `UPDATE sales SET status = 'cancelled', due_amount = 0, paid_amount = 0,
              notes = COALESCE(notes,'') || ?, updated_at = ? WHERE id = ?`,
      [`\nCancelled: ${reason.trim()}`, ts, saleId]
    )
  })

  await logAudit({
    action: 'sale.cancel',
    entity: 'sale',
    entityId: saleId,
    summary: `${sale.invoice_no} cancelled — ${reason}`,
    shopId: sale.shop_id
  })
}

/**
 * Permanently removes a bill (for a mistaken entry). Everything it moved is
 * reversed: stock goes back on the shelf and the sale row is deleted, which
 * cascades its line items and payments. An audit entry is written first so the
 * deletion itself is always traceable even though the bill row is gone.
 */
export async function deleteSale(saleId: string, reason?: string) {
  requirePermission('record.delete')
  const { companyId } = requireCompany()
  const sale = await one<any>('SELECT * FROM sales WHERE id = ? AND company_id = ?', [
    saleId,
    companyId
  ])
  if (!sale) throw new AppError('Sale not found.', 'NOT_FOUND')

  await logAudit({
    action: 'sale.delete',
    entity: 'sale',
    entityId: saleId,
    summary: `Deleted ${sale.invoice_no} (₹${round2(num(sale.total))})${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
    shopId: sale.shop_id
  })

  const ts = nowIso()
  await tx(async (t) => {
    // Return every unit this bill sold back to the shelf (stock_units.sale_id
    // has no FK cascade, so it must be cleared by hand).
    await t.run(
      `UPDATE stock_units SET status = 'in_stock', sale_id = NULL, sale_item_id = NULL,
              sold_at = NULL, updated_at = ? WHERE sale_id = ?`,
      [ts, saleId]
    )
    // Deleting the sale cascades sale_items and payments (ON DELETE CASCADE).
    await t.run('DELETE FROM sales WHERE id = ?', [saleId])
  })
}
