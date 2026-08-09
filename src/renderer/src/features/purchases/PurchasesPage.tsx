import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Plus, Search, Trash2, Truck, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useDateRange, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
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
import { SimpleSelect } from '@/components/ui/form'
import { DateRangePicker, Money, PageHeader, StatCard, StockStatusBadge, Toolbar } from '@/components/ui/misc'
import { PAYMENT_MODES } from '@shared/constants'

export function PurchasesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shops } = useScope()
  const exportCsv = useCsvExport()

  const [range, setRange] = useDateRange('purchases')
  const [search, setSearch] = React.useState('')
  const [scope, setScope] = React.useState('all')
  const [onlyDue, setOnlyDue] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [payFor, setPayFor] = React.useState<any>(null)
  const [payAmount, setPayAmount] = React.useState<number | ''>('')
  const [payMode, setPayMode] = React.useState('Cash')
  const [deleteFor, setDeleteFor] = React.useState<any>(null)
  const [deleteReason, setDeleteReason] = React.useState('')

  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search purchases',
    group: 'Purchases',
    allowInInputs: true
  })
  useHotkey('ctrl+shift+p', () => navigate('/purchases/new'), {
    description: 'New purchase',
    group: 'Purchases',
    allowInInputs: true
  })

  const purchases = useQuery({
    queryKey: ['purchases', companyId, scope, range, debounced, onlyDue],
    queryFn: () =>
      api.purchases.list({
        shopId: scope === 'all' ? undefined : scope,
        from: range.from,
        to: range.to,
        search: debounced || undefined,
        onlyDue,
        limit: 300
      }),
    enabled: Boolean(companyId)
  })

  const detail = useQuery({
    queryKey: ['purchase', detailId],
    queryFn: () => api.purchases.get(detailId!),
    enabled: Boolean(detailId)
  })

  const rows = purchases.data?.rows ?? []
  const summary = purchases.data?.summary

  const submitPayment = async () => {
    try {
      await api.purchases.recordPayment({
        purchaseId: payFor.id,
        amount: Number(payAmount) || 0,
        mode: payMode
      })
      toast.success(`${money(Number(payAmount))} paid to ${payFor.supplierName ?? 'supplier'}`)
      setPayFor(null)
      void qc.invalidateQueries({ queryKey: ['purchases'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const doDelete = async () => {
    try {
      await api.purchases.remove(deleteFor.id, deleteReason)
      toast.success(`${deleteFor.invoiceNo} deleted — its stock was removed`)
      setDeleteFor(null)
      setDeleteReason('')
      setDetailId(null)
      void qc.invalidateQueries({ queryKey: ['purchases'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })
      void qc.invalidateQueries({ queryKey: ['dash'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchases"
        description={`Stock bought in from suppliers · ${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  'purchases',
                  rows.map((r: any) => ({
                    billNo: r.invoiceNo,
                    date: r.purchaseDate,
                    supplier: r.supplierName ?? '',
                    shop: r.shopName,
                    units: r.unitCount,
                    total: r.total,
                    paid: r.paidAmount,
                    due: r.dueAmount,
                    dueDate: r.dueDate ?? ''
                  }))
                )
              }
            >
              <Download /> Export
            </Button>
            {session.can('purchase.manage') && (
              <Button size="sm" onClick={() => navigate('/purchases/new')}>
                <Plus /> New purchase
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Purchase value" value={money(summary?.total)} icon={Truck} tone="primary" />
        <StatCard label="Bills" value={String(summary?.count ?? 0)} icon={Truck} />
        <StatCard
          label="Payable"
          value={money(summary?.due)}
          icon={Wallet}
          tone={(summary?.due ?? 0) > 0 ? 'warning' : 'success'}
          onClick={() => setOnlyDue((v) => !v)}
          sub={onlyDue ? 'Showing unpaid only — click to clear' : 'Click to filter unpaid'}
        />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Bill number or supplier…"
          prefixNode={<Search />}
          className="w-72"
        />
        <DateRangePicker value={range} onChange={setRange} />
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
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={purchases.isLoading}
        onRowClick={(r: any) => setDetailId(r.id)}
        empty="No purchases in this period"
        maxHeight="calc(100vh - 400px)"
        columns={[
          {
            key: 'invoiceNo',
            header: 'Bill',
            sortable: true,
            render: (r: any) => (
              <div>
                <p className="font-medium">{r.invoiceNo}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.purchaseDate)}</p>
              </div>
            )
          },
          {
            key: 'supplierName',
            header: 'Supplier',
            sortable: true,
            render: (r: any) => r.supplierName ?? <span className="text-muted-foreground">—</span>
          },
          { key: 'shopCode', header: 'Shop', render: (r: any) => <Badge variant="outline">{r.shopCode}</Badge> },
          { key: 'unitCount', header: 'Units', align: 'right', sortable: true },
          { key: 'total', header: 'Total', align: 'right', sortable: true, render: (r: any) => <Money value={r.total} className="font-semibold" /> },
          { key: 'paidAmount', header: 'Paid', align: 'right', hideBelow: 'md', render: (r: any) => <Money value={r.paidAmount} /> },
          {
            key: 'dueAmount',
            header: 'Payable',
            align: 'right',
            sortable: true,
            render: (r: any) =>
              r.dueAmount > 0.5 ? (
                <div>
                  <Money value={r.dueAmount} className="font-semibold text-warning" />
                  {r.dueDate && <p className="text-xs text-muted-foreground">{formatDate(r.dueDate)}</p>}
                </div>
              ) : (
                <Badge variant="success">Settled</Badge>
              )
          },
          {
            key: 'actions',
            header: '',
            width: '150px',
            render: (r: any) => (
              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {r.dueAmount > 0.5 && session.can('payment.manage') && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setPayFor(r)
                      setPayAmount(r.dueAmount)
                    }}
                  >
                    <Wallet /> Pay
                  </Button>
                )}
                {session.can('purchase.manage') && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Delete bill"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setDeleteReason('')
                      setDeleteFor(r)
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            )
          }
        ]}
      />

      {/* --------------------------------------------------------- detail */}
      <Dialog open={Boolean(detailId)} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent size="xl" className="max-h-[88vh]">
          {detail.data && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.data.purchase.invoice_no}</DialogTitle>
                <DialogDescription>
                  {detail.data.purchase.supplier_name ?? 'No supplier'} ·{' '}
                  {formatDate(detail.data.purchase.purchase_date)} · {detail.data.purchase.shop_name}
                </DialogDescription>
              </DialogHeader>

              <div className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
                <div className="grid gap-3 sm:grid-cols-4">
                  <StatCard label="Total" value={money(detail.data.purchase.total)} />
                  <StatCard label="Paid" value={money(detail.data.purchase.paid_amount)} />
                  <StatCard label="Payable" value={money(detail.data.purchase.due_amount)} />
                  <StatCard label="Units" value={String(detail.data.units.length)} />
                </div>

                <Card>
                  <CardContent className="p-0">
                    <DataTable
                      dense
                      className="rounded-none border-0"
                      rows={detail.data.units}
                      rowKey={(u: any) => u.id}
                      empty="No units recorded"
                      columns={[
                        {
                          key: 'label',
                          header: 'Handset',
                          render: (u: any) => (
                            <div>
                              <p className="font-medium">{u.label}</p>
                              {u.imei1 && (
                                <p className="font-mono text-xs text-muted-foreground">{u.imei1}</p>
                              )}
                            </div>
                          )
                        },
                        { key: 'color', header: 'Colour', hideBelow: 'md' },
                        { key: 'costPrice', header: 'Cost', align: 'right', render: (u: any) => <Money value={u.costPrice} /> },
                        { key: 'salePrice', header: 'Sell at', align: 'right', render: (u: any) => <Money value={u.salePrice} blankZero /> },
                        { key: 'shopName', header: 'At', hideBelow: 'md' },
                        { key: 'status', header: 'Status', render: (u: any) => <StockStatusBadge status={u.status} /> }
                      ]}
                    />
                  </CardContent>
                </Card>
              </div>

              {session.can('purchase.manage') && (
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setDeleteReason('')
                      setDeleteFor({ id: detail.data.purchase.id, invoiceNo: detail.data.purchase.invoice_no })
                    }}
                  >
                    <Trash2 /> Delete this bill
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------------- payment */}
      <Dialog open={Boolean(payFor)} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Pay supplier</DialogTitle>
            <DialogDescription>
              {payFor?.supplierName} · {payFor?.invoiceNo} · {money(payFor?.dueAmount)} payable
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Amount" required>
              <Input
                autoFocus
                type="number"
                min={0}
                max={payFor?.dueAmount}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="h-10 text-right text-lg font-semibold tnum"
              />
            </Field>
            <Field label="Mode">
              <SimpleSelect value={payMode} onChange={setPayMode} options={[...PAYMENT_MODES]} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitPayment()}>Record payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -------------------------------------------------------- delete */}
      <ConfirmDialog
        open={Boolean(deleteFor)}
        onOpenChange={(v) => !v && setDeleteFor(null)}
        title={`Delete ${deleteFor?.invoiceNo}?`}
        description="The bill is removed permanently and the stock it brought in is deleted. This is only allowed if none of those items have been sold or transferred yet. The deletion is written to the audit trail."
        confirmLabel="Delete bill"
        destructive
        onConfirm={doDelete}
      >
        <Field label="Reason" hint="Kept in the audit trail">
          <Textarea
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="e.g. duplicate bill / entered against the wrong shop"
          />
        </Field>
      </ConfirmDialog>
    </div>
  )
}
