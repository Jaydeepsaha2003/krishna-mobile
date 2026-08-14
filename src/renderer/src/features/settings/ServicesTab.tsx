import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2, Wrench, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { money } from '@/lib/utils'
import { DEFAULT_RECHARGE_PROFIT, SETTING_RECHARGE_PROFIT } from '@shared/constants'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { SimpleSelect } from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'

const KIND_LABELS: Record<string, string> = {
  repair: 'Repair',
  recharge: 'Recharge',
  service: 'Other service'
}

const EMPTY = { id: undefined as string | undefined, kind: 'repair', name: '', defaultPrice: '' as number | '', gstRate: 0 }

export function ServicesTab() {
  const qc = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(EMPTY)
  const [saving, setSaving] = React.useState(false)

  const list = useQuery({
    queryKey: ['services-all'],
    queryFn: () => api.services.list({ includeInactive: false })
  })

  const openNew = () => {
    setDraft({ ...EMPTY })
    setOpen(true)
  }
  const openEdit = (s: any) => {
    setDraft({ id: s.id, kind: s.kind, name: s.name, defaultPrice: s.defaultPrice || '', gstRate: s.gstRate })
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.services.save({
        id: draft.id,
        kind: draft.kind,
        name: draft.name,
        defaultPrice: Number(draft.defaultPrice) || 0,
        gstRate: Number(draft.gstRate) || 0
      })
      toast.success(draft.id ? 'Service updated' : 'Service added')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['services-all'] })
      void qc.invalidateQueries({ queryKey: ['svc-presets'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: any) => {
    try {
      await api.services.remove(s.id)
      toast.success(`Removed “${s.name}”`)
      void qc.invalidateQueries({ queryKey: ['services-all'] })
      void qc.invalidateQueries({ queryKey: ['svc-presets'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <RechargeProfitCard />

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          Quick presets for the New Sale screen — common repairs and recharge amounts. They just
          pre-fill the name and price; you can still type anything on the spot.
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus /> Add service
        </Button>
      </div>

      <DataTable
        rows={list.data ?? []}
        rowKey={(s: any) => s.id}
        loading={list.isLoading}
        empty="No saved services yet — add your common repairs and recharge amounts."
        columns={[
          {
            key: 'name',
            header: 'Service',
            render: (s: any) => (
              <span className="flex items-center gap-2 font-medium">
                {s.kind === 'recharge' ? (
                  <Zap className="size-3.5 text-info" />
                ) : (
                  <Wrench className="size-3.5 text-warning" />
                )}
                {s.name}
              </span>
            )
          },
          {
            key: 'kind',
            header: 'Type',
            render: (s: any) => <Badge variant="secondary">{KIND_LABELS[s.kind] ?? s.kind}</Badge>
          },
          {
            key: 'defaultPrice',
            header: 'Default price',
            align: 'right',
            render: (s: any) => (s.defaultPrice > 0 ? money(s.defaultPrice) : '—')
          },
          { key: 'gstRate', header: 'GST%', align: 'right', render: (s: any) => `${s.gstRate}%` },
          {
            key: 'actions',
            header: '',
            width: '90px',
            render: (s: any) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => openEdit(s)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Remove"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void remove(s)}
                >
                  <Trash2 />
                </Button>
              </div>
            )
          }
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Edit service' : 'New service'}</DialogTitle>
            <DialogDescription>Used as a quick-pick chip while billing a service.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Type">
              <SimpleSelect
                value={draft.kind}
                onChange={(v) => setDraft({ ...draft, kind: v })}
                options={[
                  { value: 'repair', label: 'Repair' },
                  { value: 'recharge', label: 'Recharge' },
                  { value: 'service', label: 'Other service' }
                ]}
              />
            </Field>
            <Field label="Name" required>
              <Input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Screen replacement"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default price ₹">
                <Input
                  type="number"
                  min={0}
                  value={draft.defaultPrice}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultPrice: e.target.value === '' ? '' : Number(e.target.value) })
                  }
                  className="text-right tnum"
                />
              </Field>
              <Field label="GST %">
                <Input
                  type="number"
                  min={0}
                  value={draft.gstRate}
                  onChange={(e) => setDraft({ ...draft, gstRate: Number(e.target.value) || 0 })}
                  className="text-right tnum"
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={draft.name.trim().length < 2}>
              {draft.id ? 'Save' : 'Add service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * How much the shop keeps on a recharge. A recharge is not a goods sale — the
 * customer's money mostly goes to the operator — so only this commission is
 * counted as profit.
 */
function RechargeProfitCard() {
  const qc = useQueryClient()
  const [value, setValue] = React.useState<number | ''>('')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void (async () => {
      setValue(await api.settings.get<number>(SETTING_RECHARGE_PROFIT, DEFAULT_RECHARGE_PROFIT))
      setLoading(false)
    })()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.settings.set(SETTING_RECHARGE_PROFIT, Math.max(0, Number(value) || 0))
      toast.success('Recharge earning saved', {
        description: 'Applies to recharges billed from now on.'
      })
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['dash'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-info/12 text-info">
            <Zap className="size-4" />
          </span>
          Recharge earning
        </CardTitle>
        <CardDescription>
          What you keep on a recharge. On a {money(500)} recharge only this amount counts as
          profit — the rest goes to the operator, so your reports stay honest.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <Field label="Your earning per recharge ₹" className="w-56">
          <Input
            type="number"
            min={0}
            value={value}
            disabled={loading}
            onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
            className="text-right tnum font-semibold"
          />
        </Field>
        <Button onClick={() => void save()} loading={saving} disabled={loading}>
          Save
        </Button>
      </CardContent>
    </Card>
  )
}
