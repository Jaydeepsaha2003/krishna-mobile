import { app, BrowserWindow, shell, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import log from 'electron-log/main'
import { loadEnv } from './env'
import { close as closeDb } from './db'
import { startDatabase } from './bootstrap'
import { registerIpc } from './ipc'
import { initUpdater, isQuittingForUpdate, startUpdateSchedule, stopUpdateSchedule } from './updater'
import { startReminderLoop, stopReminderLoop } from './services/notifications'
import { APP_NAME } from '../shared/constants'

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? 'warn' : 'info'

let mainWindow: BrowserWindow | null = null

/* Only one till per machine — a second launch focuses the existing window. */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.setAppUserModelId('in.krishnamobile.desktop')

function resolveIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.ico'),
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(process.cwd(), 'build', 'icon.ico')
  ]
  return candidates.find((p) => p && existsSync(p))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f19' : '#f7f8fa',
    autoHideMenuBar: true,
    // The app draws its own title bar (see AppShell) so the header row can hold
    // the shop switcher, search and update status.
    frame: false,
    title: APP_NAME,
    icon: resolveIcon(),
    webPreferences: {
      // electron-vite emits an ESM preload (.mjs) because package.json is
      // "type": "module" — Electron loads it because sandbox is off.
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const notifyMaximised = () =>
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
  mainWindow.on('maximize', notifyMaximised)
  mainWindow.on('unmaximize', notifyMaximised)

  // External links open in the real browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  loadEnv()
  Menu.setApplicationMenu(null)

  await startDatabase()

  registerIpc()
  initUpdater()
  createWindow()
  startUpdateSchedule()
  startReminderLoop(10)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopReminderLoop()
  stopUpdateSchedule()
  if (!isQuittingForUpdate()) void closeDb()
})

process.on('uncaughtException', (err) => log.error('[main] uncaught', err))
process.on('unhandledRejection', (err) => log.error('[main] unhandled rejection', err))
