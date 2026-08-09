import { all, one, run } from '../db'
import { AppError, newId, nowIso, nullify, num } from '../utils'
import { requireCompany, requirePermission } from './session'
import { logAudit } from './audit'

/* -------------------------------------------------------------------------- */
/*  Brands                                                                     */
/* -------------------------------------------------------------------------- */

export async function listBrands(includeInactive = false) {
  const { companyId } = requireCompany()
  const rows = await all<any>(
    `SELECT b.*, (SELECT COUNT(*) FROM models m WHERE m.brand_id = b.id AND m.is_active = 1) AS model_count
       FROM brands b
      WHERE b.company_id = ? AND (? = 1 OR b.is_active = 1)
      ORDER BY b.name`,
    [companyId, includeInactive ? 1 : 0]
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: !!r.is_active,
    modelCount: r.model_count ?? 0
  }))
}

export async function saveBrand(input: { id?: string; name: string; isActive?: boolean }) {
  requirePermission('product.manage')
  const { companyId } = requireCompany()
  // Catalogue names are stored uppercase so the list reads consistently no
  // matter who typed it in. Normalising here covers every entry point — the
  // form, the quick-add on the purchase/sale screens, and the importer.
  const name = (input.name ?? '').trim().toUpperCase()
  if (name.length < 1) throw new AppError('Brand name is required.', 'VALIDATION')

  const clash = await one<{ id: string }>(
    'SELECT id FROM brands WHERE company_id = ? AND lower(name) = lower(?) AND id <> ?',
    [companyId, name, input.id ?? '']
  )
  if (clash) throw new AppError(`Brand "${name}" already exists.`, 'DUPLICATE')

  const ts = nowIso()
  if (input.id) {
    await run('UPDATE brands SET name = ?, is_active = ?, updated_at = ? WHERE id = ?', [
      name,
      input.isActive === false ? 0 : 1,
      ts,
      input.id
    ])
    return { id: input.id }
  }
  const id = newId()
  await run(
    'INSERT INTO brands (id, company_id, name, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    [id, companyId, name, 1, ts, ts]
  )
  await logAudit({ action: 'brand.create', entity: 'brand', entityId: id, summary: name })
  return { id }
}

/* -------------------------------------------------------------------------- */
/*  Models                                                                     */
/* -------------------------------------------------------------------------- */

export interface ModelInput {
  id?: string
  brandId: string
  name: string
  sku?: string
  category?: string
  hsn?: string
  ram?: string
  storage?: string
  color?: string
  gstRate?: number
  defaultCost?: number
  defaultPrice?: number
  mrp?: number
  lowStockAlert?: number
  trackImei?: boolean
  warrantyMonths?: number
  isActive?: boolean
}

export async function listModels(params?: {
  search?: string
  brandId?: string
  includeInactive?: boolean
  shopId?: string
}) {
  const { companyId } = requireCompany()
  const shopId = params?.shopId ?? ''

  // Placeholders are consumed in SQL order: SELECT subquery first, then WHERE.
  const args: any[] = [shopId, shopId, companyId]
  const where = ['m.company_id = ?']

  if (!params?.includeInactive) where.push('m.is_active = 1')
  if (params?.brandId) {
    where.push('m.brand_id = ?')
    args.push(params.brandId)
  }
  if (params?.search) {
    where.push('(m.name LIKE ? OR m.sku LIKE ? OR b.name LIKE ?)')
    const q = `%${params.search}%`
    args.push(q, q, q)
  }

  const rows = await all<any>(
    `SELECT m.*, b.name AS brand_name,
            (SELECT COUNT(*) FROM stock_units su
              WHERE su.model_id = m.id AND su.status = 'in_stock'
                AND (? = '' OR su.current_shop_id = ?)) AS in_stock
       FROM models m
       JOIN brands b ON b.id = m.brand_id
      WHERE ${where.join(' AND ')}
      ORDER BY b.name, m.name`,
    args
  )
  return rows.map(shapeModel)
}

function shapeModel(r: any) {
  return {
    id: r.id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    name: r.name,
    sku: r.sku,
    category: r.category,
    hsn: r.hsn,
    ram: r.ram,
    storage: r.storage,
    color: r.color,
    gstRate: r.gst_rate,
    defaultCost: r.default_cost,
    defaultPrice: r.default_price,
    mrp: r.mrp,
    lowStockAlert: r.low_stock_alert,
    trackImei: !!r.track_imei,
    warrantyMonths: r.warranty_months,
    isActive: !!r.is_active,
    inStock: r.in_stock ?? 0,
    label: `${r.brand_name} ${r.name}${r.storage ? ` ${r.storage}` : ''}${r.ram ? `/${r.ram}` : ''}`
  }
}

function makeSku(brand: string, name: string, ram?: string, storage?: string): string {
  const clean = (s?: string) =>
    (s ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10)
  return [clean(brand), clean(name), clean(ram), clean(storage)].filter(Boolean).join('-')
}

export async function saveModel(input: ModelInput) {
  requirePermission('product.manage')
  const { companyId } = requireCompany()

  // Stored uppercase, same as brands — see saveBrand.
  const name = (input.name ?? '').trim().toUpperCase()
  if (name.length < 1) throw new AppError('Model name is required.', 'VALIDATION')
  const brand = await one<{ name: string }>('SELECT name FROM brands WHERE id = ?', [input.brandId])
  if (!brand) throw new AppError('Please choose a brand.', 'VALIDATION')

  const sku = (input.sku?.trim() || makeSku(brand.name, name, input.ram, input.storage)).toUpperCase()
  const clash = await one<{ id: string }>(
    'SELECT id FROM models WHERE company_id = ? AND lower(sku) = lower(?) AND id <> ?',
    [companyId, sku, input.id ?? '']
  )
  if (clash) throw new AppError(`SKU "${sku}" already exists.`, 'DUPLICATE')

  // Uppercase the free-text spec fields too, so a model reads uniformly
  // wherever it is shown (e.g. "VIVO Y29 4+128 · BLACK"). `category` is left
  // alone — it comes from a fixed dropdown and is matched elsewhere by value.
  const upper = (v?: string) => nullify(v)?.toUpperCase() ?? null

  const ts = nowIso()
  const args = [
    input.brandId,
    name,
    sku,
    nullify(input.category) ?? 'Smartphone',
    upper(input.hsn),
    upper(input.ram),
    upper(input.storage),
    upper(input.color),
    num(input.gstRate, 18),
    num(input.defaultCost),
    num(input.defaultPrice),
    num(input.mrp),
    Math.max(0, num(input.lowStockAlert, 2)),
    input.trackImei === false ? 0 : 1,
    num(input.warrantyMonths, 12),
    input.isActive === false ? 0 : 1,
    ts
  ]

  if (input.id) {
    await run(
      `UPDATE models SET brand_id=?, name=?, sku=?, category=?, hsn=?, ram=?, storage=?, color=?,
              gst_rate=?, default_cost=?, default_price=?, mrp=?, low_stock_alert=?, track_imei=?,
              warranty_months=?, is_active=?, updated_at=? WHERE id=?`,
      [...args, input.id]
    )
    await logAudit({ action: 'model.update', entity: 'model', entityId: input.id, summary: `${brand.name} ${name}` })
    return { id: input.id }
  }

  const id = newId()
  await run(
    `INSERT INTO models (brand_id, name, sku, category, hsn, ram, storage, color, gst_rate,
       default_cost, default_price, mrp, low_stock_alert, track_imei, warranty_months, is_active,
       updated_at, id, company_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...args, id, companyId, ts]
  )
  await logAudit({ action: 'model.create', entity: 'model', entityId: id, summary: `${brand.name} ${name}` })
  return { id }
}

/** Used by the "quick add" flow inside the purchase / sale screens. */
export async function quickCreateModel(brandName: string, modelName: string) {
  requirePermission('product.manage')
  const { companyId } = requireCompany()
  let brand = await one<{ id: string }>(
    'SELECT id FROM brands WHERE company_id = ? AND lower(name) = lower(?)',
    [companyId, brandName.trim()]
  )
  if (!brand) {
    const created = await saveBrand({ name: brandName })
    brand = { id: created.id! }
  }
  return saveModel({ brandId: brand.id, name: modelName })
}
