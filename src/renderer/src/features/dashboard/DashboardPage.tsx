import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
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
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeIndianRupee,
  Boxes,
  Clock,
  Receipt,
  ShoppingCart,
  Store,
  TrendingUp,
  Wallet
} from 'lucide-react'
import { api } from '@/lib/api'
import { useDateRange, useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { addDays, formatDate, money, percent, todayStr } from '@/lib/utils'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator } from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { DateRangePicker, EmptyState, Money, OverdueBadge, PageHeader, StatCard } from '@/components/ui/misc'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/form'
import { useHotkey } from '@/lib/hotkeys'

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))'
]

export function DashboardPage() {
  const navigate = useNavigate()
  const { companyId, shopId, shops } = useScope()
  const session = useSession()
  // Last 30 days, not "this month" — otherwise the dashboard is empty every
  // time someone opens it on the 1st.
  const [range, setRange] = useDateRange('dashboard', {
    from: addDays(todayStr(), -29),
    to: todayStr()
  })
  const [scope, setScope] = React.useState<'shop' | 'company'>('shop')

  const effectiveShop = scope === 'shop' ? shopId ?? undefined : undefined
  const canSeeProfit = session.can('report.profit')

  const params = { shopId: effectiveShop, from: range.from, to: range.to }

  const stats = useQuery({
    queryKey: ['dash', companyId, effectiveShop, range],
    queryFn: () => api.reports.dashboard(params),
    enabled: Boolean(companyId)
  })

  const trend = useQuery({
    queryKey: ['dash-trend', companyId, effectiveShop, range],
    queryFn: () => api.reports.trend(params),
    enabled: Boolean(companyId)
  })

  const brands = useQuery({
    queryKey: ['dash-brands', companyId, effectiveShop, range],
    queryFn: () => api.reports.brands(params),
    enabled: Boolean(companyId)
  })

  const pnl = useQuery({
    queryKey: ['dash-pnl', companyId, range],
    queryFn: () => api.reports.shopPnl({ from: range.from, to: range.to }),
    enabled: Boolean(companyId) && canSeeProfit
  })

  const credit = useQuery({
    queryKey: ['dash-credit', companyId, effectiveShop],
    queryFn: () => api.sales.creditBook({ shopId: effectiveShop }),
    enabled: Boolean(companyId)
  })

  const lowStock = useQuery({
    queryKey: ['dash-stock', companyId, effectiveShop],
    queryFn: () => api.stock.summary(effectiveShop),
    enabled: Boolean(companyId)
  })

  useHotkey('alt+r', () => void Promise.all([stats.refetch(), trend.refetch()]), {
    description: 'Refresh dashboard',
    group: 'Dashboard'
  })

  const s = stats.data
  const overdueRows = (credit.data?.rows ?? []).filter((r: any) => r.overdueDays > 0).slice(0, 8)
  const lowRows = (lowStock.data ?? []).filter((r: any) => r.isLow).slice(0, 8)

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good ${greeting()}, ${session.user?.name.split(' ')[0]}`}
        description={`${formatDate(range.from)} – ${formatDate(range.to)}${
          scope === 'shop' ? ` · ${session.activeShop()?.name ?? 'No shop'}` : ' · All shops'
        }`}
        actions={
          <>
            {shops.length > 1 && (
              <Tabs value={scope} onValueChange={(v) => setScope(v as any)}>
                <TabsList>
                  <TabsTrigger value="shop">
                    <Store /> This shop
                  </TabsTrigger>
                  <TabsTrigger value="company">All shops</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <DateRangePicker value={range} onChange={setRange} align="end" />
            {session.can('sale.manage') && (
              <Button size="sm" onClick={() => navigate('/sales/new')}>
                <ShoppingCart /> New sale <span className="kbd ml-1">F2</span>
              </Button>
            )}
          </>
        }
      />

      {/* ------------------------------------------------------------- KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue"
          value={money(s?.sales.revenue)}
          sub={`${s?.sales.bills ?? 0} bills · ${s?.sales.units ?? 0} units`}
          icon={Receipt}
          tone="primary"
        />
        {canSeeProfit && (
          <StatCard
            label="Profit"
            value={money(s?.sales.profit)}
            sub={`${percent(s?.sales.margin)} margin`}
            icon={TrendingUp}
            tone={((s?.sales.profit ?? 0) >= 0 ? 'success' : 'danger') as any}
          />
        )}
        <StatCard
          label="Collected"
          value={money(s?.collected)}
          sub={`Avg bill ${money(s?.sales.avgBill)}`}
          icon={Wallet}
          tone="info"
        />
        <StatCard
          label="Credit outstanding"
          value={money(s?.credit.outstanding)}
          sub={`${s?.credit.overdueBills ?? 0} overdue · ${money(s?.credit.overdue)}`}
          icon={BadgeIndianRupee}
          tone={(s?.credit.overdue ?? 0) > 0 ? 'danger' : 'default'}
          onClick={() => navigate('/credit')}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Stock on hand"
          value={`${s?.stock.units ?? 0} units`}
          sub={money(s?.stock.value)}
          icon={Boxes}
          onClick={() => navigate('/stock')}
        />
        <StatCard
          label="Purchases"
          value={money(s?.purchases.value)}
          sub={`${s?.purchases.bills ?? 0} bills`}
          icon={ShoppingCart}
          onClick={() => navigate('/purchases')}
        />
        <StatCard label="Payable to suppliers" value={money(s?.purchases.payable)} icon={Wallet} />
        <StatCard
          label="Discount given"
          value={money(s?.sales.discount)}
          sub="in this period"
          icon={BadgeIndianRupee}
        />
      </div>

      {/* ------------------------------------------------------------ charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sales trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {(trend.data ?? []).length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No sales in this period"
                description="Pick another date range, or record a sale to see the trend build up."
                className="h-full border-0"
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend.data} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => String(v).slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                  />
                  <ReTooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    fill="url(#rev)"
                  />
                  {canSeeProfit && (
                    <Area
                      type="monotone"
                      dataKey="profit"
                      name="Profit"
                      stroke="hsl(var(--chart-2))"
                      strokeWidth={2}
                      fill="url(#prof)"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Brand mix</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {(brands.data ?? []).length === 0 ? (
              <EmptyState icon={Boxes} title="No sales yet" className="h-full border-0" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(brands.data ?? []).slice(0, 6)}
                    dataKey="revenue"
                    nameKey="brandName"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {(brands.data ?? []).slice(0, 6).map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip content={<ChartTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={44}
                    formatter={(v) => <span className="text-xs">{v}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------- per-shop P&L bars */}
      {canSeeProfit && shops.length > 1 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Profit by shop</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>
              Full report <ArrowUpRight className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pnl.data ?? []} margin={{ left: -18, right: 8, top: 8 }}>
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
                <Bar dataKey="netProfit" name="Net profit" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* --------------------------------------------------- attention lists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-warning" /> Payments to chase
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/credit')}>
              Open credit book
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              dense
              className="rounded-none border-0 border-t"
              rows={overdueRows}
              rowKey={(r: any) => r.id}
              loading={credit.isLoading}
              empty="No overdue payments — well collected."
              onRowClick={() => navigate('/credit')}
              columns={[
                {
                  key: 'customerName',
                  header: 'Customer',
                  render: (r: any) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.customerName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.invoiceNo} · {r.customerPhone ?? 'no phone'}
                      </p>
                    </div>
                  )
                },
                {
                  key: 'dueDate',
                  header: 'Promised',
                  render: (r: any) => (
                    <div className="space-y-1">
                      <p className="text-xs">{formatDate(r.dueDate)}</p>
                      <OverdueBadge days={r.overdueDays} />
                    </div>
                  )
                },
                {
                  key: 'dueAmount',
                  header: 'Due',
                  align: 'right',
                  render: (r: any) => <Money value={r.dueAmount} className="font-semibold" />
                }
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" /> Running low
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/stock')}>
              Open stock
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              dense
              className="rounded-none border-0 border-t"
              rows={lowRows}
              rowKey={(r: any) => r.modelId}
              loading={lowStock.isLoading}
              empty="Every model is above its alert level."
              columns={[
                {
                  key: 'modelName',
                  header: 'Model',
                  render: (r: any) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {r.brandName} {r.modelName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{r.sku}</p>
                    </div>
                  )
                },
                {
                  key: 'qty',
                  header: 'Left',
                  align: 'right',
                  render: (r: any) => (
                    <Badge variant={r.qty === 0 ? 'danger' : 'warning'}>{r.qty}</Badge>
                  )
                },
                {
                  key: 'stockValue',
                  header: 'Value',
                  align: 'right',
                  render: (r: any) => <Money value={r.stockValue} />
                }
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
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

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
