import { all, run, scalar } from '../db'
import { getSession } from './session'
import { newId, nowIso } from '../utils'

export async function logAudit(opts: {
  action: string
  entity?: string
  entityId?: string
  summary?: string
  meta?: unknown
  companyId?: string | null
  shopId?: string | null
}): Promise<void> {
  const s = getSession()
  await run(
    `INSERT INTO audit_log (id, company_id, shop_id, user_id, user_name, action, entity,
                            entity_id, summary, meta, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      opts.companyId ?? s?.companyId ?? null,
      opts.shopId ?? s?.shopId ?? null,
      s?.user.id ?? null,
      s?.user.name ?? 'system',
      opts.action,
      opts.entity ?? null,
      opts.entityId ?? null,
      opts.summary ?? null,
      opts.meta ? JSON.stringify(opts.meta) : null,
      nowIso()
    ]
  )
}

export async function listAudit(params: {
  companyId: string
  from?: string
  to?: string
  userId?: string
  entity?: string
  search?: string
  limit?: number
  offset?: number
}) {
  const where: string[] = ['company_id = ?']
  const args: any[] = [params.companyId]

  if (params.from) {
    where.push('at >= ?')
    args.push(`${params.from}T00:00:00.000Z`)
  }
  if (params.to) {
    where.push('at <= ?')
    args.push(`${params.to}T23:59:59.999Z`)
  }
  if (params.userId) {
    where.push('user_id = ?')
    args.push(params.userId)
  }
  if (params.entity) {
    where.push('entity = ?')
    args.push(params.entity)
  }
  if (params.search) {
    where.push('(summary LIKE ? OR action LIKE ? OR user_name LIKE ?)')
    const q = `%${params.search}%`
    args.push(q, q, q)
  }

  const clause = `WHERE ${where.join(' AND ')}`
  const total = (await scalar<number>(`SELECT COUNT(*) FROM audit_log ${clause}`, args)) ?? 0
  const rows = await all(
    `SELECT * FROM audit_log ${clause} ORDER BY at DESC LIMIT ? OFFSET ?`,
    [...args, params.limit ?? 100, params.offset ?? 0]
  )
  return { rows, total }
}
