import * as React from 'react'
import { Calendar, TrendingDown, TrendingUp } from 'lucide-react'
import { cn, endOfMonth, money, startOfFinancialYear, startOfMonth, toDateStr, todayStr } from '@/lib/utils'
import { Badge, Button, Card, Input, Label } from './base'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'

/* -------------------------------------------------------------------------- */
/*  Page scaffolding                                                           */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  children,
  className
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2', className)}
      {...props}
    />
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center',
        className
      )}
    >
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </span>
      )}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Stat card                                                                  */
/* -------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  tone = 'default',
  onClick,
  className
}: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  trend?: number
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary'
  onClick?: () => void
  className?: string
}) {
  const toneRing = {
    default: 'text-muted-foreground bg-muted',
    primary: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/12',
    danger: 'text-destructive bg-destructive/10',
    info: 'text-info bg-info/10'
  }[tone]

  return (
    <Card
      onClick={onClick}
      className={cn(
        'p-4 transition-shadow',
        onClick && 'cursor-pointer hover:shadow-card',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight tnum">{value}</p>
          {(sub || trend !== undefined) && (
            <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
              {trend !== undefined && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 font-medium',
                    trend >= 0 ? 'text-success' : 'text-destructive'
                  )}
                >
                  {trend >= 0 ? (
                    <TrendingUp className="size-3.5" />
                  ) : (
                    <TrendingDown className="size-3.5" />
                  )}
                  {Math.abs(trend).toFixed(1)}%
                </span>
              )}
              {sub && <span className="truncate">{sub}</span>}
            </div>
          )}
        </div>
        {Icon && (
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneRing)}>
            <Icon className="size-[18px]" />
          </span>
        )}
      </div>
    </Card>
  )
}

/** Compact ₹ display that colours negatives red. */
export function Money({
  value,
  className,
  colored,
  compact,
  blankZero
}: {
  value?: number | null
  className?: string
  colored?: boolean
  compact?: boolean
  blankZero?: boolean
}) {
  const n = Number(value ?? 0)
  return (
    <span
      className={cn(
        'tnum',
        colored && (n > 0 ? 'text-success' : n < 0 ? 'text-destructive' : ''),
        className
      )}
    >
      {money(n, { compact, blankZero })}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  Date range picker                                                          */
/* -------------------------------------------------------------------------- */

export interface DateRange {
  from: string
  to: string
}

const PRESETS: { label: string; get: () => DateRange }[] = [
  { label: 'Today', get: () => ({ from: todayStr(), to: todayStr() }) },
  {
    label: 'Yesterday',
    get: () => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      return { from: toDateStr(d), to: toDateStr(d) }
    }
  },
  {
    label: 'Last 7 days',
    get: () => {
      const d = new Date()
      d.setDate(d.getDate() - 6)
      return { from: toDateStr(d), to: todayStr() }
    }
  },
  {
    label: 'Last 30 days',
    get: () => {
      const d = new Date()
      d.setDate(d.getDate() - 29)
      return { from: toDateStr(d), to: todayStr() }
    }
  },
  { label: 'This month', get: () => ({ from: startOfMonth(), to: todayStr() }) },
  {
    label: 'Last month',
    get: () => {
      const d = new Date()
      d.setMonth(d.getMonth() - 1)
      return { from: startOfMonth(d), to: endOfMonth(d) }
    }
  },
  { label: 'This quarter', get: () => {
      const d = new Date()
      const q = Math.floor(d.getMonth() / 3)
      return { from: toDateStr(new Date(d.getFullYear(), q * 3, 1)), to: todayStr() }
    }
  },
  { label: 'This FY', get: () => ({ from: startOfFinancialYear(), to: todayStr() }) }
]

export function DateRangePicker({
  value,
  onChange,
  className,
  align = 'start'
}: {
  value: DateRange
  onChange: (r: DateRange) => void
  className?: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(value)

  React.useEffect(() => setDraft(value), [value])

  const label =
    value.from === value.to
      ? new Date(`${value.from}T00:00:00`).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
      : `${new Date(`${value.from}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(
          `${value.to}T00:00:00`
        ).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-2 font-normal', className)}>
          <Calendar className="size-4 text-muted-foreground" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[440px] p-0">
        <div className="flex">
          <div className="w-40 border-r border-border p-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  onChange(p.get())
                  setOpen(false)
                }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex-1 space-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="range-from">From</Label>
              <Input
                id="range-from"
                type="date"
                value={draft.from}
                max={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-to">To</Label>
              <Input
                id="range-to"
                type="date"
                value={draft.to}
                min={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onChange(draft)
                  setOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* -------------------------------------------------------------------------- */
/*  PIN input                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A single real input behind N visual boxes. Splitting the value across N inputs
 * and moving focus per keystroke drops digits when typing (or pasting) fast —
 * one input has no focus race, and paste works for free.
 */
export function PinInput({
  length = 6,
  value,
  onChange,
  onComplete,
  autoFocus,
  disabled,
  invalid,
  className
}: {
  length?: number
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
  invalid?: boolean
  className?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [focused, setFocused] = React.useState(false)
  const completedFor = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Fire onComplete exactly once per distinct full value.
  React.useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value
      onComplete?.(value)
    }
    if (value.length < length) completedFor.current = null
  }, [value, length, onComplete])

  return (
    <div
      className={cn('relative flex items-center justify-center gap-2', className)}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={`${length}-digit PIN`}
        // Invisible but focusable and on top, so clicks and typing land here.
        className="absolute inset-0 z-10 w-full cursor-default opacity-0"
      />
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length
        const isCaret = focused && i === Math.min(value.length, length - 1)
        return (
          <div
            key={i}
            className={cn(
              `flex size-12 items-center justify-center rounded-xl border-2 bg-card text-2xl
               font-semibold shadow-sm transition`,
              invalid
                ? 'border-destructive'
                : isCaret
                  ? 'border-ring ring-4 ring-ring/20'
                  : filled
                    ? 'border-primary'
                    : 'border-input',
              disabled && 'opacity-60'
            )}
          >
            {filled ? (
              <span className="size-2.5 rounded-full bg-foreground" />
            ) : isCaret ? (
              <span className="h-6 w-px animate-pulse bg-foreground/60" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Status badges                                                              */
/* -------------------------------------------------------------------------- */

const STOCK_TONE: Record<string, any> = {
  in_stock: 'success',
  in_transit: 'info',
  sold: 'muted',
  reserved: 'warning',
  damaged: 'danger',
  lost: 'danger',
  returned_to_supplier: 'secondary'
}

const STOCK_LABEL: Record<string, string> = {
  in_stock: 'In stock',
  in_transit: 'In transit',
  sold: 'Sold',
  reserved: 'Reserved',
  damaged: 'Damaged',
  lost: 'Lost',
  returned_to_supplier: 'Returned'
}

export function StockStatusBadge({ status }: { status: string }) {
  return <Badge variant={STOCK_TONE[status] ?? 'secondary'}>{STOCK_LABEL[status] ?? status}</Badge>
}

const SALE_TONE: Record<string, any> = {
  completed: 'success',
  partially_paid: 'warning',
  unpaid: 'danger',
  cancelled: 'muted',
  returned: 'secondary'
}

const SALE_LABEL: Record<string, string> = {
  completed: 'Paid',
  partially_paid: 'Part paid',
  unpaid: 'Unpaid',
  cancelled: 'Cancelled',
  returned: 'Returned'
}

export function SaleStatusBadge({ status }: { status: string }) {
  return <Badge variant={SALE_TONE[status] ?? 'secondary'}>{SALE_LABEL[status] ?? status}</Badge>
}

export function OverdueBadge({ days }: { days: number }) {
  if (days <= 0) return <Badge variant="info">Upcoming</Badge>
  if (days <= 7) return <Badge variant="warning">{days}d overdue</Badge>
  return <Badge variant="danger">{days}d overdue</Badge>
}
