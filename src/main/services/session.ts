import { ALL_PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/constants'
import { AppError } from '../utils'
import { all } from '../db'

export interface SessionUser {
  id: string
  name: string
  username: string
  role: Role
  avatarColor: string | null
  permissions: Permission[]
}

export interface ActiveSession {
  user: SessionUser
  companyId: string | null
  shopId: string | null
  startedAt: string
}

let current: ActiveSession | null = null

export function setSession(s: ActiveSession | null): void {
  current = s
}

export function getSession(): ActiveSession | null {
  return current
}

/** Throws unless someone is logged in. */
export function requireSession(): ActiveSession {
  if (!current) throw new AppError('You are signed out. Please log in again.', 'NO_SESSION')
  return current
}

export function requirePermission(permission: Permission): ActiveSession {
  const s = requireSession()
  if (s.user.role === 'admin') return s
  if (!s.user.permissions.includes(permission))
    throw new AppError(`You do not have permission to ${permission}.`, 'FORBIDDEN')
  return s
}

export function requireCompany(): { session: ActiveSession; companyId: string } {
  const s = requireSession()
  if (!s.companyId) throw new AppError('No company selected.', 'NO_COMPANY')
  return { session: s, companyId: s.companyId }
}

export function requireShop(): { session: ActiveSession; companyId: string; shopId: string } {
  const { session, companyId } = requireCompany()
  if (!session.shopId) throw new AppError('No shop selected.', 'NO_SHOP')
  return { session, companyId, shopId: session.shopId }
}

export function setActiveScope(companyId: string | null, shopId: string | null): void {
  if (!current) return
  current = { ...current, companyId, shopId }
}

/**
 * The shop IDs a "no shop chosen" query should be restricted to — `null` means
 * no restriction (an admin, who can see every shop). A non-admin's "All shops"
 * view must stop at the shops they're actually assigned to in user_shops, or
 * an "all shops I can see" request silently turns into "every shop in the
 * company", leaking other shops' stock into a manager's aggregate view.
 */
export async function visibleShopIds(): Promise<string[] | null> {
  const s = requireSession()
  if (s.user.role === 'admin') return null
  const rows = await all<{ shop_id: string }>('SELECT shop_id FROM user_shops WHERE user_id = ?', [
    s.user.id
  ])
  return rows.map((r) => r.shop_id)
}

/** Resolves the effective permission list for a stored user row. */
export function resolvePermissions(role: string, permissionsJson?: string | null): Permission[] {
  if (role === 'admin') return [...ALL_PERMISSIONS]
  if (permissionsJson) {
    try {
      const parsed = JSON.parse(permissionsJson)
      if (Array.isArray(parsed)) return parsed.filter((p): p is Permission => ALL_PERMISSIONS.includes(p))
    } catch {
      /* fall through to role defaults */
    }
  }
  return ROLE_PERMISSIONS[(role as Exclude<Role, 'custom'>) ?? 'viewer'] ?? ROLE_PERMISSIONS.viewer
}
