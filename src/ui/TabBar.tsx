import { TABS } from '../app/nav'
import { useStore } from '../app/store'
import type { ScreenId } from '../app/types'

/**
 * Bottom navigation for the parent app.
 *
 * Not in the source design file — that file is a screen gallery, so it navigates
 * through its own sidebar and never needed in-product navigation. On a real
 * phone there has to be a way to reach Limits or Alerts from Home, so this is
 * the one addition to the design, drawn in its existing visual language.
 */

const ICONS: Record<string, JSX.Element> = {
  home: (
    <path d="M3 9.5 11 3l8 6.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 18z" />
  ),
  map: (
    <>
      <path d="M11 19s6.5-6.2 6.5-10.5a6.5 6.5 0 1 0-13 0C4.5 12.8 11 19 11 19Z" />
      <circle cx="11" cy="8.5" r="2.4" />
    </>
  ),
  screentime: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="M11 6.5V11l3 2" />
    </>
  ),
  alerts: (
    <>
      <path d="M5.5 9a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H4S5.5 13 5.5 9Z" />
      <path d="M9 17.5a2 2 0 0 0 4 0" />
    </>
  ),
  pair: (
    <>
      <rect x="6" y="2.5" width="10" height="17" rx="2.5" />
      <path d="M9.5 16.5h3" />
    </>
  ),
  hub: <path d="M4 5.5h14v9.5H9.5L5.5 18.5V15H4z" />,
  report: (
    <>
      <path d="M5.5 3h7L17 7.5V19a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 5 19V3.5a.5.5 0 0 1 .5-.5Z" />
      <path d="M8.5 11.5v4M11 9v6.5M13.5 13v2.5" />
    </>
  ),
}

export function TabBar() {
  const { state, go } = useStore()
  const active = activeTab(state.screen)

  return (
    <nav className="safe-bottom flex shrink-0 items-stretch border-t border-line bg-white/95 px-1.5 pt-1.5 backdrop-blur">
      {TABS.map((t) => {
        const on = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            aria-current={on ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-bold transition ${
              on ? 'text-brand' : 'text-muted'
            }`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth={on ? 2.1 : 1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {ICONS[t.id]}
            </svg>
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

/** Detail screens keep their parent tab lit rather than clearing the bar. */
function activeTab(screen: ScreenId): ScreenId | null {
  if (screen === 'geofence') return 'map'
  if (screen === 'scenario' || screen === 'activity') return 'screentime'
  // Alerts no longer has its own tab; it and the acoustic detail hang off Home,
  // which is where the recent ones are surfaced.
  if (screen === 'alerts' || screen === 'acoustic') return 'home'
  if (screen === 'trail') return 'report'
  if (screen === 'childSetup' || screen === 'plans' || screen === 'contacts') return 'pair'
  if (screen === 'household') return 'pair'
  return TABS.some((t) => t.id === screen) ? screen : null
}

/** Whether the tab bar should show at all for a given screen. */
export function showsTabBar(screen: ScreenId): boolean {
  return activeTab(screen) !== null
}
