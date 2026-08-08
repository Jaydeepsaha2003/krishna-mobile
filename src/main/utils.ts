import { randomUUID } from 'node:crypto'
import { one, run, tx } from './db'

export function newId(): string {
  return randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** yyyy-MM-dd in local time (dates are stored as plain days, not instants). */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Adds calendar months to a yyyy-MM-dd date, clamping the day (31 Jan + 1mo -> 28/29 Feb). */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  const day = Math.min(d, lastDay)
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/** Whole calendar days between two yyyy-MM-dd dates (to - from). */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function bool01(v: unknown): number {
  return v ? 1 : 0
}

export function nullify(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Indian financial year label for a date: 2026-05-11 -> "2026-27" */
export function financialYear(dateStr: string, startMonth = 4): string {
  const [y, m] = dateStr.split('-').map(Number)
  const startYear = m >= startMonth ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/**
 * Atomically allocates the next document number for a shop.
 * Example result: KM1/INV/2026-27/0042
 */
export async function nextDocumentNumber(opts: {
  companyId: string
  shopId: string
  kind: 'sale' | 'purchase' | 'transfer' | 'recon' | 'loan'
  date: string
  prefix: string
  fyStartMonth?: number
}): Promise<string> {
  const fy = financialYear(opts.date, opts.fyStartMonth ?? 4)
  const counterId = `${opts.companyId}:${opts.shopId}:${opts.kind}:${fy}`

  const next = await tx(async (t) => {
    const row = await t.one<{ next_no: number }>('SELECT next_no FROM counters WHERE id = ?', [
      counterId
    ])
    const value = row?.next_no ?? 1
    if (row) {
      await t.run('UPDATE counters SET next_no = ?, updated_at = ? WHERE id = ?', [
        value + 1,
        nowIso(),
        counterId
      ])
    } else {
      await t.run('INSERT INTO counters (id, next_no, updated_at) VALUES (?, ?, ?)', [
        counterId,
        2,
        nowIso()
      ])
    }
    return value
  })

  return `${opts.prefix}/${fy}/${String(next).padStart(4, '0')}`
}

/** Builds `IN (?,?,?)` fragments safely. */
export function inClause(values: readonly unknown[]): string {
  return values.map(() => '?').join(',')
}

export async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const row = await one<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  if (!row?.value) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return row.value as unknown as T
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), nowIso()]
  )
}

/** Inclusive date-range guard used by every report query. */
export function dateRange(from?: string | null, to?: string | null): { from: string; to: string } {
  return { from: from || '0000-01-01', to: to || '9999-12-31' }
}

export class AppError extends Error {
  code: string
  constructor(message: string, code = 'APP_ERROR') {
    super(message)
    this.code = code
  }
}
