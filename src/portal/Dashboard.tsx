import { Display } from '../ui/kit'
import type { DashboardStats, HouseholdSummary } from '../cloud/sync'

/**
 * The signed-in parent dashboard.
 *
 * A sidebar and a row of status cards, because a parent arriving on a laptop
 * wants the answer to "is everything alright?" before they want any control.
 * The phone app answers that with a home screen; on a monitor there is room to
 * answer it without scrolling.
 *
 * Every figure comes from a table. Nothing here is illustrative — see
 * `loadStats`, which returns null rather than zero for anything not yet
 * measured, so "no data" and "none happened" stay distinguishable.
 */

export type HubSection =
  | 'dashboard'
  | 'children'
  | 'devices'
  | 'activity'
  | 'alerts'
  | 'billing'
  | 'settings'

const NAV: { id: HubSection; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'children', label: 'Children', icon: '☺' },
  { id: 'devices', label: 'Devices', icon: '▢' },
  { id: 'activity', label: 'Activity', icon: '◷' },
  { id: 'alerts', label: 'Alerts', icon: '!' },
  { id: 'billing', label: 'Plan & billing', icon: '◈' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

export function HubChrome({
  section,
  onSection,
  email,
  onSignOut,
  children,
}: {
  section: HubSection
  onSection: (s: HubSection) => void
  email: string | null
  onSignOut: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-6xl gap-6 px-4 py-8 md:px-6">
      <aside className="hidden w-52 shrink-0 md:block">
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSection(n.id)}
              className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-bold transition ${
                section === n.id ? 'bg-brand text-white' : 'text-body hover:bg-cream'
              }`}
            >
              <span aria-hidden className="w-4 text-center opacity-80">
                {n.icon}
              </span>
              {n.label}
            </button>
          ))}
        </nav>

        <div className="mt-6 rounded-2xl bg-cream p-3.5">
          <div className="truncate text-[12px] font-bold text-ink">{email ?? 'Signed in'}</div>
          <div className="text-[11px] text-body">Parent</div>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2 text-[11.5px] font-bold text-coralInk"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Small screens get the same sections as a scrolling strip rather than a
          drawer — six items is short enough that hiding them costs more than it
          saves. */}
      <div className="min-w-0 flex-1">
        <div className="mb-5 flex gap-1.5 overflow-x-auto md:hidden">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSection(n.id)}
              className={`shrink-0 rounded-xl px-3 py-2 text-[12.5px] font-bold ${
                section === n.id ? 'bg-brand text-white' : 'bg-cream text-body'
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- overview */

export function Overview({
  data,
  stats,
  email,
  name,
  onAddChild,
}: {
  data: HouseholdSummary
  stats: DashboardStats | null
  email: string | null
  name: string | null
  onAddChild: () => void
}) {
  const linked = data.children.filter((c) => c.enrolledAt).length

  return (
    <>
      {/* Named when we know it, plain when we do not. Greeting someone by a
          guessed name is worse than not greeting them at all. */}
      <Display className="text-[26px]">
        {name ? `Welcome back, ${name}` : 'Welcome back'}
      </Display>
      <p className="mt-1 text-[13.5px] text-body">
        Here's what's happening with your family.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Parent profile">
          <div className="text-[13.5px] font-bold text-ink">{email ?? 'Parent'}</div>
          <div className="mt-0.5 text-[12px] text-body">{data.name}</div>
        </Card>

        <Card title="Family Hub status">
          <div className="flex items-center gap-2">
            <Dot ok />
            <span className="text-[13.5px] font-bold text-brand">Active</span>
          </div>
          <div className="mt-0.5 text-[12px] text-body">
            {data.memberCount} {data.memberCount === 1 ? 'adult' : 'adults'} on this account
          </div>
        </Card>

        <Card title="Paired child devices">
          <div className="text-[13.5px] font-bold text-ink">
            {linked} of {data.children.length}{' '}
            {data.children.length === 1 ? 'child' : 'children'}
          </div>
          <div className="mt-0.5 text-[12px] text-body">
            {linked === data.children.length && linked > 0
              ? 'All phones linked'
              : 'Some phones not linked yet'}
          </div>
        </Card>
      </div>

      <h2 className="mt-8 text-[12px] font-bold tracking-[0.06em] text-brand">
        RECENT ACTIVITY OVERVIEW
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Locations tracked" value={num(stats?.locationsToday)} note="Today" />
        <Stat label="Screen time" value={hours(stats?.screenTimeMinutes)} note="Today" />
        <Stat label="Alerts" value={num(stats?.alertsToday)} note="Today" />
        <Stat label="Last sync" value={ago(stats?.lastSyncAt)} note="Cloud sync" />
      </div>

      {data.children.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line2 px-5 py-8 text-center">
          <p className="text-[13.5px] text-body">
            Add your first child, then send them the setup link.
          </p>
          <button
            type="button"
            onClick={onAddChild}
            className="mt-3 rounded-xl bg-brand px-4 py-2.5 text-[13.5px] font-bold text-white"
          >
            Add a child
          </button>
        </div>
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------ primitives */

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="text-[11.5px] font-bold tracking-[0.04em] text-body">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl bg-cream p-4">
      <div className="text-[11.5px] font-bold tracking-[0.04em] text-body">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold text-ink">{value}</div>
      <div className="text-[11px] text-muted">{note}</div>
    </div>
  )
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-brand' : 'bg-muted'}`}
    />
  )
}

/* Formatters. All of them render an em dash for "not measured", never a zero. */

function num(n: number | null | undefined): string {
  return n == null ? '—' : String(n)
}

function hours(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'Just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
