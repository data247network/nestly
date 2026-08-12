import { useEffect, useState } from 'react'
import { hasCloud, supabase } from '../cloud/client'
import { Display } from '../ui/kit'
import { ago } from './Dashboard'

/**
 * The business dashboard.
 *
 * Everything here crosses household boundaries, which row-level security exists
 * to prevent — so none of it is queried from the browser. The page holds no
 * privileged key and no table names it could abuse: it sends the signed-in
 * user's token to `admin-stats`, and that function decides whether this person
 * is staff before any data is read.
 *
 * A non-admin gets a 404 rather than a 403, and this page shows exactly that.
 * Telling someone "forbidden" confirms the admin area exists and is worth
 * attacking; telling them "not found" does not.
 */

type Stats = {
  totals: {
    households: number
    parents: number
    children: number
    childrenEnrolled: number
    subscriptions: number
    downloads7d: number
    countries: number
  }
  downloadsByDay: { day: string; parent: number; child: number }[]
  subscriptionsByStatus: Record<string, number>
  planMix: Record<string, number>
  topCountries: { country: string; count: number }[]
  recent: { kind: string; label: string; at: string }[]
  generatedAt: string
}

type State =
  | { s: 'loading' }
  | { s: 'anon' }
  | { s: 'denied' }
  | { s: 'error'; message: string }
  | { s: 'ready'; stats: Stats }

export function Admin() {
  const [state, setState] = useState<State>({ s: 'loading' })

  useEffect(() => {
    void (async () => {
      if (!hasCloud()) return setState({ s: 'error', message: 'No backend configured.' })

      const { data } = await supabase().auth.getSession()
      const token = data.session?.access_token
      if (!token) return setState({ s: 'anon' })

      try {
        const url = import.meta.env.VITE_SUPABASE_URL as string
        const res = await fetch(`${url}/functions/v1/admin-stats`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
            Authorization: `Bearer ${token}`,
          },
        })
        if (res.status === 404) return setState({ s: 'denied' })
        if (res.status === 401) return setState({ s: 'anon' })
        if (!res.ok) return setState({ s: 'error', message: `Request failed (${res.status}).` })
        setState({ s: 'ready', stats: (await res.json()) as Stats })
      } catch {
        setState({ s: 'error', message: 'Could not reach the service.' })
      }
    })()
  }, [])

  if (state.s === 'loading') return <Note>Loading…</Note>
  if (state.s === 'anon') {
    return (
      <Note>
        Sign in first.{' '}
        {/* Carries where to come back to. Without it, signing in lands on the
            parent dashboard and the admin has to find their way here again,
            which reads as the sign-in having failed. */}
        <a className="font-bold text-brand" href="/signin?next=/admin">
          Go to sign in
        </a>
      </Note>
    )
  }
  if (state.s === 'denied') return <Note>Page not found.</Note>
  if (state.s === 'error') return <Note>{state.message}</Note>

  const t = state.stats.totals
  const peak = Math.max(1, ...state.stats.downloadsByDay.map((d) => d.parent + d.child))

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <Display className="text-[28px]">Admin dashboard</Display>
      <p className="mt-1 text-[13px] text-body">
        Across every household · updated {ago(state.stats.generatedAt)}
      </p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Families" value={t.households} />
        <Tile label="Parents" value={t.parents} />
        <Tile label="Children" value={t.children} note={`${t.childrenEnrolled} linked`} />
        <Tile label="Subscriptions" value={t.subscriptions} />
        <Tile label="Downloads (7d)" value={t.downloads7d} note={`${t.countries} countries`} />
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Panel title="Downloads, last 7 days">
          {/* A plain bar chart. A charting library for seven bars would be more
              bytes than the rest of this page. */}
          <div className="flex h-40 items-end gap-2">
            {state.stats.downloadsByDay.map((d) => {
              const total = d.parent + d.child
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="text-[11px] font-bold text-body">{total || ''}</div>
                  <div
                    className="w-full rounded-t-md bg-brand"
                    style={{ height: `${(total / peak) * 100}%`, minHeight: total ? 4 : 1 }}
                    title={`${d.day}: ${d.parent} parent, ${d.child} child`}
                  />
                  <div className="text-[10px] text-muted">{d.day.slice(5)}</div>
                </div>
              )
            })}
          </div>
          {t.downloads7d === 0 ? (
            <p className="mt-3 text-[12px] leading-relaxed text-body">
              No downloads recorded yet. Counting started when this dashboard was
              built, so this covers downloads from the portal only.
            </p>
          ) : null}
        </Panel>

        <Panel title="Plans in use">
          <Breakdown data={state.stats.planMix} empty="No households yet." />
          {Object.keys(state.stats.subscriptionsByStatus).length > 0 ? (
            <>
              <div className="mt-4 text-[11.5px] font-bold tracking-[0.04em] text-body">
                SUBSCRIPTION STATUS
              </div>
              <Breakdown data={state.stats.subscriptionsByStatus} empty="" />
            </>
          ) : (
            <p className="mt-4 text-[12px] leading-relaxed text-body">
              No paid subscriptions yet — billing is not connected.
            </p>
          )}
        </Panel>

        <Panel title="Top countries">
          {state.stats.topCountries.length === 0 ? (
            <p className="text-[12px] text-body">
              Country comes from download requests; none recorded yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {state.stats.topCountries.map((c) => (
                <li key={c.country} className="flex justify-between text-[13px]">
                  <span className="font-bold">{c.country}</span>
                  <span className="text-body">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity">
          {state.stats.recent.length === 0 ? (
            <p className="text-[12px] text-body">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {state.stats.recent.map((r, i) => (
                <li key={`${r.at}-${i}`} className="flex justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="shrink-0 text-[11.5px] text-muted">{ago(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  )
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="text-[11.5px] font-bold tracking-[0.04em] text-body">{label}</div>
      <div className="mt-1 text-[26px] font-extrabold text-ink">{value}</div>
      {note ? <div className="text-[11px] text-muted">{note}</div> : null}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-5">
      <h2 className="mb-3 text-[13.5px] font-bold">{title}</h2>
      {children}
    </div>
  )
}

function Breakdown({ data, empty }: { data: Record<string, number>; empty: string }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, [, n]) => s + n, 0)
  if (rows.length === 0) return empty ? <p className="text-[12px] text-body">{empty}</p> : null

  return (
    <ul className="flex flex-col gap-2">
      {rows.map(([name, n]) => (
        <li key={name}>
          <div className="flex justify-between text-[12.5px]">
            <span className="font-bold capitalize">{name}</span>
            <span className="text-body">
              {n} · {Math.round((n / total) * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-cream">
            <div
              className="h-1.5 rounded-full bg-brand"
              style={{ width: `${(n / total) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6 text-center text-[13.5px] text-body">
      {children}
    </div>
  )
}
