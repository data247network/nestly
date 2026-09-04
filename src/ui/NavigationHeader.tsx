import { LABELS } from '../app/nav'
import { useStore } from '../app/store'

/**
 * In-app navigation for native/mobile surfaces. The product uses an in-memory
 * screen stack rather than URL navigation, so Android's system back gesture
 * cannot be relied on for every transition. This header exposes the same
 * history explicitly and keeps the current screen understandable.
 */
export function NavigationHeader() {
  const { state, back } = useStore()

  if (state.history.length === 0 || state.screen === 'v2control') return null

  return (
    <div className="safe-top flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-2">
      <button
        type="button"
        onClick={back}
        aria-label="Go back"
        className="rounded-xl border border-line px-3 py-2 text-xs font-bold text-body"
      >
        ← Back
      </button>
      <div className="min-w-0 flex-1 truncate text-sm font-bold">{LABELS[state.screen]}</div>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="rounded-xl px-2 py-2 text-xs font-bold text-body"
        aria-label="Scroll to top"
      >
        ↑ Top
      </button>
    </div>
  )
}
