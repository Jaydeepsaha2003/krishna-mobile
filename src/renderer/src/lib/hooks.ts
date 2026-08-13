import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './api'
import { useSession } from '@/store/session'
import { startOfMonth, todayStr, toCsv } from './utils'
import type { DateRange } from '@/components/ui/misc'

/**
 * Shop + company currently in scope.
 *
 * The shop list is derived with useMemo, never inside the selector: a selector
 * that returns a freshly built array hands Zustand a new snapshot on every
 * render, which loops forever.
 */
export function useScope() {
  const companyId = useSession((s) => s.companyId)
  const shopId = useSession((s) => s.shopId)
  const allShops = useSession((s) => s.shops)

  const shops = React.useMemo(
    () => allShops.filter((s) => s.companyId === companyId),
    [allShops, companyId]
  )

  return { companyId, shopId, shops }
}

/**
 * A page's shop filter, kept in step with the shop picked in the header.
 *
 * Pages used to seed this with plain `useState(shopId ?? 'all')`, which reads
 * the active shop only once. Switching shops in the header then appeared to do
 * nothing — the page kept listing whichever shop was active when it first
 * mounted, so stock added at the other shop looked missing. The filter the user
 * sets on the page itself is still respected; only an actual header change
 * resets it.
 *
 * @param initial 'active' seeds with the current shop, 'all' shows every shop.
 */
export function useShopScope(initial: 'active' | 'all' = 'active') {
  const shopId = useSession((s) => s.shopId)
  const [scope, setScope] = React.useState<string>(
    initial === 'all' ? 'all' : (shopId ?? 'all')
  )

  const previous = React.useRef(shopId)
  React.useEffect(() => {
    if (previous.current === shopId) return // first render, or unrelated update
    previous.current = shopId
    setScope(shopId ?? 'all')
  }, [shopId])

  return [scope, setScope] as const
}

/** Date range persisted per screen so filters survive navigation. */
export function useDateRange(key: string, initial?: DateRange) {
  const storageKey = `km.range.${key}`
  const [range, setRange] = React.useState<DateRange>(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        /* ignore */
      }
    }
    return initial ?? { from: startOfMonth(), to: todayStr() }
  })

  const update = React.useCallback(
    (r: DateRange) => {
      localStorage.setItem(storageKey, JSON.stringify(r))
      setRange(r)
    },
    [storageKey]
  )

  return [range, update] as const
}

/** Debounced text input value, for search boxes that hit the database. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/* -------------------------------------------------------------------------- */
/*  Shared reference data                                                      */
/* -------------------------------------------------------------------------- */

export function useCustomers(search?: string) {
  const { companyId } = useScope()
  return useQuery({
    queryKey: ['customers', companyId, search ?? ''],
    queryFn: () => api.customers.list({ search, limit: 100 }),
    enabled: Boolean(companyId)
  })
}

export function useSuppliers() {
  const { companyId } = useScope()
  return useQuery({
    queryKey: ['suppliers', companyId],
    queryFn: () => api.suppliers.list({}),
    enabled: Boolean(companyId)
  })
}

export function useModels(search?: string) {
  const { companyId, shopId } = useScope()
  return useQuery({
    queryKey: ['models', companyId, shopId, search ?? ''],
    queryFn: () => api.models.list({ search, shopId }),
    enabled: Boolean(companyId)
  })
}

export function useBrands() {
  const { companyId } = useScope()
  return useQuery({
    queryKey: ['brands', companyId],
    queryFn: () => api.brands.list(),
    enabled: Boolean(companyId)
  })
}

export function useReconReasons() {
  return useQuery({ queryKey: ['recon-reasons'], queryFn: () => api.recon.reasons() })
}

/* -------------------------------------------------------------------------- */
/*  CSV export                                                                 */
/* -------------------------------------------------------------------------- */

export function useCsvExport() {
  return React.useCallback(
    async (
      filename: string,
      rows: Record<string, unknown>[],
      columns?: { key: string; label: string }[]
    ) => {
      if (!rows.length) {
        toast.error('Nothing to export')
        return
      }
      const res = await api.files.exportCsv(filename, toCsv(rows, columns))
      if (res?.saved) {
        toast.success('Exported', {
          action: { label: 'Show file', onClick: () => void api.files.reveal(res.filePath) }
        })
      }
    },
    []
  )
}

/** Focuses an element when a key is pressed anywhere on the page. */
export function useFocusRef<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const focus = React.useCallback(() => {
    ref.current?.focus()
    if (ref.current instanceof HTMLInputElement) ref.current.select()
  }, [])
  return [ref, focus] as const
}
