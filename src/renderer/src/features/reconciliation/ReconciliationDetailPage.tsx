import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCheck,
  ClipboardCheck,
  Download,
  Lock,
  ScanLine,
  Search,
  TriangleAlert
} from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useReconReasons } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { cn, formatDate, money } from '@/lib/utils'
import { Badge, Button, Card, CardContent, Field, Input, Separator, Textarea } from '@/components/ui/base'
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { EmptyState, Money, PageHeader, StatCard } from '@/components/ui/misc'

export function ReconciliationDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const reasons = useReconReasons()
  const exportCsv = useCsvExport()

  const [filter, setFilter] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [pickFor, setPickFor] = React.useState<any>(null)
  const [pickedUnits, setPickedUnits] = React.useState<string[]>([])
  const [finalizeOpen, setFinalizeOpen] = React.useState(false)
  const [finalizing, setFinalizing] = React.useState(false)

  const recon = useQuery({
    queryKey: ['recon', id],
    queryFn: () => api.recon.get(id!),
    enabled: Boolean(id)
  })

  const units = useQuery({
    queryKey: ['recon-units', id, pickFor?.modelId],
    queryFn: () => api.recon.units(id!, pickFor.modelId),
    enabled: Boolean(pickFor)
  })

  const header = recon.data?.header
  const items = recon.data?.items ?? []
  const locked = header?.status === 'finalized'

  const filtered = items.filter((i: any) => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !`${i.brandName} ${i.modelName} ${i.sku}`.toLowerCase().includes(q)
      )
        return false
    }
    if (filter === 'variance') return i.variance !== 0
    if (filter === 'pending') return i.physicalQty === null
    if (filter === 'shortage') return i.variance < 0
    if (filter === 'excess') return i.variance > 0
    return true
  })

  const counted = items.filter((i: any) => i.physicalQty !== null).length
  const variances = items.filter((i: any) => i.variance !== 0)
  const shortages = items.filter((i: any) => i.variance < 0)
  const needsReason = variances.filter((i: any) => !i.reasonCode)

  const save = async (item: any, patch: any) => {
    try {
      await api.recon.updateItem({ itemId: item.id, ...patch })
      void qc.invalidateQueries({ queryKey: ['recon', id] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const acceptAll = async () => {
    await api.recon.acceptAll(id!)
    toast.success('Every uncounted line now matches the expected quantity')
    void qc.invalidateQueries({ queryKey: ['recon', id] })
  }

  const finalize = async () => {
    setFinalizing(true)
    try {
      const res = await api.recon.finalize(id!)
      toast.success(`Finalised — ${res.adjusted} unit(s) adjusted in stock`)
      setFinalizeOpen(false)
      void qc.invalidateQueries({ queryKey: ['recon', id] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setFinalizing(false)
    }
  }

  useHotkey('escape', () => navigate('/reconciliation'), {
    description: 'Back to the list',
    group: 'Reconciliation'
  })
  useHotkey('ctrl+enter', () => !locked && setFinalizeOpen(true), {
    description: 'Finalise this check',
    group: 'Reconciliation',
    allowInInputs: true
  })

  if (!header) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">Loading…</div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={header.title}
        description={`${header.shopName} · ${formatDate(header.fromDate)} → ${formatDate(header.toDate)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/reconciliation')}>
              <ArrowLeft /> Back
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  `stock-check-${header.shopCode}`,
                  items.map((i: any) => ({
                    brand: i.brandName,
                    model: i.modelName,
                    sku: i.sku,
                    opening: i.openingQty,
                    purchased: i.purchasedQty,
                    transferIn: i.transferInQty,
                    transferOut: i.transferOutQty,
                    sold: i.soldQty,
                    adjusted: i.adjustedQty,
                    expected: i.expectedQty,
                    physical: i.physicalQty ?? '',
                    variance: i.variance,
                    valueImpact: i.varianceValue,
                    reason: i.reasonLabel ?? '',
                    note: i.reasonNote ?? ''
                  }))
                )
              }
            >
              <Download /> Export sheet
            </Button>
            {!locked && session.can('reconciliation.manage') && (
              <>
                <Button variant="outline" size="sm" onClick={() => void acceptAll()}>
                  <CheckCheck /> Accept expected for the rest
                </Button>
                <Button size="sm" onClick={() => setFinalizeOpen(true)}>
                  <Lock /> Finalise <span className="kbd ml-1">Ctrl ⏎</span>
                </Button>
              </>
            )}
          </>
        }
      />

      {locked && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex items-center gap-3 p-4 text-[13px]">
            <Lock className="size-4 shrink-0 text-success" />
            Finalised on {formatDate(header.finalizedAt)}. Stock has been adjusted and this record is
            now read-only.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="SKUs to count" value={String(items.length)} icon={ClipboardCheck} tone="primary" />
        <StatCard
          label="Counted"
          value={`${counted} / ${items.length}`}
          tone={counted === items.length ? 'success' : 'warning'}
        />
        <StatCard
          label="Differences"
          value={String(variances.length)}
          icon={TriangleAlert}
          tone={variances.length > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Short by"
          value={`${Math.abs(shortages.reduce((a: number, i: any) => a + i.variance, 0))} units`}
          tone={shortages.length > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Value impact"
          value={money(items.reduce((a: number, i: any) => a + Number(i.varianceValue || 0), 0))}
          tone="info"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by model or SKU…"
          prefixNode={<Search />}
          className="w-72"
        />
        <div className="flex-1" />
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({items.length})</TabsTrigger>
            <TabsTrigger value="pending">Not counted ({items.length - counted})</TabsTrigger>
            <TabsTrigger value="variance">Differences ({variances.length})</TabsTrigger>
            <TabsTrigger value="shortage">Short ({shortages.length})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {needsReason.length > 0 && !locked && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex items-center gap-3 p-4 text-[13px]">
            <TriangleAlert className="size-4 shrink-0 text-warning" />
            {needsReason.length} line(s) have a difference but no reason yet. Every difference needs a
            reason before you can finalise.
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing matches this filter" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-muted/70 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-2 py-2 text-right" title="Stock at the start of the period">Open</th>
                <th className="px-2 py-2 text-right">Bought</th>
                <th className="px-2 py-2 text-right">In</th>
                <th className="px-2 py-2 text-right">Out</th>
                <th className="px-2 py-2 text-right">Sold</th>
                <th className="px-2 py-2 text-right">Adj</th>
                <th className="px-2 py-2 text-right font-semibold text-foreground">Expected</th>
                <th className="w-28 px-2 py-2 text-right font-semibold text-foreground">Counted</th>
                <th className="w-24 px-2 py-2 text-right">Diff</th>
                <th className="w-52 px-2 py-2 text-left">Reason</th>
                <th className="w-56 px-2 py-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i: any) => (
                <ReconRow
                  key={i.id}
                  item={i}
                  locked={locked}
                  reasons={reasons.data ?? []}
                  onSave={save}
                  onPickUnits={() => {
                    setPickFor(i)
                    setPickedUnits(i.missingUnitIds ?? [])
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------ pick missing units */}
      <Dialog open={Boolean(pickFor)} onOpenChange={(v) => !v && setPickFor(null)}>
        <DialogContent size="md" className="max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Which handsets are missing?</DialogTitle>
            <DialogDescription>
              {pickFor?.brandName} {pickFor?.modelName} — tick the {Math.abs(pickFor?.variance ?? 0)}{' '}
              unit(s) that are not on the shelf. If you skip this, the oldest units are assumed
              missing.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
            {(units.data ?? []).map((u: any) => (
              <label
                key={u.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border border-border p-2.5 text-[13px] transition hover:bg-muted/60',
                  pickedUnits.includes(u.id) && 'border-destructive bg-destructive/5'
                )}
              >
                <input
                  type="checkbox"
                  checked={pickedUnits.includes(u.id)}
                  onChange={() =>
                    setPickedUnits((s) =>
                      s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]
                    )
                  }
                  className="size-4 accent-[hsl(var(--destructive))]"
                />
                <ScanLine className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 font-mono">{u.imei1 ?? u.serial_no ?? u.id.slice(0, 8)}</span>
                <span className="text-xs text-muted-foreground">{u.color ?? ''}</span>
                <Money value={u.cost_price} className="text-xs" />
              </label>
            ))}
            {(units.data ?? []).length === 0 && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                No units currently on the shelf for this model.
              </p>
            )}
          </div>

          <DialogFooter>
            <span className="mr-auto self-center text-[13px] text-muted-foreground">
              {pickedUnits.length} selected of {Math.abs(pickFor?.variance ?? 0)} short
            </span>
            <Button variant="outline" onClick={() => setPickFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await save(pickFor, { physicalQty: pickFor.physicalQty, missingUnitIds: pickedUnits })
                setPickFor(null)
              }}
            >
              Save selection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        title="Finalise this stock check?"
        description={
          <>
            Stock will be adjusted for every difference:{' '}
            <span className="font-medium">
              {Math.abs(shortages.reduce((a: number, i: any) => a + i.variance, 0))} unit(s)
            </span>{' '}
            marked short will be moved out of stock with the reason you chose. This cannot be undone.
          </>
        }
        confirmLabel="Finalise"
        loading={finalizing}
        onConfirm={finalize}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ReconRow({
  item,
  locked,
  reasons,
  onSave,
  onPickUnits
}: {
  item: any
  locked: boolean
  reasons: any[]
  onSave: (item: any, patch: any) => void
  onPickUnits: () => void
}) {
  const [physical, setPhysical] = React.useState<string>(
    item.physicalQty === null ? '' : String(item.physicalQty)
  )
  const [note, setNote] = React.useState(item.reasonNote ?? '')

  React.useEffect(() => {
    setPhysical(item.physicalQty === null ? '' : String(item.physicalQty))
    setNote(item.reasonNote ?? '')
  }, [item.physicalQty, item.reasonNote])

  const variance = physical === '' ? null : Number(physical) - item.expectedQty
  const applicable = reasons.filter((r) =>
    variance === null || variance === 0
      ? true
      : variance < 0
        ? r.direction !== 'excess'
        : r.direction !== 'shortage'
  )

  const commitPhysical = () => {
    const value = physical === '' ? null : Number(physical)
    if (value === item.physicalQty) return
    onSave(item, { physicalQty: value, reasonCode: item.reasonCode, reasonNote: item.reasonNote })
  }

  return (
    <tr
      className={cn(
        'border-b border-border/60 last:border-0',
        variance !== null && variance !== 0 && 'bg-warning/5',
        item.physicalQty === null && 'bg-muted/30'
      )}
    >
      <td className="px-3 py-2">
        <p className="font-medium">
          {item.brandName} {item.modelName}
        </p>
        <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
      </td>
      <td className="px-2 py-2 text-right tnum text-muted-foreground">{item.openingQty}</td>
      <td className="px-2 py-2 text-right tnum text-muted-foreground">{item.purchasedQty}</td>
      <td className="px-2 py-2 text-right tnum text-muted-foreground">{item.transferInQty}</td>
      <td className="px-2 py-2 text-right tnum text-muted-foreground">{item.transferOutQty}</td>
      <td className="px-2 py-2 text-right tnum text-muted-foreground">{item.soldQty}</td>
      <td className="px-2 py-2 text-right tnum text-muted-foreground">{item.adjustedQty}</td>
      <td className="px-2 py-2 text-right text-base font-semibold tnum">{item.expectedQty}</td>
      <td className="px-2 py-2">
        <Input
          type="number"
          min={0}
          value={physical}
          disabled={locked}
          onChange={(e) => setPhysical(e.target.value)}
          onBlur={commitPhysical}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          placeholder="—"
          className="h-8 text-right tnum font-semibold"
        />
      </td>
      <td className="px-2 py-2 text-right">
        {variance === null ? (
          <span className="text-muted-foreground">—</span>
        ) : variance === 0 ? (
          <Badge variant="success">OK</Badge>
        ) : (
          <button
            type="button"
            onClick={variance < 0 && !locked ? onPickUnits : undefined}
            className={cn(
              'tnum font-semibold',
              variance < 0 ? 'text-destructive' : 'text-info',
              variance < 0 && !locked && 'underline decoration-dotted underline-offset-2'
            )}
            title={variance < 0 ? 'Choose exactly which units are missing' : undefined}
          >
            {variance > 0 ? `+${variance}` : variance}
          </button>
        )}
      </td>
      <td className="px-2 py-2">
        {variance !== null && variance !== 0 ? (
          <SimpleSelect
            value={item.reasonCode ?? ''}
            onChange={(v) => onSave(item, { physicalQty: Number(physical), reasonCode: v, reasonNote: note })}
            options={applicable.map((r) => ({ value: r.code, label: r.label }))}
            placeholder="Pick a reason"
            disabled={locked}
            className="h-8"
            invalid={!item.reasonCode}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        {variance !== null && variance !== 0 ? (
          <Input
            value={note}
            disabled={locked}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() =>
              note !== (item.reasonNote ?? '') &&
              onSave(item, {
                physicalQty: Number(physical),
                reasonCode: item.reasonCode,
                reasonNote: note
              })
            }
            placeholder={item.reasonCode === 'OTHER' ? 'Required — explain briefly' : 'Optional'}
            className="h-8"
            invalid={item.reasonCode === 'OTHER' && !note.trim()}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}
