import * as React from 'react'
import { toast } from 'sonner'
import { Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { PAYMENT_MODES } from '@shared/constants'
import { addDays, formatDate, money, todayStr } from '@/lib/utils'
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

export function RecordPaymentDialog({
  sale,
  onOpenChange,
  onSaved
}: {
  sale: any | null
  onOpenChange: (v: boolean) => void
  onSaved?: () => void
}) {
  const [amount, setAmount] = React.useState<number | ''>('')
  const [mode, setMode] = React.useState('Cash')
  const [date, setDate] = React.useState(todayStr())
  const [reference, setReference] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [newDueDate, setNewDueDate] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (sale) {
      setAmount(sale.dueAmount)
      setMode('Cash')
      setDate(todayStr())
      setReference('')
      setNotes('')
      setNewDueDate(addDays(todayStr(), 7))
    }
  }, [sale])

  if (!sale) return null

  const value = Number(amount) || 0
  const remaining = Math.max(0, Math.round((sale.dueAmount - value) * 100) / 100)

  const submit = async () => {
    setSaving(true)
    try {
      const res = await api.sales.recordPayment({
        saleId: sale.id,
        amount: value,
        paymentDate: date,
        mode,
        reference,
        notes,
        newDueDate: remaining > 0.5 ? newDueDate : undefined
      })
      toast.success(
        res.cleared
          ? `${sale.invoiceNo} fully settled`
          : `${money(value)} received · ${money(res.due)} still due`
      )
      onSaved?.()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(sale)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-4" /> Record payment
          </DialogTitle>
          <DialogDescription>
            {sale.customerName} · {sale.invoiceNo} · promised {formatDate(sale.dueDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-muted-foreground">Outstanding</span>
              <span className="text-xl font-semibold tnum">{money(sale.dueAmount)}</span>
            </div>
          </div>

          <Field label="Amount received" required>
            <Input
              autoFocus
              type="number"
              min={0}
              max={sale.dueAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className="h-10 text-right text-lg font-semibold tnum"
            />
          </Field>

          <div className="flex gap-1.5">
            {[0.25, 0.5, 1].map((f) => (
              <Button
                key={f}
                variant="outline"
                size="xs"
                className="flex-1"
                onClick={() => setAmount(Math.round(sale.dueAmount * f))}
              >
                {f === 1 ? 'Full' : `${f * 100}%`}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode">
              <SimpleSelect value={mode} onChange={setMode} options={[...PAYMENT_MODES]} />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Reference" hint="UPI ref, cheque no. — optional">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>

          {remaining > 0.5 && (
            <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-warning">Still outstanding after this</span>
                <span className="font-semibold tnum">{money(remaining)}</span>
              </div>
              <Field label="New promised date">
                <Input
                  type="date"
                  value={newDueDate}
                  min={date}
                  onChange={(e) => setNewDueDate(e.target.value)}
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={value <= 0}>
            Record {money(value)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
