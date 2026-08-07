import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Permission } from '@shared/constants'

export interface SessionUser {
  id: string
  name: string
  username: string
  role: string
  avatarColor: string | null
  permissions: Permission[]
}

export interface Company {
  id: string
  name: string
}

export interface Shop {
  id: string
  companyId: string
  name: string
  code: string
}

interface SessionState {
  user: SessionUser | null
  companyId: string | null
  shopId: string | null
  companies: Company[]
  shops: Shop[]
  mustChangePin: boolean
  ready: boolean

  setLogin: (result: any) => void
  clear: () => void
  switchScope: (companyId: string | null, shopId: string | null) => Promise<void>
  refreshScope: () => Promise<void>
  can: (permission: Permission) => boolean
  shopsForCompany: () => Shop[]
  activeShop: () => Shop | null
  activeCompany: () => Company | null
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  companyId: null,
  shopId: null,
  companies: [],
  shops: [],
  mustChangePin: false,
  ready: false,

  setLogin: (result) =>
    set({
      user: result.session.user,
      companyId: result.session.companyId,
      shopId: result.session.shopId,
      companies: result.companies ?? [],
      shops: result.shops ?? [],
      mustChangePin: !!result.mustChangePin,
      ready: true
    }),

  clear: () =>
    set({
      user: null,
      companyId: null,
      shopId: null,
      companies: [],
      shops: [],
      mustChangePin: false,
      ready: true
    }),

  switchScope: async (companyId, shopId) => {
    await api.auth.switchScope(companyId, shopId)
    set({ companyId, shopId })
  },

  refreshScope: async () => {
    const [companies, shops] = await Promise.all([api.companies.list(), api.shops.list()])
    set({
      companies,
      shops: shops.map((s: any) => ({
        id: s.id,
        companyId: s.companyId,
        name: s.name,
        code: s.code
      }))
    })
  },

  can: (permission) => {
    const u = get().user
    if (!u) return false
    if (u.role === 'admin') return true
    return u.permissions.includes(permission)
  },

  shopsForCompany: () => {
    const { shops, companyId } = get()
    return shops.filter((s) => s.companyId === companyId)
  },

  activeShop: () => get().shops.find((s) => s.id === get().shopId) ?? null,
  activeCompany: () => get().companies.find((c) => c.id === get().companyId) ?? null
}))
