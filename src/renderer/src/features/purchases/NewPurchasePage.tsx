import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Package, Plus, ScanLine, Trash2, Truck } from 'lucide-react'
import { api } from '@/lib/api'
import { useModels, useScope, useSuppliers } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { addDays, cn, money, todayStr } from '@/lib/utils'
import { PAYMENT_MODES } from '@shared/constants'
import { imeiCheck, normalizeImei } from '@shared/validators'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Separator, Textarea } from '@/components/ui/base'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { SimpleSelect } from '@/components/ui/form'
import { EmptyState, PageHeader } from '@/components/ui/misc'
import { SupplierFormDialog } from '@/features/suppliers/SupplierFormDialog'
import { ModelFormDialog } from '@/features/catalogue/ModelFormDialog'

interface UnitDraft {
  imei1: string
  imei2: string
  serialNo: string
  color: string
  salePrice: string
}

interface LineDraft {
  key: string
  modelId: string
  modelLabel: string
  trackImei: boolean
  qty: number
  unitCost: string
  discount: string
  gstRate: string
  units: UnitDraft[]
}

const emptyUnit = (): UnitDraft => ({ imei1: '', imei2: '', serialNo: '', color: '', salePrice: '' })

export function NewPurchasePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const { shopId, shops } = useScope()

  const [supplierId, setSupplierId] = React.useState('')
  const [invoiceNo, setInvoiceNo] = React.useState('')
  const [purchaseDate, setPurchaseDate] = React.useState(todayStr())
  const [targetShop, setTargetShop] = React.useState(shopId ?? '')
  const [lines, setLines] = React.useState<LineDraft[]>([])
  const [modelSearch, setModelSearch] = React.useState('')
  const [otherCharges, setOtherCharges] = React.useState(0)
  const [billDiscount, setBillDiscount] = React.useState(0)
  const [paidAmount, setPaidAmount] = React.useState<number | ''>('')
  const [paymentMode, setPaymentMode] = React.useState('Cash')
  const [dueDate, setDueDate] = React.useState(addDays(todayStr(), 30))
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [supplierDialog, setSupplierDialog] = React.useState(false)
  const [modelDialog, setModelDialog] = React.useState(false)
  const [modelPreset, setModelPreset] = React.useState('')

  const suppliers = useSuppliers()
  const models = useModels(modelSearch)
  const invoiceRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (shopId && !targetShop) setTargetShop(shopId)
  }, [shopId, targetShop])

  /* --------------------------------------------------------------- totals */
  const computed = lines.map((l) => {
    const taxable = Number(l.unitCost) * l.qty - Number(l.discount || 0)
    const tax = (taxable * Number(l.gstRate || 0)) / 100
    return { taxable, tax, total: taxable + tax }
  })
  const subtotal = computed.reduce((a, c) => a + c.taxable, 0)
  const taxTotal = computed.reduce((a, c) => a + c.tax, 0)
  const grandTotal = Math.max(0, subtotal + taxTotal + otherCharges - billDiscount)
  const paid = paidAmount === '' ? grandTotal : Number(paidAmount)
  const due = Math.max(0, Math.round((grandTotal - paid) * 100) / 100)
  const unitCount = lines.reduce((a, l) => a + l.qty, 0)

  /* -------------------------------------------------------------- actions */
  const addModel = (model: any) => {
    setLines((ls) => [
      ...ls,
      {
        key: `${model.id}-${Date.now()}`,
        modelId: model.id,
        modelLabel: `${model.brandName} ${model.name}`,
        trackImei: model.trackImei,
        qty: 1,
        unitCost: model.defaultCost ? String(model.defaultCost) : '',
        discount: '',
        gstRate: String(model.gstRate ?? 0),
        units: [emptyUnit()]
      }
    ])
  }

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  // Accepts the raw input string so the box can be cleared / retyped. 0 (empty)
  // is allowed while typing; it's clamped up to 1 on blur. The unit rows track
  // the quantity so IMEIs can be entered per unit.
  const setQty = (key: string, raw: string) => {
    const parsed = Math.floor(Number(raw))
    const q = raw === '' || !Number.isFinite(parsed) ? 0 : Math.min(200, Math.max(0, parsed))
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l
        const units = [...l.units]
        while (units.length < q) units.push(emptyUnit())
        return { ...l, qty: q, units: units.slice(0, q) }
      })
    )
  }

  const setUnit = (key: string, index: number, patch: Partial<UnitDraft>) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? { ...l, units: l.units.map((u, i) => (i === index ? { ...u, ...patch } : u)) }
          : l
      )
    )

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key))

  const submit = async () => {
    if (!targetShop) return toast.error('Choose the shop receiving this stock')
    if (!invoiceNo.trim()) return toast.error("Enter the supplier's bill number")
    if (lines.length === 0) return toast.error('Add at least one model')

    for (const l of lines) {
      if (!Number(l.unitCost)) return toast.error(`Enter the purchase price for ${l.modelLabel}`)
      if (l.trackImei) {
        for (const [i, u] of l.units.entries()) {
          const check = imeiCheck(u.imei1)
          if (!check.ok) return toast.error(`${l.modelLabel} — unit ${i + 1}: ${check.warning}`)
        }
      }
    }

    setSaving(true)
    try {
      const res = await api.purchases.create({
        shopId: targetShop,
        supplierId: supplierId || undefined,
        invoiceNo: invoiceNo.trim(),
        purchaseDate,
        items: lines.map((l) => ({
          modelId: l.modelId,
          qty: l.qty,
          unitCost: Number(l.unitCost),
          discount: Number(l.discount || 0),
          gstRate: Number(l.gstRate || 0),
          units: l.trackImei
            ? l.units.map((u) => ({
                imei1: u.imei1,
                imei2: u.imei2 || undefined,
                serialNo: u.serialNo || undefined,
                color: u.color || undefined,
                salePrice: Number(u.salePrice) || 0
              }))
            : l.units.map((u) => ({
                serialNo: u.serialNo || undefined,
                color: u.color || undefined,
                salePrice: Number(u.salePrice) || 0
              }))
        })),
        otherCharges,
        discount: billDiscount,
        paidAmount: paid,
        paymentMode,
        dueDate: due > 0.5 ? dueDate : undefined,
        notes
      })
      toast.success(`Purchase saved — ${res.units} unit(s) added to stock`, {
        description: money(res.total)
      })
      void qc.invalidateQueries({ queryKey: ['purchases'] })
      void qc.invalidateQueries({ queryKey: ['stock'] })
      navigate('/purchases')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  useHotkey('f9', () => void submit(), {
    description: 'Save purchase',
    group: 'Purchase',
    allowInInputs: true
  })
  useHotkey('ctrl+i', () => invoiceRef.current?.focus(), {
    description: 'Focus bill number',
    group: 'Purchase',
    allowInInputs: true
  })

  const modelOptions: ComboOption[] = (models.data ?? []).map((m: any) => ({
    value: m.id,
    label: `${m.brandName} ${m.name}`,
    hint: `${m.sku}${m.storage ? ` · ${m.storage}` : ''}`,
    meta: `${m.inStock} in stock`,
    group: m.brandName,
    keywords: [m.sku],
    data: m
  }))

  const supplierOptions: ComboOption[] = (suppliers.data ?? []).map((s: any) => ({
    value: s.id,
    label: s.name,
    hint: [s.phone, s.city].filter(Boolean).join(' · '),
    meta: s.payable > 0 ? money(s.payable) : undefined
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="New purchase"
        description="Enter the supplier bill and every IMEI — each handset becomes a tracked stock unit"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/purchases')}>
              All purchases
            </Button>
            <Button size="sm" onClick={() => void submit()} loading={saving}>
              <Check /> Save purchase <span className="kbd ml-1">F9</span>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Supplier" className="lg:col-span-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Combobox
                      value={supplierId}
                      onChange={setSupplierId}
                      options={supplierOptions}
                      placeholder="Choose supplier / distributor"
                      searchPlaceholder="Name, phone or city…"
                      clearable
                      onCreate={() => setSupplierDialog(true)}
                      createLabel="Add supplier"
                    />
                  </div>
                  <Button variant="outline" size="icon" onClick={() => setSupplierDialog(true)}>
                    <Plus />
                  </Button>
                </div>
              </Field>

              <Field label="Supplier bill no." required>
                <Input
                  ref={invoiceRef}
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="As printed on their invoice"
                />
              </Field>

              <Field label="Bill date">
                <Input
                  type="date"
                  value={purchaseDate}
                  max={todayStr()}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </Field>

              <Field label="Stock goes to" required className="lg:col-span-2">
                <SimpleSelect
                  value={targetShop}
                  onChange={setTargetShop}
                  options={shops.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                  placeholder="Choose shop"
                />
              </Field>

              <Field label="Add model" className="lg:col-span-2">
                <Combobox
                  value={null}
                  onChange={(_v, option) => option?.data && addModel(option.data)}
                  options={modelOptions}
                  onSearchChange={setModelSearch}
                  loading={models.isFetching}
                  placeholder="Search a model to add"
                  searchPlaceholder="Brand, model or SKU…"
                  onCreate={(text) => {
                    setModelPreset(text)
                    setModelDialog(true)
                  }}
                  createLabel="Create model"
                />
              </Field>
            </CardContent>
          </Card>

          {lines.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No models on this bill yet"
              description="Search for a model above. If it is new, type its name and choose “Create model”."
            />
          ) : (
            <div className="space-y-3">
              {lines.map((line, li) => (
                <Card key={line.key}>
                  <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
                    <CardTitle className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                        {li + 1}
                      </span>
                      {line.modelLabel}
                      {!line.trackImei && <Badge variant="muted">No IMEI</Badge>}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Field label="Quantity">
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={line.qty === 0 ? '' : line.qty}
                          onChange={(e) => setQty(line.key, e.target.value)}
                          onBlur={() => line.qty < 1 && setQty(line.key, '1')}
                          className="text-right tnum"
                        />
                      </Field>
                      <Field label="Cost per unit ₹" required>
                        <Input
                          type="number"
                          min={0}
                          value={line.unitCost}
                          onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                          className="text-right tnum"
                        />
                      </Field>
                      <Field label="Line discount ₹">
                        <Input
                          type="number"
                          min={0}
                          value={line.discount}
                          onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                          className="text-right tnum"
                        />
                      </Field>
                      <Field label="GST %">
                        <Input
                          type="number"
                          min={0}
                          value={line.gstRate}
                          onChange={(e) => updateLine(line.key, { gstRate: e.target.value })}
                          className="text-right tnum"
                        />
                      </Field>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {line.trackImei ? 'IMEI of each handset' : 'Unit details'}
                      </p>
                      <div className="space-y-2">
                        {line.units.map((u, ui) => {
                          const check = line.trackImei && u.imei1 ? imeiCheck(u.imei1) : null
                          return (
                            <div key={ui} className="grid gap-2 sm:grid-cols-[28px_1fr_1fr_130px_120px]">
                              <span className="flex h-9 items-center justify-center text-xs text-muted-foreground">
                                {ui + 1}
                              </span>
                              {line.trackImei ? (
                                <>
                                  <Input
                                    value={u.imei1}
                                    onChange={(e) =>
                                      setUnit(line.key, ui, {
                                        imei1: normalizeImei(e.target.value).slice(0, 15)
                                      })
                                    }
                                    placeholder="IMEI 1 (15 digits)"
                                    className={cn(
                                      'font-mono',
                                      check && !check.ok && 'border-destructive',
                                      check?.warning && check.ok && 'border-warning'
                                    )}
                                    inputMode="numeric"
                                    prefixNode={<ScanLine />}
                                  />
                                  <Input
                                    value={u.imei2}
                                    onChange={(e) =>
                                      setUnit(line.key, ui, {
                                        imei2: normalizeImei(e.target.value).slice(0, 15)
                                      })
                                    }
                                    placeholder="IMEI 2 (optional)"
                                    className="font-mono"
                                    inputMode="numeric"
                                  />
                                </>
                              ) : (
                                <>
                                  <Input
                                    value={u.serialNo}
                                    onChange={(e) => setUnit(line.key, ui, { serialNo: e.target.value })}
                                    placeholder="Serial no. (optional)"
                                  />
                                  <span />
                                </>
                              )}
                              <Input
                                value={u.color}
                                onChange={(e) => setUnit(line.key, ui, { color: e.target.value })}
                                placeholder="Colour"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={u.salePrice}
                                onChange={(e) => setUnit(line.key, ui, { salePrice: e.target.value })}
                                placeholder="Sell ₹"
                                className="text-right tnum"
                              />
                            </div>
                          )
                        })}
                      </div>
                      {line.trackImei && (
                        <p className="text-xs text-muted-foreground">
                          Scanners type straight into these boxes. A warning border means the
                          checksum is unusual — the IMEI is still accepted.
                        </p>
                      )}
                    </div>

                    <Separator />
                    <div className="flex justify-end gap-6 text-[13px]">
                      <span className="text-muted-foreground">
                        Taxable <span className="font-medium tnum text-foreground">{money(computed[li]?.taxable)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        GST <span className="font-medium tnum text-foreground">{money(computed[li]?.tax)}</span>
                      </span>
                      <span className="font-semibold tnum">{money(computed[li]?.total)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- summary */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4" /> Bill summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5 text-[13px]">
                <Row label={`Units (${unitCount})`} value={money(subtotal)} />
                <Row label="GST" value={money(taxTotal)} />
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Bill discount</span>
                  <Input
                    type="number"
                    min={0}
                    value={billDiscount || ''}
                    onChange={(e) => setBillDiscount(Number(e.target.value) || 0)}
                    className="h-7 w-28 text-right tnum"
                  />
                </div>
              </div>

              <Separator />

              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Total</span>
                <span className="text-2xl font-semibold tnum">{money(grandTotal)}</span>
              </div>

              <Field label="Amount paid now" hint="Leave blank if fully paid">
                <Input
                  type="number"
                  min={0}
                  max={grandTotal}
                  value={paidAmount}
                  onChange={(e) =>
                    setPaidAmount(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  placeholder={String(grandTotal)}
                  className="text-right text-lg font-semibold tnum"
                />
              </Field>

              <Field label="Payment mode">
                <SimpleSelect value={paymentMode} onChange={setPaymentMode} options={[...PAYMENT_MODES]} />
              </Field>

              {due > 0.5 && (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-warning">Payable to supplier</span>
                    <span className="font-semibold tnum">{money(due)}</span>
                  </div>
                  <Field label="Pay by">
                    <Input
                      type="date"
                      value={dueDate}
                      min={purchaseDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              <Field label="Notes">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[52px]"
                  placeholder="Optional"
                />
              </Field>

              <Button className="w-full" onClick={() => void submit()} loading={saving}>
                <Check /> Save purchase
                <span className="kbd ml-1">F9</span>
              </Button>
            </CardContent>
          </Card>

          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Other charges and bill discount are spread evenly across every unit, so the cost price
            stored against each handset is its true landed cost. That keeps per-handset profit
            honest.
          </p>
        </div>
      </div>

      <SupplierFormDialog
        open={supplierDialog}
        onOpenChange={setSupplierDialog}
        onSaved={(id) => {
          setSupplierId(id)
          void suppliers.refetch()
        }}
      />

      <ModelFormDialog
        open={modelDialog}
        onOpenChange={setModelDialog}
        presetName={modelPreset}
        onSaved={() => void models.refetch()}
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
