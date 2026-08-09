import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeftRight, Ban, Check, Inbox, PackageCheck, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useDateRange, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { formatDate, money } from '@/lib/utils'
import { Badge, Button, Card, CardContent, Field, Textarea } from '@/components/ui/base'
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
import { SimpleSelect, Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { DateRangePicker, Money, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'
import { TransferStatusBadge } from './TransferDialog'
import { NewTransferDialog } from './NewTransferDialog'

export function TransfersPage() {
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId, shops } = useScope()

  const [range, setRange] = useDateRange('transfers')
  const [direction, setDirection] = React.useState<'all' | 'in' | 'out'>('all')
  const [status, setStatus] = React.useState('all')
  const [scope, setScope] = React.useState(shopId ?? 'all')
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [cancelFor, setCancelFor] = React.useState<any>(null)
  const [cancelReason, setCancelReason] = React.useState('')
  const [newOpen, setNewOpen] = React.useState(false)

  const transfers = useQuery({
    queryKey: ['transfers', companyId, scope, direction, status, range],
    queryFn: () =>
      api.transfers.list({
        shopId: scope === 'all' ? undefined : scope,
        direction,
        status,
        from: range.from,
        to: range.to,
        limit: 200
      }),
    enabled: Boolean(companyId)
  })

  const detail = useQuery({
    queryKey: ['transfer', detailId],
    queryFn: () => api.transfers.get(detailId!),
    enabled: Boolean(detailId)
  })

  const rows = transfers.data ?? []
  const pending = rows.filter((r: any) => r.status === 'in_transit')
  const totalMoved = rows
    .filter((r: any) => r.status === 'received')
    .reduce((a: number, r: any) => a + Number(r.totalValue || 0), 0)

  const receive = async (transferId: string) => {
    try {
      const res = await api.transfers.receive(transferId)
      toast.success(`${res.received} unit(s) received into stock`)
      void qc.invalidateQueries({ queryKey: ['transfers'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const doCancel = async () => {
    try {
      await api.transfers.cancel(cancelFor.id, cancelReason)
      toast.success('Transfer cancelled — units returned to the sending shop')
      setCancelFor(null)
      setCancelReason('')
      void qc.invalidateQueries({ queryKey: ['transfers'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock transfers"
        description="Moving stock between your shops, with a confirmation step at the receiving end"
        actions={
          session.can('transfer.manage') &&
          shops.length > 1 && (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <ArrowLeftRight /> Transfer stock
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Waiting to be received"
          value={String(pending.length)}
          sub={money(pending.reduce((a: number, r: any) => a + Number(r.totalValue || 0), 0))}
          icon={Inbox}
          tone={pending.length > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Transfers in period"
          value={String(rows.length)}
          icon={ArrowLeftRight}
        />
        <StatCard label="Value moved" value={money(totalMoved)} icon={PackageCheck} tone="info" />
      </div>

      {pending.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Inbox className="size-5 shrink-0 text-warning" />
            <p className="flex-1 text-[13px]">
              <span className="font-medium">{pending.length} transfer(s)</span> are in transit. The
              units are not yet counted in the receiving shop's stock — confirm arrival to add them.
            </p>
          </CardContent>
        </Card>
      )}

      <Toolbar>
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
        <SimpleSelect
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Any status' },
            { value: 'in_transit', label: 'In transit' },
            { value: 'received', label: 'Received' },
            { value: 'cancelled', label: 'Cancelled' }
          ]}
          className="w-40"
        />
        <div className="flex-1" />
        <Tabs value={direction} onValueChange={(v) => setDirection(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="in">
              <Inbox /> Incoming
            </TabsTrigger>
            <TabsTrigger value="out">
              <Send /> Outgoing
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={transfers.isLoading}
        onRowClick={(r: any) => setDetailId(r.id)}
        empty="No transfers in this period. Select units on the Stock page to start one."
        maxHeight="calc(100vh - 440px)"
        columns={[
          {
            key: 'transferNo',
            header: 'Transfer',
            sortable: true,
            render: (r: any) => (
              <div>
                <p className="font-medium">{r.transferNo}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.transferDate)}</p>
              </div>
            )
          },
          {
            key: 'route',
            header: 'Route',
            render: (r: any) => (
              <div className="flex items-center gap-2 text-[13px]">
                <Badge variant="outline">{r.fromShopCode}</Badge>
                <ArrowLeftRight className="size-3 text-muted-foreground" />
                <Badge variant="outline">{r.toShopCode}</Badge>
              </div>
            )
          },
          { key: 'totalUnits', header: 'Units', align: 'right', sortable: true },
          { key: 'totalValue', header: 'Value', align: 'right', sortable: true, render: (r: any) => <Money value={r.totalValue} /> },
          { key: 'createdByName', header: 'Sent by', hideBelow: 'lg' },
          { key: 'status', header: 'Status', render: (r: any) => <TransferStatusBadge status={r.status} /> },
          {
            key: 'actions',
            header: '',
            width: '160px',
            render: (r: any) =>
              r.status === 'in_transit' && session.can('transfer.manage') ? (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="xs" onClick={() => void receive(r.id)}>
                    <Check /> Receive
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setCancelFor(r)}
                  >
                    <Ban />
                  </Button>
                </div>
              ) : null
          }
        ]}
      />

      <Dialog open={Boolean(detailId)} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent size="lg" className="max-h-[85vh]">
          {detail.data && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.data.transfer.transfer_no}
                  <TransferStatusBadge status={detail.data.transfer.status} />
                </DialogTitle>
                <DialogDescription>
                  {detail.data.transfer.from_shop_name} → {detail.data.transfer.to_shop_name} ·{' '}
                  {formatDate(detail.data.transfer.transfer_date)}
                </DialogDescription>
              </DialogHeader>

              <div className="-mx-1 flex-1 overflow-y-auto px-1">
                <DataTable
                  dense
                  rows={detail.data.items}
                  rowKey={(i: any) => i.id}
                  columns={[
                    {
                      key: 'model',
                      header: 'Handset',
                      render: (i: any) => (
                        <div>
                          <p className="font-medium">
                            {i.brand_name} {i.model_name}
                          </p>
                          {i.imei1 && (
                            <p className="font-mono text-xs text-muted-foreground">{i.imei1}</p>
                          )}
                        </div>
                      )
                    },
                    { key: 'color', header: 'Colour', hideBelow: 'md' },
                    {
                      key: 'cost_at_transfer',
                      header: 'Cost at send',
                      align: 'right',
                      render: (i: any) => <Money value={i.cost_at_transfer} />
                    },
                    {
                      key: 'transfer_price',
                      header: 'Transfer price',
                      align: 'right',
                      render: (i: any) => <Money value={i.transfer_price} />
                    },
                    {
                      key: 'received',
                      header: 'Received',
                      render: (i: any) =>
                        i.received ? (
                          <Badge variant="success">Yes</Badge>
                        ) : (
                          <Badge variant="warning">Pending</Badge>
                        )
                    }
                  ]}
                />
              </div>

              {detail.data.transfer.status === 'in_transit' && session.can('transfer.manage') && (
                <DialogFooter>
                  <Button
                    onClick={async () => {
                      await receive(detail.data.transfer.id)
                      setDetailId(null)
                    }}
                  >
                    <Check /> Receive everything
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(cancelFor)}
        onOpenChange={(v) => !v && setCancelFor(null)}
        title={`Cancel ${cancelFor?.transferNo}?`}
        description="Every unit still in transit goes back to the sending shop's stock."
        confirmLabel="Cancel transfer"
        destructive
        onConfirm={doCancel}
      >
        <Field label="Reason">
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <NewTransferDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  )
}
