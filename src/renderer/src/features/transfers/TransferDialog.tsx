import * as React from 'react'
import { toast } from 'sonner'
import { ArrowRight, Truck } from 'lucide-react'
import { api } from '@/lib/api'
import { useScope } from '@/lib/hooks'
import { money, todayStr } from '@/lib/utils'
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Switch } from '@/components/ui/form'

export function TransferDialog({
  open,
  onOpenChange,
  unitIds,
  units,
  onDone
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  unitIds: string[]
  units: any[]
  onDone?: () => void
}) {
  const { shops } = useScope()
  const fromShopId = units[0]?.shopId ?? ''

  const [toShopId, setToShopId] = React.useState('')
  const [date, setDate] = React.useState(todayStr())
  const [notes, setNotes] = React.useState('')
  const [autoReceive, setAutoReceive] = React.useState(false)
  const [markUp, setMarkUp] = React.useState<number | ''>('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setToShopId(shops.find((s) => s.id !== fromShopId)?.id ?? '')
    setDate(todayStr())
    setNotes('')
    setAutoReceive(false)
    setMarkUp('')
  }, [open, shops, fromShopId])

  const mixedShops = new Set(units.map((u) => u.shopId)).size > 1
  const totalCost = units.reduce((a, u) => a + Number(u.costPrice || 0), 0)
  const markUpValue = Number(markUp) || 0

  const submit = async () => {
    if (!toShopId) return toast.error('Choose the destination shop')
    if (mixedShops)
      return toast.error('All selected units must currently be at the same shop')

    setSaving(true)
    try {
      const transferPrices = markUpValue
        ? Object.fromEntries(
            units.map((u) => [u.id, Math.round(Number(u.costPrice) * (1 + markUpValue / 100))])
          )
        : undefined

      const res = await api.transfers.create({
        fromShopId,
        toShopId,
        transferDate: date,
        stockUnitIds: unitIds,
        transferPrices,
        notes,
        autoReceive
      })
      toast.success(
        autoReceive
          ? `${res.units} unit(s) moved — ${res.transferNo}`
          : `${res.transferNo} dispatched · waiting to be received`
      )
      onDone?.()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const fromShop = shops.find((s) => s.id === fromShopId)
  const toShop = shops.find((s) => s.id === toShopId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-4" /> Transfer stock
          </DialogTitle>
          <DialogDescription>
            {unitIds.length} unit(s) worth {money(totalCost)} at cost
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mixedShops && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive">
              The selected units are in different shops. Select units from one shop at a time.
            </p>
          )}

          <div className="flex items-center gap-3 rounded-xl border border-border p-3">
            <div className="flex-1 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">From</p>
              <p className="font-medium">{fromShop?.name ?? '—'}</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <SimpleSelect
                value={toShopId}
                onChange={setToShopId}
                options={shops
                  .filter((s) => s.id !== fromShopId)
                  .map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                placeholder="Destination shop"
              />
            </div>
          </div>

          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {units.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">
                  {u.label}
                  {u.imei1 && (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">{u.imei1}</span>
                  )}
                </span>
                <span className="shrink-0 tnum text-muted-foreground">{money(u.costPrice)}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Transfer date">
              <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field
              label="Mark-up %"
              hint="Leave blank to move at cost (recommended for own shops)"
            >
              <Input
                type="number"
                min={0}
                value={markUp}
                onChange={(e) => setMarkUp(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0"
                className="text-right tnum"
              />
            </Field>
          </div>

          {markUpValue > 0 && (
            <p className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
              {fromShop?.name} books a margin of{' '}
              <span className="font-medium text-foreground">
                {money((totalCost * markUpValue) / 100)}
              </span>{' '}
              and {toShop?.name ?? 'the destination'} carries a cost of{' '}
              {money(totalCost * (1 + markUpValue / 100))}. This shows up in the per-shop P&L.
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-[13px] font-medium">Receive immediately</p>
              <p className="text-xs text-muted-foreground">
                Off means the destination shop confirms arrival before the stock is theirs.
              </p>
            </div>
            <Switch checked={autoReceive} onCheckedChange={setAutoReceive} />
          </div>

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[52px]"
              placeholder="Who is carrying it, vehicle number…"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={mixedShops}>
            <Truck /> {autoReceive ? 'Move now' : 'Dispatch'} {unitIds.length} unit(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TransferStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: any; label: string }> = {
    draft: { variant: 'muted', label: 'Draft' },
    in_transit: { variant: 'warning', label: 'In transit' },
    received: { variant: 'success', label: 'Received' },
    cancelled: { variant: 'muted', label: 'Cancelled' }
  }
  const s = map[status] ?? { variant: 'secondary', label: status }
  return <Badge variant={s.variant}>{s.label}</Badge>
}
