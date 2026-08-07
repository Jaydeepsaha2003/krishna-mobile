import * as React from 'react'
import { ArrowLeft, Loader2, Lock, Moon, RotateCw, ShieldCheck, Sun, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useSession } from '@/store/session'
import { useTheme } from '@/lib/theme'
import { cn, initials, relativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/base'
import { PinInput } from '@/components/ui/misc'
import { WindowControls } from '@/components/layout/WindowControls'

interface Tile {
  id: string
  name: string
  username: string
  role: string
  avatarColor: string | null
  lastLoginAt: string | null
  lockedUntil: string | null
  isSystem: boolean
}

/**
 * The lock screen. Every session starts here — pick your face, type 6 digits.
 * There is deliberately no "stay signed in".
 */
export function LoginScreen() {
  const setLogin = useSession((s) => s.setLogin)
  const theme = useTheme()

  const [tiles, setTiles] = React.useState<Tile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selected, setSelected] = React.useState<Tile | null>(null)
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [appInfo, setAppInfo] = React.useState<any>(null)

  const [dbError, setDbError] = React.useState<string | null>(null)
  const [retrying, setRetrying] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const info = await api.app.info()
      setAppInfo(info)
      if (!info.db?.connected) {
        setDbError(
          info.db?.connectError ??
            'The database could not be opened. Check the Turso settings in the .env file.'
        )
        return
      }
      setDbError(null)
      const users = await api.auth.users()
      setTiles(users)
      if (users.length === 1) setSelected(users[0])
    } catch (err: any) {
      setDbError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const submit = React.useCallback(
    async (value: string) => {
      if (!selected || value.length !== 6) return
      setBusy(true)
      setError(null)
      try {
        const result = await api.auth.login(selected.id, value)
        setLogin(result)
      } catch (err: any) {
        setError(err.message)
        setPin('')
      } finally {
        setBusy(false)
      }
    },
    [selected, setLogin]
  )

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected && tiles.length > 1) {
        setSelected(null)
        setPin('')
        setError(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, tiles.length])

  const isLocked = (t: Tile) => t.lockedUntil && new Date(t.lockedUntil) > new Date()

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-background">
      {/* soft background wash */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-32 size-[460px] rounded-full bg-info/10 blur-3xl" />
      </div>

      <div className="app-drag absolute inset-x-0 top-0 flex h-10 items-center justify-end pr-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={theme.toggle}
          className="app-no-drag mr-1"
          aria-label="Switch theme"
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
        <WindowControls />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-6">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <span className="text-lg font-bold">KM</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Krishna Mobile</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {selected ? `Enter the 6-digit PIN for ${selected.name}` : 'Choose your account to sign in'}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : dbError ? (
          <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-center">
            <TriangleAlert className="mx-auto size-8 text-destructive" />
            <div>
              <p className="font-medium">The database could not be opened</p>
              <p className="mt-1 break-words text-[13px] text-muted-foreground">{dbError}</p>
            </div>
            <Button
              loading={retrying}
              onClick={async () => {
                setRetrying(true)
                const res = await api.app.reconnect()
                setRetrying(false)
                if (res?.ok) await load()
                else setDbError(res?.error ?? 'Still could not connect')
              }}
            >
              <RotateCw className="size-4" /> Try again
            </Button>
            <p className="text-xs text-muted-foreground">
              Check your internet connection and the TURSO_DATABASE_URL / TURSO_AUTH_TOKEN values in
              the .env file that ships with the installer.
            </p>
          </div>
        ) : selected ? (
          <div className="mx-auto max-w-sm space-y-6">
            <div className="flex flex-col items-center gap-3">
              <span
                className="flex size-16 items-center justify-center rounded-2xl text-xl font-semibold text-white shadow-md"
                style={{ background: selected.avatarColor ?? '#4f46e5' }}
              >
                {initials(selected.name)}
              </span>
              <div className="text-center">
                <p className="font-medium">{selected.name}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {selected.role} · {selected.username}
                </p>
              </div>
            </div>

            <PinInput
              value={pin}
              onChange={(v) => {
                setPin(v)
                setError(null)
              }}
              onComplete={submit}
              autoFocus
              disabled={busy}
              invalid={Boolean(error)}
            />

            {error && (
              <p className="text-center text-[13px] font-medium text-destructive">{error}</p>
            )}

            {busy && (
              <p className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Signing in…
              </p>
            )}

            <div className="flex items-center justify-center gap-2">
              {tiles.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelected(null)
                    setPin('')
                    setError(null)
                  }}
                >
                  <ArrowLeft className="size-4" /> Other account
                </Button>
              )}
              <Button size="sm" onClick={() => void submit(pin)} disabled={pin.length !== 6 || busy}>
                <Lock className="size-4" /> Sign in
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tiles.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelected(t)
                  setPin('')
                  setError(null)
                }}
                disabled={Boolean(isLocked(t))}
                className={cn(
                  `group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-5
                   text-center shadow-soft transition hover:-translate-y-0.5 hover:shadow-card
                   disabled:cursor-not-allowed disabled:opacity-50`
                )}
              >
                <span
                  className="flex size-12 items-center justify-center rounded-xl text-base font-semibold text-white"
                  style={{ background: t.avatarColor ?? '#4f46e5' }}
                >
                  {initials(t.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{t.name}</span>
                  <span className="block truncate text-[11px] capitalize text-muted-foreground">
                    {isLocked(t) ? 'Locked' : t.lastLoginAt ? relativeTime(t.lastLoginAt) : t.role}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {appInfo && (
          <div className="mt-10 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
            <span>v{appInfo.version}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3" />
              {appInfo.db?.mode === 'embedded'
                ? 'Turso synced'
                : appInfo.db?.mode === 'remote'
                  ? 'Turso live'
                  : 'Offline database'}
            </span>
            {appInfo.db?.mode === 'local-only' && (
              <>
                <span>·</span>
                <span className="text-warning">Turso credentials not set in .env</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
