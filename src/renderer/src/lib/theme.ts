import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'km.theme'

function apply(mode: ThemeMode): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'light',
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    apply(mode)
    set({ mode })
  },
  toggle: () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    get().setMode(next)
  }
}))

/** Called once at start-up, before React renders, to avoid a flash. */
export function initTheme(): void {
  const mode = (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'light'
  apply(mode)
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if ((localStorage.getItem(STORAGE_KEY) as ThemeMode) === 'system') apply('system')
    })
}
