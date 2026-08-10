import { useState } from 'react'
import { hasCloud } from '../cloud/client'
import { ensureHousehold, signIn as cloudSignIn, signUp as cloudSignUp } from '../cloud/sync'
import { saveJSON } from '../platform/storage'
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

/** Where the household id lands so the sync layer can pick it up later. */
export const HOUSEHOLD_KEY = 'nestly.household'

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const cloud = hasCloud()
  const [email, setEmail] = useState(cloud ? '' : DEFAULT_EMAIL)
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
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

      // Signed in for real from here. The household is created by a database
      // trigger in the same transaction as the insert, so it can never exist
      // without a member.
      try {
        const householdId = await ensureHousehold()
        if (householdId) await saveJSON(HOUSEHOLD_KEY, householdId)
      } catch {
        // Deliberately not fatal. The session is valid; blocking entry over a
        // failed household lookup would strand a signed-in parent behind a
        // login screen. CloudBridge retries, and Bluetooth is unaffected.
      }

      onSignedIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
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
        </div>
      </div>

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
