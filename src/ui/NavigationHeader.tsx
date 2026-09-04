import { LABELS } from '../app/nav'
import { useStore } from '../app/store'

/**
 * Explicit in-app history control for native/mobile screens. The app uses an
 * in-memory screen stack rather than URL navigation, so a visible Back control
 * is needed in addition to the bottom tab navigation.
 */
export function NavigationHeader() {
  const { state, back } = useStore()

  if (state.history.length === 0 || state.screen === 'v2control') return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 py-2">
      <button
        type="button"
        onClick={back}
        aria-label="Go back"
        className="rounded-xl border border-line px-3 py-2 text-xs font-bold text-body"
      >
        ← Back
      </button>
      <div className="min-w-0 flex-1 truncate text-sm font-bold">{LABELS[state.screen]}</div>
    </div>
  )
}
