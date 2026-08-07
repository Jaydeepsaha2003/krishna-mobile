import * as React from 'react'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useSession } from '@/store/session'
import { pinIssue } from '@shared/validators'
import { Button, Field } from '@/components/ui/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { PinInput } from '@/components/ui/misc'

export function ChangePinDialog({
  open,
  onOpenChange,
  forced
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  forced?: boolean
}) {
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    setError(null)
    const issue = pinIssue(next)
    if (issue) return setError(issue)
    if (next !== confirm) return setError('The two new PINs do not match.')

    setSaving(true)
    try {
      await api.auth.changePin(current, next)
      useSession.setState({ mustChangePin: false })
      toast.success('Your login PIN has been changed')
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={forced ? undefined : onOpenChange}>
      <DialogContent size="sm" hideClose={forced}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> Change login PIN
          </DialogTitle>
          <DialogDescription>
            {forced
              ? 'Please set your own 6-digit PIN before you continue.'
              : 'Your PIN is 6 digits and is asked every time you open the app.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Current PIN">
            <PinInput value={current} onChange={setCurrent} autoFocus />
          </Field>
          <Field label="New PIN">
            <PinInput value={next} onChange={setNext} />
          </Field>
          <Field label="Confirm new PIN" error={error}>
            <PinInput value={confirm} onChange={setConfirm} onComplete={() => void submit()} />
          </Field>
        </div>

        <DialogFooter>
          {!forced && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          <Button onClick={() => void submit()} loading={saving}>
            Save new PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
