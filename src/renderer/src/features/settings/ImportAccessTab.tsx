import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileUp,
  FolderOpen,
  Info,
  Loader2,
  ShieldCheck
} from 'lucide-react'
import { api } from '@/lib/api'
import { useScope } from '@/lib/hooks'
import { money } from '@/lib/utils'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field
} from '@/components/ui/base'
import { DataTable } from '@/components/ui/data-table'
import { SimpleSelect } from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'

interface Preview {
  fileName: string
  stats: any
  warnings: Array<{ level: string; code: string; ref?: string; message: string }>
  sampleLoans: any[]
}

export function ImportAccessTab() {
  const qc = useQueryClient()
  const { shops, shopId: activeShopId } = useScope()

  const [filePath, setFilePath] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [shopId, setShopId] = React.useState<string>('')
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  React.useEffect(() => {
    if (!shopId) setShopId(activeShopId ?? shops[0]?.id ?? '')
  }, [activeShopId, shops, shopId])

  const reset = () => {
    setFilePath(null)
    setPreview(null)
    setResult(null)
  }

  const chooseFile = async () => {
    const { filePath: picked } = await api.import.pickAccessFile()
    if (!picked) return
    setFilePath(picked)
    setPreview(null)
    setResult(null)
    setPreviewing(true)
    try {
      const p = await api.import.previewAccess(picked)
      setPreview(p)
    } catch (err: any) {
      toast.error(err.message ?? 'Could not read that file')
      setFilePath(null)
    } finally {
      setPreviewing(false)
    }
  }

  const runImport = async () => {
    if (!filePath) return
    setImporting(true)
    try {
      const res = await api.import.runAccess(filePath, shopId || undefined)
      setResult(res)
      setConfirmOpen(false)
      toast.success(`Imported ${res.loansToInsert} loans and ${res.customersToInsert} customers`)
      // Everything downstream needs to re-read.
      void qc.invalidateQueries()
    } catch (err: any) {
      toast.error(err.message ?? 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const s = preview?.stats
  const shopOptions = shops.map((sh: any) => ({ value: sh.id, label: `${sh.name} (${sh.code})` }))

  /* ------------------------------------------------------------- result view */
  if (result) {
    return (
      <div className="space-y-4">
        <Card className="border-success/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" /> Import complete
            </CardTitle>
            <CardDescription>
              Brought in from <span className="font-medium">{result.fileName}</span>. Nothing that was
              already in the app was changed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Customers added" value={result.customersToInsert} />
              <Stat label="Existing customers reused" value={result.customersMatchedExisting} />
              <Stat label="Loans imported" value={result.loansToInsert} />
              <Stat label="Loans skipped (already there)" value={result.loansSkippedExisting} />
              <Stat label="Active" value={result.active} />
              <Stat label="Closed" value={result.closed} />
              <Stat label="Foreclosed" value={result.foreclosed} />
              <Stat label="Outstanding" value={money(result.totalOutstanding)} />
            </div>
            {result.warnings?.length > 0 && <WarningList warnings={result.warnings} />}
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------- main view */
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" /> Import from the old Access database
          </CardTitle>
          <CardDescription>
            Brings your previous EMI customers, loans and repayment history into Krishna Mobile. It
            only <span className="font-medium">adds</span> records — it never edits or deletes
            anything already here, so it is safe to run again if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void chooseFile()} disabled={previewing}>
              <FolderOpen /> Choose .accdb file…
            </Button>
            {filePath && (
              <span className="truncate text-[13px] text-muted-foreground" title={filePath}>
                {preview?.fileName ?? filePath}
              </span>
            )}
            {previewing && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Product/stock records are <span className="font-medium">not</span> imported — the old
            catalogue was not detailed enough to link to tracked stock. Each imported loan keeps its
            brand and model as plain text, exactly like a direct sale.
          </p>
        </CardContent>
      </Card>

      {s && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What will be imported</CardTitle>
              <CardDescription>Read from the file — nothing has been saved yet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <Stat label="Customers to add" value={s.customersToInsert} hint={`${s.customersInFile} in file`} />
                <Stat label="Reused (mobile matches)" value={s.customersMatchedExisting} />
                <Stat label="Loans to import" value={s.loansToInsert} hint={`${s.loansInFile} in file`} />
                <Stat label="Loans already imported" value={s.loansSkippedExisting} />
                <Stat label="Active" value={s.active} />
                <Stat label="Closed" value={s.closed} />
                <Stat label="Foreclosed" value={s.foreclosed} />
                <Stat label="Repayment rows read" value={s.repaymentsInFile} />
                <Stat label="Total financed" value={money(s.totalFinanced)} />
                <Stat label="Total payable" value={money(s.totalPayable)} />
                <Stat label="Still outstanding" value={money(s.totalOutstanding)} />
                <Stat label="Penalty collected" value={money(s.penaltyCollected)} />
              </div>

              <Field label="Attach these loans to shop" hint="The old system had a single shop; pick where these belong now.">
                <SimpleSelect
                  value={shopId}
                  onChange={setShopId}
                  options={shopOptions}
                />
              </Field>

              {preview.warnings.length > 0 && <WarningList warnings={preview.warnings} />}

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={() => setConfirmOpen(true)} disabled={!shopId || s.loansToInsert === 0}>
                  <FileUp /> Import {s.loansToInsert} loans
                </Button>
                <Button variant="outline" onClick={reset}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>

          {preview.sampleLoans.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview — first {preview.sampleLoans.length} loans</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  rows={preview.sampleLoans}
                  rowKey={(l: any) => l.loanNo}
                  columns={[
                    { key: 'loanNo', header: 'Loan #', render: (l: any) => <span className="font-mono text-xs">{l.loanNo}</span> },
                    { key: 'customerName', header: 'Customer', render: (l: any) => <span className="font-medium">{l.customerName}</span> },
                    { key: 'product', header: 'Product', hideBelow: 'md' },
                    { key: 'tenure', header: 'Tenure', align: 'right', render: (l: any) => `${l.tenure} mo` },
                    { key: 'monthlyEmi', header: 'EMI', align: 'right', render: (l: any) => money(l.monthlyEmi) },
                    { key: 'totalPayable', header: 'Payable', align: 'right', render: (l: any) => money(l.totalPayable) },
                    { key: 'paid', header: 'Paid', align: 'right', render: (l: any) => money(l.paid) },
                    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (l: any) => money(l.outstanding) },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (l: any) => (
                        <Badge variant={l.status === 'ACTIVE' ? 'info' : l.status === 'FORECLOSED' ? 'warning' : 'success'}>
                          {l.status}
                        </Badge>
                      )
                    }
                  ]}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Import into Krishna Mobile?</DialogTitle>
            <DialogDescription>
              {s?.customersToInsert} customers and {s?.loansToInsert} loans (with their full EMI
              schedules) will be added to{' '}
              <span className="font-medium">
                {shops.find((sh: any) => sh.id === shopId)?.name ?? 'the selected shop'}
              </span>
              . This does not change or remove anything already in the app.
            </DialogDescription>
          </DialogHeader>
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            A copy of everything stays in your Access file — this is a one-way copy in, not a move.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={() => void runImport()} loading={importing}>
              Yes, import now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-lg font-semibold tnum">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

function WarningList({ warnings }: { warnings: Array<{ code: string; message: string }> }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-warning">
        <AlertTriangle className="size-3.5" /> {warnings.length} thing(s) to be aware of
      </p>
      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
        {warnings.map((w, i) => (
          <li key={i}>• {w.message}</li>
        ))}
      </ul>
    </div>
  )
}
