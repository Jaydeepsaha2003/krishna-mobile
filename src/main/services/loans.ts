import { all, one, run, scalar, tx } from '../db'
import {
  AppError,
  addMonths,
  daysBetween,
  newId,
  nextDocumentNumber,
  nowIso,
  nullify,
  num,
  round2,
  today
} from '../utils'
import { SETTING_DEFAULT_PENALTY } from '../../shared/constants'
import { getSetting } from '../utils'
import { requireCompany, requirePermission, requireSession } from './session'
import { logAudit } from './audit'

/* ========================================================================== */
/*  SCHEDULE GENERATION                                                       */
/* ========================================================================== */

export interface ScheduleRow {
  emiNo: number
  dueDate: string
  scheduledEmi: number
}

export interface BuiltSchedule {
  schedule: ScheduleRow[]
  monthlyEmi: number
  /** Sum of every installment — what the customer actually pays in total. */
  totalPayable: number
  emiEndDate: string
}

/**
 * Two distinct modes, because "loan amount" (the bare principal financed) and
 * "total payable" (tenure x EMI) are not always the same number — a shop's
 * EMI rate commonly embeds a financing markup beyond the principal.
 *
 *  - Auto-calculated (no explicit EMI given): divide the principal evenly,
 *    last installment absorbs the rounding remainder, so the schedule sums
 *    exactly to `loanAmount`.
 *  - Explicit EMI given: every installment is that flat amount, including the
 *    last one. Forcing reconciliation against `loanAmount` here is wrong and
 *    was a real bug — whenever `monthlyEmi * tenure > loanAmount` (i.e. the
 *    EMI rate embeds a markup, which is normal/expected) the "reconciled"
 *    last installment went negative.
 */
export function buildEmiSchedule(opts: {
  tenure: number
  loanAmount: number
  emiStartDate: string
  monthlyEmiOverride?: number | null
}): BuiltSchedule {
  const { tenure, loanAmount, emiStartDate } = opts
  const flat = Boolean(opts.monthlyEmiOverride && opts.monthlyEmiOverride > 0)
  const monthlyEmi = flat ? round2(opts.monthlyEmiOverride!) : round2(loanAmount / tenure)

  const schedule: ScheduleRow[] = []
  if (flat) {
    for (let i = 1; i <= tenure; i++) {
      schedule.push({ emiNo: i, dueDate: addMonths(emiStartDate, i - 1), scheduledEmi: monthlyEmi })
    }
  } else {
    let allocated = 0
    for (let i = 1; i <= tenure; i++) {
      const scheduledEmi = i === tenure ? round2(loanAmount - allocated) : monthlyEmi
      allocated = round2(allocated + scheduledEmi)
      schedule.push({ emiNo: i, dueDate: addMonths(emiStartDate, i - 1), scheduledEmi })
    }
  }

  return {
    schedule,
    monthlyEmi,
    totalPayable: round2(schedule.reduce((a, r) => a + r.scheduledEmi, 0)),
    emiEndDate: schedule[schedule.length - 1].dueDate
  }
}

/* ========================================================================== */
/*  CREATE LOAN — origination + full repayment schedule                      */
/* ========================================================================== */

export interface LoanInput {
  shopId: string
  customerId: string
  stockUnitId?: string
  brand?: string
  category?: string
  modelName?: string
  imei?: string
  loanDate?: string
  purchaseAmount: number
  saleAmount: number
  downPayment?: number
  processingFee?: number
  tenureMonths: number
  monthlyEmi?: number
  emiStartDate?: string
  notes?: string
}

export async function createLoan(input: LoanInput) {
  requirePermission('loan.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  if (!input.customerId) throw new AppError('Choose the customer taking this loan.', 'VALIDATION')
  const tenure = Math.floor(num(input.tenureMonths))
  if (tenure < 1 || tenure > 60)
    throw new AppError('Loan tenure must be between 1 and 60 months.', 'VALIDATION')

  const saleAmount = round2(num(input.saleAmount))
  if (saleAmount <= 0) throw new AppError('Enter the sale amount charged to the customer.', 'VALIDATION')

  const downPayment = round2(num(input.downPayment))
  if (downPayment < 0) throw new AppError('Down payment cannot be negative.', 'VALIDATION')
  if (downPayment >= saleAmount)
    throw new AppError('Down payment must be less than the sale amount — otherwise there is nothing to finance.', 'VALIDATION')

  const purchaseAmount = round2(num(input.purchaseAmount))
  if (purchaseAmount <= 0)
    throw new AppError('Enter the shop’s purchase cost for this item — it drives margin reporting.', 'VALIDATION')

  const processingFee = round2(num(input.processingFee))
  const loanAmount = round2(saleAmount - downPayment)
  const loanDate = input.loanDate || today()
  const emiStartDate = input.emiStartDate || loanDate

  let stockUnit: any = null
  if (input.stockUnitId) {
    stockUnit = await one<any>(
      `SELECT su.*, m.name AS model_name, b.name AS brand_name, m.category
         FROM stock_units su JOIN models m ON m.id = su.model_id JOIN brands b ON b.id = m.brand_id
        WHERE su.id = ? AND su.company_id = ?`,
      [input.stockUnitId, companyId]
    )
    if (!stockUnit) throw new AppError('The selected handset could not be found.', 'VALIDATION')
    if (stockUnit.status !== 'in_stock')
      throw new AppError(
        `${stockUnit.brand_name} ${stockUnit.model_name} is "${stockUnit.status}" and cannot be financed.`,
        'BAD_STATUS'
      )
    if (stockUnit.current_shop_id !== input.shopId)
      throw new AppError('That handset is not in stock at the selected shop.', 'BAD_SHOP')
  } else if (!input.brand?.trim() || !input.modelName?.trim()) {
    // Not linked to a tracked unit — this is a direct sale outside the purchase
    // system, so at minimum the product needs a name to be a meaningful record.
    throw new AppError('Enter the brand and model being financed (or pick a handset from stock).', 'VALIDATION')
  }

  if (input.monthlyEmi !== undefined && input.monthlyEmi !== null && num(input.monthlyEmi) <= 0)
    throw new AppError('Monthly EMI must be greater than zero.', 'VALIDATION')

  const { schedule, monthlyEmi: baseEmi, totalPayable, emiEndDate } = buildEmiSchedule({
    tenure,
    loanAmount,
    emiStartDate,
    monthlyEmiOverride: input.monthlyEmi
  })
  const totalMargin = round2(saleAmount - purchaseAmount)

  const loanId = newId()
  const ts = nowIso()
  const loanNo = await nextDocumentNumber({
    companyId,
    shopId: input.shopId,
    kind: 'loan',
    date: loanDate,
    prefix: 'LN'
  })

  await tx(async (t) => {
    await t.run(
      `INSERT INTO loans (id, company_id, shop_id, loan_no, customer_id, stock_unit_id, brand,
         category, model_name, imei, loan_date, purchase_amount, sale_amount, down_payment,
         loan_amount, processing_fee, total_margin, loan_tenure_months, monthly_emi, emi_start_date,
         emi_end_date, status, current_outstanding, total_payable, penalty_collected, notes,
         created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,0,?,?,?,?)`,
      [
        loanId,
        companyId,
        input.shopId,
        loanNo,
        input.customerId,
        nullify(input.stockUnitId),
        nullify(input.brand ?? stockUnit?.brand_name),
        nullify(input.category ?? stockUnit?.category),
        nullify(input.modelName ?? stockUnit?.model_name),
        nullify(input.imei ?? stockUnit?.imei1),
        loanDate,
        purchaseAmount,
        saleAmount,
        downPayment,
        loanAmount,
        processingFee,
        totalMargin,
        tenure,
        baseEmi,
        emiStartDate,
        emiEndDate,
        totalPayable,
        totalPayable,
        nullify(input.notes),
        session.user.id,
        ts,
        ts
      ]
    )

    for (const row of schedule) {
      await t.run(
        `INSERT INTO loan_repayments (id, loan_id, emi_no, due_date, scheduled_emi, actual_emi_paid,
           penalty_amount, is_penalty_paid, status, updated_at)
         VALUES (?,?,?,?,?,0,0,0,'PENDING',?)`,
        [newId(), loanId, row.emiNo, row.dueDate, row.scheduledEmi, ts]
      )
    }

    if (stockUnit) {
      await t.run(
        `UPDATE stock_units SET status = 'sold', sale_id = NULL, sale_price = ?, sold_at = ?,
                updated_at = ? WHERE id = ?`,
        [saleAmount, loanDate, ts, stockUnit.id]
      )
    }
  })

  await logAudit({
    action: 'loan.create',
    entity: 'loan',
    entityId: loanId,
    summary: `${loanNo} — ${tenure} months × ₹${baseEmi}, financed ₹${loanAmount}${
      totalPayable !== loanAmount ? ` (₹${totalPayable} total payable)` : ''
    }`,
    shopId: input.shopId
  })

  return { id: loanId, loanNo, loanAmount, totalPayable, monthlyEmi: baseEmi, emiEndDate }
}

/* ========================================================================== */
/*  READ                                                                      */
/* ========================================================================== */

export interface LoanFilter {
  shopId?: string
  customerId?: string
  status?: string
  search?: string
  onlyOverdue?: boolean
  from?: string
  to?: string
  limit?: number
  offset?: number
}

function shapeLoan(r: any) {
  return {
    id: r.id,
    loanNo: r.loan_no,
    shopId: r.shop_id,
    shopName: r.shop_name,
    shopCode: r.shop_code,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    brand: r.brand,
    category: r.category,
    modelName: r.model_name,
    imei: r.imei,
    loanDate: r.loan_date,
    purchaseAmount: r.purchase_amount,
    saleAmount: r.sale_amount,
    downPayment: r.down_payment,
    loanAmount: r.loan_amount,
    totalPayable: r.total_payable,
    processingFee: r.processing_fee,
    totalMargin: r.total_margin,
    tenureMonths: r.loan_tenure_months,
    monthlyEmi: r.monthly_emi,
    emiStartDate: r.emi_start_date,
    emiEndDate: r.emi_end_date,
    status: r.status,
    currentOutstanding: r.current_outstanding,
    penaltyCollected: r.penalty_collected,
    lastEmiPaidDate: r.last_emi_paid_date,
    closedDate: r.closed_date,
    notes: r.notes,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    overdueCount: r.overdue_count ?? 0,
    overdueAmount: round2(num(r.overdue_amount))
  }
}

const LOAN_SELECT = `
  SELECT l.*, sh.name AS shop_name, sh.code AS shop_code, c.name AS customer_name,
         c.phone_primary AS customer_phone, u.name AS created_by_name,
         (SELECT COUNT(*) FROM loan_repayments lr WHERE lr.loan_id = l.id
            AND lr.status IN ('PENDING','PARTIAL') AND lr.due_date < date('now','localtime')) AS overdue_count,
         (SELECT COALESCE(SUM(lr.scheduled_emi - lr.actual_emi_paid), 0) FROM loan_repayments lr
           WHERE lr.loan_id = l.id AND lr.status IN ('PENDING','PARTIAL')
             AND lr.due_date < date('now','localtime')) AS overdue_amount
    FROM loans l
    JOIN shops sh ON sh.id = l.shop_id
    JOIN customers c ON c.id = l.customer_id
    LEFT JOIN users u ON u.id = l.created_by`

export async function listLoans(f: LoanFilter) {
  requirePermission('loan.view')
  const { companyId } = requireCompany()
  const where = ['l.company_id = ?']
  const args: any[] = [companyId]

  if (f.shopId) {
    where.push('l.shop_id = ?')
    args.push(f.shopId)
  }
  if (f.customerId) {
    where.push('l.customer_id = ?')
    args.push(f.customerId)
  }
  if (f.status && f.status !== 'all') {
    where.push('l.status = ?')
    args.push(f.status)
  }
  if (f.from) {
    where.push('l.loan_date >= ?')
    args.push(f.from)
  }
  if (f.to) {
    where.push('l.loan_date <= ?')
    args.push(f.to)
  }
  if (f.search) {
    const q = `%${f.search.trim()}%`
    where.push(
      `(l.loan_no LIKE ? OR c.name LIKE ? OR c.phone_primary LIKE ? OR l.imei LIKE ?
        OR l.brand LIKE ? OR l.model_name LIKE ?)`
    )
    args.push(q, q, q, q, q, q)
  }

  const clause = `WHERE ${where.join(' AND ')}`
  let rows = await all<any>(
    `${LOAN_SELECT} ${clause} ORDER BY l.loan_date DESC, l.created_at DESC LIMIT ? OFFSET ?`,
    [...args, f.limit ?? 300, f.offset ?? 0]
  )
  if (f.onlyOverdue) rows = rows.filter((r) => num(r.overdue_count) > 0)

  const summary = await one<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(l.loan_amount),0) AS financed,
            COALESCE(SUM(l.current_outstanding),0) AS outstanding,
            COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' THEN 1 ELSE 0 END),0) AS active,
            COALESCE(SUM(CASE WHEN l.status = 'CLOSED' THEN 1 ELSE 0 END),0) AS closed
       FROM loans l ${clause}`,
    args
  )

  return {
    rows: rows.map(shapeLoan),
    summary: {
      count: summary?.n ?? 0,
      financed: summary?.financed ?? 0,
      outstanding: summary?.outstanding ?? 0,
      active: summary?.active ?? 0,
      closed: summary?.closed ?? 0
    }
  }
}

export async function getLoan(id: string) {
  requirePermission('loan.view')
  const loan = await one<any>(`${LOAN_SELECT} WHERE l.id = ?`, [id])
  if (!loan) throw new AppError('Loan not found.', 'NOT_FOUND')

  const schedule = await all<any>(
    `SELECT * FROM loan_repayments WHERE loan_id = ? ORDER BY emi_no`,
    [id]
  )
  const defaultPenalty = await getSetting<number>(SETTING_DEFAULT_PENALTY, 500)

  return {
    loan: shapeLoan(loan),
    schedule: schedule.map((r) => ({
      id: r.id,
      emiNo: r.emi_no,
      dueDate: r.due_date,
      scheduledEmi: r.scheduled_emi,
      repayDate: r.repay_date,
      actualEmiPaid: r.actual_emi_paid,
      balance: round2(num(r.scheduled_emi) - num(r.actual_emi_paid)),
      penaltyAmount: r.penalty_amount,
      isPenaltyPaid: !!r.is_penalty_paid,
      paymentMode: r.payment_mode,
      remarks: r.remarks,
      status: r.status,
      overdueDays:
        r.status !== 'PAID' && r.due_date < today() ? daysBetween(r.due_date, today()) : 0
    })),
    defaultPenalty
  }
}

/** Loans + a quick label, for the searchable picker on the repayment screen. */
export async function searchLoans(search: string, onlyActive = true) {
  requirePermission('loan.view')
  const { companyId } = requireCompany()
  const where = ['l.company_id = ?']
  const args: any[] = [companyId]
  if (onlyActive) where.push("l.status = 'ACTIVE'")
  if (search?.trim()) {
    const q = `%${search.trim()}%`
    where.push(
      `(l.loan_no LIKE ? OR c.name LIKE ? OR c.phone_primary LIKE ? OR l.imei LIKE ? OR l.model_name LIKE ?)`
    )
    args.push(q, q, q, q, q)
  }
  return all<any>(
    `${LOAN_SELECT} WHERE ${where.join(' AND ')} ORDER BY l.loan_date DESC LIMIT 40`,
    args
  ).then((rows) => rows.map(shapeLoan))
}

/* ========================================================================== */
/*  REPAYMENT                                                                 */
/* ========================================================================== */

export interface RepaymentInput {
  loanId: string
  repaymentId?: string // specific installment; auto-picks the next unpaid one if omitted
  repayDate?: string
  actualEmiPaid: number
  penaltyAmount?: number
  isPenaltyPaid?: boolean
  paymentMode?: string
  remarks?: string
}

export async function recordRepayment(input: RepaymentInput) {
  requirePermission('loan.repayment')
  const { companyId } = requireCompany()
  const session = requireSession()

  const loan = await one<any>('SELECT * FROM loans WHERE id = ? AND company_id = ?', [
    input.loanId,
    companyId
  ])
  if (!loan) throw new AppError('Loan not found.', 'NOT_FOUND')
  if (loan.status !== 'ACTIVE')
    throw new AppError(`This loan is ${loan.status.toLowerCase()} — no further EMI is due.`, 'BAD_STATUS')

  const paid = round2(num(input.actualEmiPaid))
  if (paid <= 0) throw new AppError('Enter an amount greater than zero.', 'VALIDATION')

  const row = input.repaymentId
    ? await one<any>('SELECT * FROM loan_repayments WHERE id = ? AND loan_id = ?', [
        input.repaymentId,
        input.loanId
      ])
    : await one<any>(
        `SELECT * FROM loan_repayments WHERE loan_id = ? AND status IN ('PENDING','PARTIAL')
           ORDER BY emi_no LIMIT 1`,
        [input.loanId]
      )
  if (!row) throw new AppError('Every installment on this loan is already paid.', 'NOT_FOUND')

  const balance = round2(num(row.scheduled_emi) - num(row.actual_emi_paid))
  if (paid > balance + 0.5)
    throw new AppError(
      `Only ₹${balance} is due on installment #${row.emi_no}. Use foreclosure to settle the full loan early.`,
      'OVERPAY'
    )

  const repayDate = input.repayDate || today()
  const penalty = round2(num(input.penaltyAmount))
  const newPaid = round2(num(row.actual_emi_paid) + paid)
  const newStatus = newPaid >= num(row.scheduled_emi) - 0.5 ? 'PAID' : 'PARTIAL'
  const ts = nowIso()

  await tx(async (t) => {
    await t.run(
      `UPDATE loan_repayments SET actual_emi_paid = ?, repay_date = ?, penalty_amount = ?,
              is_penalty_paid = ?, payment_mode = ?, remarks = ?, status = ?, created_by = ?,
              updated_at = ? WHERE id = ?`,
      [
        newPaid,
        repayDate,
        penalty,
        input.isPenaltyPaid ? 1 : 0,
        nullify(input.paymentMode),
        nullify(input.remarks),
        newStatus,
        session.user.id,
        ts,
        row.id
      ]
    )

    const totals = await t.one<any>(
      `SELECT COALESCE(SUM(actual_emi_paid),0) AS paid,
              COALESCE(SUM(CASE WHEN is_penalty_paid = 1 THEN penalty_amount ELSE 0 END),0) AS penalty
         FROM loan_repayments WHERE loan_id = ?`,
      [input.loanId]
    )
    const outstanding = round2(num(loan.total_payable) - num(totals?.paid))
    const closed = outstanding <= 0.5

    await t.run(
      `UPDATE loans SET current_outstanding = ?, penalty_collected = ?, last_emi_paid_date = ?,
              status = ?, closed_date = ?, updated_at = ? WHERE id = ?`,
      [
        Math.max(0, outstanding),
        round2(num(totals?.penalty)),
        repayDate,
        closed ? 'CLOSED' : 'ACTIVE',
        closed ? repayDate : null,
        ts,
        input.loanId
      ]
    )
  })

  await logAudit({
    action: 'loan.repayment',
    entity: 'loan',
    entityId: input.loanId,
    summary: `EMI #${row.emi_no} of ${loan.loan_no} — received ₹${paid}${
      penalty > 0 ? ` + ₹${penalty} penalty` : ''
    }`,
    shopId: loan.shop_id
  })

  return { emiNo: row.emi_no, status: newStatus, paidNow: paid }
}

/** Settles every remaining installment in one shot and closes the loan early. */
export async function forecloseLoan(input: {
  loanId: string
  settlementAmount: number
  repayDate?: string
  paymentMode?: string
  remarks?: string
}) {
  requirePermission('loan.foreclose')
  const { companyId } = requireCompany()
  const session = requireSession()

  const loan = await one<any>('SELECT * FROM loans WHERE id = ? AND company_id = ?', [
    input.loanId,
    companyId
  ])
  if (!loan) throw new AppError('Loan not found.', 'NOT_FOUND')
  if (loan.status !== 'ACTIVE') throw new AppError('This loan is not active.', 'BAD_STATUS')

  const settlement = round2(num(input.settlementAmount))
  if (settlement <= 0) throw new AppError('Enter the settlement amount received.', 'VALIDATION')

  const repayDate = input.repayDate || today()
  const ts = nowIso()

  await tx(async (t) => {
    const pending = await t.all<any>(
      `SELECT * FROM loan_repayments WHERE loan_id = ? AND status IN ('PENDING','PARTIAL') ORDER BY emi_no`,
      [input.loanId]
    )

    // Apply the settlement across the remaining installments in order so each
    // row's own balance stays meaningful in the schedule view.
    let remaining = settlement
    for (const row of pending) {
      const due = round2(num(row.scheduled_emi) - num(row.actual_emi_paid))
      const apply = Math.max(0, Math.min(remaining, due))
      remaining = round2(remaining - apply)
      await t.run(
        `UPDATE loan_repayments SET actual_emi_paid = actual_emi_paid + ?, repay_date = ?,
                payment_mode = ?, remarks = ?, status = 'FORECLOSED', created_by = ?, updated_at = ?
          WHERE id = ?`,
        [apply, repayDate, nullify(input.paymentMode), nullify(input.remarks), session.user.id, ts, row.id]
      )
    }

    await t.run(
      `UPDATE loans SET status = 'FORECLOSED', current_outstanding = 0, last_emi_paid_date = ?,
              closed_date = ?, notes = COALESCE(notes,'') || ?, updated_at = ? WHERE id = ?`,
      [
        repayDate,
        repayDate,
        `\nForeclosed ${repayDate}: settled for ₹${settlement}${input.remarks ? ` — ${input.remarks}` : ''}`,
        ts,
        input.loanId
      ]
    )
  })

  await logAudit({
    action: 'loan.foreclose',
    entity: 'loan',
    entityId: input.loanId,
    summary: `${loan.loan_no} foreclosed for ₹${settlement}`,
    shopId: loan.shop_id
  })
}

export async function cancelLoan(loanId: string, reason: string) {
  requirePermission('loan.foreclose')
  const { companyId } = requireCompany()
  const loan = await one<any>('SELECT * FROM loans WHERE id = ? AND company_id = ?', [
    loanId,
    companyId
  ])
  if (!loan) throw new AppError('Loan not found.', 'NOT_FOUND')
  const paid =
    (await scalar<number>(
      `SELECT COALESCE(SUM(actual_emi_paid),0) FROM loan_repayments WHERE loan_id = ?`,
      [loanId]
    )) ?? 0
  if (paid > 0.5)
    throw new AppError('This loan already has payments recorded — foreclose it instead of cancelling.', 'HAS_PAYMENTS')
  if (!reason?.trim()) throw new AppError('A reason is required to cancel a loan.', 'VALIDATION')

  const ts = nowIso()
  await tx(async (t) => {
    if (loan.stock_unit_id) {
      await t.run(
        `UPDATE stock_units SET status = 'in_stock', sold_at = NULL, updated_at = ? WHERE id = ?`,
        [ts, loan.stock_unit_id]
      )
    }
    await t.run(
      `UPDATE loans SET status = 'CANCELLED', current_outstanding = 0,
              notes = COALESCE(notes,'') || ?, updated_at = ? WHERE id = ?`,
      [`\nCancelled: ${reason.trim()}`, ts, loanId]
    )
  })
  await logAudit({ action: 'loan.cancel', entity: 'loan', entityId: loanId, summary: reason })
}

/* ========================================================================== */
/*  ANALYSIS — the KPI dashboard                                             */
/* ========================================================================== */

export async function loanAnalysis(params: { shopId?: string; from: string; to: string }) {
  requirePermission('loan.view')
  const { companyId } = requireCompany()
  const shopFilter = params.shopId ? 'AND l.shop_id = :shop' : ''
  const args = { company: companyId, shop: params.shopId ?? '', from: params.from, to: params.to }

  const opened = await one<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(l.sale_amount),0) AS sales,
            COALESCE(SUM(l.purchase_amount),0) AS purchase,
            COALESCE(SUM(l.total_margin),0) AS margin,
            COALESCE(SUM(l.processing_fee),0) AS proc_fee,
            COUNT(DISTINCT l.customer_id) AS customers
       FROM loans l WHERE l.company_id = :company AND l.loan_date BETWEEN :from AND :to ${shopFilter}`,
    args
  )

  const collected = await one<any>(
    `SELECT COALESCE(SUM(lr.actual_emi_paid),0) AS emi,
            COALESCE(SUM(CASE WHEN lr.is_penalty_paid = 1 THEN lr.penalty_amount ELSE 0 END),0) AS penalty
       FROM loan_repayments lr JOIN loans l ON l.id = lr.loan_id
      WHERE l.company_id = :company AND lr.repay_date BETWEEN :from AND :to ${shopFilter}`,
    args
  )

  const overdue = await one<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(lr.scheduled_emi - lr.actual_emi_paid),0) AS amt
       FROM loan_repayments lr JOIN loans l ON l.id = lr.loan_id
      WHERE l.company_id = :company AND l.status = 'ACTIVE' ${shopFilter}
        AND lr.status IN ('PENDING','PARTIAL') AND lr.due_date < date('now','localtime')`,
    args
  )

  const status = await one<any>(
    `SELECT
        COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' THEN 1 ELSE 0 END),0) AS active,
        COALESCE(SUM(CASE WHEN l.status = 'ACTIVE' THEN l.current_outstanding ELSE 0 END),0) AS outstanding,
        COALESCE(SUM(CASE WHEN l.status IN ('CLOSED','FORECLOSED')
                            AND l.closed_date BETWEEN :from AND :to THEN 1 ELSE 0 END),0) AS closed
       FROM loans l WHERE l.company_id = :company ${shopFilter}`,
    args
  )

  const maxEndDate = await scalar<string>(
    `SELECT MAX(l.emi_end_date) FROM loans l WHERE l.company_id = :company AND l.status = 'ACTIVE' ${shopFilter}`,
    args
  )
  const recoveryMonths = maxEndDate
    ? Math.max(0, Math.round(daysBetween(today(), maxEndDate) / 30))
    : 0

  const defaultPenalty = await getSetting<number>(SETTING_DEFAULT_PENALTY, 500)

  return {
    range: { from: params.from, to: params.to },
    totalSales: round2(num(opened?.sales)),
    totalPurchase: round2(num(opened?.purchase)),
    totalMargin: round2(num(opened?.margin)),
    processingFee: round2(num(opened?.proc_fee)),
    netIncome: round2(num(opened?.margin) + num(opened?.proc_fee)),
    emiCollected: round2(num(collected?.emi)),
    penaltyCollected: round2(num(collected?.penalty)),
    netEmiCollection: round2(num(collected?.emi) - num(collected?.penalty)),
    outstanding: round2(num(status?.outstanding)),
    overdueCount: num(overdue?.n),
    overdueAmount: round2(num(overdue?.amt)),
    penaltyOverdueEstimate: round2(num(overdue?.n) * defaultPenalty),
    totalLoans: num(opened?.n),
    activeLoans: num(status?.active),
    closedLoans: num(status?.closed),
    totalCustomers: num(opened?.customers),
    recoveryMonths
  }
}

/** Row-level table backing the analysis grid — one line per loan. */
export async function loanAnalysisGrid(params: { shopId?: string; from: string; to: string; search?: string }) {
  requirePermission('loan.view')
  const { companyId } = requireCompany()
  const where = ['l.company_id = ?', 'l.loan_date BETWEEN ? AND ?']
  const args: any[] = [companyId, params.from, params.to]
  if (params.shopId) {
    where.push('l.shop_id = ?')
    args.push(params.shopId)
  }
  if (params.search?.trim()) {
    const q = `%${params.search.trim()}%`
    where.push(
      `(l.brand LIKE ? OR l.category LIKE ? OR l.model_name LIKE ? OR c.name LIKE ? OR c.phone_primary LIKE ?)`
    )
    args.push(q, q, q, q, q)
  }

  const rows = await all<any>(
    `SELECT l.*, c.name AS customer_name, c.phone_primary AS customer_phone, sh.code AS shop_code,
            (SELECT COUNT(*) FROM loan_repayments lr WHERE lr.loan_id = l.id
               AND lr.status IN ('PENDING','PARTIAL') AND lr.due_date < date('now','localtime')) AS overdue_count,
            (SELECT COALESCE(SUM(lr.penalty_amount),0) FROM loan_repayments lr
              WHERE lr.loan_id = l.id AND lr.is_penalty_paid = 0
                AND lr.status IN ('PENDING','PARTIAL') AND lr.due_date < date('now','localtime')) AS penalty_overdue
       FROM loans l JOIN customers c ON c.id = l.customer_id JOIN shops sh ON sh.id = l.shop_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.loan_date DESC`,
    args
  )

  return rows.map((r) => ({
    id: r.id,
    loanNo: r.loan_no,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    shopCode: r.shop_code,
    brand: r.brand,
    category: r.category,
    modelName: r.model_name,
    loanAmount: r.loan_amount,
    outstanding: r.current_outstanding,
    purchaseAmount: r.purchase_amount,
    saleAmount: r.sale_amount,
    margin: r.total_margin,
    processingFee: r.processing_fee,
    netIncome: round2(num(r.total_margin) + num(r.processing_fee)),
    overdueCount: num(r.overdue_count),
    penaltyOverdue: round2(num(r.penalty_overdue)),
    status: r.status,
    lastEmiPaidDate: r.last_emi_paid_date,
    loanDate: r.loan_date
  }))
}
