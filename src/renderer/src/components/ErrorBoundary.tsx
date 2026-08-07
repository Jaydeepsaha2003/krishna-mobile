import * as React from 'react'
import { RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/base'

interface State {
  error: Error | null
  info: string
}

/**
 * Without this, any render error leaves the shop staring at a white window with
 * no way forward. Show what broke, log it, and offer a way back.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ info: info.componentStack ?? '' })
    void window.api.invoke('app:logError', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack
    })
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-8">
        <div className="w-full max-w-xl space-y-5 rounded-2xl border border-destructive/40 bg-card p-8 shadow-card">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-6 shrink-0 text-destructive" />
            <div>
              <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Your data is safe — nothing was saved or changed. The details below have been written
                to the log file.
              </p>
            </div>
          </div>

          <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs">
            {this.state.error.message}
            {this.state.info ? `\n${this.state.info.split('\n').slice(0, 8).join('\n')}` : ''}
          </pre>

          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>
              <RotateCw /> Reload the app
            </Button>
            <Button variant="outline" onClick={() => void window.api.invoke('app:openLogs')}>
              Open log file
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
