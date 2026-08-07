import * as React from 'react'
import { toast } from 'sonner'
import { CreditCard, Fingerprint, Phone, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { INDIAN_STATE_NAMES } from '@shared/constants'
import {
  formatAadhaar,
  isValidAadhaar,
  isValidEmail,
  isValidGstin,
  isValidPan,
  isValidPhone,
  isValidPincode,
  normalizeAadhaar,
  normalizePan,
  normalizePhone,
  panHolderType
} from '@shared/validators'
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

export interface CustomerDraft {
  id?: string
  name: string
  phonePrimary: string
  phoneSecondary: string
  email: string
  aadhaar: string
  pan: string
  dob: string
  gender: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  pincode: string
  gstin: string
  customerType: string
  creditLimit: string
  notes: string
}

const EMPTY: CustomerDraft = {
  name: '',
  phonePrimary: '',
  phoneSecondary: '',
  email: '',
  aadhaar: '',
  pan: '',
  dob: '',
  gender: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  gstin: '',
  customerType: 'Retail',
  creditLimit: '0',
  notes: ''
}

type Errors = Partial<Record<keyof CustomerDraft, string>>

export function validateCustomer(d: CustomerDraft): Errors {
  const e: Errors = {}
  if (d.name.trim().length < 2) e.name = 'Enter the customer name'
  if (!isValidPhone(d.phonePrimary)) e.phonePrimary = 'Must be a 10-digit number starting 6–9'
  if (d.phoneSecondary && !isValidPhone(d.phoneSecondary))
    e.phoneSecondary = 'Must be a 10-digit number starting 6–9'
  if (
    d.phoneSecondary &&
    normalizePhone(d.phoneSecondary) === normalizePhone(d.phonePrimary)
  )
    e.phoneSecondary = 'Cannot be the same as the primary number'
  if (d.aadhaar && !isValidAadhaar(d.aadhaar)) e.aadhaar = '12 digits, checksum does not match'
  if (d.pan && !isValidPan(d.pan)) e.pan = 'Format must be ABCDE1234F'
  if (d.gstin && !isValidGstin(d.gstin)) e.gstin = 'GSTIN is not valid'
  if (d.email && !isValidEmail(d.email)) e.email = 'Enter a valid email'
  if (d.pincode && !isValidPincode(d.pincode)) e.pincode = 'PIN code must be 6 digits'
  return e
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  presetPhone
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: any
  onSaved?: (id: string) => void
  presetPhone?: string
}) {
  const [draft, setDraft] = React.useState<CustomerDraft>(EMPTY)
  const [errors, setErrors] = React.useState<Errors>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setErrors({})
    if (initial) {
      setDraft({
        id: initial.id,
        name: initial.name ?? '',
        phonePrimary: initial.phonePrimary ?? '',
        phoneSecondary: initial.phoneSecondary ?? '',
        email: initial.email ?? '',
        aadhaar: initial.aadhaar ?? '',
        pan: initial.pan ?? '',
        dob: initial.dob ?? '',
        gender: initial.gender ?? '',
        addressLine1: initial.addressLine1 ?? '',
        addressLine2: initial.addressLine2 ?? '',
        city: initial.city ?? '',
        state: initial.state ?? '',
        pincode: initial.pincode ?? '',
        gstin: initial.gstin ?? '',
        customerType: initial.customerType ?? 'Retail',
        creditLimit: String(initial.creditLimit ?? 0),
        notes: initial.notes ?? ''
      })
    } else {
      setDraft({ ...EMPTY, phonePrimary: presetPhone ?? '' })
    }
  }, [open, initial, presetPhone])

  const set = <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async () => {
    const e = validateCustomer(draft)
    setErrors(e)
    if (Object.keys(e).length) {
      toast.error('Please fix the highlighted fields')
      return
    }
    setSaving(true)
    try {
      const res = await api.customers.save({
        ...draft,
        creditLimit: Number(draft.creditLimit) || 0
      })
      toast.success(draft.id ? 'Customer updated' : 'Customer added')
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
            <UserPlus className="size-4" />
            {draft.id ? 'Edit customer' : 'New customer'}
          </DialogTitle>
          <DialogDescription>
            Mobile number is the unique key. Aadhaar and PAN are checked for a valid checksum before
            saving.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.name} className="sm:col-span-2">
              <Input
                autoFocus
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Ramesh Patil"
                invalid={!!errors.name}
              />
            </Field>

            <Field label="Primary mobile" required error={errors.phonePrimary}>
              <Input
                value={draft.phonePrimary}
                onChange={(e) => set('phonePrimary', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="98XXXXXXXX"
                inputMode="numeric"
                maxLength={10}
                prefixNode={<Phone />}
                invalid={!!errors.phonePrimary}
              />
            </Field>

            <Field label="Secondary mobile" error={errors.phoneSecondary}>
              <Input
                value={draft.phoneSecondary}
                onChange={(e) =>
                  set('phoneSecondary', e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                placeholder="Optional"
                inputMode="numeric"
                maxLength={10}
                prefixNode={<Phone />}
                invalid={!!errors.phoneSecondary}
              />
            </Field>

            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="Optional"
                invalid={!!errors.email}
              />
            </Field>

            <Field label="Customer type">
              <SimpleSelect
                value={draft.customerType}
                onChange={(v) => set('customerType', v)}
                options={['Retail', 'Dealer', 'Corporate']}
              />
            </Field>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Aadhaar number"
              error={errors.aadhaar}
              hint={
                draft.aadhaar && isValidAadhaar(draft.aadhaar) ? 'Valid Aadhaar ✓' : '12 digits'
              }
            >
              <Input
                value={formatAadhaar(draft.aadhaar)}
                onChange={(e) => set('aadhaar', normalizeAadhaar(e.target.value).slice(0, 12))}
                placeholder="XXXX XXXX XXXX"
                inputMode="numeric"
                prefixNode={<Fingerprint />}
                invalid={!!errors.aadhaar}
              />
            </Field>

            <Field
              label="PAN"
              error={errors.pan}
              hint={
                draft.pan && isValidPan(draft.pan)
                  ? `Valid PAN · ${panHolderType(draft.pan)}`
                  : 'ABCDE1234F'
              }
            >
              <Input
                value={draft.pan}
                onChange={(e) => set('pan', normalizePan(e.target.value).slice(0, 10))}
                placeholder="ABCDE1234F"
                maxLength={10}
                prefixNode={<CreditCard />}
                invalid={!!errors.pan}
                className="uppercase"
              />
            </Field>

            <Field label="Date of birth">
              <Input type="date" value={draft.dob} onChange={(e) => set('dob', e.target.value)} />
            </Field>

            <Field label="Gender">
              <SimpleSelect
                value={draft.gender}
                onChange={(v) => set('gender', v)}
                options={['Male', 'Female', 'Other']}
                placeholder="Not specified"
              />
            </Field>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Address line 1" className="sm:col-span-2">
              <Input
                value={draft.addressLine1}
                onChange={(e) => set('addressLine1', e.target.value)}
                placeholder="House / shop no., street"
              />
            </Field>
            <Field label="Address line 2" className="sm:col-span-2">
              <Input
                value={draft.addressLine2}
                onChange={(e) => set('addressLine2', e.target.value)}
                placeholder="Area, landmark"
              />
            </Field>
            <Field label="City / town">
              <Input value={draft.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field label="State">
              <Combobox
                value={draft.state}
                onChange={(v) => set('state', v)}
                options={INDIAN_STATE_NAMES.map((s) => ({ value: s, label: s }))}
                placeholder="Choose state"
                searchPlaceholder="Type a state…"
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
            <Field label="GSTIN" error={errors.gstin} hint="For dealer / corporate billing">
              <Input
                value={draft.gstin}
                onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))}
                maxLength={15}
                className="uppercase"
                invalid={!!errors.gstin}
              />
            </Field>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Credit limit (₹)"
              hint="0 means no limit check when selling on credit"
            >
              <Input
                type="number"
                min={0}
                value={draft.creditLimit}
                onChange={(e) => set('creditLimit', e.target.value)}
                className="tnum"
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                value={draft.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Anything worth remembering about this customer"
              />
            </Field>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {draft.id ? 'Save changes' : 'Add customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
