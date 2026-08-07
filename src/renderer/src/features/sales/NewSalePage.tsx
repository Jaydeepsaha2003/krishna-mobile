import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Barcode,
  CalendarClock,
  Check,
  Percent,
  Printer,
  ScanLine,
  ShoppingCart,
  Trash2,
  UserPlus,
  Wallet,
  X
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
import { SimpleSelect } from '@/components/ui/form'
import { ConfirmDialog } from '@/components/ui/overlay'
import { EmptyState, Money, PageHeader } from '@/components/ui/misc'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'
import { buildInvoiceHtml } from './invoice'

interface Line {
  key: string
  stockUnitId?: string
  modelId: string
  description: string
  imei1?: string
  qty: number
  unitPrice: number
  discount: number
  gstRate: number
  costPrice: number
}

export function NewSalePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { companyId, shopId } = useScope()

  const [lines, setLines] = React.useState<Line[]>([])
  const [customerId, setCustomerId] = React.useState('')
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [scan, setScan] = React.useState('')
  const [stockSearch, setStockSearch] = React.useState('')
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

  const customer = (customers.data ?? []).find((c: any) => c.id === customerId)

  /* ------------------------------------------------------------- totals */
  const itemsTotal = lines.reduce((a, l) => a + l.unitPrice * l.qty - l.discount, 0)
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
        toast.error('That handset is already on the bill')
        return
      }
      setLines((ls) => [
        ...ls,
        {
          key: `${unit.id}-${Date.now()}`,
          stockUnitId: unit.id,
          modelId: unit.modelId,
          description: `${unit.brandName} ${unit.modelName}${unit.color ? ` · ${unit.color}` : ''}`,
          imei1: unit.imei1 ?? undefined,
          qty: 1,
          unitPrice: Number(unit.salePrice) || 0,
          discount: 0,
          gstRate: Number(unit.gstRate) || 18,
          costPrice: Number(unit.costPrice) || 0
        }
      ])
      toast.success(`Added ${unit.brandName} ${unit.modelName}`, { duration: 1400 })
    },
    [lines]
  )

  const handleScan = async (value: string) => {
    const imei = normalizeImei(value)
    if (imei.length < 4) return
    const hits = await api.stock.byImei(imei)
    const sellable = (hits ?? []).filter(
      (h: any) => h.status === 'in_stock' && h.shopId === shopId
    )
    if (sellable.length === 0) {
      const elsewhere = (hits ?? [])[0]
      toast.error(
        elsewhere
          ? `${elsewhere.label} is "${elsewhere.status.replace('_', ' ')}"${
              elsewhere.shopName ? ` at ${elsewhere.shopName}` : ''
            }`
          : `No handset found for ${imei}`
      )
      return
    }
    addUnit(sellable[0])
    setScan('')
  }

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
    scanRef.current?.focus()
  }

  const submit = async (thenPrint: boolean) => {
    if (!shopId) return toast.error('Pick a shop first')
    if (lines.length === 0) return toast.error('Add at least one item')
    if (isCredit && !customerId)
      return toast.error('A credit sale needs a customer — pick or create one')

    setSaving(true)
    try {
      const res = await api.sales.create({
        shopId,
        customerId: customerId || undefined,
        saleDate,
        items: lines.map((l) => ({
          stockUnitId: l.stockUnitId,
          modelId: l.modelId,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discount: l.discount,
          gstRate: l.gstRate
        })),
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
    description: 'Focus IMEI scan box',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('f4', () => paidRef.current?.focus(), {
    description: 'Jump to amount paid',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('f9', () => void submit(false), {
    description: 'Save bill',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('f10', () => void submit(true), {
    description: 'Save & print bill',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('ctrl+n', () => setCustomerDialog(true), {
    description: 'New customer',
    group: 'Sale',
    allowInInputs: true
  })
  useHotkey('escape', () => lines.length > 0 && setConfirmClear(true), {
    description: 'Clear the bill',
    group: 'Sale',
    allowInInputs: true
  })

  React.useEffect(() => {
    scanRef.current?.focus()
  }, [])

  const stockOptions: ComboOption[] = (stock.data ?? []).map((u: any) => ({
    value: u.id,
    label: `${u.brandName} ${u.modelName}`,
    hint: u.imei1 ? `IMEI ${u.imei1}` : u.serialNo ? `SN ${u.serialNo}` : u.sku,
    meta: money(u.salePrice || 0),
    group: u.brandName,
    keywords: [u.imei1, u.sku, u.color].filter(Boolean),
    data: u
  }))

  const customerOptions: ComboOption[] = (customers.data ?? []).map((c: any) => ({
    value: c.id,
    label: c.name,
    hint: `${formatPhone(c.phonePrimary)}${c.outstanding > 0 ? ` · ${money(c.outstanding)} due` : ''}`,
    meta: c.overdueCount > 0 ? <Badge variant="danger">{c.overdueCount} overdue</Badge> : undefined,
    keywords: [c.phonePrimary, c.phoneSecondary, c.aadhaar].filter(Boolean)
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="New sale"
        description={`${session.activeShop()?.name ?? 'No shop'} · scan an IMEI or search the shelf`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/sales')}>
              All sales
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={lines.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              <X /> Clear <span className="kbd ml-1">Esc</span>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* ------------------------------------------------------- left */}
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Scan / type IMEI" hint="Barcode scanners work straight into this box">
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

              <Field label="Or pick from shelf">
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
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="size-4" /> Bill items
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
                  title="Nothing on the bill yet"
                  description="Scan the IMEI on the box or search the shelf above. Press F2 any time to jump back to the scan box."
                  className="border-0"
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="w-20 px-2 py-2 text-right">Qty</th>
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
                            {l.imei1 && (
                              <p className="font-mono text-xs text-muted-foreground">{l.imei1}</p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={1}
                              value={l.qty}
                              disabled={Boolean(l.stockUnitId)}
                              onChange={(e) =>
                                updateLine(l.key, { qty: Math.max(1, Number(e.target.value)) })
                              }
                              className="h-8 text-right tnum"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={l.unitPrice || ''}
                              onChange={(e) =>
                                updateLine(l.key, { unitPrice: Number(e.target.value) })
                              }
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
                              onChange={(e) =>
                                updateLine(l.key, { discount: Number(e.target.value) })
                              }
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
                    <span className="text-muted-foreground">
                      {formatPhone(customer.phonePrimary)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{customer.totalPurchases} past bills</span>
                    {customer.outstanding > 0 && (
                      <Badge variant="warning">{money(customer.outstanding)} outstanding</Badge>
                    )}
                    {customer.creditLimit > 0 && (
                      <Badge variant="outline">Limit {money(customer.creditLimit)}</Badge>
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

          <Card>
            <CardHeader className="py-3">
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 text-[13px]">
                <Row label="Items total" value={money(itemsTotal)} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Bill discount</span>
                  <Input
                    type="number"
                    min={0}
                    value={billDiscount || ''}
                    disabled={!session.can('sale.discount')}
                    onChange={(e) => setBillDiscount(Number(e.target.value) || 0)}
                    className="h-7 w-28 text-right tnum"
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
                    className="h-7 w-28 text-right tnum"
                  />
                </div>
              </div>

              <Separator />

              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Total</span>
                <span className="text-2xl font-semibold tnum">{money(total)}</span>
              </div>

              <Field label="Payment mode">
                <SimpleSelect
                  value={paymentMode}
                  onChange={setPaymentMode}
                  options={[...PAYMENT_MODES]}
                />
              </Field>

              <Field label="Amount received" hint="Leave blank for full payment">
                <Input
                  ref={paidRef}
                  type="number"
                  min={0}
                  max={total}
                  value={paidAmount}
                  onChange={(e) =>
                    setPaidAmount(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  placeholder={String(total)}
                  className="h-10 text-right text-lg font-semibold tnum"
                  suffixNode={<span className="kbd">F4</span>}
                />
              </Field>

              <div className="flex gap-1.5">
                {[0, 0.25, 0.5, 1].map((f) => (
                  <Button
                    key={f}
                    variant="outline"
                    size="xs"
                    className="flex-1"
                    onClick={() => setPaidAmount(Math.round(total * f))}
                  >
                    {f === 0 ? 'Full credit' : f === 1 ? 'Full paid' : `${f * 100}%`}
                  </Button>
                ))}
              </div>

              {isCredit && (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
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
                  className="min-h-[52px]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => void submit(true)}
                  loading={saving}
                  disabled={lines.length === 0}
                >
                  <Printer /> Save & print
                  <span className="kbd ml-1">F10</span>
                </Button>
                <Button onClick={() => void submit(false)} loading={saving} disabled={lines.length === 0}>
                  <Check /> Save bill
                  <span className="kbd ml-1">F9</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <Wallet className="size-3.5" />
            <span>
              Cost {money(costTotal)} · Margin{' '}
              <span className={cn(profit >= 0 ? 'text-success' : 'text-destructive', 'font-medium')}>
                {total > 0 ? ((profit / total) * 100).toFixed(1) : '0.0'}%
              </span>
            </span>
          </div>
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
        description={`${lines.length} item(s) will be removed. Nothing has been saved yet.`}
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum">{value}</span>
    </div>
  )
}
