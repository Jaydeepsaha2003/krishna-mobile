import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useScope } from '@/lib/hooks'
import { formatDate } from '@/lib/utils'
import { Badge, Button, Field, Input } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { SimpleSelect } from '@/components/ui/form'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlay'
import { Money } from '@/components/ui/misc'

/** One lot = every unit added together in one purchase bill or one manual-add call. */
export function StockLotsDialog({
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
  const [shopId, setShopId] = React.useState(defaultShopId ?? '')
  const [editKey, setEditKey] = React.useState<string | null>(null)
  const [costPrice, setCostPrice] = React.useState('')
  const [salePrice, setSalePrice] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!model) return
    setShopId(defaultShopId ?? shops[0]?.id ?? '')
    setEditKey(null)
  }, [model, defaultShopId, shops])

  const lots = useQuery({
    queryKey: ['stock-lots', model?.modelId, shopId],
    queryFn: () => api.stock.lots({ modelId: model.modelId, shopId }),
    enabled: Boolean(model) && Boolean(shopId)
  })

  const rows = (lots.data ?? []).map((l: any) => ({
    ...l,
    key: l.purchaseId ?? l.addedAt
  }))

  const startEdit = (row: any) => {
    setEditKey(row.key)
    setCostPrice(String(row.costPrice ?? ''))
    setSalePrice(String(row.salePrice ?? ''))
  }

  const save = async (row: any) => {
    setSaving(true)
    try {
      const res = await api.stock.editLot({
        modelId: model.modelId,
        shopId,
        purchaseId: row.purchaseId ?? undefined,
        addedAt: row.purchaseId ? undefined : row.addedAt,
        costPrice: Number(costPrice) || 0,
        salePrice: Number(salePrice) || 0
      })
      toast.success(`Rate corrected on ${res.updated} unit(s) from this lot`)
      setEditKey(null)
      void qc.invalidateQueries({ queryKey: ['stock-lots'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })
      void qc.invalidateQueries({ queryKey: ['stock-ageing'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(model)} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            Stock by lot — {model?.brandName} {model?.modelName}
          </DialogTitle>
          <DialogDescription>
            Every batch the shelf was built from. Correct a single lot's rate without touching the rest.
          </DialogDescription>
        </DialogHeader>

        {shops.length > 1 && (
          <Field label="Shop">
            <SimpleSelect
              value={shopId}
              onChange={setShopId}
              options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            />
          </Field>
        )}

        <DataTable
          rows={rows}
          rowKey={(r: any) => r.key}
          loading={lots.isLoading}
          empty="Nothing currently in stock for this model at this shop"
          maxHeight="60vh"
          columns={[
            {
              key: 'addedAt',
              header: 'Added',
              render: (r: any) => <span className="text-[13px]">{formatDate(r.addedAt)}</span>
            },
            {
              key: 'source',
              header: 'Source',
              render: (r: any) =>
                r.invoiceNo ? (
                  <Badge variant="secondary">Bill {r.invoiceNo}</Badge>
                ) : (
                  <Badge variant="muted">Manual entry</Badge>
                )
            },
            {
              key: 'supplierName',
              header: 'Supplier',
              render: (r: any) => r.supplierName ?? '—'
            },
            {
              key: 'qty',
              header: 'Qty available',
              align: 'right',
              render: (r: any) => <span className="tnum font-medium">{r.qty}</span>
            },
            {
              key: 'costPrice',
              header: 'Cost',
              align: 'right',
              render: (r: any) =>
                editKey === r.key ? (
                  <Input
                    autoFocus
                    type="number"
                    min={0}
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="h-8 w-24 text-right tnum"
                  />
                ) : (
                  <Money value={r.costPrice} />
                )
            },
            {
              key: 'salePrice',
              header: 'Sell at',
              align: 'right',
              render: (r: any) =>
                editKey === r.key ? (
                  <Input
                    type="number"
                    min={0}
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="h-8 w-24 text-right tnum"
                  />
                ) : (
                  <Money value={r.salePrice} />
                )
            },
            {
              key: 'actions',
              header: '',
              width: '76px',
              render: (r: any) =>
                editKey === r.key ? (
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Save"
                      disabled={saving}
                      onClick={() => void save(r)}
                    >
                      <Check />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Cancel"
                      onClick={() => setEditKey(null)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="icon-sm" title="Edit this lot's rate" onClick={() => startEdit(r)}>
                    <Pencil />
                  </Button>
                )
            }
          ]}
        />
      </DialogContent>
    </Dialog>
  )
}

