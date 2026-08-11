import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Minus, PackagePlus, Plus, ScanLine, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useBrands, useModels, useReconReasons, useScope } from '@/lib/hooks'
import { cn, money } from '@/lib/utils'
import { CONDITIONS, STOCK_STATUS_LABELS } from '@shared/constants'
import { imeiCheck, normalizeImei } from '@shared/validators'
import { Button, Field, Input, Separator, Textarea } from '@/components/ui/base'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { SimpleSelect, Switch } from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'

type Mode = 'add' | 'remove'

export function ManualStockDialog({
  open,
  onOpenChange,
  mode,
  shopId
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  mode: Mode
  shopId?: string
}) {
  const qc = useQueryClient()
  const { shops } = useScope()
  const reasons = useReconReasons()

  const [search, setSearch] = React.useState('')
  const models = useModels(search)
  const brands = useBrands()

  /* Inline "new product" — so a product that isn't in the catalogue yet can be
     created and stocked in one go, instead of visiting Brands & models first. */
  const [creating, setCreating] = React.useState(false)
  const [newBrandId, setNewBrandId] = React.useState('')
  const [newModelName, setNewModelName] = React.useState('')
  const [newTrackImei, setNewTrackImei] = React.useState(false)
  const [creatingBusy, setCreatingBusy] = React.useState(false)

  const [targetShop, setTargetShop] = React.useState(shopId ?? '')
  const [model, setModel] = React.useState<any>(null)
  const [qty, setQty] = React.useState<number>(1)
  const [costPrice, setCostPrice] = React.useState('')
  const [salePrice, setSalePrice] = React.useState('')
  const [condition, setCondition] = React.useState<string>('New')
  const [color, setColor] = React.useState('')
  const [imeis, setImeis] = React.useState<string[]>([''])
  const [toStatus, setToStatus] = React.useState('damaged')
  const [reasonCode, setReasonCode] = React.useState('')
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setTargetShop(shopId ?? shops[0]?.id ?? '')
    setModel(null)
    setQty(1)
    setCostPrice('')
    setSalePrice('')
    setCondition('New')
    setColor('')
    setImeis([''])
    setToStatus('damaged')
    setReasonCode(mode === 'add' ? 'UNRECORDED_PURCHASE' : 'DAMAGE')
    setNote('')
    setCreating(false)
    setNewBrandId('')
    setNewModelName('')
    setNewTrackImei(false)
  }, [open, mode, shopId, shops])

  const tracksImei = Boolean(model?.trackImei)

  // Keep the IMEI boxes in step with the quantity.
  React.useEffect(() => {
    if (!tracksImei) return
    setImeis((prev) => {
      const next = [...prev]
      while (next.length < qty) next.push('')
      return next.slice(0, Math.max(1, qty))
    })
  }, [qty, tracksImei])

  const pickModel = (m: any) => {
    setModel(m)
    if (mode === 'add') {
      setCostPrice(m.defaultCost ? String(m.defaultCost) : '')
      setSalePrice(m.defaultPrice ? String(m.defaultPrice) : '')
    }
  }

  const stepQty = (d: number) => setQty((q) => Math.max(1, Math.min(500, q + d)))

  const addBrandInline = async (name: string) => {
    try {
      const res = await api.brands.save({ name })
      await brands.refetch()
      setNewBrandId(res.id)
      toast.success(`Brand "${name.toUpperCase()}" added`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  /** Creates the product and selects it, without leaving this dialog. */
  const createProduct = async () => {
    if (!newBrandId) return toast.error('Choose or add a brand')
    if (newModelName.trim().length < 1) return toast.error('Enter the product name')

    setCreatingBusy(true)
    try {
      const res = await api.models.save({
        brandId: newBrandId,
        name: newModelName.trim(),
        trackImei: newTrackImei,
        defaultCost: Number(costPrice) || 0,
        defaultPrice: Number(salePrice) || 0
      })
      const brandName = (brands.data ?? []).find((b: any) => b.id === newBrandId)?.name ?? ''
      // Select it straight away so the user can carry on with quantity/price.
      setModel({
        id: res.id,
        name: newModelName.trim().toUpperCase(),
        brandName,
        trackImei: newTrackImei
      })
      await models.refetch()
      setCreating(false)
      setNewModelName('')
      toast.success(`${brandName} ${newModelName.trim().toUpperCase()} created`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setCreatingBusy(false)
    }
  }

  const submit = async () => {
    if (!targetShop) return toast.error('Choose the shop')
    if (!model) return toast.error('Choose the product')
    if (qty < 1) return toast.error('Quantity must be at least 1')

    setSaving(true)
    try {
      if (mode === 'add') {
        const res = await api.stock.addManual({
          shopId: targetShop,
          modelId: model.id,
          qty,
          costPrice: Number(costPrice) || 0,
          salePrice: Number(salePrice) || 0,
          condition,
          color: color || undefined,
          imeis: tracksImei ? imeis.map((v) => normalizeImei(v)) : undefined,
          reasonCode,
          note: note || undefined
        })
        toast.success(`Added ${res.added} × ${res.label} to stock`)
      } else {
        const res = await api.stock.removeManual({
          shopId: targetShop,
          modelId: model.id,
          qty,
          toStatus,
          reasonCode,
          note: note || undefined
        })
        toast.success(`Removed ${res.removed} × ${res.label} from stock`)
      }
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })
      void qc.invalidateQueries({ queryKey: ['stock-ageing'] })
      void qc.invalidateQueries({ queryKey: ['dash'] })
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const modelOptions: ComboOption[] = (models.data ?? []).map((m: any) => ({
    value: m.id,
    label: `${m.brandName} ${m.name}`,
    hint: `${m.sku}${m.trackImei ? ' · IMEI tracked' : ''}`,
    meta: `${m.inStock} in stock`,
    group: m.brandName,
    keywords: [m.sku],
    data: m
  }))

  const totalValue = (Number(costPrice) || 0) * qty

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Add stock manually' : 'Remove stock'}</DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? 'For opening stock or a local cash buy with no supplier bill. Prices are GST inclusive.'
              : 'Take stock off the shelf for damage, loss or personal use. Nothing is deleted — the history is kept.'}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shop" required>
              <SimpleSelect
                value={targetShop}
                onChange={setTargetShop}
                options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                placeholder="Choose shop"
              />
            </Field>
            <Field label="Product" required>
              <Combobox
                value={model?.id ?? null}
                onChange={(_v, option) => option?.data && pickModel(option.data)}
                options={modelOptions}
                onSearchChange={setSearch}
                loading={models.isFetching}
                placeholder="Search a product"
                searchPlaceholder="Brand, model or SKU…"
                emptyText="Not in the catalogue yet — create it below"
                onCreate={
                  mode === 'add'
                    ? (text) => {
                        setNewModelName(text ?? '')
                        setCreating(true)
                      }
                    : undefined
                }
                createLabel="Create new product"
              />
            </Field>
          </div>

          {/* Create a product without leaving this dialog. */}
          {mode === 'add' && !creating && !model && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-[13px] text-muted-foreground transition-colors hover:border-ring/50 hover:bg-muted/40 hover:text-foreground"
            >
              <PackagePlus className="size-4" /> Product not in the list? Create it here
            </button>
          )}

          {mode === 'add' && creating && (
            <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-primary">
                  <PackagePlus className="size-4" /> New product
                </p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Close"
                  onClick={() => setCreating(false)}
                >
                  <X />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Brand" required hint="Type a new name to add it">
                  <Combobox
                    value={newBrandId}
                    onChange={setNewBrandId}
                    options={(brands.data ?? []).map((b: any) => ({
                      value: b.id,
                      label: b.name,
                      meta: `${b.modelCount} models`
                    }))}
                    placeholder="Choose brand"
                    searchPlaceholder="Type a brand…"
                    onCreate={addBrandInline}
                    createLabel="Add brand"
                  />
                </Field>
                <Field label="Product name" required>
                  <Input
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && void createProduct()}
                    placeholder="e.g. TYPE-C CHARGER 25W"
                    className="uppercase"
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background p-2.5">
                <div>
                  <p className="text-[13px] font-medium">Track each unit by IMEI</p>
                  <p className="text-xs text-muted-foreground">
                    On for phones. Leave off for accessories counted by quantity.
                  </p>
                </div>
                <Switch checked={newTrackImei} onCheckedChange={setNewTrackImei} />
              </div>

              <Button
                className="w-full"
                onClick={() => void createProduct()}
                loading={creatingBusy}
                disabled={!newBrandId || newModelName.trim().length < 1}
              >
                Create &amp; use this product
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity" required>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Decrease"
                  onClick={() => stepQty(-1)}
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-muted"
                >
                  <Minus className="size-4" />
                </button>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={qty === 0 ? '' : qty}
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value))
                    setQty(e.target.value === '' || !Number.isFinite(v) ? 0 : Math.min(500, Math.max(0, v)))
                  }}
                  onBlur={() => qty < 1 && setQty(1)}
                  className="h-9 text-center tnum font-semibold"
                />
                <button
                  type="button"
                  aria-label="Increase"
                  onClick={() => stepQty(1)}
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-muted"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </Field>

            {mode === 'add' ? (
              <Field label="Condition">
                <SimpleSelect value={condition} onChange={setCondition} options={[...CONDITIONS]} />
              </Field>
            ) : (
              <Field label="Move to" required hint="What happened to these items">
                <SimpleSelect
                  value={toStatus}
                  onChange={setToStatus}
                  options={Object.entries(STOCK_STATUS_LABELS)
                    .filter(([v]) => v !== 'sold' && v !== 'in_stock')
                    .map(([value, label]) => ({ value, label }))}
                />
              </Field>
            )}
          </div>

          {mode === 'add' && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Cost per unit ₹" required hint="GST inclusive">
                  <Input
                    type="number"
                    min={0}
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="text-right tnum"
                  />
                </Field>
                <Field label="Selling price ₹" hint="GST inclusive">
                  <Input
                    type="number"
                    min={0}
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="text-right tnum"
                  />
                </Field>
                <Field label="Colour">
                  <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Optional" />
                </Field>
              </div>

              {tracksImei && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    IMEI of each unit ({qty})
                  </p>
                  <div className="max-h-52 space-y-2 overflow-y-auto">
                    {imeis.slice(0, qty).map((v, i) => {
                      const check = v ? imeiCheck(v) : null
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                          <Input
                            value={v}
                            onChange={(e) =>
                              setImeis((prev) =>
                                prev.map((x, xi) =>
                                  xi === i ? normalizeImei(e.target.value).slice(0, 15) : x
                                )
                              )
                            }
                            placeholder="15-digit IMEI"
                            inputMode="numeric"
                            prefixNode={<ScanLine />}
                            className={cn(
                              'font-mono',
                              check && !check.ok && 'border-destructive',
                              check?.ok && check.warning && 'border-warning'
                            )}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {totalValue > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">Stock value being added</span>
                    <span className="text-lg font-semibold tnum">{money(totalValue)}</span>
                  </div>
                </>
              )}
            </>
          )}

          <Field label="Reason" required={mode === 'remove'}>
            <SimpleSelect
              value={reasonCode}
              onChange={setReasonCode}
              options={(reasons.data ?? [])
                .filter((r: any) =>
                  mode === 'add'
                    ? r.direction === 'excess' || r.direction === 'both'
                    : r.direction === 'shortage' || r.direction === 'both'
                )
                .map((r: any) => ({ value: r.code, label: r.label }))}
            />
          </Field>

          <Field label="Note" hint="Kept in the audit trail">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === 'add' ? 'e.g. opening stock count' : 'e.g. screen cracked in store'}
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
            disabled={!model || !targetShop}
            className={mode === 'remove' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {mode === 'add' ? `Add ${qty} to stock` : `Remove ${qty} from stock`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
