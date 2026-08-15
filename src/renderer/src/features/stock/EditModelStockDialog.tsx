import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useReconReasons, useScope } from '@/lib/hooks'
import { Button, Field, Input, Textarea } from '@/components/ui/base'
import { SimpleSelect } from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'

export function EditModelStockDialog({
  model,
  defaultShopId,
  onOpenChange
}: {
  model: any
  defaultShopId?: string
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const { shops } = useScope()
  const reasons = useReconReasons()

  const [shopId, setShopId] = React.useState('')
  const [targetQty, setTargetQty] = React.useState('')
  const [costPrice, setCostPrice] = React.useState('')
  const [salePrice, setSalePrice] = React.useState('')
  const [reasonCode, setReasonCode] = React.useState('')
  const [note, setNote] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!model) return
    setShopId(defaultShopId ?? shops[0]?.id ?? '')
    setTargetQty('')
    setCostPrice('')
    setSalePrice('')
    setReasonCode('')
    setNote('')
  }, [model, defaultShopId, shops])

  const submit = async () => {
    if (!shopId) return toast.error('Choose the shop')
    const qtyGiven = targetQty.trim() !== ''
    const rateGiven = costPrice.trim() !== '' || salePrice.trim() !== ''
    if (!qtyGiven && !rateGiven) return toast.error('Enter a new quantity or price')

    setSaving(true)
    try {
      const res = await api.stock.editModel({
        modelId: model.modelId,
        shopId,
        targetQty: qtyGiven ? Number(targetQty) : undefined,
        costPrice: costPrice.trim() !== '' ? Number(costPrice) : undefined,
        salePrice: salePrice.trim() !== '' ? Number(salePrice) : undefined,
        reasonCode: reasonCode || undefined,
        note: note || undefined
      })
      toast.success(`${res.label}: ${res.previousQty} → ${res.newQty} in stock`)
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })
      void qc.invalidateQueries({ queryKey: ['stock-ageing'] })
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(model)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Edit stock — {model?.brandName} {model?.modelName}</DialogTitle>
          <DialogDescription>
            Correct the quantity or price already on record for this shop.
            {model?.trackImei && ' IMEI-tracked — quantity can only be reduced here; use "Add stock" to add more.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Shop" required>
            <SimpleSelect
              value={shopId}
              onChange={setShopId}
              options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            />
          </Field>
          <Field label="Correct quantity to" hint="Leave blank to keep the quantity unchanged">
            <Input
              type="number"
              min={0}
              value={targetQty}
              onChange={(e) => setTargetQty(e.target.value)}
              placeholder="e.g. 8"
              className="text-right tnum"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cost price ₹" hint="Applies to units already in stock">
              <Input
                type="number"
                min={0}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="Unchanged"
                className="text-right tnum"
              />
            </Field>
            <Field label="Selling price ₹">
              <Input
                type="number"
                min={0}
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="Unchanged"
                className="text-right tnum"
              />
            </Field>
          </div>
          <Field label="Reason" hint="Required when reducing quantity">
            <SimpleSelect
              value={reasonCode}
              onChange={setReasonCode}
              options={(reasons.data ?? []).map((r: any) => ({ value: r.code, label: r.label }))}
              placeholder="Choose a reason"
            />
          </Field>
          <Field label="Note" hint="Kept in the audit trail">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[48px]" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
