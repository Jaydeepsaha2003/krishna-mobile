import { all, one } from '../db'
import { num, round2, today } from '../utils'
import { requireCompany, requirePermission, visibleShopIds } from './session'

function scope(shopId?: string) {
  return { shopFilter: shopId ? 'AND s.shop_id = :shop' : '', shop: shopId ?? '' }
}

/* ========================================================================== */
/*  DASHBOARD                                                                 */
/* ========================================================================== */

export async function dashboard(params: { shopId?: string; from?: string; to?: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const from = params.from ?? today()
  const to = params.to ?? today()
  const { shopFilter } = scope(params.shopId)
  const args = { company: companyId, shop: params.shopId ?? '', from, to }

  const sales = await one<any>(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(s.total),0) AS revenue,
            COALESCE(SUM(s.total_cost),0) AS cost, COALESCE(SUM(s.total_profit),0) AS profit,
            COALESCE(SUM(s.due_amount),0) AS credit_given,
            COALESCE(SUM(s.discount),0) AS discount
       FROM sales s
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to ${shopFilter}`,
    args
  )

  const units = await one<any>(
    `SELECT COALESCE(SUM(si.qty),0) AS units
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to ${shopFilter}`,
    args
  )

  const purchases = await one<any>(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(p.total),0) AS value,
            COALESCE(SUM(p.due_amount),0) AS payable
       FROM purchases p
      WHERE p.company_id = :company AND p.status <> 'cancelled'
        AND p.purchase_date BETWEEN :from AND :to
        ${params.shopId ? 'AND p.shop_id = :shop' : ''}`,
    args
  )

  const stock = await one<any>(
    `SELECT COUNT(*) AS units, COALESCE(SUM(su.cost_price),0) AS value
       FROM stock_units su
      WHERE su.company_id = :company AND su.status = 'in_stock'
        ${params.shopId ? 'AND su.current_shop_id = :shop' : ''}`,
    args
  )

  const credit = await one<any>(
    `SELECT COALESCE(SUM(s.due_amount),0) AS outstanding,
            COUNT(*) AS open_bills,
            COALESCE(SUM(CASE WHEN s.due_date < date('now','localtime') THEN s.due_amount END),0) AS overdue,
            SUM(CASE WHEN s.due_date < date('now','localtime') THEN 1 ELSE 0 END) AS overdue_bills
       FROM sales s
      WHERE s.company_id = :company AND s.status <> 'cancelled' AND s.due_amount > 0.5 ${shopFilter}`,
    args
  )

  const collected = await one<any>(
    `SELECT COALESCE(SUM(p.amount),0) AS amount FROM payments p
      WHERE p.company_id = :company AND p.direction = 'in'
        AND p.payment_date BETWEEN :from AND :to
        ${params.shopId ? 'AND p.shop_id = :shop' : ''}`,
    args
  )

  return {
    range: { from, to },
    sales: {
      bills: num(sales?.bills),
      revenue: round2(num(sales?.revenue)),
      cost: round2(num(sales?.cost)),
      profit: round2(num(sales?.profit)),
      margin: num(sales?.revenue) > 0 ? round2((num(sales?.profit) / num(sales?.revenue)) * 100) : 0,
      discount: round2(num(sales?.discount)),
      units: num(units?.units),
      creditGiven: round2(num(sales?.credit_given)),
      avgBill: num(sales?.bills) > 0 ? round2(num(sales?.revenue) / num(sales?.bills)) : 0
    },
    purchases: {
      bills: num(purchases?.bills),
      value: round2(num(purchases?.value)),
      payable: round2(num(purchases?.payable))
    },
    stock: { units: num(stock?.units), value: round2(num(stock?.value)) },
    credit: {
      outstanding: round2(num(credit?.outstanding)),
      openBills: num(credit?.open_bills),
      overdue: round2(num(credit?.overdue)),
      overdueBills: num(credit?.overdue_bills)
    },
    collected: round2(num(collected?.amount))
  }
}

/** Daily revenue/profit series for the dashboard chart. */
export async function salesTrend(params: { shopId?: string; from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const { shopFilter } = scope(params.shopId)
  const rows = await all<any>(
    `SELECT s.sale_date AS d, COUNT(*) AS bills, COALESCE(SUM(s.total),0) AS revenue,
            COALESCE(SUM(s.total_profit),0) AS profit, COALESCE(SUM(s.due_amount),0) AS credit
       FROM sales s
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to ${shopFilter}
      GROUP BY s.sale_date ORDER BY s.sale_date`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  return rows.map((r) => ({
    date: r.d,
    bills: num(r.bills),
    revenue: round2(num(r.revenue)),
    profit: round2(num(r.profit)),
    credit: round2(num(r.credit))
  }))
}

/* ========================================================================== */
/*  PER-SHOP PROFIT & LOSS                                                    */
/* ========================================================================== */

export async function shopPnl(params: { from: string; to: string }) {
  requirePermission('report.profit')
  const { companyId } = requireCompany()

  const rows = await all<any>(
    `SELECT sh.id, sh.name, sh.code,
            COALESCE(sales.bills, 0)      AS bills,
            COALESCE(sales.revenue, 0)    AS revenue,
            COALESCE(sales.cost, 0)       AS cost,
            COALESCE(sales.profit, 0)     AS gross_profit,
            COALESCE(sales.discount, 0)   AS discount,
            COALESCE(sales.units, 0)      AS units,
            COALESCE(purch.value, 0)      AS purchase_value,
            COALESCE(adj.loss, 0)         AS adjustment_loss,
            COALESCE(tr.margin, 0)        AS transfer_margin,
            COALESCE(stk.value, 0)        AS closing_stock_value,
            COALESCE(stk.units, 0)        AS closing_stock_units,
            COALESCE(cr.outstanding, 0)   AS credit_outstanding
       FROM shops sh
       LEFT JOIN (
         SELECT s.shop_id, COUNT(*) AS bills, SUM(s.total) AS revenue, SUM(s.total_cost) AS cost,
                SUM(s.total_profit) AS profit, SUM(s.discount) AS discount,
                (SELECT COALESCE(SUM(si.qty),0) FROM sale_items si
                  JOIN sales s2 ON s2.id = si.sale_id
                 WHERE s2.shop_id = s.shop_id AND s2.status <> 'cancelled'
                   AND s2.sale_date BETWEEN :from AND :to) AS units
           FROM sales s
          WHERE s.company_id = :company AND s.status <> 'cancelled'
            AND s.sale_date BETWEEN :from AND :to
          GROUP BY s.shop_id
       ) sales ON sales.shop_id = sh.id
       LEFT JOIN (
         SELECT p.shop_id, SUM(p.total) AS value FROM purchases p
          WHERE p.company_id = :company AND p.status <> 'cancelled'
            AND p.purchase_date BETWEEN :from AND :to
          GROUP BY p.shop_id
       ) purch ON purch.shop_id = sh.id
       LEFT JOIN (
         SELECT a.shop_id, SUM(a.value_impact) AS loss FROM stock_adjustments a
          WHERE a.company_id = :company AND date(a.created_at) BETWEEN :from AND :to
          GROUP BY a.shop_id
       ) adj ON adj.shop_id = sh.id
       LEFT JOIN (
         SELECT t.from_shop_id AS shop_id,
                SUM(ti.transfer_price - ti.cost_at_transfer) AS margin
           FROM transfer_items ti JOIN transfers t ON t.id = ti.transfer_id
          WHERE t.company_id = :company AND t.status = 'received'
            AND t.transfer_date BETWEEN :from AND :to
          GROUP BY t.from_shop_id
       ) tr ON tr.shop_id = sh.id
       LEFT JOIN (
         SELECT su.current_shop_id AS shop_id, COUNT(*) AS units, SUM(su.cost_price) AS value
           FROM stock_units su
          WHERE su.company_id = :company AND su.status = 'in_stock'
          GROUP BY su.current_shop_id
       ) stk ON stk.shop_id = sh.id
       LEFT JOIN (
         SELECT s.shop_id, SUM(s.due_amount) AS outstanding FROM sales s
          WHERE s.company_id = :company AND s.status <> 'cancelled' AND s.due_amount > 0.5
          GROUP BY s.shop_id
       ) cr ON cr.shop_id = sh.id
      WHERE sh.company_id = :company AND sh.is_active = 1
      ORDER BY sh.code`,
    { company: companyId, from: params.from, to: params.to }
  )

  return rows.map((r) => {
    const revenue = round2(num(r.revenue))
    const grossProfit = round2(num(r.gross_profit))
    const adjustmentLoss = round2(num(r.adjustment_loss))
    const transferMargin = round2(num(r.transfer_margin))
    const netProfit = round2(grossProfit + transferMargin + adjustmentLoss)
    return {
      shopId: r.id,
      shopName: r.name,
      shopCode: r.code,
      bills: num(r.bills),
      units: num(r.units),
      revenue,
      cost: round2(num(r.cost)),
      grossProfit,
      discount: round2(num(r.discount)),
      purchaseValue: round2(num(r.purchase_value)),
      adjustmentLoss,
      transferMargin,
      netProfit,
      margin: revenue > 0 ? round2((netProfit / revenue) * 100) : 0,
      closingStockValue: round2(num(r.closing_stock_value)),
      closingStockUnits: num(r.closing_stock_units),
      creditOutstanding: round2(num(r.credit_outstanding))
    }
  })
}

/* ========================================================================== */
/*  PER-HANDSET PROFIT                                                        */
/* ========================================================================== */

export async function unitProfit(params: {
  shopId?: string
  from: string
  to: string
  search?: string
  brandId?: string
  limit?: number
}) {
  requirePermission('report.profit')
  const { companyId } = requireCompany()

  const where = [
    's.company_id = :company',
    "s.status <> 'cancelled'",
    's.sale_date BETWEEN :from AND :to'
  ]
  const args: Record<string, any> = {
    company: companyId,
    from: params.from,
    to: params.to,
    limit: params.limit ?? 500
  }
  if (params.shopId) {
    where.push('s.shop_id = :shop')
    args.shop = params.shopId
  }
  if (params.brandId) {
    where.push('m.brand_id = :brand')
    args.brand = params.brandId
  }
  if (params.search) {
    where.push('(si.imei1 LIKE :q OR si.description LIKE :q OR m.sku LIKE :q OR c.name LIKE :q)')
    args.q = `%${params.search}%`
  }

  const rows = await all<any>(
    `SELECT si.id, si.imei1, si.description, si.unit_price, si.discount, si.cost_price, si.profit,
            si.line_total, si.qty, s.invoice_no, s.sale_date, s.id AS sale_id,
            sh.name AS shop_name, sh.code AS shop_code, c.name AS customer_name,
            m.name AS model_name, b.name AS brand_name,
            su.added_at, su.supplier_id, sup.name AS supplier_name,
            CAST(julianday(s.sale_date) - julianday(date(su.added_at)) AS INTEGER) AS days_in_stock
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN shops sh ON sh.id = s.shop_id
       JOIN models m ON m.id = si.model_id
       JOIN brands b ON b.id = m.brand_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN stock_units su ON su.id = si.stock_unit_id
       LEFT JOIN suppliers sup ON sup.id = su.supplier_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.sale_date DESC, s.created_at DESC
      LIMIT :limit`,
    args
  )

  const shaped = rows.map((r) => ({
    id: r.id,
    saleId: r.sale_id,
    invoiceNo: r.invoice_no,
    saleDate: r.sale_date,
    imei1: r.imei1,
    description: r.description,
    modelName: r.model_name,
    brandName: r.brand_name,
    shopName: r.shop_name,
    shopCode: r.shop_code,
    customerName: r.customer_name ?? 'Walk-in',
    supplierName: r.supplier_name,
    qty: num(r.qty),
    unitPrice: round2(num(r.unit_price)),
    discount: round2(num(r.discount)),
    lineTotal: round2(num(r.line_total)),
    costPrice: round2(num(r.cost_price)),
    profit: round2(num(r.profit)),
    margin: num(r.line_total) > 0 ? round2((num(r.profit) / num(r.line_total)) * 100) : 0,
    daysInStock: r.days_in_stock === null ? null : num(r.days_in_stock)
  }))

  const totals = shaped.reduce(
    (a, r) => ({
      revenue: round2(a.revenue + r.lineTotal),
      cost: round2(a.cost + r.costPrice),
      profit: round2(a.profit + r.profit),
      units: a.units + r.qty
    }),
    { revenue: 0, cost: 0, profit: 0, units: 0 }
  )

  return { rows: shaped, totals }
}

/* ========================================================================== */
/*  BREAKDOWNS                                                                */
/* ========================================================================== */

export async function modelPerformance(params: { shopId?: string; from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const rows = await all<any>(
    `SELECT m.id, m.name AS model_name, m.sku, b.name AS brand_name,
            COALESCE(SUM(si.qty),0) AS units,
            COALESCE(SUM(si.line_total),0) AS revenue,
            COALESCE(SUM(si.profit),0) AS profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN models m ON m.id = si.model_id
       JOIN brands b ON b.id = m.brand_id
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to
        ${params.shopId ? 'AND s.shop_id = :shop' : ''}
      GROUP BY m.id ORDER BY revenue DESC LIMIT 50`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  return rows.map((r) => ({
    modelId: r.id,
    modelName: r.model_name,
    brandName: r.brand_name,
    sku: r.sku,
    units: num(r.units),
    revenue: round2(num(r.revenue)),
    profit: round2(num(r.profit)),
    margin: num(r.revenue) > 0 ? round2((num(r.profit) / num(r.revenue)) * 100) : 0
  }))
}

export async function brandShare(params: { shopId?: string; from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const rows = await all<any>(
    `SELECT b.name AS brand_name, COALESCE(SUM(si.qty),0) AS units,
            COALESCE(SUM(si.line_total),0) AS revenue, COALESCE(SUM(si.profit),0) AS profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN models m ON m.id = si.model_id
       JOIN brands b ON b.id = m.brand_id
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to
        ${params.shopId ? 'AND s.shop_id = :shop' : ''}
      GROUP BY b.id ORDER BY revenue DESC`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  return rows.map((r) => ({
    brandName: r.brand_name,
    units: num(r.units),
    revenue: round2(num(r.revenue)),
    profit: round2(num(r.profit))
  }))
}

export async function paymentMix(params: { shopId?: string; from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const rows = await all<any>(
    `SELECT COALESCE(p.mode, 'Not recorded') AS mode, COUNT(*) AS n,
            COALESCE(SUM(p.amount),0) AS amount
       FROM payments p
      WHERE p.company_id = :company AND p.direction = 'in'
        AND p.payment_date BETWEEN :from AND :to
        ${params.shopId ? 'AND p.shop_id = :shop' : ''}
      GROUP BY p.mode ORDER BY amount DESC`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  return rows.map((r) => ({ mode: r.mode, count: num(r.n), amount: round2(num(r.amount)) }))
}

export async function staffPerformance(params: { shopId?: string; from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const rows = await all<any>(
    `SELECT u.id, u.name, COUNT(s.id) AS bills, COALESCE(SUM(s.total),0) AS revenue,
            COALESCE(SUM(s.total_profit),0) AS profit, COALESCE(SUM(s.discount),0) AS discount,
            COALESCE(SUM(s.due_amount),0) AS credit
       FROM sales s JOIN users u ON u.id = s.created_by
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to
        ${params.shopId ? 'AND s.shop_id = :shop' : ''}
      GROUP BY u.id ORDER BY revenue DESC`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  return rows.map((r) => ({
    userId: r.id,
    name: r.name,
    bills: num(r.bills),
    revenue: round2(num(r.revenue)),
    profit: round2(num(r.profit)),
    discount: round2(num(r.discount)),
    credit: round2(num(r.credit))
  }))
}

/** Stock sitting too long — the money stuck on the shelf. */
export async function ageingStock(params: { shopId?: string; minDays?: number }) {
  requirePermission('stock.view')
  const { companyId } = requireCompany()

  // No specific shop asked for — restrict a non-admin's "All shops" view to
  // the shops they're actually assigned to, instead of the whole company.
  let shopRestriction = ''
  let restrictionIds: string[] = []
  if (!params.shopId) {
    const ids = await visibleShopIds()
    if (ids !== null) {
      shopRestriction = ids.length
        ? `AND su.current_shop_id IN (${ids.map(() => '?').join(',')})`
        : 'AND 1 = 0'
      restrictionIds = ids
    }
  }

  const rows = await all<any>(
    `SELECT su.id, su.imei1, su.cost_price, su.added_at, m.name AS model_name,
            b.name AS brand_name, sh.name AS shop_name,
            CAST(julianday('now','localtime') - julianday(date(su.added_at)) AS INTEGER) AS age_days
       FROM stock_units su
       JOIN models m ON m.id = su.model_id
       JOIN brands b ON b.id = m.brand_id
       LEFT JOIN shops sh ON sh.id = su.current_shop_id
      WHERE su.company_id = ? AND su.status = 'in_stock'
        ${params.shopId ? 'AND su.current_shop_id = ?' : shopRestriction}
      ORDER BY su.added_at LIMIT 300`,
    [companyId, ...(params.shopId ? [params.shopId] : restrictionIds)]
  )
  const min = params.minDays ?? 0
  return rows
    .map((r) => ({
      id: r.id,
      imei1: r.imei1,
      label: `${r.brand_name} ${r.model_name}`,
      shopName: r.shop_name,
      costPrice: round2(num(r.cost_price)),
      addedAt: r.added_at,
      ageDays: num(r.age_days)
    }))
    .filter((r) => r.ageDays >= min)
}

/** GST summary for the accountant. */
export async function gstSummary(params: { shopId?: string; from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const output = await all<any>(
    `SELECT si.gst_rate AS rate, COALESCE(SUM(si.line_total - si.tax_amount),0) AS taxable,
            COALESCE(SUM(si.tax_amount),0) AS tax, COUNT(*) AS lines
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.company_id = :company AND s.status <> 'cancelled'
        AND s.sale_date BETWEEN :from AND :to
        ${params.shopId ? 'AND s.shop_id = :shop' : ''}
      GROUP BY si.gst_rate ORDER BY si.gst_rate`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  const input = await all<any>(
    `SELECT pi.gst_rate AS rate, COALESCE(SUM(pi.line_total - pi.tax_amount),0) AS taxable,
            COALESCE(SUM(pi.tax_amount),0) AS tax, COUNT(*) AS lines
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
      WHERE p.company_id = :company AND p.status <> 'cancelled'
        AND p.purchase_date BETWEEN :from AND :to
        ${params.shopId ? 'AND p.shop_id = :shop' : ''}
      GROUP BY pi.gst_rate ORDER BY pi.gst_rate`,
    { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }
  )
  const shape = (rows: any[]) =>
    rows.map((r) => ({
      rate: num(r.rate),
      taxable: round2(num(r.taxable)),
      tax: round2(num(r.tax)),
      cgst: round2(num(r.tax) / 2),
      sgst: round2(num(r.tax) / 2),
      lines: num(r.lines)
    }))
  const out = shape(output)
  const inp = shape(input)
  return {
    output: out,
    input: inp,
    netPayable: round2(
      out.reduce((a, r) => a + r.tax, 0) - inp.reduce((a, r) => a + r.tax, 0)
    )
  }
}

/** Company-wide comparison across all shops for the chosen period. */
export async function companyOverview(params: { from: string; to: string }) {
  requirePermission('report.view')
  const { companyId } = requireCompany()
  const totals = await one<any>(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS revenue,
            COALESCE(SUM(total_profit),0) AS profit, COALESCE(SUM(due_amount),0) AS credit
       FROM sales WHERE company_id = :company AND status <> 'cancelled'
        AND sale_date BETWEEN :from AND :to`,
    { company: companyId, from: params.from, to: params.to }
  )
  return {
    bills: num(totals?.bills),
    revenue: round2(num(totals?.revenue)),
    profit: round2(num(totals?.profit)),
    credit: round2(num(totals?.credit))
  }
}
