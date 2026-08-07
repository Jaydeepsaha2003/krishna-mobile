import * as React from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  Command,
  Keyboard,
  LogOut,
  Moon,
  RefreshCw,
  Search,
  Sun,
  User as UserIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, initials } from '@/lib/utils'
import { api } from '@/lib/api'
import { useSession } from '@/store/session'
import { useTheme } from '@/lib/theme'
import { useHotkey, useHotkeyStore } from '@/lib/hotkeys'
import { Badge, Button, Separator } from '@/components/ui/base'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip
} from '@/components/ui/overlay'
import { NAV_GROUPS, NAV_ITEMS } from './nav'
import { ScopeSwitcher } from './ScopeSwitcher'
import { CommandPalette } from './CommandPalette'
import { NotificationCenter } from './NotificationCenter'
import { UpdateCenter } from './UpdateCenter'
import { HotkeyHelp } from './HotkeyHelp'
import { ChangePinDialog } from './ChangePinDialog'
import { WindowControls } from './WindowControls'

export function AppShell() {
  const navigate = useNavigate()
  const session = useSession()
  const theme = useTheme()
  const setHelpOpen = useHotkeyStore((s) => s.setHelpOpen)

  const [collapsed, setCollapsed] = React.useState(
    () => localStorage.getItem('km.sidebar') === 'collapsed'
  )
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [notifOpen, setNotifOpen] = React.useState(false)
  const [pinOpen, setPinOpen] = React.useState(false)
  const [unread, setUnread] = React.useState(0)
  const [syncing, setSyncing] = React.useState(false)

  React.useEffect(() => {
    localStorage.setItem('km.sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  /* Live badge for the bell. */
  const refreshUnread = React.useCallback(async () => {
    try {
      setUnread(await api.notifications.unreadCount())
    } catch {
      /* not signed in yet */
    }
  }, [])

  React.useEffect(() => {
    void refreshUnread()
    const t = setInterval(refreshUnread, 60_000)
    const off = window.api.on('notifications:new', () => void refreshUnread())
    const offOpen = window.api.on('notifications:open', (payload: any) => {
      setNotifOpen(true)
      if (payload?.link) navigate(payload.link)
    })
    return () => {
      clearInterval(t)
      off()
      offOpen()
    }
  }, [refreshUnread, navigate])

  React.useEffect(() => {
    if (session.mustChangePin) setPinOpen(true)
  }, [session.mustChangePin])

  /* ---------------------------------------------------------- global keys */
  useHotkey('ctrl+k', () => setPaletteOpen(true), {
    description: 'Open command palette',
    group: 'Global',
    allowInInputs: true
  })
  useHotkey('ctrl+b', () => setCollapsed((c) => !c), {
    description: 'Collapse / expand sidebar',
    group: 'Global'
  })
  useHotkey('shift+?', () => setHelpOpen(true), {
    description: 'Keyboard shortcuts',
    group: 'Global'
  })
  useHotkey('ctrl+shift+n', () => setNotifOpen(true), {
    description: 'Open reminders',
    group: 'Global',
    allowInInputs: true
  })
  useHotkey('ctrl+shift+t', () => theme.toggle(), {
    description: 'Switch light / dark',
    group: 'Global',
    allowInInputs: true
  })

  for (const item of NAV_ITEMS) {
    // Registered once per item; the list is static so hook order is stable.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(
      item.hotkey ?? `__none_${item.to}`,
      () => navigate(item.to),
      {
        description: item.hotkey ? `Go to ${item.label}` : undefined,
        group: 'Navigation',
        enabled: Boolean(item.hotkey) && (!item.permission || session.can(item.permission)),
        allowInInputs: item.hotkey?.startsWith('f') || item.hotkey?.includes('alt')
      }
    )
  }

  const doSync = async () => {
    setSyncing(true)
    const res = await api.app.sync()
    setSyncing(false)
    toast[res?.ok ? 'success' : 'error'](
      res?.ok ? 'Synced with Turso' : `Sync failed: ${res?.error ?? 'unknown error'}`
    )
  }

  const logout = async () => {
    await api.auth.logout()
    session.clear()
    navigate('/')
  }

  const visibleItems = NAV_ITEMS.filter((i) => !i.permission || session.can(i.permission))

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* ------------------------------------------------------------ sidebar */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
          collapsed ? 'w-[68px]' : 'w-[236px]'
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <span className="text-sm font-bold">KM</span>
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">Krishna Mobile</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {session.activeCompany()?.name ?? 'No company'}
              </p>
            </div>
          )}
        </div>

        <Separator className="bg-sidebar-border" />

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => {
            const items = visibleItems.filter((i) => i.group === group)
            if (!items.length) return null
            return (
              <div key={group} className="mb-4 last:mb-0">
                {!collapsed && (
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <Tooltip
                      key={item.to}
                      content={collapsed ? item.label : ''}
                      side="right"
                      shortcut={collapsed && item.hotkey ? item.hotkey.toUpperCase() : undefined}
                    >
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn(
                            `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium
                             text-sidebar-foreground transition-colors`,
                            isActive
                              ? 'bg-sidebar-accent text-accent-foreground shadow-sm'
                              : 'hover:bg-sidebar-accent/60 hover:text-foreground',
                            collapsed && 'justify-center px-0'
                          )
                        }
                      >
                        <item.icon className="size-[18px] shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.hotkey && (
                              <span className="kbd opacity-0 transition-opacity group-hover:opacity-100">
                                {item.hotkey.replace('alt+', '⌥').replace('f2', 'F2').toUpperCase()}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="px-2 pb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed((c) => !c)}
            className={cn('w-full justify-start text-muted-foreground', collapsed && 'justify-center')}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && <span>Collapse</span>}
          </Button>
        </div>
      </aside>

      {/* ------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-drag flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <div className="app-no-drag flex items-center gap-2">
            <ScopeSwitcher />
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="app-no-drag ml-2 flex h-8 w-64 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-[13px] text-muted-foreground transition hover:border-ring/50 hover:bg-muted/50"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <span className="kbd">Ctrl K</span>
          </button>

          <div className="flex-1" />

          <div className="app-no-drag flex items-center gap-1">
            <UpdateCenter />

            <Tooltip content="Sync with Turso now">
              <Button variant="ghost" size="icon-sm" onClick={doSync} disabled={syncing}>
                <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
              </Button>
            </Tooltip>

            <Tooltip content="Reminders" shortcut="Ctrl Shift N">
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative"
                onClick={() => setNotifOpen(true)}
              >
                <Bell className="size-4" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Button>
            </Tooltip>

            <Tooltip content="Light / dark" shortcut="Ctrl Shift T">
              <Button variant="ghost" size="icon-sm" onClick={theme.toggle}>
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" />
              </Button>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-muted">
                  <span
                    className="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: session.user?.avatarColor ?? '#4f46e5' }}
                  >
                    {initials(session.user?.name)}
                  </span>
                  <span className="hidden text-left lg:block">
                    <span className="block text-[13px] font-medium leading-tight">
                      {session.user?.name}
                    </span>
                    <span className="block text-[11px] capitalize leading-tight text-muted-foreground">
                      {session.user?.role}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>{session.user?.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPinOpen(true)}>
                  <UserIcon /> Change my PIN
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHelpOpen(true)} shortcut="?">
                  <Keyboard /> Keyboard shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPaletteOpen(true)} shortcut="Ctrl K">
                  <Command /> Command palette
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => void logout()}>
                  <LogOut /> Lock & sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <WindowControls />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-5">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <NotificationCenter open={notifOpen} onOpenChange={setNotifOpen} onRead={refreshUnread} />
      <HotkeyHelp />
      <ChangePinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        forced={session.mustChangePin}
      />
    </div>
  )
}

export function ShopBadge() {
  const shop = useSession((s) => s.activeShop())
  if (!shop) return null
  return <Badge variant="outline">{shop.code}</Badge>
}
