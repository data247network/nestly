import { fmtDuration, useStore } from '../app/store'
import { stamp } from '../app/time'
import { Avatar, Bars, Display, MapCanvas } from '../ui/kit'

/**
 * Version 3 — the web dashboard.
 *
 * Same data as the parent app, laid out for a desk rather than a pocket: two
 * children side by side, a map that keeps the activity feed visible next to it,
 * and the billing screen (which is deliberately web-only — app-store rules make
 * in-app plan changes more trouble than they're worth).
 */

export function WebOverview() {
  const { state } = useStore()
  const barColors: Record<string, [string, string]> = {
    maya: ['#5FD3C4', '#147D77'],
    leo: ['#FFD08A', '#FFB84D'],
  }

  return (
    <div className="flex flex-col gap-[22px] px-[34px] py-[30px]">
      <Display className="text-[23px]">The Rivera Family</Display>

      <div className="flex flex-wrap gap-4">
        {state.children.map((c) => {
          const [base, accent] = barColors[c.id] ?? ['#5FD3C4', '#147D77']
          return (
            <div key={c.id} className="min-w-[240px] flex-1 rounded-[18px] bg-cream p-[18px]">
              <div className="mb-3 flex items-center gap-2.5">
                <Avatar name={c.name} color={c.avatar} size={34} />
                <div>
                  <div className="text-sm font-bold">
                    {c.name}, {c.age}
                  </div>
                  <div className="text-[11.5px] text-body">{c.status}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[11.5px] text-body">Screen today</div>
                  <div className="text-[13px] font-bold">{fmtDuration(c.screenMinutes)}</div>
                </div>
              </div>
              <Bars values={c.trend} color={base} accent={accent} />
            </div>
          )
        })}
      </div>

      <div>
        <div className="mb-3 text-[15px] font-bold">Recent alerts</div>
        <div className="overflow-hidden rounded-[14px] border border-line">
          {state.alerts.map((a, i) => (
            <div
              key={a.id}
              className={`flex justify-between px-4 py-3 text-[12.5px] ${
                i % 2 ? 'bg-parchment' : 'bg-white'
              } ${i ? 'border-t border-line' : ''}`}
            >
              <span>
                {a.title} — {a.who}
              </span>
              <span className="text-body">{stamp(a.ts)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const LIVE = [
  { text: 'Maya opened', bold: 'TikTok', tail: '· 1:58 PM' },
  { text: 'Leo entered', bold: 'Home', tail: 'zone · 1:40 PM' },
  { text: 'Maya blocked from', bold: 'bet365.com', tail: '· 11:40 AM' },
  { text: 'Maya arrived at', bold: 'School', tail: '· 8:02 AM' },
]

export function WebSplit() {
  return (
    <div className="flex h-full">
      <MapCanvas
        className="flex-[1.2]"
        height="100%"
        zones={[
          { top: 80, left: 120, size: 180, color: '#147D77' },
          { top: 200, left: 340, size: 120, color: '#8B7FD1' },
        ]}
        pins={[{ top: 150, left: 190 }]}
      />
      <div className="w-[340px] shrink-0 overflow-y-auto border-l border-line p-[22px]">
        <div className="mb-3.5 text-[15px] font-bold">Live activity</div>
        <div className="flex flex-col gap-2.5">
          {LIVE.map((l) => (
            <div key={l.bold + l.tail} className="rounded-xl bg-cream px-3.5 py-3 text-[12.5px]">
              {l.text} <b>{l.bold}</b> {l.tail}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const FREE_FEATURES = [
  'Location & geofences',
  'Screen time & scenarios',
  'Web filtering',
  'Acoustic safety alerts',
  'Full activity history',
]

const PAID_FEATURES = ['Same full feature set', 'Billed per additional child', 'Add or remove anytime']

export function Paywall() {
  const { state, dispatch } = useStore()
  const monthly = state.billing === 'monthly'

  return (
    <div className="flex flex-col items-center gap-[22px] p-[34px]">
      <Display className="text-2xl">Choose your family plan</Display>

      <div className="flex rounded-[14px] bg-cream p-1">
        {(['monthly', 'annual'] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => dispatch({ type: 'billing', value: b })}
            className={`rounded-[11px] px-5 py-2.5 text-[13px] font-bold transition ${
              state.billing === b ? 'bg-brand text-white' : 'text-body'
            }`}
          >
            {b === 'monthly' ? 'Monthly' : 'Annual · save 25%'}
          </button>
        ))}
      </div>

      <div className="flex w-full max-w-[640px] flex-wrap gap-[22px]">
        <div className="min-w-[260px] flex-1 rounded-[20px] border-[1.5px] border-line p-6">
          <div className="mb-1 text-base font-bold">Family plan</div>
          <div className="mb-4 text-[12.5px] text-body">1 parent + 2 kids included</div>
          <Display className="mb-[18px] text-[26px]">$0</Display>
          <ul className="flex flex-col gap-2.5 text-[12.5px] text-slate2">
            {FREE_FEATURES.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        </div>

        <div className="relative min-w-[260px] flex-1 rounded-[20px] border-2 border-brand bg-tint p-6">
          <span className="absolute -top-[11px] right-5 rounded-lg bg-brand px-2.5 py-1 text-[10.5px] font-bold text-white">
            3RD KID &amp; UP
          </span>
          <div className="mb-1 text-base font-bold">Additional kids</div>
          <div className="mb-4 text-[12.5px] text-tealInk">For each child beyond your first 2</div>
          <Display className="mb-[18px] text-[26px]">
            {monthly ? '$3.99' : '$34'}
            <span className="text-[13px] font-semibold text-tealInk">
              {monthly ? '/mo per child' : '/yr per child'}
            </span>
          </Display>
          <ul className="flex flex-col gap-2.5 text-[12.5px] text-ink">
            {PAID_FEATURES.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        </div>
      </div>

      <button
        type="button"
        className="mt-1.5 rounded-2xl bg-brand px-10 py-3.5 text-sm font-bold text-white transition active:scale-[0.98]"
      >
        Add a 3rd child
      </button>
    </div>
  )
}
