import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'
import log from 'electron-log/main'

/**
 * Loads configuration from `.env`, searching in priority order:
 *   1. <userData>/.env          — lets a shop owner override without a rebuild
 *   2. <resources>/.env         — the copy bundled into the installer (production)
 *   3. <cwd>/.env               — development
 * Values found earlier win.
 */

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true

  const candidates = [
    join(app.getPath('userData'), '.env'),
    process.resourcesPath ? join(process.resourcesPath, '.env') : '',
    join(app.getAppPath(), '.env'),
    join(process.cwd(), '.env')
  ].filter(Boolean)

  const seen = new Set<string>()
  for (const file of candidates) {
    if (!existsSync(file) || seen.has(file)) continue
    seen.add(file)
    try {
      const parsed = dotenv.parse(readFileSync(file))
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v
      }
      log.info(`[env] loaded ${file}`)
    } catch (err) {
      log.warn(`[env] could not read ${file}`, err)
    }
  }
}

function str(key: string, fallback = ''): string {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v.trim()
}

function num(key: string, fallback: number): number {
  const v = Number(str(key, ''))
  return Number.isFinite(v) ? v : fallback
}

function bool(key: string, fallback: boolean): boolean {
  const v = str(key, '').toLowerCase()
  if (!v) return fallback
  return v === 'true' || v === '1' || v === 'yes'
}

export const config = {
  get tursoUrl() {
    return str('TURSO_DATABASE_URL')
  },
  get tursoToken() {
    return str('TURSO_AUTH_TOKEN')
  },
  get useEmbeddedReplica() {
    return bool('TURSO_EMBEDDED_REPLICA', true)
  },
  get syncIntervalSeconds() {
    return num('TURSO_SYNC_INTERVAL', 30)
  },
  get defaultAdminName() {
    return str('DEFAULT_ADMIN_NAME', 'Administrator')
  },
  get defaultAdminUsername() {
    return str('DEFAULT_ADMIN_USERNAME', 'admin')
  },
  get defaultAdminPin() {
    const pin = str('DEFAULT_ADMIN_PIN', '202600')
    return /^\d{6}$/.test(pin) ? pin : '202600'
  },
  get defaultCompanyName() {
    return str('DEFAULT_COMPANY_NAME', 'Krishna Mobile')
  },
  get defaultCompanyState() {
    return str('DEFAULT_COMPANY_STATE', 'Maharashtra')
  },
  get defaultShopNames() {
    return [str('DEFAULT_SHOP_1_NAME', 'Shop 1'), str('DEFAULT_SHOP_2_NAME', 'Shop 2')]
  },
  get updateFeedUrl() {
    return str('UPDATE_FEED_URL')
  },
  get updateCheckIntervalMinutes() {
    return Math.max(5, num('UPDATE_CHECK_INTERVAL_MINUTES', 60))
  },
  get updateMode(): 'auto' | 'notify' {
    return str('UPDATE_MODE', 'auto') === 'notify' ? 'notify' : 'auto'
  }
}
