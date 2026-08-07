import * as React from 'react'
import { Minus, Square, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Minimise / maximise / close for the frameless window. */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = React.useState(true)

  React.useEffect(() => {
    void api.window.isMaximized().then(setMaximized)
    return window.api.on('window:maximized', (v: boolean) => setMaximized(v))
  }, [])

  return (
    <div className={cn('app-no-drag flex items-center', className)}>
      <button
        className="flex h-8 w-11 items-center justify-center text-muted-foreground transition hover:bg-muted"
        onClick={() => void api.window.minimize()}
        aria-label="Minimise"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        className="flex h-8 w-11 items-center justify-center text-muted-foreground transition hover:bg-muted"
        onClick={async () => setMaximized(await api.window.maximize())}
        aria-label={maximized ? 'Restore' : 'Maximise'}
      >
        <Square className="size-3" />
      </button>
      <button
        className="flex h-8 w-11 items-center justify-center text-muted-foreground transition hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => void api.window.close()}
        aria-label="Close"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
