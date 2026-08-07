import * as React from 'react'
import { toast } from 'sonner'
import { Building2, Store } from 'lucide-react'
import { api } from '@/lib/api'
import { INDIAN_STATE_NAMES } from '@shared/constants'
import { isValidGstin, isValidPan, isValidPhone, isValidPincode } from '@shared/validators'
import { Button, Field, Input, Textarea } from '@/components/ui/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Switch } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

/* -------------------------------------------------------------------------- */

const EMPTY_COMPANY = {
  name: '',
  legalName: '',
  gstin: '',
  pan: '',
  phone: '',
  email: '',
  addressLine1: '',
  city: '',
  state: '',
  pincode: '',
  invoicePrefix: 'INV',
  terms: '',
  fyStartMonth: '4',
  isActive: true
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: any
  onSaved?: () => void
}) {
  const [draft, setDraft] = React.useState<any>(EMPTY_COMPANY)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setDraft(
      initial
        ? { ...EMPTY_COMPANY, ...initial, fyStartMonth: String(initial.fyStartMonth ?? 4) }
        : EMPTY_COMPANY
    )
  }, [open, initial])

  const set = (k: string, v: any) => {
    setDraft((d: any) => ({ ...d, [k]: v }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }

  const submit = async () => {
    const e: Record<string, string> = {}
    if (draft.name.trim().length < 2) e.name = 'Company name is required'
    if (draft.gstin && !isValidGstin(draft.gstin)) e.gstin = 'GSTIN is not valid'
    if (draft.pan && !isValidPan(draft.pan)) e.pan = 'PAN is not valid'
    if (draft.phone && !isValidPhone(draft.phone)) e.phone = '10-digit number starting 6–9'
    if (draft.pincode && !isValidPincode(draft.pincode)) e.pincode = 'PIN code must be 6 digits'
    setErrors(e)
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields')

    setSaving(true)
    try {
      await api.companies.save({ ...draft, fyStartMonth: Number(draft.fyStartMonth) })
      toast.success(draft.id ? 'Company updated' : 'Company created')
      onSaved?.()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-4" />
            {draft.id ? 'Edit company' : 'New company'}
          </DialogTitle>
          <DialogDescription>
            A separate business with its own stock, customers, invoicing and reports.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 grid flex-1 gap-4 overflow-y-auto px-1 sm:grid-cols-2">
          <Field label="Trading name" required error={errors.name}>
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              invalid={!!errors.name}
            />
          </Field>
          <Field label="Legal name" hint="As registered, if different">
            <Input value={draft.legalName} onChange={(e) => set('legalName', e.target.value)} />
          </Field>
          <Field label="GSTIN" error={errors.gstin}>
            <Input
              value={draft.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))}
              className="uppercase"
              maxLength={15}
              invalid={!!errors.gstin}
            />
          </Field>
          <Field label="PAN" error={errors.pan}>
            <Input
              value={draft.pan}
              onChange={(e) => set('pan', e.target.value.toUpperCase().slice(0, 10))}
              className="uppercase"
              maxLength={10}
              invalid={!!errors.pan}
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <Input
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              maxLength={10}
              invalid={!!errors.phone}
            />
          </Field>
          <Field label="Email">
            <Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={draft.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={draft.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State">
            <Combobox
              value={draft.state}
              onChange={(v) => set('state', v)}
              options={INDIAN_STATE_NAMES.map((s) => ({ value: s, label: s }))}
              placeholder="Choose state"
              clearable
            />
          </Field>
          <Field label="PIN code" error={errors.pincode}>
            <Input
              value={draft.pincode}
              onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              invalid={!!errors.pincode}
            />
          </Field>
          <Field label="Invoice prefix" hint="Appears in every bill number">
            <Input
              value={draft.invoicePrefix}
              onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase().slice(0, 8))}
              className="uppercase"
            />
          </Field>
          <Field label="Financial year starts" className="sm:col-span-2">
            <SimpleSelect
              value={draft.fyStartMonth}
              onChange={(v) => set('fyStartMonth', v)}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          </Field>
          <Field label="Invoice terms" className="sm:col-span-2" hint="Printed at the bottom of every bill">
            <Textarea value={draft.terms} onChange={(e) => set('terms', e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <p className="text-[13px] font-medium">Company active</p>
            <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {draft.id ? 'Save changes' : 'Create company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

const EMPTY_SHOP = {
  companyId: '',
  name: '',
  code: '',
  phone: '',
  email: '',
  addressLine1: '',
  city: '',
  state: '',
  pincode: '',
  gstin: '',
  invoicePrefix: '',
  isActive: true
}

export function ShopFormDialog({
  open,
  onOpenChange,
  initial,
  companies,
  onSaved
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: any
  companies: any[]
  onSaved?: () => void
}) {
  const [draft, setDraft] = React.useState<any>(EMPTY_SHOP)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setDraft(
      initial ? { ...EMPTY_SHOP, ...initial } : { ...EMPTY_SHOP, companyId: companies[0]?.id ?? '' }
    )
  }, [open, initial, companies])

  const set = (k: string, v: any) => {
    setDraft((d: any) => ({ ...d, [k]: v }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }

  const submit = async () => {
    const e: Record<string, string> = {}
    if (!draft.companyId) e.companyId = 'Choose the company this shop belongs to'
    if (draft.name.trim().length < 2) e.name = 'Shop name is required'
    if (!/^[A-Za-z0-9-]{1,8}$/.test(draft.code)) e.code = '1–8 characters: A–Z, 0–9, dash'
    if (draft.gstin && !isValidGstin(draft.gstin)) e.gstin = 'GSTIN is not valid'
    if (draft.phone && !isValidPhone(draft.phone)) e.phone = '10-digit number starting 6–9'
    setErrors(e)
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields')

    setSaving(true)
    try {
      await api.shops.save(draft)
      toast.success(draft.id ? 'Shop updated' : 'Shop created')
      onSaved?.()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="size-4" />
            {draft.id ? 'Edit shop' : 'New shop'}
          </DialogTitle>
          <DialogDescription>
            Stock, sales and profit are tracked separately for every shop.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 grid flex-1 gap-4 overflow-y-auto px-1 sm:grid-cols-2">
          <Field label="Company" required error={errors.companyId} className="sm:col-span-2">
            <SimpleSelect
              value={draft.companyId}
              onChange={(v) => set('companyId', v)}
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Choose company"
              invalid={!!errors.companyId}
            />
          </Field>
          <Field label="Shop name" required error={errors.name}>
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Shop 3 — Station Road"
              invalid={!!errors.name}
            />
          </Field>
          <Field label="Short code" required error={errors.code} hint="Used in bill numbers, e.g. S3">
            <Input
              value={draft.code}
              onChange={(e) => set('code', e.target.value.toUpperCase().slice(0, 8))}
              className="uppercase"
              maxLength={8}
              invalid={!!errors.code}
            />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <Input
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              maxLength={10}
              invalid={!!errors.phone}
            />
          </Field>
          <Field label="Email">
            <Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={draft.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={draft.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State">
            <Combobox
              value={draft.state}
              onChange={(v) => set('state', v)}
              options={INDIAN_STATE_NAMES.map((s) => ({ value: s, label: s }))}
              placeholder="Choose state"
              clearable
            />
          </Field>
          <Field label="PIN code">
            <Input
              value={draft.pincode}
              onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
            />
          </Field>
          <Field label="GSTIN" error={errors.gstin} hint="If this shop bills under its own GSTIN">
            <Input
              value={draft.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))}
              className="uppercase"
              maxLength={15}
              invalid={!!errors.gstin}
            />
          </Field>
          <Field label="Invoice prefix" hint="Defaults to the shop code" className="sm:col-span-2">
            <Input
              value={draft.invoicePrefix}
              onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase().slice(0, 8))}
              className="uppercase"
              placeholder={draft.code}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <div>
              <p className="text-[13px] font-medium">Shop open</p>
              <p className="text-xs text-muted-foreground">
                A shop holding stock cannot be closed — move the stock first.
              </p>
            </div>
            <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {draft.id ? 'Save changes' : 'Create shop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
