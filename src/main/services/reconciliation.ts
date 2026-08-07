import { all, one, run, tx } from '../db'
import { AppError, newId, nowIso, nullify, num, round2, today } from '../utils'
import { requireCompany, requirePermission, requireSession } from './session'
import { logAudit } from './audit'

/**
 * Stock movement ledger. `stock_units` only stores the *current* state, so any
 * "what should be on the shelf between two dates" question is answered by
 * replaying purchases, transfers, sales and adjustments as dated +1/-1 events.
 */
const MOVEMENTS_CTE = /* sql */ `
WITH movements AS (
  SELECT p.shop_id AS shop_id, su.model_id AS model_id, p.purchase_date AS d,
         1 AS qty, 'purchase' AS kind
    FROM stock_units su
    JOIN purchases p ON p.id = su.purchase_id
   WHERE su.company_id = :company AND p.status <> 'cancelled'

  UNION ALL
  SELECT t.from_shop_id, su.model_id, t.transfer_date, -1, 'transfer_out'
    FROM transfer_items ti
    JOIN transfers t ON t.id = ti.transfer_id
    JOIN stock_units su ON su.id = ti.stock_unit_id
   WHERE su.company_id = :company AND t.status <> 'cancelled'

  UNION ALL
  SELECT t.to_shop_id, su.model_id, COALESCE(date(t.received_at), t.transfer_date), 1, 'transfer_in'
    FROM transfer_items ti
    JOIN transfers t ON t.id = ti.transfer_id
    JOIN stock_units su ON su.id = ti.stock_unit_id
   WHERE su.company_id = :company AND t.status <> 'cancelled' AND ti.received = 1

  UNION ALL
  SELECT s.shop_id, si.model_id, s.sale_date, -si.qty, 'sale'
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
   WHERE s.company_id = :company AND s.status <> 'cancelled'

  UNION ALL
  SELECT a.shop_id, a.model_id, date(a.created_at),
         CASE WHEN a.to_status = 'in_stock' THEN a.qty ELSE -a.qty END, 'adjust'
    FROM stock_adjustments a
   WHERE a.company_id = :company AND a.model_id IS NOT NULL
)`

export interface ReconRow {
  modelId: string
  modelName: string
  brandName: string
  sku: string
  openingQty: number
  purchasedQty: number
  transferInQty: number
  transferOutQty: number
  soldQty: number
  adjustedQty: number
  expectedQty: number
  unitCost: number
}

/** Live computation — used both for the preview and when creating a draft. */
export async function computeExpected(params: {
  shopId: string
  from: string
  to: string
  includeZero?: boolean
}): Promise<ReconRow[]> {
  const { companyId } = requireCompany()

  const rows = await all<any>(
    `${MOVEMENTS_CTE}
     SELECT m.id AS model_id, m.name AS model_name, m.sku, b.name AS brand_name,
            COALESCE(SUM(CASE WHEN mv.d <  :from THEN mv.qty END), 0)                                   AS opening_qty,
            COALESCE(SUM(CASE WHEN mv.d >= :from AND mv.d <= :to AND mv.kind = 'purchase'     THEN mv.qty END), 0) AS purchased_qty,
            COALESCE(SUM(CASE WHEN mv.d >= :from AND mv.d <= :to AND mv.kind = 'transfer_in'  THEN mv.qty END), 0) AS transfer_in_qty,
            COALESCE(SUM(CASE WHEN mv.d >= :from AND mv.d <= :to AND mv.kind = 'transfer_out' THEN -mv.qty END), 0) AS transfer_out_qty,
            COALESCE(SUM(CASE WHEN mv.d >= :from AND mv.d <= :to AND mv.kind = 'sale'         THEN -mv.qty END), 0) AS sold_qty,
            COALESCE(SUM(CASE WHEN mv.d >= :from AND mv.d <= :to AND mv.kind = 'adjust'       THEN -mv.qty END), 0) AS adjusted_qty,
            COALESCE(SUM(CASE WHEN mv.d <= :to THEN mv.qty END), 0)                                     AS expected_qty,
            COALESCE((SELECT AVG(su.cost_price) FROM stock_units su
                       WHERE su.model_id = m.id AND su.current_shop_id = :shop
                         AND su.status = 'in_stock'), m.default_cost)                                   AS unit_cost
       FROM models m
       JOIN brands b ON b.id = m.brand_id
       LEFT JOIN movements mv ON mv.model_id = m.id AND mv.shop_id = :shop
      WHERE m.company_id = :company
      GROUP BY m.id
      ORDER BY b.name, m.name`,
    { company: companyId, shop: params.shopId, from: params.from, to: params.to }
  )

  return rows
    .map((r) => ({
      modelId: r.model_id,
      modelName: r.model_name,
      brandName: r.brand_name,
      sku: r.sku,
      openingQty: num(r.opening_qty),
      purchasedQty: num(r.purchased_qty),
      transferInQty: num(r.transfer_in_qty),
      transferOutQty: num(r.transfer_out_qty),
      soldQty: num(r.sold_qty),
      adjustedQty: num(r.adjusted_qty),
      expectedQty: num(r.expected_qty),
      unitCost: round2(num(r.unit_cost))
    }))
    .filter(
      (r) =>
        params.includeZero ||
        r.expectedQty !== 0 ||
        r.openingQty !== 0 ||
        r.purchasedQty !== 0 ||
        r.soldQty !== 0 ||
        r.transferInQty !== 0 ||
        r.transferOutQty !== 0
    )
}

/* -------------------------------------------------------------------------- */
/*  Reasons                                                                    */
/* -------------------------------------------------------------------------- */

export async function listReasons(includeInactive = false) {
  return all<any>(
    `SELECT * FROM recon_reasons WHERE (? = 1 OR is_active = 1)
      ORDER BY is_system DESC, sort_order, label`,
    [includeInactive ? 1 : 0]
  )
}

export async function saveReason(input: {
  code: string
  label: string
  direction?: string
  isActive?: boolean
}) {
  requirePermission('reconciliation.manage')
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (!code) throw new AppError('Reason code is required.', 'VALIDATION')
  await run(
    `INSERT INTO recon_reasons (code, label, direction, is_system, is_active, sort_order)
     VALUES (?, ?, ?, 0, ?, 99)
     ON CONFLICT(code) DO UPDATE SET label = excluded.label, direction = excluded.direction,
       is_active = excluded.is_active`,
    [code, input.label.trim(), input.direction ?? 'both', input.isActive === false ? 0 : 1]
  )
  return { code }
}

/** Reason → the stock status a missing unit should end up in. */
const REASON_STATUS: Record<string, string> = {
  THEFT: 'lost',
  DAMAGE: 'damaged',
  MISPLACED: 'lost',
  SERVICE_CENTRE: 'reserved',
  DEMO_PIECE: 'reserved',
  STAFF_ISSUE: 'lost',
  RETURNED_TO_SUPPLIER: 'returned_to_supplier',
  UNRECORDED_SALE: 'lost',
  UNRECORDED_TRANSFER: 'lost'
}

/* -------------------------------------------------------------------------- */
/*  Draft lifecycle                                                            */
/* -------------------------------------------------------------------------- */

export async function createReconciliation(input: {
  shopId: string
  fromDate: string
  toDate: string
  title?: string
  notes?: string
  includeZero?: boolean
}) {
  requirePermission('reconciliation.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  if (!input.shopId) throw new AppError('Choose a shop.', 'VALIDATION')
  if (!input.fromDate || !input.toDate) throw new AppError('Choose a date range.', 'VALIDATION')
  if (input.fromDate > input.toDate)
    throw new AppError('The "from" date must be before the "to" date.', 'VALIDATION')

  const rows = await computeExpected({
    shopId: input.shopId,
    from: input.fromDate,
    to: input.toDate,
    includeZero: input.includeZero
  })
  if (!rows.length)
    throw new AppError('No stock movement found in this period for this shop.', 'EMPTY')

  const id = newId()
  const ts = nowIso()

  await tx(async (t) => {
    await t.run(
      `INSERT INTO reconciliations (id, company_id, shop_id, title, from_date, to_date, status,
         scope, notes, total_variance, variance_value, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'draft','model',?,0,0,?,?,?)`,
      [
        id,
        companyId,
        input.shopId,
        nullify(input.title) ?? `Stock check ${input.fromDate} → ${input.toDate}`,
        input.fromDate,
        input.toDate,
        nullify(input.notes),
        session.user.id,
        ts,
        ts
      ]
    )
    for (const r of rows) {
      await t.run(
        `INSERT INTO reconciliation_items (id, reconciliation_id, model_id, opening_qty,
           purchased_qty, transfer_in_qty, transfer_out_qty, sold_qty, adjusted_qty, expected_qty,
           physical_qty, variance, unit_cost, variance_value)
         VALUES (?,?,?,?,?,?,?,?,?,?,NULL,0,?,0)`,
        [
          newId(),
          id,
          r.modelId,
          r.openingQty,
          r.purchasedQty,
          r.transferInQty,
          r.transferOutQty,
          r.soldQty,
          r.adjustedQty,
          r.expectedQty,
          r.unitCost
        ]
      )
    }
  })

  await logAudit({
    action: 'recon.create',
    entity: 'reconciliation',
    entityId: id,
    summary: `${rows.length} SKUs, ${input.fromDate} → ${input.toDate}`,
    shopId: input.shopId
  })

  return { id, itemCount: rows.length }
}

export async function listReconciliations(params: { shopId?: string; status?: string }) {
  requirePermission('reconciliation.view')
  const { companyId } = requireCompany()
  const where = ['r.company_id = ?']
  const args: any[] = [companyId]
  if (params.shopId) {
    where.push('r.shop_id = ?')
    args.push(params.shopId)
  }
  if (params.status && params.status !== 'all') {
    where.push('r.status = ?')
    args.push(params.status)
  }

  const rows = await all<any>(
    `SELECT r.*, sh.name AS shop_name, sh.code AS shop_code, u.name AS created_by_name,
            f.name AS finalized_by_name,
            (SELECT COUNT(*) FROM reconciliation_items i WHERE i.reconciliation_id = r.id) AS item_count,
            (SELECT COUNT(*) FROM reconciliation_items i WHERE i.reconciliation_id = r.id
              AND i.physical_qty IS NOT NULL) AS counted_count
       FROM reconciliations r
       JOIN shops sh ON sh.id = r.shop_id
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN users f ON f.id = r.finalized_by
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC LIMIT 100`,
    args
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    shopId: r.shop_id,
    shopName: r.shop_name,
    shopCode: r.shop_code,
    fromDate: r.from_date,
    toDate: r.to_date,
    status: r.status,
    notes: r.notes,
    totalVariance: r.total_variance,
    varianceValue: r.variance_value,
    itemCount: r.item_count ?? 0,
    countedCount: r.counted_count ?? 0,
    createdByName: r.created_by_name,
    finalizedByName: r.finalized_by_name,
    finalizedAt: r.finalized_at,
    createdAt: r.created_at
  }))
}

export async function getReconciliation(id: string) {
  requirePermission('reconciliation.view')
  const header = await one<any>(
    `SELECT r.*, sh.name AS shop_name, sh.code AS shop_code, u.name AS created_by_name
       FROM reconciliations r JOIN shops sh ON sh.id = r.shop_id
       LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?`,
    [id]
  )
  if (!header) throw new AppError('Reconciliation not found.', 'NOT_FOUND')

  const items = await all<any>(
    `SELECT i.*, m.name AS model_name, m.sku, b.name AS brand_name, rr.label AS reason_label
       FROM reconciliation_items i
       JOIN models m ON m.id = i.model_id
       JOIN brands b ON b.id = m.brand_id
       LEFT JOIN recon_reasons rr ON rr.code = i.reason_code
      WHERE i.reconciliation_id = ?
      ORDER BY (i.physical_qty IS NULL) DESC, ABS(i.variance) DESC, b.name, m.name`,
    [id]
  )

  return {
    header: {
      id: header.id,
      title: header.title,
      shopId: header.shop_id,
      shopName: header.shop_name,
      shopCode: header.shop_code,
      fromDate: header.from_date,
      toDate: header.to_date,
      status: header.status,
      notes: header.notes,
      totalVariance: header.total_variance,
      varianceValue: header.variance_value,
      createdByName: header.created_by_name,
      finalizedAt: header.finalized_at,
      createdAt: header.created_at
    },
    items: items.map((i) => ({
      id: i.id,
      modelId: i.model_id,
      modelName: i.model_name,
      brandName: i.brand_name,
      sku: i.sku,
      openingQty: i.opening_qty,
      purchasedQty: i.purchased_qty,
      transferInQty: i.transfer_in_qty,
      transferOutQty: i.transfer_out_qty,
      soldQty: i.sold_qty,
      adjustedQty: i.adjusted_qty,
      expectedQty: i.expected_qty,
      physicalQty: i.physical_qty,
      variance: i.variance,
      unitCost: i.unit_cost,
      varianceValue: i.variance_value,
      reasonCode: i.reason_code,
      reasonLabel: i.reason_label,
      reasonNote: i.reason_note,
      missingUnitIds: i.missing_unit_ids ? JSON.parse(i.missing_unit_ids) : []
    }))
  }
}

export async function updateReconItem(input: {
  itemId: string
  physicalQty?: number | null
  reasonCode?: string | null
  reasonNote?: string | null
  missingUnitIds?: string[]
}) {
  requirePermission('reconciliation.manage')
  const session = requireSession()

  const item = await one<any>(
    `SELECT i.*, r.status AS recon_status FROM reconciliation_items i
       JOIN reconciliations r ON r.id = i.reconciliation_id WHERE i.id = ?`,
    [input.itemId]
  )
  if (!item) throw new AppError('Line not found.', 'NOT_FOUND')
  if (item.recon_status === 'finalized')
    throw new AppError('This reconciliation is finalised and cannot be edited.', 'LOCKED')

  const physical =
    input.physicalQty === null || input.physicalQty === undefined
      ? null
      : Math.max(0, Math.floor(num(input.physicalQty)))
  const variance = physical === null ? 0 : physical - num(item.expected_qty)

  await run(
    `UPDATE reconciliation_items
        SET physical_qty = ?, variance = ?, variance_value = ?, reason_code = ?, reason_note = ?,
            missing_unit_ids = ?, counted_by = ?, counted_at = ?
      WHERE id = ?`,
    [
      physical,
      variance,
      round2(variance * num(item.unit_cost)),
      nullify(input.reasonCode),
      nullify(input.reasonNote),
      input.missingUnitIds?.length ? JSON.stringify(input.missingUnitIds) : null,
      session.user.id,
      nowIso(),
      input.itemId
    ]
  )

  await refreshTotals(item.reconciliation_id)
  return { variance }
}

/** Bulk "everything matches" helper — sets physical = expected for untouched lines. */
export async function acceptAllExpected(reconciliationId: string) {
  requirePermission('reconciliation.manage')
  const session = requireSession()
  await run(
    `UPDATE reconciliation_items
        SET physical_qty = expected_qty, variance = 0, variance_value = 0,
            counted_by = ?, counted_at = ?
      WHERE reconciliation_id = ? AND physical_qty IS NULL`,
    [session.user.id, nowIso(), reconciliationId]
  )
  await refreshTotals(reconciliationId)
}

async function refreshTotals(reconciliationId: string) {
  const t = await one<any>(
    `SELECT COALESCE(SUM(ABS(variance)),0) AS v, COALESCE(SUM(variance_value),0) AS vv
       FROM reconciliation_items WHERE reconciliation_id = ?`,
    [reconciliationId]
  )
  await run(
    'UPDATE reconciliations SET total_variance = ?, variance_value = ?, updated_at = ? WHERE id = ?',
    [num(t?.v), round2(num(t?.vv)), nowIso(), reconciliationId]
  )
}

/** Units currently on the shelf for a model — lets the user tick exactly which ones are missing. */
export async function unitsForReconItem(reconciliationId: string, modelId: string) {
  requirePermission('reconciliation.view')
  const header = await one<any>('SELECT shop_id FROM reconciliations WHERE id = ?', [
    reconciliationId
  ])
  if (!header) throw new AppError('Reconciliation not found.', 'NOT_FOUND')
  return all<any>(
    `SELECT su.id, su.imei1, su.serial_no, su.color, su.cost_price, su.added_at
       FROM stock_units su
      WHERE su.model_id = ? AND su.current_shop_id = ? AND su.status = 'in_stock'
      ORDER BY su.added_at`,
    [modelId, header.shop_id]
  )
}

export async function finalizeReconciliation(id: string) {
  requirePermission('reconciliation.manage')
  const { companyId } = requireCompany()
  const session = requireSession()

  const header = await one<any>('SELECT * FROM reconciliations WHERE id = ? AND company_id = ?', [
    id,
    companyId
  ])
  if (!header) throw new AppError('Reconciliation not found.', 'NOT_FOUND')
  if (header.status === 'finalized') throw new AppError('Already finalised.', 'ALREADY_DONE')

  const items = await all<any>(
    `SELECT i.*, m.name AS model_name FROM reconciliation_items i
       JOIN models m ON m.id = i.model_id WHERE i.reconciliation_id = ?`,
    [id]
  )

  const uncounted = items.filter((i) => i.physical_qty === null)
  if (uncounted.length)
    throw new AppError(
      `${uncounted.length} line(s) still have no physical count. Use "Accept expected" or enter the counts.`,
      'INCOMPLETE'
    )

  const missingReason = items.filter((i) => num(i.variance) !== 0 && !i.reason_code)
  if (missingReason.length)
    throw new AppError(
      `Pick a reason for: ${missingReason
        .slice(0, 3)
        .map((i) => i.model_name)
        .join(', ')}${missingReason.length > 3 ? ` and ${missingReason.length - 3} more` : ''}.`,
      'NEEDS_REASON'
    )

  const otherWithoutNote = items.filter(
    (i) => i.reason_code === 'OTHER' && !String(i.reason_note ?? '').trim()
  )
  if (otherWithoutNote.length)
    throw new AppError('Reason "Other" needs a short explanation.', 'NEEDS_NOTE')

  const ts = nowIso()
  let adjusted = 0

  await tx(async (t) => {
    for (const item of items) {
      const variance = num(item.variance)
      if (variance === 0) continue

      const toStatus = REASON_STATUS[item.reason_code] ?? 'lost'

      if (variance < 0) {
        // Shortage: take the explicitly ticked units, else the oldest on the shelf.
        const shortage = Math.abs(variance)
        const picked: string[] = item.missing_unit_ids ? JSON.parse(item.missing_unit_ids) : []
        let unitIds = picked.slice(0, shortage)

        if (unitIds.length < shortage) {
          const auto = await t.all<any>(
            `SELECT id FROM stock_units
              WHERE model_id = ? AND current_shop_id = ? AND status = 'in_stock'
                ${unitIds.length ? `AND id NOT IN (${unitIds.map(() => '?').join(',')})` : ''}
              ORDER BY added_at LIMIT ?`,
            [item.model_id, header.shop_id, ...unitIds, shortage - unitIds.length]
          )
          unitIds = [...unitIds, ...auto.map((u) => u.id)]
        }

        for (const unitId of unitIds) {
          const unit = await t.one<any>('SELECT cost_price FROM stock_units WHERE id = ?', [unitId])
          await t.run('UPDATE stock_units SET status = ?, updated_at = ? WHERE id = ?', [
            toStatus,
            ts,
            unitId
          ])
          await t.run(
            `INSERT INTO stock_adjustments (id, company_id, shop_id, stock_unit_id, model_id, qty,
               from_status, to_status, reason_code, reason_note, value_impact, reconciliation_id,
               created_by, created_at)
             VALUES (?,?,?,?,?,1,'in_stock',?,?,?,?,?,?,?)`,
            [
              newId(),
              companyId,
              header.shop_id,
              unitId,
              item.model_id,
              toStatus,
              item.reason_code,
              nullify(item.reason_note),
              -num(unit?.cost_price),
              id,
              session.user.id,
              ts
            ]
          )
          adjusted++
        }

        // Fewer units on record than the shortage: log the remainder as a
        // quantity-only adjustment so the ledger still balances.
        const uncovered = shortage - unitIds.length
        if (uncovered > 0) {
          await t.run(
            `INSERT INTO stock_adjustments (id, company_id, shop_id, stock_unit_id, model_id, qty,
               from_status, to_status, reason_code, reason_note, value_impact, reconciliation_id,
               created_by, created_at)
             VALUES (?,?,?,NULL,?,?,'in_stock',?,?,?,?,?,?,?)`,
            [
              newId(),
              companyId,
              header.shop_id,
              item.model_id,
              uncovered,
              toStatus,
              item.reason_code,
              nullify(item.reason_note),
              -round2(uncovered * num(item.unit_cost)),
              id,
              session.user.id,
              ts
            ]
          )
          adjusted += uncovered
        }
      } else {
        // Excess: more on the shelf than the books say. Record it as a positive
        // adjustment; the owner still needs to enter the missing purchase.
        await t.run(
          `INSERT INTO stock_adjustments (id, company_id, shop_id, stock_unit_id, model_id, qty,
             from_status, to_status, reason_code, reason_note, value_impact, reconciliation_id,
             created_by, created_at)
           VALUES (?,?,?,NULL,?,?,'unknown','in_stock',?,?,?,?,?,?)`,
          [
            newId(),
            companyId,
            header.shop_id,
            item.model_id,
            variance,
            item.reason_code,
            nullify(item.reason_note),
            round2(variance * num(item.unit_cost)),
            id,
            session.user.id,
            ts
          ]
        )
        adjusted += variance
      }
    }

    await t.run(
      `UPDATE reconciliations SET status = 'finalized', finalized_by = ?, finalized_at = ?,
              updated_at = ? WHERE id = ?`,
      [session.user.id, ts, ts, id]
    )
  })

  await logAudit({
    action: 'recon.finalize',
    entity: 'reconciliation',
    entityId: id,
    summary: `Finalised with ${adjusted} unit adjustment(s), value impact ₹${header.variance_value}`,
    shopId: header.shop_id
  })

  return { adjusted }
}

export async function deleteReconciliation(id: string) {
  requirePermission('reconciliation.manage')
  const header = await one<any>('SELECT status FROM reconciliations WHERE id = ?', [id])
  if (!header) throw new AppError('Reconciliation not found.', 'NOT_FOUND')
  if (header.status === 'finalized')
    throw new AppError('A finalised reconciliation cannot be deleted.', 'LOCKED')
  await run('DELETE FROM reconciliations WHERE id = ?', [id])
  await logAudit({ action: 'recon.delete', entity: 'reconciliation', entityId: id })
}

export function defaultRange(): { from: string; to: string } {
  const d = new Date()
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { from: fmt(first), to: today() }
}
