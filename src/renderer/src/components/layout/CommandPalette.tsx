import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import {
  ArrowRight,
  CornerDownLeft,
  Moon,
  Search,
  Smartphone,
  Sun,
  User,
  Users
} from 'lucide-react'
import { api } from '@/lib/api'
import { useSession } from '@/store/session'
import { useTheme } from '@/lib/theme'
import { debounce, money } from '@/lib/utils'
import { formatPhone } from '@shared/validators'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import { NAV_ITEMS } from './nav'
import { prettyCombo } from '@/lib/hotkeys'

interface Hit {
  id: string
  type: 'customer' | 'stock' | 'sale'
  title: string
  subtitle: string
  meta?: string
  to: string
}

/**
 * Ctrl+K — jumps anywhere and searches customers, IMEIs and invoices live.
 */
export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const navigate = useNavigate()
  const session = useSession()
  const theme = useTheme()
  const [search, setSearch] = React.useState('')
  const [hits, setHits] = React.useState<Hit[]>([])
  const [loading, setLoading] = React.useState(false)

  const runSearch = React.useMemo(
    () =>
      debounce(async (q: string) => {
        if (q.trim().length < 2) {
          setHits([])
          setLoading(false)
          return
        }
        setLoading(true)
        try {
          const [customers, stock, sales] = await Promise.all([
            session.can('customer.view') ? api.customers.list({ search: q, limit: 6 }) : [],
            session.can('stock.view') ? api.stock.byImei(q) : [],
            session.can('sale.view') ? api.sales.list({ search: q, limit: 6 }) : { rows: [] }
          ])

          const next: Hit[] = [
            ...(customers as any[]).slice(0, 6).map((c) => ({
              id: `c-${c.id}`,
              type: 'customer' as const,
              title: c.name,
              subtitle: formatPhone(c.phonePrimary),
              meta: c.outstanding > 0 ? `${money(c.outstanding)} due` : undefined,
              to: `/customers?id=${c.id}`
            })),
            ...(stock as any[]).slice(0, 6).map((u) => ({
              id: `s-${u.id}`,
              type: 'stock' as const,
              title: `${u.label}${u.imei1 ? ` · ${u.imei1}` : ''}`,
              subtitle: `${u.shopName ?? 'No shop'} · ${u.status.replace('_', ' ')}`,
              meta: undefined,
              to: `/stock?q=${u.imei1 ?? ''}`
            })),
            ...((sales as any).rows ?? []).slice(0, 6).map((s: any) => ({
              id: `i-${s.id}`,
              type: 'sale' as const,
              title: s.invoiceNo,
              subtitle: `${s.customerName} · ${s.saleDate}`,
              meta: money(s.total),
              to: `/sales?id=${s.id}`
            }))
          ]
          setHits(next)
        } finally {
          setLoading(false)
        }
      }, 220),
    [session]
  )

  React.useEffect(() => {
    void runSearch(search)
  }, [search, runSearch])

  React.useEffect(() => {
    if (!open) {
      setSearch('')
      setHits([])
    }
  }, [open])

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  const navItems = NAV_ITEMS.filter((i) => !i.permission || session.can(i.permission))

  const ICONS = { customer: Users, stock: Smartphone, sale: ArrowRight }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="gap-0 p-0" aria-describedby={undefined}>
        <Command shouldFilter={false} loop className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="Search customers, IMEI, invoice — or type a page name…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
            {loading && <span className="text-xs text-muted-foreground">Searching…</span>}
          </div>

          <Command.List className="max-h-[380px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-10 text-center text-[13px] text-muted-foreground">
              Nothing matched “{search}”
            </Command.Empty>

            {hits.length > 0 && (
              <Command.Group
                heading="Results"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {hits.map((hit) => {
                  const Icon = ICONS[hit.type]
                  return (
                    <Command.Item
                      key={hit.id}
                      value={hit.id}
                      onSelect={() => go(hit.to)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{hit.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {hit.subtitle}
                        </span>
                      </span>
                      {hit.meta && (
                        <span className="shrink-0 text-xs font-medium tnum">{hit.meta}</span>
                      )}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}

            <Command.Group
              heading="Go to"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {navItems
                .filter((i) =>
                  search.trim().length < 2
                    ? true
                    : i.label.toLowerCase().includes(search.toLowerCase())
                )
                .map((item) => (
                  <Command.Item
                    key={item.to}
                    value={`nav-${item.to}`}
                    onSelect={() => go(item.to)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
                  >
                    <item.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{item.label}</span>
                    {item.hotkey && <span className="kbd">{prettyCombo(item.hotkey)}</span>}
                  </Command.Item>
                ))}
            </Command.Group>

            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <Command.Item
                value="toggle-theme"
                onSelect={() => {
                  theme.toggle()
                  onOpenChange(false)
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" />
                Switch light / dark theme
              </Command.Item>
              <Command.Item
                value="my-pin"
                onSelect={() => go('/settings?tab=profile')}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <User className="size-4" />
                Change my login PIN
              </Command.Item>
            </Command.Group>
          </Command.List>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> to move
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="size-3" /> to open · <span className="kbd">Esc</span> to close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
