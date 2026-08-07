import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClipboardCheck, ClipboardList, Play, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useDateRange, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money, startOfMonth, todayStr } from '@/lib/utils'
import { Badge, Button, Card, CardContent, Field, Input, Textarea } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { DateRangePicker, EmptyState, Money, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'
import { Progress as ProgressBar } from '@/components/ui/form'

export function ReconciliationPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId, shops } = useScope()

  const [statusFilter, setStatusFilter] = React.useState('all')
  const [scope, setScope] = React.useState(shopId ?? 'all')
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [deleteFor, setDeleteFor] = React.useState<any>(null)

  const [range, setRange] = useDateRange('recon', { from: startOfMonth(), to: todayStr() })
  const [wizardShop, setWizardShop] = React.useState(shopId ?? '')
  const [title, setTitle] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [includeZero, setIncludeZero] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  const list = useQuery({
    queryKey: ['recons', companyId, scope, statusFilter],
    queryFn: () =>
      api.recon.list({
        shopId: scope === 'all' ? undefined : scope,
        status: statusFilter
      }),
    enabled: Boolean(companyId)
  })

  const preview = useQuery({
    queryKey: ['recon-preview', wizardShop, range, includeZero],
    queryFn: () =>
      api.recon.preview({ shopId: wizardShop, from: range.from, to: range.to, includeZero }),
    enabled: wizardOpen && Boolean(wizardShop)
  })

  useHotkey('ctrl+n', () => setWizardOpen(true), {
    description: 'Start a stock check',
    group: 'Reconciliation',
    allowInInputs: true
  })

  const rows = list.data ?? []
  const drafts = rows.filter((r: any) => r.status === 'draft')

  const create = async () => {
    setCreating(true)
    try {
      const res = await api.recon.create({
        shopId: wizardShop,
        fromDate: range.from,
        toDate: range.to,
        title: title || undefined,
        notes: notes || undefined,
        includeZero
      })
      toast.success(`Stock check started with ${res.itemCount} SKU(s)`)
      setWizardOpen(false)
      setTitle('')
      setNotes('')
      void qc.invalidateQueries({ queryKey: ['recons'] })
      navigate(`/reconciliation/${res.id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  const remove = async () => {
    try {
      await api.recon.remove(deleteFor.id)
      toast.success('Draft deleted')
      setDeleteFor(null)
      void qc.invalidateQueries({ queryKey: ['recons'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock reconciliation"
        description="Pick any date range, see what the software expects on the shelf, count what is actually there, and record a reason for every difference"
        actions={
          session.can('reconciliation.manage') && (
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              <Plus /> New stock check <span className="kbd ml-1">Ctrl N</span>
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Checks recorded" value={String(rows.length)} icon={ClipboardList} tone="primary" />
        <StatCard
          label="In progress"
          value={String(drafts.length)}
          icon={Play}
          tone={drafts.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Value written off"
          value={money(
            rows
              .filter((r: any) => r.status === 'finalized')
              .reduce((a: number, r: any) => a + Number(r.varianceValue || 0), 0)
          )}
          icon={TriangleAlert}
          tone="danger"
        />
      </div>

      <Toolbar>
        {shops.length > 1 && (
          <SimpleSelect
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All shops' },
              ...shops.map((s) => ({ value: s.id, label: s.name }))
            ]}
            className="w-44"
          />
        )}
        <div className="flex-1" />
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">In progress</TabsTrigger>
            <TabsTrigger value="finalized">Finalised</TabsTrigger>
          </TabsList>
        </Tabs>
      </Toolbar>

      {rows.length === 0 && !list.isLoading ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No stock check yet"
          description="Say your books show 7 units of a model on 31 July but only 6 are on the shelf. Start a check for 1–31 July, enter the physical count, and mark the shortage of 1 with a reason. The software then adjusts stock and keeps the record."
          action={
            session.can('reconciliation.manage') && (
              <Button onClick={() => setWizardOpen(true)}>
                <Plus /> Start the first check
              </Button>
            )
          }
        />
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r: any) => r.id}
          loading={list.isLoading}
          onRowClick={(r: any) => navigate(`/reconciliation/${r.id}`)}
          empty="No checks match this filter"
          columns={[
            {
              key: 'title',
              header: 'Stock check',
              sortable: true,
              render: (r: any) => (
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDate(r.fromDate)} → {formatDate(r.toDate)} · {r.shopName}
                  </p>
                </div>
              )
            },
            {
              key: 'progress',
              header: 'Counted',
              width: '160px',
              render: (r: any) => (
                <div className="space-y-1">
                  <ProgressBar
                    value={r.itemCount ? (r.countedCount / r.itemCount) * 100 : 0}
                    className="h-1.5"
                  />
                  <p className="text-xs text-muted-foreground tnum">
                    {r.countedCount} / {r.itemCount} SKUs
                  </p>
                </div>
              )
            },
            {
              key: 'totalVariance',
              header: 'Variance',
              align: 'right',
              sortable: true,
              render: (r: any) =>
                r.totalVariance === 0 ? (
                  <Badge variant="success">Matched</Badge>
                ) : (
                  <Badge variant="warning">{r.totalVariance} unit(s)</Badge>
                )
            },
            {
              key: 'varianceValue',
              header: 'Value impact',
              align: 'right',
              render: (r: any) => <Money value={r.varianceValue} colored blankZero />
            },
            {
              key: 'status',
              header: 'Status',
              render: (r: any) =>
                r.status === 'finalized' ? (
                  <Badge variant="success">Finalised</Badge>
                ) : (
                  <Badge variant="warning">In progress</Badge>
                )
            },
            {
              key: 'createdByName',
              header: 'Started by',
              hideBelow: 'lg',
              render: (r: any) => (
                <span className="text-xs text-muted-foreground">
                  {r.createdByName} · {formatDate(r.createdAt)}
                </span>
              )
            },
            {
              key: 'actions',
              header: '',
              width: '60px',
              render: (r: any) =>
                r.status === 'draft' && session.can('reconciliation.manage') ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteFor(r)
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null
            }
          ]}
        />
      )}

      {/* --------------------------------------------------------- wizard */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent size="lg" className="max-h-[88vh]">
          <DialogHeader>
            <DialogTitle>New stock check</DialogTitle>
            <DialogDescription>
              Choose a shop and a date range. The software replays every purchase, transfer, sale and
              adjustment to work out what should be on the shelf.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Shop" required>
                <SimpleSelect
                  value={wizardShop}
                  onChange={setWizardShop}
                  options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                  placeholder="Choose shop"
                />
              </Field>
              <Field label="Period" required>
                <DateRangePicker value={range} onChange={setRange} className="w-full justify-start" />
              </Field>
              <Field label="Title" className="sm:col-span-2" hint="Optional — a name you will recognise later">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`Stock check ${range.from} → ${range.to}`}
                />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[52px]"
                  placeholder="Who counted, any context"
                />
              </Field>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-[13px] font-medium">Include models with no movement</p>
                <p className="text-xs text-muted-foreground">
                  Off keeps the count sheet short — only models that moved or have stock.
                </p>
              </div>
              <Switch checked={includeZero} onCheckedChange={setIncludeZero} />
            </div>

            {wizardShop && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Preview — {preview.data?.length ?? 0} SKU(s) to count
                </p>
                <DataTable
                  dense
                  maxHeight="260px"
                  rows={(preview.data ?? []).slice(0, 60)}
                  rowKey={(r: any) => r.modelId}
                  loading={preview.isFetching}
                  empty="Nothing moved in this period for this shop"
                  columns={[
                    {
                      key: 'modelName',
                      header: 'Model',
                      render: (r: any) => (
                        <div>
                          <p className="font-medium">
                            {r.brandName} {r.modelName}
                          </p>
                          <p className="text-xs text-muted-foreground">{r.sku}</p>
                        </div>
                      )
                    },
                    { key: 'openingQty', header: 'Opening', align: 'right' },
                    { key: 'purchasedQty', header: 'Bought', align: 'right' },
                    { key: 'transferInQty', header: 'In', align: 'right' },
                    { key: 'transferOutQty', header: 'Out', align: 'right' },
                    { key: 'soldQty', header: 'Sold', align: 'right' },
                    {
                      key: 'expectedQty',
                      header: 'Expected',
                      align: 'right',
                      render: (r: any) => <span className="font-semibold">{r.expectedQty}</span>
                    }
                  ]}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void create()}
              loading={creating}
              disabled={!wizardShop || (preview.data ?? []).length === 0}
            >
              <ClipboardCheck /> Start counting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteFor)}
        onOpenChange={(v) => !v && setDeleteFor(null)}
        title="Delete this draft?"
        description="The counts entered so far will be lost. Finalised checks can never be deleted."
        confirmLabel="Delete draft"
        destructive
        onConfirm={remove}
      />
    </div>
  )
}
