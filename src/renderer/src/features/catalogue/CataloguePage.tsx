import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Pencil, Plus, Search, Smartphone, Tag } from 'lucide-react'
import { api } from '@/lib/api'
import { useBrands, useCsvExport, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { money } from '@/lib/utils'
import { Badge, Button, Field, Input } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/form'
import { Money, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'
import { ModelFormDialog } from './ModelFormDialog'

export function CataloguePage() {
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId } = useScope()
  const exportCsv = useCsvExport()
  const brands = useBrands()

  const [tab, setTab] = React.useState('models')
  const [search, setSearch] = React.useState('')
  const [brandFilter, setBrandFilter] = React.useState('all')
  const [modelDialog, setModelDialog] = React.useState(false)
  const [editingModel, setEditingModel] = React.useState<any>(null)
  const [brandDialog, setBrandDialog] = React.useState(false)
  const [brandName, setBrandName] = React.useState('')
  const [editingBrand, setEditingBrand] = React.useState<any>(null)

  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search models',
    group: 'Catalogue',
    allowInInputs: true
  })
  useHotkey('ctrl+n', () => {
    setEditingModel(null)
    setModelDialog(true)
  }, { description: 'New model', group: 'Catalogue', allowInInputs: true })

  const models = useQuery({
    queryKey: ['catalogue', companyId, shopId, debounced, brandFilter],
    queryFn: () =>
      api.models.list({
        search: debounced || undefined,
        brandId: brandFilter === 'all' ? undefined : brandFilter,
        shopId,
        includeInactive: true
      }),
    enabled: Boolean(companyId)
  })

  const rows = models.data ?? []

  const saveBrand = async () => {
    try {
      await api.brands.save({ id: editingBrand?.id, name: brandName })
      toast.success(editingBrand ? 'Brand updated' : 'Brand added')
      setBrandDialog(false)
      setBrandName('')
      setEditingBrand(null)
      void brands.refetch()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Brands & models"
        description="The product catalogue behind every purchase and sale"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  'models',
                  rows.map((m: any) => ({
                    brand: m.brandName,
                    model: m.name,
                    sku: m.sku,
                    category: m.category,
                    ram: m.ram ?? '',
                    storage: m.storage ?? '',
                    hsn: m.hsn ?? '',
                    gst: m.gstRate,
                    cost: m.defaultCost,
                    price: m.defaultPrice,
                    mrp: m.mrp,
                    inStock: m.inStock,
                    lowStockAlert: m.lowStockAlert
                  }))
                )
              }
            >
              <Download /> Export
            </Button>
            {session.can('product.manage') && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingBrand(null)
                    setBrandName('')
                    setBrandDialog(true)
                  }}
                >
                  <Tag /> New brand
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingModel(null)
                    setModelDialog(true)
                  }}
                >
                  <Plus /> New model
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Brands" value={String((brands.data ?? []).length)} icon={Tag} tone="primary" />
        <StatCard label="Models" value={String(rows.length)} icon={Smartphone} />
        <StatCard
          label="Units in stock"
          value={String(rows.reduce((a: number, m: any) => a + Number(m.inStock || 0), 0))}
          icon={Smartphone}
          tone="info"
        />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Brand, model or SKU…"
          prefixNode={<Search />}
          className="w-80"
        />
        <SimpleSelect
          value={brandFilter}
          onChange={setBrandFilter}
          options={[
            { value: 'all', label: 'All brands' },
            ...(brands.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))
          ]}
          className="w-44"
        />
        <div className="flex-1" />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="brands">Brands</TabsTrigger>
          </TabsList>
        </Tabs>
      </Toolbar>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="models" className="mt-0">
          <DataTable
            rows={rows}
            rowKey={(m: any) => m.id}
            loading={models.isLoading}
            empty="No models yet — add your first one."
            maxHeight="calc(100vh - 420px)"
            onRowClick={(m: any) => {
              if (!session.can('product.manage')) return
              setEditingModel(m)
              setModelDialog(true)
            }}
            columns={[
              {
                key: 'name',
                header: 'Model',
                sortable: true,
                render: (m: any) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {m.brandName} {m.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[m.ram, m.storage, m.color].filter(Boolean).join(' · ') || m.category}
                    </p>
                  </div>
                )
              },
              { key: 'sku', header: 'SKU', render: (m: any) => <span className="font-mono text-xs">{m.sku}</span> },
              {
                key: 'trackImei',
                header: 'IMEI',
                hideBelow: 'lg',
                render: (m: any) =>
                  m.trackImei ? <Badge variant="success">Tracked</Badge> : <Badge variant="muted">No</Badge>
              },
              { key: 'gstRate', header: 'GST', align: 'right', render: (m: any) => `${m.gstRate}%` },
              { key: 'mrp', header: 'MRP', align: 'right', hideBelow: 'md', render: (m: any) => <Money value={m.mrp} blankZero /> },
              { key: 'defaultPrice', header: 'Sell at', align: 'right', render: (m: any) => <Money value={m.defaultPrice} blankZero /> },
              ...(session.can('report.profit')
                ? [
                    {
                      key: 'defaultCost',
                      header: 'Cost',
                      align: 'right' as const,
                      hideBelow: 'lg' as const,
                      render: (m: any) => <Money value={m.defaultCost} blankZero />
                    }
                  ]
                : []),
              {
                key: 'inStock',
                header: 'In stock',
                align: 'right',
                sortable: true,
                render: (m: any) => (
                  <Badge
                    variant={
                      m.inStock === 0 ? 'muted' : m.inStock <= m.lowStockAlert ? 'warning' : 'success'
                    }
                  >
                    {m.inStock}
                  </Badge>
                )
              },
              {
                key: 'isActive',
                header: '',
                width: '60px',
                render: (m: any) =>
                  session.can('product.manage') ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingModel(m)
                        setModelDialog(true)
                      }}
                    >
                      <Pencil />
                    </Button>
                  ) : null
              }
            ]}
          />
        </TabsContent>

        <TabsContent value="brands" className="mt-0">
          <DataTable
            rows={brands.data ?? []}
            rowKey={(b: any) => b.id}
            loading={brands.isLoading}
            empty="No brands yet"
            columns={[
              { key: 'name', header: 'Brand', sortable: true, render: (b: any) => <span className="font-medium">{b.name}</span> },
              { key: 'modelCount', header: 'Models', align: 'right', sortable: true },
              {
                key: 'actions',
                header: '',
                width: '60px',
                render: (b: any) =>
                  session.can('product.manage') ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditingBrand(b)
                        setBrandName(b.name)
                        setBrandDialog(true)
                      }}
                    >
                      <Pencil />
                    </Button>
                  ) : null
              }
            ]}
          />
        </TabsContent>
      </Tabs>

      <ModelFormDialog
        open={modelDialog}
        onOpenChange={setModelDialog}
        initial={editingModel}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['catalogue'] })
          void qc.invalidateQueries({ queryKey: ['models'] })
        }}
      />

      <Dialog open={brandDialog} onOpenChange={setBrandDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editingBrand ? 'Edit brand' : 'New brand'}</DialogTitle>
          </DialogHeader>
          <Field label="Brand name" required>
            <Input
              autoFocus
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveBrand()}
              placeholder="e.g. Samsung"
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBrandDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveBrand()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
