import * as React from 'react'
import { toast } from 'sonner'
import { Smartphone } from 'lucide-react'
import { api } from '@/lib/api'
import { useBrands } from '@/lib/hooks'
import { GST_RATES } from '@shared/constants'
import { Button, Field, Input } from '@/components/ui/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Switch } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'

const EMPTY = {
  brandId: '',
  name: '',
  sku: '',
  category: 'Smartphone',
  hsn: '',
  ram: '',
  storage: '',
  color: '',
  gstRate: '0',
  defaultCost: '',
  defaultPrice: '',
  mrp: '',
  lowStockAlert: '2',
  warrantyMonths: '12',
  // Default OFF — most items are added/sold by quantity. Turn on per handset model.
  trackImei: false
}

export function ModelFormDialog({
  open,
  onOpenChange,
  initial,
  presetName,
  onSaved
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: any
  presetName?: string
  onSaved?: (id: string) => void
}) {
  const brands = useBrands()
  const [draft, setDraft] = React.useState<any>(EMPTY)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    if (initial) {
      setDraft({
        id: initial.id,
        brandId: initial.brandId,
        name: initial.name,
        sku: initial.sku,
        category: initial.category ?? 'Smartphone',
        hsn: initial.hsn ?? '',
        ram: initial.ram ?? '',
        storage: initial.storage ?? '',
        color: initial.color ?? '',
        gstRate: String(initial.gstRate ?? 0),
        defaultCost: String(initial.defaultCost ?? ''),
        defaultPrice: String(initial.defaultPrice ?? ''),
        mrp: String(initial.mrp ?? ''),
        lowStockAlert: String(initial.lowStockAlert ?? 2),
        warrantyMonths: String(initial.warrantyMonths ?? 12),
        trackImei: initial.trackImei !== false
      })
    } else {
      setDraft({ ...EMPTY, name: presetName ?? '' })
    }
  }, [open, initial, presetName])

  const set = (key: string, value: any) => setDraft((d: any) => ({ ...d, [key]: value }))

  const submit = async () => {
    if (!draft.brandId) return setError('Choose a brand')
    if (!draft.name.trim()) return setError('Model name is required')
    setSaving(true)
    try {
      const res = await api.models.save({
        ...draft,
        gstRate: Number(draft.gstRate),
        defaultCost: Number(draft.defaultCost) || 0,
        defaultPrice: Number(draft.defaultPrice) || 0,
        mrp: Number(draft.mrp) || 0,
        lowStockAlert: Number(draft.lowStockAlert) || 0,
        warrantyMonths: Number(draft.warrantyMonths) || 0
      })
      toast.success(draft.id ? 'Model updated' : 'Model created')
      onSaved?.(res.id)
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addBrand = async (name: string) => {
    try {
      const res = await api.brands.save({ name })
      await brands.refetch()
      set('brandId', res.id)
      toast.success(`Brand "${name}" added`)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-4" />
            {draft.id ? 'Edit model' : 'New model'}
          </DialogTitle>
          <DialogDescription>
            A model is the product; each physical handset you buy becomes its own tracked unit.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 grid flex-1 gap-4 overflow-y-auto px-1 sm:grid-cols-2">
          <Field label="Brand" required>
            <Combobox
              value={draft.brandId}
              onChange={(v) => set('brandId', v)}
              options={(brands.data ?? []).map((b: any) => ({
                value: b.id,
                label: b.name,
                meta: `${b.modelCount} models`
              }))}
              placeholder="Choose brand"
              searchPlaceholder="Type a brand…"
              onCreate={addBrand}
              createLabel="Add brand"
            />
          </Field>

          <Field label="Model name" required hint="Saved in capitals">
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value.toUpperCase())}
              placeholder="e.g. GALAXY M14 5G"
              className="uppercase"
            />
          </Field>

          <Field label="SKU" hint="Left blank, one is generated for you">
            <Input
              value={draft.sku}
              onChange={(e) => set('sku', e.target.value.toUpperCase())}
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Category">
            <SimpleSelect
              value={draft.category}
              onChange={(v) => set('category', v)}
              options={['Smartphone', 'Feature Phone', 'Tablet', 'Wearable', 'Accessory', 'Other']}
            />
          </Field>

          <Field label="RAM">
            <Input
              value={draft.ram}
              onChange={(e) => set('ram', e.target.value.toUpperCase())}
              placeholder="6GB"
              className="uppercase"
            />
          </Field>

          <Field label="Storage">
            <Input
              value={draft.storage}
              onChange={(e) => set('storage', e.target.value.toUpperCase())}
              placeholder="128GB"
              className="uppercase"
            />
          </Field>

          <Field label="Colour" hint="Default colour; each unit can override it">
            <Input
              value={draft.color}
              onChange={(e) => set('color', e.target.value.toUpperCase())}
              className="uppercase"
            />
          </Field>

          <Field label="HSN code">
            <Input value={draft.hsn} onChange={(e) => set('hsn', e.target.value)} placeholder="85171300" />
          </Field>

          <Field label="GST rate">
            <SimpleSelect
              value={draft.gstRate}
              onChange={(v) => set('gstRate', v)}
              options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
            />
          </Field>

          <Field label="MRP ₹">
            <Input
              type="number"
              value={draft.mrp}
              onChange={(e) => set('mrp', e.target.value)}
              className="text-right tnum"
            />
          </Field>

          <Field label="Usual cost ₹">
            <Input
              type="number"
              value={draft.defaultCost}
              onChange={(e) => set('defaultCost', e.target.value)}
              className="text-right tnum"
            />
          </Field>

          <Field label="Usual selling price ₹">
            <Input
              type="number"
              value={draft.defaultPrice}
              onChange={(e) => set('defaultPrice', e.target.value)}
              className="text-right tnum"
            />
          </Field>

          <Field label="Low-stock alert at" hint="Raises a reminder at or below this count">
            <Input
              type="number"
              min={0}
              value={draft.lowStockAlert}
              onChange={(e) => set('lowStockAlert', e.target.value)}
              className="text-right tnum"
            />
          </Field>

          <Field label="Warranty (months)">
            <Input
              type="number"
              min={0}
              value={draft.warrantyMonths}
              onChange={(e) => set('warrantyMonths', e.target.value)}
              className="text-right tnum"
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <div>
              <p className="text-[13px] font-medium">Track by IMEI</p>
              <p className="text-xs text-muted-foreground">
                On for handsets. Turn off for accessories bought in bulk.
              </p>
            </div>
            <Switch checked={draft.trackImei} onCheckedChange={(v) => set('trackImei', v)} />
          </div>

          {error && <p className="text-[13px] font-medium text-destructive sm:col-span-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {draft.id ? 'Save changes' : 'Create model'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
