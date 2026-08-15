import { toast } from 'sonner'

export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

/**
 * Calls the main process and unwraps `{ ok, data | error }`.
 * Throws an ApiError so React Query / try-catch handle failures naturally.
 */
export async function call<T = any>(channel: string, payload?: unknown): Promise<T> {
  const res = await window.api.invoke<T>(channel, payload)
  if (!res.ok) throw new ApiError(res.error?.message ?? 'Request failed', res.error?.code ?? 'ERROR')
  return res.data as T
}

/** Fire-and-forget variant that surfaces failures as a toast. */
export async function callSafe<T = any>(channel: string, payload?: unknown): Promise<T | null> {
  try {
    return await call<T>(channel, payload)
  } catch (err: any) {
    toast.error(err.message ?? 'Something went wrong')
    return null
  }
}

export const api = {
  app: {
    info: () => call('app:info'),
    reference: () => call('app:reference'),
    sync: () => call('app:sync'),
    reconnect: () => call<{ ok: boolean; error?: string }>('app:reconnect'),
    openLogs: () => call('app:openLogs'),
    pickBackupFile: () => call<{ filePath: string | null }>('recovery:pickFile'),
    recoverFromBackup: (filePath: string) =>
      call<{ inserted: number; updated: number; failed: number; details: string[] }>(
        'recovery:run',
        { filePath }
      ),
    openExternal: (url: string) => call('app:openExternal', { url })
  },
  window: {
    minimize: () => call('window:minimize'),
    maximize: () => call<boolean>('window:maximize'),
    close: () => call('window:close'),
    isMaximized: () => call<boolean>('window:isMaximized')
  },
  updater: {
    state: () => call('updater:state'),
    check: () => call('updater:check'),
    install: () => call('updater:install')
  },
  auth: {
    users: () => call('auth:users'),
    login: (userId: string, pin: string) => call('auth:login', { userId, pin }),
    logout: () => call('auth:logout'),
    session: () => call('auth:session'),
    changePin: (currentPin: string, newPin: string) =>
      call('auth:changePin', { currentPin, newPin }),
    switchScope: (companyId: string | null, shopId: string | null) =>
      call('auth:switchScope', { companyId, shopId })
  },
  users: {
    list: () => call('users:list'),
    save: (input: any) => call('users:save', input),
    setPin: (userId: string, pin: string, mustChange = false) =>
      call('users:setPin', { userId, pin, mustChange }),
    setActive: (userId: string, active: boolean) => call('users:setActive', { userId, active }),
    unlock: (userId: string) => call('users:unlock', { userId })
  },
  companies: {
    list: (includeInactive = false) => call('companies:list', { includeInactive }),
    save: (input: any) => call('companies:save', input)
  },
  shops: {
    list: (companyId?: string, includeInactive = false) =>
      call('shops:list', { companyId, includeInactive }),
    save: (input: any) => call('shops:save', input),
    setActive: (shopId: string, active: boolean) => call('shops:setActive', { shopId, active })
  },
  brands: {
    list: (includeInactive = false) => call('brands:list', { includeInactive }),
    save: (input: any) => call('brands:save', input),
    remove: (id: string) =>
      call<{ archived: boolean; name: string; modelCount: number }>('brands:delete', { id })
  },
  models: {
    list: (params: any = {}) => call('models:list', params),
    save: (input: any) => call('models:save', input),
    remove: (id: string) =>
      call<{ archived: boolean; name: string; refs: number }>('models:delete', { id }),
    quickCreate: (brandName: string, modelName: string) =>
      call('models:quickCreate', { brandName, modelName })
  },
  customers: {
    list: (params: any = {}) => call('customers:list', params),
    get: (id: string) => call('customers:get', { id }),
    save: (input: any) => call('customers:save', input),
    ledger: (id: string) => call('customers:ledger', { id })
  },
  suppliers: {
    list: (params: any = {}) => call('suppliers:list', params),
    save: (input: any) => call('suppliers:save', input)
  },
  stock: {
    list: (filter: any = {}) => call('stock:list', filter),
    byImei: (imei: string) => call('stock:byImei', { imei }),
    available: (shopId: string, search?: string, limit?: number) =>
      call('stock:available', { shopId, search, limit }),
    availableModels: (shopId: string, search?: string, limit?: number, includeImei?: boolean) =>
      call('stock:availableModels', { shopId, search, limit, includeImei }),
    summary: (shopId?: string) => call('stock:summary', { shopId }),
    adjust: (input: any) => call('stock:adjust', input),
    addManual: (input: any) => call('stock:addManual', input),
    removeManual: (input: any) => call('stock:removeManual', input),
    editUnit: (input: any) => call('stock:editUnit', input),
    editModel: (input: any) => call('stock:editModel', input),
    lots: (input: any) => call('stock:lots', input),
    editLot: (input: any) => call('stock:editLot', input),
    adjustments: (params: any = {}) => call('stock:adjustments', params)
  },
  purchases: {
    create: (input: any) => call('purchases:create', input),
    list: (params: any = {}) => call('purchases:list', params),
    get: (id: string) => call('purchases:get', { id }),
    remove: (purchaseId: string, reason?: string) => call('purchases:delete', { purchaseId, reason }),
    recordPayment: (input: any) => call('purchases:recordPayment', input)
  },
  transfers: {
    create: (input: any) => call('transfers:create', input),
    createByModel: (input: any) => call('transfers:createByModel', input),
    receive: (transferId: string, stockUnitIds?: string[]) =>
      call('transfers:receive', { transferId, stockUnitIds }),
    cancel: (transferId: string, reason: string) => call('transfers:cancel', { transferId, reason }),
    list: (params: any = {}) => call('transfers:list', params),
    get: (id: string) => call('transfers:get', { id })
  },
  sales: {
    create: (input: any) => call('sales:create', input),
    list: (filter: any = {}) => call('sales:list', filter),
    get: (id: string) => call('sales:get', { id }),
    cancel: (saleId: string, reason: string) => call('sales:cancel', { saleId, reason }),
    remove: (saleId: string, reason?: string) => call('sales:delete', { saleId, reason }),
    recordPayment: (input: any) => call('sales:recordPayment', input),
    creditBook: (params: any = {}) => call('sales:creditBook', params)
  },
  services: {
    list: (params: any = {}) => call('services:list', params),
    save: (input: any) => call('services:save', input),
    remove: (id: string) => call('services:delete', { id })
  },
  recon: {
    preview: (params: any) => call('recon:preview', params),
    create: (input: any) => call('recon:create', input),
    list: (params: any = {}) => call('recon:list', params),
    get: (id: string) => call('recon:get', { id }),
    updateItem: (input: any) => call('recon:updateItem', input),
    acceptAll: (id: string) => call('recon:acceptAll', { id }),
    units: (reconciliationId: string, modelId: string) =>
      call('recon:units', { reconciliationId, modelId }),
    finalize: (id: string) => call('recon:finalize', { id }),
    remove: (id: string) => call('recon:delete', { id }),
    reasons: (includeInactive = false) => call('recon:reasons', { includeInactive }),
    saveReason: (input: any) => call('recon:saveReason', input)
  },
  loans: {
    create: (input: any) => call('loans:create', input),
    list: (filter: any = {}) => call('loans:list', filter),
    get: (id: string) => call('loans:get', { id }),
    search: (search: string, onlyActive = true) => call('loans:search', { search, onlyActive }),
    repay: (input: any) => call('loans:repay', input),
    foreclose: (input: any) => call('loans:foreclose', input),
    cancel: (loanId: string, reason: string) => call('loans:cancel', { loanId, reason }),
    analysis: (params: any) => call('loans:analysis', params),
    analysisGrid: (params: any) => call('loans:analysisGrid', params)
  },
  reports: {
    dashboard: (params: any = {}) => call('reports:dashboard', params),
    trend: (params: any) => call('reports:trend', params),
    shopPnl: (params: any) => call('reports:shopPnl', params),
    unitProfit: (params: any) => call('reports:unitProfit', params),
    models: (params: any) => call('reports:models', params),
    brands: (params: any) => call('reports:brands', params),
    payments: (params: any) => call('reports:payments', params),
    staff: (params: any) => call('reports:staff', params),
    ageing: (params: any = {}) => call('reports:ageing', params),
    gst: (params: any) => call('reports:gst', params),
    overview: (params: any) => call('reports:overview', params)
  },
  notifications: {
    list: (params: any = {}) => call('notifications:list', params),
    unreadCount: () => call<number>('notifications:unreadCount'),
    markRead: (ids: string[]) => call('notifications:markRead', { ids }),
    markAllRead: () => call('notifications:markAllRead'),
    scan: () => call('notifications:scan')
  },
  audit: {
    list: (params: any) => call('audit:list', params)
  },
  import: {
    pickAccessFile: () => call<{ filePath: string | null }>('import:pickAccessFile'),
    previewAccess: (filePath: string) => call('import:previewAccess', { filePath }),
    runAccess: (filePath: string, shopId?: string) => call('import:runAccess', { filePath, shopId })
  },
  settings: {
    get: <T>(key: string, fallback: T) => call<T>('settings:get', { key, fallback }),
    set: (key: string, value: unknown) => call('settings:set', { key, value })
  },
  files: {
    exportCsv: (filename: string, csv: string) => call('export:csv', { filename, csv }),
    exportPdf: (filename: string, html: string) => call('export:pdf', { filename, html }),
    print: (html: string) => call('print:html', { html }),
    reveal: (filePath: string) => call('file:reveal', { filePath })
  }
}
