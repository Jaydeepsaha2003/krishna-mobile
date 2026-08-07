import { all, one, run, scalar } from '../db'
import { AppError, newId, nowIso, nullify, num } from '../utils'
import {
  isValidAadhaar,
  isValidGstin,
  isValidPan,
  isValidPhone,
  isValidPincode,
  normalizeAadhaar,
  normalizeGstin,
  normalizePan,
  normalizePhone
} from '../../shared/validators'
import { INDIAN_STATE_NAMES } from '../../shared/constants'
import { getSession, requireCompany, requirePermission } from './session'
import { logAudit } from './audit'

/* -------------------------------------------------------------------------- */
/*  Customers                                                                  */
/* -------------------------------------------------------------------------- */

export interface CustomerInput {
  id?: string
  name: string
  phonePrimary: string
  phoneSecondary?: string
  email?: string
  aadhaar?: string
  pan?: string
  dob?: string
  gender?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  pincode?: string
  gstin?: string
  customerType?: string
  creditLimit?: number
  notes?: string
  isActive?: boolean
}

function shapeCustomer(r: any) {
  return {
    id: r.id,
    name: r.name,
    phonePrimary: r.phone_primary,
    phoneSecondary: r.phone_secondary,
    email: r.email,
    aadhaar: r.aadhaar,
    pan: r.pan,
    dob: r.dob,
    gender: r.gender,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    gstin: r.gstin,
    customerType: r.customer_type,
    creditLimit: r.credit_limit,
    notes: r.notes,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    // aggregates (present on list queries)
    totalPurchases: r.total_purchases ?? 0,
    totalSpent: r.total_spent ?? 0,
    outstanding: r.outstanding ?? 0,
    lastPurchaseAt: r.last_purchase_at ?? null,
    overdueCount: r.overdue_count ?? 0
  }
}

export async function listCustomers(params?: {
  search?: string
  onlyWithDues?: boolean
  includeInactive?: boolean
  limit?: number
}) {
  requirePermission('customer.view')
  const { companyId } = requireCompany()
  const args: any[] = [companyId]
  const where = ['c.company_id = ?']

  if (!params?.includeInactive) where.push('c.is_active = 1')
  if (params?.search) {
    const q = `%${params.search.trim()}%`
    where.push(
      '(c.name LIKE ? OR c.phone_primary LIKE ? OR c.phone_secondary LIKE ? OR c.aadhaar LIKE ? OR c.pan LIKE ? OR c.email LIKE ?)'
    )
    args.push(q, q, q, q, q, q)
  }

  const having = params?.onlyWithDues ? 'HAVING outstanding > 0.5' : ''

  const rows = await all<any>(
    `SELECT c.*,
            COUNT(s.id)                                       AS total_purchases,
            COALESCE(SUM(s.total), 0)                         AS total_spent,
            COALESCE(SUM(s.due_amount), 0)                    AS outstanding,
            MAX(s.sale_date)                                  AS last_purchase_at,
            SUM(CASE WHEN s.due_amount > 0.5 AND s.due_date IS NOT NULL
                      AND s.due_date < date('now','localtime') THEN 1 ELSE 0 END) AS overdue_count
       FROM customers c
       LEFT JOIN sales s ON s.customer_id = c.id AND s.status <> 'cancelled'
      WHERE ${where.join(' AND ')}
      GROUP BY c.id
      ${having}
      ORDER BY c.name
      LIMIT ?`,
    [...args, params?.limit ?? 500]
  )
  return rows.map(shapeCustomer)
}

export async function getCustomer(id: string) {
  requirePermission('customer.view')
  const r = await one<any>('SELECT * FROM customers WHERE id = ?', [id])
  return r ? shapeCustomer(r) : null
}

export async function saveCustomer(input: CustomerInput) {
  requirePermission('customer.manage')
  const { companyId } = requireCompany()

  const name = (input.name ?? '').trim()
  if (name.length < 2) throw new AppError('Customer name is required.', 'VALIDATION')

  const phone = normalizePhone(input.phonePrimary ?? '')
  if (!isValidPhone(phone))
    throw new AppError('Primary mobile must be a valid 10-digit Indian number.', 'VALIDATION')

  const phone2 = input.phoneSecondary ? normalizePhone(input.phoneSecondary) : ''
  if (phone2 && !isValidPhone(phone2))
    throw new AppError('Secondary mobile is not a valid 10-digit Indian number.', 'VALIDATION')
  if (phone2 && phone2 === phone)
    throw new AppError('Secondary mobile must be different from the primary.', 'VALIDATION')

  const aadhaar = input.aadhaar ? normalizeAadhaar(input.aadhaar) : ''
  if (aadhaar && !isValidAadhaar(aadhaar))
    throw new AppError('Aadhaar number is not valid (12 digits, checksum failed).', 'VALIDATION')

  const pan = input.pan ? normalizePan(input.pan) : ''
  if (pan && !isValidPan(pan)) throw new AppError('PAN is not valid (e.g. ABCDE1234F).', 'VALIDATION')

  const gstin = input.gstin ? normalizeGstin(input.gstin) : ''
  if (gstin && !isValidGstin(gstin)) throw new AppError('GSTIN is not valid.', 'VALIDATION')

  if (input.pincode && !isValidPincode(input.pincode))
    throw new AppError('PIN code must be 6 digits.', 'VALIDATION')

  if (input.state && !INDIAN_STATE_NAMES.includes(input.state))
    throw new AppError('Please pick a state from the list.', 'VALIDATION')

  const dupPhone = await one<{ id: string; name: string }>(
    'SELECT id, name FROM customers WHERE company_id = ? AND phone_primary = ? AND id <> ?',
    [companyId, phone, input.id ?? '']
  )
  if (dupPhone)
    throw new AppError(`Mobile ${phone} is already used by "${dupPhone.name}".`, 'DUPLICATE')

  if (aadhaar) {
    const dupAadhaar = await one<{ id: string; name: string }>(
      'SELECT id, name FROM customers WHERE company_id = ? AND aadhaar = ? AND id <> ?',
      [companyId, aadhaar, input.id ?? '']
    )
    if (dupAadhaar)
      throw new AppError(`This Aadhaar is already linked to "${dupAadhaar.name}".`, 'DUPLICATE')
  }

  const ts = nowIso()
  const args = [
    name,
    phone,
    nullify(phone2),
    nullify(input.email),
    nullify(aadhaar),
    nullify(pan),
    nullify(input.dob),
    nullify(input.gender),
    nullify(input.addressLine1),
    nullify(input.addressLine2),
    nullify(input.city),
    nullify(input.state),
    nullify(input.pincode),
    nullify(gstin),
    nullify(input.customerType) ?? 'Retail',
    num(input.creditLimit),
    nullify(input.notes),
    input.isActive === false ? 0 : 1,
    ts
  ]

  if (input.id) {
    await run(
      `UPDATE customers SET name=?, phone_primary=?, phone_secondary=?, email=?, aadhaar=?, pan=?,
              dob=?, gender=?, address_line1=?, address_line2=?, city=?, state=?, pincode=?, gstin=?,
              customer_type=?, credit_limit=?, notes=?, is_active=?, updated_at=? WHERE id=?`,
      [...args, input.id]
    )
    await logAudit({ action: 'customer.update', entity: 'customer', entityId: input.id, summary: name })
    return { id: input.id }
  }

  const id = newId()
  await run(
    `INSERT INTO customers (name, phone_primary, phone_secondary, email, aadhaar, pan, dob, gender,
       address_line1, address_line2, city, state, pincode, gstin, customer_type, credit_limit,
       notes, is_active, updated_at, id, company_id, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...args, id, companyId, getSession()?.user.id ?? null, ts]
  )
  await logAudit({ action: 'customer.create', entity: 'customer', entityId: id, summary: name })
  return { id }
}

/** Full 360° view used by the customer detail drawer. */
export async function customerLedger(customerId: string) {
  requirePermission('customer.view')
  const customer = await getCustomer(customerId)
  if (!customer) throw new AppError('Customer not found.', 'NOT_FOUND')

  const sales = await all<any>(
    `SELECT s.id, s.invoice_no, s.sale_date, s.total, s.paid_amount, s.due_amount, s.due_date,
            s.status, s.is_credit, sh.name AS shop_name,
            (SELECT group_concat(si.description, ' | ') FROM sale_items si WHERE si.sale_id = s.id) AS items
       FROM sales s JOIN shops sh ON sh.id = s.shop_id
      WHERE s.customer_id = ? ORDER BY s.sale_date DESC, s.created_at DESC`,
    [customerId]
  )

  const payments = await all<any>(
    `SELECT p.*, s.invoice_no FROM payments p
       LEFT JOIN sales s ON s.id = p.sale_id
      WHERE p.party_type = 'customer' AND p.party_id = ?
      ORDER BY p.payment_date DESC, p.created_at DESC`,
    [customerId]
  )

  const devices = await all<any>(
    `SELECT su.imei1, su.sold_at, su.sale_price, m.name AS model_name, b.name AS brand_name,
            s.invoice_no, su.warranty_months
       FROM stock_units su
       JOIN models m ON m.id = su.model_id
       JOIN brands b ON b.id = m.brand_id
       JOIN sales s ON s.id = su.sale_id
      WHERE s.customer_id = ? ORDER BY su.sold_at DESC`,
    [customerId]
  )

  const outstanding = sales.reduce((acc, s) => acc + num(s.due_amount), 0)

  return { customer, sales, payments, devices, outstanding }
}

/* -------------------------------------------------------------------------- */
/*  Suppliers                                                                  */
/* -------------------------------------------------------------------------- */

export interface SupplierInput {
  id?: string
  name: string
  contactPerson?: string
  phone?: string
  altPhone?: string
  email?: string
  gstin?: string
  pan?: string
  supplierType?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  pincode?: string
  openingBalance?: number
  notes?: string
  isActive?: boolean
}

export async function listSuppliers(params?: { search?: string; includeInactive?: boolean }) {
  requirePermission('supplier.view')
  const { companyId } = requireCompany()
  const args: any[] = [companyId]
  const where = ['s.company_id = ?']

  if (!params?.includeInactive) where.push('s.is_active = 1')
  if (params?.search) {
    const q = `%${params.search.trim()}%`
    where.push('(s.name LIKE ? OR s.phone LIKE ? OR s.gstin LIKE ? OR s.contact_person LIKE ?)')
    args.push(q, q, q, q)
  }

  const rows = await all<any>(
    `SELECT s.*,
            COUNT(p.id)                     AS purchase_count,
            COALESCE(SUM(p.total), 0)       AS total_purchased,
            COALESCE(SUM(p.due_amount), 0)  AS payable,
            MAX(p.purchase_date)            AS last_purchase_at
       FROM suppliers s
       LEFT JOIN purchases p ON p.supplier_id = s.id AND p.status <> 'cancelled'
      WHERE ${where.join(' AND ')}
      GROUP BY s.id ORDER BY s.name`,
    args
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    phone: r.phone,
    altPhone: r.alt_phone,
    email: r.email,
    gstin: r.gstin,
    pan: r.pan,
    supplierType: r.supplier_type,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    openingBalance: r.opening_balance,
    notes: r.notes,
    isActive: !!r.is_active,
    purchaseCount: r.purchase_count ?? 0,
    totalPurchased: r.total_purchased ?? 0,
    payable: num(r.payable) + num(r.opening_balance),
    lastPurchaseAt: r.last_purchase_at
  }))
}

export async function saveSupplier(input: SupplierInput) {
  requirePermission('supplier.manage')
  const { companyId } = requireCompany()

  const name = (input.name ?? '').trim()
  if (name.length < 2) throw new AppError('Supplier name is required.', 'VALIDATION')
  if (input.phone && !isValidPhone(input.phone))
    throw new AppError('Enter a valid 10-digit mobile number.', 'VALIDATION')
  if (input.gstin && !isValidGstin(input.gstin))
    throw new AppError('GSTIN is not valid.', 'VALIDATION')
  if (input.pan && !isValidPan(input.pan)) throw new AppError('PAN is not valid.', 'VALIDATION')
  if (input.pincode && !isValidPincode(input.pincode))
    throw new AppError('PIN code must be 6 digits.', 'VALIDATION')

  const ts = nowIso()
  const args = [
    name,
    nullify(input.contactPerson),
    nullify(input.phone && normalizePhone(input.phone)),
    nullify(input.altPhone && normalizePhone(input.altPhone)),
    nullify(input.email),
    nullify(input.gstin && normalizeGstin(input.gstin)),
    nullify(input.pan && normalizePan(input.pan)),
    nullify(input.supplierType) ?? 'Distributor',
    nullify(input.addressLine1),
    nullify(input.addressLine2),
    nullify(input.city),
    nullify(input.state),
    nullify(input.pincode),
    num(input.openingBalance),
    nullify(input.notes),
    input.isActive === false ? 0 : 1,
    ts
  ]

  if (input.id) {
    await run(
      `UPDATE suppliers SET name=?, contact_person=?, phone=?, alt_phone=?, email=?, gstin=?, pan=?,
              supplier_type=?, address_line1=?, address_line2=?, city=?, state=?, pincode=?,
              opening_balance=?, notes=?, is_active=?, updated_at=? WHERE id=?`,
      [...args, input.id]
    )
    await logAudit({ action: 'supplier.update', entity: 'supplier', entityId: input.id, summary: name })
    return { id: input.id }
  }

  const id = newId()
  await run(
    `INSERT INTO suppliers (name, contact_person, phone, alt_phone, email, gstin, pan, supplier_type,
       address_line1, address_line2, city, state, pincode, opening_balance, notes, is_active,
       updated_at, id, company_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...args, id, companyId, ts]
  )
  await logAudit({ action: 'supplier.create', entity: 'supplier', entityId: id, summary: name })
  return { id }
}

export async function countCustomers(): Promise<number> {
  const { companyId } = requireCompany()
  return (
    (await scalar<number>('SELECT COUNT(*) FROM customers WHERE company_id = ? AND is_active = 1', [
      companyId
    ])) ?? 0
  )
}
