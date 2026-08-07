import * as React from 'react'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown, Loader2, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'

export interface ComboOption {
  value: string
  label: string
  /** Extra text matched while typing but shown dimmed (IMEI, phone, SKU…). */
  hint?: string
  /** Right-aligned meta such as stock count or price. */
  meta?: React.ReactNode
  group?: string
  disabled?: boolean
  keywords?: string[]
  data?: any
}

export interface ComboboxProps {
  value?: string | null
  onChange: (value: string, option?: ComboOption) => void
  options: ComboOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  contentClassName?: string
  disabled?: boolean
  invalid?: boolean
  loading?: boolean
  clearable?: boolean
  autoFocusSearch?: boolean
  /** Called as the user types — use for server-side search. */
  onSearchChange?: (search: string) => void
  /** Shows a "Create <text>" row when nothing matches. */
  onCreate?: (search: string) => void | Promise<void>
  createLabel?: string
  renderOption?: (option: ComboOption, selected: boolean) => React.ReactNode
  renderValue?: (option: ComboOption | undefined) => React.ReactNode
  size?: 'sm' | 'default'
}

/**
 * Searchable dropdown used everywhere a list can grow: customers, suppliers,
 * models, IMEIs, shops, states. Fully keyboard driven — type to filter, arrows
 * to move, Enter to pick, Esc to close.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Type to search…',
  emptyText = 'Nothing found',
  className,
  contentClassName,
  disabled,
  invalid,
  loading,
  clearable,
  autoFocusSearch = true,
  onSearchChange,
  onCreate,
  createLabel = 'Add',
  renderOption,
  renderValue,
  size = 'default'
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [width, setWidth] = React.useState<number>()

  const selected = React.useMemo(() => options.find((o) => o.value === value), [options, value])

  React.useEffect(() => {
    if (open) setWidth(triggerRef.current?.offsetWidth)
  }, [open])

  React.useEffect(() => {
    onSearchChange?.(search)
  }, [search, onSearchChange])

  const groups = React.useMemo(() => {
    const map = new Map<string, ComboOption[]>()
    for (const o of options) {
      const key = o.group ?? ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(o)
    }
    return [...map.entries()]
  }, [options])

  const showCreate = Boolean(onCreate && search.trim().length > 1)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            `flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-card
             px-3 text-sm shadow-sm transition focus:outline-none focus:ring-2 focus:ring-ring/40
             focus:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60`,
            size === 'sm' ? 'h-8 text-[13px]' : 'h-9',
            invalid && 'border-destructive',
            className
          )}
        >
          <span className={cn('flex-1 truncate text-left', !selected && 'text-muted-foreground/70')}>
            {selected ? (renderValue ? renderValue(selected) : selected.label) : placeholder}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            {clearable && selected && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('', undefined)
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </span>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        className={cn('p-0', contentClassName)}
        style={{ width: width ? `${width}px` : undefined, minWidth: 260 }}
        onOpenAutoFocus={(e) => {
          if (!autoFocusSearch) e.preventDefault()
        }}
      >
        <Command
          shouldFilter={!onSearchChange}
          className="overflow-hidden rounded-xl"
          filter={(val, s, keywords) => {
            const hay = `${val} ${(keywords ?? []).join(' ')}`.toLowerCase()
            return hay.includes(s.toLowerCase()) ? 1 : 0
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </div>

          <Command.List className="max-h-[280px] overflow-y-auto overflow-x-hidden p-1">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              {loading ? 'Searching…' : emptyText}
            </Command.Empty>

            {groups.map(([group, items]) => (
              <Command.Group
                key={group || 'default'}
                heading={group || undefined}
                className={cn(
                  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
                  '[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold',
                  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide',
                  '[&_[cmdk-group-heading]]:text-muted-foreground'
                )}
              >
                {items.map((option) => {
                  const isSelected = option.value === value
                  return (
                    <Command.Item
                      key={option.value}
                      value={`${option.label} ${option.hint ?? ''} ${option.value}`}
                      keywords={option.keywords}
                      disabled={option.disabled}
                      onSelect={() => {
                        onChange(option.value, option)
                        setOpen(false)
                        setSearch('')
                      }}
                      className={cn(
                        `flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm
                         outline-none transition-colors data-[selected=true]:bg-accent
                         data-[selected=true]:text-accent-foreground
                         data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50`
                      )}
                    >
                      <Check
                        className={cn('size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                      />
                      {renderOption ? (
                        renderOption(option, isSelected)
                      ) : (
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{option.label}</span>
                          {option.hint && (
                            <span className="truncate text-xs text-muted-foreground">
                              {option.hint}
                            </span>
                          )}
                        </span>
                      )}
                      {option.meta && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {option.meta}
                        </span>
                      )}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            ))}

            {showCreate && (
              <>
                <div className="my-1 h-px bg-border" />
                <Command.Item
                  value={`__create__${search}`}
                  forceMount
                  onSelect={async () => {
                    await onCreate?.(search.trim())
                    setOpen(false)
                    setSearch('')
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-primary data-[selected=true]:bg-accent"
                >
                  <Plus className="size-4" />
                  {createLabel} “{search.trim()}”
                </Command.Item>
              </>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Multi-select variant used for shop / company access lists and report filters.
 */
export function MultiCombobox({
  values,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  disabled,
  emptyText = 'Nothing found'
}: {
  values: string[]
  onChange: (values: string[]) => void
  options: ComboOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [width, setWidth] = React.useState<number>()

  React.useEffect(() => {
    if (open) setWidth(triggerRef.current?.offsetWidth)
  }, [open])

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])

  const label =
    values.length === 0
      ? placeholder
      : values.length <= 2
        ? options
            .filter((o) => values.includes(o.value))
            .map((o) => o.label)
            .join(', ')
        : `${values.length} selected`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={cn(
            `flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input
             bg-card px-3 text-sm shadow-sm transition focus:outline-none focus:ring-2
             focus:ring-ring/40 disabled:opacity-60`,
            className
          )}
        >
          <span className={cn('truncate', values.length === 0 && 'text-muted-foreground/70')}>
            {label}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: width ? `${width}px` : undefined, minWidth: 240 }}>
        <Command className="overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 text-muted-foreground" />
            <Command.Input
              placeholder="Search…"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              {emptyText}
            </Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={`${o.label} ${o.hint ?? ''}`}
                onSelect={() => toggle(o.value)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    values.includes(o.value)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input'
                  )}
                >
                  {values.includes(o.value) && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.meta && <span className="text-xs text-muted-foreground">{o.meta}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
