import * as React from 'react'
import { Building2, Check, Store } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { Button } from '@/components/ui/base'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/overlay'
import { cn } from '@/lib/utils'

/** Company + shop pickers in the title bar. Multi-company and multi-shop live here. */
export function ScopeSwitcher() {
  const session = useSession()
  const company = session.activeCompany()
  const shop = session.activeShop()
  const shops = session.shopsForCompany()

  const pickCompany = async (companyId: string) => {
    const firstShop = session.shops.find((s) => s.companyId === companyId)
    await session.switchScope(companyId, firstShop?.id ?? null)
    toast.success(`Switched to ${session.companies.find((c) => c.id === companyId)?.name}`)
  }

  const pickShop = async (shopId: string) => {
    await session.switchScope(session.companyId, shopId)
  }

  /* Ctrl+1..9 jumps between shops of the active company. */
  useHotkey(
    shops.slice(0, 9).map((_, i) => `ctrl+${i + 1}`),
    (e) => {
      const idx = Number(e.key) - 1
      const target = shops[idx]
      if (target) void pickShop(target.id)
    },
    { description: 'Switch shop (Ctrl+1…9)', group: 'Global', allowInInputs: true }
  )

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 font-medium">
            <Building2 className="size-4 text-muted-foreground" />
            <span className="max-w-[140px] truncate">{company?.name ?? 'No company'}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Companies</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {session.companies.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => void pickCompany(c.id)}>
              <Check className={cn('size-4', c.id === session.companyId ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
          {session.companies.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">
              No company assigned to you yet.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-muted-foreground/50">/</span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 font-medium">
            <Store className="size-4 text-muted-foreground" />
            <span className="max-w-[140px] truncate">{shop?.name ?? 'No shop'}</span>
            {shop && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {shop.code}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Shops</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {shops.map((s, i) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => void pickShop(s.id)}
              shortcut={i < 9 ? `Ctrl ${i + 1}` : undefined}
            >
              <Check className={cn('size-4', s.id === session.shopId ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{s.name}</span>
            </DropdownMenuItem>
          ))}
          {shops.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-muted-foreground">
              No shop assigned in this company.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
