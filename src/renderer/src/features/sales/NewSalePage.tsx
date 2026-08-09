import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Barcode,
  CalendarClock,
  Check,
  Delete,
  Minus,
  Percent,
  Plus,
  Printer,
  ScanLine,
  ShoppingCart,
  Smartphone,
  Trash2,
  UserPlus,
  Wallet,
  Wrench,
  X,
  Zap
} from 'lucide-react'
import { api } from '@/lib/api'
import { useScope } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { addDays, cn, money, todayStr } from '@/lib/utils'
import { PAYMENT_MODES } from '@shared/constants'
import { formatPhone, normalizeImei } from '@shared/validators'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Separator, Textarea } from '@/components/ui/base'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { ConfirmDialog } from '@/components/ui/overlay'
import { EmptyState, Money, PageHeader } from '@/components/ui/misc'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'
import { buildInvoiceHtml } from './invoice'

type Mode = 'product' | 'recharge' | 'repair'

interface Line {
  key: string
  stockUnitId?: string
  modelId: string
  lineType: 'product' | 'part'
  description: string
  imei1?: string
  qty: number
  unitPrice: number
  discount: number
  gstRate: number
  costPrice: number
  /** For a quantity line (an accessory model, no single unit): how many are in stock. */
  maxQty?: number
}

interface ModeDef {
  value: Mode
  label: string
  icon: typeof ShoppingCart
  hint: string
  /** Full literal class strings (Tailwind can't build these dynamically). */
  activeTile: string
  activeChip: string
  idleChip: string
  accentText: string
}

const MODES: ModeDef[] = [
  {
    value: 'product',
    label: 'Product sale',
    icon: Smartphone,
    hint: 'Phones & accessories from stock',
    activeTile: 'border-primary bg-primary/10 ring-2 ring-primary/60',
    activeChip: 'bg-primary text-primary-foreground shadow-sm',
    idleChip: 'bg-primary/10 text-primary',
    accentText: 'text-primary'
  },
  {
    value: 'recharge',
    label: 'Recharge',
    icon: Zap,
    hint: 'Mobile / DTH recharge',
    activeTile: 'border-info bg-info/10 ring-2 ring-info/60',
    activeChip: 'bg-info text-info-foreground shadow-sm',
    idleChip: 'bg-info/10 text-info',
    accentText: 'text-info'
  },
  {
    value: 'repair',
    label: 'Repair',
    icon: Wrench,
    hint: 'Service job, with parts from stock',
    activeTile: 'border-warning bg-warning/10 ring-2 ring-warning/60',
    activeChip: 'bg-warning text-warning-foreground shadow-sm',
    idleChip: 'bg-warning/10 text-warning',
    accentText: 'text-warning'
  }
]

export function NewSalePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId } = useScope()

  const [mode, setMode] = React.useState<Mode>('product')

  const [lines, setLines] = React.useState<Line[]>([])
  const [customerId, setCustomerId] = React.useState('')
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [scan, setScan] = React.useState('')
  const [stockSearch, setStockSearch] = React.useState('')
  const [accSearch, setAccSearch] = React.useState('')
  const [saleDate, setSaleDate] = React.useState(todayStr())
  const [billDiscount, setBillDiscount] = React.useState(0)
  const [otherCharges, setOtherCharges] = React.useState(0)
  const [paymentMode, setPaymentMode] = React.useState<string>('Cash')
  const [paidAmount, setPaidAmount] = React.useState<number | ''>('')
  const [dueDate, setDueDate] = React.useState(addDays(todayStr(), 7))
  const [promisedNote, setPromisedNote] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [customerDialog, setCustomerDialog] = React.useState(false)
  const [confirmClear, setConfirmClear] = React.useState(false)

  /* recharge state */
  const [rechargeAmount, setRechargeAmount] = React.useState<number | ''>('')
  const [rechargeNote, setRechargeNote] = React.useState('')

  /* repair state */
  const [device, setDevice] = React.useState('')
  const [problem, setProblem] = React.useState('')
  const [labourAmount, setLabourAmount] = React.useState<number | ''>('')

  const scanRef = React.useRef<HTMLInputElement>(null)
  const paidRef = React.useRef<HTMLInputElement>(null)

  /* ------------------------------------------------------------- data */
  const customers = useQuery({
    queryKey: ['sale-customers', companyId, customerSearch],
    queryFn: () => api.customers.list({ search: customerSearch, limit: 40 }),
    enabled: Boolean(companyId)
  })

  const stock = useQuery({
    queryKey: ['sale-stock', shopId, stockSearch],
    queryFn: () => api.stock.available(shopId!, stockSearch, 60),
    enabled: Boolean(shopId)
  })

  const accessories = useQuery({
    queryKey: ['sale-accessories', shopId, accSearch],
    queryFn: () => api.stock.availableModels(shopId!, accSearch, 60),
    enabled: Boolean(shopId) && mode !== 'recharge'
  })

  const presets = useQuery({
    queryKey: ['svc-presets', companyId, mode],
    queryFn: () => api.services.list({ kind: mode === 'recharge' ? 'recharge' : 'repair' }),
    enabled: Boolean(companyId) && mode !== 'product'
  })

  const customer = (customers.data ?? []).find((c: any) => c.id === customerId)

  /* ------------------------------------------------------------- totals */
  const linesTotal = lines.reduce((a, l) => a + l.unitPrice * l.qty - l.discount, 0)
  const serviceCharge =
    mode === 'recharge' ? Number(rechargeAmount) || 0 : mode === 'repair' ? Number(labourAmount) || 0 : 0
  const itemsTotal = linesTotal + serviceCharge
  const total = Math.max(0, itemsTotal - billDiscount + otherCharges)
  const costTotal = lines.reduce((a, l) => a + l.costPrice * (l.stockUnitId ? 1 : l.qty), 0)
  const profit = total - costTotal
  const paid = paidAmount === '' ? total : Number(paidAmount)
  const due = Math.max(0, Math.round((total - paid) * 100) / 100)
  const isCredit = due > 0.5

  /* ------------------------------------------------------------ actions */
  const addUnit = React.useCallback(
    (unit: any) => {
      if (lines.some((l) => l.stockUnitId === unit.id)) {
        toast.error('That item is already on the bill')
        return
      }
      setLines((ls) => [
        ...ls,
        {
          key: `${unit.id}-${Date.now()}`,
          stockUnitId: unit.id,
          modelId: unit.modelId,
          lineType: mode === 'repair' ? 'part' : 'product',
          description: `${unit.brandName} ${unit.modelName}${unit.color ? ` · ${unit.color}` : ''}`,
          imei1: unit.imei1 ?? undefined,
          qty: 1,
          unitPrice: Number(unit.salePrice) || 0,
          discount: 0,
          gstRate: Number(unit.gstRate) || 18,
          costPrice: Number(unit.costPrice) || 0
        }
      ])
      toast.success(`Added ${unit.brandName} ${unit.modelName}`, { duration: 1200 })
    },
    [lines, mode]
  )

  /** Add (or bump) a quantity line for an accessory model, capped at stock. */
  const addModelLine = React.useCallback(
    (m: any) => {
      const cap = Number(m.available) || 0
      if (cap < 1) {
        toast.error(`${m.brandName} ${m.modelName} is out of stock`)
        return
      }
      setLines((ls) => {
        const existing = ls.find((l) => l.modelId === m.modelId && !l.stockUnitId)
        if (existing) {
          if (existing.qty >= cap) {
            toast.error(`Only ${cap} in stock`)
            return ls
          }
          return ls.map((l) => (l === existing ? { ...l, qty: Math.min(cap, l.qty + 1) } : l))
        }
        return [
          ...ls,
          {
            key: `m-${m.modelId}-${Date.now()}`,
            modelId: m.modelId,
            lineType: mode === 'repair' ? 'part' : 'product',
            description: `${m.brandName} ${m.modelName}`,
            qty: 1,
            unitPrice: Number(m.salePrice) || 0,
            discount: 0,
            gstRate: Number(m.gstRate) || 18,
            costPrice: Number(m.avgCost) || 0,
            maxQty: cap
          }
        ]
      })
      toast.success(`Added ${m.brandName} ${m.modelName}`, { duration: 1200 })
    },
    [mode]
  )

  const handleScan = async (value: string) => {
    const imei = normalizeImei(value)
    if (imei.length < 4) return
    const hits = await api.stock.byImei(imei)
    const sellable = (hits ?? []).filter((h: any) => h.status === 'in_stock' && h.shopId === shopId)
    if (sellable.length === 0) {
      const elsewhere = (hits ?? [])[0]
      toast.error(
        elsewhere
          ? `${elsewhere.label} is "${elsewhere.status.replace('_', ' ')}"${
              elsewhere.shopName ? ` at ${elsewhere.shopName}` : ''
            }`
          : `No item found for ${imei}`
      )
      return
    }
    addUnit(sellable[0])
    setScan('')
  }

  /* on-screen keypad — builds the received amount digit by digit (whole rupees) */
  const keypadPress = (d: string) =>
    setPaidAmount((prev) => {
      const cur = prev === '' ? '' : String(prev)
      const next = (cur + d).replace(/^0+(?=\d)/, '').slice(0, 9)
      return next === '' ? '' : Number(next)
    })
  const keypadBackspace = () =>
    setPaidAmount((prev) => {
      const next = (prev === '' ? '' : String(prev)).slice(0, -1)
      return next === '' ? '' : Number(next)
    })

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key))

  const reset = () => {
    setLines([])
    setCustomerId('')
    setBillDiscount(0)
    setOtherCharges(0)
    setPaidAmount('')
    setNotes('')
    setPromisedNote('')
    setPaymentMode('Cash')
    setRechargeAmount('')
    setRechargeNote('')
    setDevice('')
    setProblem('')
    setLabourAmount('')
    scanRef.current?.focus()
  }

  const switchMode = (m: Mode) => {
    if (m === mode) return
    setMode(m)
    // Parts/goods don't carry over between modes — clear them to avoid confusion.
    setLines([])
  }

  const buildItems = () => {
    if (mode === 'product') {
      return lines.map((l) => ({
        stockUnitId: l.stockUnitId,
        modelId: l.modelId,
        lineType: 'product' as const,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount,
        gstRate: l.gstRate
      }))
    }
    if (mode === 'recharge') {
      return [
        {
          lineType: 'service' as const,
          description: rechargeNote.trim() || 'Recharge',
          qty: 1,
          unitPrice: Number(rechargeAmount) || 0,
          gstRate: 0,
          costPrice: 0
        }
      ]
    }
    // repair
    const items: any[] = []
    if ((Number(labourAmount) || 0) > 0) {
      items.push({
        lineType: 'service' as const,
        description: `Repair labour${device.trim() ? ` — ${device.trim()}` : ''}`,
        qty: 1,
        unitPrice: Number(labourAmount) || 0,
        gstRate: 0,
        costPrice: 0
      })
    }
    for (const l of lines) {
      items.push({
        stockUnitId: l.stockUnitId,
        modelId: l.modelId,
        lineType: 'part' as const,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount,
        gstRate: l.gstRate
      })
    }
    return items
  }

  const validate = (): string | null => {
    if (!shopId) return 'Pick a shop first'
    if (mode === 'product' && lines.length === 0) return 'Add at least one item'
    if (mode === 'recharge' && (Number(rechargeAmount) || 0) <= 0) return 'Enter the recharge amount'
    if (mode === 'repair') {
      if (!device.trim()) return 'Enter what is being repaired'
      if ((Number(labourAmount) || 0) <= 0 && lines.length === 0)
        return 'Add a labour charge or at least one part'
    }
    if (isCredit && !customerId) return 'A credit bill needs a customer — pick or create one'
    return null
  }

  const submit = async (thenPrint: boolean) => {
    const problemMsg = validate()
    if (problemMsg) return toast.error(problemMsg)

    setSaving(true)
    try {
      const res = await api.sales.create({
        shopId,
        customerId: customerId || undefined,
        saleDate,
        saleType: mode,
        serviceTitle: mode === 'recharge' ? 'Recharge' : mode === 'repair' ? device.trim() : undefined,
        serviceDetails: mode === 'recharge' ? rechargeNote.trim() : mode === 'repair' ? problem.trim() : undefined,
        items: buildItems(),
        discount: billDiscount,
        otherCharges,
        paidAmount: paid,
        paymentMode: isCredit && paid === 0 ? 'Credit (Udhaar)' : paymentMode,
        dueDate: isCredit ? dueDate : undefined,
        promisedNote: isCredit ? promisedNote : undefined,
        notes
      })

      toast.success(`${res.invoiceNo} saved · ${money(res.total)}`, {
        description: isCredit ? `${money(res.due)} on credit, due ${dueDate}` : 'Fully paid'
      })

      void qc.invalidateQueries({ queryKey: ['sale-stock'] })
      void qc.invalidateQueries({ queryKey: ['dash'] })
      // Repair parts and product lines leave stock — refresh the Stock views too.
      void qc.invalidateQueries({ queryKey: ['stock'] })
      void qc.invalidateQueries({ queryKey: ['stock-summary'] })

      if (thenPrint) {
        const full = await api.sales.get(res.id)
        await api.files.print(buildInvoiceHtml(full))
      }
      reset()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  /* --------------------------------------------------------- shortcuts */
  useHotkey('f2', () => scanRef.current?.focus(), {
    description: 'Focus scan box',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('f4', () => paidRef.current?.focus(), {
    description: 'Jump to amount paid',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('f9', () => void submit(false), { description: 'Save bill', group: 'Sale', allowInInputs: true })
  useHotkey('f10', () => void submit(true), { description: 'Save & print bill', group: 'Sale', allowInInputs: true })
  useHotkey('ctrl+n', () => setCustomerDialog(true), {
    description: 'New customer',
    group: 'Sale',
    allowInInputs: true
  })

  React.useEffect(() => {
    if (mode === 'product') scanRef.current?.focus()
  }, [mode])

  const stockOptions: ComboOption[] = (stock.data ?? []).map((u: any) => ({
    value: u.id,
    label: `${u.brandName} ${u.modelName}`,
    hint: u.imei1 ? `IMEI ${u.imei1}` : u.serialNo ? `SN ${u.serialNo}` : u.sku,
    meta: money(u.salePrice || 0),
    group: u.brandName,
    keywords: [u.imei1, u.sku, u.color].filter(Boolean),
    data: u
  }))

  // Only SKUs with stock at this shop are listed (the query filters
  // available > 0), each showing its SKU and how many are on hand.
  const accessoryOptions: ComboOption[] = (accessories.data ?? []).map((m: any) => ({
    value: m.modelId,
    label: `${m.brandName} ${m.modelName}`,
    hint: `${m.sku} · ${money(m.salePrice)}`,
    meta: (
      <Badge variant={m.available <= 2 ? 'warning' : 'success'}>{m.available} in stock</Badge>
    ),
    group: m.brandName,
    keywords: [m.sku].filter(Boolean),
    data: m
  }))

  const customerOptions: ComboOption[] = (customers.data ?? []).map((c: any) => ({
    value: c.id,
    label: c.name,
    hint: `${formatPhone(c.phonePrimary)}${c.outstanding > 0 ? ` · ${money(c.outstanding)} due` : ''}`,
    meta: c.overdueCount > 0 ? <Badge variant="danger">{c.overdueCount} overdue</Badge> : undefined,
    keywords: [c.phonePrimary, c.phoneSecondary, c.aadhaar].filter(Boolean)
  }))

  const modeMeta = MODES.find((m) => m.value === mode)!

  return (
    <div className="space-y-4">
      <PageHeader
        title="New sale"
        description={modeMeta.hint}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/sales')}>
              All sales
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
              <X /> Clear
            </Button>
          </>
        }
      />

      {/* mode selector — big colour-coded POS tiles */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {MODES.map((m) => {
          const active = mode === m.value
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => switchMode(m.value)}
              aria-pressed={active}
              className={cn(
                'group flex cursor-pointer flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-all duration-200 sm:flex-row sm:gap-3 sm:p-4 sm:text-left',
                active
                  ? `${m.activeTile} shadow-card`
                  : 'border-border bg-card hover:-translate-y-0.5 hover:border-ring/50 hover:shadow-soft'
              )}
            >
              <span
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors',
                  active ? m.activeChip : m.idleChip
                )}
              >
                <m.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-bold', active && m.accentText)}>{m.label}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{m.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* ------------------------------------------------------- left */}
        <div className="space-y-4">
          {/* recharge */}
          {mode === 'recharge' && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-info/12 text-info">
                    <Zap className="size-4" />
                  </span>
                  Recharge details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field label="Recharge amount" required>
                  <Input
                    type="number"
                    min={0}
                    autoFocus
                    value={rechargeAmount}
                    onChange={(e) => setRechargeAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className="h-11 text-right text-lg font-semibold tnum"
                  />
                </Field>
                <Field label="Note" hint="e.g. Airtel 9876543210, or a plan name">
                  <Input
                    value={rechargeNote}
                    onChange={(e) => setRechargeNote(e.target.value)}
                    placeholder="Operator / number / plan (optional)"
                  />
                </Field>
                <PresetChips
                  presets={presets.data}
                  onPick={(p) => {
                    setRechargeAmount(p.defaultPrice || '')
                    if (!rechargeNote) setRechargeNote(p.name)
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* repair */}
          {mode === 'repair' && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-warning/15 text-warning">
                    <Wrench className="size-4" />
                  </span>
                  Repair job
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Device / item" required>
                    <Input
                      autoFocus
                      value={device}
                      onChange={(e) => setDevice(e.target.value)}
                      placeholder="e.g. Redmi Note 12"
                    />
                  </Field>
                  <Field label="Labour / service charge">
                    <Input
                      type="number"
                      min={0}
                      value={labourAmount}
                      onChange={(e) => setLabourAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0"
                      className="text-right tnum font-medium"
                    />
                  </Field>
                </div>
                <Field label="Problem / work done">
                  <Textarea
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    placeholder="e.g. Screen replacement, not charging…"
                    className="min-h-[52px]"
                  />
                </Field>
                <PresetChips
                  presets={presets.data}
                  onPick={(p) => {
                    setLabourAmount(p.defaultPrice || '')
                    if (!device) setDevice(p.name)
                    if (!problem) setProblem(p.name)
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* stock picker — product (items) or repair (parts) */}
          {mode !== 'recharge' && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={mode === 'repair' ? 'Scan a part IMEI' : 'Scan / type IMEI'}
                    hint="For phones & serialised items"
                  >
                    <Input
                      ref={scanRef}
                      value={scan}
                      onChange={(e) => setScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleScan(scan)
                      }}
                      placeholder="Scan barcode or type IMEI, then Enter"
                      prefixNode={<ScanLine />}
                      suffixNode={<span className="kbd">F2</span>}
                      className="font-mono"
                    />
                  </Field>
                  <Field label={mode === 'repair' ? 'Or pick a part from stock' : 'Or pick from shelf'}>
                    <Combobox
                      value={null}
                      onChange={(_v, option) => option?.data && addUnit(option.data)}
                      options={stockOptions}
                      onSearchChange={setStockSearch}
                      loading={stock.isFetching}
                      placeholder={`${stock.data?.length ?? 0} units in stock`}
                      searchPlaceholder="Model, IMEI or SKU…"
                      emptyText="Nothing in stock matches"
                    />
                  </Field>
                </div>
                <Field
                  label={mode === 'repair' ? 'Pick a part from stock — then type the quantity' : 'Accessories & parts — pick, then type the quantity'}
                  hint="Only items in stock at this shop are listed, with the quantity available"
                >
                  <Combobox
                    value={null}
                    onChange={(_v, option) => option?.data && addModelLine(option.data)}
                    options={accessoryOptions}
                    onSearchChange={setAccSearch}
                    loading={accessories.isFetching}
                    placeholder={`${accessories.data?.length ?? 0} item(s) in stock`}
                    searchPlaceholder="Name or SKU…"
                    emptyText="Nothing in stock — add it under Purchases or Stock → Add stock"
                  />
                </Field>
              </CardContent>
            </Card>
          )}

          {/* items / parts table */}
          {mode !== 'recharge' && (
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between border-b border-border bg-muted/30 py-3">
                <CardTitle className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <ShoppingCart className="size-4" />
                  </span>
                  {mode === 'repair' ? 'Parts used' : 'Bill items'}
                  {lines.length > 0 && <Badge variant="secondary">{lines.length}</Badge>}
                </CardTitle>
                {session.can('report.profit') && lines.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Est. profit <Money value={profit} colored className="font-semibold" />
                  </span>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {lines.length === 0 ? (
                  <EmptyState
                    icon={Barcode}
                    title={mode === 'repair' ? 'No parts added' : 'Nothing on the bill yet'}
                    description={
                      mode === 'repair'
                        ? 'Add any accessories or parts taken from stock. A repair can also be labour-only.'
                        : 'Scan the IMEI on the box or search the shelf above. Press F2 to jump back to the scan box.'
                    }
                    className="border-0"
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="w-28 px-2 py-2 text-center">Qty</th>
                          <th className="w-32 px-2 py-2 text-right">Price ₹</th>
                          <th className="w-28 px-2 py-2 text-right">Disc ₹</th>
                          <th className="w-16 px-2 py-2 text-right">GST%</th>
                          <th className="w-32 px-3 py-2 text-right">Amount</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.key} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-medium">{l.description}</p>
                              {l.imei1 && <p className="font-mono text-xs text-muted-foreground">{l.imei1}</p>}
                              {l.maxQty !== undefined && (
                                <p className="text-xs text-muted-foreground">{l.maxQty} in stock</p>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {l.stockUnitId ? (
                                <p className="pr-2 text-right tnum text-sm text-muted-foreground">1</p>
                              ) : (
                                <div className="flex items-center justify-center gap-0.5">
                                  <button
                                    type="button"
                                    aria-label="Decrease quantity"
                                    disabled={l.qty <= 1}
                                    onClick={() => updateLine(l.key, { qty: Math.max(1, l.qty - 1) })}
                                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Minus className="size-3.5" />
                                  </button>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={l.maxQty}
                                    value={l.qty}
                                    onChange={(e) => {
                                      const wanted = Math.max(1, Math.floor(Number(e.target.value) || 1))
                                      const capped = l.maxQty ? Math.min(l.maxQty, wanted) : wanted
                                      if (l.maxQty && wanted > l.maxQty) toast.error(`Only ${l.maxQty} in stock`)
                                      updateLine(l.key, { qty: capped })
                                    }}
                                    className="h-7 w-10 px-1 text-center tnum"
                                  />
                                  <button
                                    type="button"
                                    aria-label="Increase quantity"
                                    disabled={l.maxQty !== undefined && l.qty >= l.maxQty}
                                    onClick={() => {
                                      if (l.maxQty !== undefined && l.qty >= l.maxQty) {
                                        toast.error(`Only ${l.maxQty} in stock`)
                                        return
                                      }
                                      updateLine(l.key, { qty: l.qty + 1 })
                                    }}
                                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Plus className="size-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                value={l.unitPrice || ''}
                                onChange={(e) => updateLine(l.key, { unitPrice: Number(e.target.value) })}
                                className="h-8 text-right tnum font-medium"
                                autoFocus={!l.unitPrice}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                value={l.discount || ''}
                                disabled={!session.can('sale.discount')}
                                onChange={(e) => updateLine(l.key, { discount: Number(e.target.value) })}
                                className="h-8 text-right tnum"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                min={0}
                                value={l.gstRate}
                                onChange={(e) => updateLine(l.key, { gstRate: Number(e.target.value) })}
                                className="h-8 text-right tnum"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tnum">
                              {money(l.unitPrice * l.qty - l.discount)}
                            </td>
                            <td className="px-1 py-2">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => removeLine(l.key)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ------------------------------------------------------ right */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Combobox
                    value={customerId}
                    onChange={setCustomerId}
                    options={customerOptions}
                    onSearchChange={setCustomerSearch}
                    loading={customers.isFetching}
                    placeholder="Walk-in customer"
                    searchPlaceholder="Name, mobile or Aadhaar…"
                    emptyText="No customer found"
                    clearable
                    onCreate={() => setCustomerDialog(true)}
                    createLabel="Add new customer"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCustomerDialog(true)}
                  title="New customer (Ctrl+N)"
                >
                  <UserPlus />
                </Button>
              </div>

              {customer && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{customer.name}</span>
                    <span className="text-muted-foreground">{formatPhone(customer.phonePrimary)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{customer.totalPurchases} past bills</span>
                    {customer.outstanding > 0 && (
                      <Badge variant="warning">{money(customer.outstanding)} outstanding</Badge>
                    )}
                  </div>
                </div>
              )}

              <Field label="Sale date">
                <Input
                  type="date"
                  value={saleDate}
                  max={todayStr()}
                  onChange={(e) => setSaleDate(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            {/* POS amount display */}
            <div className="bg-gradient-to-br from-primary to-primary/70 p-4 text-primary-foreground">
              <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-primary-foreground/80">
                <span>Amount payable</span>
                {total > 0 &&
                  (isCredit ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
                      <CalendarClock className="size-3" /> {money(due)} due
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-success-foreground">
                      <Check className="size-3" /> Fully paid
                    </span>
                  ))}
              </div>
              <div className="mt-1 flex items-baseline gap-1 tnum">
                <span className="text-2xl font-semibold text-primary-foreground/70">₹</span>
                <span className="text-[2.6rem] font-bold leading-none tracking-tight">
                  {Number(total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {paid > 0 && paid < total && (
                <div className="mt-2 flex justify-between border-t border-primary-foreground/20 pt-2 text-xs text-primary-foreground/80">
                  <span>Received {money(paid)}</span>
                  <span>Balance {money(due)}</span>
                </div>
              )}
            </div>

            <CardContent className="space-y-3 pt-3">
              <div className="space-y-1.5 text-[13px]">
                {mode === 'repair' && serviceCharge > 0 && <Row label="Labour" value={money(serviceCharge)} />}
                {lines.length > 0 && (
                  <Row label={mode === 'repair' ? 'Parts' : 'Items total'} value={money(linesTotal)} />
                )}
                {mode === 'recharge' && <Row label="Recharge" value={money(serviceCharge)} />}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Bill discount</span>
                  <Input
                    type="number"
                    min={0}
                    value={billDiscount || ''}
                    disabled={!session.can('sale.discount')}
                    onChange={(e) => setBillDiscount(Number(e.target.value) || 0)}
                    className="h-8 w-28 text-right tnum"
                    prefixNode={<Percent />}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Other charges</span>
                  <Input
                    type="number"
                    min={0}
                    value={otherCharges || ''}
                    onChange={(e) => setOtherCharges(Number(e.target.value) || 0)}
                    className="h-8 w-28 text-right tnum"
                  />
                </div>
              </div>

              <Separator />

              {/* payment mode tiles */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Payment mode</p>
                <div className="flex flex-wrap gap-1.5">
                  {PAYMENT_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMode(m)}
                      className={cn(
                        'cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                        paymentMode === m
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-border bg-muted/40 text-foreground hover:bg-muted'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Amount received" hint="Leave blank for full payment">
                <Input
                  ref={paidRef}
                  type="number"
                  min={0}
                  max={total}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={String(total)}
                  className="h-11 text-right text-xl font-semibold tnum"
                  suffixNode={<span className="kbd">F4</span>}
                />
              </Field>

              {/* on-screen numeric keypad */}
              <div className="grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => keypadPress(d)}
                    className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-lg font-semibold tnum transition-colors hover:bg-muted active:bg-muted"
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => keypadPress('00')}
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-lg font-semibold tnum transition-colors hover:bg-muted active:bg-muted"
                >
                  00
                </button>
                <button
                  type="button"
                  onClick={() => keypadPress('0')}
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-lg font-semibold tnum transition-colors hover:bg-muted active:bg-muted"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={keypadBackspace}
                  aria-label="Delete last digit"
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Delete className="size-5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPaidAmount(total)}
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-success/40 bg-success/5 text-[13px] font-semibold text-success transition-colors hover:bg-success/15"
                >
                  Full paid
                </button>
                <button
                  type="button"
                  onClick={() => setPaidAmount(Math.round(total * 0.5))}
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-muted/40 text-[13px] font-semibold transition-colors hover:bg-muted"
                >
                  Half
                </button>
                <button
                  type="button"
                  onClick={() => setPaidAmount(0)}
                  className="flex h-11 cursor-pointer items-center justify-center rounded-lg border border-warning/40 bg-warning/5 text-[13px] font-semibold text-warning transition-colors hover:bg-warning/15"
                >
                  Credit
                </button>
              </div>

              {isCredit && (
                <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
                      <CalendarClock className="size-4" /> On credit
                    </span>
                    <span className="text-lg font-semibold tnum">{money(due)}</span>
                  </div>
                  <Field label="Promised payment date" required>
                    <Input
                      type="date"
                      value={dueDate}
                      min={saleDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </Field>
                  <div className="flex gap-1.5">
                    {[7, 15, 30].map((d) => (
                      <Button
                        key={d}
                        variant="outline"
                        size="xs"
                        className="flex-1"
                        onClick={() => setDueDate(addDays(saleDate, d))}
                      >
                        +{d}d
                      </Button>
                    ))}
                  </div>
                  <Field label="Note on the promise">
                    <Input
                      value={promisedNote}
                      onChange={(e) => setPromisedNote(e.target.value)}
                      placeholder="e.g. will pay after salary on 5th"
                    />
                  </Field>
                </div>
              )}

              <Field label="Bill notes">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  className="min-h-[48px]"
                />
              </Field>

              <div className="grid grid-cols-[1fr_1.3fr] gap-2 pt-1">
                <Button variant="outline" onClick={() => void submit(true)} loading={saving} className="h-12">
                  <Printer /> Print
                  <span className="kbd ml-1">F10</span>
                </Button>
                <Button
                  onClick={() => void submit(false)}
                  loading={saving}
                  className="h-12 bg-success text-base font-semibold text-success-foreground shadow-card hover:bg-success/90"
                >
                  <Check /> Save bill
                  <span className="kbd ml-1">F9</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {session.can('report.profit') && total > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              <Wallet className="size-3.5" />
              <span>
                Cost {money(costTotal)} · Margin{' '}
                <span className={cn(profit >= 0 ? 'text-success' : 'text-destructive', 'font-medium')}>
                  {total > 0 ? ((profit / total) * 100).toFixed(1) : '0.0'}%
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      <CustomerFormDialog
        open={customerDialog}
        onOpenChange={setCustomerDialog}
        presetPhone={/^\d{10}$/.test(customerSearch) ? customerSearch : undefined}
        onSaved={(id) => {
          setCustomerId(id)
          void customers.refetch()
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear this bill?"
        description="Nothing has been saved yet."
        confirmLabel="Clear bill"
        destructive
        onConfirm={() => {
          reset()
          setConfirmClear(false)
        }}
      />
    </div>
  )
}

function PresetChips({
  presets,
  onPick
}: {
  presets?: any[]
  onPick: (p: any) => void
}) {
  if (!presets?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p)}
          className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs transition hover:border-ring/50 hover:bg-muted"
        >
          {p.name}
          {p.defaultPrice > 0 && <span className="ml-1 text-muted-foreground">· {money(p.defaultPrice)}</span>}
        </button>
      ))}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum">{value}</span>
    </div>
  )
}
