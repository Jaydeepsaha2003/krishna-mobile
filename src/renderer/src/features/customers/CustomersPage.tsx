import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pencil, Phone, Search, UserPlus, Users, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
import { formatPhone, maskAadhaar } from '@shared/validators'
import { Badge, Button, Card, CardContent, Input, Separator } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlay'
import { Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { Money, PageHeader, SaleStatusBadge, StatCard, Toolbar } from '@/components/ui/misc'
import { CustomerFormDialog } from './CustomerFormDialog'

export function CustomersPage() {
  const qc = useQueryClient()
  const session = useSession()
  const { companyId } = useScope()
  const exportCsv = useCsvExport()
  const [params, setParams] = useSearchParams()

  const [search, setSearch] = React.useState('')
  const [onlyDues, setOnlyDues] = React.useState(false)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<any>(null)
  const [ledgerId, setLedgerId] = React.useState<string | null>(params.get('id'))
  const [showAadhaar, setShowAadhaar] = React.useState(false)

  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search customers',
    group: 'Customers',
    allowInInputs: true
  })
  useHotkey('ctrl+n', () => {
    setEditing(null)
    setFormOpen(true)
  }, { description: 'New customer', group: 'Customers', allowInInputs: true })

  const customers = useQuery({
    queryKey: ['customers-page', companyId, debounced, onlyDues],
    queryFn: () => api.customers.list({ search: debounced || undefined, onlyWithDues: onlyDues, limit: 500 }),
    enabled: Boolean(companyId)
  })

  const ledger = useQuery({
    queryKey: ['customer-ledger', ledgerId],
    queryFn: () => api.customers.ledger(ledgerId!),
    enabled: Boolean(ledgerId)
  })

  const rows = customers.data ?? []
  const totalOutstanding = rows.reduce((a: number, r: any) => a + Number(r.outstanding || 0), 0)
  const withDues = rows.filter((r: any) => r.outstanding > 0.5).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Aadhaar, PAN and both mobile numbers are kept against every customer"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  'customers',
                  rows.map((r: any) => ({
                    name: r.name,
                    primaryMobile: r.phonePrimary,
                    secondaryMobile: r.phoneSecondary ?? '',
                    aadhaar: r.aadhaar ?? '',
                    pan: r.pan ?? '',
                    email: r.email ?? '',
                    city: r.city ?? '',
                    state: r.state ?? '',
                    pincode: r.pincode ?? '',
                    type: r.customerType,
                    bills: r.totalPurchases,
                    spent: r.totalSpent,
                    outstanding: r.outstanding,
                    creditLimit: r.creditLimit,
                    lastPurchase: r.lastPurchaseAt ?? ''
                  }))
                )
              }
            >
              <Download /> Export
            </Button>
            {session.can('customer.manage') && (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <UserPlus /> New customer <span className="kbd ml-1">Ctrl N</span>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Customers" value={String(rows.length)} icon={Users} tone="primary" />
        <StatCard
          label="With outstanding"
          value={String(withDues)}
          icon={Wallet}
          tone={withDues > 0 ? 'warning' : 'success'}
        />
        <StatCard label="Total outstanding" value={money(totalOutstanding)} icon={Wallet} />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, mobile, Aadhaar or PAN…"
          prefixNode={<Search />}
          suffixNode={<span className="kbd">Ctrl F</span>}
          className="w-96"
        />
        <Tabs value={onlyDues ? 'dues' : 'all'} onValueChange={(v) => setOnlyDues(v === 'dues')}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="dues">With dues</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Show full Aadhaar
          <Switch checked={showAadhaar} onCheckedChange={setShowAadhaar} />
        </label>
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={customers.isLoading}
        onRowClick={(r: any) => setLedgerId(r.id)}
        empty="No customers yet — add your first one."
        maxHeight="calc(100vh - 400px)"
        columns={[
          {
            key: 'name',
            header: 'Customer',
            sortable: true,
            render: (r: any) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatPhone(r.phonePrimary)}
                  {r.phoneSecondary ? ` · ${formatPhone(r.phoneSecondary)}` : ''}
                </p>
              </div>
            )
          },
          {
            key: 'aadhaar',
            header: 'Aadhaar / PAN',
            hideBelow: 'lg',
            render: (r: any) => (
              <div className="text-xs">
                <p className="font-mono">
                  {r.aadhaar ? (showAadhaar ? r.aadhaar : maskAadhaar(r.aadhaar)) : '—'}
                </p>
                <p className="font-mono text-muted-foreground">{r.pan ?? '—'}</p>
              </div>
            )
          },
          {
            key: 'city',
            header: 'Place',
            hideBelow: 'md',
            render: (r: any) => (
              <span className="text-[13px]">
                {[r.city, r.state].filter(Boolean).join(', ') || '—'}
              </span>
            )
          },
          {
            key: 'customerType',
            header: 'Type',
            hideBelow: 'lg',
            render: (r: any) => <Badge variant="secondary">{r.customerType}</Badge>
          },
          { key: 'totalPurchases', header: 'Bills', align: 'right', sortable: true },
          { key: 'totalSpent', header: 'Spent', align: 'right', sortable: true, render: (r: any) => <Money value={r.totalSpent} /> },
          {
            key: 'outstanding',
            header: 'Outstanding',
            align: 'right',
            sortable: true,
            render: (r: any) =>
              r.outstanding > 0.5 ? (
                <div>
                  <Money value={r.outstanding} className="font-semibold text-warning" />
                  {r.overdueCount > 0 && (
                    <p className="text-xs text-destructive">{r.overdueCount} overdue</p>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
            footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.outstanding, 0)} />
          },
          {
            key: 'lastPurchaseAt',
            header: 'Last visit',
            hideBelow: 'lg',
            sortable: true,
            render: (r: any) => (
              <span className="text-xs text-muted-foreground">{formatDate(r.lastPurchaseAt)}</span>
            )
          },
          {
            key: 'actions',
            header: '',
            width: '80px',
            render: (r: any) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Call"
                  onClick={() => void api.app.openExternal(`tel:+91${r.phonePrimary}`)}
                >
                  <Phone />
                </Button>
                {session.can('customer.manage') && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Edit"
                    onClick={() => {
                      setEditing(r)
                      setFormOpen(true)
                    }}
                  >
                    <Pencil />
                  </Button>
                )}
              </div>
            )
          }
        ]}
        showFooter
      />

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSaved={() => void qc.invalidateQueries({ queryKey: ['customers-page'] })}
      />

      {/* --------------------------------------------------------- ledger */}
      <Dialog
        open={Boolean(ledgerId)}
        onOpenChange={(v) => {
          if (!v) {
            setLedgerId(null)
            params.delete('id')
            setParams(params, { replace: true })
          }
        }}
      >
        <DialogContent size="xl" className="max-h-[88vh]">
          {ledger.data && (
            <>
              <DialogHeader>
                <DialogTitle>{ledger.data.customer.name}</DialogTitle>
                <DialogDescription>
                  {formatPhone(ledger.data.customer.phonePrimary)}
                  {ledger.data.customer.phoneSecondary
                    ? ` · ${formatPhone(ledger.data.customer.phoneSecondary)}`
                    : ''}
                  {ledger.data.customer.city ? ` · ${ledger.data.customer.city}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
                <div className="grid gap-3 sm:grid-cols-4">
                  <StatCard label="Bills" value={String(ledger.data.sales.length)} />
                  <StatCard
                    label="Spent"
                    value={money(ledger.data.sales.reduce((a: number, s: any) => a + Number(s.total), 0))}
                  />
                  <StatCard
                    label="Outstanding"
                    value={money(ledger.data.outstanding)}
                    tone={ledger.data.outstanding > 0 ? 'warning' : 'success'}
                  />
                  <StatCard label="Handsets bought" value={String(ledger.data.devices.length)} />
                </div>

                <Card>
                  <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
                    <Info label="Aadhaar" value={maskAadhaar(ledger.data.customer.aadhaar) || '—'} />
                    <Info label="PAN" value={ledger.data.customer.pan ?? '—'} />
                    <Info label="State" value={ledger.data.customer.state ?? '—'} />
                    <Info label="Credit limit" value={money(ledger.data.customer.creditLimit)} />
                  </CardContent>
                </Card>

                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Purchase history
                  </p>
                  <DataTable
                    dense
                    rows={ledger.data.sales}
                    rowKey={(s: any) => s.id}
                    empty="No purchases yet"
                    columns={[
                      { key: 'invoice_no', header: 'Invoice' },
                      { key: 'sale_date', header: 'Date', render: (s: any) => formatDate(s.sale_date) },
                      { key: 'shop_name', header: 'Shop', hideBelow: 'md' },
                      {
                        key: 'items',
                        header: 'Items',
                        render: (s: any) => (
                          <span className="block max-w-[240px] truncate text-xs text-muted-foreground">
                            {s.items}
                          </span>
                        )
                      },
                      { key: 'total', header: 'Total', align: 'right', render: (s: any) => <Money value={s.total} /> },
                      {
                        key: 'due_amount',
                        header: 'Due',
                        align: 'right',
                        render: (s: any) => <Money value={s.due_amount} blankZero />
                      },
                      { key: 'status', header: 'Status', render: (s: any) => <SaleStatusBadge status={s.status} /> }
                    ]}
                  />
                </div>

                {ledger.data.devices.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Handsets owned
                    </p>
                    <DataTable
                      dense
                      rows={ledger.data.devices}
                      rowKey={(d: any, i) => `${d.imei1}-${i}`}
                      columns={[
                        {
                          key: 'model',
                          header: 'Handset',
                          render: (d: any) => `${d.brand_name} ${d.model_name}`
                        },
                        {
                          key: 'imei1',
                          header: 'IMEI',
                          render: (d: any) => <span className="font-mono text-xs">{d.imei1 ?? '—'}</span>
                        },
                        { key: 'sold_at', header: 'Bought on', render: (d: any) => formatDate(d.sold_at) },
                        { key: 'invoice_no', header: 'Invoice' },
                        {
                          key: 'warranty_months',
                          header: 'Warranty',
                          align: 'right',
                          render: (d: any) => `${d.warranty_months ?? 0} mo`
                        }
                      ]}
                    />
                  </div>
                )}

                {ledger.data.payments.length > 0 && (
                  <div>
                    <Separator className="my-2" />
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Payments received
                    </p>
                    <div className="space-y-1 text-[13px]">
                      {ledger.data.payments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {formatDate(p.payment_date)} · {p.mode ?? '—'} · {p.invoice_no ?? ''}
                          </span>
                          <span className="font-medium tnum">{money(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-[13px]">{value}</p>
    </div>
  )
}
