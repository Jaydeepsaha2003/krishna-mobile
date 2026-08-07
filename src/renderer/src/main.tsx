import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/overlay'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { initTheme } from '@/lib/theme'
import App from './App'
import './styles/globals.css'

initTheme()

// Anything that escapes React lands in the main-process log too, so a support
// call never depends on the user having DevTools open.
window.addEventListener('error', (e) => {
  void window.api.invoke('app:logError', {
    message: e.message,
    stack: e.error?.stack,
    source: `${e.filename}:${e.lineno}`
  })
})
window.addEventListener('unhandledrejection', (e) => {
  void window.api.invoke('app:logError', {
    message: String(e.reason?.message ?? e.reason),
    stack: e.reason?.stack
  })
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 20_000
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={350} skipDelayDuration={200}>
          <HashRouter>
            <App />
          </HashRouter>
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{ className: 'text-[13px]' }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
