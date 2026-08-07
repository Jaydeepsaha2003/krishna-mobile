import bcrypt from 'bcryptjs'
import log from 'electron-log/main'
import { DEFAULT_RECON_REASONS } from '../../shared/constants'
import { config } from '../env'
import { all, batch, one, run, scalar } from './index'
import { newId, nowIso } from '../utils'

const DEFAULT_BRANDS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'Redmi',
  'Realme',
  'Vivo',
  'Oppo',
  'OnePlus',
  'Motorola',
  'Nothing',
  'Poco',
  'iQOO',
  'Tecno',
  'Infinix',
  'Nokia',
  'Lava',
  'Micromax',
  'Google',
  'Honor',
  'Accessories'
]

export async function seed(): Promise<void> {
  await seedReasons()
  await seedOrganisation()
}

async function seedReasons(): Promise<void> {
  const existing = new Set(
    (await all<{ code: string }>('SELECT code FROM recon_reasons')).map((r) => r.code)
  )
  const missing = DEFAULT_RECON_REASONS.filter((r) => !existing.has(r.code))
  if (missing.length === 0) return

  await batch(
    missing.map((r, i) => ({
      sql: `INSERT INTO recon_reasons (code, label, direction, is_system, is_active, sort_order)
            VALUES (?, ?, ?, 1, 1, ?)`,
      args: [r.code, r.label, r.direction, i]
    }))
  )
  log.info(`[seed] inserted ${missing.length} reconciliation reasons`)
}

async function seedOrganisation(): Promise<void> {
  const userCount = (await scalar<number>('SELECT COUNT(*) FROM users')) ?? 0
  if (userCount > 0) return

  const ts = nowIso()
  const companyId = newId()
  const shopIds = config.defaultShopNames.map(() => newId())
  const adminId = newId()

  await run(
    `INSERT INTO companies (id, name, legal_name, state, invoice_prefix, fy_start_month,
                            is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'INV', 4, 1, ?, ?)`,
    [companyId, config.defaultCompanyName, config.defaultCompanyName, config.defaultCompanyState, ts, ts]
  )

  await batch(
    config.defaultShopNames.map((name, i) => ({
      sql: `INSERT INTO shops (id, company_id, name, code, state, invoice_prefix,
                               is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [
        shopIds[i],
        companyId,
        name,
        `S${i + 1}`,
        config.defaultCompanyState,
        `S${i + 1}`,
        ts,
        ts
      ]
    }))
  )

  const pinHash = await bcrypt.hash(config.defaultAdminPin, 10)
  await run(
    `INSERT INTO users (id, name, username, pin_hash, role, avatar_color, is_active,
                        must_change_pin, is_system, default_company_id, default_shop_id,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', '#4f46e5', 1, 0, 1, ?, ?, ?, ?)`,
    [
      adminId,
      config.defaultAdminName,
      config.defaultAdminUsername,
      pinHash,
      companyId,
      shopIds[0],
      ts,
      ts
    ]
  )

  await run('INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)', [adminId, companyId])
  await batch(
    shopIds.map((sid) => ({
      sql: 'INSERT INTO user_shops (user_id, shop_id) VALUES (?, ?)',
      args: [adminId, sid]
    }))
  )

  await batch(
    DEFAULT_BRANDS.map((name) => ({
      sql: `INSERT INTO brands (id, company_id, name, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)`,
      args: [newId(), companyId, name, ts, ts]
    }))
  )

  log.info(
    `[seed] created company "${config.defaultCompanyName}", ${shopIds.length} shops and admin "${config.defaultAdminUsername}"`
  )
}

/** True when the database has never been used (drives the first-run hint on login). */
export async function isFirstRun(): Promise<boolean> {
  const sales = (await scalar<number>('SELECT COUNT(*) FROM sales')) ?? 0
  const admin = await one<{ id: string }>('SELECT id FROM users WHERE is_system = 1 LIMIT 1')
  return sales === 0 && admin !== null
}
