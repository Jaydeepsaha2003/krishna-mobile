import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  BellOff,
  CheckCheck,
  CircleAlert,
  Clock,
  Info,
  PackageX,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn, relativeTime } from '@/lib/utils'
import { Button, Badge } from '@/components/ui/base'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/overlay'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { EmptyState } from '@/components/ui/misc'

interface Notif {
  id: string
  type: string
  severity: 'info' | 'success' | 'warning' | 'danger'
  title: string
  body: string
  link?: string
  dueAt?: string
  shopName?: string
  isRead: boolean
  createdAt: string
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  credit_overdue: CircleAlert,
  credit_due: Clock,
  low_stock: PackageX,
  transfer_pending: ArrowLeftRight,
  supplier_due: AlertTriangle,
  ageing_stock: Clock
}

const SEVERITY_STYLE = {
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning/12 text-warning',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success'
} as const

export function NotificationCenter({
  open,
  onOpenChange,
  onRead
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onRead?: () => void
}) {
  const navigate = useNavigate()
  const [items, setItems] = React.useState<Notif[]>([])
  const [loading, setLoading] = React.useState(false)
  const [tab, setTab] = React.useState('unread')

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setItems(await api.notifications.list({ unreadOnly: tab === 'unread', limit: 120 }))
    } catch {
      /* signed out */
    } finally {
      setLoading(false)
    }
  }, [tab])

  React.useEffect(() => {
    if (open) void load()
  }, [open, load])

  const rescan = async () => {
    setLoading(true)
    const res = await api.notifications.scan()
    await load()
    onRead?.()
    toast.success(
      res?.created ? `${res.created} new reminder(s) raised` : 'Everything is up to date'
    )
  }

  const markAll = async () => {
    await api.notifications.markAllRead()
    await load()
    onRead?.()
  }

  const openItem = async (n: Notif) => {
    if (!n.isRead) {
      await api.notifications.markRead([n.id])
      onRead?.()
    }
    if (n.link) {
      onOpenChange(false)
      navigate(n.link)
    } else {
      await load()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[80vh]" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Reminders</DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void rescan()} loading={loading}>
                <RefreshCw className="size-4" /> Re-check
              </Button>
              <Button variant="outline" size="sm" onClick={() => void markAll()}>
                <CheckCheck className="size-4" /> Mark all read
              </Button>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1">
          {items.length === 0 && !loading ? (
            <EmptyState
              icon={BellOff}
              title="Nothing needs your attention"
              description="Overdue credit, low stock, pending transfers and supplier bills all show up here automatically."
            />
          ) : (
            items.map((n) => {
              const Icon = TYPE_ICON[n.type] ?? Info
              return (
                <button
                  key={n.id}
                  onClick={() => void openItem(n)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:bg-muted/60',
                    !n.isRead && 'border-l-2 border-l-primary bg-card'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg',
                      SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{n.title}</span>
                      {!n.isRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">{n.body}</span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
                      {n.shopName && <Badge variant="muted">{n.shopName}</Badge>}
                      <span>{relativeTime(n.createdAt)}</span>
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
