import * as React from 'react'
import { create } from 'zustand'

export interface HotkeyMeta {
  combo: string
  description: string
  group: string
}

interface HotkeyStore {
  registry: Record<string, HotkeyMeta>
  register: (meta: HotkeyMeta) => void
  unregister: (combo: string) => void
  helpOpen: boolean
  setHelpOpen: (v: boolean) => void
}

export const useHotkeyStore = create<HotkeyStore>((set) => ({
  registry: {},
  register: (meta) => set((s) => ({ registry: { ...s.registry, [meta.combo]: meta } })),
  unregister: (combo) =>
    set((s) => {
      const next = { ...s.registry }
      delete next[combo]
      return { registry: next }
    }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen })
}))

function normalise(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const key = e.key.toLowerCase()
  if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key)
  return parts.join('+')
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export interface HotkeyOptions {
  description?: string
  group?: string
  /** Fire even when a text field has focus (use for Esc, F-keys, Ctrl combos). */
  allowInInputs?: boolean
  enabled?: boolean
  preventDefault?: boolean
}

/**
 * Registers a global keyboard shortcut for as long as the component is mounted.
 * Shortcuts with a description also show up in the Shift+? cheat-sheet.
 */
export function useHotkey(
  combo: string | string[],
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {}
): void {
  const {
    description,
    group = 'General',
    allowInInputs = false,
    enabled = true,
    preventDefault = true
  } = options

  const combos = React.useMemo(
    () => (Array.isArray(combo) ? combo : [combo]).map((c) => c.toLowerCase()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(combo) ? combo.join('|') : combo]
  )
  const handlerRef = React.useRef(handler)
  handlerRef.current = handler

  const register = useHotkeyStore((s) => s.register)
  const unregister = useHotkeyStore((s) => s.unregister)

  React.useEffect(() => {
    if (!description || !enabled) return
    register({ combo: combos[0], description, group })
    return () => unregister(combos[0])
  }, [combos, description, group, enabled, register, unregister])

  React.useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const pressed = normalise(e)
      if (!combos.includes(pressed)) return
      const modified = e.ctrlKey || e.metaKey || e.altKey
      if (isTypingTarget(e.target) && !allowInInputs && !modified) return
      if (preventDefault) e.preventDefault()
      handlerRef.current(e)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [combos, enabled, allowInInputs, preventDefault])
}

/** Pretty-prints "ctrl+shift+n" as "Ctrl + Shift + N". */
export function prettyCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => {
      if (p === 'ctrl') return 'Ctrl'
      if (p === 'alt') return 'Alt'
      if (p === 'shift') return 'Shift'
      if (p === 'escape') return 'Esc'
      if (p === 'arrowup') return '↑'
      if (p === 'arrowdown') return '↓'
      if (p === 'arrowleft') return '←'
      if (p === 'arrowright') return '→'
      if (p === ' ') return 'Space'
      if (p.startsWith('f') && p.length <= 3 && !Number.isNaN(Number(p.slice(1))))
        return p.toUpperCase()
      return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
    })
    .join(' + ')
}
