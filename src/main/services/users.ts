import bcrypt from 'bcryptjs'
import { all, batch, one, run, scalar } from '../db'
import { AppError, newId, nowIso, nullify } from '../utils'
import { isValidPhone, normalizePhone, pinIssue } from '../../shared/validators'
import { ALL_PERMISSIONS, type Permission } from '../../shared/constants'
import { getSession, requirePermission } from './session'
import { logAudit } from './audit'

const AVATAR_COLORS = [
  '#4f46e5',
  '#0891b2',
  '#059669',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#dc2626',
  '#2563eb'
]

export interface UserInput {
  id?: string
  name: string
  username: string
  phone?: string
  email?: string
  role: string
  permissions?: Permission[]
  companyIds: string[]
  shopIds: string[]
  isActive?: boolean
  pin?: string
  mustChangePin?: boolean
  avatarColor?: string
}

export async function listUsers() {
  requirePermission('user.view')
  const rows = await all<any>(
    `SELECT u.*,
            (SELECT group_concat(company_id) FROM user_companies WHERE user_id = u.id) AS company_ids,
            (SELECT group_concat(shop_id)    FROM user_shops     WHERE user_id = u.id) AS shop_ids
       FROM users u
      ORDER BY u.is_active DESC, u.name`
  )
  return rows.map(shapeUser)
}

function shapeUser(r: any) {
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    phone: r.phone,
    email: r.email,
    role: r.role,
    permissions: r.permissions ? safeParse(r.permissions) : null,
    avatarColor: r.avatar_color,
    isActive: !!r.is_active,
    isSystem: !!r.is_system,
    mustChangePin: !!r.must_change_pin,
    lockedUntil: r.locked_until,
    lastLoginAt: r.last_login_at,
    companyIds: r.company_ids ? String(r.company_ids).split(',') : [],
    shopIds: r.shop_ids ? String(r.shop_ids).split(',') : [],
    createdAt: r.created_at
  }
}

function safeParse(s: string): Permission[] | null {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

export async function saveUser(input: UserInput) {
  requirePermission('user.manage')

  const name = (input.name ?? '').trim()
  const username = (input.username ?? '').trim().toLowerCase()
  if (name.length < 2) throw new AppError('Please enter the full name.', 'VALIDATION')
  if (!/^[a-z0-9._-]{3,24}$/.test(username))
    throw new AppError(
      'Username must be 3–24 characters: letters, digits, dot, dash or underscore.',
      'VALIDATION'
    )
  if (input.phone && !isValidPhone(input.phone))
    throw new AppError('Enter a valid 10-digit Indian mobile number.', 'VALIDATION')

  const clash = await one<{ id: string }>(
    'SELECT id FROM users WHERE lower(username) = ? AND id <> ?',
    [username, input.id ?? '']
  )
  if (clash) throw new AppError(`Username "${username}" is already taken.`, 'DUPLICATE')

  const ts = nowIso()
  const permissions =
    input.role === 'custom' && input.permissions
      ? JSON.stringify(input.permissions.filter((p) => ALL_PERMISSIONS.includes(p)))
      : null

  let userId = input.id

  if (userId) {
    await run(
      `UPDATE users SET name = ?, username = ?, phone = ?, email = ?, role = ?, permissions = ?,
                        avatar_color = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      [
        name,
        username,
        nullify(input.phone && normalizePhone(input.phone)),
        nullify(input.email),
        input.role,
        permissions,
        input.avatarColor ?? null,
        input.isActive === false ? 0 : 1,
        ts,
        userId
      ]
    )
    if (input.pin) await setPin(userId, input.pin, input.mustChangePin ?? false)
  } else {
    if (!input.pin) throw new AppError('A 6-digit login PIN is required for a new user.', 'VALIDATION')
    const issue = pinIssue(input.pin)
    if (issue) throw new AppError(issue, 'WEAK_PIN')

    userId = newId()
    const count = (await scalar<number>('SELECT COUNT(*) FROM users')) ?? 0
    await run(
      `INSERT INTO users (id, name, username, phone, email, pin_hash, role, permissions,
                          avatar_color, is_active, must_change_pin, is_system, created_by,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        userId,
        name,
        username,
        nullify(input.phone && normalizePhone(input.phone)),
        nullify(input.email),
        await bcrypt.hash(input.pin, 10),
        input.role,
        permissions,
        input.avatarColor ?? AVATAR_COLORS[count % AVATAR_COLORS.length],
        input.isActive === false ? 0 : 1,
        input.mustChangePin ? 1 : 0,
        getSession()?.user.id ?? null,
        ts,
        ts
      ]
    )
  }

  await run('DELETE FROM user_companies WHERE user_id = ?', [userId])
  await run('DELETE FROM user_shops WHERE user_id = ?', [userId])
  if (input.companyIds.length)
    await batch(
      input.companyIds.map((cid) => ({
        sql: 'INSERT INTO user_companies (user_id, company_id) VALUES (?, ?)',
        args: [userId!, cid]
      }))
    )
  if (input.shopIds.length)
    await batch(
      input.shopIds.map((sid) => ({
        sql: 'INSERT INTO user_shops (user_id, shop_id) VALUES (?, ?)',
        args: [userId!, sid]
      }))
    )

  await logAudit({
    action: input.id ? 'user.update' : 'user.create',
    entity: 'user',
    entityId: userId,
    summary: `${input.id ? 'Updated' : 'Created'} user ${name} (${username})`
  })

  return { id: userId }
}

export async function setPin(userId: string, pin: string, mustChange = false): Promise<void> {
  requirePermission('user.manage')
  const issue = pinIssue(pin)
  if (issue) throw new AppError(issue, 'WEAK_PIN')
  await run(
    `UPDATE users SET pin_hash = ?, must_change_pin = ?, failed_attempts = 0,
                      locked_until = NULL, updated_at = ? WHERE id = ?`,
    [await bcrypt.hash(pin, 10), mustChange ? 1 : 0, nowIso(), userId]
  )
  await logAudit({ action: 'user.pin_reset', entity: 'user', entityId: userId })
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  requirePermission('user.manage')
  const u = await one<any>('SELECT is_system, name FROM users WHERE id = ?', [userId])
  if (u?.is_system && !active)
    throw new AppError('The built-in administrator cannot be deactivated.', 'PROTECTED')
  if (getSession()?.user.id === userId && !active)
    throw new AppError('You cannot deactivate your own account.', 'PROTECTED')

  await run('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', [
    active ? 1 : 0,
    nowIso(),
    userId
  ])
  await logAudit({
    action: active ? 'user.activate' : 'user.deactivate',
    entity: 'user',
    entityId: userId,
    summary: `${active ? 'Activated' : 'Deactivated'} ${u?.name ?? userId}`
  })
}

export async function unlockUser(userId: string): Promise<void> {
  requirePermission('user.manage')
  await run(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
    [nowIso(), userId]
  )
  await logAudit({ action: 'user.unlock', entity: 'user', entityId: userId })
}
