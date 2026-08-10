import { Screen } from '../app/Router'
import { LABELS, NAV_GROUPS, WEB_SCREENS } from '../app/nav'
import { useStore } from '../app/store'
import type { ScreenId } from '../app/types'
import { Wordmark } from '../ui/kit'
import { TabBar, showsTabBar } from '../ui/TabBar'
import { BrowserFrame, PhoneFrame } from './frames'

/**
 * Desktop review surface: every screen of all three versions, reachable from one
 * sidebar, rendered inside a real device frame.
 *
 * This is what the source design file was — a gallery — so it is kept, but here
 * the frames contain the *live* app rather than static markup. Narrow viewports
 * and the Android build skip this entirely and run the app fullscreen.
 */
export function Showcase() {
  const { state, go } = useStore()
  const isWeb = WEB_SCREENS.includes(state.screen)

  return (
    <div className="flex min-h-screen bg-cream text-ink">
      <aside className="thin-scrollbar sticky top-0 flex h-screen w-[250px] shrink-0 flex-col gap-[22px] overflow-y-auto border-r border-line bg-white px-4 py-[26px]">
        <div className="px-2">
          <Wordmark />
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.name} className="flex flex-col gap-[3px]">
            <div className="mb-[3px] px-2.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted">
              {group.name}
            </div>
            {group.items.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                className={`rounded-[10px] px-2.5 py-[9px] text-left text-[13.5px] transition ${
                  state.screen === id
                    ? 'bg-tint font-bold text-brand'
                    : 'font-semibold text-ink hover:bg-cream'
                }`}
              >
                {LABELS[id]}
              </button>
            ))}
          </div>
        ))}

        {/*
          Without this the deployed site is a gallery with no way into the real
          product, which is exactly how it read to someone visiting the URL.
        */}
        <a
          href="?app=1"
          className="mt-auto rounded-xl bg-brand px-3 py-2.5 text-center text-[12.5px] font-bold text-white"
        >
          Open the live app →
        </a>

        <p className="px-2.5 text-[11px] leading-relaxed text-muted">
          Live app — every toggle, slider and message box here is the same code
          that ships in the APK.
        </p>
      </aside>

      <main className="flex flex-1 items-start justify-center overflow-auto px-[30px] py-11">
        {isWeb ? (
          <BrowserFrame sidebar={<WebSidebar current={state.screen} onGo={go} />}>
            <Screen id={state.screen} />
          </BrowserFrame>
        ) : (
          <PhoneFrame>
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Screen id={state.screen} />
              </div>
              {showsTabBar(state.screen) ? <TabBar /> : null}
            </div>
          </PhoneFrame>
        )}
      </main>
    </div>
  )
}

const WEB_NAV: { id: ScreenId; label: string }[] = [
  { id: 'webOverview', label: 'Overview' },
  { id: 'webSplit', label: 'Map & Activity' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'paywall', label: 'Plans' },
]

function WebSidebar({ current, onGo }: { current: ScreenId; onGo: (id: ScreenId) => void }) {
  return (
    <>
      {WEB_NAV.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => onGo(n.id)}
          className={`rounded-[10px] px-3 py-2.5 text-left text-[13px] transition ${
            current === n.id ? 'bg-tint font-bold text-brand' : 'font-semibold text-ink hover:bg-cream'
          }`}
        >
          {n.label}
        </button>
      ))}
    </>
  )
}
