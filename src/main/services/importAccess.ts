/**
 * MS Access importer — DB-backed wrappers around the pure planner in
 * ./importAccessCore. See that module's header for the full mapping rationale
 * (why PRODUCT TBL is skipped, why payment history is rebuilt via FIFO, and why
 * CARRY FORWARD rows are excluded).
 *
 * The import is strictly ADDITIVE: it never edits or deletes existing rows. A
 * customer whose mobile already exists is reused, and a loan whose number was
 * already imported is skipped, so it is safe to run more than once.
 */
import { all, batch } from '../db'
import { AppError, newId, nowIso, round2 } from '../utils'
import { normalizeAadhaar, normalizePhone } from '../../shared/validators'
import { requireCompany, requirePermission, requireSession } from './session'
import { logAudit } from './audit'
import {
  AccessFileError,
  buildImportPlan,
  customerInsertStmt,
  loanInsertStmt,
  readAccessFile,
  repaymentInsertStmt,
  type ExistingState,
  type ImportStats,
  type ImportWarning,
  type WriteContext
} from './importAccessCore'

export type { ImportStats, ImportWarning } from './importAccessCore'

export interface ImportPreview {
  fileName: string
  stats: ImportStats
  warnings: ImportWarning[]
  sampleLoans: Array<{
    loanNo: string
    customerName: string
    product: string
    tenure: number
    monthlyEmi: number
    totalPayable: number
    paid: number
    outstanding: number
    status: string
  }>
}

export interface ImportResult extends ImportStats {
  fileName: string
  shopId: string
  warnings: ImportWarning[]
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Re-open the file, converting the core's typed error into an AppError. */
function openFile(filePath: string) {
  try {
    return readAccessFile(filePath)
  } catch (err) {
    if (err instanceof AccessFileError) throw new AppError(err.message, err.code)
    throw err
  }
}

async function loadExistingState(companyId: string): Promise<ExistingState> {
  const custRows = await all<{ id: string; phone_primary: string; aadhaar: string | null }>(
    'SELECT id, phone_primary, aadhaar FROM customers WHERE company_id = ?',
    [companyId]
  )
  const phones = new Map<string, string>()
  const aadhaars = new Map<string, string>()
  for (const r of custRows) {
    if (r.phone_primary) phones.set(normalizePhone(r.phone_primary), r.id)
    if (r.aadhaar) aadhaars.set(normalizeAadhaar(r.aadhaar), r.id)
  }
  const loanRows = await all<{ loan_no: string }>('SELECT loan_no FROM loans WHERE company_id = ?', [
    companyId
  ])
  return { phones, aadhaars, loanNos: new Set(loanRows.map((r) => r.loan_no)) }
}

function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

/* -------------------------------------------------------------------------- */
/*  Preview — read-only                                                        */
/* -------------------------------------------------------------------------- */

export async function previewAccessImport(input: { filePath: string }): Promise<ImportPreview> {
  requirePermission('settings.manage')
  const { companyId } = requireCompany()

  const tables = openFile(input.filePath)
  const existing = await loadExistingState(companyId)
  const plan = buildImportPlan(tables, existing, newId)

  const custById = new Map(plan.customers.map((c) => [c.newId, c.name]))
  const sampleLoans = plan.loans.slice(0, 12).map((l) => ({
    loanNo: l.loanNo,
    customerName: custById.get(l.customerId) ?? '—',
    product: [l.brand, l.modelName].filter(Boolean).join(' ') || '—',
    tenure: l.tenure,
    monthlyEmi: l.monthlyEmi,
    totalPayable: l.totalPayable,
    paid: round2(l.totalPayable - l.currentOutstanding),
    outstanding: l.currentOutstanding,
    status: l.status
  }))

  return { fileName: fileNameOf(input.filePath), stats: plan.stats, warnings: plan.warnings, sampleLoans }
}

/* -------------------------------------------------------------------------- */
/*  Commit — additive writes in a single transaction                          */
/* -------------------------------------------------------------------------- */

export async function runAccessImport(input: { filePath: string; shopId?: string }): Promise<ImportResult> {
  requirePermission('settings.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  // The old system was single-shop; the new one is not, so every imported loan
  // needs a home shop.
  let shopId = input.shopId
  if (!shopId) {
    const shop = await all<{ id: string }>(
      'SELECT id FROM shops WHERE company_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1',
      [companyId]
    )
    shopId = shop[0]?.id
  }
  if (!shopId) throw new AppError('No shop is available to attach the imported loans to.', 'NO_SHOP')

  const tables = openFile(input.filePath)
  const existing = await loadExistingState(companyId)
  const plan = buildImportPlan(tables, existing, newId)
  const ctx: WriteContext = { companyId, shopId, userId: session.user.id, ts: nowIso() }

  // Writing to the Turso primary costs a network round-trip PER statement, so a
  // one-statement-at-a-time transaction of ~1,900 rows would take minutes and
  // freeze the UI. Instead we group the statements into a handful of `batch()`
  // calls — each batch is a single round-trip that libSQL wraps in its own
  // transaction. A loan and its repayment rows are always kept in the same
  // batch so a batch can never commit a loan without its schedule.
  const CHUNK = 250
  let buffer: { sql: string; args: any[] }[] = []
  const flush = async () => {
    if (buffer.length === 0) return
    await batch(buffer)
    buffer = []
  }

  for (const c of plan.customers) {
    if (c.action === 'match') continue
    buffer.push(customerInsertStmt(c, ctx))
    if (buffer.length >= CHUNK) await flush()
  }
  await flush()

  for (const l of plan.loans) {
    const loanId = newId()
    const group = [loanInsertStmt(l, loanId, ctx)]
    for (const r of l.schedule) group.push(repaymentInsertStmt(r, loanId, newId(), ctx))
    // Keep the whole loan together; flush first if it wouldn't fit.
    if (buffer.length + group.length > CHUNK) await flush()
    buffer.push(...group)
  }
  await flush()

  await logAudit({
    action: 'import.access',
    entity: 'loan',
    summary: `Imported ${plan.stats.loansToInsert} loans and ${plan.stats.customersToInsert} customers from ${fileNameOf(
      input.filePath
    )}`,
    shopId
  })

  return { fileName: fileNameOf(input.filePath), shopId, warnings: plan.warnings, ...plan.stats }
}
