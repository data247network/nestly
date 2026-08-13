import { useEffect, useState } from 'react'
import { hasCloud, supabase } from '../cloud/client'
import { redeemAdultInvite, signIn, signUp } from '../cloud/sync'
import { Display } from '../ui/kit'

/**
 * Where a second adult accepts an invitation.
 *
 * Unlike a child's setup link, this person needs an account of their own: they
 * are a parent on the household, with the same view and the same powers, so
 * they sign in as themselves rather than inheriting a device secret.
 *
 * The code is held through sign-up and redeemed afterwards. Asking someone to
 * create an account and then find the link again is how invitations get
 * abandoned.
 */
/**
 * Reads a failed email confirmation out of the URL.
 *
 * Supabase reports these in the fragment (`#error=...&error_description=...`)
 * rather than as a request that fails, so without this they are invisible: the
 * page just renders the form again. The message is rewritten because Supabase's
 * own wording is written for developers and the fix — ask for a fresh
 * invitation, or sign in if the account already exists — is not in it.
 */
function authErrorFromUrl(): string | null {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const code = hash.get('error_code') ?? query.get('error_code')
    const raw = hash.get('error_description') ?? query.get('error_description')
    if (!code && !raw) return null

    if (code === 'otp_expired' || /expired/i.test(raw ?? '')) {
      return 'That confirmation link has expired. Sign in below if you already confirmed, or ask for a fresh invitation.'
    }
    return 'That confirmation link could not be used. Sign in below if you already have an account, or ask for a fresh invitation.'
  } catch {
    return null
  }
}

export function Join({ code }: { code: string | null }) {
  const [phase, setPhase] = useState<'checking' | 'auth' | 'joining' | 'done' | 'error'>(
    'checking',
  )
  const [isSignUp, setIsSignUp] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const join = async () => {
    if (!code) return setPhase('error')
    setPhase('joining')
    try {
      await redeemAdultInvite(code)
      setPhase('done')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That invitation could not be used.')
      setPhase('error')
    }
  }

  useEffect(() => {
    void (async () => {
      if (!hasCloud() || !code) return setPhase('error')

      // An expired or already-used confirmation link comes back as an error in
      // the URL fragment, not as a failed request. Nothing read it, so the page
      // rendered the sign-up form again as though they had never clicked
      // anything — and the second attempt fails with "already registered",
      // which explains none of it.
      const failure = authErrorFromUrl()
      if (failure) {
        setMessage(failure)
        setIsSignUp(false)
        setPhase('auth')
        return
      }

      const { data } = await supabase().auth.getSession()
      // Already signed in: nothing to ask, just join.
      if (data.session) return void join()
      setPhase('auth')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      if (isSignUp) {
        // Confirmation returns them to this same invitation rather than to the
        // front page, so the code survives the round trip through their inbox.
        const { signedIn } = await signUp(
          email,
          password,
          `${window.location.origin}/join/${code}`,
        )
        if (!signedIn) {
          setMessage(
            'Almost there — confirm your email. The link in it brings you straight back here and finishes joining.',
          )
          setBusy(false)
          return
        }
      } else {
        await signIn(email, password)
      }
      await join()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'checking') return <Centre>Checking your invitation…</Centre>
  if (phase === 'joining') return <Centre>Joining the family…</Centre>

  if (phase === 'done') {
    return (
      <Centre>
        <Display className="text-[24px]">You're in</Display>
        <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-body">
          You now share this family. You can see the same children, alerts and
          reports as the parent who invited you.
        </p>
        <a
          href="/hub"
          className="mt-5 rounded-xl bg-brand px-5 py-3 text-[13.5px] font-bold text-white"
        >
          Open Family Hub
        </a>
      </Centre>
    )
  }

  if (phase === 'error') {
    return (
      <Centre>
        <Display className="text-[22px]">This invitation didn't work</Display>
        <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-body">
          {message ??
            'The link may be incomplete, already used, or expired. Ask for a new one.'}
        </p>
        <a href="/" className="mt-5 text-[13px] font-bold text-brand">
          Back to Nestly
        </a>
      </Centre>
    )
  }

  return (
    <section className="mx-auto max-w-sm px-6 py-16">
      <span className="text-[12px] font-bold tracking-[0.06em] text-brand">
        JOIN A FAMILY
      </span>
      <Display className="mt-2 text-[26px]">
        {isSignUp ? 'Create your account' : 'Sign in to join'}
      </Display>
      <p className="mt-2 text-[13.5px] leading-relaxed text-body">
        You've been invited as a parent. Once you're in, you'll see the same
        children and alerts as the adult who invited you.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-3">
        <label className="text-[11.5px] font-bold tracking-[0.05em] text-body" htmlFor="je">
          EMAIL
        </label>
        <input
          id="je"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="-mt-1.5 rounded-xl border border-line px-4 py-3 text-[14px] outline-none focus:border-brand"
        />
        <label className="text-[11.5px] font-bold tracking-[0.05em] text-body" htmlFor="jp">
          PASSWORD
        </label>
        <input
          id="jp"
          type="password"
          required
          minLength={6}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="-mt-1.5 rounded-xl border border-line px-4 py-3 text-[14px] outline-none focus:border-brand"
        />

        {message ? (
          <div className="rounded-xl bg-amberBg px-3.5 py-2.5 text-[12.5px] text-[#8A5A16]">
            {message}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-xl bg-brand px-4 py-3 text-[14px] font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : isSignUp ? 'Create account and join' : 'Sign in and join'}
        </button>
      </form>

      <div className="mt-5 text-center text-[13px] text-body">
        {isSignUp ? 'Already have an account? ' : 'New here? '}
        <button
          type="button"
          onClick={() => {
            setIsSignUp((v) => !v)
            setMessage(null)
          }}
          className="font-bold text-brand"
        >
          {isSignUp ? 'Sign in' : 'Create account'}
        </button>
      </div>
    </section>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center text-[13.5px] leading-relaxed text-body">
      {children}
    </div>
  )
}
