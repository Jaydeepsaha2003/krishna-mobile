import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import { dbStatus, sync } from './db'
import { startDatabase } from './bootstrap'
import { mergeBackupIntoPrimary } from './db/salvage'
import { AppError, getSetting, setSetting, today } from './utils'
import * as auth from './services/auth'
import * as users from './services/users'
import * as org from './services/org'
import * as catalog from './services/catalog'
import * as parties from './services/parties'
import * as inventory from './services/inventory'
import * as sales from './services/sales'
import * as recon from './services/reconciliation'
import * as loans from './services/loans'
import * as importAccess from './services/importAccess'
import * as servicesCatalog from './services/servicesCatalog'
import * as reports from './services/reports'
import * as notifications from './services/notifications'
import * as audit from './services/audit'
import { getSession, requireCompany, requirePermission } from './services/session'
import {
  checkForUpdates,
  currentVersion,
  getUpdateState,
  installNow
} from './updater'
import { DEFAULT_RECON_REASONS, FEATURES, INDIAN_STATES } from '../shared/constants'

type Handler = (payload: any, event: Electron.IpcMainInvokeEvent) => unknown | Promise<unknown>

const handlers: Record<string, Handler> = {
  /* ---------------------------------------------------------------- system */
  'app:info': () => ({
    version: currentVersion(),
    name: app.getName(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    db: dbStatus()
  }),
  'app:reference': () => ({
    states: INDIAN_STATES,
    reconReasons: DEFAULT_RECON_REASONS
  }),
  'app:sync': () => sync(),
  'app:reconnect': () => startDatabase(),

  /* ---------------------------------------------------- backup recovery */
  'recovery:pickFile': async (_p, event) => {
    requirePermission('record.delete')
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose the database backup file',
      defaultPath: app.getPath('userData'),
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'Database backup', extensions: ['db', 'db-wal', 'salvaged', '*'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled || !filePaths.length) return { filePath: null }
    return { filePath: filePaths[0] }
  },
  'recovery:run': async ({ filePath }: any) => {
    requirePermission('record.delete')
    const result = await mergeBackupIntoPrimary(filePath)
    // Pull the recovered rows into this machine's read replica immediately.
    await sync()
    await audit.logAudit({
      action: 'data.recover',
      entity: 'database',
      summary: `Recovered from backup: ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed`
    })
    return result
  },
  'app:openLogs': () => shell.openPath(log.transports.file.getFile().path),
  'app:logError': (payload: any) => {
    log.error('[renderer]', payload?.message, payload?.stack ?? '', payload?.componentStack ?? '')
  },
  'app:openExternal': ({ url }: { url: string }) => shell.openExternal(url),

  'window:minimize': (_p, e) => BrowserWindow.fromWebContents(e.sender)?.minimize(),
  'window:maximize': (_p, e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
    return win.isMaximized()
  },
  'window:close': (_p, e) => BrowserWindow.fromWebContents(e.sender)?.close(),
  'window:isMaximized': (_p, e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false,

  /* ---------------------------------------------------------------- updater */
  'updater:state': () => getUpdateState(),
  'updater:check': () => checkForUpdates(true),
  'updater:install': () => installNow(false),

  /* ------------------------------------------------------------------- auth */
  'auth:users': () => auth.listLoginUsers(),
  'auth:login': ({ userId, pin }: any) => auth.login(userId, pin),
  'auth:logout': () => auth.logout(),
  'auth:session': () => getSession(),
  'auth:changePin': ({ currentPin, newPin }: any) => auth.changeOwnPin(currentPin, newPin),
  'auth:switchScope': ({ companyId, shopId }: any) => auth.switchScope(companyId, shopId),

  /* ------------------------------------------------------------------ users */
  'users:list': () => users.listUsers(),
  'users:save': (input: any) => users.saveUser(input),
  'users:setPin': ({ userId, pin, mustChange }: any) => users.setPin(userId, pin, mustChange),
  'users:setActive': ({ userId, active }: any) => users.setUserActive(userId, active),
  'users:unlock': ({ userId }: any) => users.unlockUser(userId),

  /* -------------------------------------------------------- companies/shops */
  'companies:list': ({ includeInactive }: any = {}) => org.listCompanies(includeInactive),
  'companies:save': (input: any) => org.saveCompany(input),
  'shops:list': ({ companyId, includeInactive }: any = {}) =>
    org.listShops(companyId, includeInactive),
  'shops:save': (input: any) => org.saveShop(input),
  'shops:setActive': ({ shopId, active }: any) => org.setShopActive(shopId, active),

  /* ---------------------------------------------------------------- catalog */
  'brands:list': ({ includeInactive }: any = {}) => catalog.listBrands(includeInactive),
  'brands:save': (input: any) => catalog.saveBrand(input),
  'brands:delete': ({ id }: any) => catalog.deleteBrand(id),
  'models:list': (params: any = {}) => catalog.listModels(params),
  'models:save': (input: any) => catalog.saveModel(input),
  'models:delete': ({ id }: any) => catalog.deleteModel(id),
  'models:quickCreate': ({ brandName, modelName }: any) =>
    catalog.quickCreateModel(brandName, modelName),

  /* ---------------------------------------------------------------- parties */
  'customers:list': (params: any = {}) => parties.listCustomers(params),
  'customers:get': ({ id }: any) => parties.getCustomer(id),
  'customers:save': (input: any) => parties.saveCustomer(input),
  'customers:ledger': ({ id }: any) => parties.customerLedger(id),
  'suppliers:list': (params: any = {}) => parties.listSuppliers(params),
  'suppliers:save': (input: any) => parties.saveSupplier(input),

  /* -------------------------------------------------------------- inventory */
  'stock:list': (filter: any = {}) => inventory.listStock(filter),
  'stock:byImei': ({ imei }: any) => inventory.findByImei(imei),
  'stock:available': ({ shopId, search, limit }: any) =>
    inventory.availableStock(shopId, search, limit),
  'stock:availableModels': ({ shopId, search, limit, includeImei }: any) =>
    inventory.availableModels(shopId, search, limit, includeImei),
  'stock:summary': ({ shopId }: any = {}) => inventory.stockSummary(shopId),
  'stock:adjust': (input: any) => inventory.adjustStock(input),
  'stock:addManual': (input: any) => inventory.addManualStock(input),
  'stock:removeManual': (input: any) => inventory.removeManualStock(input),
  'stock:adjustments': (params: any = {}) => inventory.listAdjustments(params),

  'purchases:create': (input: any) => inventory.createPurchase(input),
  'purchases:list': (params: any = {}) => inventory.listPurchases(params),
  'purchases:get': ({ id }: any) => inventory.getPurchase(id),
  'purchases:delete': ({ purchaseId, reason }: any) => inventory.deletePurchase(purchaseId, reason),

  'transfers:create': (input: any) => inventory.createTransfer(input),
  'transfers:createByModel': (input: any) => inventory.createTransferByModel(input),
  'transfers:receive': ({ transferId, stockUnitIds }: any) =>
    inventory.receiveTransfer(transferId, stockUnitIds),
  'transfers:cancel': ({ transferId, reason }: any) =>
    inventory.cancelTransfer(transferId, reason),
  'transfers:list': (params: any = {}) => inventory.listTransfers(params),
  'transfers:get': ({ id }: any) => inventory.getTransfer(id),

  /* ------------------------------------------------------------------ sales */
  'sales:create': (input: any) => sales.createSale(input),
  'sales:list': (filter: any = {}) => sales.listSales(filter),
  'sales:get': ({ id }: any) => sales.getSale(id),
  'sales:cancel': ({ saleId, reason }: any) => sales.cancelSale(saleId, reason),
  'sales:delete': ({ saleId, reason }: any) => sales.deleteSale(saleId, reason),
  'sales:recordPayment': (input: any) => sales.recordPayment(input),
  'sales:creditBook': (params: any = {}) => sales.creditBook(params),
  'purchases:recordPayment': (input: any) => sales.recordSupplierPayment(input),

  /* ---------------------------------------------------------- services */
  'services:list': (params: any = {}) => servicesCatalog.listServices(params),
  'services:save': (input: any) => servicesCatalog.saveService(input),
  'services:delete': ({ id }: any) => servicesCatalog.deleteServiceEntry(id),

  /* --------------------------------------------------------- reconciliation */
  'recon:preview': (params: any) => recon.computeExpected(params),
  'recon:create': (input: any) => recon.createReconciliation(input),
  'recon:list': (params: any = {}) => recon.listReconciliations(params),
  'recon:get': ({ id }: any) => recon.getReconciliation(id),
  'recon:updateItem': (input: any) => recon.updateReconItem(input),
  'recon:acceptAll': ({ id }: any) => recon.acceptAllExpected(id),
  'recon:units': ({ reconciliationId, modelId }: any) =>
    recon.unitsForReconItem(reconciliationId, modelId),
  'recon:finalize': ({ id }: any) => recon.finalizeReconciliation(id),
  'recon:delete': ({ id }: any) => recon.deleteReconciliation(id),
  'recon:reasons': ({ includeInactive }: any = {}) => recon.listReasons(includeInactive),
  'recon:saveReason': (input: any) => recon.saveReason(input),

  /* ------------------------------------------------------------- EMI loans */
  'loans:create': (input: any) => loans.createLoan(input),
  'loans:list': (filter: any = {}) => loans.listLoans(filter),
  'loans:get': ({ id }: any) => loans.getLoan(id),
  'loans:search': ({ search, onlyActive }: any = {}) => loans.searchLoans(search, onlyActive),
  'loans:repay': (input: any) => loans.recordRepayment(input),
  'loans:foreclose': (input: any) => loans.forecloseLoan(input),
  'loans:cancel': ({ loanId, reason }: any) => loans.cancelLoan(loanId, reason),
  'loans:analysis': (params: any) => loans.loanAnalysis(params),
  'loans:analysisGrid': (params: any) => loans.loanAnalysisGrid(params),

  /* ------------------------------------------------------- data import */
  'import:pickAccessFile': async (_p, event) => {
    if (!FEATURES.dataImport) throw new AppError('Data import is not available in this version.', 'LOCKED')
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select the old Access database',
      properties: ['openFile'],
      filters: [
        { name: 'Access database', extensions: ['accdb', 'mdb'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled || !filePaths.length) return { filePath: null }
    return { filePath: filePaths[0] }
  },
  'import:previewAccess': ({ filePath }: any) => {
    if (!FEATURES.dataImport) throw new AppError('Data import is not available in this version.', 'LOCKED')
    return importAccess.previewAccessImport({ filePath })
  },
  'import:runAccess': ({ filePath, shopId }: any) => {
    if (!FEATURES.dataImport) throw new AppError('Data import is not available in this version.', 'LOCKED')
    return importAccess.runAccessImport({ filePath, shopId })
  },

  /* ---------------------------------------------------------------- reports */
  'reports:dashboard': (params: any = {}) => reports.dashboard(params),
  'reports:trend': (params: any) => reports.salesTrend(params),
  'reports:shopPnl': (params: any) => reports.shopPnl(params),
  'reports:unitProfit': (params: any) => reports.unitProfit(params),
  'reports:models': (params: any) => reports.modelPerformance(params),
  'reports:brands': (params: any) => reports.brandShare(params),
  'reports:payments': (params: any) => reports.paymentMix(params),
  'reports:staff': (params: any) => reports.staffPerformance(params),
  'reports:ageing': (params: any = {}) => reports.ageingStock(params),
  'reports:gst': (params: any) => reports.gstSummary(params),
  'reports:overview': (params: any) => reports.companyOverview(params),

  /* ---------------------------------------------------------- notifications */
  'notifications:list': (params: any = {}) => {
    const { companyId } = requireCompany()
    return notifications.list(companyId, params)
  },
  'notifications:unreadCount': () => {
    const { companyId } = requireCompany()
    return notifications.unreadCount(companyId)
  },
  'notifications:markRead': ({ ids }: any) => notifications.markRead(ids),
  'notifications:markAllRead': () => {
    const { companyId } = requireCompany()
    return notifications.markAllRead(companyId)
  },
  'notifications:scan': async () => {
    const { companyId } = requireCompany()
    const created = await notifications.scan(companyId)
    await notifications.deliverDesktop(companyId)
    return { created }
  },

  /* ------------------------------------------------------------------ audit */
  'audit:list': (params: any) => audit.listAudit(params),

  /* --------------------------------------------------------------- settings */
  'settings:get': async ({ key, fallback }: any) => getSetting(key, fallback),
  'settings:set': ({ key, value }: any) => setSetting(key, value),

  /* ---------------------------------------------------------------- exports */
  'export:csv': async ({ filename, csv }: { filename: string; csv: string }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save as CSV',
      defaultPath: `${filename}-${today()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { saved: false }
    // BOM keeps ₹ and Indian names readable when opened in Excel.
    await writeFile(filePath, `﻿${csv}`, 'utf8')
    return { saved: true, filePath }
  },

  'export:pdf': async ({ filename, html }: { filename: string; html: string }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save as PDF',
      defaultPath: `${filename}-${today()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { saved: false }

    const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
      })
      await writeFile(filePath, pdf)
      return { saved: true, filePath }
    } finally {
      printWin.destroy()
    }
  },

  'print:html': async ({ html }: { html: string }) => {
    const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return new Promise((resolve) => {
      printWin.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        printWin.destroy()
        resolve({ success, reason })
      })
    })
  },

  'file:reveal': ({ filePath }: any) => shell.showItemInFolder(filePath)
}

export function registerIpc(): void {
  ipcMain.handle('api', async (event, channel: string, payload: any) => {
    const handler = handlers[channel]
    if (!handler) {
      return { ok: false, error: { message: `Unknown request "${channel}"`, code: 'NO_HANDLER' } }
    }
    try {
      const data = await handler(payload ?? {}, event)
      return { ok: true, data: data === undefined ? null : data }
    } catch (err: any) {
      const code = err instanceof AppError ? err.code : 'ERROR'
      if (code === 'ERROR') log.error(`[ipc] ${channel} failed`, err)
      else log.warn(`[ipc] ${channel}: ${err.message}`)
      return {
        ok: false,
        error: { message: err?.message ?? 'Something went wrong.', code }
      }
    }
  })
}
