import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Minus, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useScope } from '@/lib/hooks'
import { Badge, Button, Field, Input, Separator, Textarea } from '@/components/ui/base'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { Switch, SimpleSelect } from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'

interface Line {
  modelId: string
  label: string
  sku: string
  available: number
  qty: number
}

/**
 * Send stock from one shop to another by picking a product and a quantity.
 * Only products with stock at the sending shop are listed, and a line can never
 * exceed what is available there.
 */
export function NewTransferDialog({
  open,
  onOpenChange,
  onDone
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const { shopId, shops } = useScope()

  const [fromShop, setFromShop] = React.useState('')
  const [toShop, setToShop] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [lines, setLines] = React.useState<Line[]>([])
  const [notes, setNotes] = React.useState('')
  const [autoReceive, setAutoReceive] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const from = shopId ?? shops[0]?.id ?? ''
    setFromShop(from)
    setToShop(shops.find((s) => s.id !== from)?.id ?? '')
    setLines([])
    setNotes('')
    setAutoReceive(false)
    setSearch('')
  }, [open, shopId, shops])

  // Products in stock at the SENDING shop (IMEI items included — a transfer
  // moves whole units regardless of how they're tracked).
  const stock = useQuery({
    queryKey: ['transfer-stock', fromShop, search],
    queryFn: () => api.stock.availableModels(fromShop, search, 60, true),
    enabled: open && Boolean(fromShop)
  })

  const addLine = (m: any) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.modelId === m.modelId)
      if (existing) {
        if (existing.qty >= m.available) {
          toast.error(`Only ${m.available} in stock`)
          return ls
        }
        return ls.map((l) => (l.modelId === m.modelId ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...ls,
        {
          modelId: m.modelId,
          label: `${m.brandName} ${m.modelName}`,
          sku: m.sku,
          available: m.available,
          qty: 1
        }
      ]
    })
  }

  const setQty = (modelId: string, raw: string) => {
    setLines((ls) =>
      ls.map((l) => {
        if (l.modelId !== modelId) return l
        const v = Math.floor(Number(raw))
        const q = raw === '' || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(l.available, v))
        if (Number.isFinite(v) && v > l.available) toast.error(`Only ${l.available} in stock`)
        return { ...l, qty: q }
      })
    )
  }

  const step = (modelId: string, d: number) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.modelId !== modelId) return l
        const next = l.qty + d
        if (next > l.available) {
          toast.error(`Only ${l.available} in stock`)
          return l
        }
        return { ...l, qty: Math.max(1, next) }
      })
    )

  const totalUnits = lines.reduce((a, l) => a + l.qty, 0)

  const submit = async () => {
    if (!fromShop || !toShop) return toast.error('Choose both shops')
    if (fromShop === toShop) return toast.error('The two shops must be different')
    const valid = lines.filter((l) => l.qty > 0)
    if (!valid.length) return toast.error('Add at least one product')

    setSaving(true)
    try {
      const res = await api.transfers.createByModel({
        fromShopId: fromShop,
        toShopId: toShop,
        lines: valid.map((l) => ({ modelId: l.modelId, qty: l.qty })),
        notes: notes || undefined,
        autoReceive
      })
      toast.success(
        autoReceive
          ? `${res.units ?? totalUnits} unit(s) moved and received`
          : `${res.units ?? totalUnits} unit(s) sent — the receiving shop must confirm arrival`
      )
      void qc.invalidateQueries({ queryKey: ['transfers'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })
      onDone?.()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const options: ComboOption[] = (stock.data ?? []).map((m: any) => ({
    value: m.modelId,
    label: `${m.brandName} ${m.modelName}`,
    hint: m.sku,
    meta: <Badge variant={m.available <= 2 ? 'warning' : 'success'}>{m.available} in stock</Badge>,
    group: m.brandName,
    keywords: [m.sku].filter(Boolean),
    data: m
  }))

  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? '—'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle>New stock transfer</DialogTitle>
          <DialogDescription>
            Move stock between your shops. Pick a product and a quantity — only what is in stock at
            the sending shop can be sent.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="From shop" required>
              <SimpleSelect
                value={fromShop}
                onChange={(v) => {
                  setFromShop(v)
                  setLines([])
                  if (v === toShop) setToShop(shops.find((s) => s.id !== v)?.id ?? '')
                }}
                options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                placeholder="Sending shop"
              />
            </Field>
            <div className="hidden pb-2.5 sm:block">
              <ArrowRight className="size-4 text-muted-foreground" />
            </div>
            <Field label="To shop" required>
              <SimpleSelect
                value={toShop}
                onChange={setToShop}
                options={shops
                  .filter((s) => s.id !== fromShop)
                  .map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                placeholder="Receiving shop"
              />
            </Field>
          </div>

          <Field
            label="Add product"
            hint={`In stock at ${shopName(fromShop)} · ${stock.data?.length ?? 0} item(s)`}
          >
            <Combobox
              value={null}
              onChange={(_v, option) => option?.data && addLine(option.data)}
              options={options}
              onSearchChange={setSearch}
              loading={stock.isFetching}
              placeholder="Search a product to send"
              searchPlaceholder="Name or SKU…"
              emptyText="Nothing in stock at this shop"
            />
          </Field>

          {lines.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="w-32 px-2 py-2 text-center">Qty</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.modelId} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium">{l.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.sku} · {l.available} in stock
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            aria-label="Decrease"
                            disabled={l.qty <= 1}
                            onClick={() => step(l.modelId, -1)}
                            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-muted disabled:opacity-40"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <Input
                            type="number"
                            min={1}
                            max={l.available}
                            value={l.qty === 0 ? '' : l.qty}
                            onChange={(e) => setQty(l.modelId, e.target.value)}
                            onBlur={() => l.qty < 1 && setQty(l.modelId, '1')}
                            className="h-7 w-12 px-1 text-center tnum"
                          />
                          <button
                            type="button"
                            aria-label="Increase"
                            disabled={l.qty >= l.available}
                            onClick={() => step(l.modelId, 1)}
                            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-muted disabled:opacity-40"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-1 py-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setLines((ls) => ls.filter((x) => x.modelId !== l.modelId))}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalUnits > 0 && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">
                  {shopName(fromShop)} → {shopName(toShop)}
                </span>
                <span className="font-semibold">{totalUnits} unit(s)</span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-[13px] font-medium">Receive immediately</p>
              <p className="text-xs text-muted-foreground">
                On: stock lands at the receiving shop straight away. Off: it stays “in transit”
                until that shop confirms arrival.
              </p>
            </div>
            <Switch checked={autoReceive} onCheckedChange={setAutoReceive} />
          </div>

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — e.g. sent with the evening delivery"
              className="min-h-[48px]"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={saving}
            disabled={!fromShop || !toShop || totalUnits === 0}
          >
            Send {totalUnits > 0 ? `${totalUnits} unit(s)` : 'stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
