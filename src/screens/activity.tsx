import { useMemo, useState } from 'react'
import { useStore, type IngestedEvent } from '../app/store'
import { useDevice } from '../platform/device'
import { Pill, ScreenTitle } from '../ui/kit'
import { ago } from './setup'

/**
 * The activity trail.
 *
 * The alerts feed answers "does anything need me now?". This answers "what
 * actually happened?" — the complete record the child device recorded, whether
 * or not anyone was in range at the time, grouped by day.
 *
 * It is the honest counterpart to the transparency screen on the child's phone:
 * everything here is something the child has been told is shared.
 */

type Filter = 'all' | 'places' | 'routines' | 'device'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'places', label: 'Places' },
  { id: 'routines', label: 'Routines' },
  { id: 'device', label: 'Device' },
]

function bucketOf(kind: string): Filter {
  if (kind.startsWith('zone-')) return 'places'
  if (kind.startsWith('scenario-') || kind.startsWith('lock-')) return 'routines'
  return 'device'
}

export function ActivityTrail() {
  const { state } = useStore()
  const { child, link } = useDevice()
  const [filter, setFilter] = useState<Filter>('all')

  const shown = useMemo(
    () => state.activity.filter((e) => filter === 'all' || bucketOf(e.kind) === filter),
    [state.activity, filter],
  )

  const days = useMemo(() => groupByDay(shown), [shown])
  const today = useMemo(() => summarise(state.activity), [state.activity])

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>Activity</ScreenTitle>
      <Segments current="trail" />

      <div className="rounded-2xl bg-cream p-4">
        <div className="text-[12px] font-bold text-body">TODAY</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <span>
            <b>{today.arrivals}</b> arrival{today.arrivals === 1 ? '' : 's'}
          </span>
          <span>
            <b>{today.departures}</b> departure{today.departures === 1 ? '' : 's'}
          </span>
          <span>
            <b>{today.routines}</b> routine{today.routines === 1 ? '' : 's'} run
          </span>
        </div>
        <div className="mt-1.5 text-[11.5px] leading-snug text-body">
          {link.state === 'connected'
            ? 'Up to date — both phones are connected.'
            : child?.lastSeenAt
              ? `Last received ${ago(child.lastSeenAt)}. Anything since then is still on their phone.`
              : "Nothing received yet. Their phone is recording and will hand it over when you're next together."}
        </div>
      </div>

      <div className="no-scrollbar -mx-[22px] flex gap-2 overflow-x-auto px-[22px]">
        {FILTERS.map((f) => (
          <Pill key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Pill>
        ))}
      </div>

      {days.length === 0 ? (
        <div className="rounded-2xl bg-cream px-4 py-8 text-center text-[12.5px] leading-relaxed text-body">
          Nothing recorded yet.
          <br />
          Add a zone on the Map tab and their phone will start logging arrivals
          and departures.
        </div>
      ) : null}

      {days.map(([label, events]) => (
        <section key={label}>
          <div className="mb-2 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
            {label}
          </div>
          <div className="flex flex-col">
            {events.map((e, i) => (
              <TrailRow key={e.seq} event={e} last={i === events.length - 1} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Shared header switch between "needs you now" and the full record. */
export function Segments({ current }: { current: 'alerts' | 'trail' }) {
  const { go } = useStore()
  const item = (id: 'alerts' | 'trail', label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => go(id)}
      className={`flex-1 rounded-[11px] py-2 text-[12.5px] font-bold transition ${
        current === id ? 'bg-white text-ink shadow-sm' : 'text-body'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex rounded-[14px] bg-cream p-1">
      {item('alerts', 'Needs you')}
      {item('trail', 'Everything')}
    </div>
  )
}

function TrailRow({ event, last }: { event: IngestedEvent; last: boolean }) {
  const { tone, label } = describe(event)
  return (
    <div className="flex gap-3">
      {/* Timeline spine: a dot per event, joined except at the end of a day. */}
      <div className="flex w-3 shrink-0 flex-col items-center pt-1.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
        {!last ? <span className="w-px flex-1 bg-line" /> : null}
      </div>
      <div className={`min-w-0 flex-1 ${last ? 'pb-0' : 'pb-3.5'}`}>
        <div className="text-[13px] leading-snug">{label}</div>
        <div className="text-[11.5px] text-body">
          {new Date(event.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

function describe(e: IngestedEvent): { tone: string; label: string } {
  switch (e.kind) {
    case 'zone-enter':
      return { tone: 'bg-brand', label: `Arrived at ${e.ref ?? 'a saved place'}` }
    case 'zone-leave':
      return { tone: 'bg-coral', label: `Left ${e.ref ?? 'a saved place'}` }
    case 'scenario-start':
      return { tone: 'bg-violet', label: `${e.ref ?? 'A routine'} started` }
    case 'scenario-end':
      return { tone: 'bg-violet', label: `${e.ref ?? 'A routine'} ended` }
    case 'lock-shown':
      return { tone: 'bg-violet', label: 'Phone locked' }
    case 'lock-dismissed':
      return { tone: 'bg-amber', label: 'Left the lock screen' }
    case 'battery-low':
      return { tone: 'bg-amber', label: 'Battery ran low' }
    case 'agent-start':
      return { tone: 'bg-muted', label: 'Nestly started on their phone' }
    case 'tamper':
      return { tone: 'bg-coral', label: `Protection turned off — ${e.ref ?? 'unknown'}` }
    default:
      return { tone: 'bg-muted', label: e.kind }
  }
}

/** Newest day first, events within a day newest first. */
function groupByDay(events: IngestedEvent[]): [string, IngestedEvent[]][] {
  const out = new Map<string, IngestedEvent[]>()
  for (const e of events) {
    const label = dayLabel(e.ts)
    const list = out.get(label)
    if (list) list.push(e)
    else out.set(label, [e])
  }
  return [...out.entries()]
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const daysAgo = Math.floor((midnight.getTime() - d.getTime()) / 86_400_000)
  if (daysAgo < 0) return 'Today'
  if (daysAgo < 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })
}

function summarise(events: IngestedEvent[]) {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const todays = events.filter((e) => e.ts >= midnight.getTime())
  return {
    arrivals: todays.filter((e) => e.kind === 'zone-enter').length,
    departures: todays.filter((e) => e.kind === 'zone-leave').length,
    routines: todays.filter((e) => e.kind === 'scenario-start').length,
  }
}

/** Compact recent-activity block for the Home screen. */
export function RecentActivity({ onSeeAll }: { onSeeAll: () => void }) {
  const { state } = useStore()
  // `agent-start` fires every time the child's app launches, so on a phone
  // that has been opened a few times it filled this whole block with three
  // identical rows and pushed the real activity off Home. It stays in the full
  // trail, where "the agent restarted" is genuinely useful.
  const recent = state.activity.filter((a) => a.kind !== 'agent-start').slice(0, 3)
  if (recent.length === 0) return null

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-sm font-bold">Recent activity</div>
        <button type="button" onClick={onSeeAll} className="text-xs font-bold text-brand">
          See all
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {recent.map((e) => {
          const { tone, label } = describe(e)
          return (
            <div key={e.seq} className="flex items-center gap-2.5 text-[12.5px]">
              <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 text-[11.5px] text-body">
                {new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
