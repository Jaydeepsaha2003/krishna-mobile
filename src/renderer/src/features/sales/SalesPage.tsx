import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Ban,
  Download,
  FileText,
  Filter,
  Printer,
  Receipt,
  Search,
  ShoppingCart,
  Wallet
} from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useDateRange, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
import { Badge, Button, Card, CardContent, Field, Input, Separator, Textarea } from '@/components/ui/base'
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
import { SimpleSelect } from '@/components/ui/form'
import { DateRangePicker, Money, PageHeader, SaleStatusBadge, StatCard, Toolbar } from '@/components/ui/misc'
import { buildInvoiceHtml } from './invoice'
import { RecordPaymentDialog } from '@/features/credit/RecordPaymentDialog'

export function SalesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId, shops } = useScope()
  const exportCsv = useCsvExport()
  const [params, setParams] = useSearchParams()

  const [range, setRange] = useDateRange('sales')
  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState('all')
  const [scope, setScope] = React.useState<string>(shopId ?? 'all')
  const [detailId, setDetailId] = React.useState<string | null>(params.get('id'))
  const [payFor, setPayFor] = React.useState<any>(null)
  const [cancelFor, setCancelFor] = React.useState<any>(null)
  const [cancelReason, setCancelReason] = React.useState('')

  const debouncedSearch = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search sales',
    group: 'Sales',
    allowInInputs: true
  })
  useHotkey('ctrl+shift+e', () => void doExport(), {
    description: 'Export to CSV',
    group: 'Sales',
    allowInInputs: true
  })

  const sales = useQuery({
    queryKey: ['sales', companyId, scope, range, debouncedSearch, status],
    queryFn: () =>
      api.sales.list({
        shopId: scope === 'all' ? undefined : scope,
        from: range.from,
        to: range.to,
        search: debouncedSearch || undefined,
        status,
        limit: 400
      }),
    enabled: Boolean(companyId)
  })

  const detail = useQuery({
    queryKey: ['sale', detailId],
    queryFn: () => api.sales.get(detailId!),
    enabled: Boolean(detailId)
  })

  const rows = sales.data?.rows ?? []
  const summary = sales.data?.summary

  const doExport = async () => {
    await exportCsv(
      'sales',
      rows.map((r: any) => ({
        invoice: r.invoiceNo,
        date: r.saleDate,
        shop: r.shopName,
        customer: r.customerName,
        phone: r.customerPhone ?? '',
        items: r.itemsLabel ?? '',
        total: r.total,
        paid: r.paidAmount,
        due: r.dueAmount,
        dueDate: r.dueDate ?? '',
        mode: r.paymentMode ?? '',
        status: r.status,
        profit: session.can('report.profit') ? r.totalProfit : '',
        billedBy: r.createdByName ?? ''
      }))
    )
  }

  const print = async (id: string) => {
    const full = await api.sales.get(id)
    await api.files.print(buildInvoiceHtml(full))
  }

  const savePdf = async (id: string) => {
    const full = await api.sales.get(id)
    const res = await api.files.exportPdf(full.sale.invoiceNo.replace(/\//g, '-'), buildInvoiceHtml(full))
    if (res?.saved)
      toast.success('Invoice saved', {
        action: { label: 'Show file', onClick: () => void api.files.reveal(res.filePath) }
      })
  }

  const doCancel = async () => {
    try {
      await api.sales.cancel(cancelFor.id, cancelReason)
      toast.success(`${cancelFor.invoiceNo} cancelled — stock returned to the shelf`)
      setCancelFor(null)
      setCancelReason('')
      void qc.invalidateQueries({ queryKey: ['sales'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        description={`${summary?.count ?? 0} bills · ${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void doExport()}>
              <Download /> Export
            </Button>
            {session.can('sale.manage') && (
              <Button size="sm" onClick={() => navigate('/sales/new')}>
                <ShoppingCart /> New sale
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={money(summary?.total)} icon={Receipt} tone="primary" />
        <StatCard label="Collected" value={money((summary?.total ?? 0) - (summary?.due ?? 0))} icon={Wallet} tone="success" />
        <StatCard label="On credit" value={money(summary?.due)} icon={Wallet} tone={(summary?.due ?? 0) > 0 ? 'warning' : 'default'} />
        {session.can('report.profit') && (
          <StatCard label="Profit" value={money(summary?.profit)} icon={FileText} tone="info" />
        )}
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Invoice, customer, phone or IMEI…"
          prefixNode={<Search />}
          suffixNode={<span className="kbd">Ctrl F</span>}
          className="w-80"
        />
        <DateRangePicker value={range} onChange={setRange} />
        {shops.length > 1 && (
          <SimpleSelect
            value={scope}
            onChange={setScope}
            options={[{ value: 'all', label: 'All shops' }, ...shops.map((s) => ({ value: s.id, label: s.name }))]}
            className="w-44"
          />
        )}
        <SimpleSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'completed', label: 'Paid' },
            { value: 'partially_paid', label: 'Part paid' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'cancelled', label: 'Cancelled' }
          ]}
          className="w-40"
        />
        <div className="flex-1" />
        <Badge variant="muted">
          <Filter className="size-3" /> {rows.length} shown
        </Badge>
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={sales.isLoading}
        onRowClick={(r: any) => setDetailId(r.id)}
        empty="No bills in this period"
        maxHeight="calc(100vh - 420px)"
        columns={[
          {
            key: 'invoiceNo',
            header: 'Invoice',
            sortable: true,
            render: (r: any) => (
              <div>
                <p className="font-medium">{r.invoiceNo}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.saleDate)}</p>
              </div>
            )
          },
          {
            key: 'customerName',
            header: 'Customer',
            sortable: true,
            render: (r: any) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{r.customerName}</p>
                <p className="truncate text-xs text-muted-foreground">{r.customerPhone ?? '—'}</p>
              </div>
            )
          },
          {
            key: 'itemsLabel',
            header: 'Items',
            hideBelow: 'lg',
            render: (r: any) => (
              <p className="max-w-[280px] truncate text-xs text-muted-foreground">
                {r.itemsLabel ?? `${r.itemCount} item(s)`}
              </p>
            )
          },
          { key: 'shopCode', header: 'Shop', hideBelow: 'md', render: (r: any) => <Badge variant="outline">{r.shopCode}</Badge> },
          { key: 'total', header: 'Total', align: 'right', sortable: true, render: (r: any) => <Money value={r.total} className="font-semibold" /> },
          {
            key: 'dueAmount',
            header: 'Due',
            align: 'right',
            sortable: true,
            render: (r: any) =>
              r.dueAmount > 0.5 ? (
                <div>
                  <Money value={r.dueAmount} className="font-semibold text-warning" />
                  <p className="text-xs text-muted-foreground">{formatDate(r.dueDate)}</p>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
          },
          ...(session.can('report.profit')
            ? [
                {
                  key: 'totalProfit',
                  header: 'Profit',
                  align: 'right' as const,
                  sortable: true,
                  hideBelow: 'lg' as const,
                  render: (r: any) => <Money value={r.totalProfit} colored />
                }
              ]
            : []),
          { key: 'status', header: 'Status', render: (r: any) => <SaleStatusBadge status={r.status} /> },
          {
            key: 'actions',
            header: '',
            width: '120px',
            render: (r: any) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {r.dueAmount > 0.5 && session.can('payment.manage') && (
                  <Button variant="ghost" size="icon-sm" title="Record payment" onClick={() => setPayFor(r)}>
                    <Wallet />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" title="Print" onClick={() => void print(r.id)}>
                  <Printer />
                </Button>
                {session.can('sale.manage') && r.status !== 'cancelled' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Cancel bill"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setCancelFor(r)}
                  >
                    <Ban />
                  </Button>
                )}
              </div>
            )
          }
        ]}
      />

      {/* ------------------------------------------------------- detail */}
      <Dialog
        open={Boolean(detailId)}
        onOpenChange={(v) => {
          if (!v) {
            setDetailId(null)
            params.delete('id')
            setParams(params, { replace: true })
          }
        }}
      >
        <DialogContent size="lg" className="max-h-[88vh]">
          {detail.data && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.data.sale.invoiceNo}
                  <SaleStatusBadge status={detail.data.sale.status} />
                </DialogTitle>
                <DialogDescription>
                  {formatDate(detail.data.sale.saleDate)} · {detail.data.sale.shopName} · billed by{' '}
                  {detail.data.sale.createdByName ?? '—'}
                </DialogDescription>
              </DialogHeader>

              <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
                <Card>
                  <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
                    <Info label="Customer" value={detail.data.sale.customerName} />
                    <Info label="Phone" value={detail.data.sale.customerPhone ?? '—'} />
                    <Info label="Payment mode" value={detail.data.sale.paymentMode ?? '—'} />
                  </CardContent>
                </Card>

                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-2 py-2 text-center">Qty</th>
                        <th className="px-2 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        {session.can('report.profit') && <th className="px-3 py-2 text-right">Profit</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.items.map((it: any) => (
                        <tr key={it.id} className="border-t border-border/60">
                          <td className="px-3 py-2">
                            <p className="font-medium">{it.description}</p>
                            {it.imei1 && (
                              <p className="font-mono text-xs text-muted-foreground">{it.imei1}</p>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center tnum">{it.qty}</td>
                          <td className="px-2 py-2 text-right tnum">{money(it.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-medium tnum">{money(it.line_total)}</td>
                          {session.can('report.profit') && (
                            <td className="px-3 py-2 text-right">
                              <Money value={it.profit} colored />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="ml-auto w-full max-w-xs space-y-1 text-[13px]">
                  <Line label="Sub total" value={money(detail.data.sale.subtotal)} />
                  <Line label="GST" value={money(detail.data.sale.taxAmount)} />
                  {detail.data.sale.discount > 0 && (
                    <Line label="Discount" value={`- ${money(detail.data.sale.discount)}`} />
                  )}
                  <Separator className="my-1.5" />
                  <Line label="Total" value={money(detail.data.sale.total)} bold />
                  <Line label="Paid" value={money(detail.data.sale.paidAmount)} />
                  {detail.data.sale.dueAmount > 0 && (
                    <Line
                      label={`Due by ${formatDate(detail.data.sale.dueDate)}`}
                      value={money(detail.data.sale.dueAmount)}
                      tone="warning"
                      bold
                    />
                  )}
                </div>

                {detail.data.payments.length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Payments
                      </p>
                      <div className="space-y-1 text-[13px]">
                        {detail.data.payments.map((p: any) => (
                          <div key={p.id} className="flex items-center justify-between">
                            <span>
                              {formatDate(p.payment_date)} · {p.mode ?? '—'}
                              {p.reference ? ` · ${p.reference}` : ''}
                            </span>
                            <span className="font-medium tnum">{money(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => void savePdf(detail.data.sale.id)}>
                  <FileText /> Save PDF
                </Button>
                <Button onClick={() => void print(detail.data.sale.id)}>
                  <Printer /> Print
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <RecordPaymentDialog
        sale={payFor}
        onOpenChange={(v) => !v && setPayFor(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['sales'] })
          setPayFor(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelFor)}
        onOpenChange={(v) => !v && setCancelFor(null)}
        title={`Cancel ${cancelFor?.invoiceNo}?`}
        description="Every handset on this bill goes back into stock and all recorded payments are removed. This is written to the audit trail."
        confirmLabel="Cancel bill"
        destructive
        onConfirm={doCancel}
      >
        <Field label="Reason" required>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="e.g. wrong IMEI billed, customer returned the phone"
          />
        </Field>
      </ConfirmDialog>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium">{value}</p>
    </div>
  )
}

function Line({
  label,
  value,
  bold,
  tone
}: {
  label: string
  value: React.ReactNode
  bold?: boolean
  tone?: 'warning'
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}>{label}</span>
      <span
        className={`tnum ${bold ? 'font-semibold' : ''} ${tone === 'warning' ? 'text-warning' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}
