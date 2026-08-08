import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Ban,
  Check,
  Download,
  HandCoins,
  Lock,
  Search,
  Wallet
} from 'lucide-react'
import { api } from '@/lib/api'
import { useCsvExport } from '@/lib/hooks'
import { useSession } from '@/store/session'
import { useHotkey } from '@/lib/hotkeys'
import { cn, formatDate, money, todayStr } from '@/lib/utils'
import { LOAN_STATUS_LABELS, PAYMENT_MODES } from '@shared/constants'
import { Badge, Button, Card, CardContent, Field, Input, Separator, Textarea } from '@/components/ui/base'
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/overlay'
import { SimpleSelect, Switch } from '@/components/ui/form'
import { Combobox, type ComboOption } from '@/components/ui/combobox'
import { EmptyState, Money, PageHeader, StatCard } from '@/components/ui/misc'

export function LoanRepaymentPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const session = useSession()
  const exportCsv = useCsvExport()

  const [jumpSearch, setJumpSearch] = React.useState('')
  const [selectedRow, setSelectedRow] = React.useState<any>(null)
  const [amount, setAmount] = React.useState<number | ''>('')
  const [penalty, setPenalty] = React.useState<number | ''>('')
  const [penaltyPaid, setPenaltyPaid] = React.useState(false)
  const [mode, setMode] = React.useState('Cash')
  const [remarks, setRemarks] = React.useState('')
  const [repayDate, setRepayDate] = React.useState(todayStr())
  const [saving, setSaving] = React.useState(false)
  const [forecloseOpen, setForecloseOpen] = React.useState(false)
  const [settlement, setSettlement] = React.useState<number | ''>('')
  const [cancelOpen, setCancelOpen] = React.useState(false)

  const detail = useQuery({
    queryKey: ['loan-detail', id],
    queryFn: () => api.loans.get(id!),
    enabled: Boolean(id)
  })

  const jumpResults = useQuery({
    queryKey: ['loan-jump', jumpSearch],
    queryFn: () => api.loans.search(jumpSearch, false),
    enabled: jumpSearch.trim().length > 1
  })

  const loan = detail.data?.loan
  const schedule = detail.data?.schedule ?? []
  const nextDue = React.useMemo(
    () => schedule.find((r: any) => r.status === 'PENDING' || r.status === 'PARTIAL'),
    [schedule]
  )
  const remainingBalance = React.useMemo(
    () => schedule.reduce((a: number, r: any) => a + (r.status === 'PAID' ? 0 : r.balance), 0),
    [schedule]
  )

  React.useEffect(() => {
    if (!detail.data) return
    const target = selectedRow
      ? schedule.find((r: any) => r.id === selectedRow.id)
      : nextDue
    setSelectedRow(target ?? null)
    setAmount(target ? target.balance : '')
    setPenalty(target?.overdueDays > 0 ? detail.data.defaultPenalty : '')
    setPenaltyPaid(false)
    setMode('Cash')
    setRemarks('')
    setRepayDate(todayStr())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data])

  React.useEffect(() => {
    if (loan) setSettlement(remainingBalance)
  }, [loan, remainingBalance])

  useHotkey('escape', () => navigate('/loans'), { description: 'Back to loans', group: 'EMI' })

  const pickInstallment = (row: any) => {
    setSelectedRow(row)
    setAmount(row.balance)
    setPenalty(row.overdueDays > 0 ? (detail.data?.defaultPenalty ?? 0) : 0)
  }

  const submitPayment = async () => {
    if (!loan || !selectedRow) return
    const amt = Number(amount) || 0
    if (amt <= 0) return toast.error('Enter an amount greater than zero')
    setSaving(true)
    try {
      const res = await api.loans.repay({
        loanId: loan.id,
        repaymentId: selectedRow.id,
        repayDate,
        actualEmiPaid: amt,
        penaltyAmount: Number(penalty) || 0,
        isPenaltyPaid: penaltyPaid,
        paymentMode: mode,
        remarks
      })
      toast.success(`EMI #${res.emiNo} ${res.status === 'PAID' ? 'fully paid' : 'partially paid'} — ₹${res.paidNow} received`)
      void qc.invalidateQueries({ queryKey: ['loan-detail', id] })
      void qc.invalidateQueries({ queryKey: ['loans'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const submitForeclose = async () => {
    if (!loan) return
    try {
      await api.loans.foreclose({
        loanId: loan.id,
        settlementAmount: Number(settlement) || 0,
        repayDate: todayStr(),
        paymentMode: mode,
        remarks
      })
      toast.success(`${loan.loanNo} foreclosed and closed`)
      setForecloseOpen(false)
      void qc.invalidateQueries({ queryKey: ['loan-detail', id] })
      void qc.invalidateQueries({ queryKey: ['loans'] })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const cancelLoan = async (reason: string) => {
    if (!loan) return
    try {
      await api.loans.cancel(loan.id, reason)
      toast.success('Loan cancelled')
      navigate('/loans')
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const jumpOptions: ComboOption[] = (jumpResults.data ?? []).map((l: any) => ({
    value: l.id,
    label: `${l.loanNo} — ${l.customerName}`,
    hint: `${[l.brand, l.modelName].filter(Boolean).join(' ')} · ${money(l.currentOutstanding)} due`
  }))

  if (!id) {
    return (
      <EmptyState
        icon={HandCoins}
        title="Choose a loan"
        description="Open a loan from the EMI Loans list to record a repayment."
      />
    )
  }

  if (detail.isLoading || !loan) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Loading…</div>
  }

  const locked = loan.status !== 'ACTIVE'

  return (
    <div className="space-y-4">
      <PageHeader
        title={loan.loanNo}
        description={`${loan.customerName} · ${[loan.brand, loan.modelName].filter(Boolean).join(' ') || 'No product linked'}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/loans')}>
              <ArrowLeft /> All loans
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void exportCsv(
                  `${loan.loanNo}-schedule`,
                  schedule.map((r: any) => ({
                    emiNo: r.emiNo,
                    dueDate: r.dueDate,
                    scheduledEmi: r.scheduledEmi,
                    paid: r.actualEmiPaid,
                    balance: r.balance,
                    penalty: r.penaltyAmount,
                    status: r.status,
                    repayDate: r.repayDate ?? '',
                    mode: r.paymentMode ?? ''
                  }))
                )
              }
            >
              <Download /> Schedule
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2">
          <div className="flex w-72 items-center gap-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Combobox
              value={null}
              onChange={(v) => v && navigate(`/loans/${v}/repay`)}
              options={jumpOptions}
              onSearchChange={setJumpSearch}
              loading={jumpResults.isFetching}
              placeholder="Jump to another loan…"
              searchPlaceholder="Loan no, customer, phone, IMEI…"
            />
          </div>
          <Badge
            variant={
              loan.status === 'ACTIVE'
                ? 'info'
                : loan.status === 'CLOSED'
                  ? 'success'
                  : loan.status === 'FORECLOSED'
                    ? 'secondary'
                    : 'muted'
            }
          >
            {LOAN_STATUS_LABELS[loan.status as keyof typeof LOAN_STATUS_LABELS] ?? loan.status}
          </Badge>
        </div>
      </PageHeader>

      {locked && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex items-center gap-3 p-4 text-[13px]">
            <Lock className="size-4 shrink-0 text-success" />
            This loan is {loan.status.toLowerCase()}
            {loan.closedDate ? ` since ${formatDate(loan.closedDate)}` : ''}. The schedule below is
            read-only.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Financed"
          value={money(loan.loanAmount)}
          sub={
            Math.abs(loan.totalPayable - loan.loanAmount) > 0.5
              ? `${money(loan.totalPayable)} total payable`
              : undefined
          }
          icon={HandCoins}
          tone="primary"
        />
        <StatCard
          label="Outstanding"
          value={money(loan.currentOutstanding)}
          icon={Wallet}
          tone={loan.currentOutstanding > 0 ? 'warning' : 'success'}
        />
        <StatCard label="Monthly EMI" value={money(loan.monthlyEmi)} />
        <StatCard
          label="Overdue"
          value={String(loan.overdueCount)}
          sub={loan.overdueCount > 0 ? money(loan.overdueAmount) : undefined}
          tone={loan.overdueCount > 0 ? 'danger' : 'success'}
        />
        <StatCard label="Tenure" value={`${loan.tenureMonths} mo`} sub={`${formatDate(loan.emiStartDate)} → ${formatDate(loan.emiEndDate)}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        {/* -------------------------------------------------------- schedule */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Due date</th>
                  <th className="px-3 py-2 text-right">EMI</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Paid on</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {schedule.map((row: any) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40',
                      selectedRow?.id === row.id && 'bg-accent/60',
                      row.overdueDays > 0 && row.status !== 'PAID' && 'bg-destructive/5'
                    )}
                    onClick={() => !locked && pickInstallment(row)}
                  >
                    <td className="px-3 py-2 tnum">{row.emiNo}</td>
                    <td className="px-3 py-2">
                      {formatDate(row.dueDate)}
                      {row.overdueDays > 0 && row.status !== 'PAID' && (
                        <span className="ml-1.5 text-xs font-medium text-destructive">
                          {row.overdueDays}d late
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tnum">{money(row.scheduledEmi)}</td>
                    <td className="px-3 py-2 text-right tnum">{money(row.actualEmiPaid, { blankZero: true })}</td>
                    <td className="px-3 py-2 text-right font-medium tnum">{money(row.balance, { blankZero: true })}</td>
                    <td className="px-3 py-2">
                      <EmiStatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.repayDate ? `${formatDate(row.repayDate)}${row.paymentMode ? ` · ${row.paymentMode}` : ''}` : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {row.penaltyAmount > 0 && (
                        <Badge variant={row.isPenaltyPaid ? 'success' : 'warning'} className="text-[10px]">
                          ₹{row.penaltyAmount}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* --------------------------------------------------- collect panel */}
        <div className="space-y-4">
          {!locked ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-[13px] font-semibold">
                  Collect installment {selectedRow ? `#${selectedRow.emiNo}` : ''}
                </p>
                {!selectedRow ? (
                  <p className="text-[13px] text-muted-foreground">
                    Every installment is paid. Nothing left to collect.
                  </p>
                ) : (
                  <>
                    <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-[13px]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Due {formatDate(selectedRow.dueDate)}</span>
                        <span className="font-semibold tnum">{money(selectedRow.balance)}</span>
                      </div>
                    </div>

                    <Field label="Amount received" required>
                      <Input
                        autoFocus
                        type="number"
                        min={0}
                        max={selectedRow.balance}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        className="h-10 text-right text-lg font-semibold tnum"
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Payment mode">
                        <SimpleSelect value={mode} onChange={setMode} options={[...PAYMENT_MODES]} />
                      </Field>
                      <Field label="Date">
                        <Input type="date" value={repayDate} max={todayStr()} onChange={(e) => setRepayDate(e.target.value)} />
                      </Field>
                    </div>

                    {selectedRow.overdueDays > 0 && (
                      <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <Field label="Penalty ₹" className="flex-1">
                            <Input
                              type="number"
                              min={0}
                              value={penalty}
                              onChange={(e) => setPenalty(e.target.value === '' ? '' : Number(e.target.value))}
                              className="text-right tnum"
                            />
                          </Field>
                          <label className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                            Paid
                            <Switch checked={penaltyPaid} onCheckedChange={setPenaltyPaid} />
                          </label>
                        </div>
                      </div>
                    )}

                    <Field label="Remarks">
                      <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[52px]" />
                    </Field>

                    <Button className="w-full" onClick={() => void submitPayment()} loading={saving}>
                      <Check /> Record ₹{Number(amount) || 0}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 text-[13px] text-muted-foreground">
                This loan is {loan.status.toLowerCase()} — no further repayment can be recorded.
              </CardContent>
            </Card>
          )}

          {!locked && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-[13px] font-semibold">Close early</p>
                <p className="text-xs text-muted-foreground">
                  Settle the entire remaining balance in one payment and close the loan now.
                </p>
                {session.can('loan.foreclose') && (
                  <Button variant="outline" className="w-full" onClick={() => setForecloseOpen(true)}>
                    <HandCoins /> Foreclose — {money(remainingBalance)} remaining
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {!locked && schedule.every((r: any) => r.status === 'PENDING') && session.can('loan.foreclose') && (
            <Button
              variant="ghost"
              className="w-full text-muted-foreground hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              <Ban /> Cancel this loan
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <Info label="Sale amount" value={money(loan.saleAmount)} />
          <Info label="Down payment" value={money(loan.downPayment)} />
          <Info label="Total payable" value={money(loan.totalPayable)} />
          <Info label="Processing fee" value={money(loan.processingFee)} />
          {session.can('report.profit') && <Info label="Margin" value={money(loan.totalMargin)} />}
          {loan.imei && <Info label="IMEI" value={loan.imei} mono />}
          <Info label="Shop" value={loan.shopName} />
          <Info label="Penalty collected" value={money(loan.penaltyCollected)} />
          <Info label="Last EMI paid" value={loan.lastEmiPaidDate ? formatDate(loan.lastEmiPaidDate) : '—'} />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- foreclose */}
      <Dialog open={forecloseOpen} onOpenChange={setForecloseOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Foreclose {loan.loanNo}</DialogTitle>
            <DialogDescription>
              Settles every remaining installment at once and closes the loan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-muted-foreground">Remaining balance</span>
                <span className="text-xl font-semibold tnum">{money(remainingBalance)}</span>
              </div>
            </div>
            <Field label="Settlement amount received" hint="Lower this to offer a foreclosure discount">
              <Input
                type="number"
                min={0}
                value={settlement}
                onChange={(e) => setSettlement(e.target.value === '' ? '' : Number(e.target.value))}
                className="text-right text-lg font-semibold tnum"
              />
            </Field>
            <Field label="Payment mode">
              <SimpleSelect value={mode} onChange={setMode} options={[...PAYMENT_MODES]} />
            </Field>
            <Field label="Remarks">
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForecloseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitForeclose()} disabled={!settlement || Number(settlement) <= 0}>
              Foreclose for {money(settlement || 0)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${loan.loanNo}?`}
        description="No EMI has been collected yet, so this loan can be cancelled outright. Any linked handset returns to stock."
        confirmLabel="Cancel loan"
        destructive
        onConfirm={() => cancelLoan('Cancelled before any EMI collected')}
      />
    </div>
  )
}

function EmiStatusBadge({ status }: { status: string }) {
  const map: Record<string, any> = {
    PENDING: 'muted',
    PARTIAL: 'warning',
    PAID: 'success',
    FORECLOSED: 'secondary',
    WAIVED: 'secondary'
  }
  return <Badge variant={map[status] ?? 'secondary'}>{status}</Badge>
}

function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-[13px] font-medium', mono && 'font-mono')}>{value}</p>
    </div>
  )
}
