import { app, BrowserWindow, dialog } from 'electron'
import log from 'electron-log/main'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import { config } from './env'

const { autoUpdater } = electronUpdater

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes?: string; releaseDate?: string }
  | { status: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { status: 'ready'; version: string }
  | { status: 'none'; currentVersion: string }
  | { status: 'error'; message: string }

let state: UpdateState = { status: 'idle' }
let timer: NodeJS.Timeout | null = null
let quittingForUpdate = false

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:state', state)
  }
}

function setState(next: UpdateState): void {
  state = next
  broadcast()
}

export function getUpdateState(): UpdateState {
  return state
}

export function currentVersion(): string {
  return app.getVersion()
}

export function initUpdater(): void {
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  // We install on our own terms so the user is never interrupted mid-bill.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  const feed = config.updateFeedUrl
  if (feed && !feed.includes('example.com')) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed, channel: 'latest' })
  }

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('[updater] update available', info.version)
    setState({
      status: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseDate: info.releaseDate
    })
  })

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'none', currentVersion: app.getVersion() })
  })

  autoUpdater.on('download-progress', (p) => {
    setState({
      status: 'downloading',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', async (info: UpdateInfo) => {
    log.info('[updater] downloaded', info.version)
    setState({ status: 'ready', version: info.version })

    if (config.updateMode === 'auto') {
      // Give the cashier a moment to finish what is on screen, then relaunch.
      setTimeout(() => void installNow(true), 20_000)
    } else {
      const win = BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win!, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: `Krishna Mobile ${info.version} is ready to install.`,
        detail: 'The app will close and reopen. Any unsaved bill should be completed first.'
      })
      if (result.response === 0) void installNow(false)
    }
  })

  autoUpdater.on('error', (err) => {
    log.warn('[updater] error', err)
    setState({ status: 'error', message: err?.message ?? String(err) })
  })
}

export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!app.isPackaged && !process.env.FORCE_UPDATE_CHECK) {
    setState({ status: 'none', currentVersion: app.getVersion() })
    return state
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err: any) {
    setState({ status: 'error', message: err?.message ?? String(err) })
    if (manual) log.warn('[updater] manual check failed', err)
  }
  return state
}

/**
 * Quits and relaunches into the new version. `silent` installs without showing
 * the NSIS wizard; `isForceRunAfter` brings the app straight back up.
 */
export async function installNow(silent: boolean): Promise<void> {
  if (quittingForUpdate) return
  quittingForUpdate = true
  log.info('[updater] installing and restarting')
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updater:restarting')
  // Let the renderer flush and the DB close cleanly.
  setTimeout(() => autoUpdater.quitAndInstall(silent, true), 600)
}

export function startUpdateSchedule(): void {
  if (timer) return
  const minutes = config.updateCheckIntervalMinutes
  setTimeout(() => void checkForUpdates(), 30_000)
  timer = setInterval(() => void checkForUpdates(), minutes * 60 * 1000)
}

export function stopUpdateSchedule(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}
