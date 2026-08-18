/**
 * Shared, dependency-free constants used by both the Electron main process and
 * the React renderer. Keep this file free of any Node/DOM imports.
 */

/* -------------------------------------------------------------------------- */
/*  India — States & Union Territories (with GST state codes)                  */
/* -------------------------------------------------------------------------- */

export interface IndianState {
  code: string // GST state code
  name: string
  type: 'state' | 'ut'
}

export const INDIAN_STATES: IndianState[] = [
  { code: '35', name: 'Andaman and Nicobar Islands', type: 'ut' },
  { code: '37', name: 'Andhra Pradesh', type: 'state' },
  { code: '12', name: 'Arunachal Pradesh', type: 'state' },
  { code: '18', name: 'Assam', type: 'state' },
  { code: '10', name: 'Bihar', type: 'state' },
  { code: '04', name: 'Chandigarh', type: 'ut' },
  { code: '22', name: 'Chhattisgarh', type: 'state' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', type: 'ut' },
  { code: '07', name: 'Delhi', type: 'ut' },
  { code: '30', name: 'Goa', type: 'state' },
  { code: '24', name: 'Gujarat', type: 'state' },
  { code: '06', name: 'Haryana', type: 'state' },
  { code: '02', name: 'Himachal Pradesh', type: 'state' },
  { code: '01', name: 'Jammu and Kashmir', type: 'ut' },
  { code: '20', name: 'Jharkhand', type: 'state' },
  { code: '29', name: 'Karnataka', type: 'state' },
  { code: '32', name: 'Kerala', type: 'state' },
  { code: '38', name: 'Ladakh', type: 'ut' },
  { code: '31', name: 'Lakshadweep', type: 'ut' },
  { code: '23', name: 'Madhya Pradesh', type: 'state' },
  { code: '27', name: 'Maharashtra', type: 'state' },
  { code: '14', name: 'Manipur', type: 'state' },
  { code: '17', name: 'Meghalaya', type: 'state' },
  { code: '15', name: 'Mizoram', type: 'state' },
  { code: '13', name: 'Nagaland', type: 'state' },
  { code: '21', name: 'Odisha', type: 'state' },
  { code: '34', name: 'Puducherry', type: 'ut' },
  { code: '03', name: 'Punjab', type: 'state' },
  { code: '08', name: 'Rajasthan', type: 'state' },
  { code: '11', name: 'Sikkim', type: 'state' },
  { code: '33', name: 'Tamil Nadu', type: 'state' },
  { code: '36', name: 'Telangana', type: 'state' },
  { code: '16', name: 'Tripura', type: 'state' },
  { code: '09', name: 'Uttar Pradesh', type: 'state' },
  { code: '05', name: 'Uttarakhand', type: 'state' },
  { code: '19', name: 'West Bengal', type: 'state' }
]

export const INDIAN_STATE_NAMES = INDIAN_STATES.map((s) => s.name)

export function gstStateCode(stateName?: string | null): string | null {
  if (!stateName) return null
  return INDIAN_STATES.find((s) => s.name === stateName)?.code ?? null
}

/* -------------------------------------------------------------------------- */
/*  Roles & permissions                                                        */
/* -------------------------------------------------------------------------- */

export const PERMISSIONS = {
  // Masters
  'company.view': 'View companies',
  'company.manage': 'Create / edit companies',
  'shop.view': 'View shops',
  'shop.manage': 'Create / edit shops',
  'user.view': 'View users',
  'user.manage': 'Create / edit users & reset PINs',
  'customer.view': 'View customers',
  'customer.manage': 'Create / edit customers',
  'supplier.view': 'View suppliers',
  'supplier.manage': 'Create / edit suppliers',
  'product.view': 'View brands & models',
  'product.manage': 'Create / edit brands & models',
  // Operations
  'purchase.view': 'View purchases',
  'purchase.manage': 'Record / edit purchases',
  'sale.view': 'View sales',
  'sale.manage': 'Record / edit sales',
  'sale.credit': 'Sell on credit',
  'sale.discount': 'Apply discounts',
  'transfer.view': 'View stock transfers',
  'transfer.manage': 'Create / receive stock transfers',
  'payment.manage': 'Record payments & credit receipts',
  'stock.view': 'View stock',
  'stock.adjust': 'Add stock by hand (opening stock / cash buy)',
  // Deliberately NOT granted to any role below admin: removing stock or
  // deleting a bill/product destroys records, so it stays with the owner.
  // Managers can still record, correct and cancel — just not delete.
  'record.delete': 'Delete bills & products, and remove stock',
  'reconciliation.view': 'View reconciliations',
  'reconciliation.manage': 'Run & finalise reconciliations',
  'loan.view': 'View EMI loans',
  'loan.manage': 'Create / edit EMI loans',
  'loan.repayment': 'Record EMI repayments',
  'loan.foreclose': 'Foreclose / write off EMI loans',
  // Insight
  'report.view': 'View reports',
  'report.profit': 'View cost price & profit figures',
  'audit.view': 'View audit trail',
  'settings.manage': 'Change application settings'
} as const

export type Permission = keyof typeof PERMISSIONS

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export type Role = 'admin' | 'manager' | 'cashier' | 'viewer' | 'custom'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Shop Manager',
  cashier: 'Cashier / Salesperson',
  viewer: 'Read only',
  custom: 'Custom'
}

export const ROLE_PERMISSIONS: Record<Exclude<Role, 'custom'>, Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: [
    'company.view',
    'shop.view',
    'user.view',
    'customer.view',
    'customer.manage',
    'supplier.view',
    'supplier.manage',
    'product.view',
    'product.manage',
    'purchase.view',
    'purchase.manage',
    'sale.view',
    'sale.manage',
    'sale.credit',
    'sale.discount',
    'transfer.view',
    'transfer.manage',
    'payment.manage',
    'stock.view',
    'stock.adjust',
    'reconciliation.view',
    'reconciliation.manage',
    'loan.view',
    'loan.manage',
    'loan.repayment',
    'loan.foreclose',
    'report.view'
    // NOTE: 'report.profit' is intentionally NOT granted to managers — cost
    // price, margin and profit figures are visible to admins only.
  ],
  cashier: [
    'company.view',
    'shop.view',
    'customer.view',
    'customer.manage',
    'product.view',
    'sale.view',
    'sale.manage',
    'payment.manage',
    'stock.view',
    'transfer.view',
    'loan.view',
    'loan.manage',
    'loan.repayment',
    'report.view'
  ],
  viewer: [
    'company.view',
    'shop.view',
    'customer.view',
    'supplier.view',
    'product.view',
    'purchase.view',
    'sale.view',
    'transfer.view',
    'stock.view',
    'reconciliation.view',
    'loan.view',
    'report.view'
  ]
}

/* -------------------------------------------------------------------------- */
/*  Domain enums                                                               */
/* -------------------------------------------------------------------------- */

export const PAYMENT_MODES = [
  'Cash',
  'UPI',
  'Card',
  'Bank Transfer',
  'Cheque',
  'EMI / Finance',
  'Wallet',
  'Credit (Udhaar)'
] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export const STOCK_STATUSES = [
  'in_stock',
  'in_transit',
  'sold',
  'returned_to_supplier',
  'damaged',
  'lost',
  'reserved'
] as const
export type StockStatus = (typeof STOCK_STATUSES)[number]

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  in_stock: 'In stock',
  in_transit: 'In transit',
  sold: 'Sold',
  returned_to_supplier: 'Returned to supplier',
  damaged: 'Damaged',
  lost: 'Lost / missing',
  reserved: 'Reserved'
}

export const TRANSFER_STATUSES = ['draft', 'in_transit', 'received', 'cancelled'] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const SALE_STATUSES = ['completed', 'partially_paid', 'unpaid', 'cancelled', 'returned'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const CONDITIONS = ['New', 'Open Box', 'Refurbished', 'Second Hand', 'Exchange'] as const

/* -------------------------------------------------------------------------- */
/*  Consumer EMI loans                                                         */
/* -------------------------------------------------------------------------- */

export const LOAN_STATUSES = ['ACTIVE', 'CLOSED', 'FORECLOSED', 'CANCELLED'] as const
export type LoanStatus = (typeof LOAN_STATUSES)[number]

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  FORECLOSED: 'Foreclosed',
  CANCELLED: 'Cancelled'
}

export const EMI_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'FORECLOSED', 'WAIVED'] as const
export type EmiStatus = (typeof EMI_STATUSES)[number]

export const EMI_STATUS_LABELS: Record<EmiStatus, string> = {
  PENDING: 'Pending',
  PARTIAL: 'Partially paid',
  PAID: 'Paid',
  FORECLOSED: 'Foreclosed',
  WAIVED: 'Waived'
}

export const LOAN_TENURE_PRESETS = [3, 6, 9, 12, 18, 24] as const

/** Settings-table key holding the shop-wide default late-payment penalty. */
export const SETTING_DEFAULT_PENALTY = 'loan.defaultPenaltyAmount'

/**
 * What the shop actually earns on a recharge, as a % of the recharge amount.
 *
 * A recharge is not a goods sale: the customer hands over (say) ₹500 and almost
 * all of it goes to the operator — the shop keeps a small commission. Without
 * this the whole ₹500 counted as profit and wildly overstated earnings, so the
 * cost of a recharge line is recorded as amount × (1 − commission%).
 *
 * A percentage (rather than a flat rupee amount) tracks real operator payout
 * structures, which are themselves a cut of the recharge value.
 */
export const SETTING_RECHARGE_COMMISSION_PCT = 'sale.rechargeCommissionPercent'
export const DEFAULT_RECHARGE_COMMISSION_PCT = 2

/* -------------------------------------------------------------------------- */
/*  Reconciliation — default shortage / excess reasons                         */
/* -------------------------------------------------------------------------- */

export interface ReconReason {
  code: string
  label: string
  direction: 'shortage' | 'excess' | 'both'
}

export const DEFAULT_RECON_REASONS: ReconReason[] = [
  { code: 'THEFT', label: 'Theft / Shoplifting', direction: 'shortage' },
  { code: 'DAMAGE', label: 'Damaged in handling', direction: 'shortage' },
  { code: 'UNRECORDED_SALE', label: 'Sale not entered in software', direction: 'shortage' },
  { code: 'UNRECORDED_TRANSFER', label: 'Transfer to other shop not entered', direction: 'shortage' },
  { code: 'DEMO_PIECE', label: 'Issued as demo / display piece', direction: 'shortage' },
  { code: 'SERVICE_CENTRE', label: 'Sent to service centre / warranty claim', direction: 'shortage' },
  { code: 'STAFF_ISSUE', label: 'Given to staff / personal use', direction: 'shortage' },
  { code: 'RETURNED_TO_SUPPLIER', label: 'Returned to supplier, not entered', direction: 'shortage' },
  { code: 'MISPLACED', label: 'Misplaced in store', direction: 'shortage' },
  { code: 'WRONG_IMEI', label: 'Wrong IMEI / SKU entered at purchase', direction: 'both' },
  { code: 'COUNTING_ERROR', label: 'Physical counting error', direction: 'both' },
  { code: 'DATA_ENTRY_ERROR', label: 'Data entry error', direction: 'both' },
  { code: 'UNRECORDED_PURCHASE', label: 'Purchase not entered in software', direction: 'excess' },
  { code: 'CUSTOMER_RETURN', label: 'Customer return not entered', direction: 'excess' },
  { code: 'TRANSFER_IN_MISSED', label: 'Transfer received but not entered', direction: 'excess' },
  { code: 'OTHER', label: 'Other (specify)', direction: 'both' }
]

/* -------------------------------------------------------------------------- */
/*  Misc                                                                       */
/* -------------------------------------------------------------------------- */

export const GST_RATES = [0, 3, 5, 12, 18, 28] as const

export const PIN_LENGTH = 6

export const CURRENCY = '₹'

export const APP_NAME = 'Krishna Mobile'

/* -------------------------------------------------------------------------- */
/*  Feature flags                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Toggles for features that are built but not yet released to shops. Flip a flag
 * to `true` to unlock everywhere (nav, routes, reports, settings) in one place.
 *
 * `emiLoans` — the consumer-EMI module is complete but held back for a later,
 * polished release; while it is `false` the menus show as a locked "Upgrade"
 * teaser and the screens are unreachable.
 */
export const FEATURES = {
  emiLoans: false,
  /** The old MS Access importer — held back on this release. */
  dataImport: false
} as const
