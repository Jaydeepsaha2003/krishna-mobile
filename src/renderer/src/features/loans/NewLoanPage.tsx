import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Boxes, Calculator, Check, HandCoins, PenLine, Smartphone, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { useBrands, useScope } from '@/lib/hooks'
import { cn, money, todayStr } from '@/lib/utils'
import { LOAN_TENURE_PRESETS } from '@shared/constants'
import { imeiCheck, normalizeImei } from '@shared/validators'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Separator, Textarea } from '@/components/ui/base'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { SimpleSelect } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/misc'
import { CustomerFormDialog } from '@/features/customers/CustomerFormDialog'

const CATEGORIES = ['Smartphone', 'Feature Phone', 'Tablet', 'Wearable', 'Accessory', 'Other']

type Source = 'stock' | 'direct'
type Errors = Partial<Record<'customer' | 'unit' | 'brand' | 'model' | 'purchaseAmount' | 'saleAmount' | 'tenure', string>>

export function NewLoanPage() {
  const navigate = useNavigate()
  const { shopId, shops } = useScope()
  const brands = useBrands()

  const [targetShop, setTargetShop] = React.useState(shopId ?? '')
  const [customerId, setCustomerId] = React.useState('')
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [customerDialog, setCustomerDialog] = React.useState(false)

  // Every loan finances a sale of something — a phone, an accessory, or any
  // other product the shop carries. It either comes off the shelf (stock
  // drops by one, exactly like a POS sale) or it's a direct sale for
  // something that never went through the purchase/stock system — the shop
  // still wants the loan tracked, it just isn't linked to inventory. Neither
  // path is the "unusual" one; which to use just depends on whether this
  // particular item is tracked in stock.
  const [source, setSource] = React.useState<Source>('stock')
  const [stockSearch, setStockSearch] = React.useState('')
  const [stockUnitId, setStockUnitId] = React.useState('')
  const [selectedUnit, setSelectedUnit] = React.useState<any>(null)

  const [brand, setBrand] = React.useState('')
  const [category, setCategory] = React.useState('Smartphone')
  const [modelName, setModelName] = React.useState('')
  const [imei, setImei] = React.useState('')

  const [loanDate, setLoanDate] = React.useState(todayStr())
  const [purchaseAmount, setPurchaseAmount] = React.useState<number | ''>('')
  const [saleAmount, setSaleAmount] = React.useState<number | ''>('')
  const [downPayment, setDownPayment] = React.useState<number | ''>(0)
  const [processingFee, setProcessingFee] = React.useState<number | ''>(0)
  const [tenure, setTenure] = React.useState(6)
  const [emiOverride, setEmiOverride] = React.useState<number | ''>('')
  const [emiStartDate, setEmiStartDate] = React.useState(todayStr())
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Errors>({})

  React.useEffect(() => {
    if (shopId && !targetShop) setTargetShop(shopId)
  }, [shopId, targetShop])

  const loanAmount = Math.max(0, Number(saleAmount || 0) - Number(downPayment || 0))
  const autoEmi = tenure > 0 ? Math.round((loanAmount / tenure) * 100) / 100 : 0
  // A manually-entered EMI is flat for every installment (including the
  // last), so the total can legitimately differ from the financed amount —
  // that's how the shop's financing markup (or a discount) shows up. Only
  // the auto-calculated rate reconciles exactly to loanAmount.
  const isFlatOverride = emiOverride !== ''
  const monthlyEmi = isFlatOverride ? Number(emiOverride) : autoEmi
  const totalPayable = isFlatOverride ? Math.round(monthlyEmi * tenure * 100) / 100 : loanAmount
  const margin = Number(saleAmount || 0) - Number(purchaseAmount || 0)
  const netIncome = margin + Number(processingFee || 0)

  const stockQuery = useStockPicker(targetShop, stockSearch, source === 'stock', customerSearch)

  const pickUnit = (unit: any) => {
    setSelectedUnit(unit)
    setStockUnitId(unit.id)
    setBrand(unit.brandName)
    setCategory('Smartphone')
    setModelName(unit.modelName)
    setImei(unit.imei1 ?? '')
    setPurchaseAmount(unit.costPrice)
    if (!saleAmount) setSaleAmount(unit.salePrice || unit.costPrice)
    setErrors((e) => ({ ...e, unit: undefined, brand: undefined, model: undefined, purchaseAmount: undefined }))
  }

  const switchSource = (next: Source) => {
    setSource(next)
    setErrors((e) => ({ ...e, unit: undefined, brand: undefined, model: undefined }))
    if (next === 'direct') {
      // Leaving stock mode — the unit no longer applies; the product fields
      // become free text so the shop can still describe what was financed.
      setStockUnitId('')
      setSelectedUnit(null)
    }
  }

  const imeiInfo = imei ? imeiCheck(imei) : null

  const validate = (): Errors => {
    const e: Errors = {}
    if (!customerId) e.customer = 'Choose or add the customer'
    if (source === 'stock' && !stockUnitId) e.unit = 'Pick which item from stock, or switch to a direct sale'
    if (source === 'direct') {
      if (!brand.trim()) e.brand = 'Enter the brand'
      if (!modelName.trim()) e.model = 'Enter the model'
    }
    if (!purchaseAmount || Number(purchaseAmount) <= 0)
      e.purchaseAmount = 'Enter what the shop paid for this item'
    if (!saleAmount || Number(saleAmount) <= 0) e.saleAmount = 'Enter the amount charged to the customer'
    if (saleAmount && downPayment !== '' && Number(downPayment) >= Number(saleAmount))
      e.saleAmount = 'Down payment must be less than the sale amount'
    if (tenure < 1 || tenure > 60) e.tenure = 'Tenure must be between 1 and 60 months'
    return e
  }

  const submit = async () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) {
      toast.error(Object.values(e)[0])
      return
    }

    setSaving(true)
    try {
      const res = await api.loans.create({
        shopId: targetShop,
        customerId,
        stockUnitId: source === 'stock' ? stockUnitId : undefined,
        brand: brand || undefined,
        category: category || undefined,
        modelName: modelName || undefined,
        imei: imei || undefined,
        loanDate,
        purchaseAmount: Number(purchaseAmount) || 0,
        saleAmount: Number(saleAmount),
        downPayment: Number(downPayment) || 0,
        processingFee: Number(processingFee) || 0,
        tenureMonths: tenure,
        monthlyEmi: emiOverride !== '' ? Number(emiOverride) : undefined,
        emiStartDate,
        notes: notes || undefined
      })
      const payableNote =
        Math.abs(res.totalPayable - res.loanAmount) > 0.5 ? `, total payable ₹${res.totalPayable}` : ''
      toast.success(`${res.loanNo} created — ${tenure} EMIs of ~${money(res.monthlyEmi)}`, {
        description:
          source === 'stock'
            ? `Item removed from stock. Financed ₹${res.loanAmount}${payableNote}, last EMI on ${res.emiEndDate}`
            : `Direct sale, not linked to stock. Financed ₹${res.loanAmount}${payableNote}, last EMI on ${res.emiEndDate}`
      })
      navigate(`/loans/${res.id}/repay`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const customerOptions: ComboOption[] = (stockQuery.customers ?? []).map((c: any) => ({
    value: c.id,
    label: c.name,
    hint: `${c.phonePrimary}${c.outstanding > 0 ? ` · ${money(c.outstanding)} credit due` : ''}`
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="New EMI loan"
        description="Finance any product — phone, accessory or otherwise — with a down payment and monthly installments"
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/loans')}>
            All loans
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="size-4" /> Customer & shop
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Shop" required className="sm:col-span-2">
                <SimpleSelect
                  value={targetShop}
                  onChange={setTargetShop}
                  options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                  placeholder="Choose shop"
                />
              </Field>
              <Field label="Customer" required error={errors.customer} className="sm:col-span-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Combobox
                      value={customerId}
                      onChange={(v) => {
                        setCustomerId(v)
                        setErrors((e) => ({ ...e, customer: undefined }))
                      }}
                      options={customerOptions}
                      onSearchChange={setCustomerSearch}
                      loading={stockQuery.customersLoading}
                      placeholder="Search name, mobile or Aadhaar…"
                      searchPlaceholder="Type to search…"
                      onCreate={() => setCustomerDialog(true)}
                      createLabel="Add new customer"
                      invalid={!!errors.customer}
                    />
                  </div>
                  <Button variant="outline" size="icon" onClick={() => setCustomerDialog(true)}>
                    <UserPlus />
                  </Button>
                </div>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="size-4" /> Product being financed
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchSource('stock')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition',
                    source === 'stock' ? 'border-primary bg-accent/40' : 'border-border hover:bg-muted/40'
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Boxes className="size-4" /> From current stock
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Picks an item already purchased into inventory — a phone, an accessory, anything
                    tracked as stock. It is marked sold and removed from stock, exactly like a POS sale.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => switchSource('direct')}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition',
                    source === 'direct' ? 'border-primary bg-accent/40' : 'border-border hover:bg-muted/40'
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <PenLine className="size-4" /> Direct sale
                  </span>
                  <span className="text-xs text-muted-foreground">
                    For anything not tracked in your stock — another product line, a one-off item, or
                    goods you don't keep IMEI-level inventory for. Type in what it is.
                  </span>
                </button>
              </div>

              {source === 'stock' ? (
                <Field label="Pick an in-stock item" required error={errors.unit}>
                  <Combobox
                    value={stockUnitId}
                    onChange={(_v, opt) => opt?.data && pickUnit(opt.data)}
                    options={(stockQuery.units ?? []).map((u: any) => ({
                      value: u.id,
                      label: `${u.brandName} ${u.modelName}`,
                      hint: u.imei1 ? `IMEI ${u.imei1}` : u.sku,
                      meta: money(u.costPrice),
                      group: u.brandName,
                      keywords: [u.imei1, u.sku],
                      data: u
                    }))}
                    onSearchChange={setStockSearch}
                    loading={stockQuery.unitsLoading}
                    placeholder={!targetShop ? 'Choose a shop first' : 'Search model or IMEI…'}
                    searchPlaceholder="Model, IMEI or SKU…"
                    disabled={!targetShop}
                    invalid={!!errors.unit}
                  />
                </Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Brand" required error={errors.brand}>
                    <Combobox
                      value={brand}
                      onChange={(v) => {
                        setBrand(v)
                        setErrors((e) => ({ ...e, brand: undefined }))
                      }}
                      options={(brands.data ?? []).map((b: any) => ({ value: b.name, label: b.name }))}
                      placeholder="Choose or type a brand"
                      onCreate={(text) => setBrand(text)}
                      createLabel="Use"
                      invalid={!!errors.brand}
                    />
                  </Field>
                  <Field label="Category">
                    <SimpleSelect value={category} onChange={setCategory} options={CATEGORIES} />
                  </Field>
                  <Field label="Model" required error={errors.model}>
                    <Input
                      value={modelName}
                      onChange={(e) => {
                        setModelName(e.target.value)
                        setErrors((er) => ({ ...er, model: undefined }))
                      }}
                      placeholder="e.g. Galaxy M14 5G"
                      invalid={!!errors.model}
                    />
                  </Field>
                </div>
              )}

              <Field
                label="IMEI (if applicable)"
                hint={
                  imeiInfo?.warning
                    ? imeiInfo.warning
                    : 'Leave blank for accessories or non-serialised goods'
                }
              >
                <Input
                  value={imei}
                  onChange={(e) => setImei(normalizeImei(e.target.value).slice(0, 15))}
                  className="font-mono"
                  disabled={source === 'stock'}
                  inputMode="numeric"
                  placeholder="15-digit IMEI"
                  invalid={Boolean(imei && imeiInfo && !imeiInfo.ok)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2">
                <Calculator className="size-4" /> Amounts
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Loan / purchase date" required>
                <Input type="date" value={loanDate} max={todayStr()} onChange={(e) => setLoanDate(e.target.value)} />
              </Field>
              <Field
                label="Purchase amount (shop cost) ₹"
                required
                error={errors.purchaseAmount}
                hint={source === 'stock' ? 'From the selected unit' : undefined}
              >
                <Input
                  type="number"
                  min={0}
                  value={purchaseAmount}
                  disabled={source === 'stock'}
                  onChange={(e) => {
                    setPurchaseAmount(e.target.value === '' ? '' : Number(e.target.value))
                    setErrors((er) => ({ ...er, purchaseAmount: undefined }))
                  }}
                  className="text-right tnum"
                  invalid={!!errors.purchaseAmount}
                />
              </Field>
              <Field label="Sale amount charged to customer ₹" required error={errors.saleAmount}>
                <Input
                  type="number"
                  min={0}
                  value={saleAmount}
                  onChange={(e) => {
                    setSaleAmount(e.target.value === '' ? '' : Number(e.target.value))
                    setErrors((er) => ({ ...er, saleAmount: undefined }))
                  }}
                  className="text-right text-lg font-semibold tnum"
                  invalid={!!errors.saleAmount}
                />
              </Field>
              <Field label="Down payment received ₹">
                <Input
                  type="number"
                  min={0}
                  value={downPayment}
                  onChange={(e) => setDownPayment(e.target.value === '' ? '' : Number(e.target.value))}
                  className="text-right tnum"
                />
              </Field>
              <Field label="Processing fee ₹" hint="Shop's income, separate from margin">
                <Input
                  type="number"
                  min={0}
                  value={processingFee}
                  onChange={(e) => setProcessingFee(e.target.value === '' ? '' : Number(e.target.value))}
                  className="text-right tnum"
                />
              </Field>
              <Field label="Margin (auto)">
                <Input readOnly value={money(margin)} className="text-right tnum" tabIndex={-1} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2">
                <HandCoins className="size-4" /> EMI schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {LOAN_TENURE_PRESETS.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={tenure === t ? 'default' : 'outline'}
                    size="xs"
                    onClick={() => setTenure(t)}
                  >
                    {t} mo
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tenure (months)" required error={errors.tenure}>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={tenure}
                    onChange={(e) => setTenure(Math.max(1, Number(e.target.value) || 1))}
                    className="text-right tnum"
                    invalid={!!errors.tenure}
                  />
                </Field>
                <Field label="Monthly EMI ₹" hint="Auto-calculated; edit to override">
                  <Input
                    type="number"
                    min={0}
                    value={emiOverride === '' ? (Number.isFinite(autoEmi) ? autoEmi : '') : emiOverride}
                    onChange={(e) => setEmiOverride(e.target.value === '' ? '' : Number(e.target.value))}
                    className="text-right text-lg font-semibold tnum"
                  />
                </Field>
                <Field label="First EMI date">
                  <Input type="date" value={emiStartDate} onChange={(e) => setEmiStartDate(e.target.value)} />
                </Field>
              </div>

              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[52px]" />
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* --------------------------------------------------------- summary */}
        <div className="space-y-4">
          <Card className="sticky top-0">
            <CardHeader className="py-3">
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs',
                  source === 'stock'
                    ? 'border-info/40 bg-info/5 text-info'
                    : 'border-border bg-muted/50 text-muted-foreground'
                )}
              >
                {source === 'stock'
                  ? selectedUnit
                    ? `Will remove ${selectedUnit.brandName} ${selectedUnit.modelName} from stock on save.`
                    : 'Pick an item from stock above — nothing is removed until you do.'
                  : 'Direct sale — this loan is recorded without touching stock.'}
              </div>

              <Row label="Sale amount" value={money(saleAmount || 0)} />
              <Row label="Down payment" value={`- ${money(downPayment || 0)}`} />
              <Separator />
              <Row label="Financed (loan amount)" value={money(loanAmount)} bold />
              <Row label="Tenure" value={`${tenure} month(s)`} />
              <Row label="Monthly EMI" value={money(monthlyEmi)} bold />
              {isFlatOverride && Math.abs(totalPayable - loanAmount) > 0.5 && (
                <Row
                  label="Total payable (tenure × EMI)"
                  value={
                    <span className={totalPayable > loanAmount ? 'text-info' : 'text-warning'}>
                      {money(totalPayable)}
                    </span>
                  }
                  bold
                />
              )}
              <Separator />
              <Row label="Margin (sale − cost)" value={<span className={cn(margin >= 0 ? 'text-success' : 'text-destructive')}>{money(margin)}</span>} />
              <Row label="Processing fee income" value={money(processingFee || 0)} />
              <Row label="Net income to shop" value={money(netIncome)} bold />

              {loanAmount > 0 && tenure > 0 && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  {isFlatOverride ? (
                    Math.abs(totalPayable - loanAmount) > 0.5 ? (
                      <>
                        {tenure} equal installments of {money(monthlyEmi)}, starting {emiStartDate}. This
                        EMI rate {totalPayable > loanAmount ? 'includes a financing markup of' : 'is a discount of'}{' '}
                        <strong>{money(Math.abs(totalPayable - loanAmount))}</strong> over the financed
                        amount — the customer pays {money(totalPayable)} in total, not {money(loanAmount)}.
                      </>
                    ) : (
                      <>
                        {tenure} equal installments of {money(monthlyEmi)}, starting {emiStartDate}.
                      </>
                    )
                  ) : (
                    <>
                      {tenure - 1} installment(s) of {money(monthlyEmi)} and one final installment
                      adjusted for rounding, starting {emiStartDate}.
                    </>
                  )}
                </div>
              )}

              <Button className="w-full" onClick={() => void submit()} loading={saving}>
                <Check /> Create loan
              </Button>
            </CardContent>
          </Card>

          {selectedUnit && source === 'stock' && (
            <Card>
              <CardContent className="space-y-1 p-4 text-[13px]">
                <p className="font-medium">
                  {selectedUnit.brandName} {selectedUnit.modelName}
                </p>
                {selectedUnit.imei1 && (
                  <p className="font-mono text-xs text-muted-foreground">{selectedUnit.imei1}</p>
                )}
                <Badge variant="outline">Cost {money(selectedUnit.costPrice)}</Badge>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <CustomerFormDialog
        open={customerDialog}
        onOpenChange={setCustomerDialog}
        onSaved={(id) => {
          setCustomerId(id)
          setErrors((e) => ({ ...e, customer: undefined }))
          void stockQuery.refetchCustomers()
        }}
      />
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('tnum', bold && 'text-base font-semibold')}>{value}</span>
    </div>
  )
}

/** Small local hook bundling the two searchable lists this screen needs. */
function useStockPicker(shopId: string, stockSearch: string, enabled: boolean, customerSearch: string) {
  const [customers, setCustomers] = React.useState<any[]>([])
  const [customersLoading, setCustomersLoading] = React.useState(false)
  const [units, setUnits] = React.useState<any[]>([])
  const [unitsLoading, setUnitsLoading] = React.useState(false)

  const refetchCustomers = React.useCallback(async () => {
    setCustomersLoading(true)
    try {
      setCustomers(await api.customers.list({ search: customerSearch, limit: 40 }))
    } finally {
      setCustomersLoading(false)
    }
  }, [customerSearch])

  React.useEffect(() => {
    void refetchCustomers()
  }, [refetchCustomers])

  React.useEffect(() => {
    if (!enabled || !shopId) {
      setUnits([])
      return
    }
    let cancelled = false
    setUnitsLoading(true)
    void api.stock
      .available(shopId, stockSearch, 60)
      .then((rows) => !cancelled && setUnits(rows))
      .finally(() => !cancelled && setUnitsLoading(false))
    return () => {
      cancelled = true
    }
  }, [shopId, stockSearch, enabled])

  return { customers, customersLoading, units, unitsLoading, refetchCustomers }
}
