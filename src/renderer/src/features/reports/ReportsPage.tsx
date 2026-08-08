import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Download, HandCoins, Search, Store, TrendingUp } from 'lucide-react'
import { FEATURES } from '@shared/constants'
import { api } from '@/lib/api'
import { useBrands, useCsvExport, useDateRange, useDebounced, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { formatDate, money, percent } from '@/lib/utils'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { SimpleSelect, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/form'
import { DateRangePicker, EmptyState, Money, PageHeader, StatCard, Toolbar } from '@/components/ui/misc'

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))'
]

export function ReportsPage() {
  const session = useSession()
  const { companyId, shopId, shops } = useScope()
  const exportCsv = useCsvExport()
  const brands = useBrands()

  const [range, setRange] = useDateRange('reports')
  const [scope, setScope] = React.useState('all')
  const [tab, setTab] = React.useState('shops')
  const [search, setSearch] = React.useState('')
  const [brandId, setBrandId] = React.useState('all')
  const debounced = useDebounced(search, 300)

  const canProfit = session.can('report.profit')
  const shopParam = scope === 'all' ? undefined : scope
  const base = { shopId: shopParam, from: range.from, to: range.to }

  const pnl = useQuery({
    queryKey: ['rep-pnl', companyId, range],
    queryFn: () => api.reports.shopPnl({ from: range.from, to: range.to }),
    enabled: Boolean(companyId) && canProfit
  })

  const unitProfit = useQuery({
    queryKey: ['rep-units', companyId, scope, range, debounced, brandId],
    queryFn: () =>
      api.reports.unitProfit({
        ...base,
        search: debounced || undefined,
        brandId: brandId === 'all' ? undefined : brandId,
        limit: 500
      }),
    enabled: Boolean(companyId) && canProfit && tab === 'handsets'
  })

  const models = useQuery({
    queryKey: ['rep-models', companyId, scope, range],
    queryFn: () => api.reports.models(base),
    enabled: Boolean(companyId) && tab === 'models'
  })

  const brandShare = useQuery({
    queryKey: ['rep-brands', companyId, scope, range],
    queryFn: () => api.reports.brands(base),
    enabled: Boolean(companyId) && tab === 'models'
  })

  const staff = useQuery({
    queryKey: ['rep-staff', companyId, scope, range],
    queryFn: () => api.reports.staff(base),
    enabled: Boolean(companyId) && tab === 'staff'
  })

  const payments = useQuery({
    queryKey: ['rep-pay', companyId, scope, range],
    queryFn: () => api.reports.payments(base),
    enabled: Boolean(companyId) && tab === 'staff'
  })

  const gst = useQuery({
    queryKey: ['rep-gst', companyId, scope, range],
    queryFn: () => api.reports.gst(base),
    enabled: Boolean(companyId) && tab === 'gst'
  })

  const loanAnalysis = useQuery({
    queryKey: ['rep-loan-kpi', companyId, scope, range],
    queryFn: () => api.loans.analysis(base),
    enabled: Boolean(companyId) && tab === 'emi'
  })

  const loanGrid = useQuery({
    queryKey: ['rep-loan-grid', companyId, scope, range, debounced],
    queryFn: () => api.loans.analysisGrid({ ...base, search: debounced || undefined }),
    enabled: Boolean(companyId) && tab === 'emi'
  })

  const pnlRows = pnl.data ?? []
  const totals = pnlRows.reduce(
    (a: any, r: any) => ({
      revenue: a.revenue + r.revenue,
      grossProfit: a.grossProfit + r.grossProfit,
      netProfit: a.netProfit + r.netProfit,
      units: a.units + r.units,
      stock: a.stock + r.closingStockValue,
      credit: a.credit + r.creditOutstanding
    }),
    { revenue: 0, grossProfit: 0, netProfit: 0, units: 0, stock: 0, credit: 0 }
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={<DateRangePicker value={range} onChange={setRange} align="end" />}
      />

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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="shops">
              <Store /> Shop P&L
            </TabsTrigger>
            <TabsTrigger value="handsets">Per handset</TabsTrigger>
            <TabsTrigger value="models">Models & brands</TabsTrigger>
            <TabsTrigger value="staff">Staff & payments</TabsTrigger>
            {FEATURES.emiLoans && (
              <TabsTrigger value="emi">
                <HandCoins /> EMI loans
              </TabsTrigger>
            )}
            <TabsTrigger value="gst">GST</TabsTrigger>
          </TabsList>
        </Tabs>
      </Toolbar>

      <Tabs value={tab} onValueChange={setTab}>
        {/* --------------------------------------------------------- shops */}
        <TabsContent value="shops" className="mt-0 space-y-4">
          {!canProfit ? (
            <EmptyState
              icon={TrendingUp}
              title="Profit figures are restricted"
              description="Your account cannot view cost prices. Ask an administrator for the “View cost price & profit” permission."
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Revenue" value={money(totals.revenue)} tone="primary" />
                <StatCard label="Gross profit" value={money(totals.grossProfit)} tone="success" />
                <StatCard
                  label="Net profit"
                  value={money(totals.netProfit)}
                  sub={`${percent(totals.revenue ? (totals.netProfit / totals.revenue) * 100 : 0)} margin`}
                  tone={totals.netProfit >= 0 ? 'success' : 'danger'}
                />
                <StatCard label="Closing stock" value={money(totals.stock)} tone="info" />
              </div>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Revenue vs profit by shop</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void exportCsv('shop-pnl', pnlRows)}
                  >
                    <Download /> Export
                  </Button>
                </CardHeader>
                <CardContent className="h-[280px]">
                  {pnlRows.length === 0 ? (
                    <EmptyState icon={Store} title="No sales in this period" className="h-full border-0" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={pnlRows} margin={{ left: -16, right: 8, top: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="shopName" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                        />
                        <ReTooltip content={<ChartTooltip />} />
                        <Legend formatter={(v) => <span className="text-xs">{v}</span>} />
                        <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="grossProfit" name="Gross profit" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="netProfit" name="Net profit" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <DataTable
                rows={pnlRows}
                rowKey={(r: any) => r.shopId}
                loading={pnl.isLoading}
                showFooter
                empty="No shop data for this period"
                columns={[
                  {
                    key: 'shopName',
                    header: 'Shop',
                    render: (r: any) => (
                      <div>
                        <p className="font-medium">{r.shopName}</p>
                        <p className="text-xs text-muted-foreground">{r.shopCode}</p>
                      </div>
                    ),
                    footer: () => 'All shops'
                  },
                  { key: 'bills', header: 'Bills', align: 'right', sortable: true, footer: (rs: any[]) => rs.reduce((a, r) => a + r.bills, 0) },
                  { key: 'units', header: 'Units', align: 'right', sortable: true, footer: (rs: any[]) => rs.reduce((a, r) => a + r.units, 0) },
                  {
                    key: 'revenue',
                    header: 'Revenue',
                    align: 'right',
                    sortable: true,
                    render: (r: any) => <Money value={r.revenue} />,
                    footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.revenue, 0)} />
                  },
                  {
                    key: 'cost',
                    header: 'Cost of goods',
                    align: 'right',
                    hideBelow: 'lg',
                    render: (r: any) => <Money value={r.cost} />
                  },
                  {
                    key: 'grossProfit',
                    header: 'Gross profit',
                    align: 'right',
                    sortable: true,
                    render: (r: any) => <Money value={r.grossProfit} colored />,
                    footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.grossProfit, 0)} colored />
                  },
                  {
                    key: 'transferMargin',
                    header: 'Transfer margin',
                    align: 'right',
                    hideBelow: 'lg',
                    render: (r: any) => <Money value={r.transferMargin} colored blankZero />
                  },
                  {
                    key: 'adjustmentLoss',
                    header: 'Shrinkage',
                    align: 'right',
                    hideBelow: 'lg',
                    render: (r: any) => <Money value={r.adjustmentLoss} colored blankZero />
                  },
                  {
                    key: 'netProfit',
                    header: 'Net profit',
                    align: 'right',
                    sortable: true,
                    render: (r: any) => (
                      <div>
                        <Money value={r.netProfit} colored className="font-semibold" />
                        <p className="text-xs text-muted-foreground">{percent(r.margin)}</p>
                      </div>
                    ),
                    footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.netProfit, 0)} colored />
                  },
                  {
                    key: 'closingStockValue',
                    header: 'Stock held',
                    align: 'right',
                    render: (r: any) => (
                      <div>
                        <Money value={r.closingStockValue} />
                        <p className="text-xs text-muted-foreground">{r.closingStockUnits} units</p>
                      </div>
                    )
                  },
                  {
                    key: 'creditOutstanding',
                    header: 'Credit out',
                    align: 'right',
                    hideBelow: 'lg',
                    render: (r: any) => <Money value={r.creditOutstanding} blankZero />
                  }
                ]}
              />
            </>
          )}
        </TabsContent>

        {/* ------------------------------------------------------ handsets */}
        <TabsContent value="handsets" className="mt-0 space-y-4">
          {!canProfit ? (
            <EmptyState icon={TrendingUp} title="Profit figures are restricted" />
          ) : (
            <>
              <Toolbar>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="IMEI, model or customer…"
                  prefixNode={<Search />}
                  className="w-80"
                />
                <SimpleSelect
                  value={brandId}
                  onChange={setBrandId}
                  options={[
                    { value: 'all', label: 'All brands' },
                    ...(brands.data ?? []).map((b: any) => ({ value: b.id, label: b.name }))
                  ]}
                  className="w-44"
                />
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportCsv('handset-profit', unitProfit.data?.rows ?? [])}
                >
                  <Download /> Export
                </Button>
              </Toolbar>

              <div className="grid gap-3 sm:grid-cols-4">
                <StatCard label="Handsets sold" value={String(unitProfit.data?.totals.units ?? 0)} />
                <StatCard label="Revenue" value={money(unitProfit.data?.totals.revenue)} tone="primary" />
                <StatCard label="Cost" value={money(unitProfit.data?.totals.cost)} />
                <StatCard
                  label="Profit"
                  value={money(unitProfit.data?.totals.profit)}
                  tone={(unitProfit.data?.totals.profit ?? 0) >= 0 ? 'success' : 'danger'}
                />
              </div>

              <DataTable
                rows={unitProfit.data?.rows ?? []}
                rowKey={(r: any) => r.id}
                loading={unitProfit.isLoading}
                empty="No handsets sold in this period"
                maxHeight="calc(100vh - 480px)"
                columns={[
                  {
                    key: 'description',
                    header: 'Handset',
                    sortable: true,
                    render: (r: any) => (
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.description}</p>
                        {r.imei1 && (
                          <p className="truncate font-mono text-xs text-muted-foreground">{r.imei1}</p>
                        )}
                      </div>
                    )
                  },
                  {
                    key: 'invoiceNo',
                    header: 'Bill',
                    render: (r: any) => (
                      <div>
                        <p className="text-[13px]">{r.invoiceNo}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(r.saleDate)}</p>
                      </div>
                    )
                  },
                  { key: 'customerName', header: 'Customer', hideBelow: 'lg' },
                  { key: 'shopCode', header: 'Shop', render: (r: any) => <Badge variant="outline">{r.shopCode}</Badge> },
                  { key: 'costPrice', header: 'Cost', align: 'right', sortable: true, render: (r: any) => <Money value={r.costPrice} /> },
                  { key: 'lineTotal', header: 'Sold for', align: 'right', sortable: true, render: (r: any) => <Money value={r.lineTotal} /> },
                  {
                    key: 'profit',
                    header: 'Profit',
                    align: 'right',
                    sortable: true,
                    render: (r: any) => (
                      <div>
                        <Money value={r.profit} colored className="font-semibold" />
                        <p className="text-xs text-muted-foreground">{percent(r.margin)}</p>
                      </div>
                    )
                  },
                  {
                    key: 'daysInStock',
                    header: 'Days held',
                    align: 'right',
                    sortable: true,
                    hideBelow: 'lg',
                    render: (r: any) => (r.daysInStock === null ? '—' : `${r.daysInStock}d`)
                  }
                ]}
              />
            </>
          )}
        </TabsContent>

        {/* -------------------------------------------------------- models */}
        <TabsContent value="models" className="mt-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Top models by revenue</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px]">
                {(models.data ?? []).length === 0 ? (
                  <EmptyState icon={TrendingUp} title="No sales in this period" className="h-full border-0" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(models.data ?? []).slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                      />
                      <YAxis
                        type="category"
                        dataKey="modelName"
                        width={140}
                        tick={{ fontSize: 11 }}
                        stroke="hsl(var(--muted-foreground))"
                      />
                      <ReTooltip content={<ChartTooltip />} />
                      <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Brand share</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px]">
                {(brandShare.data ?? []).length === 0 ? (
                  <EmptyState icon={TrendingUp} title="No data" className="h-full border-0" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={(brandShare.data ?? []).slice(0, 6)}
                        dataKey="revenue"
                        nameKey="brandName"
                        innerRadius={54}
                        outerRadius={86}
                        paddingAngle={2}
                      >
                        {(brandShare.data ?? []).slice(0, 6).map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <ReTooltip content={<ChartTooltip />} />
                      <Legend verticalAlign="bottom" height={44} formatter={(v) => <span className="text-xs">{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <DataTable
            rows={models.data ?? []}
            rowKey={(r: any) => r.modelId}
            loading={models.isLoading}
            showFooter
            empty="No model sales in this period"
            columns={[
              {
                key: 'modelName',
                header: 'Model',
                render: (r: any) => (
                  <div>
                    <p className="font-medium">
                      {r.brandName} {r.modelName}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                  </div>
                ),
                footer: () => 'Total'
              },
              { key: 'units', header: 'Units', align: 'right', sortable: true, footer: (rs: any[]) => rs.reduce((a, r) => a + r.units, 0) },
              {
                key: 'revenue',
                header: 'Revenue',
                align: 'right',
                sortable: true,
                render: (r: any) => <Money value={r.revenue} />,
                footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.revenue, 0)} />
              },
              ...(canProfit
                ? [
                    {
                      key: 'profit',
                      header: 'Profit',
                      align: 'right' as const,
                      sortable: true,
                      render: (r: any) => <Money value={r.profit} colored />,
                      footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.profit, 0)} colored />
                    },
                    {
                      key: 'margin',
                      header: 'Margin',
                      align: 'right' as const,
                      sortable: true,
                      render: (r: any) => percent(r.margin)
                    }
                  ]
                : [])
            ]}
          />
        </TabsContent>

        {/* --------------------------------------------------------- staff */}
        <TabsContent value="staff" className="mt-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Payment mix</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                {(payments.data ?? []).length === 0 ? (
                  <EmptyState icon={TrendingUp} title="No payments recorded" className="h-full border-0" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={payments.data ?? []}
                        dataKey="amount"
                        nameKey="mode"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {(payments.data ?? []).map((_: any, i: number) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <ReTooltip content={<ChartTooltip />} />
                      <Legend verticalAlign="bottom" height={40} formatter={(v) => <span className="text-xs">{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Who billed what</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable
                  dense
                  className="rounded-none border-0 border-t"
                  rows={staff.data ?? []}
                  rowKey={(r: any) => r.userId}
                  loading={staff.isLoading}
                  empty="No sales recorded by any user"
                  columns={[
                    { key: 'name', header: 'User', render: (r: any) => <span className="font-medium">{r.name}</span> },
                    { key: 'bills', header: 'Bills', align: 'right', sortable: true },
                    { key: 'revenue', header: 'Revenue', align: 'right', sortable: true, render: (r: any) => <Money value={r.revenue} /> },
                    ...(canProfit
                      ? [
                          {
                            key: 'profit',
                            header: 'Profit',
                            align: 'right' as const,
                            sortable: true,
                            render: (r: any) => <Money value={r.profit} colored />
                          }
                        ]
                      : []),
                    { key: 'discount', header: 'Discount given', align: 'right', hideBelow: 'lg', render: (r: any) => <Money value={r.discount} blankZero /> },
                    { key: 'credit', header: 'Credit given', align: 'right', render: (r: any) => <Money value={r.credit} blankZero /> }
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ----------------------------------------------------------- emi */}
        <TabsContent value="emi" className="mt-0 space-y-4">
          {!session.can('loan.view') ? (
            <EmptyState icon={HandCoins} title="EMI loans are restricted" description="Ask an administrator for the “View EMI loans” permission." />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Sales financed" value={money(loanAnalysis.data?.totalSales)} tone="primary" />
                <StatCard label="Purchase cost" value={money(loanAnalysis.data?.totalPurchase)} />
                {canProfit && (
                  <StatCard label="Margin" value={money(loanAnalysis.data?.totalMargin)} tone="success" />
                )}
                <StatCard label="Processing fee" value={money(loanAnalysis.data?.processingFee)} tone="info" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="EMI collected"
                  value={money(loanAnalysis.data?.emiCollected)}
                  sub={`Net of penalty: ${money(loanAnalysis.data?.netEmiCollection)}`}
                  tone="success"
                />
                <StatCard label="Penalty collected" value={money(loanAnalysis.data?.penaltyCollected)} />
                <StatCard
                  label="Outstanding (active)"
                  value={money(loanAnalysis.data?.outstanding)}
                  tone={(loanAnalysis.data?.outstanding ?? 0) > 0 ? 'warning' : 'success'}
                />
                <StatCard
                  label="Recovery period"
                  value={`${loanAnalysis.data?.recoveryMonths ?? 0} mo`}
                  sub="Until the last active EMI is due"
                  tone={
                    (loanAnalysis.data?.recoveryMonths ?? 0) <= 12
                      ? 'success'
                      : (loanAnalysis.data?.recoveryMonths ?? 0) <= 24
                        ? 'warning'
                        : 'danger'
                  }
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  label="Overdue EMI"
                  value={String(loanAnalysis.data?.overdueCount ?? 0)}
                  sub={money(loanAnalysis.data?.overdueAmount)}
                  tone={(loanAnalysis.data?.overdueCount ?? 0) > 0 ? 'danger' : 'success'}
                />
                <StatCard label="Penalty overdue (est.)" value={money(loanAnalysis.data?.penaltyOverdueEstimate)} tone="warning" />
                <StatCard label="Loans opened" value={String(loanAnalysis.data?.totalLoans ?? 0)} />
                <StatCard label="Active / Closed" value={`${loanAnalysis.data?.activeLoans ?? 0} / ${loanAnalysis.data?.closedLoans ?? 0}`} />
                <StatCard label="Customers" value={String(loanAnalysis.data?.totalCustomers ?? 0)} />
              </div>

              <Toolbar>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Customer, phone, brand or model…"
                  prefixNode={<Search />}
                  className="w-80"
                />
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportCsv('emi-loan-analysis', loanGrid.data ?? [])}
                >
                  <Download /> Export
                </Button>
              </Toolbar>

              <DataTable
                rows={loanGrid.data ?? []}
                rowKey={(r: any) => r.id}
                loading={loanGrid.isLoading}
                empty="No EMI loans opened in this period"
                maxHeight="calc(100vh - 560px)"
                showFooter
                columns={[
                  {
                    key: 'loanNo',
                    header: 'Loan',
                    render: (r: any) => (
                      <div>
                        <p className="font-medium">{r.loanNo}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(r.loanDate)}</p>
                      </div>
                    ),
                    footer: () => 'Total'
                  },
                  {
                    key: 'customerName',
                    header: 'Customer',
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
                    hideBelow: 'lg',
                    render: (r: any) => [r.brand, r.modelName].filter(Boolean).join(' ') || '—'
                  },
                  { key: 'shopCode', header: 'Shop', render: (r: any) => <Badge variant="outline">{r.shopCode}</Badge> },
                  {
                    key: 'loanAmount',
                    header: 'Financed',
                    align: 'right',
                    sortable: true,
                    render: (r: any) => <Money value={r.loanAmount} />,
                    footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.loanAmount, 0)} />
                  },
                  {
                    key: 'outstanding',
                    header: 'Outstanding',
                    align: 'right',
                    sortable: true,
                    render: (r: any) => <Money value={r.outstanding} blankZero />,
                    footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.outstanding, 0)} />
                  },
                  ...(canProfit
                    ? [
                        {
                          key: 'netIncome',
                          header: 'Net income',
                          align: 'right' as const,
                          sortable: true,
                          render: (r: any) => <Money value={r.netIncome} colored />,
                          footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.netIncome, 0)} colored />
                        }
                      ]
                    : []),
                  {
                    key: 'overdueCount',
                    header: 'Overdue',
                    align: 'right',
                    render: (r: any) =>
                      r.overdueCount > 0 ? <Badge variant="danger">{r.overdueCount}</Badge> : <span className="text-muted-foreground">—</span>
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (r: any) => (
                      <Badge variant={r.status === 'ACTIVE' ? 'info' : r.status === 'CLOSED' ? 'success' : 'secondary'}>
                        {r.status}
                      </Badge>
                    )
                  }
                ]}
              />
            </>
          )}
        </TabsContent>

        {/* ----------------------------------------------------------- gst */}
        <TabsContent value="gst" className="mt-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Output GST (sales)"
              value={money((gst.data?.output ?? []).reduce((a: number, r: any) => a + r.tax, 0))}
              tone="primary"
            />
            <StatCard
              label="Input GST (purchases)"
              value={money((gst.data?.input ?? []).reduce((a: number, r: any) => a + r.tax, 0))}
              tone="info"
            />
            <StatCard
              label="Net payable"
              value={money(gst.data?.netPayable)}
              tone={(gst.data?.netPayable ?? 0) > 0 ? 'warning' : 'success'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Output GST — on sales</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => void exportCsv('gst-output', gst.data?.output ?? [])}>
                  <Download />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <GstTable rows={gst.data?.output ?? []} loading={gst.isLoading} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Input GST — on purchases</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => void exportCsv('gst-input', gst.data?.input ?? [])}>
                  <Download />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <GstTable rows={gst.data?.input ?? []} loading={gst.isLoading} />
              </CardContent>
            </Card>
          </div>

          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            CGST and SGST are shown as an equal split of the total tax, which is correct for sales
            within your own state. Inter-state sales are IGST and would need the customer's state to
            be set — check with your accountant before filing.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GstTable({ rows, loading }: { rows: any[]; loading: boolean }) {
  return (
    <DataTable
      dense
      className="rounded-none border-0 border-t"
      rows={rows}
      rowKey={(r: any) => String(r.rate)}
      loading={loading}
      showFooter
      empty="No taxable transactions"
      columns={[
        { key: 'rate', header: 'Rate', render: (r: any) => `${r.rate}%`, footer: () => 'Total' },
        {
          key: 'taxable',
          header: 'Taxable value',
          align: 'right',
          render: (r: any) => <Money value={r.taxable} />,
          footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.taxable, 0)} />
        },
        { key: 'cgst', header: 'CGST', align: 'right', render: (r: any) => <Money value={r.cgst} /> },
        { key: 'sgst', header: 'SGST', align: 'right', render: (r: any) => <Money value={r.sgst} /> },
        {
          key: 'tax',
          header: 'Total tax',
          align: 'right',
          render: (r: any) => <Money value={r.tax} className="font-semibold" />,
          footer: (rs: any[]) => <Money value={rs.reduce((a, r) => a + r.tax, 0)} />
        }
      ]}
    />
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-pop">
      {label && <p className="mb-1 font-medium">{label}</p>}
      <div className="space-y-0.5">
        {payload.map((p: any) => (
          <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-medium tnum">{money(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
