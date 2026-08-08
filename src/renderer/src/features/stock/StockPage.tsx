import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeftRight, Boxes, Download, PackageSearch, Search, Wrench } from 'lucide-react'
import { api } from '@/lib/api'
import { useBrands, useCsvExport, useDebounced, useReconReasons, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
import { STOCK_STATUS_LABELS } from '@shared/constants'
import { Badge, Button, Card, CardContent, Field, Input, Textarea } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/form'
import { Money, PageHeader, StatCard, StockStatusBadge, Toolbar } from '@/components/ui/misc'
import { TransferDialog } from '@/features/transfers/TransferDialog'

export function StockPage() {
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId, shops } = useScope()
  const exportCsv = useCsvExport()
  const brands = useBrands()
  const reasons = useReconReasons()
  const [params] = useSearchParams()

  const [tab, setTab] = React.useState('models')
  const [search, setSearch] = React.useState(params.get('q') ?? '')
  const [scope, setScope] = React.useState(shopId ?? 'all')
  const [status, setStatus] = React.useState('in_stock')
  const [brandId, setBrandId] = React.useState('all')
  const [selected, setSelected] = React.useState<string[]>([])
  const [transferOpen, setTransferOpen] = React.useState(false)
  const [adjustFor, setAdjustFor] = React.useState<any>(null)
  const [adjustStatus, setAdjustStatus] = React.useState('damaged')
  const [adjustReason, setAdjustReason] = React.useState('DAMAGE')
  const [adjustNote, setAdjustNote] = React.useState('')

  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search stock by IMEI or model',
    group: 'Stock',
    allowInInputs: true
  })
  useHotkey('ctrl+shift+t', () => selected.length > 0 && setTransferOpen(true), {
    description: 'Transfer selected units',
    group: 'Stock'
  })

  const units = useQuery({
    queryKey: ['stock', companyId, scope, status, brandId, debounced],
    queryFn: () =>
      api.stock.list({
        shopId: scope === 'all' ? undefined : scope,
        status,
        brandId: brandId === 'all' ? undefined : brandId,
        search: debounced || undefined,
        limit: 500
      }),
    enabled: Boolean(companyId)
  })

  const summary = useQuery({
    queryKey: ['stock-summary', companyId, scope],
    queryFn: () => api.stock.summary(scope === 'all' ? undefined : scope),
    enabled: Boolean(companyId)
  })

  const ageing = useQuery({
    queryKey: ['stock-ageing', companyId, scope],
    queryFn: () => api.reports.ageing({ shopId: scope === 'all' ? undefined : scope, minDays: 30 }),
    enabled: Boolean(companyId) && tab === 'ageing'
  })

  const rows = units.data?.rows ?? []
  // Totals come from the grouped summary so they always reflect true in-stock
  // counts/value (not just the first page of the units list).
  const inStockTotal = (summary.data ?? []).reduce((a: number, s: any) => a + (s.qty || 0), 0)
  const inStockValue = (summary.data ?? []).reduce((a: number, s: any) => a + Number(s.stockValue || 0), 0)
  const lowCount = (summary.data ?? []).filter((s: any) => s.isLow).length

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const submitAdjust = async () => {
    try {
      await api.stock.adjust({
        stockUnitId: adjustFor.id,
        toStatus: adjustStatus,
        reasonCode: adjustReason,
        reasonNote: adjustNote
      })
      toast.success('Stock adjusted and written to the audit trail')
      setAdjustFor(null)
      setAdjustNote('')
      // Refresh every stock view so the grouped counts and totals drop immediately.
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })
      void qc.invalidateQueries({ queryKey: ['stock-ageing'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock"
        description="Every handset is tracked as its own unit, by IMEI"
        actions={
          <>
            {selected.length > 0 && session.can('transfer.manage') && (
              <Button size="sm" onClick={() => setTransferOpen(true)}>
                <ArrowLeftRight /> Transfer {selected.length}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  'stock',
                  rows.map((r: any) => ({
                    brand: r.brandName,
                    model: r.modelName,
                    sku: r.sku,
                    imei1: r.imei1 ?? '',
                    imei2: r.imei2 ?? '',
                    colour: r.color ?? '',
                    shop: r.shopName ?? '',
                    status: r.status,
                    cost: r.costPrice,
                    sellAt: r.salePrice,
                    supplier: r.supplierName ?? '',
                    addedOn: r.addedAt?.slice(0, 10) ?? ''
                  }))
                )
              }
            >
              <Download /> Export
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total in stock" value={String(inStockTotal)} icon={Boxes} tone="primary" />
        <StatCard label="Stock value" value={money(inStockValue)} icon={Boxes} />
        <StatCard
          label="Low-stock models"
          value={String(lowCount)}
          icon={AlertTriangle}
          tone={lowCount > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Models tracked"
          value={String((summary.data ?? []).length)}
          icon={PackageSearch}
        />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="IMEI, model, SKU…"
          prefixNode={<Search />}
          suffixNode={<span className="kbd">Ctrl F</span>}
          className="w-80 font-mono"
        />
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
        <SimpleSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Any status' },
            ...Object.entries(STOCK_STATUS_LABELS).map(([value, label]) => ({ value, label }))
          ]}
          className="w-44"
        />
        <SimpleSelect
          value={brandId}
          onChange={setBrandId}
          options={[
            { value: 'all', label: 'All brands' },
            ...(brands.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))
          ]}
          className="w-40"
        />
        <div className="flex-1" />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="models">By model</TabsTrigger>
            <TabsTrigger value="units">Units</TabsTrigger>
            <TabsTrigger value="ageing">Ageing</TabsTrigger>
          </TabsList>
        </Tabs>
      </Toolbar>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="units" className="mt-0">
          <DataTable
            rows={rows}
            rowKey={(r: any) => r.id}
            loading={units.isLoading}
            empty="No units match these filters"
            maxHeight="calc(100vh - 420px)"
            columns={[
              {
                key: 'select',
                header: '',
                width: '36px',
                render: (r: any) =>
                  r.status === 'in_stock' ? (
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-4 accent-[hsl(var(--primary))]"
                    />
                  ) : null
              },
              {
                key: 'label',
                header: 'Handset',
                sortable: true,
                render: (r: any) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.sku}
                      {r.color ? ` · ${r.color}` : ''}
                    </p>
                  </div>
                )
              },
              {
                key: 'imei1',
                header: 'IMEI',
                render: (r: any) => (
                  <span className="font-mono text-xs">{r.imei1 ?? r.serialNo ?? '—'}</span>
                )
              },
              { key: 'shopName', header: 'At', render: (r: any) => r.shopName ?? '—' },
              { key: 'status', header: 'Status', render: (r: any) => <StockStatusBadge status={r.status} /> },
              ...(session.can('report.profit')
                ? [
                    {
                      key: 'costPrice',
                      header: 'Cost',
                      align: 'right' as const,
                      sortable: true,
                      render: (r: any) => <Money value={r.costPrice} />
                    }
                  ]
                : []),
              { key: 'salePrice', header: 'Sell at', align: 'right', render: (r: any) => <Money value={r.salePrice} blankZero /> },
              {
                key: 'addedAt',
                header: 'In since',
                sortable: true,
                hideBelow: 'lg',
                render: (r: any) => (
                  <span className="text-xs text-muted-foreground">{formatDate(r.addedAt)}</span>
                )
              },
              {
                key: 'actions',
                header: '',
                width: '60px',
                render: (r: any) =>
                  session.can('stock.adjust') && r.status !== 'sold' ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Adjust this unit"
                      onClick={(e) => {
                        e.stopPropagation()
                        setAdjustFor(r)
                      }}
                    >
                      <Wrench />
                    </Button>
                  ) : null
              }
            ]}
          />
        </TabsContent>

        <TabsContent value="models" className="mt-0">
          <DataTable
            rows={summary.data ?? []}
            rowKey={(r: any) => r.modelId}
            loading={summary.isLoading}
            empty="No models yet"
            maxHeight="calc(100vh - 420px)"
            showFooter
            columns={[
              {
                key: 'modelName',
                header: 'Model',
                sortable: true,
                render: (r: any) => (
                  <div>
                    <p className="font-medium">
                      {r.brandName} {r.modelName}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.sku}</p>
                  </div>
                ),
                footer: () => 'Total'
              },
              {
                key: 'qty',
                header: 'In stock',
                align: 'right',
                sortable: true,
                render: (r: any) => (
                  <Badge variant={r.qty === 0 ? 'muted' : r.isLow ? 'warning' : 'success'}>
                    {r.qty}
                  </Badge>
                ),
                footer: (rs: any[]) => rs.reduce((a, r) => a + r.qty, 0)
              },
              { key: 'lowStockAlert', header: 'Alert at', align: 'right', hideBelow: 'md' },
              {
                key: 'stockValue',
                header: 'Value',
                align: 'right',
                sortable: true,
                render: (r: any) => <Money value={r.stockValue} />,
                footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.stockValue, 0)} />
              },
              {
                key: 'ageDays',
                header: 'Oldest unit',
                align: 'right',
                sortable: true,
                render: (r: any) =>
                  r.ageDays === null ? '—' : <span className="tnum">{r.ageDays}d</span>
              }
            ]}
          />
        </TabsContent>

        <TabsContent value="ageing" className="mt-0">
          <Card className="mb-3">
            <CardContent className="p-4 text-[13px] text-muted-foreground">
              Handsets on the shelf for more than 30 days. Money sitting here is money not working —
              consider a price drop, a transfer to the busier shop, or a bundle offer.
            </CardContent>
          </Card>
          <DataTable
            rows={ageing.data ?? []}
            rowKey={(r: any) => r.id}
            loading={ageing.isLoading}
            empty="Nothing older than 30 days — stock is moving well."
            maxHeight="calc(100vh - 480px)"
            columns={[
              { key: 'label', header: 'Handset', sortable: true },
              { key: 'imei1', header: 'IMEI', render: (r: any) => <span className="font-mono text-xs">{r.imei1 ?? '—'}</span> },
              { key: 'shopName', header: 'At' },
              { key: 'costPrice', header: 'Cost', align: 'right', render: (r: any) => <Money value={r.costPrice} /> },
              {
                key: 'ageDays',
                header: 'Days in stock',
                align: 'right',
                sortable: true,
                render: (r: any) => (
                  <Badge variant={r.ageDays > 90 ? 'danger' : r.ageDays > 60 ? 'warning' : 'secondary'}>
                    {r.ageDays}d
                  </Badge>
                )
              }
            ]}
          />
        </TabsContent>
      </Tabs>

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        unitIds={selected}
        units={rows.filter((r: any) => selected.includes(r.id))}
        onDone={() => {
          setSelected([])
          void qc.invalidateQueries({ queryKey: ['stock'] })
        }}
      />

      {/* -------------------------------------------------------- adjust */}
      <Dialog open={Boolean(adjustFor)} onOpenChange={(v) => !v && setAdjustFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Adjust stock unit</DialogTitle>
            <DialogDescription>
              {adjustFor?.label} · {adjustFor?.imei1 ?? 'no IMEI'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="New status" required>
              <SimpleSelect
                value={adjustStatus}
                onChange={setAdjustStatus}
                options={Object.entries(STOCK_STATUS_LABELS)
                  .filter(([v]) => v !== 'sold')
                  .map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Reason" required>
              <SimpleSelect
                value={adjustReason}
                onChange={setAdjustReason}
                options={(reasons.data ?? []).map((r: any) => ({ value: r.code, label: r.label }))}
              />
            </Field>
            <Field
              label="Note"
              required={adjustReason === 'OTHER'}
              hint="Explain briefly — this is kept in the audit trail"
            >
              <Textarea value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitAdjust()}>Save adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
