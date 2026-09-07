import { useCallback, useEffect, useState } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import {
  cancelChore,
  createChore,
  loadChores,
  loadPendingChoreSubmissions,
  reviewChoreSubmission,
  type Chore,
  type ChoreSubmission,
} from '../cloud/v2'

/**
 * Screen Time Chore Exchange: a parent sets a chore and a reward, a child
 * marks it done, a parent verifies it before the reward counts.
 *
 * The verify step is deliberate and not just bureaucracy: a reward a child
 * could grant themselves by ticking a box is not a reward, it is a screen-time
 * bypass with a chore-shaped label on it. `reviewChoreSubmission` is the only
 * place a `reward_transactions` row gets written for a chore, and it runs
 * under the parent's own authenticated session.
 */
export function ChoresV2() {
  const { go } = useStore()
  const { household } = useCloudChildren()
  const [chores, setChores] = useState<Chore[]>([])
  const [pending, setPending] = useState<ChoreSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    if (!household) return
    setLoading(true)
    try {
      const [c, p] = await Promise.all([
        loadChores(household.id),
        loadPendingChoreSubmissions(household.id),
      ])
      setChores(c)
      setPending(p)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load chores.')
    } finally {
      setLoading(false)
    }
  }, [household])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = async (submission: ChoreSubmission, approved: boolean) => {
    setDeciding(submission.id)
    setError(null)
    try {
      await reviewChoreSubmission(submission, approved)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that submission.')
    } finally {
      setDeciding(null)
    }
  }

  const remove = async (chore: Chore) => {
    try {
      await cancelChore(chore.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that chore.')
    }
  }

  const childName = (id: string | null) =>
    id ? (household?.children.find((c) => c.id === id)?.name ?? 'A child') : 'Anyone'

  const live = chores.filter((c) => c.status === 'open' || c.status === 'submitted')

  return (
    <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7">
      <button onClick={() => go('v2control')} className="mb-5 w-fit text-xs font-bold text-brand">
        ← Control centre
      </button>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Chores &amp; rewards</h1>
          <p className="mt-1 text-xs text-body">Trade chores for a little extra screen time.</p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white"
        >
          {adding ? 'Close' : '+ Add chore'}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-line p-3 text-xs text-body">{error}</div> : null}

      {adding && household ? (
        <NewChoreForm
          householdId={household.id}
          children={household.children}
          onDone={async () => {
            setAdding(false)
            await refresh()
          }}
        />
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-bold">
          Needs your review{pending.length > 0 ? ` (${pending.length})` : ''}
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">Nothing waiting on you right now.</div>
        ) : (
          pending.map((s) => {
            const minutes = Number(s.chore?.reward.screenTimeMinutes ?? 0)
            return (
              <div key={s.id} className="mb-2 rounded-2xl border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <b className="text-sm">{s.chore?.title ?? 'Chore'}</b>
                    <div className="mt-1 text-[11px] text-body">
                      {childName(s.childId)} · reward: +{minutes} minutes
                    </div>
                  </div>
                </div>
                {s.note ? (
                  <p className="mt-2 rounded-xl bg-cream p-3 text-xs italic text-body">“{s.note}”</p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={deciding === s.id}
                    onClick={() => void decide(s, true)}
                    className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {deciding === s.id ? 'Working…' : `Verify & grant +${minutes}m`}
                  </button>
                  <button
                    disabled={deciding === s.id}
                    onClick={() => void decide(s, false)}
                    className="rounded-xl border border-line px-3 py-2 text-xs font-bold disabled:opacity-50"
                  >
                    Send back
                  </button>
                </div>
              </div>
            )
          })
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-bold">Open chores</h2>
        {loading ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">Loading…</div>
        ) : live.length === 0 ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">
            No chores yet. Add one and set what it earns.
          </div>
        ) : (
          live.map((c) => {
            const minutes = Number(c.reward.screenTimeMinutes ?? 0)
            return (
              <div key={c.id} className="mb-2 rounded-2xl bg-cream p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <b className="text-sm">{c.title}</b>
                    <div className="mt-1 text-[11px] text-body">
                      {childName(c.childId)} · +{minutes} minutes ·{' '}
                      {c.status === 'submitted' ? 'awaiting review' : 'open'}
                    </div>
                  </div>
                  <button onClick={() => void remove(c)} className="shrink-0 text-[11px] font-bold text-coralInk">
                    Remove
                  </button>
                </div>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}

function NewChoreForm({
  householdId,
  children,
  onDone,
}: {
  householdId: string
  children: { id: string; name: string }[]
  onDone: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [childId, setChildId] = useState('')
  const [minutes, setMinutes] = useState('15')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) {
      setError('Give the chore a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createChore(householdId, {
        title,
        childId: childId || null,
        rewardMinutes: Math.max(1, Math.min(240, Number(minutes) || 15)),
      })
      setTitle('')
      setMinutes('15')
      setChildId('')
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that chore.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line p-4">
      <label className="text-[11px] font-bold text-body">CHORE</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Tidy bedroom & pack school bag"
        className="mt-2 w-full rounded-xl border border-line px-3 py-2.5 text-sm"
      />

      <label className="mt-3 block text-[11px] font-bold text-body">FOR</label>
      <select
        value={childId}
        onChange={(e) => setChildId(e.target.value)}
        className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm"
      >
        <option value="">Anyone in the family</option>
        {children.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-[11px] font-bold text-body">REWARD (MINUTES)</label>
      <input
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        inputMode="numeric"
        className="mt-2 w-full rounded-xl border border-line px-3 py-2.5 text-sm"
      />

      {error ? <div className="mt-3 rounded-xl border border-line p-3 text-xs text-body">{error}</div> : null}

      <button
        disabled={busy}
        onClick={() => void submit()}
        className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add chore'}
      </button>
    </div>
  )
}
