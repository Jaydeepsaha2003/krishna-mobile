/**
 * The saved "service price list" — common recharge/repair/service presets a
 * shop can reuse when billing a service sale, instead of typing the name and
 * price every time. Purely a convenience lookup; billing never requires it.
 */
import { all, run } from '../db'
import { AppError, newId, nowIso, num } from '../utils'
import { requireCompany, requirePermission } from './session'
import { logAudit } from './audit'

export type ServiceKind = 'repair' | 'recharge' | 'service'

export interface ServiceInput {
  id?: string
  kind: ServiceKind
  name: string
  defaultPrice?: number
  gstRate?: number
  isActive?: boolean
  sortOrder?: number
}

function shape(r: any) {
  return {
    id: r.id,
    kind: r.kind as ServiceKind,
    name: r.name,
    defaultPrice: r.default_price,
    gstRate: r.gst_rate,
    isActive: !!r.is_active,
    sortOrder: r.sort_order
  }
}

export async function listServices(params?: { kind?: ServiceKind; includeInactive?: boolean }) {
  requirePermission('product.view')
  const { companyId } = requireCompany()
  const where = ['company_id = ?']
  const args: any[] = [companyId]
  if (params?.kind) {
    where.push('kind = ?')
    args.push(params.kind)
  }
  if (!params?.includeInactive) where.push('is_active = 1')
  const rows = await all<any>(
    `SELECT * FROM service_catalog WHERE ${where.join(' AND ')} ORDER BY kind, sort_order, name`,
    args
  )
  return rows.map(shape)
}

export async function saveService(input: ServiceInput) {
  requirePermission('product.manage')
  const { companyId } = requireCompany()

  const name = (input.name ?? '').trim()
  if (name.length < 2) throw new AppError('Enter a name for this service.', 'VALIDATION')
  if (!['repair', 'recharge', 'service'].includes(input.kind))
    throw new AppError('Pick a valid service type.', 'VALIDATION')

  const ts = nowIso()
  const args = [
    input.kind,
    name,
    num(input.defaultPrice),
    num(input.gstRate),
    input.isActive === false ? 0 : 1,
    Math.floor(num(input.sortOrder)),
    ts
  ]

  if (input.id) {
    await run(
      `UPDATE service_catalog SET kind=?, name=?, default_price=?, gst_rate=?, is_active=?,
              sort_order=?, updated_at=? WHERE id=? AND company_id=?`,
      [...args, input.id, companyId]
    )
    await logAudit({ action: 'service.update', entity: 'service', entityId: input.id, summary: name })
    return { id: input.id }
  }

  const id = newId()
  await run(
    `INSERT INTO service_catalog (kind, name, default_price, gst_rate, is_active, sort_order,
       updated_at, id, company_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [...args, id, companyId, ts]
  )
  await logAudit({ action: 'service.create', entity: 'service', entityId: id, summary: name })
  return { id }
}

export async function deleteServiceEntry(id: string) {
  requirePermission('product.manage')
  const { companyId } = requireCompany()
  if (!id) throw new AppError('Nothing to delete.', 'VALIDATION')
  // Soft-delete: the catalog is only a lookup, and past sales already stored
  // their own line copies, so removing a preset never touches history.
  await run('UPDATE service_catalog SET is_active = 0, updated_at = ? WHERE id = ? AND company_id = ?', [
    nowIso(),
    id,
    companyId
  ])
  return { id }
}
