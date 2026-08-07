import { all, one, run, scalar } from '../db'
import { AppError, newId, nowIso, nullify } from '../utils'
import { isValidGstin, isValidPan, isValidPhone, normalizePhone } from '../../shared/validators'
import { getSession, requirePermission } from './session'
import { logAudit } from './audit'

/* -------------------------------------------------------------------------- */
/*  Companies                                                                  */
/* -------------------------------------------------------------------------- */

export interface CompanyInput {
  id?: string
  name: string
  legalName?: string
  gstin?: string
  pan?: string
  phone?: string
  altPhone?: string
  email?: string
  website?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  pincode?: string
  logoDataUrl?: string
  invoicePrefix?: string
  terms?: string
  fyStartMonth?: number
  isActive?: boolean
}

export async function listCompanies(includeInactive = false) {
  const s = getSession()
  const isAdmin = s?.user.role === 'admin'
  const rows = await all<any>(
    isAdmin
      ? `SELECT c.*,
                (SELECT COUNT(*) FROM shops WHERE company_id = c.id AND is_active = 1) AS shop_count
           FROM companies c
          WHERE (? = 1 OR c.is_active = 1)
          ORDER BY c.is_active DESC, c.name`
      : `SELECT c.*,
                (SELECT COUNT(*) FROM shops WHERE company_id = c.id AND is_active = 1) AS shop_count
           FROM companies c
           JOIN user_companies uc ON uc.company_id = c.id AND uc.user_id = ?
          WHERE (? = 1 OR c.is_active = 1)
          ORDER BY c.is_active DESC, c.name`,
    isAdmin ? [includeInactive ? 1 : 0] : [s?.user.id ?? '', includeInactive ? 1 : 0]
  )
  return rows.map(shapeCompany)
}

function shapeCompany(r: any) {
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    gstin: r.gstin,
    pan: r.pan,
    phone: r.phone,
    altPhone: r.alt_phone,
    email: r.email,
    website: r.website,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    logoDataUrl: r.logo_data_url,
    invoicePrefix: r.invoice_prefix,
    terms: r.terms,
    fyStartMonth: r.fy_start_month,
    isActive: !!r.is_active,
    shopCount: r.shop_count ?? 0,
    createdAt: r.created_at
  }
}

export async function saveCompany(input: CompanyInput) {
  requirePermission('company.manage')
  const name = (input.name ?? '').trim()
  if (name.length < 2) throw new AppError('Company name is required.', 'VALIDATION')
  if (input.gstin && !isValidGstin(input.gstin))
    throw new AppError('GSTIN is not valid.', 'VALIDATION')
  if (input.pan && !isValidPan(input.pan)) throw new AppError('PAN is not valid.', 'VALIDATION')
  if (input.phone && !isValidPhone(input.phone))
    throw new AppError('Enter a valid 10-digit mobile number.', 'VALIDATION')

  const ts = nowIso()
  const args = [
    name,
    nullify(input.legalName) ?? name,
    nullify(input.gstin?.toUpperCase()),
    nullify(input.pan?.toUpperCase()),
    nullify(input.phone && normalizePhone(input.phone)),
    nullify(input.altPhone && normalizePhone(input.altPhone)),
    nullify(input.email),
    nullify(input.website),
    nullify(input.addressLine1),
    nullify(input.addressLine2),
    nullify(input.city),
    nullify(input.state),
    nullify(input.pincode),
    nullify(input.logoDataUrl),
    nullify(input.invoicePrefix) ?? 'INV',
    nullify(input.terms),
    input.fyStartMonth ?? 4,
    input.isActive === false ? 0 : 1,
    ts
  ]

  if (input.id) {
    await run(
      `UPDATE companies SET name=?, legal_name=?, gstin=?, pan=?, phone=?, alt_phone=?, email=?,
              website=?, address_line1=?, address_line2=?, city=?, state=?, pincode=?,
              logo_data_url=?, invoice_prefix=?, terms=?, fy_start_month=?, is_active=?, updated_at=?
        WHERE id=?`,
      [...args, input.id]
    )
    await logAudit({ action: 'company.update', entity: 'company', entityId: input.id, summary: name })
    return { id: input.id }
  }

  const id = newId()
  await run(
    `INSERT INTO companies (name, legal_name, gstin, pan, phone, alt_phone, email, website,
       address_line1, address_line2, city, state, pincode, logo_data_url, invoice_prefix, terms,
       fy_start_month, is_active, updated_at, id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...args, id, ts]
  )
  // The creator keeps access to what they create.
  const s = getSession()
  if (s) await run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [s.user.id, id])
  await logAudit({ action: 'company.create', entity: 'company', entityId: id, summary: name })
  return { id }
}

/* -------------------------------------------------------------------------- */
/*  Shops                                                                      */
/* -------------------------------------------------------------------------- */

export interface ShopInput {
  id?: string
  companyId: string
  name: string
  code: string
  phone?: string
  email?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  pincode?: string
  gstin?: string
  invoicePrefix?: string
  isActive?: boolean
}

export async function listShops(companyId?: string, includeInactive = false) {
  const s = getSession()
  const isAdmin = s?.user.role === 'admin'
  const args: any[] = []
  // The access join comes first in the SQL, so its parameter must come first too.
  const access = isAdmin ? '' : 'JOIN user_shops us ON us.shop_id = sh.id AND us.user_id = ?'
  if (!isAdmin) args.push(s?.user.id ?? '')

  const where: string[] = []
  if (companyId) {
    where.push('sh.company_id = ?')
    args.push(companyId)
  }
  if (!includeInactive) where.push('sh.is_active = 1')

  const rows = await all<any>(
    `SELECT sh.*, c.name AS company_name,
            (SELECT COUNT(*) FROM stock_units su
              WHERE su.current_shop_id = sh.id AND su.status = 'in_stock') AS stock_count
       FROM shops sh
       JOIN companies c ON c.id = sh.company_id
       ${access}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.name, sh.code`,
    args
  )
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    name: r.name,
    code: r.code,
    phone: r.phone,
    email: r.email,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    gstin: r.gstin,
    invoicePrefix: r.invoice_prefix,
    isActive: !!r.is_active,
    stockCount: r.stock_count ?? 0
  }))
}

export async function saveShop(input: ShopInput) {
  requirePermission('shop.manage')
  const name = (input.name ?? '').trim()
  const code = (input.code ?? '').trim().toUpperCase()
  if (name.length < 2) throw new AppError('Shop name is required.', 'VALIDATION')
  if (!/^[A-Z0-9-]{1,8}$/.test(code))
    throw new AppError('Shop code must be 1–8 characters (A–Z, 0–9, dash).', 'VALIDATION')
  if (input.gstin && !isValidGstin(input.gstin))
    throw new AppError('GSTIN is not valid.', 'VALIDATION')

  const clash = await one<{ id: string }>(
    'SELECT id FROM shops WHERE company_id = ? AND code = ? AND id <> ?',
    [input.companyId, code, input.id ?? '']
  )
  if (clash) throw new AppError(`Shop code "${code}" already exists in this company.`, 'DUPLICATE')

  const ts = nowIso()
  const args = [
    input.companyId,
    name,
    code,
    nullify(input.phone && normalizePhone(input.phone)),
    nullify(input.email),
    nullify(input.addressLine1),
    nullify(input.addressLine2),
    nullify(input.city),
    nullify(input.state),
    nullify(input.pincode),
    nullify(input.gstin?.toUpperCase()),
    nullify(input.invoicePrefix) ?? code,
    input.isActive === false ? 0 : 1,
    ts
  ]

  if (input.id) {
    await run(
      `UPDATE shops SET company_id=?, name=?, code=?, phone=?, email=?, address_line1=?,
              address_line2=?, city=?, state=?, pincode=?, gstin=?, invoice_prefix=?,
              is_active=?, updated_at=? WHERE id=?`,
      [...args, input.id]
    )
    await logAudit({ action: 'shop.update', entity: 'shop', entityId: input.id, summary: name })
    return { id: input.id }
  }

  const id = newId()
  await run(
    `INSERT INTO shops (company_id, name, code, phone, email, address_line1, address_line2,
       city, state, pincode, gstin, invoice_prefix, is_active, updated_at, id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...args, id, ts]
  )
  const s = getSession()
  if (s) await run('INSERT INTO user_shops (user_id, shop_id) VALUES (?, ?)', [s.user.id, id])
  await logAudit({ action: 'shop.create', entity: 'shop', entityId: id, summary: name })
  return { id }
}

export async function setShopActive(shopId: string, active: boolean) {
  requirePermission('shop.manage')
  if (!active) {
    const held =
      (await scalar<number>(
        `SELECT COUNT(*) FROM stock_units WHERE current_shop_id = ? AND status = 'in_stock'`,
        [shopId]
      )) ?? 0
    if (held > 0)
      throw new AppError(
        `This shop still holds ${held} unit(s) in stock. Transfer or sell them first.`,
        'HAS_STOCK'
      )
  }
  await run('UPDATE shops SET is_active = ?, updated_at = ? WHERE id = ?', [
    active ? 1 : 0,
    nowIso(),
    shopId
  ])
  await logAudit({ action: active ? 'shop.activate' : 'shop.deactivate', entity: 'shop', entityId: shopId })
}
