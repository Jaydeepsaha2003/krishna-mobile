import * as React from 'react'
import { CheckCircle2, Download, RotateCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/base'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlay'
import { Progress } from '@/components/ui/form'

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes?: string; releaseDate?: string }
  | { status: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { status: 'ready'; version: string }
  | { status: 'none'; currentVersion: string }
  | { status: 'error'; message: string }

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Shows update progress in the title bar. Downloads happen on their own; the
 * app relaunches itself into the new version when UPDATE_MODE=auto.
 */
export function UpdateCenter() {
  const [state, setState] = React.useState<UpdateState>({ status: 'idle' })
  const [open, setOpen] = React.useState(false)
  const [version, setVersion] = React.useState('')

  React.useEffect(() => {
    void api.app.info().then((i: any) => setVersion(i.version))
    void api.updater.state().then(setState)
    const off = window.api.on('updater:state', (s: UpdateState) => {
      setState(s)
      if (s.status === 'ready') {
        setOpen(true)
        toast.success(`Version ${s.version} is ready — restarting shortly`, { duration: 8000 })
      }
    })
    const offRestart = window.api.on('updater:restarting', () => {
      toast.info('Installing update and restarting…', { duration: 10000 })
    })
    return () => {
      off()
      offRestart()
    }
  }, [])

  const check = async () => {
    setState({ status: 'checking' })
    const next = await api.updater.check()
    setState(next)
    if (next.status === 'none') toast.success('You are on the latest version')
  }

  const isBusy = state.status === 'downloading' || state.status === 'checking'
  const isReady = state.status === 'ready'

  // Nothing interesting to show — stay out of the way.
  if (!isBusy && !isReady && state.status !== 'available') {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Tooltip content="Check for updates">
            <Button variant="ghost" size="icon-sm">
              <RotateCw className="size-4" />
            </Button>
          </Tooltip>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <UpdatePanel state={state} version={version} onCheck={check} />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isReady ? 'success' : 'outline'}
          size="sm"
          className={cn('gap-1.5', isBusy && 'pointer-events-auto')}
        >
          {isReady ? <CheckCircle2 className="size-4" /> : <Download className="size-4" />}
          {state.status === 'downloading'
            ? `${state.percent}%`
            : isReady
              ? 'Restart to update'
              : state.status === 'checking'
                ? 'Checking…'
                : 'Update'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <UpdatePanel state={state} version={version} onCheck={check} />
      </PopoverContent>
    </Popover>
  )
}

function UpdatePanel({
  state,
  version,
  onCheck
}: {
  state: UpdateState
  version: string
  onCheck: () => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Software update</p>
        <p className="text-xs text-muted-foreground">Installed version {version}</p>
      </div>

      {state.status === 'downloading' && (
        <div className="space-y-1.5">
          <Progress value={state.percent} />
          <p className="text-xs text-muted-foreground">
            {mb(state.transferred)} of {mb(state.total)} · {mb(state.bytesPerSecond)}/s
          </p>
        </div>
      )}

      {state.status === 'available' && (
        <p className="text-[13px]">
          Version <span className="font-semibold">{state.version}</span> is downloading in the
          background. You can keep working.
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <p className="text-[13px]">
            Version <span className="font-semibold">{state.version}</span> is ready. The app will
            close and reopen — finish the bill on screen first.
          </p>
          <Button size="sm" className="w-full" onClick={() => void api.updater.install()}>
            Restart & install now
          </Button>
        </>
      )}

      {state.status === 'error' && (
        <p className="flex items-start gap-2 text-[13px] text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}

      {(state.status === 'none' || state.status === 'idle' || state.status === 'error') && (
        <Button variant="outline" size="sm" className="w-full" onClick={onCheck}>
          Check for updates
        </Button>
      )}
    </div>
  )
}
