import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Keeps one broken screen from taking down the whole app. AppShell keys it by route, so
 * navigating elsewhere clears the error.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Melstar ERP] screen error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card mx-auto mt-8 max-w-lg p-6 text-center sm:p-8">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-rose-50 text-rose-600">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <p className="mt-4 text-lg font-semibold text-ink">This screen hit a problem</p>
        <p className="mt-1 text-sm text-ink-soft">Your data is safe. Reload the page, or go back and try again. If it keeps happening, tell the ERP administrator.</p>
        <p className="mt-3 break-words rounded-md bg-slate-50 px-3 py-2 font-mono text-[11.5px] text-ink-faint">{this.state.error.message}</p>
        <button onClick={() => window.location.reload()} className="mt-5 inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          <RefreshCw className="h-4 w-4" /> Reload
        </button>
      </div>
    )
  }
}
