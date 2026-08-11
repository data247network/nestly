import { useCallback, useEffect, useState } from 'react'
import { hasCloud } from '../cloud/client'
import {
  createChild,
  createInvite,
  currentSession,
  ensureHousehold,
  loadHousehold,
  removeChild,
  renameHousehold,
  signIn,
  signOut,
  signUp,
  type HouseholdSummary,
} from '../cloud/sync'
import { planOf } from '../app/plans'
import { Display } from '../ui/kit'

/**
 * Family Hub, on the web.
 *
 * This is the surface an account is *for*, and until now it existed only inside
 * the phone app — so "Sign in" on the website dropped a desktop visitor into a
 * phone UI stretched across their monitor, on whatever screen that install had
 * open. A parent signing up on a laptop could not reach their own household.
 *
 * It deliberately reuses `cloud/sync` rather than re-implementing anything: the
 * same auth, the same household resolution, the same invite minting the app
 * uses. Two implementations of "add a child" would drift, and the one that
 * drifted would be the one nobody tested on a phone.
 */

type Stage = 'checking' | 'anon' | 'ready' | 'error'

export function Hub({ intent }: { intent: 'signin' | 'signup' | 'hub' }) {
  const [stage, setStage] = useState<Stage>('checking')
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [data, setData] = useState<HouseholdSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    try {
      setData(await loadHousehold(id))
      setStage('ready')
    } catch {
      setStage('error')
    }
  }, [])

  /**
   * Resolves session then household, creating the household if this is a first
   * sign-in. Both steps are needed before anything can render: a signed-in
   * parent with no household is a valid state that lasts exactly as long as it
   * takes to make one, and showing "no family" in the meantime is a lie.
   */
  const resolve = useCallback(async () => {
    if (!hasCloud()) return setStage('error')
    const session = await currentSession()
    if (!session) return setStage('anon')
    try {
      const id = await ensureHousehold()
      if (!id) return setStage('error')
      setHouseholdId(id)
      await load(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : null)
      setStage('error')
    }
  }, [load])

  useEffect(() => {
    void resolve()
  }, [resolve])

  if (stage === 'checking') return <Centered>Loading your family…</Centered>

  if (stage === 'anon') {
    return <Auth mode={intent === 'signup' ? 'signup' : 'signin'} onDone={() => void resolve()} />
  }

  if (stage === 'error' || !data || !householdId) {
    return (
      <Centered>
        {error ?? 'Could not load your family.'}
        <button
          type="button"
          onClick={() => {
            setStage('checking')
            void resolve()
          }}
          className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-[13.5px] font-bold text-white"
        >
          Try again
        </button>
      </Centered>
    )
  }

  return <Family data={data} householdId={householdId} onChanged={() => void load(householdId)} />
}

/* -------------------------------------------------------------------- auth */

function Auth({ mode, onDone }: { mode: 'signin' | 'signup'; onDone: () => void }) {
  const [isSignUp, setIsSignUp] = useState(mode === 'signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isSignUp) {
        const { signedIn } = await signUp(email, password)
        // A confirmation-required project returns a user and no session. Saying
        // "welcome" here would be wrong: the very next call runs with no auth
        // and is refused by RLS.
        if (!signedIn) return setConfirm(true)
      } else {
        await signIn(email, password)
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (confirm) {
    return (
      <Centered>
        <b className="text-ink">Check your inbox</b>
        <p className="mt-2 max-w-sm">
          We sent a confirmation link to {email}. Open it, then sign in here.
        </p>
        <button
          type="button"
          onClick={() => {
            setConfirm(false)
            setIsSignUp(false)
          }}
          className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-[13.5px] font-bold text-white"
        >
          Back to sign in
        </button>
      </Centered>
    )
  }

  return (
    <section className="mx-auto max-w-sm px-6 py-16">
      <Display className="text-[27px]">
        {isSignUp ? 'Create your account' : 'Welcome back'}
      </Display>
      <p className="mt-2 text-[13.5px] leading-relaxed text-body">
        {isSignUp
          ? 'Your Family Hub is created with you as its first adult.'
          : 'Sign in to see your family.'}
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-3">
        <label className="text-[11.5px] font-bold tracking-[0.05em] text-body" htmlFor="email">
          EMAIL
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="-mt-1.5 rounded-xl border border-line px-4 py-3 text-[14px] outline-none focus:border-brand"
        />

        <label className="text-[11.5px] font-bold tracking-[0.05em] text-body" htmlFor="password">
          PASSWORD
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="-mt-1.5 rounded-xl border border-line px-4 py-3 text-[14px] outline-none focus:border-brand"
        />

        {error ? (
          <div className="rounded-xl bg-coralBg px-3.5 py-2.5 text-[12.5px] text-coralInk">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-xl bg-brand px-4 py-3 text-[14px] font-bold text-white transition hover:bg-brandDark disabled:opacity-50"
        >
          {busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <div className="mt-5 text-center text-[13px] text-body">
        {isSignUp ? 'Already have an account? ' : 'New family? '}
        <button
          type="button"
          onClick={() => {
            setIsSignUp((v) => !v)
            setError(null)
          }}
          className="font-bold text-brand"
        >
          {isSignUp ? 'Sign in' : 'Create account'}
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ family */

function Family({
  data,
  householdId,
  onChanged,
}: {
  data: HouseholdSummary
  householdId: string
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ code: string; name: string } | null>(null)
  const [editingName, setEditingName] = useState(false)

  const plan = planOf(data.plan as never)
  const atLimit = data.children.length >= plan.children

  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await createChild(householdId, name, '#147D77')
      const code = await createInvite(householdId, id)
      setInvite({ code, name: name.trim() || 'My child' })
      setName('')
      setAdding(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that child.')
    } finally {
      setBusy(false)
    }
  }

  const codeFor = async (child: { id: string; name: string }) => {
    setBusy(true)
    try {
      setInvite({ code: await createInvite(householdId, child.id), name: child.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code.')
    } finally {
      setBusy(false)
    }
  }

  if (invite) {
    return <InvitePanel {...invite} onDone={() => setInvite(null)} />
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {editingName ? (
            <HouseholdName
              initial={data.name}
              onSave={async (next) => {
                await renameHousehold(householdId, next)
                setEditingName(false)
                onChanged()
              }}
            />
          ) : (
            <Display className="text-[30px]">{data.name}</Display>
          )}
          <p className="mt-1.5 text-[13px] text-body">
            {plan.name} plan · {data.memberCount}{' '}
            {data.memberCount === 1 ? 'adult' : 'adults'} · {data.children.length} of{' '}
            {plan.children} children
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditingName((v) => !v)}
            className="rounded-xl border border-line px-3.5 py-2 text-[12.5px] font-bold text-body"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.assign('/'))}
            className="rounded-xl border border-line px-3.5 py-2 text-[12.5px] font-bold text-body"
          >
            Sign out
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-xl bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      <h2 className="mt-9 text-[12px] font-bold tracking-[0.06em] text-brand">CHILDREN</h2>

      <div className="mt-3 flex flex-col gap-2.5">
        {data.children.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3.5"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
              style={{ background: c.avatar }}
            >
              {c.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">{c.name}</div>
              <div className="text-[12px] text-body">
                {c.enrolledAt ? 'Phone linked' : 'No phone linked yet'}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void codeFor(c)}
              className="rounded-xl bg-tint px-3.5 py-2 text-[12.5px] font-bold text-brand disabled:opacity-50"
            >
              {c.enrolledAt ? 'New setup link' : 'Get setup link'}
            </button>
            <button
              type="button"
              onClick={() => void removeChild(c.id).then(onChanged)}
              className="rounded-xl px-2.5 py-2 text-[12.5px] font-bold text-coralInk"
            >
              Remove
            </button>
          </div>
        ))}

        {data.children.length === 0 && !adding ? (
          <div className="rounded-2xl border border-dashed border-line2 px-5 py-8 text-center text-[13px] leading-relaxed text-body">
            No children yet. Add one, then send them the setup link.
          </div>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-4 rounded-2xl border border-line p-5">
          <label htmlFor="child" className="text-[11.5px] font-bold tracking-[0.05em] text-body">
            THEIR NAME
          </label>
          <input
            id="child"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Eliora"
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-[14px] outline-none focus:border-brand"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-xl border border-line px-4 py-2.5 text-[13px] font-bold text-body"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void add()}
              className="rounded-xl bg-brand px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add child'}
            </button>
          </div>
        </div>
      ) : atLimit ? (
        <div className="mt-4 rounded-2xl bg-amberBg px-4 py-3.5 text-[12.5px] leading-relaxed text-[#8A5A16]">
          Your {plan.name} plan covers {plan.children} children. Upgrade to add another.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 rounded-xl border border-line px-4 py-3 text-[13.5px] font-bold text-brand"
        >
          + Add a child
        </button>
      )}
    </section>
  )
}

function HouseholdName({
  initial,
  onSave,
}: {
  initial: string
  onSave: (next: string) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-xl border border-line px-3.5 py-2 text-[18px] font-bold outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={() => void onSave(value)}
        className="rounded-xl bg-brand px-4 py-2 text-[13px] font-bold text-white"
      >
        Save
      </button>
    </div>
  )
}

/**
 * The setup link, on a screen a parent can actually work from.
 *
 * The link is what gets sent; the code is shown underneath because a link
 * pasted into some messengers arrives mangled, and reading eight characters
 * down the phone always works.
 */
function InvitePanel({
  code,
  name,
  onDone,
}: {
  code: string
  name: string
  onDone: () => void
}) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const link = `${window.location.origin}/setup/${code}`

  const copy = async (what: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(what === 'link' ? link : code)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* clipboard blocked; both are on screen */
    }
  }

  return (
    <section className="mx-auto max-w-xl px-6 py-14">
      <Display className="text-[27px]">Set up {name}'s phone</Display>
      <p className="mt-2 text-[13.5px] leading-relaxed text-body">
        Send this link to {name}. It walks them through installing the app and
        entering the code — they do not need an account of their own.
      </p>

      <div className="mt-6 break-all rounded-2xl bg-cream px-4 py-3.5 text-[13px] text-slate2">
        {link}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy('link')}
          className="rounded-xl bg-brand px-4 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-brandDark"
        >
          {copied === 'link' ? 'Copied' : 'Copy setup link'}
        </button>
        <button
          type="button"
          onClick={() => void copy('code')}
          className="rounded-xl border border-line px-4 py-2.5 text-[13.5px] font-bold text-body"
        >
          {copied === 'code' ? 'Copied' : 'Copy code only'}
        </button>
      </div>

      <div className="mt-6 rounded-2xl bg-tint py-6 text-center">
        <div className="text-[11.5px] font-bold tracking-[0.05em] text-tealInk">SETUP CODE</div>
        <Display className="mt-1.5 text-[32px] tracking-[0.12em] text-brand">
          {code.slice(0, 4)}-{code.slice(4)}
        </Display>
        <div className="mt-2 text-[11.5px] text-tealInk">
          Expires in 24 hours · links one phone only
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-6 rounded-xl border border-line px-4 py-3 text-[13.5px] font-bold text-body"
      >
        Back to my family
      </button>
    </section>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center text-[13.5px] leading-relaxed text-body">
      {children}
    </div>
  )
}
