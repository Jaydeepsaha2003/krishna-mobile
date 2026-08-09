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
import { normalizeImei } from '../../shared/validators'
import { requireCompany, requirePermission, requireSession } from './session'
import { logAudit } from './audit'

/* ========================================================================== */
/*  STOCK                                                                     */
/* ========================================================================== */

export interface StockFilter {
  shopId?: string
  modelId?: string
  brandId?: string
  status?: string
  search?: string
  supplierId?: string
  addedFrom?: string
  addedTo?: string
  limit?: number
  offset?: number
}

const STOCK_SELECT = `
  SELECT su.*, m.name AS model_name, m.sku, m.gst_rate, m.track_imei, m.default_price,
         b.name AS brand_name, sh.name AS shop_name, sh.code AS shop_code,
         sp.name AS supplier_name
    FROM stock_units su
    JOIN models m   ON m.id = su.model_id
    JOIN brands b   ON b.id = m.brand_id
    LEFT JOIN shops sh     ON sh.id = su.current_shop_id
    LEFT JOIN suppliers sp ON sp.id = su.supplier_id`

function shapeUnit(r: any) {
  return {
    id: r.id,
    modelId: r.model_id,
    modelName: r.model_name,
    brandName: r.brand_name,
    sku: r.sku,
    label: `${r.brand_name} ${r.model_name}`,
    imei1: r.imei1,
    imei2: r.imei2,
    serialNo: r.serial_no,
    color: r.color,
    condition: r.condition,
    costPrice: r.cost_price,
    salePrice: r.sale_price || r.default_price,
    gstRate: r.gst_rate,
    status: r.status,
    shopId: r.current_shop_id,
    shopName: r.shop_name,
    shopCode: r.shop_code,
    supplierName: r.supplier_name,
    purchaseId: r.purchase_id,
    saleId: r.sale_id,
    soldAt: r.sold_at,
    warrantyMonths: r.warranty_months,
    boxNo: r.box_no,
    notes: r.notes,
    addedAt: r.added_at,
    trackImei: !!r.track_imei
  }
}

export async function listStock(filter: StockFilter) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()
  const where = ['su.company_id = ?']
  const args: any[] = [companyId]

  if (filter.shopId) {
    where.push('su.current_shop_id = ?')
    args.push(filter.shopId)
  }
  if (filter.modelId) {
    where.push('su.model_id = ?')
    args.push(filter.modelId)
  }
  if (filter.brandId) {
    where.push('m.brand_id = ?')
    args.push(filter.brandId)
  }
  if (filter.supplierId) {
    where.push('su.supplier_id = ?')
    args.push(filter.supplierId)
  }
  if (filter.status && filter.status !== 'all') {
    where.push('su.status = ?')
    args.push(filter.status)
  }
  if (filter.addedFrom) {
    where.push('date(su.added_at) >= ?')
    args.push(filter.addedFrom)
  }
  if (filter.addedTo) {
    where.push('date(su.added_at) <= ?')
    args.push(filter.addedTo)
  }
  if (filter.search) {
    const q = `%${filter.search.trim()}%`
    where.push(
      '(su.imei1 LIKE ? OR su.imei2 LIKE ? OR su.serial_no LIKE ? OR m.name LIKE ? OR m.sku LIKE ? OR b.name LIKE ?)'
    )
    args.push(q, q, q, q, q, q)
  }

  const clause = `WHERE ${where.join(' AND ')}`
  const total =
    (await scalar<number>(
      `SELECT COUNT(*) FROM stock_units su JOIN models m ON m.id = su.model_id
         JOIN brands b ON b.id = m.brand_id ${clause}`,
      args
    )) ?? 0

  const rows = await all<any>(
    `${STOCK_SELECT} ${clause} ORDER BY su.added_at DESC LIMIT ? OFFSET ?`,
    [...args, filter.limit ?? 200, filter.offset ?? 0]
  )
  return { rows: rows.map(shapeUnit), total }
}

/** Fast IMEI lookup — powers the scan box on the sale screen. */
export async function findByImei(imei: string) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()
  const d = normalizeImei(imei)
  if (d.length < 4) return []
  const rows = await all<any>(
    `${STOCK_SELECT} WHERE su.company_id = ? AND (su.imei1 LIKE ? OR su.imei2 LIKE ? OR su.serial_no LIKE ?)
      ORDER BY (su.status = 'in_stock') DESC, su.added_at DESC LIMIT 20`,
    [companyId, `%${d}%`, `%${d}%`, `%${d}%`]
  )
  return rows.map(shapeUnit)
}

/** Units available to sell at a shop (searchable dropdown source). */
export async function availableStock(shopId: string, search?: string, limit = 50) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()
  const args: any[] = [companyId, shopId]
  let extra = ''
  if (search) {
    const q = `%${search.trim()}%`
    extra = 'AND (su.imei1 LIKE ? OR m.name LIKE ? OR m.sku LIKE ? OR b.name LIKE ?)'
    args.push(q, q, q, q)
  }
  const rows = await all<any>(
    `${STOCK_SELECT}
      WHERE su.company_id = ? AND su.current_shop_id = ? AND su.status = 'in_stock' ${extra}
      ORDER BY b.name, m.name, su.added_at LIMIT ?`,
    [...args, limit]
  )
  return rows.map(shapeUnit)
}

/**
 * Models that actually have stock at a shop, with the available quantity.
 * Powers the "pick from stock, then type a quantity" picker: only SKUs with
 * `available > 0` are returned, so nothing out of stock can be picked.
 *
 * Defaults to non-IMEI items (accessories sold by quantity). Pass
 * `includeImei` to list serialised models too — used by stock transfers, where
 * quantity-picking is valid for every kind of item.
 */
export async function availableModels(
  shopId: string,
  search?: string,
  limit = 50,
  includeImei = false
) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()
  // Param order matches the query: shopId (JOIN), companyId (WHERE), search x3, limit.
  const args: any[] = [shopId, companyId]
  let extra = ''
  if (search) {
    const q = `%${search.trim()}%`
    extra = 'AND (m.name LIKE ? OR m.sku LIKE ? OR b.name LIKE ?)'
    args.push(q, q, q)
  }
  const rows = await all<any>(
    `SELECT m.id AS model_id, m.name AS model_name, m.sku, m.default_price, m.gst_rate,
            m.track_imei, b.name AS brand_name, COUNT(su.id) AS available,
            COALESCE(AVG(su.cost_price), 0) AS avg_cost,
            COALESCE(NULLIF(MAX(su.sale_price), 0), m.default_price) AS sale_price
       FROM models m
       JOIN brands b ON b.id = m.brand_id
       JOIN stock_units su
              ON su.model_id = m.id AND su.status = 'in_stock' AND su.current_shop_id = ?
      WHERE m.company_id = ? AND m.is_active = 1 ${includeImei ? '' : 'AND m.track_imei = 0'} ${extra}
      GROUP BY m.id
      HAVING available > 0
      ORDER BY b.name, m.name
      LIMIT ?`,
    [...args, limit]
  )
  return rows.map((r) => ({
    modelId: r.model_id,
    brandName: r.brand_name,
    modelName: r.model_name,
    sku: r.sku,
    trackImei: !!r.track_imei,
    available: r.available ?? 0,
    salePrice: round2(num(r.sale_price)),
    gstRate: num(r.gst_rate, 0),
    avgCost: round2(num(r.avg_cost))
  }))
}

/** Model-wise stock roll-up for a shop (or the whole company). */
export async function stockSummary(shopId?: string) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()
  const rows = await all<any>(
    `SELECT m.id AS model_id, m.name AS model_name, m.sku, m.low_stock_alert, m.default_price,
            b.name AS brand_name,
            COUNT(su.id)                    AS qty,
            COALESCE(SUM(su.cost_price), 0) AS stock_value,
            MIN(su.added_at)                AS oldest_at
       FROM models m
       JOIN brands b ON b.id = m.brand_id
       LEFT JOIN stock_units su
              ON su.model_id = m.id AND su.status = 'in_stock'
             AND (? = '' OR su.current_shop_id = ?)
      WHERE m.company_id = ? AND m.is_active = 1
      GROUP BY m.id
      ORDER BY qty DESC, b.name, m.name`,
    [shopId ?? '', shopId ?? '', companyId]
  )
  return rows.map((r) => ({
    modelId: r.model_id,
    modelName: r.model_name,
    brandName: r.brand_name,
    sku: r.sku,
    qty: r.qty ?? 0,
    stockValue: round2(num(r.stock_value)),
    lowStockAlert: r.low_stock_alert,
    defaultPrice: r.default_price,
    isLow: (r.qty ?? 0) <= (r.low_stock_alert ?? 0),
    oldestAt: r.oldest_at,
    ageDays: r.oldest_at
      ? Math.floor((Date.now() - new Date(r.oldest_at).getTime()) / 86400000)
      : null
  }))
}

/* ========================================================================== */
/*  PURCHASES                                                                 */
/* ========================================================================== */

export interface PurchaseUnitInput {
  imei1?: string
  imei2?: string
  serialNo?: string
  color?: string
  condition?: string
  salePrice?: number
  warrantyMonths?: number
  boxNo?: string
}

export interface PurchaseItemInput {
  modelId: string
  qty: number
  unitCost: number
  discount?: number
  gstRate?: number
  units?: PurchaseUnitInput[]
  notes?: string
}

export interface PurchaseInput {
  shopId: string
  supplierId?: string
  invoiceNo: string
  purchaseDate: string
  items: PurchaseItemInput[]
  otherCharges?: number
  discount?: number
  roundOff?: number
  paidAmount?: number
  paymentMode?: string
  dueDate?: string
  notes?: string
}

export async function createPurchase(input: PurchaseInput) {
  requirePermission('purchase.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  if (!input.shopId) throw new AppError('Choose the shop receiving this stock.', 'VALIDATION')
  if (!input.items?.length) throw new AppError('Add at least one item.', 'VALIDATION')
  if (!input.invoiceNo?.trim())
    throw new AppError("Enter the supplier's bill / invoice number.", 'VALIDATION')

  // ---- validate + price every line ----------------------------------------
  const models = await all<any>(
    `SELECT id, name, track_imei, gst_rate FROM models WHERE company_id = ?`,
    [companyId]
  )
  const modelMap = new Map(models.map((m) => [m.id, m]))

  let subtotal = 0
  let taxTotal = 0
  const lines = input.items.map((item) => {
    const model = modelMap.get(item.modelId)
    if (!model) throw new AppError('One of the selected models no longer exists.', 'VALIDATION')

    const qty = Math.max(1, Math.floor(num(item.qty, 1)))
    const unitCost = num(item.unitCost)
    if (unitCost <= 0) throw new AppError(`Enter a purchase price for ${model.name}.`, 'VALIDATION')

    const discount = num(item.discount)
    const gstRate = num(item.gstRate, model.gst_rate)
    const taxable = round2(unitCost * qty - discount)
    const tax = round2((taxable * gstRate) / 100)
    const lineTotal = round2(taxable + tax)

    subtotal += taxable
    taxTotal += tax

    const units = item.units ?? []
    if (model.track_imei) {
      if (units.length !== qty)
        throw new AppError(
          `${model.name}: enter ${qty} IMEI number(s) — got ${units.length}.`,
          'VALIDATION'
        )
      for (const u of units) {
        const d = normalizeImei(u.imei1 ?? '')
        if (d.length !== 15)
          throw new AppError(`${model.name}: every IMEI must be 15 digits.`, 'VALIDATION')
      }
    }

    return { item, model, qty, unitCost, discount, gstRate, taxable, tax, lineTotal, units }
  })

  // ---- duplicate IMEI guard ------------------------------------------------
  const imeis = lines.flatMap((l) =>
    l.units.map((u) => normalizeImei(u.imei1 ?? '')).filter((d) => d.length === 15)
  )
  const dupInBatch = imeis.find((v, i) => imeis.indexOf(v) !== i)
  if (dupInBatch) throw new AppError(`IMEI ${dupInBatch} is entered twice in this bill.`, 'DUPLICATE')

  for (const imei of imeis) {
    const existing = await one<{ id: string; status: string }>(
      'SELECT id, status FROM stock_units WHERE company_id = ? AND imei1 = ?',
      [companyId, imei]
    )
    if (existing)
      throw new AppError(
        `IMEI ${imei} already exists in your stock (status: ${existing.status}).`,
        'DUPLICATE'
      )
  }

  const otherCharges = num(input.otherCharges)
  const billDiscount = num(input.discount)
  const roundOff = num(input.roundOff)
  const total = round2(subtotal + taxTotal + otherCharges - billDiscount + roundOff)
  const paid = Math.min(num(input.paidAmount), total)
  const due = round2(total - paid)

  const purchaseId = newId()
  const ts = nowIso()
  const purchaseDate = input.purchaseDate || today()

  // Spread bill-level charges/discount across units so cost price is landed cost.
  const unitCount = lines.reduce((a, l) => a + l.qty, 0)
  const perUnitAdjust = unitCount > 0 ? round2((otherCharges - billDiscount) / unitCount) : 0

  await tx(async (t) => {
    await t.run(
      `INSERT INTO purchases (id, company_id, shop_id, supplier_id, invoice_no, purchase_date,
         subtotal, discount, tax_amount, other_charges, round_off, total, paid_amount, due_amount,
         payment_mode, due_date, status, notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'completed',?,?,?,?)`,
      [
        purchaseId,
        companyId,
        input.shopId,
        nullify(input.supplierId),
        input.invoiceNo.trim(),
        purchaseDate,
        round2(subtotal),
        billDiscount,
        round2(taxTotal),
        otherCharges,
        roundOff,
        total,
        paid,
        due,
        nullify(input.paymentMode),
        nullify(input.dueDate),
        nullify(input.notes),
        session.user.id,
        ts,
        ts
      ]
    )

    for (const line of lines) {
      const itemId = newId()
      await t.run(
        `INSERT INTO purchase_items (id, purchase_id, model_id, qty, unit_cost, discount,
           gst_rate, tax_amount, line_total, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          itemId,
          purchaseId,
          line.item.modelId,
          line.qty,
          line.unitCost,
          line.discount,
          line.gstRate,
          line.tax,
          line.lineTotal,
          nullify(line.item.notes)
        ]
      )

      const perUnitCost = round2(line.lineTotal / line.qty + perUnitAdjust)

      for (let i = 0; i < line.qty; i++) {
        const u = line.units[i] ?? {}
        await t.run(
          `INSERT INTO stock_units (id, company_id, model_id, imei1, imei2, serial_no, color,
             condition, cost_price, sale_price, status, current_shop_id, origin_shop_id,
             purchase_id, purchase_item_id, supplier_id, warranty_months, box_no, added_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'in_stock',?,?,?,?,?,?,?,?,?)`,
          [
            newId(),
            companyId,
            line.item.modelId,
            nullify(u.imei1 && normalizeImei(u.imei1)),
            nullify(u.imei2 && normalizeImei(u.imei2)),
            nullify(u.serialNo),
            nullify(u.color),
            nullify(u.condition) ?? 'New',
            perUnitCost,
            num(u.salePrice),
            input.shopId,
            input.shopId,
            purchaseId,
            itemId,
            nullify(input.supplierId),
            num(u.warrantyMonths, 12),
            nullify(u.boxNo),
            ts,
            ts
          ]
        )
      }
    }

    if (paid > 0) {
      await t.run(
        `INSERT INTO payments (id, company_id, shop_id, direction, party_type, party_id,
           purchase_id, amount, payment_date, mode, notes, created_by, created_at)
         VALUES (?,?,?,'out','supplier',?,?,?,?,?,?,?,?)`,
        [
          newId(),
          companyId,
          input.shopId,
          nullify(input.supplierId),
          purchaseId,
          paid,
          purchaseDate,
          nullify(input.paymentMode),
          'Paid with purchase',
          session.user.id,
          ts
        ]
      )
    }
  })

  await logAudit({
    action: 'purchase.create',
    entity: 'purchase',
    entityId: purchaseId,
    summary: `Purchase ${input.invoiceNo} — ${unitCount} unit(s), ₹${total}`,
    shopId: input.shopId
  })

  return { id: purchaseId, total, units: unitCount }
}

export async function listPurchases(params: {
  shopId?: string
  supplierId?: string
  from?: string
  to?: string
  search?: string
  onlyDue?: boolean
  limit?: number
  offset?: number
}) {
  requirePermission('purchase.view')
  const { companyId } = requireCompany()
  const where = ['p.company_id = ?']
  const args: any[] = [companyId]

  if (params.shopId) {
    where.push('p.shop_id = ?')
    args.push(params.shopId)
  }
  if (params.supplierId) {
    where.push('p.supplier_id = ?')
    args.push(params.supplierId)
  }
  if (params.from) {
    where.push('p.purchase_date >= ?')
    args.push(params.from)
  }
  if (params.to) {
    where.push('p.purchase_date <= ?')
    args.push(params.to)
  }
  if (params.onlyDue) where.push('p.due_amount > 0.5')
  if (params.search) {
    const q = `%${params.search}%`
    where.push('(p.invoice_no LIKE ? OR s.name LIKE ?)')
    args.push(q, q)
  }

  const clause = `WHERE ${where.join(' AND ')}`
  const rows = await all<any>(
    `SELECT p.*, s.name AS supplier_name, sh.name AS shop_name, sh.code AS shop_code,
            (SELECT COUNT(*) FROM stock_units su WHERE su.purchase_id = p.id) AS unit_count
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       JOIN shops sh ON sh.id = p.shop_id
       ${clause}
       ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT ? OFFSET ?`,
    [...args, params.limit ?? 100, params.offset ?? 0]
  )
  const totals = await one<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(p.total),0) AS total, COALESCE(SUM(p.due_amount),0) AS due
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${clause}`,
    args
  )
  return {
    rows: rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      purchaseDate: r.purchase_date,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      shopId: r.shop_id,
      shopName: r.shop_name,
      shopCode: r.shop_code,
      subtotal: r.subtotal,
      taxAmount: r.tax_amount,
      otherCharges: r.other_charges,
      discount: r.discount,
      total: r.total,
      paidAmount: r.paid_amount,
      dueAmount: r.due_amount,
      dueDate: r.due_date,
      paymentMode: r.payment_mode,
      status: r.status,
      unitCount: r.unit_count ?? 0,
      notes: r.notes
    })),
    summary: { count: totals?.n ?? 0, total: totals?.total ?? 0, due: totals?.due ?? 0 }
  }
}

export async function getPurchase(id: string) {
  requirePermission('purchase.view')
  const purchase = await one<any>(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, s.gstin AS supplier_gstin,
            sh.name AS shop_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       JOIN shops sh ON sh.id = p.shop_id WHERE p.id = ?`,
    [id]
  )
  if (!purchase) throw new AppError('Purchase not found.', 'NOT_FOUND')

  const items = await all<any>(
    `SELECT pi.*, m.name AS model_name, m.sku, b.name AS brand_name
       FROM purchase_items pi
       JOIN models m ON m.id = pi.model_id
       JOIN brands b ON b.id = m.brand_id
      WHERE pi.purchase_id = ?`,
    [id]
  )
  const units = await all<any>(
    `${STOCK_SELECT} WHERE su.purchase_id = ? ORDER BY su.added_at`,
    [id]
  )
  const payments = await all<any>(
    'SELECT * FROM payments WHERE purchase_id = ? ORDER BY payment_date',
    [id]
  )
  return { purchase, items, units: units.map(shapeUnit), payments }
}

/**
 * Permanently removes a purchase bill (a mistaken entry). Only allowed while
 * none of its units have moved on: if any unit has been sold, transferred, or
 * otherwise changed from in-stock, the delete is refused so we never orphan a
 * sale or transfer. Otherwise the units it created are removed and the purchase
 * row is deleted, cascading its items and payments.
 */
export async function deletePurchase(purchaseId: string, reason?: string) {
  requirePermission('purchase.manage')
  const { companyId } = requireCompany()
  const purchase = await one<any>('SELECT * FROM purchases WHERE id = ? AND company_id = ?', [
    purchaseId,
    companyId
  ])
  if (!purchase) throw new AppError('Purchase not found.', 'NOT_FOUND')

  const blocked =
    (await scalar<number>(
      `SELECT COUNT(*) FROM stock_units su
        WHERE su.purchase_id = ?
          AND (su.status <> 'in_stock'
               OR EXISTS (SELECT 1 FROM sale_items si WHERE si.stock_unit_id = su.id)
               OR EXISTS (SELECT 1 FROM transfer_items ti WHERE ti.stock_unit_id = su.id))`,
      [purchaseId]
    )) ?? 0
  if (blocked > 0)
    throw new AppError(
      `Cannot delete: ${blocked} item(s) from this bill have already been sold or transferred. Reverse those first.`,
      'HAS_MOVEMENT'
    )

  await logAudit({
    action: 'purchase.delete',
    entity: 'purchase',
    entityId: purchaseId,
    summary: `Deleted ${purchase.invoice_no} (₹${round2(num(purchase.total))})${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
    shopId: purchase.shop_id
  })

  await tx(async (t) => {
    // Remove the units this bill created (they reference the purchase, so they
    // must go before the purchase row can be deleted with foreign keys on).
    await t.run('DELETE FROM stock_units WHERE purchase_id = ?', [purchaseId])
    // Deleting the purchase cascades purchase_items and payments.
    await t.run('DELETE FROM purchases WHERE id = ?', [purchaseId])
  })
}

/* ========================================================================== */
/*  TRANSFERS  (Shop 1 -> Shop 2)                                             */
/* ========================================================================== */

export interface TransferInput {
  fromShopId: string
  toShopId: string
  transferDate: string
  stockUnitIds: string[]
  /** Optional per-unit price if the owner wants to book margin at the sending shop. */
  transferPrices?: Record<string, number>
  notes?: string
  autoReceive?: boolean
}

/**
 * Transfer by quantity instead of by hand-picked unit: for each model, take the
 * oldest in-stock units at the sending shop (FIFO) and hand them to
 * createTransfer, which does all the validation and bookkeeping. This is what
 * the "New transfer" screen uses — the cashier picks a product and a quantity
 * rather than ticking individual IMEIs.
 */
export async function createTransferByModel(input: {
  fromShopId: string
  toShopId: string
  transferDate?: string
  lines: Array<{ modelId: string; qty: number }>
  notes?: string
  autoReceive?: boolean
}) {
  requirePermission('transfer.manage')
  const { companyId } = requireCompany()

  if (input.fromShopId === input.toShopId)
    throw new AppError('Source and destination shops must be different.', 'VALIDATION')
  if (!input.lines?.length) throw new AppError('Add at least one product to transfer.', 'VALIDATION')

  const stockUnitIds: string[] = []
  for (const line of input.lines) {
    const qty = Math.floor(num(line.qty))
    if (qty < 1) continue
    const model = await one<any>(
      `SELECT m.name, b.name AS brand_name FROM models m JOIN brands b ON b.id = m.brand_id
        WHERE m.id = ? AND m.company_id = ?`,
      [line.modelId, companyId]
    )
    const label = model ? `${model.brand_name} ${model.name}` : 'item'
    const avail = await all<{ id: string }>(
      `SELECT id FROM stock_units
        WHERE company_id = ? AND model_id = ? AND current_shop_id = ? AND status = 'in_stock'
        ORDER BY added_at LIMIT ?`,
      [companyId, line.modelId, input.fromShopId, qty]
    )
    if (avail.length < qty)
      throw new AppError(
        `Only ${avail.length} × ${label} in stock at the sending shop — cannot transfer ${qty}.`,
        'NO_STOCK'
      )
    stockUnitIds.push(...avail.map((u) => u.id))
  }

  if (!stockUnitIds.length) throw new AppError('Enter a quantity to transfer.', 'VALIDATION')

  return createTransfer({
    fromShopId: input.fromShopId,
    toShopId: input.toShopId,
    transferDate: input.transferDate ?? today(),
    stockUnitIds,
    notes: input.notes,
    autoReceive: input.autoReceive
  })
}

export async function createTransfer(input: TransferInput) {
  requirePermission('transfer.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  if (input.fromShopId === input.toShopId)
    throw new AppError('Source and destination shops must be different.', 'VALIDATION')
  if (!input.stockUnitIds?.length)
    throw new AppError('Select at least one unit to transfer.', 'VALIDATION')

  const units = await all<any>(
    `SELECT su.id, su.status, su.current_shop_id, su.cost_price, m.name AS model_name, su.imei1
       FROM stock_units su JOIN models m ON m.id = su.model_id
      WHERE su.company_id = ? AND su.id IN (${input.stockUnitIds.map(() => '?').join(',')})`,
    [companyId, ...input.stockUnitIds]
  )
  if (units.length !== input.stockUnitIds.length)
    throw new AppError('Some selected units could not be found.', 'VALIDATION')

  for (const u of units) {
    if (u.status !== 'in_stock')
      throw new AppError(
        `${u.model_name} (${u.imei1 ?? 'no IMEI'}) is "${u.status}" and cannot be transferred.`,
        'BAD_STATUS'
      )
    if (u.current_shop_id !== input.fromShopId)
      throw new AppError(
        `${u.model_name} (${u.imei1 ?? 'no IMEI'}) is not at the source shop.`,
        'BAD_SHOP'
      )
  }

  const shop = await one<{ invoice_prefix: string; code: string }>(
    'SELECT invoice_prefix, code FROM shops WHERE id = ?',
    [input.fromShopId]
  )
  const transferDate = input.transferDate || today()
  const transferNo = await nextDocumentNumber({
    companyId,
    shopId: input.fromShopId,
    kind: 'transfer',
    date: transferDate,
    prefix: `${shop?.invoice_prefix ?? shop?.code ?? 'TR'}/TR`
  })

  const transferId = newId()
  const ts = nowIso()
  const totalValue = round2(
    units.reduce((a, u) => a + num(input.transferPrices?.[u.id], num(u.cost_price)), 0)
  )
  const receiveNow = input.autoReceive === true

  await tx(async (t) => {
    await t.run(
      `INSERT INTO transfers (id, company_id, transfer_no, from_shop_id, to_shop_id, transfer_date,
         status, total_units, total_value, notes, created_by, received_by, received_at,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        transferId,
        companyId,
        transferNo,
        input.fromShopId,
        input.toShopId,
        transferDate,
        receiveNow ? 'received' : 'in_transit',
        units.length,
        totalValue,
        nullify(input.notes),
        session.user.id,
        receiveNow ? session.user.id : null,
        receiveNow ? ts : null,
        ts,
        ts
      ]
    )

    for (const u of units) {
      const price = num(input.transferPrices?.[u.id], num(u.cost_price))
      await t.run(
        `INSERT INTO transfer_items (id, transfer_id, stock_unit_id, cost_at_transfer,
           transfer_price, received) VALUES (?,?,?,?,?,?)`,
        [newId(), transferId, u.id, num(u.cost_price), price, receiveNow ? 1 : 0]
      )
      if (receiveNow) {
        await t.run(
          `UPDATE stock_units SET current_shop_id = ?, status = 'in_stock', transfer_id = ?,
                  cost_price = ?, updated_at = ? WHERE id = ?`,
          [input.toShopId, transferId, price, ts, u.id]
        )
      } else {
        await t.run(
          `UPDATE stock_units SET status = 'in_transit', transfer_id = ?, updated_at = ? WHERE id = ?`,
          [transferId, ts, u.id]
        )
      }
    }
  })

  await logAudit({
    action: 'transfer.create',
    entity: 'transfer',
    entityId: transferId,
    summary: `${transferNo}: ${units.length} unit(s)`,
    shopId: input.fromShopId
  })

  return { id: transferId, transferNo, units: units.length, totalValue }
}

export async function receiveTransfer(transferId: string, stockUnitIds?: string[]) {
  requirePermission('transfer.manage')
  const session = requireSession()

  const transfer = await one<any>('SELECT * FROM transfers WHERE id = ?', [transferId])
  if (!transfer) throw new AppError('Transfer not found.', 'NOT_FOUND')
  if (transfer.status === 'received')
    throw new AppError('This transfer has already been received.', 'ALREADY_DONE')
  if (transfer.status === 'cancelled')
    throw new AppError('This transfer was cancelled.', 'CANCELLED')

  const items = await all<any>(
    'SELECT * FROM transfer_items WHERE transfer_id = ? AND received = 0',
    [transferId]
  )
  const target = stockUnitIds?.length
    ? items.filter((i) => stockUnitIds.includes(i.stock_unit_id))
    : items
  if (!target.length) throw new AppError('Nothing left to receive on this transfer.', 'EMPTY')

  const ts = nowIso()
  await tx(async (t) => {
    for (const item of target) {
      await t.run(
        `UPDATE stock_units SET current_shop_id = ?, status = 'in_stock', cost_price = ?,
                updated_at = ? WHERE id = ?`,
        [transfer.to_shop_id, num(item.transfer_price, num(item.cost_at_transfer)), ts, item.stock_unit_id]
      )
      await t.run('UPDATE transfer_items SET received = 1 WHERE id = ?', [item.id])
    }
    const remaining = items.length - target.length
    await t.run(
      `UPDATE transfers SET status = ?, received_by = ?, received_at = ?, updated_at = ? WHERE id = ?`,
      [remaining > 0 ? 'in_transit' : 'received', session.user.id, ts, ts, transferId]
    )
  })

  await logAudit({
    action: 'transfer.receive',
    entity: 'transfer',
    entityId: transferId,
    summary: `Received ${target.length} unit(s) of ${transfer.transfer_no}`,
    shopId: transfer.to_shop_id
  })

  return { received: target.length }
}

export async function cancelTransfer(transferId: string, reason?: string) {
  requirePermission('transfer.manage')
  const transfer = await one<any>('SELECT * FROM transfers WHERE id = ?', [transferId])
  if (!transfer) throw new AppError('Transfer not found.', 'NOT_FOUND')
  if (transfer.status === 'received')
    throw new AppError('A received transfer cannot be cancelled.', 'ALREADY_DONE')

  const ts = nowIso()
  await tx(async (t) => {
    const items = await t.all<any>(
      'SELECT stock_unit_id FROM transfer_items WHERE transfer_id = ? AND received = 0',
      [transferId]
    )
    for (const i of items) {
      await t.run(
        `UPDATE stock_units SET status = 'in_stock', current_shop_id = ?, transfer_id = NULL,
                updated_at = ? WHERE id = ?`,
        [transfer.from_shop_id, ts, i.stock_unit_id]
      )
    }
    await t.run(
      `UPDATE transfers SET status = 'cancelled', notes = COALESCE(notes,'') || ?, updated_at = ?
        WHERE id = ?`,
      [`\nCancelled: ${reason ?? 'no reason given'}`, ts, transferId]
    )
  })
  await logAudit({ action: 'transfer.cancel', entity: 'transfer', entityId: transferId, summary: reason })
}

export async function listTransfers(params: {
  shopId?: string
  direction?: 'in' | 'out' | 'all'
  status?: string
  from?: string
  to?: string
  limit?: number
}) {
  requirePermission('transfer.view')
  const { companyId } = requireCompany()
  const where = ['t.company_id = ?']
  const args: any[] = [companyId]

  if (params.shopId) {
    if (params.direction === 'in') {
      where.push('t.to_shop_id = ?')
      args.push(params.shopId)
    } else if (params.direction === 'out') {
      where.push('t.from_shop_id = ?')
      args.push(params.shopId)
    } else {
      where.push('(t.from_shop_id = ? OR t.to_shop_id = ?)')
      args.push(params.shopId, params.shopId)
    }
  }
  if (params.status && params.status !== 'all') {
    where.push('t.status = ?')
    args.push(params.status)
  }
  if (params.from) {
    where.push('t.transfer_date >= ?')
    args.push(params.from)
  }
  if (params.to) {
    where.push('t.transfer_date <= ?')
    args.push(params.to)
  }

  const rows = await all<any>(
    `SELECT t.*, f.name AS from_shop_name, f.code AS from_shop_code,
            d.name AS to_shop_name, d.code AS to_shop_code,
            u.name AS created_by_name
       FROM transfers t
       JOIN shops f ON f.id = t.from_shop_id
       JOIN shops d ON d.id = t.to_shop_id
       LEFT JOIN users u ON u.id = t.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY t.transfer_date DESC, t.created_at DESC LIMIT ?`,
    [...args, params.limit ?? 100]
  )
  return rows.map((r) => ({
    id: r.id,
    transferNo: r.transfer_no,
    transferDate: r.transfer_date,
    fromShopId: r.from_shop_id,
    fromShopName: r.from_shop_name,
    fromShopCode: r.from_shop_code,
    toShopId: r.to_shop_id,
    toShopName: r.to_shop_name,
    toShopCode: r.to_shop_code,
    status: r.status,
    totalUnits: r.total_units,
    totalValue: r.total_value,
    notes: r.notes,
    createdByName: r.created_by_name,
    receivedAt: r.received_at
  }))
}

export async function getTransfer(id: string) {
  requirePermission('transfer.view')
  const transfer = await one<any>(
    `SELECT t.*, f.name AS from_shop_name, d.name AS to_shop_name
       FROM transfers t JOIN shops f ON f.id = t.from_shop_id JOIN shops d ON d.id = t.to_shop_id
      WHERE t.id = ?`,
    [id]
  )
  if (!transfer) throw new AppError('Transfer not found.', 'NOT_FOUND')
  const items = await all<any>(
    `SELECT ti.*, su.imei1, su.serial_no, su.color, m.name AS model_name, b.name AS brand_name
       FROM transfer_items ti
       JOIN stock_units su ON su.id = ti.stock_unit_id
       JOIN models m ON m.id = su.model_id
       JOIN brands b ON b.id = m.brand_id
      WHERE ti.transfer_id = ?`,
    [id]
  )
  return { transfer, items }
}

/* ========================================================================== */
/*  MANUAL STOCK IN / OUT  (no supplier bill)                                 */
/* ========================================================================== */

/**
 * Adds stock by hand, without a purchase bill — for opening stock, a local
 * cash buy, or anything that never came through a supplier invoice.
 *
 * Prices are entered GST-INCLUSIVE (what was actually paid / will be charged),
 * matching how the rest of the app treats money. `qty` units are created; for
 * an IMEI-tracked model supply one IMEI per unit.
 */
export async function addManualStock(input: {
  shopId: string
  modelId: string
  qty: number
  costPrice: number
  salePrice?: number
  gstRate?: number
  condition?: string
  color?: string
  imeis?: string[]
  reasonCode?: string
  note?: string
}) {
  requirePermission('stock.adjust')
  const { companyId } = requireCompany()
  const session = requireSession()

  if (!input.shopId) throw new AppError('Choose the shop receiving this stock.', 'VALIDATION')
  const model = await one<any>(
    `SELECT m.*, b.name AS brand_name FROM models m JOIN brands b ON b.id = m.brand_id
      WHERE m.id = ? AND m.company_id = ?`,
    [input.modelId, companyId]
  )
  if (!model) throw new AppError('Choose the product being added.', 'VALIDATION')

  const qty = Math.floor(num(input.qty))
  if (qty < 1 || qty > 500) throw new AppError('Quantity must be between 1 and 500.', 'VALIDATION')

  const costPrice = round2(num(input.costPrice))
  if (costPrice < 0) throw new AppError('Cost price cannot be negative.', 'VALIDATION')
  const salePrice = round2(num(input.salePrice))

  // IMEI-tracked models need one valid, unused IMEI per unit.
  const imeis = (input.imeis ?? []).map((v) => normalizeImei(v ?? '')).filter(Boolean)
  if (model.track_imei) {
    if (imeis.length !== qty)
      throw new AppError(`${model.name}: enter ${qty} IMEI number(s) — got ${imeis.length}.`, 'VALIDATION')
    const dup = imeis.find((v, i) => imeis.indexOf(v) !== i)
    if (dup) throw new AppError(`IMEI ${dup} is entered twice.`, 'DUPLICATE')
    for (const imei of imeis) {
      if (imei.length !== 15) throw new AppError('Every IMEI must be 15 digits.', 'VALIDATION')
      const existing = await one<{ status: string }>(
        'SELECT status FROM stock_units WHERE company_id = ? AND imei1 = ?',
        [companyId, imei]
      )
      if (existing)
        throw new AppError(`IMEI ${imei} is already in stock (${existing.status}).`, 'DUPLICATE')
    }
  }

  const ts = nowIso()
  const label = `${model.brand_name} ${model.name}`

  await tx(async (t) => {
    for (let i = 0; i < qty; i++) {
      const unitId = newId()
      await t.run(
        `INSERT INTO stock_units (id, company_id, model_id, imei1, color, condition, cost_price,
           sale_price, status, current_shop_id, origin_shop_id, warranty_months, notes,
           added_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'in_stock', ?,?,?,?,?,?)`,
        [
          unitId,
          companyId,
          input.modelId,
          nullify(model.track_imei ? imeis[i] : null),
          nullify(input.color ?? model.color),
          nullify(input.condition) ?? 'New',
          costPrice,
          salePrice,
          input.shopId,
          input.shopId,
          num(model.warranty_months, 12),
          nullify(input.note ? `Added manually: ${input.note}` : 'Added manually (no purchase bill)'),
          ts,
          ts
        ]
      )
      await t.run(
        `INSERT INTO stock_adjustments (id, company_id, shop_id, stock_unit_id, model_id, qty,
           from_status, to_status, reason_code, reason_note, value_impact, created_by, created_at)
         VALUES (?,?,?,?,?,1,NULL,'in_stock',?,?,?,?,?)`,
        [
          newId(),
          companyId,
          input.shopId,
          unitId,
          input.modelId,
          nullify(input.reasonCode) ?? 'UNRECORDED_PURCHASE',
          nullify(input.note),
          costPrice,
          session.user.id,
          ts
        ]
      )
    }
  })

  await logAudit({
    action: 'stock.addManual',
    entity: 'stock_unit',
    summary: `Added ${qty} × ${label} manually at ₹${costPrice} each${input.note ? ` — ${input.note}` : ''}`,
    shopId: input.shopId
  })

  return { added: qty, label }
}

/**
 * Removes stock by hand — damage, loss, personal use, a sale that never went
 * through the till. Takes the oldest in-stock units of the model (FIFO) and
 * moves them out of `in_stock`, recording an adjustment per unit. Nothing is
 * deleted, so the history stays auditable.
 */
export async function removeManualStock(input: {
  shopId: string
  modelId: string
  qty: number
  toStatus?: string
  reasonCode: string
  note?: string
}) {
  requirePermission('stock.adjust')
  const { companyId } = requireCompany()
  const session = requireSession()

  const model = await one<any>(
    `SELECT m.*, b.name AS brand_name FROM models m JOIN brands b ON b.id = m.brand_id
      WHERE m.id = ? AND m.company_id = ?`,
    [input.modelId, companyId]
  )
  if (!model) throw new AppError('Choose the product being removed.', 'VALIDATION')

  const qty = Math.floor(num(input.qty))
  if (qty < 1) throw new AppError('Quantity must be at least 1.', 'VALIDATION')
  if (!input.reasonCode) throw new AppError('Choose a reason for removing this stock.', 'VALIDATION')

  const toStatus = input.toStatus || 'damaged'
  if (toStatus === 'sold')
    throw new AppError('Use a sale to mark stock sold.', 'VALIDATION')

  const ts = nowIso()
  const label = `${model.brand_name} ${model.name}`

  await tx(async (t) => {
    const avail = await t.all<{ id: string; cost_price: number }>(
      `SELECT id, cost_price FROM stock_units
        WHERE company_id = ? AND model_id = ? AND current_shop_id = ? AND status = 'in_stock'
        ORDER BY added_at LIMIT ?`,
      [companyId, input.modelId, input.shopId, qty]
    )
    if (avail.length < qty)
      throw new AppError(
        `Only ${avail.length} × ${label} in stock at this shop — cannot remove ${qty}.`,
        'NO_STOCK'
      )

    for (const u of avail) {
      await t.run('UPDATE stock_units SET status = ?, updated_at = ? WHERE id = ?', [
        toStatus,
        ts,
        u.id
      ])
      await t.run(
        `INSERT INTO stock_adjustments (id, company_id, shop_id, stock_unit_id, model_id, qty,
           from_status, to_status, reason_code, reason_note, value_impact, created_by, created_at)
         VALUES (?,?,?,?,?,1,'in_stock',?,?,?,?,?,?)`,
        [
          newId(),
          companyId,
          input.shopId,
          u.id,
          input.modelId,
          toStatus,
          input.reasonCode,
          nullify(input.note),
          -num(u.cost_price),
          session.user.id,
          ts
        ]
      )
    }
  })

  await logAudit({
    action: 'stock.removeManual',
    entity: 'stock_unit',
    summary: `Removed ${qty} × ${label} (${toStatus})${input.note ? ` — ${input.note}` : ''}`,
    shopId: input.shopId
  })

  return { removed: qty, label }
}

/* ========================================================================== */
/*  ADJUSTMENTS                                                               */
/* ========================================================================== */

export async function adjustStock(input: {
  stockUnitId: string
  toStatus: string
  reasonCode: string
  reasonNote?: string
  reconciliationId?: string
}) {
  requirePermission('stock.adjust')
  const { companyId } = requireCompany()
  const session = requireSession()

  const unit = await one<any>('SELECT * FROM stock_units WHERE id = ? AND company_id = ?', [
    input.stockUnitId,
    companyId
  ])
  if (!unit) throw new AppError('Unit not found.', 'NOT_FOUND')
  if (unit.status === 'sold')
    throw new AppError('A sold unit cannot be adjusted. Reverse the sale instead.', 'BAD_STATUS')

  const ts = nowIso()
  await tx(async (t) => {
    await t.run('UPDATE stock_units SET status = ?, updated_at = ? WHERE id = ?', [
      input.toStatus,
      ts,
      input.stockUnitId
    ])
    await t.run(
      `INSERT INTO stock_adjustments (id, company_id, shop_id, stock_unit_id, model_id, qty,
         from_status, to_status, reason_code, reason_note, value_impact, reconciliation_id,
         created_by, created_at)
       VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?)`,
      [
        newId(),
        companyId,
        unit.current_shop_id,
        unit.id,
        unit.model_id,
        unit.status,
        input.toStatus,
        input.reasonCode,
        nullify(input.reasonNote),
        input.toStatus === 'in_stock' ? num(unit.cost_price) : -num(unit.cost_price),
        nullify(input.reconciliationId),
        session.user.id,
        ts
      ]
    )
  })

  await logAudit({
    action: 'stock.adjust',
    entity: 'stock_unit',
    entityId: input.stockUnitId,
    summary: `${unit.status} → ${input.toStatus} (${input.reasonCode})`,
    shopId: unit.current_shop_id
  })
}

export async function listAdjustments(params: { shopId?: string; from?: string; to?: string }) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()
  const where = ['a.company_id = ?']
  const args: any[] = [companyId]
  if (params.shopId) {
    where.push('a.shop_id = ?')
    args.push(params.shopId)
  }
  if (params.from) {
    where.push('date(a.created_at) >= ?')
    args.push(params.from)
  }
  if (params.to) {
    where.push('date(a.created_at) <= ?')
    args.push(params.to)
  }
  return all<any>(
    `SELECT a.*, m.name AS model_name, b.name AS brand_name, su.imei1, u.name AS user_name,
            r.label AS reason_label, sh.name AS shop_name
       FROM stock_adjustments a
       LEFT JOIN models m ON m.id = a.model_id
       LEFT JOIN brands b ON b.id = m.brand_id
       LEFT JOIN stock_units su ON su.id = a.stock_unit_id
       LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN recon_reasons r ON r.code = a.reason_code
       LEFT JOIN shops sh ON sh.id = a.shop_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC LIMIT 300`,
    args
  )
}
