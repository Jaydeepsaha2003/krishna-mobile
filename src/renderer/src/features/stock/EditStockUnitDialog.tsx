import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { CONDITIONS } from '@shared/constants'
import { Button, Field, Input } from '@/components/ui/base'
import { SimpleSelect } from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'

export function EditStockUnitDialog({
  unit,
  onOpenChange
}: {
  unit: any
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [costPrice, setCostPrice] = React.useState('')
  const [salePrice, setSalePrice] = React.useState('')
  const [color, setColor] = React.useState('')
  const [condition, setCondition] = React.useState('New')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!unit) return
    setCostPrice(String(unit.costPrice ?? ''))
    setSalePrice(String(unit.salePrice ?? ''))
    setColor(unit.color ?? '')
    setCondition(unit.condition ?? 'New')
  }, [unit])

  const submit = async () => {
    setSaving(true)
    try {
      await api.stock.editUnit({
        stockUnitId: unit.id,
        costPrice: Number(costPrice) || 0,
        salePrice: Number(salePrice) || 0,
        color: color || undefined,
        condition
      })
      toast.success(`${unit.label} updated`)
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
    <Dialog open={Boolean(unit)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Edit stock unit</DialogTitle>
          <DialogDescription>
            {unit?.label} · {unit?.imei1 ?? 'no IMEI'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cost price ₹" required hint="GST inclusive">
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
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Colour">
              <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Condition">
              <SimpleSelect value={condition} onChange={setCondition} options={[...CONDITIONS]} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
