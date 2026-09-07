import { useCallback, useEffect, useState } from 'react'
import { useCloudChildren } from '../app/CloudWatch'
import { useStore } from '../app/store'
import { KEYS, loadJSON, saveJSON } from '../platform/storage'
import {
  acknowledgeChoreProgress,
  cancelChore,
  createChore,
  loadChoreHistory,
  loadChores,
  loadPendingChoreSubmissions,
  reviewChoreSubmission,
  type Chore,
  type ChoreSubmission,
} from '../cloud/v2'

/**
 * Screen Time Task Exchange: a parent sets a task and a reward, a child
 * marks it done, a parent verifies it before the reward counts.
 *
 * The verify step is deliberate and not just bureaucracy: a reward a child
 * could grant themselves by ticking a box is not a reward, it is a screen-time
 * bypass with a task-shaped label on it. `reviewChoreSubmission` is the only
 * place a `reward_transactions` row gets written for a task, and it runs
 * under the parent's own authenticated session.
 */
export function ChoresV2() {
  const { go } = useStore()
  const { household } = useCloudChildren()
  const [chores, setChores] = useState<Chore[]>([])
  const [pending, setPending] = useState<ChoreSubmission[]>([])
  const [history, setHistory] = useState<Chore[]>([])
  const [historyClearedAt, setHistoryClearedAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void loadJSON<number>(KEYS.taskHistoryClearedAt, 0).then(setHistoryClearedAt)
  }, [])

  const refresh = useCallback(async () => {
    if (!household) return
    setLoading(true)
    try {
      const [c, p, h] = await Promise.all([
        loadChores(household.id),
        loadPendingChoreSubmissions(household.id),
        loadChoreHistory(household.id),
      ])
      setChores(c)
      setPending(p)
      setHistory(h)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks.')
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
    setNotice(null)
    try {
      const { zeroed } = await reviewChoreSubmission(submission, approved)
      if (approved && zeroed) {
        setNotice(`${submission.chore?.title ?? 'That task'} was completed after its deadline — no reward was granted.`)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that submission.')
    } finally {
      setDeciding(null)
    }
  }

  const acknowledge = async (chore: Chore) => {
    setDeciding(chore.id)
    try {
      await acknowledgeChoreProgress(chore.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that task.')
    } finally {
      setDeciding(null)
    }
  }

  const remove = async (chore: Chore) => {
    try {
      await cancelChore(chore.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that task.')
    }
  }

  const childName = (id: string | null) =>
    id ? (household?.children.find((c) => c.id === id)?.name ?? 'A child') : 'Anyone'

  const open = chores.filter((c) => c.status === 'open')
  const inProgressOrNotDone = chores.filter((c) => c.status === 'in_progress' || c.status === 'not_done')
  const attentionCount = pending.length + inProgressOrNotDone.length
  const visibleHistory = history.filter((c) => new Date(c.createdAt).getTime() > historyClearedAt)

  const clearHistory = () => {
    const now = Date.now()
    setHistoryClearedAt(now)
    void saveJSON(KEYS.taskHistoryClearedAt, now)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-[22px] pb-8 pt-7">
      <button onClick={() => go('v2control')} className="mb-5 w-fit text-xs font-bold text-brand">
        ← Control centre
      </button>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tasks &amp; Rewards</h1>
          <p className="mt-1 text-xs text-body">Trade tasks for a little extra screen time.</p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white"
        >
          {adding ? 'Close' : '+ Add task'}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-line p-3 text-xs text-body">{error}</div> : null}
      {notice ? <div className="mt-4 rounded-xl bg-amberBg p-3 text-xs text-[#8A5A16]">{notice}</div> : null}

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
          Needs your attention{attentionCount > 0 ? ` (${attentionCount})` : ''}
        </h2>
        {attentionCount === 0 ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">Nothing waiting on you right now.</div>
        ) : (
          <>
            {pending.map((s) => {
              const minutes = Number(s.chore?.reward.screenTimeMinutes ?? 0)
              const overdue = s.chore?.dueAt != null && new Date(s.submittedAt).getTime() > new Date(s.chore.dueAt).getTime()
              return (
                <div key={s.id} className="mb-2 rounded-2xl border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <b className="text-sm">{s.chore?.title ?? 'Task'}</b>
                      <div className="mt-1 text-[11px] text-body">
                        {childName(s.childId)} · reward: +{minutes} minutes
                        {overdue ? ' · completed after the deadline, will grant 0' : ''}
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
                      {deciding === s.id ? 'Working…' : overdue ? 'Verify (0m — late)' : `Verify & grant +${minutes}m`}
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
            })}
            {inProgressOrNotDone.map((c) => (
              <div key={c.id} className="mb-2 rounded-2xl border border-line p-4">
                <b className="text-sm">{c.title}</b>
                <div className="mt-1 text-[11px] text-body">
                  {childName(c.childId)} ·{' '}
                  {c.status === 'in_progress' ? (
                    <span className="font-bold text-tealInk">in progress</span>
                  ) : (
                    <span className="font-bold text-coralInk">could not finish</span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={deciding === c.id}
                    onClick={() => void acknowledge(c)}
                    className="rounded-xl bg-brand px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {deciding === c.id ? 'Working…' : 'Acknowledge'}
                  </button>
                  <button onClick={() => void remove(c)} className="rounded-xl border border-line px-3 py-2 text-xs font-bold text-coralInk">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-bold">Open tasks</h2>
        {loading ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">Loading…</div>
        ) : open.length === 0 ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">
            No tasks yet. Add one and set what it earns.
          </div>
        ) : (
          open.map((c) => {
            const minutes = Number(c.reward.screenTimeMinutes ?? 0)
            return (
              <div key={c.id} className="mb-2 rounded-2xl bg-cream p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <b className="text-sm">{c.title}</b>
                    <div className="mt-1 text-[11px] text-body">
                      {childName(c.childId)} · +{minutes} minutes · open
                      {c.dueAt ? ` · due ${new Date(c.dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
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

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">History</h2>
          {visibleHistory.length > 0 ? (
            <button onClick={clearHistory} className="text-[11px] font-bold text-brand">Clear history</button>
          ) : null}
        </div>
        {visibleHistory.length === 0 ? (
          <div className="rounded-2xl bg-cream p-4 text-xs text-body">Nothing here yet.</div>
        ) : (
          visibleHistory.map((c) => {
            const minutes = Number(c.reward.screenTimeMinutes ?? 0)
            const label =
              c.status === 'completed' ? `+${minutes} minutes granted` : c.status === 'declined' ? 'Declined' : c.status === 'not_done' ? 'Not done' : 'Cancelled'
            return (
              <div key={c.id} className="mb-2 rounded-2xl bg-cream p-4">
                <b className="text-sm">{c.title}</b>
                <div className="mt-1 text-[11px] text-body">{childName(c.childId)} · {label}</div>
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
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) {
      setError('Give the task a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createChore(householdId, {
        title,
        childId: childId || null,
        rewardMinutes: Math.max(1, Math.min(240, Number(minutes) || 15)),
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      })
      setTitle('')
      setMinutes('15')
      setChildId('')
      setDueAt('')
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that task.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line p-4">
      <label className="text-[11px] font-bold text-body">TASK</label>
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

      <label className="mt-3 block text-[11px] font-bold text-body">DUE BY (OPTIONAL)</label>
      <input
        type="datetime-local"
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="mt-2 w-full rounded-xl border border-line px-3 py-2.5 text-sm"
      />
      <p className="mt-1 text-[10.5px] leading-snug text-body">
        Left blank, this task never expires. Set it and a completion after
        this time still counts as done, but earns no reward.
      </p>

      {error ? <div className="mt-3 rounded-xl border border-line p-3 text-xs text-body">{error}</div> : null}

      <button
        disabled={busy}
        onClick={() => void submit()}
        className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add task'}
      </button>
    </div>
  )
}
