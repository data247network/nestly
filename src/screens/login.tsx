import { useState } from 'react'
import { Display, Field, FieldLabel, PrimaryButton, Wordmark } from '../ui/kit'

/**
 * The sign-in gate.
 *
 * There is no account server yet, so this validates against a built-in
 * credential held on the device. That is worth being blunt about: it is a
 * **local gate, not authentication**. It stops someone picking up the parent's
 * unlocked phone and changing the rules, which is a real threat in a household,
 * but it proves nothing to anyone else and protects no data in transit.
 *
 * The shape is deliberately the shape of the real thing — same fields, same
 * session persistence, same failure copy — so swapping the check for a call to
 * the accounts service later touches this one function and nothing else.
 */

export const DEFAULT_EMAIL = 'parent@nestly.family'
export const DEFAULT_PASSWORD = 'nestly'

/** Replace with a call to the accounts service when it exists. */
export function checkCredentials(email: string, password: string): boolean {
  return (
    email.trim().toLowerCase() === DEFAULT_EMAIL && password === DEFAULT_PASSWORD
  )
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState(DEFAULT_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState(false)

  const submit = () => {
    if (checkCredentials(email, password)) {
      setError(null)
      onSignedIn()
      return
    }
    setError('That email and password do not match.')
  }

  return (
    <div className="flex h-full flex-col px-[26px] py-[38px]">
      <div className="mb-9">
        <Wordmark />
      </div>

      <Display className="mb-1.5 text-[23px]">Welcome back</Display>
      <p className="mb-[26px] text-[13.5px] text-body">
        Sign in to check in on your family.
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
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="••••••••"
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

      {error ? (
        <div className="mb-4 rounded-xl bg-coralBg px-3.5 py-2.5 text-[12.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      <PrimaryButton className="mb-4" onClick={submit}>
        Sign in
      </PrimaryButton>

      {/*
        Stated plainly rather than hidden. Anyone testing this build needs the
        credential, and pretending there is real authentication behind it would
        be worse than admitting there is not.
      */}
      <div className="rounded-2xl bg-cream px-4 py-3 text-[11.5px] leading-relaxed text-body">
        <b className="text-ink">Test build.</b> Sign in with{' '}
        <b className="text-ink">{DEFAULT_EMAIL}</b> and the password{' '}
        <b className="text-ink">{DEFAULT_PASSWORD}</b>. This is a local gate on
        this phone only — real accounts arrive with the online service.
      </div>
    </div>
  )
}
