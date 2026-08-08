import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, Download, HandCoins, Plus, Search, TriangleAlert, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport, useDateRange, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { formatDate, money } from '@/lib/utils'
import { LOAN_STATUS_LABELS } from '@shared/constants'
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { ConfirmDialog } from '@/components/ui/overlay'
import { SimpleSelect, Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { DateRangePicker, Money, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'

export function LoansPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId, shops } = useScope()
  const exportCsv = useCsvExport()

  const [range, setRange] = useDateRange('loans')
  const [scope, setScope] = React.useState(shopId ?? 'all')
  const [status, setStatus] = React.useState('all')
  const [onlyOverdue, setOnlyOverdue] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [cancelFor, setCancelFor] = React.useState<any>(null)
  const [cancelReason, setCancelReason] = React.useState('')

  const debounced = useDebounced(search, 250)
  const searchRef = React.useRef<HTMLInputElement>(null)

  useHotkey('ctrl+f', () => searchRef.current?.focus(), {
    description: 'Search loans',
    group: 'Loans',
    allowInInputs: true
  })
  useHotkey('ctrl+n', () => navigate('/loans/new'), {
    description: 'New EMI loan',
    group: 'Loans',
    allowInInputs: true
  })

  const loans = useQuery({
    queryKey: ['loans', companyId, scope, status, range, debounced, onlyOverdue],
    queryFn: () =>
      api.loans.list({
        shopId: scope === 'all' ? undefined : scope,
        status,
        from: range.from,
        to: range.to,
        search: debounced || undefined,
        onlyOverdue,
        limit: 400
      }),
    enabled: Boolean(companyId)
  })

  const rows = loans.data?.rows ?? []
  const summary = loans.data?.summary

  const doCancel = async () => {
    try {
      await api.loans.cancel(cancelFor.id, cancelReason)
      toast.success(`${cancelFor.loanNo} cancelled`)
      setCancelFor(null)
      setCancelReason('')
      void qc.invalidateQueries({ queryKey: ['loans'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="EMI loans"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  'emi-loans',
                  rows.map((r: any) => ({
                    loanNo: r.loanNo,
                    date: r.loanDate,
                    customer: r.customerName,
                    phone: r.customerPhone ?? '',
                    shop: r.shopCode,
                    product: `${r.brand ?? ''} ${r.modelName ?? ''}`.trim(),
                    imei: r.imei ?? '',
                    saleAmount: r.saleAmount,
                    downPayment: r.downPayment,
                    loanAmount: r.loanAmount,
                    outstanding: r.currentOutstanding,
                    tenure: r.tenureMonths,
                    monthlyEmi: r.monthlyEmi,
                    overdueCount: r.overdueCount,
                    status: r.status
                  }))
                )
              }
            >
              <Download /> Export
            </Button>
            {session.can('loan.manage') && (
              <Button size="sm" onClick={() => navigate('/loans/new')}>
                <Plus /> New loan <span className="kbd ml-1">Ctrl N</span>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Loans" value={String(summary?.count ?? 0)} icon={HandCoins} tone="primary" />
        <StatCard label="Financed" value={money(summary?.financed)} icon={Wallet} />
        <StatCard
          label="Outstanding"
          value={money(summary?.outstanding)}
          icon={Wallet}
          tone={(summary?.outstanding ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Active / Closed"
          value={`${summary?.active ?? 0} / ${summary?.closed ?? 0}`}
          icon={TriangleAlert}
        />
      </div>

      <Toolbar>
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Loan no, customer, phone, IMEI…"
          prefixNode={<Search />}
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
            { value: 'all', label: 'Any status' },
            ...Object.entries(LOAN_STATUS_LABELS).map(([value, label]) => ({ value, label }))
          ]}
          className="w-40"
        />
        <div className="flex-1" />
        <Tabs value={onlyOverdue ? 'overdue' : 'all'} onValueChange={(v) => setOnlyOverdue(v === 'overdue')}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="overdue">Overdue EMI</TabsTrigger>
          </TabsList>
        </Tabs>
      </Toolbar>

      <DataTable
        rows={rows}
        rowKey={(r: any) => r.id}
        loading={loans.isLoading}
        onRowClick={(r: any) => navigate(`/loans/${r.id}/repay`)}
        empty="No EMI loans in this period"
        maxHeight="calc(100vh - 420px)"
        columns={[
          {
            key: 'loanNo',
            header: 'Loan',
            sortable: true,
            render: (r: any) => (
              <div>
                <p className="font-medium">{r.loanNo}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.loanDate)}</p>
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
            key: 'modelName',
            header: 'Product',
            render: (r: any) => (
              <div className="min-w-0">
                <p className="truncate text-[13px]">
                  {[r.brand, r.modelName].filter(Boolean).join(' ') || '—'}
                </p>
                {r.imei && <p className="truncate font-mono text-xs text-muted-foreground">{r.imei}</p>}
              </div>
            )
          },
          { key: 'shopCode', header: 'Shop', render: (r: any) => <Badge variant="outline">{r.shopCode}</Badge> },
          { key: 'loanAmount', header: 'Financed', align: 'right', sortable: true, render: (r: any) => <Money value={r.loanAmount} /> },
          {
            key: 'currentOutstanding',
            header: 'Outstanding',
            align: 'right',
            sortable: true,
            render: (r: any) => (
              <Money value={r.currentOutstanding} className={r.currentOutstanding > 0 ? 'font-semibold text-warning' : ''} blankZero />
            )
          },
          {
            key: 'overdueCount',
            header: 'Overdue',
            align: 'right',
            render: (r: any) =>
              r.overdueCount > 0 ? (
                <div>
                  <Badge variant="danger">{r.overdueCount} EMI</Badge>
                  <p className="mt-0.5 text-xs text-muted-foreground">{money(r.overdueAmount)}</p>
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
          },
          {
            key: 'status',
            header: 'Status',
            render: (r: any) => (
              <Badge
                variant={
                  r.status === 'ACTIVE'
                    ? 'info'
                    : r.status === 'CLOSED'
                      ? 'success'
                      : r.status === 'FORECLOSED'
                        ? 'secondary'
                        : 'muted'
                }
              >
                {LOAN_STATUS_LABELS[r.status as keyof typeof LOAN_STATUS_LABELS] ?? r.status}
              </Badge>
            )
          },
          {
            key: 'actions',
            header: '',
            width: '140px',
            render: (r: any) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {r.status === 'ACTIVE' && session.can('loan.repayment') && (
                  <Button size="xs" onClick={() => navigate(`/loans/${r.id}/repay`)}>
                    <Wallet /> Collect
                  </Button>
                )}
                {r.status === 'ACTIVE' && session.can('loan.foreclose') && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Cancel loan"
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

      <ConfirmDialog
        open={Boolean(cancelFor)}
        onOpenChange={(v) => !v && setCancelFor(null)}
        title={`Cancel ${cancelFor?.loanNo}?`}
        description="Only possible if no EMI has been collected yet. If a handset from stock was linked, it returns to stock."
        confirmLabel="Cancel loan"
        destructive
        onConfirm={doCancel}
      >
        <Field label="Reason" required>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  )
}
