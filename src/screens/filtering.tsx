import { useState } from 'react'
import { normaliseDomain, useStore } from '../app/store'
import { useDevice } from '../platform/device'
import { BLOCK_CATEGORIES, type BlockCategory } from '../link/protocol'
import { fmtDuration } from '../app/store'
import { GhostButton, Meter, Pill, ScreenTitle, ToggleRow } from '../ui/kit'
import { ago } from './setup'

/**
 * Web filtering and the activity report.
 *
 * The honesty problem here is bigger than the UI. Filtering works by running a
 * local VPN on the child's phone that answers DNS lookups, so a parent needs to
 * understand three things: it only sees domain names, a browser using
 * DNS-over-HTTPS goes around it, and the child can switch the VPN off. All three
 * are stated on this screen rather than buried — a parent who believes they have
 * a perfect filter is worse off than one who knows its edges.
 */

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  adult: 'Adult content',
  violence: 'Violence & gore',
  gambling: 'Gambling & betting',
  social: 'Social media',
}

const CATEGORY_HINT: Record<BlockCategory, string> = {
  adult: 'Pornography and cam sites',
  violence: 'Graphic and shock sites',
  gambling: 'Betting, casinos and odds',
  social: 'TikTok, Instagram, Snapchat and similar',
}

type Tab = 'rules' | 'report'

export function Filtering() {
  const [tab, setTab] = useState<Tab>('rules')
  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>Web &amp; apps</ScreenTitle>
      <div className="flex rounded-[14px] bg-cream p-1">
        {(['rules', 'report'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-[11px] py-2 text-[12.5px] font-bold transition ${
              tab === t ? 'bg-white text-ink shadow-sm' : 'text-body'
            }`}
          >
            {t === 'rules' ? 'What to block' : 'What they did'}
          </button>
        ))}
      </div>
      {tab === 'rules' ? <Rules /> : <Report />}
    </div>
  )
}

/* -------------------------------------------------------------------- rules */

function Rules() {
  const { state, dispatch } = useStore()
  const usage = state.usageByChild[state.activeChildId]
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const warn = new Set(state.filters.warn ?? [])

  const add = () => {
    const domain = normaliseDomain(draft)
    if (!domain) {
      setError("That doesn't look like a website address.")
      return
    }
    dispatch({ type: 'addBlockedDomain', domain })
    setDraft('')
    setError(null)
  }

  const filterOff = usage != null && !usage.filterOn

  return (
    <>
      {filterOff ? (
        <div className="rounded-2xl bg-coralBg px-4 py-3 text-[12.5px] leading-relaxed text-coralInk">
          <b>Filtering is not running on their phone.</b> They need to accept the
          Nestly VPN prompt on their device — nothing is being blocked until they
          do.
        </div>
      ) : null}

      <div className="text-[13.5px] font-bold">Categories</div>
      <div className="flex flex-col gap-2">
        {BLOCK_CATEGORIES.map((c) => {
          const on = Boolean(state.filters[c as keyof typeof state.filters])
          return (
            <div key={c} className="rounded-2xl bg-cream px-3.5 py-3">
              <ToggleRow
                label={CATEGORY_LABEL[c]}
                hint={CATEGORY_HINT[c]}
                on={on}
                onChange={(v) => dispatch({ type: 'setFilter', key: c, value: v })}
              />
              {on ? (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'setWarnOnly', key: c, value: !warn.has(c) })}
                  className="mt-2.5 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2 text-left"
                >
                  <span className="text-[11.5px] text-body">
                    {warn.has(c)
                      ? 'Warn them, but let them continue'
                      : 'Block outright'}
                  </span>
                  <span className="text-[11px] font-bold text-brand">
                    {warn.has(c) ? 'Switch to blocking' : 'Switch to warning'}
                  </span>
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="mt-1 text-[13.5px] font-bold">Your own blocklist</div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="example.com"
          inputMode="url"
          autoCapitalize="none"
          className="flex-1 rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-brand"
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-[14px] bg-brand px-4 text-sm font-bold text-white"
        >
          Add
        </button>
      </div>
      {error ? <div className="text-[11.5px] text-coralInk">{error}</div> : null}

      <div className="flex flex-col gap-1.5">
        {state.filters.custom.map((d) => (
          <div
            key={d}
            className="flex items-center justify-between rounded-xl bg-cream px-3.5 py-2.5"
          >
            <span className="text-[12.5px]">{d}</span>
            <button
              type="button"
              onClick={() => dispatch({ type: 'removeBlockedDomain', domain: d })}
              className="text-[11.5px] font-bold text-coralInk"
            >
              Remove
            </button>
          </div>
        ))}
        {state.filters.custom.length === 0 ? (
          <div className="text-[11.5px] text-body">
            Nothing added yet. Blocking a site here also covers its subdomains.
          </div>
        ) : null}
      </div>

      <div className="mt-2 rounded-2xl bg-amberBg px-4 py-3 text-[11.5px] leading-relaxed text-[#8A5A16]">
        <b>What filtering can and cannot do.</b> It works by checking the site
        names their phone looks up, so it sees addresses only — never page
        content, never anything inside a message. A browser set to use "Secure
        DNS" can go around it, and your child can switch the Nestly VPN off. If
        they do, you get an alert straight away.
      </div>
    </>
  )
}

/* ------------------------------------------------------------------- report */

const CAT_COLOR: Record<string, string> = {
  social: '#8B7FD1',
  games: '#147D77',
  video: '#FFB84D',
  education: '#5FD3C4',
  other: '#C9C2B4',
}

function Report() {
  const { child } = useDevice()
  const { state } = useStore()
  const usage = state.usageByChild[state.activeChildId]

  if (!usage) {
    return (
      <div className="rounded-2xl bg-cream px-4 py-8 text-center text-[12.5px] leading-relaxed text-body">
        No report yet.
        <br />
        Their phone sends the day's summary when the two phones are next near
        each other.
      </div>
    )
  }

  const apps = [...usage.apps].sort((a, b) => b.minutes - a.minutes)
  const total = apps.reduce((n, a) => n + a.minutes, 0)
  const social = apps.filter((a) => a.category === 'social').reduce((n, a) => n + a.minutes, 0)
  const maxApp = apps[0]?.minutes ?? 1

  const sites = [...usage.sites].sort((a, b) => b.count - a.count)
  const blocked = sites.filter((s) => s.blocked)

  return (
    <>
      <div className="rounded-2xl bg-cream p-4">
        <div className="text-[12px] font-bold text-body">SCREEN TIME TODAY</div>
        <div className="mt-1 font-display text-[22px] font-bold">{fmtDuration(total)}</div>
        <div className="mt-0.5 text-[12px] text-body">
          {social > 0 ? `${fmtDuration(social)} of that on social media` : 'No social media today'}
          {child?.lastSeenAt ? ` · received ${ago(child.lastSeenAt)}` : ''}
        </div>
      </div>

      {!usage.usageAccess ? (
        <div className="rounded-2xl bg-amberBg px-4 py-3 text-[12px] leading-relaxed text-[#8A5A16]">
          <b>App times are unavailable.</b> Usage Access has not been granted on
          their phone — they can turn it on from the Nestly home screen there.
          Site history below still works.
        </div>
      ) : null}

      <div className="mt-1 text-[13.5px] font-bold">Apps</div>
      <div className="flex flex-col gap-2.5">
        {apps.slice(0, 12).map((a) => (
          <div key={a.pkg}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="min-w-0 truncate">{a.label}</span>
              <span className="shrink-0 text-body">{fmtDuration(a.minutes)}</span>
            </div>
            <Meter pct={(a.minutes / maxApp) * 100} color={CAT_COLOR[a.category] ?? '#C9C2B4'} />
          </div>
        ))}
        {apps.length === 0 ? (
          <div className="text-[11.5px] text-body">Nothing recorded today.</div>
        ) : null}
      </div>

      {blocked.length > 0 ? (
        <>
          <div className="mt-2 text-[13.5px] font-bold">Blocked attempts</div>
          <div className="flex flex-col gap-1.5">
            {blocked.slice(0, 15).map((s) => (
              <div
                key={s.domain}
                className="flex items-center justify-between rounded-xl bg-coralBg px-3.5 py-2.5"
              >
                <span className="min-w-0 truncate text-[12.5px] text-coralInk">{s.domain}</span>
                <span className="shrink-0 text-[11px] font-bold text-coralInk">
                  {s.cat ?? 'blocked'} · {s.count}×
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <div className="text-[13.5px] font-bold">Sites visited</div>
        <Pill tone="teal">{sites.length}</Pill>
      </div>
      <div className="flex flex-col gap-1.5">
        {sites.filter((s) => !s.blocked).slice(0, 25).map((s) => (
          <div
            key={s.domain}
            className="flex items-center justify-between rounded-xl bg-cream px-3.5 py-2.5"
          >
            <span className="min-w-0 truncate text-[12.5px]">{s.domain}</span>
            <span className="shrink-0 text-[11px] text-body">
              {s.count}× · {ago(s.lastAt)}
            </span>
          </div>
        ))}
        {sites.length === 0 ? (
          <div className="text-[11.5px] text-body">
            No browsing recorded. This needs filtering to be running on their
            phone.
          </div>
        ) : null}
      </div>

      <GhostButton className="mt-2">
        {usage.day} · domains only, never page content
      </GhostButton>
    </>
  )
}
