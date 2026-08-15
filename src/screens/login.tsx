import { useState } from 'react'
import { hasCloud } from '../cloud/client'
import {
  ensureHousehold,
  existingHouseholdId,
  redeemAdultInvite,
  requestPasswordReset,
  resendConfirmation,
  signIn as cloudSignIn,
  signUp as cloudSignUp,
} from '../cloud/sync'
import { KEYS, saveJSON } from '../platform/storage'
import { Display, Field, FieldLabel, GhostButton, PrimaryButton, Wordmark } from '../ui/kit'

/**
 * The sign-in gate.
 *
 * Two modes, chosen by whether the cloud is configured at build time:
 *
 *   cloud on  — real Supabase accounts, and the household is created or joined
 *               on first sign-in.
 *   cloud off — a built-in credential held on the device. Worth being blunt
 *               about: that is a **local gate, not authentication**. It stops
 *               someone picking up an unlocked parent phone and changing the
 *               rules, which is a real household threat, but it proves nothing
 *               to anyone else and protects no data in transit.
 *
 * Keeping both is the point. Nestly's promise is that two phones work with no
 * server, so a build without cloud credentials has to stay fully usable rather
 * than presenting a sign-in nobody can complete.
 */

export const DEFAULT_EMAIL = 'parent@nestly.family'
export const DEFAULT_PASSWORD = 'nestly'

/** The offline gate. Unused when the cloud is configured. */
export function checkCredentials(email: string, password: string): boolean {
  return email.trim().toLowerCase() === DEFAULT_EMAIL && password === DEFAULT_PASSWORD
}

/**
 * Where the household id lands so the sync layer can pick it up later.
 *
 * Re-exported from the key registry rather than declared here, so the callers
 * that already import it from this screen keep working while there is only one
 * definition of the string.
 */
export const HOUSEHOLD_KEY = KEYS.household

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const cloud = hasCloud()
  const [email, setEmail] = useState(cloud ? '' : DEFAULT_EMAIL)
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  /**
   * Which screen we are on.
   *
   * `choose` is reached only by a signed-in account with no family — the one
   * moment where "start a new one" and "join an existing one" are both
   * plausible and only the person can say which.
   */
  const [stage, setStage] = useState<'auth' | 'choose' | 'reset'>('auth')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)

  const submit = async () => {
    setError(null)
    setNotice(null)

    if (!cloud) {
      if (checkCredentials(email, password)) onSignedIn()
      else setError('That email and password do not match.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'signup') {
        const { signedIn } = await cloudSignUp(email.trim(), password)
        // Email confirmation leaves a user with no session. Nothing is
        // authenticated yet, so creating the household here would be refused —
        // send them to sign in once they have confirmed instead.
        if (!signedIn) {
          setMode('signin')
          setPassword('')
          setNotice('Account created. Confirm your email, then sign in below.')
          return
        }
      } else {
        await cloudSignIn(email.trim(), password)
      }

      // Signed in for real from here.
      //
      // Belonging to a family is *asked*, never assumed. This used to call
      // `ensureHousehold` unconditionally, which creates one when it finds
      // none — correct for the parent who signed up first, and quietly wrong
      // for everybody after them. A second parent was handed a brand new empty
      // "My family" of their own and then reported, entirely fairly, that the
      // app was not syncing. It was. There was nothing in the household it had
      // just invented for them, and the family they meant to join was
      // somewhere else with a code they were never asked for.
      try {
        const existing = await existingHouseholdId()
        if (existing) {
          await saveJSON(HOUSEHOLD_KEY, existing)
          onSignedIn()
          return
        }
        // No family yet: let them say which they meant.
        setStage('choose')
        return
      } catch {
        // Deliberately not fatal. The session is valid; blocking entry over a
        // failed lookup would strand a signed-in parent behind a login screen.
        // The bridges retry, and Bluetooth is unaffected.
        onSignedIn()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  /** Starts a family of their own. Only from the chooser, never implicitly. */
  const startFamily = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await ensureHousehold()
      if (id) await saveJSON(HOUSEHOLD_KEY, id)
      onSignedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your family.')
    } finally {
      setBusy(false)
    }
  }

  /** Joins the family an invitation points at. */
  const joinFamily = async () => {
    setBusy(true)
    setError(null)
    try {
      const id = await redeemAdultInvite(code.trim().toUpperCase())
      await saveJSON(HOUSEHOLD_KEY, id)
      onSignedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code could not be used.')
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'choose') {
    return (
      <div className="flex h-full flex-col overflow-y-auto px-[26px] py-[38px]">
        <div className="mb-9">
          <Wordmark />
        </div>
        <Display className="mb-1.5 text-[23px]">Which family?</Display>
        <p className="mb-[26px] text-[13.5px] leading-relaxed text-body">
          If another parent already set yours up, they can send you a join code
          from their Family Hub — use it here so you both see the same children.
        </p>

        {error ? (
          <div className="mb-4 rounded-[14px] bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
            {error}
          </div>
        ) : null}

        <FieldLabel>JOIN CODE</FieldLabel>
        <Field value={code} onChange={setCode} placeholder="ABCD2345" />
        <div className="mt-3">
          <PrimaryButton onClick={() => !busy && code.trim() && void joinFamily()}>
            {busy ? 'Joining…' : 'Join this family'}
          </PrimaryButton>
        </div>

        <div className="my-6 border-t border-line" />

        <p className="mb-3 text-[13px] leading-relaxed text-body">
          Nobody has set one up yet? Start your own — you can invite the other
          adult afterwards.
        </p>
        <GhostButton onClick={() => !busy && void startFamily()}>
          {busy ? 'Working…' : 'Start a new family'}
        </GhostButton>
      </div>
    )
  }

  if (stage === 'reset') {
    return (
      <div className="flex h-full flex-col overflow-y-auto px-[26px] py-[38px]">
        <div className="mb-9">
          <Wordmark />
        </div>
        <Display className="mb-1.5 text-[23px]">Reset your password</Display>
        <p className="mb-[26px] text-[13.5px] leading-relaxed text-body">
          We'll email you a link. Open it on this phone and you can set a new
          one.
        </p>

        {error ? (
          <div className="mb-4 rounded-[14px] bg-coralBg px-4 py-3 text-[12.5px] text-coralInk">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-[14px] bg-tint px-4 py-3 text-[12.5px] text-tealInk">
            {notice}
          </div>
        ) : null}

        <FieldLabel>EMAIL</FieldLabel>
        <Field value={email} onChange={setEmail} placeholder="you@example.com" />
        <div className="mt-3">
          <PrimaryButton
            onClick={() => {
              if (busy || !email.trim()) return
              setBusy(true)
              setError(null)
              setNotice(null)
              void requestPasswordReset(email.trim(), `${window.location.origin}/hub`)
                .then(() =>
                  // Said the same way whether or not the address exists. "No
                  // such account" here would turn this box into a way to find
                  // out who has one.
                  setNotice('If that address has an account, the link is on its way.'),
                )
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : 'Could not send that email.'),
                )
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Sending…' : 'Send reset link'}
          </PrimaryButton>
        </div>
        <div className="mt-4">
          <GhostButton onClick={() => setStage('auth')}>Back to sign in</GhostButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-[26px] py-[38px]">
      <div className="mb-9">
        <Wordmark />
      </div>

      <Display className="mb-1.5 text-[23px]">
        {mode === 'signup' ? 'Create your account' : 'Welcome back'}
      </Display>
      <p className="mb-[26px] text-[13.5px] text-body">
        {mode === 'signup'
          ? 'One account for the whole family. Your child’s phone never needs one.'
          : 'Sign in to check in on your family.'}
      </p>

      <div className="mb-4 flex flex-col gap-3">
        <div>
          <FieldLabel>EMAIL</FieldLabel>
          <Field value={email} onChange={setEmail} placeholder="you@example.com" />
        </div>
        <div>
          <FieldLabel>PASSWORD</FieldLabel>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="••••••••"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 pr-16 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] font-bold text-brand"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          {cloud && mode === 'signin' ? (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setNotice(null)
                setStage('reset')
              }}
              className="mt-2 text-[12px] font-bold text-brand"
            >
              Forgot your password?
            </button>
          ) : null}
        </div>
      </div>

      {/* Only when the failure was specifically an unconfirmed address.
          Telling somebody to sign up again gets them "already registered",
          which reads as a dead end when their first email simply never
          arrived. */}
      {cloud && error && /confirm/i.test(error) ? (
        <button
          type="button"
          onClick={() => {
            setBusy(true)
            void resendConfirmation(email.trim(), `${window.location.origin}/hub`)
              .then(() => {
                setError(null)
                setNotice('Confirmation email sent again. Check your inbox and spam.')
              })
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'Could not resend that email.'),
              )
              .finally(() => setBusy(false))
          }}
          disabled={busy || !email.trim()}
          className="mb-4 w-full rounded-[14px] bg-tint px-4 py-3 text-[12.5px] font-bold text-tealInk disabled:opacity-50"
        >
          Send the confirmation email again
        </button>
      ) : null}

      {notice ? (
        <div className="mb-4 rounded-xl bg-tint px-3.5 py-2.5 text-[12.5px] text-tealInk">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-xl bg-coralBg px-3.5 py-2.5 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      <PrimaryButton className="mb-3" onClick={() => void submit()}>
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </PrimaryButton>

      {cloud ? (
        <>
          <GhostButton
            onClick={() => {
              setMode(mode === 'signup' ? 'signin' : 'signup')
              setError(null)
            }}
          >
            {mode === 'signup' ? 'I already have an account' : 'Create a new account'}
          </GhostButton>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
            An account adds updates while you’re apart. The phones still work
            over Bluetooth without one.
          </p>
        </>
      ) : (
        /*
          Stated plainly rather than hidden. Anyone testing this build needs the
          credential, and pretending there is real authentication behind it
          would be worse than admitting there is not.
        */
        <div className="rounded-2xl bg-cream px-4 py-3 text-[11.5px] leading-relaxed text-body">
          <b className="text-ink">Test build.</b> Sign in with{' '}
          <b className="text-ink">{DEFAULT_EMAIL}</b> and the password{' '}
          <b className="text-ink">{DEFAULT_PASSWORD}</b>. This is a local gate on
          this phone only — real accounts arrive with the online service.
        </div>
      )}
    </div>
  )
}
