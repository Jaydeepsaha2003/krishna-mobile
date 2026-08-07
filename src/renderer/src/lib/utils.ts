import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/* -------------------------------------------------------------------------- */
/*  Money & numbers — Indian formatting throughout                             */
/* -------------------------------------------------------------------------- */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
})

const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1
})

const plain = new Intl.NumberFormat('en-IN')

export function money(value?: number | null, opts?: { compact?: boolean; blankZero?: boolean }): string {
  const n = Number(value ?? 0)
  if (opts?.blankZero && n === 0) return '—'
  if (opts?.compact && Math.abs(n) >= 100000) return inrCompact.format(n)
  return inr.format(n)
}

/** No currency symbol — for table cells that already have a ₹ column header. */
export function amount(value?: number | null): string {
  return plain.format(Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100)
}

export function count(value?: number | null): string {
  return plain.format(Number(value ?? 0))
}

export function percent(value?: number | null, digits = 1): string {
  return `${Number(value ?? 0).toFixed(digits)}%`
}

/* -------------------------------------------------------------------------- */
/*  Dates                                                                      */
/* -------------------------------------------------------------------------- */

export function todayStr(): string {
  return toDateStr(new Date())
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

export function startOfMonth(d = new Date()): string {
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function endOfMonth(d = new Date()): string {
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function startOfFinancialYear(d = new Date(), startMonth = 4): string {
  const year = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1
  return toDateStr(new Date(year, startMonth - 1, 1))
}

/** 2026-08-06 -> "6 Aug 2026" */
export function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function relativeTime(value?: string | null): string {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return value
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (Math.abs(mins) < 1) return 'just now'
  if (Math.abs(mins) < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return `${days}d ago`
  return formatDate(value)
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function initials(name?: string | null): string {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  if (!rows.length) return ''
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
  const head = cols.map((c) => csvEscape(c.label)).join(',')
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c.key])).join(',')).join('\n')
  return `${head}\n${body}`
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 250): T {
  let t: ReturnType<typeof setTimeout>
  return ((...args: any[]) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
