import { useCallback, useEffect, useState } from 'react'
import { hasCloud } from '../cloud/client'
import {
  createChild,
  createInvite,
  currentSession,
  ensureHousehold,
  loadHousehold,
  removeChild,
  type HouseholdSummary,
} from '../cloud/sync'
import { HOUSEHOLD_KEY } from './login'
import { loadJSON, saveJSON } from '../platform/storage'
import { planOf } from '../app/plans'
import {
  Avatar,
  Display,
  Field,
  FieldLabel,
  GhostButton,
  PrimaryButton,
  ScreenTitle,
} from '../ui/kit'

/**
 * The household — the thing an account is actually *for*.
 *
 * Until now this existed only in the database, created silently on sign-in with
 * no screen anywhere, which made an account feel like it did nothing. It is
 * also where the enrolment order gets fixed: the child is created *here* first,
 * and their phone attaches to that record afterwards using a code. Bluetooth
 * then becomes the local transport rather than the thing that decides who a
 * child is.
 */
export function Household() {
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [data, setData] = useState<HouseholdSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'signedout' | 'error'>('loading')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [invite, setInvite] = useState<{ code: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (id: string) => {
    try {
      setData(await loadHousehold(id))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      if (!hasCloud()) return setState('signedout')
      const session = await currentSession()
      if (!session) return setState('signedout')

      // The stored id is only a cache. Sign-in writes it, but that write is
      // deliberately non-fatal — so it can legitimately be missing while the
      // account is perfectly valid, and reading it as "not signed in" told
      // people to sign in when they already had. Resolve from the session and
      // repair the cache instead.
      let id = await loadJSON<string | null>(HOUSEHOLD_KEY, null)
      if (!id) {
        try {
          id = await ensureHousehold()
          if (id) await saveJSON(HOUSEHOLD_KEY, id)
        } catch {
          return setState('error')
        }
      }
      if (!id) return setState('error')

      setHouseholdId(id)
      await refresh(id)
    })()
  }, [refresh])

  const addChild = async () => {
    if (!householdId) return
    setBusy(true)
    setError(null)
    try {
      const id = await createChild(householdId, newName, '#147D77')
      const code = await createInvite(householdId, id)
      setInvite({ code, name: newName.trim() || 'My child' })
      setNewName('')
      setAdding(false)
      await refresh(householdId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that child.')
    } finally {
      setBusy(false)
    }
  }

  const newCodeFor = async (child: { id: string; name: string }) => {
    if (!householdId) return
    setBusy(true)
    try {
      setInvite({ code: await createInvite(householdId, child.id), name: child.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return <Centered>Loading your family…</Centered>
  }

  if (state === 'signedout') {
    return (
      <Centered>
        Sign in to see your family. The phones still work over Bluetooth without
        an account.
      </Centered>
    )
  }

  if (state === 'error' || !data) {
    return <Centered>Could not load your family. Check your connection.</Centered>
  }

  const plan = planOf(data.plan as never)
  const atLimit = data.children.length >= plan.children

  if (invite) {
    return <InviteCard code={invite.code} name={invite.name} onDone={() => setInvite(null)} />
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>{data.name}</ScreenTitle>
      <div className="-mt-2 text-[12px] text-body">
        {plan.name} plan · {data.memberCount} {data.memberCount === 1 ? 'adult' : 'adults'} ·{' '}
        {data.children.length} of {plan.children} children
      </div>

      {error ? (
        <div className="rounded-xl bg-coralBg px-3.5 py-2.5 text-[12.5px] text-coralInk">{error}</div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {data.children.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-cream px-3.5 py-3">
            <Avatar name={c.name} color={c.avatar} size={38} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">{c.name}</div>
              <div className="text-[11.5px] text-body">
                {c.enrolledAt ? 'Phone linked' : 'No phone linked yet'}
              </div>
            </div>
            {c.enrolledAt ? (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    await removeChild(c.id)
                    if (householdId) await refresh(householdId)
                  })()
                }}
                className="text-[11.5px] font-bold text-coralInk"
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void newCodeFor(c)}
                className="text-[11.5px] font-bold text-brand disabled:opacity-50"
              >
                Get code
              </button>
            )}
          </div>
        ))}

        {data.children.length === 0 && !adding ? (
          <div className="rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] leading-relaxed text-body">
            No children yet. Add one, then set up their phone with the code you
            get.
          </div>
        ) : null}
      </div>

      {adding ? (
        <div className="rounded-2xl bg-cream p-4">
          <FieldLabel>THEIR NAME</FieldLabel>
          <Field value={newName} onChange={setNewName} placeholder="e.g. Eliora" />
          <div className="mt-3 flex gap-2">
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={() => void addChild()}>
              {busy ? 'Adding…' : 'Add child'}
            </PrimaryButton>
          </div>
        </div>
      ) : atLimit ? (
        <div className="rounded-2xl bg-amberBg px-4 py-3 text-[12px] leading-relaxed text-[#8A5A16]">
          Your {plan.name} plan covers {plan.children} children. Upgrade to add
          another.
        </div>
      ) : (
        <GhostButton onClick={() => setAdding(true)}>+ Add a child</GhostButton>
      )}

      <div className="rounded-2xl bg-tint px-4 py-3 text-[11.5px] leading-relaxed text-tealInk">
        Children live on your account, so their rules and history survive a lost
        or replaced phone. Setting up a phone is a separate step — you'll get a
        code to enter on it.
      </div>
    </div>
  )
}

/**
 * Where a setup link points.
 *
 * Baked in at build time rather than read from `location.origin`, which inside
 * the APK is `https://localhost` — a link no other phone can open. Overridable
 * so a preview deployment can hand out links to itself.
 */
const SETUP_ORIGIN = (
  (import.meta.env.VITE_PORTAL_ORIGIN as string | undefined) ??
  'https://nestly-gamma-seven.vercel.app'
).replace(/\/+$/, '')

/**
 * The code handed to the child's phone.
 *
 * Grouped into two blocks of four because that is how people read a code aloud,
 * and shown with its expiry — a code with no visible lifetime gets written on a
 * sticky note and used months later.
 */
function InviteCard({
  code,
  name,
  onDone,
}: {
  code: string
  name: string
  onDone: () => void
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
  // The link carries the code so the child's phone lands on a page that both
  // installs the app and shows the code, rather than the parent having to
  // explain two separate things over the phone.
  const link = `${SETUP_ORIGIN}/setup/${code}`

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? code : link)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* clipboard blocked; both are on screen to type anyway */
    }
  }

  const share = async () => {
    const text = `Set up Nestly on your phone: ${link}`
    // The share sheet is the point on a phone — it puts the link straight into
    // whichever messaging app the family actually uses.
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: 'Set up Nestly', text }).catch(() => {})
      return
    }
    await copy('link')
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <ScreenTitle>Set up {name}'s phone</ScreenTitle>

      <p className="text-[13px] leading-relaxed text-slate2">
        Send {name} this link. It walks them through installing the app and
        entering the code — they do not need an account of their own.
      </p>

      <div className="rounded-2xl bg-tint py-6 text-center">
        <Display className="text-[34px] tracking-[0.12em] text-brand">{pretty}</Display>
        <div className="mt-2 text-[11.5px] text-tealInk">Expires in 24 hours · one phone only</div>
      </div>

      <div className="break-all rounded-xl bg-cream px-3.5 py-2.5 text-[11.5px] text-body">
        {link}
      </div>

      <PrimaryButton onClick={() => void share()}>Send setup link</PrimaryButton>
      <GhostButton onClick={() => void copy('code')}>
        {copied === 'code' ? 'Copied' : 'Copy code only'}
      </GhostButton>

      <div className="rounded-2xl bg-cream px-4 py-3 text-[11.5px] leading-relaxed text-body">
        Only share this with the person setting up that phone. Anyone with the
        code can link a device to {name} until it is used or expires.
      </div>

      <div className="flex-1" />
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-10 text-center text-[12.5px] leading-relaxed text-body">
      {children}
    </div>
  )
}
