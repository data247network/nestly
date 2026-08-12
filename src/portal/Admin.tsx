import { useCallback, useEffect, useState } from 'react'
import { hasCloud, supabase } from '../cloud/client'
import { adminSetHouseholdPlan, loadPlans, signOut, type PlanRow } from '../cloud/sync'
import { Display } from '../ui/kit'
import { ago } from './Dashboard'
import { PlanEditor } from './PlanEditor'

/**
 * The business dashboard.
 *
 * Everything here crosses household boundaries, which row-level security exists
 * to prevent — so none of it is queried from the browser. This page holds no
 * privileged key and names no tables. It sends the caller's token to
 * `admin-api`, which decides whether they are staff before reading anything.
 *
 * A non-admin gets 404, and this page shows exactly that. "Forbidden" would
 * confirm the admin area exists and is worth attacking.
 *
 * Destructive actions are deliberately awkward: banning and deleting both take
 * a second, explicit confirmation, because the row you meant and the row above
 * it look identical at a glance and one of these cannot be undone.
 */

type Household = { id: string; name: string; plan: string; role: string }

type Parent = {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  banned: boolean
  households: Household[]
  adminRole: string | null
  isSelf: boolean
}

type Family = {
  id: string
  name: string
  plan: string
  createdAt: string
  adults: number
  children: number
  childrenEnrolled: number
  subscription: { provider: string; plan: string; status: string } | null
}

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
  planMix: Record<string, number>
  subscriptionsByStatus: Record<string, number>
  topCountries: { country: string; count: number }[]
  recent: { label: string; at: string }[]
  generatedAt: string
}

type Section = 'dashboard' | 'parents' | 'families' | 'settings'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'parents', label: 'Parents', icon: '☺' },
  { id: 'families', label: 'Families', icon: '⌂' },
  { id: 'settings', label: 'Plans & billing', icon: '◈' },
]

/** Every admin call goes through here, so the auth header is never forgotten. */
async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('NOT_SIGNED_IN')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  })

  if (res.status === 401) throw new Error('NOT_SIGNED_IN')
  if (res.status === 404) throw new Error('NOT_ADMIN')
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`)
  return body as T
}

export function Admin() {
  const [section, setSection] = useState<Section>('dashboard')
  const [gate, setGate] = useState<'checking' | 'anon' | 'denied' | 'ok'>('checking')
  const [email, setEmail] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      if (!hasCloud()) return setGate('denied')
      const { data } = await supabase().auth.getSession()
      if (!data.session) return setGate('anon')
      setEmail(data.session.user.email ?? null)
      try {
        setStats(await callAdmin<Stats>('stats'))
        setGate('ok')
      } catch (e) {
        const m = e instanceof Error ? e.message : ''
        if (m === 'NOT_SIGNED_IN') return setGate('anon')
        if (m === 'NOT_ADMIN') return setGate('denied')
        setError(m)
        setGate('ok')
      }
    })()
  }, [])

  if (gate === 'checking') return <Note>Loading…</Note>
  if (gate === 'anon') {
    return (
      <Note>
        Sign in first.{' '}
        <a className="font-bold text-brand" href="/signin?next=/admin">
          Go to sign in
        </a>
      </Note>
    )
  }
  if (gate === 'denied') return <Note>Page not found.</Note>

  return (
    <div className="mx-auto flex min-h-[75vh] max-w-6xl gap-6 px-4 py-8 md:px-6">
      <aside className="hidden w-52 shrink-0 md:block">
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-bold transition ${
                section === n.id ? 'bg-ink text-white' : 'text-body hover:bg-cream'
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
          <div className="truncate text-[12px] font-bold text-ink">{email ?? 'Admin'}</div>
          <div className="text-[11px] text-body">System administrator</div>
          <div className="mt-2 flex flex-col gap-1">
            <a href="/hub" className="text-[11.5px] font-bold text-brand">
              Open Family Hub
            </a>
            <button
              type="button"
              onClick={() => void signOut().then(() => window.location.assign('/'))}
              className="text-left text-[11.5px] font-bold text-coralInk"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-5 flex gap-1.5 overflow-x-auto md:hidden">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={`shrink-0 rounded-xl px-3 py-2 text-[12.5px] font-bold ${
                section === n.id ? 'bg-ink text-white' : 'bg-cream text-body'
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-xl bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
            {error}
          </div>
        ) : null}

        {section === 'dashboard' ? (
          <Overview stats={stats} onGoParents={() => setSection('parents')} />
        ) : section === 'parents' ? (
          <Parents />
        ) : section === 'families' ? (
          <Families />
        ) : (
          <PlanEditor />
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- overview */

function Overview({ stats, onGoParents }: { stats: Stats | null; onGoParents: () => void }) {
  if (!stats) return <Note>No data.</Note>
  const t = stats.totals
  const peak = Math.max(1, ...stats.downloadsByDay.map((d) => d.parent + d.child))

  return (
    <>
      <Display className="text-[26px]">Admin dashboard</Display>
      <p className="mt-1 text-[13px] text-body">
        Across every household · updated {ago(stats.generatedAt)}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Families" value={t.households} />
        <Tile label="Parents" value={t.parents} onClick={onGoParents} />
        <Tile label="Children" value={t.children} note={`${t.childrenEnrolled} linked`} />
        <Tile label="Subscriptions" value={t.subscriptions} />
        <Tile label="Downloads (7d)" value={t.downloads7d} note={`${t.countries} countries`} />
      </div>

      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <Panel title="Downloads, last 7 days">
          <div className="flex h-36 items-end gap-2">
            {stats.downloadsByDay.map((d) => {
              const total = d.parent + d.child
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="text-[11px] font-bold text-body">{total || ''}</div>
                  <div
                    className="w-full rounded-t-md bg-brand"
                    style={{ height: `${(total / peak) * 100}%`, minHeight: total ? 4 : 1 }}
                  />
                  <div className="text-[10px] text-muted">{d.day.slice(5)}</div>
                </div>
              )
            })}
          </div>
          {t.downloads7d === 0 ? (
            <p className="mt-3 text-[12px] leading-relaxed text-body">
              Nothing recorded yet. Counting only covers downloads made from the
              portal since this was built.
            </p>
          ) : null}
        </Panel>

        <Panel title="Plans in use">
          <Breakdown data={stats.planMix} empty="No households yet." />
        </Panel>

        <Panel title="Recent activity">
          {stats.recent.length === 0 ? (
            <p className="text-[12px] text-body">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {stats.recent.map((r, i) => (
                <li key={i} className="flex justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="shrink-0 text-[11.5px] text-muted">{ago(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top countries">
          {stats.topCountries.length === 0 ? (
            <p className="text-[12px] text-body">
              Country comes from download requests; none recorded yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stats.topCountries.map((c) => (
                <li key={c.country} className="flex justify-between text-[13px]">
                  <span className="font-bold">{c.country}</span>
                  <span className="text-body">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- parents */

function Parents() {
  const [rows, setRows] = useState<Parent[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ id: string; what: 'ban' | 'delete' } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows((await callAdmin<{ parents: Parent[] }>('parents')).parents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load parents.')
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (p: Parent, what: 'ban' | 'unban' | 'delete') => {
    setBusy(p.id)
    setError(null)
    setNotice(null)
    try {
      if (what === 'delete') {
        const res = await callAdmin<{ orphaned: { name: string }[] }>('deleteUser', {
          userId: p.id,
        })
        if (res.orphaned.length > 0) {
          setNotice(
            `Deleted. ${res.orphaned.map((o) => o.name).join(', ')} now ${
              res.orphaned.length === 1 ? 'has' : 'have'
            } no adults — review under Families.`,
          )
        }
      } else {
        await callAdmin('setBan', { userId: p.id, banned: what === 'ban' })
      }
      setConfirming(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  if (!rows) return <Note>Loading parents…</Note>

  return (
    <>
      <Display className="text-[26px]">Parents</Display>
      <p className="mt-1 text-[13px] text-body">
        {rows.length} {rows.length === 1 ? 'account' : 'accounts'}. Banning blocks
        sign-in and can be undone; deleting cannot.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4 rounded-xl bg-amberBg px-4 py-3 text-[12.5px] text-[#8A5A16]">
          {notice}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {rows.map((p) => (
          <div key={p.id} className="rounded-2xl border border-line px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold">{p.email ?? '(no email)'}</span>
                  {p.adminRole ? <Badge tone="brand">admin · {p.adminRole}</Badge> : null}
                  {p.banned ? <Badge tone="coral">banned</Badge> : null}
                  {p.isSelf ? <Badge tone="muted">you</Badge> : null}
                </div>
                <div className="mt-0.5 text-[12px] text-body">
                  {p.households.length > 0
                    ? p.households.map((h) => `${h.name} (${h.plan}, ${h.role})`).join(' · ')
                    : 'No family'}
                </div>
                <div className="text-[11px] text-muted">
                  Joined {new Date(p.created_at).toLocaleDateString()} · last sign-in{' '}
                  {p.last_sign_in_at ? ago(p.last_sign_in_at) : 'never'}
                </div>
              </div>

              {/* Self-actions are hidden, not merely refused. The server rejects
                  them too, but an admin should never be invited to lock
                  themselves out of the only tool that could undo it. */}
              {p.isSelf ? (
                <span className="text-[11.5px] text-muted">Your own account</span>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() =>
                      p.banned
                        ? void act(p, 'unban')
                        : setConfirming({ id: p.id, what: 'ban' })
                    }
                    className="rounded-xl bg-cream px-3 py-2 text-[12px] font-bold text-body disabled:opacity-50"
                  >
                    {p.banned ? 'Unban' : 'Ban'}
                  </button>
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => setConfirming({ id: p.id, what: 'delete' })}
                    className="rounded-xl px-3 py-2 text-[12px] font-bold text-coralInk disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {confirming?.id === p.id ? (
              <div className="mt-3 rounded-xl bg-coralBg px-3.5 py-3">
                <div className="text-[12.5px] text-coralInk">
                  {confirming.what === 'delete' ? (
                    <>
                      Permanently delete <b>{p.email}</b>? Their sign-in is removed
                      and cannot be restored.
                      {p.households.length > 0
                        ? ' Any family left with no adults will be flagged.'
                        : ''}
                    </>
                  ) : (
                    <>
                      Ban <b>{p.email}</b>? They will not be able to sign in. Their
                      family and data are untouched, and you can undo this.
                    </>
                  )}
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => void act(p, confirming.what === 'delete' ? 'delete' : 'ban')}
                    className="rounded-xl bg-coralInk px-3.5 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                  >
                    {busy === p.id
                      ? 'Working…'
                      : confirming.what === 'delete'
                        ? 'Delete permanently'
                        : 'Ban this account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-xl px-3 py-2 text-[12px] font-bold text-body"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  )
}

/* --------------------------------------------------------------- families */

function Families() {
  const [rows, setRows] = useState<Family[] | null>(null)
  // Options come from the catalogue, not a literal. A hardcoded list drifts the
  // moment a plan is created here, and offering an id that does not exist sets
  // a household to a plan with no limits behind it.
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows((await callAdmin<{ families: Family[] }>('families')).families)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load families.')
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
    void loadPlans().then(setPlans).catch(() => setPlans([]))
  }, [load])

  const setPlan = async (f: Family, plan: string) => {
    setBusy(f.id)
    setError(null)
    try {
      await adminSetHouseholdPlan(f.id, plan)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the plan.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (f: Family) => {
    setBusy(f.id)
    try {
      await callAdmin('deleteHousehold', { householdId: f.id })
      setConfirming(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that family.')
    } finally {
      setBusy(null)
    }
  }

  if (!rows) return <Note>Loading families…</Note>

  return (
    <>
      <Display className="text-[26px]">Families</Display>
      <p className="mt-1 text-[13px] text-body">
        Changing a plan takes effect immediately and changes how many children
        that family may add.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {rows.map((f) => (
          <div key={f.id} className="rounded-2xl border border-line px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold">{f.name}</div>
                <div className="mt-0.5 text-[12px] text-body">
                  {f.adults} {f.adults === 1 ? 'adult' : 'adults'} · {f.children}{' '}
                  {f.children === 1 ? 'child' : 'children'} ({f.childrenEnrolled} linked)
                </div>
                <div className="text-[11px] text-muted">
                  Created {new Date(f.createdAt).toLocaleDateString()}
                  {f.subscription
                    ? ` · ${f.subscription.provider} ${f.subscription.status}`
                    : ' · no subscription record'}
                </div>
              </div>

              <label className="text-[11.5px] font-bold text-body">
                Plan{' '}
                <select
                  value={f.plan}
                  disabled={busy === f.id}
                  onChange={(e) => void setPlan(f, e.target.value)}
                  className="ml-1 rounded-xl border border-line px-2.5 py-2 text-[12.5px] font-bold text-ink"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.maxChildren}c / {p.maxParents}a)
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                disabled={busy === f.id}
                onClick={() => setConfirming(f.id)}
                className="rounded-xl px-3 py-2 text-[12px] font-bold text-coralInk disabled:opacity-50"
              >
                Delete
              </button>
            </div>

            {confirming === f.id ? (
              <div className="mt-3 rounded-xl bg-coralBg px-3.5 py-3">
                <div className="text-[12.5px] text-coralInk">
                  Delete <b>{f.name}</b> and its {f.children}{' '}
                  {f.children === 1 ? 'child' : 'children'}, with all their history?
                  This cannot be undone. Parent accounts are not removed.
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === f.id}
                    onClick={() => void remove(f)}
                    className="rounded-xl bg-coralInk px-3.5 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                  >
                    {busy === f.id ? 'Working…' : 'Delete permanently'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-xl px-3 py-2 text-[12px] font-bold text-body"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {rows.length === 0 ? <Note>No families yet.</Note> : null}
      </div>
    </>
  )
}

/* ------------------------------------------------------------ primitives */

function Tile({
  label,
  value,
  note,
  onClick,
}: {
  label: string
  value: number
  note?: string
  onClick?: () => void
}) {
  const inner = (
    <>
      <div className="text-[11.5px] font-bold tracking-[0.04em] text-body">{label}</div>
      <div className="mt-1 text-[26px] font-extrabold text-ink">{value}</div>
      {note ? <div className="text-[11px] text-muted">{note}</div> : null}
    </>
  )
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-line p-4 text-left transition hover:border-brand"
    >
      {inner}
    </button>
  ) : (
    <div className="rounded-2xl border border-line p-4">{inner}</div>
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

function Badge({ tone, children }: { tone: 'brand' | 'coral' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'brand'
      ? 'bg-tint text-brand'
      : tone === 'coral'
        ? 'bg-coralBg text-coralInk'
        : 'bg-cream text-body'
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>{children}</span>
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
            <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(n / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6 text-center text-[13.5px] text-body">
      {children}
    </div>
  )
}
