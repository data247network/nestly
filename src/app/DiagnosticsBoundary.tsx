import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

function report(label: string, error: unknown, extra?: Record<string, unknown>) {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
  console.error(`[NESTLY-DIAGNOSTIC] ${label}`, message, extra ?? '')
}

export function installGlobalDiagnostics() {
  const previousError = window.onerror
  const previousRejection = window.onunhandledrejection

  window.onerror = (message, source, lineno, colno, error) => {
    report('window.onerror', error ?? message, { source, lineno, colno })
    previousError?.call(window, message, source, lineno, colno, error)
  }

  window.onunhandledrejection = (event) => {
    report('unhandledrejection', event.reason)
    previousRejection?.call(window, event)
  }
}

export class DiagnosticsBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    report('react-error-boundary', error, { componentStack: info.componentStack })
  }

  reload = () => window.location.reload()

  render() {
    if (!this.state.error) return this.props.children

    const error = this.state.error
    return (
      <main className="min-h-screen bg-white px-6 py-10 text-tealInk">
        <div className="mx-auto max-w-md rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-extrabold">Nestly needs to recover</h1>
          <p className="mt-2 text-sm leading-relaxed text-black/70">
            The app interface hit an unexpected error. Your Nestly account and device data have not been deleted.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-2xl bg-black/5 p-3 text-[10px] leading-relaxed whitespace-pre-wrap">
            {error.name}: {error.message}\n{error.stack ?? ''}
          </pre>
          <button
            type="button"
            onClick={this.reload}
            className="mt-4 rounded-2xl bg-brand px-5 py-3 text-sm font-bold text-white"
          >
            Reload Nestly
          </button>
        </div>
      </main>
    )
  }
}
