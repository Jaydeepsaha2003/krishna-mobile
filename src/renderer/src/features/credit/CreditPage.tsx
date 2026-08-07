import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  Download,
  MessageCircle,
  Phone,
  Search,
  Wallet
} from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
import { formatPhone } from '@shared/validators'
import { Badge, Button, Card, CardContent, Input } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { SimpleSelect, Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { Money, OverdueBadge, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'
import { RecordPaymentDialog } from './RecordPaymentDialog'

const BUCKETS = [
  { value: 'all', label: 'Everything' },
  { value: 'upcoming', label: 'Not yet due' },
  { value: 'due_1_7', label: '1–7 days late' },
  { value: 'due_8_30', label: '8–30 days late' },
  { value: 'due_30_plus', label: '30+ days late' },
  { value: 'no_date', label: 'No date promised' }
]

export function CreditPage() {
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId, shops } = useScope()
  const exportCsv = useCsvExport()

  const [bucket, setBucket] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [scope, setScope] = React.useState<string>('all')
  const [payFor, setPayFor] = React.useState<any>(null)
  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search the credit book',
    group: 'Credit',
    allowInInputs: true
  })

  const book = useQuery({
    queryKey: ['credit', companyId, scope, bucket, debounced],
    queryFn: () =>
      api.sales.creditBook({
        shopId: scope === 'all' ? undefined : scope,
        bucket,
        search: debounced || undefined
      }),
    enabled: Boolean(companyId)
  })

  const rows = book.data?.rows ?? []
  const totals = book.data?.totals

  const callOrMessage = (row: any, kind: 'call' | 'sms') => {
    const phone = row.customerPhone
    if (!phone) return toast.error('No phone number saved for this customer')
    const text = encodeURIComponent(
      `Namaste ${row.customerName}, this is a gentle reminder for the pending amount of ${money(
        row.dueAmount
      )} on bill ${row.invoiceNo}. Kindly arrange the payment. Thank you.`
    )
    void api.app.openExternal(kind === 'call' ? `tel:+91${phone}` : `sms:+91${phone}?body=${text}`)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Credit & dues"
        description="Every unpaid bill, its promised date and how late it is"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void exportCsv(
                'credit-book',
                rows.map((r: any) => ({
                  customer: r.customerName,
                  phone: r.customerPhone ?? '',
                  altPhone: r.customerAltPhone ?? '',
                  invoice: r.invoiceNo,
                  shop: r.shopName,
                  saleDate: r.saleDate,
                  total: r.total,
                  paid: r.paidAmount,
                  due: r.dueAmount,
                  promisedDate: r.dueDate ?? '',
                  daysLate: r.overdueDays,
                  note: r.promisedNote ?? ''
                }))
              )
            }
          >
            <Download /> Export
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total outstanding"
          value={money(totals?.outstanding)}
          sub={`${totals?.count ?? 0} open bills`}
          icon={Wallet}
          tone="primary"
        />
        <StatCard
          label="Overdue"
          value={money(totals?.overdue)}
          sub={`${totals?.overdueCount ?? 0} bills past the promised date`}
          icon={AlertOctagon}
          tone={(totals?.overdue ?? 0) > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Due later"
          value={money(totals?.upcoming)}
          sub={`${totals?.buckets.upcoming ?? 0} bills still within date`}
          icon={CalendarClock}
          tone="info"
        />
        <StatCard
          label="30+ days late"
          value={String(totals?.buckets.due_30_plus ?? 0)}
          sub="Needs a personal follow-up"
          icon={AlertOctagon}
          tone={(totals?.buckets.due_30_plus ?? 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Customer, phone or invoice…"
          prefixNode={<Search />}
          className="w-72"
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
        <div className="flex-1" />
        <Tabs value={bucket} onValueChange={setBucket}>
          <TabsList>
            {BUCKETS.map((b) => (
              <TabsTrigger key={b.value} value={b.value}>
                {b.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={book.isLoading}
        empty="Nothing outstanding — every bill is settled."
        maxHeight="calc(100vh - 400px)"
        columns={[
          {
            key: 'customerName',
            header: 'Customer',
            sortable: true,
            render: (r: any) => (
              <div className="min-w-0">
                <p className="truncate font-medium">{r.customerName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatPhone(r.customerPhone) || '—'}
                  {r.customerAltPhone ? ` · ${formatPhone(r.customerAltPhone)}` : ''}
                </p>
              </div>
            )
          },
          {
            key: 'invoiceNo',
            header: 'Bill',
            render: (r: any) => (
              <div>
                <p className="font-medium">{r.invoiceNo}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(r.saleDate)} · {r.shopCode}
                </p>
              </div>
            )
          },
          {
            key: 'itemsLabel',
            header: 'Items',
            hideBelow: 'lg',
            render: (r: any) => (
              <p className="max-w-[220px] truncate text-xs text-muted-foreground">{r.itemsLabel}</p>
            )
          },
          {
            key: 'dueDate',
            header: 'Promised',
            sortable: true,
            sortValue: (r: any) => r.dueDate ?? '9999',
            render: (r: any) => (
              <div className="space-y-1">
                <p className="text-[13px]">{formatDate(r.dueDate)}</p>
                <OverdueBadge days={r.overdueDays} />
                {r.promisedNote && (
                  <p className="max-w-[200px] truncate text-xs italic text-muted-foreground">
                    “{r.promisedNote}”
                  </p>
                )}
              </div>
            )
          },
          { key: 'total', header: 'Bill', align: 'right', render: (r: any) => <Money value={r.total} /> },
          { key: 'paidAmount', header: 'Paid', align: 'right', hideBelow: 'md', render: (r: any) => <Money value={r.paidAmount} /> },
          {
            key: 'dueAmount',
            header: 'Outstanding',
            align: 'right',
            sortable: true,
            render: (r: any) => <Money value={r.dueAmount} className="text-base font-semibold" />,
            footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.dueAmount, 0)} />
          },
          {
            key: 'actions',
            header: '',
            width: '150px',
            render: (r: any) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" title="Call" onClick={() => callOrMessage(r, 'call')}>
                  <Phone />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Send reminder SMS"
                  onClick={() => callOrMessage(r, 'sms')}
                >
                  <MessageCircle />
                </Button>
                {session.can('payment.manage') && (
                  <Button size="xs" onClick={() => setPayFor(r)}>
                    <Wallet /> Collect
                  </Button>
                )}
              </div>
            )
          }
        ]}
        showFooter
      />

      {rows.length === 0 && !book.isLoading && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4 text-[13px] text-muted-foreground">
            <CheckCircle2 className="size-5 text-success" />
            All credit has been recovered for this filter. Reminders for upcoming promises appear in
            the bell menu and as desktop notifications.
          </CardContent>
        </Card>
      )}

      <RecordPaymentDialog
        sale={payFor}
        onOpenChange={(v) => !v && setPayFor(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ['credit'] })
          void qc.invalidateQueries({ queryKey: ['sales'] })
          setPayFor(null)
        }}
      />

      <div className="flex flex-wrap gap-2">
        {BUCKETS.filter((b) => b.value !== 'all').map((b) => (
          <Badge key={b.value} variant="muted">
            {b.label}: {(totals as any)?.buckets?.[b.value] ?? 0}
          </Badge>
        ))}
      </div>
    </div>
  )
}
