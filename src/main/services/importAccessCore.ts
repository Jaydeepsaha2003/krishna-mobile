/**
 * Pure planning logic for the MS Access importer — NO Electron, NO database, NO
 * side effects. Kept dependency-free (only `mdb-reader`, `node:fs` and the
 * shared validators) so the exact same code can be exercised by a standalone
 * dry-run script before anything is written. See importAccess.ts for the
 * DB-backed wrappers and the full rationale for the mapping decisions.
 */
import MDBReader from 'mdb-reader'
import { readFileSync } from 'node:fs'
import { isValidAadhaar, normalizeAadhaar, normalizePhone } from '../../shared/validators'

/* -------------------------------------------------------------------------- */
/*  Access column names                                                        */
/* -------------------------------------------------------------------------- */

export const T_CUSTOMER = 'CUSTOMER TBL'
export const T_LOAN = 'LOAN TBL'
export const T_REPAYMENT = 'LOAN REPAYMENT'

type AccessRow = Record<string, unknown>

/* -------------------------------------------------------------------------- */
/*  Pure numeric / date helpers (self-contained, matching src/main/utils)      */
/* -------------------------------------------------------------------------- */

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Access datetime -> plain yyyy-MM-dd, read in UTC (values are stored at UTC midnight). */
export function accessDay(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function text(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

/** Adds calendar months to a yyyy-MM-dd date, clamping the day. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`
}

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImportWarning {
  level: 'info' | 'warning'
  code: string
  ref?: string
  message: string
}

export interface PlannedRepayment {
  emiNo: number
  dueDate: string
  scheduledEmi: number
  actualEmiPaid: number
  repayDate: string | null
  penaltyAmount: number
  isPenaltyPaid: number
  paymentMode: string | null
  status: string
}

export interface PlannedCustomer {
  oldId: number
  action: 'insert' | 'match'
  newId: string
  name: string
  phone: string
  phoneSecondary: string | null
  aadhaar: string | null
  pan: string | null
  address: string | null
}

export interface PlannedLoan {
  loanNo: string
  oldCusId: number
  customerId: string
  loanDate: string
  brand: string | null
  category: string | null
  modelName: string | null
  imei: string | null
  purchaseAmount: number
  saleAmount: number
  downPayment: number
  loanAmount: number
  processingFee: number
  totalMargin: number
  tenure: number
  monthlyEmi: number
  emiStartDate: string
  emiEndDate: string
  totalPayable: number
  currentOutstanding: number
  penaltyCollected: number
  status: string
  lastEmiPaidDate: string | null
  closedDate: string | null
  notes: string
  schedule: PlannedRepayment[]
}

export interface ImportStats {
  customersInFile: number
  customersToInsert: number
  customersMatchedExisting: number
  loansInFile: number
  loansToInsert: number
  loansSkippedExisting: number
  repaymentsInFile: number
  carryForwardRowsExcluded: number
  active: number
  closed: number
  foreclosed: number
  totalFinanced: number
  totalPayable: number
  totalOutstanding: number
  penaltyCollected: number
  overshootLoans: number
  overshootTotal: number
}

export interface ImportPlan {
  customers: PlannedCustomer[]
  loans: PlannedLoan[]
  warnings: ImportWarning[]
  stats: ImportStats
}

export interface AccessTables {
  customers: AccessRow[]
  loans: AccessRow[]
  repayments: AccessRow[]
}

export interface ExistingState {
  /** normalised phone -> existing customer id */
  phones: Map<string, string>
  /** aadhaar (12 digits) -> existing customer id */
  aadhaars: Map<string, string>
  /** loan numbers already present for this company */
  loanNos: Set<string>
}

/** Error thrown by readAccessFile; re-wrapped as an AppError by the service. */
export class AccessFileError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

/* -------------------------------------------------------------------------- */
/*  Read + validate the file                                                   */
/* -------------------------------------------------------------------------- */

export function readAccessFile(filePath: string): AccessTables {
  let reader: MDBReader
  try {
    reader = new MDBReader(readFileSync(filePath))
  } catch (err: any) {
    throw new AccessFileError(
      `Could not open "${filePath}" as an Access database: ${err?.message ?? err}`,
      'BAD_FILE'
    )
  }

  const names = reader.getTableNames()
  for (const required of [T_CUSTOMER, T_LOAN, T_REPAYMENT]) {
    if (!names.includes(required))
      throw new AccessFileError(
        `This file is missing the "${required}" table — it does not look like the Krishna Mobile Access database.`,
        'BAD_SCHEMA'
      )
  }

  return {
    customers: reader.getTable(T_CUSTOMER).getData() as AccessRow[],
    loans: reader.getTable(T_LOAN).getData() as AccessRow[],
    repayments: reader.getTable(T_REPAYMENT).getData() as AccessRow[]
  }
}

/* -------------------------------------------------------------------------- */
/*  Pure planning — no DB, no writes                                           */
/* -------------------------------------------------------------------------- */

/** ID factory is injected so the pure planner stays free of node:crypto/Electron. */
export function buildImportPlan(
  tables: AccessTables,
  existing: ExistingState,
  makeId: () => string
): ImportPlan {
  const warnings: ImportWarning[] = []

  /* ---- customers ---- */
  const customers: PlannedCustomer[] = []
  const cusIdToNewId = new Map<number, string>()
  const seenPhoneInFile = new Map<string, string>()
  const plannedAadhaars = new Set<string>()

  for (const row of tables.customers) {
    const oldId = num(row['ID'])
    const name = text(row['CUSTOMER NAME']) || 'Unknown'
    const phone = normalizePhone(text(row['MOBILE NO']))
    const phone2raw = normalizePhone(text(row['ALTERNATE MOBILE']))
    const address = text(row['CUSTOMER ADDRESS']) || null

    let aadhaar: string | null = normalizeAadhaar(text(row['AADHAR NUMBER'])) || null
    if (aadhaar) {
      if (!isValidAadhaar(aadhaar)) {
        warnings.push({
          level: 'warning',
          code: 'AADHAAR_INVALID',
          ref: name,
          message: `Aadhaar for "${name}" failed the checksum — imported without it.`
        })
        aadhaar = null
      } else if (existing.aadhaars.has(aadhaar) || plannedAadhaars.has(aadhaar)) {
        warnings.push({
          level: 'warning',
          code: 'AADHAAR_DUPLICATE',
          ref: name,
          message: `Aadhaar for "${name}" is already on another customer — imported without it.`
        })
        aadhaar = null
      }
    }

    const pan = text(row['PAN NO']).toUpperCase() || null

    const existingId = existing.phones.get(phone) ?? seenPhoneInFile.get(phone)
    if (phone && existingId) {
      cusIdToNewId.set(oldId, existingId)
      customers.push({
        oldId,
        action: 'match',
        newId: existingId,
        name,
        phone,
        phoneSecondary: phone2raw && phone2raw !== phone ? phone2raw : null,
        aadhaar,
        pan,
        address
      })
      continue
    }

    const newCustomerId = makeId()
    cusIdToNewId.set(oldId, newCustomerId)
    if (phone) seenPhoneInFile.set(phone, newCustomerId)
    if (aadhaar) plannedAadhaars.add(aadhaar)
    customers.push({
      oldId,
      action: 'insert',
      newId: newCustomerId,
      name,
      phone,
      phoneSecondary: phone2raw && phone2raw !== phone ? phone2raw : null,
      aadhaar,
      pan,
      address
    })
  }

  /* ---- repayments grouped by loan (carry-forward rows dropped) ---- */
  let carryForwardRowsExcluded = 0
  const paymentsByLoan = new Map<
    string,
    Array<{ date: string | null; amount: number; mode: string | null; penalty: number }>
  >()
  for (const row of tables.repayments) {
    const loanNo = text(row['LOAN ID'])
    if (!loanNo) continue
    const modeRaw = text(row['PAY MODE'])
    const mode = modeRaw.toUpperCase()
    if (mode === 'CARRY FORWARD') {
      carryForwardRowsExcluded++
      continue
    }
    const penaltyCharged = num(row['IS PENALTY CHARGED']) !== 0 // Access boolean: -1 = true
    const penalty = penaltyCharged ? round2(num(row['PENALTY AMOUNT'])) : 0
    const entry = {
      date: accessDay(row['REPAY DATE']),
      amount: round2(num(row['ACTUAL EMI PAID'])),
      mode: mode === 'ONLINE' ? 'UPI' : mode === 'CASH' ? 'Cash' : modeRaw || null,
      penalty
    }
    if (!paymentsByLoan.has(loanNo)) paymentsByLoan.set(loanNo, [])
    paymentsByLoan.get(loanNo)!.push(entry)
  }

  /* ---- loans ---- */
  const loans: PlannedLoan[] = []
  const stats: ImportStats = {
    customersInFile: tables.customers.length,
    customersToInsert: customers.filter((c) => c.action === 'insert').length,
    customersMatchedExisting: customers.filter((c) => c.action === 'match').length,
    loansInFile: tables.loans.length,
    loansToInsert: 0,
    loansSkippedExisting: 0,
    repaymentsInFile: tables.repayments.length,
    carryForwardRowsExcluded,
    active: 0,
    closed: 0,
    foreclosed: 0,
    totalFinanced: 0,
    totalPayable: 0,
    totalOutstanding: 0,
    penaltyCollected: 0,
    overshootLoans: 0,
    overshootTotal: 0
  }

  for (const row of tables.loans) {
    const loanNo = text(row['LOAN ID'])
    if (!loanNo) {
      warnings.push({ level: 'warning', code: 'LOAN_NO_BLANK', message: 'A loan row had no LOAN ID and was skipped.' })
      continue
    }
    if (existing.loanNos.has(loanNo)) {
      stats.loansSkippedExisting++
      continue
    }

    const oldCusId = num(row['CUS ID'])
    const customerId = cusIdToNewId.get(oldCusId)
    if (!customerId) {
      warnings.push({
        level: 'warning',
        code: 'LOAN_ORPHAN',
        ref: loanNo,
        message: `Loan ${loanNo} references customer #${oldCusId}, which is not in the file — skipped.`
      })
      continue
    }

    let tenure = Math.floor(num(row['LOAN TENURE']))
    if (tenure < 1) {
      warnings.push({
        level: 'warning',
        code: 'TENURE_FIXED',
        ref: loanNo,
        message: `Loan ${loanNo} had tenure ${text(row['LOAN TENURE']) || '0'} — treated as 1 month.`
      })
      tenure = 1
    }

    const purchaseAmount = round2(num(row['PURCHASE AMOUNT']))
    const saleAmount = round2(num(row['SALE AMOUNT']))
    const downPayment = round2(num(row['DOWN PAYMENT']))
    const loanAmount = round2(num(row['LOAN AMOUNT']))
    const processingFee = round2(num(row['PROCESSING FEE']))
    const totalMargin = round2(saleAmount - purchaseAmount)

    let monthlyEmi = round2(num(row['MONTHLY EMI']))
    if (monthlyEmi <= 0) {
      monthlyEmi = tenure > 0 ? round2(loanAmount / tenure) : 0
      if (monthlyEmi > 0)
        warnings.push({
          level: 'warning',
          code: 'EMI_DERIVED',
          ref: loanNo,
          message: `Loan ${loanNo} had no monthly EMI — derived ₹${monthlyEmi} from principal / tenure.`
        })
    }

    const loanDate = accessDay(row['DATE']) ?? accessDay(row['EMI START DATE']) ?? '1970-01-01'
    const emiStartDate = accessDay(row['EMI START DATE']) ?? loanDate

    const schedule: PlannedRepayment[] = []
    for (let i = 1; i <= tenure; i++) {
      schedule.push({
        emiNo: i,
        dueDate: addMonths(emiStartDate, i - 1),
        scheduledEmi: monthlyEmi,
        actualEmiPaid: 0,
        repayDate: null,
        penaltyAmount: 0,
        isPenaltyPaid: 0,
        paymentMode: null,
        status: 'PENDING'
      })
    }
    const totalPayable = round2(monthlyEmi * tenure)
    const emiEndDate = schedule.length ? schedule[schedule.length - 1].dueDate : emiStartDate

    const payments = (paymentsByLoan.get(loanNo) ?? [])
      .slice()
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    const totalRealPaid = round2(payments.reduce((s, p) => s + p.amount, 0))
    const penaltyCollected = round2(payments.reduce((s, p) => s + p.penalty, 0))

    let idx = 0
    let lastPayDate: string | null = null
    for (const p of payments) {
      if (p.date) lastPayDate = p.date
      if (p.penalty > 0 && schedule.length) {
        const target = schedule[Math.min(idx, schedule.length - 1)]
        target.penaltyAmount = round2(target.penaltyAmount + p.penalty)
        target.isPenaltyPaid = 1
      }
      let remaining = p.amount
      while (remaining > 0.005 && idx < schedule.length) {
        const seg = schedule[idx]
        const capacity = round2(seg.scheduledEmi - seg.actualEmiPaid)
        const apply = Math.min(remaining, Math.max(0, capacity))
        seg.actualEmiPaid = round2(seg.actualEmiPaid + apply)
        seg.repayDate = p.date
        seg.paymentMode = p.mode
        remaining = round2(remaining - apply)
        if (seg.actualEmiPaid >= seg.scheduledEmi - 0.005) {
          seg.status = 'PAID'
          idx++
        } else {
          seg.status = 'PARTIAL'
          break
        }
      }
    }

    const paidToSchedule = round2(schedule.reduce((s, r) => s + r.actualEmiPaid, 0))
    const excess = round2(totalRealPaid - paidToSchedule)
    let outstanding = round2(totalPayable - paidToSchedule)

    const foreclosed = !!text(row['FORECLOSURE'])
    let status: string
    if (foreclosed) {
      status = 'FORECLOSED'
      outstanding = 0
      for (const seg of schedule) if (seg.status !== 'PAID') seg.status = 'FORECLOSED'
    } else if (outstanding <= 0.5) {
      status = 'CLOSED'
      outstanding = 0
    } else {
      status = 'ACTIVE'
    }

    if (excess > 0.5) {
      stats.overshootLoans++
      stats.overshootTotal = round2(stats.overshootTotal + excess)
    }

    let notes = `Imported from Access (${loanNo}).`
    if (excess > 0.5)
      notes += ` Received ₹${totalRealPaid} vs scheduled ₹${totalPayable}; ₹${excess} extra (penalty/rounding) not tied to an installment.`

    const closedDate = status === 'ACTIVE' ? null : lastPayDate ?? loanDate

    loans.push({
      loanNo,
      oldCusId,
      customerId,
      loanDate,
      brand: text(row['BRAND']) || null,
      category: text(row['PRODUCT']) || null,
      modelName: text(row['MODEL']) || null,
      imei: text(row['IMEI NO']) || null,
      purchaseAmount,
      saleAmount,
      downPayment,
      loanAmount,
      processingFee,
      totalMargin,
      tenure,
      monthlyEmi,
      emiStartDate,
      emiEndDate,
      totalPayable,
      currentOutstanding: Math.max(0, outstanding),
      penaltyCollected,
      status,
      lastEmiPaidDate: lastPayDate,
      closedDate,
      notes,
      schedule
    })

    stats.loansToInsert++
    if (status === 'ACTIVE') stats.active++
    else if (status === 'FORECLOSED') stats.foreclosed++
    else stats.closed++
    stats.totalFinanced = round2(stats.totalFinanced + loanAmount)
    stats.totalPayable = round2(stats.totalPayable + totalPayable)
    stats.totalOutstanding = round2(stats.totalOutstanding + Math.max(0, outstanding))
    stats.penaltyCollected = round2(stats.penaltyCollected + penaltyCollected)
  }

  return { customers, loans, warnings, stats }
}

/* -------------------------------------------------------------------------- */
/*  Write-statement builders (pure) — shared by the service and its tests so   */
/*  the exact INSERT column lists can never drift out of sync.                 */
/* -------------------------------------------------------------------------- */

export interface WriteContext {
  companyId: string
  shopId: string
  userId: string | null
  ts: string
}

export interface Stmt {
  sql: string
  args: Array<string | number | null>
}

export function customerInsertStmt(c: PlannedCustomer, ctx: WriteContext): Stmt {
  return {
    sql: `INSERT INTO customers (id, company_id, name, phone_primary, phone_secondary, aadhaar, pan,
        address_line1, customer_type, credit_limit, is_active, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?, 'Retail', 0, 1, ?, ?, ?)`,
    args: [
      c.newId,
      ctx.companyId,
      c.name,
      c.phone,
      c.phoneSecondary,
      c.aadhaar,
      c.pan,
      c.address,
      ctx.userId,
      ctx.ts,
      ctx.ts
    ]
  }
}

export function loanInsertStmt(l: PlannedLoan, loanId: string, ctx: WriteContext): Stmt {
  return {
    sql: `INSERT INTO loans (id, company_id, shop_id, loan_no, customer_id, stock_unit_id, brand,
        category, model_name, imei, loan_date, purchase_amount, sale_amount, down_payment,
        loan_amount, processing_fee, total_margin, loan_tenure_months, monthly_emi, emi_start_date,
        emi_end_date, status, current_outstanding, total_payable, penalty_collected,
        last_emi_paid_date, closed_date, notes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      loanId,
      ctx.companyId,
      ctx.shopId,
      l.loanNo,
      l.customerId,
      l.brand,
      l.category,
      l.modelName,
      l.imei,
      l.loanDate,
      l.purchaseAmount,
      l.saleAmount,
      l.downPayment,
      l.loanAmount,
      l.processingFee,
      l.totalMargin,
      l.tenure,
      l.monthlyEmi,
      l.emiStartDate,
      l.emiEndDate,
      l.status,
      l.currentOutstanding,
      l.totalPayable,
      l.penaltyCollected,
      l.lastEmiPaidDate,
      l.closedDate,
      l.notes,
      ctx.userId,
      ctx.ts,
      ctx.ts
    ]
  }
}

export function repaymentInsertStmt(
  r: PlannedRepayment,
  loanId: string,
  repaymentId: string,
  ctx: WriteContext
): Stmt {
  return {
    sql: `INSERT INTO loan_repayments (id, loan_id, emi_no, due_date, scheduled_emi, repay_date,
        actual_emi_paid, penalty_amount, is_penalty_paid, payment_mode, status, created_by, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      repaymentId,
      loanId,
      r.emiNo,
      r.dueDate,
      r.scheduledEmi,
      r.repayDate,
      r.actualEmiPaid,
      r.penaltyAmount,
      r.isPenaltyPaid,
      r.paymentMode,
      r.status,
      ctx.userId,
      ctx.ts
    ]
  }
}
