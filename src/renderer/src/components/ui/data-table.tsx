import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from './base'

export interface Column<T> {
  key: string
  header: React.ReactNode
  /** Cell renderer. Falls back to `row[key]`. */
  render?: (row: T, index: number) => React.ReactNode
  /** Value used for sorting; falls back to `row[key]`. */
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right' | 'center'
  width?: string
  className?: string
  headerClassName?: string
  sortable?: boolean
  /** Hide on narrow windows. */
  hideBelow?: 'sm' | 'md' | 'lg'
  footer?: (rows: T[]) => React.ReactNode
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  loading?: boolean
  empty?: React.ReactNode
  onRowClick?: (row: T, index: number) => void
  rowClassName?: (row: T, index: number) => string | undefined
  /** Adds a footer row built from column.footer renderers. */
  showFooter?: boolean
  dense?: boolean
  stickyHeader?: boolean
  className?: string
  /** Highlights the keyboard-focused row; use with useTableKeyboard. */
  activeIndex?: number
  maxHeight?: string
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const
const hideClass = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  rowClassName,
  showFooter,
  dense,
  stickyHeader = true,
  className,
  activeIndex,
  maxHeight
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)

  const sorted = React.useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const get = (r: T) =>
      col.sortValue ? col.sortValue(r) : ((r as any)[col.key] ?? '')
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (typeof va === 'number' && typeof vb === 'number')
        return sort.dir === 'asc' ? va - vb : vb - va
      return sort.dir === 'asc'
        ? String(va).localeCompare(String(vb), 'en-IN')
        : String(vb).localeCompare(String(va), 'en-IN')
    })
  }, [rows, sort, columns])

  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null
    )

  const cellPad = dense ? 'px-3 py-1.5' : 'px-3 py-2.5'

  return (
    <div
      className={cn('relative overflow-auto rounded-xl border border-border bg-card', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-sm">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr className="border-b border-border bg-muted/60 backdrop-blur">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
                  alignClass[c.align ?? 'left'],
                  c.hideBelow && hideClass[c.hideBelow],
                  c.sortable && 'cursor-pointer select-none hover:text-foreground',
                  c.headerClassName
                )}
                onClick={c.sortable ? () => toggleSort(c.key) : undefined}
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1',
                    c.align === 'right' && 'flex-row-reverse'
                  )}
                >
                  {c.header}
                  {c.sortable &&
                    (sort?.key !== c.key ? (
                      <ChevronsUpDown className="size-3 opacity-40" />
                    ) : sort.dir === 'asc' ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-border/60">
                {columns.map((c) => (
                  <td key={c.key} className={cellPad}>
                    <Skeleton className="h-4" />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-16">
                <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
                  <Inbox className="size-8 opacity-40" />
                  <p className="text-[13px]">{empty ?? 'Nothing to show yet'}</p>
                </div>
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                className={cn(
                  'border-b border-border/60 transition-colors last:border-0',
                  onRowClick && 'cursor-pointer',
                  activeIndex === i ? 'bg-accent/70' : 'hover:bg-muted/50',
                  rowClassName?.(row, i)
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      cellPad,
                      alignClass[c.align ?? 'left'],
                      c.align === 'right' && 'tnum',
                      c.hideBelow && hideClass[c.hideBelow],
                      c.className
                    )}
                  >
                    {c.render ? c.render(row, i) : ((row as any)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>

        {showFooter && sorted.length > 0 && (
          <tfoot className="sticky bottom-0">
            <tr className="border-t-2 border-border bg-muted/80 font-semibold backdrop-blur">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    cellPad,
                    alignClass[c.align ?? 'left'],
                    c.align === 'right' && 'tnum',
                    c.hideBelow && hideClass[c.hideBelow]
                  )}
                >
                  {c.footer ? c.footer(sorted) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Arrow-key navigation over a list, with Enter to activate. */
export function useListKeyboard<T>(
  items: T[],
  onActivate?: (item: T, index: number) => void,
  enabled = true
) {
  const [index, setIndex] = React.useState(0)

  React.useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)))
  }, [items.length])

  React.useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
      if (typing && e.key !== 'Escape') return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && items[index] && onActivate) {
        e.preventDefault()
        onActivate(items[index], index)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, index, onActivate, enabled])

  return { index, setIndex }
}
