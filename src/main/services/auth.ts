import bcrypt from 'bcryptjs'
import { all, one, run } from '../db'
import { AppError, nowIso } from '../utils'
import { pinIssue } from '../../shared/validators'
import type { Role } from '../../shared/constants'
import {
  getSession,
  resolvePermissions,
  setActiveScope,
  setSession,
  type ActiveSession
} from './session'
import { logAudit } from './audit'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

export interface LoginTile {
  id: string
  name: string
  username: string
  role: Role
  avatarColor: string | null
  lastLoginAt: string | null
  lockedUntil: string | null
  isSystem: boolean
}

/** The users shown as pick-a-face tiles on the lock screen. */
export async function listLoginUsers(): Promise<LoginTile[]> {
  const rows = await all<any>(
    `SELECT id, name, username, role, avatar_color, last_login_at, locked_until, is_system
       FROM users WHERE is_active = 1
      ORDER BY (last_login_at IS NULL), last_login_at DESC, name`
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    role: r.role,
    avatarColor: r.avatar_color,
    lastLoginAt: r.last_login_at,
    lockedUntil: r.locked_until,
    isSystem: !!r.is_system
  }))
}

export interface LoginResult {
  session: ActiveSession
  mustChangePin: boolean
  companies: { id: string; name: string }[]
  shops: { id: string; companyId: string; name: string; code: string }[]
}

export async function login(userId: string, pin: string): Promise<LoginResult> {
  const u = await one<any>('SELECT * FROM users WHERE id = ? AND is_active = 1', [userId])
  if (!u) throw new AppError('User not found or deactivated.', 'NO_USER')

  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000)
    throw new AppError(`Too many wrong PINs. Try again in ${mins} minute(s).`, 'LOCKED')
  }

  const ok = await bcrypt.compare(pin, u.pin_hash)
  if (!ok) {
    const attempts = (u.failed_attempts ?? 0) + 1
    const locked = attempts >= MAX_ATTEMPTS
    await run(
      'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      [
        locked ? 0 : attempts,
        locked ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null,
        nowIso(),
        userId
      ]
    )
    if (locked)
      throw new AppError(
        `Too many wrong PINs. This user is locked for ${LOCK_MINUTES} minutes.`,
        'LOCKED'
      )
    throw new AppError(
      `Wrong PIN. ${MAX_ATTEMPTS - attempts} attempt(s) left before lock.`,
      'BAD_PIN'
    )
  }

  await run(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    [nowIso(), nowIso(), userId]
  )

  const permissions = resolvePermissions(u.role, u.permissions)
  const isAdmin = u.role === 'admin'

  const companies = await all<{ id: string; name: string }>(
    isAdmin
      ? `SELECT id, name FROM companies WHERE is_active = 1 ORDER BY name`
      : `SELECT c.id, c.name FROM companies c
           JOIN user_companies uc ON uc.company_id = c.id
          WHERE uc.user_id = ? AND c.is_active = 1 ORDER BY c.name`,
    isAdmin ? [] : [userId]
  )

  const shops = await all<any>(
    isAdmin
      ? `SELECT id, company_id, name, code FROM shops WHERE is_active = 1 ORDER BY code`
      : `SELECT s.id, s.company_id, s.name, s.code FROM shops s
           JOIN user_shops us ON us.shop_id = s.id
          WHERE us.user_id = ? AND s.is_active = 1 ORDER BY s.code`,
    isAdmin ? [] : [userId]
  )

  const companyId =
    companies.find((c) => c.id === u.default_company_id)?.id ?? companies[0]?.id ?? null
  const shopId =
    shops.find((s) => s.id === u.default_shop_id && s.company_id === companyId)?.id ??
    shops.find((s) => s.company_id === companyId)?.id ??
    null

  const session: ActiveSession = {
    user: {
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      avatarColor: u.avatar_color,
      permissions
    },
    companyId,
    shopId,
    startedAt: nowIso()
  }
  setSession(session)
  await logAudit({ action: 'auth.login', entity: 'user', entityId: u.id, summary: `${u.name} signed in` })

  return {
    session,
    mustChangePin: !!u.must_change_pin,
    companies,
    shops: shops.map((s) => ({ id: s.id, companyId: s.company_id, name: s.name, code: s.code }))
  }
}

export async function logout(): Promise<void> {
  const s = getSession()
  if (s) await logAudit({ action: 'auth.logout', entity: 'user', entityId: s.user.id })
  setSession(null)
}

export async function changeOwnPin(currentPin: string, newPin: string): Promise<void> {
  const s = getSession()
  if (!s) throw new AppError('Not signed in.', 'NO_SESSION')

  const issue = pinIssue(newPin)
  if (issue) throw new AppError(issue, 'WEAK_PIN')

  const u = await one<any>('SELECT pin_hash FROM users WHERE id = ?', [s.user.id])
  if (!u || !(await bcrypt.compare(currentPin, u.pin_hash)))
    throw new AppError('Current PIN is incorrect.', 'BAD_PIN')

  await run(
    'UPDATE users SET pin_hash = ?, must_change_pin = 0, updated_at = ? WHERE id = ?',
    [await bcrypt.hash(newPin, 10), nowIso(), s.user.id]
  )
  await logAudit({ action: 'auth.pin_changed', entity: 'user', entityId: s.user.id })
}

export function switchScope(companyId: string | null, shopId: string | null): ActiveSession | null {
  setActiveScope(companyId, shopId)
  const s = getSession()
  if (s) {
    void run('UPDATE users SET default_company_id = ?, default_shop_id = ?, updated_at = ? WHERE id = ?', [
      companyId,
      shopId,
      nowIso(),
      s.user.id
    ])
  }
  return s
}
