import * as React from 'react'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { api } from '@/lib/api'
import { INDIAN_STATE_NAMES } from '@shared/constants'
import { isValidGstin, isValidPan, isValidPhone, isValidPincode, normalizeGstin, normalizePan } from '@shared/validators'
import { Button, Field, Input, Textarea } from '@/components/ui/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'

const EMPTY = {
  name: '',
  contactPerson: '',
  phone: '',
  altPhone: '',
  email: '',
  gstin: '',
  pan: '',
  supplierType: 'Distributor',
  addressLine1: '',
  city: '',
  state: '',
  pincode: '',
  openingBalance: '0',
  notes: ''
}

export function SupplierFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: any
  onSaved?: (id: string) => void
}) {
  const [draft, setDraft] = React.useState<any>(EMPTY)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setErrors({})
    setDraft(
      initial
        ? { ...EMPTY, ...initial, openingBalance: String(initial.openingBalance ?? 0) }
        : EMPTY
    )
  }, [open, initial])

  const set = (key: string, value: string) => {
    setDraft((d: any) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [key]: '' }))
  }

  const submit = async () => {
    const e: Record<string, string> = {}
    if (draft.name.trim().length < 2) e.name = 'Supplier name is required'
    if (draft.phone && !isValidPhone(draft.phone)) e.phone = '10-digit number starting 6–9'
    if (draft.altPhone && !isValidPhone(draft.altPhone)) e.altPhone = '10-digit number starting 6–9'
    if (draft.gstin && !isValidGstin(draft.gstin)) e.gstin = 'GSTIN is not valid'
    if (draft.pan && !isValidPan(draft.pan)) e.pan = 'Format must be ABCDE1234F'
    if (draft.pincode && !isValidPincode(draft.pincode)) e.pincode = 'PIN code must be 6 digits'
    setErrors(e)
    if (Object.keys(e).length) return toast.error('Please fix the highlighted fields')

    setSaving(true)
    try {
      const res = await api.suppliers.save({
        ...draft,
        openingBalance: Number(draft.openingBalance) || 0
      })
      toast.success(draft.id ? 'Supplier updated' : 'Supplier added')
      onSaved?.(res.id)
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
            {draft.id ? 'Edit supplier' : 'New supplier'}
          </DialogTitle>
          <DialogDescription>
            Companies and distributors you buy handsets from.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 grid flex-1 gap-4 overflow-y-auto px-1 sm:grid-cols-2">
          <Field label="Supplier name" required error={errors.name} className="sm:col-span-2">
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Shree Telecom Distributors"
              invalid={!!errors.name}
            />
          </Field>

          <Field label="Type">
            <SimpleSelect
              value={draft.supplierType}
              onChange={(v) => set('supplierType', v)}
              options={['Distributor', 'Company / Brand', 'Dealer', 'Individual', 'Other']}
            />
          </Field>

          <Field label="Contact person">
            <Input value={draft.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
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

          <Field label="Alternate phone" error={errors.altPhone}>
            <Input
              value={draft.altPhone}
              onChange={(e) => set('altPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              maxLength={10}
              invalid={!!errors.altPhone}
            />
          </Field>

          <Field label="Email">
            <Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
          </Field>

          <Field label="GSTIN" error={errors.gstin}>
            <Input
              value={draft.gstin}
              onChange={(e) => set('gstin', normalizeGstin(e.target.value).slice(0, 15))}
              maxLength={15}
              className="uppercase"
              invalid={!!errors.gstin}
            />
          </Field>

          <Field label="PAN" error={errors.pan}>
            <Input
              value={draft.pan}
              onChange={(e) => set('pan', normalizePan(e.target.value).slice(0, 10))}
              maxLength={10}
              className="uppercase"
              invalid={!!errors.pan}
            />
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

          <Field label="Opening balance ₹" hint="Amount already payable to them">
            <Input
              type="number"
              value={draft.openingBalance}
              onChange={(e) => set('openingBalance', e.target.value)}
              className="text-right tnum"
            />
          </Field>

          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {draft.id ? 'Save changes' : 'Add supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
