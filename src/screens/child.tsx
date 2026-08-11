import { useEffect, useState } from 'react'
import { useDevice } from '../platform/device'
import { LinkBadge, ago } from './setup'
import { FamilyHub } from './hub'
import { Capacitor } from '@capacitor/core'
import { NestlyLink } from '../link/ble-peripheral'
import { hasCloud } from '../cloud/client'
import { ENROLMENT_KEY, redeemInvite, type Enrolment } from '../cloud/sync'
import { loadJSON, saveJSON } from '../platform/storage'
import { Display, FieldLabel, GhostButton, PrimaryButton } from '../ui/kit'

/**
 * The child device.
 *
 * Three screens, driven entirely by the local agent — no parent needs to be in
 * range for any of this to work. The lock screen reflects the routine the child
 * device decided is active; the status screen is the honest account of what is
 * being shared and when it last left the phone.
 */

const TABS = [
  { id: 'status', label: 'Right now' },
  { id: 'notes', label: 'Notes' },
  { id: 'shared', label: "What's shared" },
] as const

type ChildTab = (typeof TABS)[number]['id']

export function ChildHome() {
  const { agent, name, notes, role } = useDevice()
  const [tab, setTab] = useState<ChildTab>('status')

  if (agent?.locked) return <ChildLock />

  const unread = notes.filter((n) => n.from !== role).length

  // Notes get their own full-height layout — a composer inside a scrolling
  // panel fights the keyboard on a phone.
  if (tab === 'notes') {
    return (
      <div className="flex h-full flex-col">
        <ChildTabs tab={tab} setTab={setTab} unread={unread} />
        <div className="min-h-0 flex-1">
          <FamilyHub />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-[22px] pb-3 pt-6">
        <Display className="text-[20px]">{name}</Display>
        <div className="mt-2">
          <LinkBadge />
        </div>
      </div>

      <ChildTabs tab={tab} setTab={setTab} unread={unread} />

      <div className="flex-1 overflow-y-auto px-[22px] pb-6">
        {tab === 'status' ? <ChildStatus /> : <ChildNotice />}
      </div>
    </div>
  )
}

function ChildTabs({
  tab,
  setTab,
  unread,
}: {
  tab: ChildTab
  setTab: (t: ChildTab) => void
  unread: number
}) {
  return (
    <div className="flex gap-2 px-[22px] py-3">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className={`rounded-2xl px-3.5 py-2 text-xs font-bold transition ${
            tab === t.id ? 'bg-ink text-white' : 'bg-cream text-body'
          }`}
        >
          {t.label}
          {t.id === 'notes' && unread > 0 ? (
            <span className="ml-1.5 rounded-full bg-coral px-1.5 py-0.5 text-[10px] text-white">
              {unread}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function ChildStatus() {
  const { agent } = useDevice()

  return (
    <div className="flex flex-col gap-3">
      <ProtectionSetup />
      <CloudEnrolment />
      <SiteWarning />
      <div className="rounded-2xl bg-cream p-4">
        <div className="text-[12px] font-bold text-body">ROUTINE</div>
        <div className="mt-1 text-[15px] font-bold">
          {agent?.activeScenario ? agent.activeScenario.name : 'Nothing running'}
        </div>
        <div className="mt-0.5 text-[12px] text-body">
          {agent?.activeScenario
            ? `Ends in ${agent.unlocksInMin ?? 0} minutes`
            : 'Your phone is unlocked.'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="BATTERY"
          value={agent?.battery != null ? `${agent.battery}%` : '—'}
          hint={agent?.charging ? 'Charging' : undefined}
        />
        <Stat
          label="LOCATION"
          value={agent?.lastFix ? 'Known' : 'No fix yet'}
          hint={agent?.lastFix ? ago(agent.lastFix.ts) : 'Waiting for GPS'}
        />
      </div>

      <div className="rounded-2xl bg-cream p-4">
        <div className="text-[12px] font-bold text-body">WAITING TO SEND</div>
        <div className="mt-1 text-[15px] font-bold">
          {agent?.pendingEvents ?? 0} {agent?.pendingEvents === 1 ? 'update' : 'updates'}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-body">
          {agent?.lastSyncAt
            ? `Last sent ${ago(agent.lastSyncAt)}. `
            : 'Nothing sent yet. '}
          These go across next time you're near your parent's phone.
        </div>
      </div>
    </div>
  )
}

/**
 * The two permissions Nestly cannot request with an ordinary prompt.
 *
 * The VPN needs a system consent dialog, and Usage Access can only be granted
 * from Settings. Both are asked for here, on the child's own screen, in plain
 * language — not silently, and not from the parent's phone. The child being
 * told what is turned on is the same promise the transparency screen makes.
 */
function ProtectionSetup() {
  const { agent } = useDevice()
  const [busy, setBusy] = useState(false)
  if (!agent) return null

  // Both permissions only exist on a real device; in the browser the prompts
  // would be permanent and unactionable.
  if (!Capacitor.isNativePlatform()) return null

  const needsVpn = !agent.filterConsented
  const needsUsage = !agent.usageAccess
  const needsContacts = !agent.contactsGranted
  if (!needsVpn && !needsUsage && !needsContacts) return null

  const grantVpn = async () => {
    setBusy(true)
    try {
      await NestlyLink.requestFilterConsent()
    } catch {
      /* the child declined, or this build has no filter */
    } finally {
      setBusy(false)
    }
  }

  const grantContacts = async () => {
    setBusy(true)
    try {
      await NestlyLink.requestContactsPermission()
    } catch {
      /* declined, or an older build without the method */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl bg-amberBg p-4">
      <div className="text-[13.5px] font-bold text-[#8A5A16]">Finish setting up</div>
      <p className="mt-1 text-[12px] leading-snug text-[#8A5A16]">
        A couple of things need your permission before Nestly can do its job.
      </p>

      {needsVpn ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void grantVpn()}
          className="mt-3 w-full rounded-xl bg-white px-3.5 py-3 text-left disabled:opacity-50"
        >
          <span className="block text-[13px] font-bold">Turn on web filtering</span>
          <span className="block text-[11.5px] leading-snug text-body">
            Android will ask you to allow a VPN. It only checks website names —
            it cannot see your messages or what is on your screen.
          </span>
        </button>
      ) : null}

      {needsUsage ? (
        <button
          type="button"
          onClick={() => void NestlyLink.openUsageSettings()}
          className="mt-2 w-full rounded-xl bg-white px-3.5 py-3 text-left"
        >
          <span className="block text-[13px] font-bold">Allow screen-time reporting</span>
          <span className="block text-[11.5px] leading-snug text-body">
            Opens Settings. Find Nestly in the list and turn on Usage access, so
            your screen time can be counted.
          </span>
        </button>
      ) : null}

      {needsContacts ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void grantContacts()}
          className="mt-2 w-full rounded-xl bg-white px-3.5 py-3 text-left disabled:opacity-50"
        >
          <span className="block text-[13px] font-bold">Let your parent know about new contacts</span>
          {/* Stated in the child's own terms, before they tap. The permission
              dialog says "access your contacts", which sounds far broader than
              what actually happens — so the limit is spelled out here. */}
          <span className="block text-[11.5px] leading-snug text-body">
            Only the name of someone newly saved is shared — never their number,
            and never the contacts you already have.
          </span>
        </button>
      ) : null}
    </div>
  )
}

/**
 * Links this phone to the child their parent already created on the account.
 *
 * Optional by design. Nestly's promise is that two phones work with no server,
 * so a child who never enters a code still gets routines, zones and their
 * emergency numbers over Bluetooth — this only adds the account link, which is
 * what lets a parent see them while they are apart.
 */
function CloudEnrolment() {
  const { deviceId, name, announceEnrolment } = useDevice()
  const [enrolled, setEnrolled] = useState<Enrolment | null>(null)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadJSON<Enrolment | null>(ENROLMENT_KEY, null).then(setEnrolled)
  }, [])

  if (!hasCloud()) return null

  if (enrolled) {
    return (
      <div className="rounded-2xl bg-tint px-4 py-3 text-[11.5px] leading-relaxed text-tealInk">
        Linked to <b>{enrolled.name}</b> on your family's account.
      </div>
    )
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await redeemInvite(code, deviceId, name)
      await saveJSON(ENROLMENT_KEY, result)
      setEnrolled(result)
      setOpen(false)
      // Tell the parent who this phone now is. Saved first, because the agent
      // reads the stored enrolment rather than taking it as an argument.
      await announceEnrolment().catch(() => {
        // Out of range. The next connection carries it anyway.
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code could not be used.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl bg-cream px-4 py-3 text-left"
      >
        <span className="block text-[13px] font-bold">Have a setup code?</span>
        <span className="block text-[11.5px] leading-snug text-body">
          Links this phone to your family's account, so your parent can see
          you're okay when you're apart.
        </span>
      </button>
    )
  }

  return (
    <div className="rounded-2xl bg-cream p-4">
      <FieldLabel>SETUP CODE</FieldLabel>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder="ABCD-1234"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-[14px] border-[1.5px] border-line bg-white px-4 py-3 text-center text-[18px] font-bold tracking-[0.15em] outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted focus:border-brand"
      />
      {error ? (
        <div className="mt-3 rounded-xl bg-coralBg px-3 py-2 text-[12px] text-coralInk">{error}</div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
        <PrimaryButton onClick={() => void submit()}>
          {busy ? 'Linking…' : 'Link this phone'}
        </PrimaryButton>
      </div>
    </div>
  )
}

/**
 * Shown after the child opens something their parent flagged as warn-rather-
 * than-block. The point is the pause and the explanation, not a barrier.
 */
function SiteWarning() {
  const { agent } = useDevice()
  const [dismissed, setDismissed] = useState<number | null>(null)
  const warning = agent?.lastWarning ?? null

  if (!warning || dismissed === warning.ts) return null
  // Stale warnings are noise; only surface a recent one.
  if (Date.now() - warning.ts > 10 * 60_000) return null

  return (
    <div className="rounded-2xl bg-coralBg p-4">
      <div className="text-[13.5px] font-bold text-coralInk">
        This site may not be right for your age
      </div>
      <p className="mt-1 text-[12px] leading-snug text-coralInk">
        <b>{warning.domain}</b> is flagged as {warning.cat} content. Your parent
        has chosen to let you decide, and they can see that you opened it.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(warning.ts)}
        className="mt-3 w-full rounded-xl bg-white py-2.5 text-[12.5px] font-bold text-coralInk"
      >
        I understand
      </button>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-cream p-4">
      <div className="text-[12px] font-bold text-body">{label}</div>
      <div className="mt-1 text-[15px] font-bold">{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-body">{hint}</div> : null}
    </div>
  )
}

/**
 * The lock screen. Shown by the agent, not by a parent tapping a button.
 *
 * Emergency contacts are the one thing that must always work here. A phone the
 * child cannot use to call for help is a safety problem, not a stricter
 * setting — so the numbers travel with the policy, are stored on the device,
 * and dial with no network and no parent in range.
 */
export function ChildLock() {
  const { agent } = useDevice()
  const active = agent?.activeScenario
  const contacts = agent?.contacts ?? []

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto bg-ink px-[26px] py-8 text-center text-white">
      <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full bg-night">
        <PadlockIcon />
      </div>

      <Display className="text-[20px]">
        {active ? `${active.name} is active` : 'Your phone is paused'}
      </Display>
      <div className="text-[13.5px] text-nightBody">
        {agent?.unlocksInMin != null
          ? `Unlocks in ${agent.unlocksInMin} minutes`
          : 'Your parent paused this phone.'}
      </div>
      {active ? (
        <div className="rounded-[14px] bg-night px-4 py-2 text-xs font-bold text-mint">
          {fmtMin(active.fromMin)} – {fmtMin(active.toMin)}
        </div>
      ) : null}

      {contacts.length > 0 ? (
        <div className="mt-3 w-full">
          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-nightBody">
            You can always call
          </div>
          <div className="flex flex-col gap-2">
            {contacts.map((c) => (
              <CallButton key={c.id} name={c.name} phone={c.phone} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 w-full rounded-2xl border border-nightLine px-4 py-3 text-[11.5px] leading-snug text-nightBody">
          No emergency numbers set yet. Ask your parent to add one in Nestly so
          you can always reach someone.
        </div>
      )}

      <div className="mt-1 shrink-0 text-[11px] text-body">Managed by Nestly Family</div>
    </div>
  )
}

/**
 * A plain `tel:` anchor rather than a scripted call.
 *
 * Capacitor's WebView hands non-http schemes to the system, so this opens the
 * dialer with the number filled in. It stops short of placing the call itself —
 * the child confirms, which avoids a pocket-dial and needs no CALL_PHONE
 * permission.
 */
function CallButton({ name, phone }: { name: string; phone: string }) {
  return (
    <a
      href={`tel:${encodeURIComponent(phone)}`}
      className="flex items-center gap-3 rounded-2xl bg-mint px-4 py-3 text-left text-ink transition active:scale-[0.98]"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M5 2.5h3l1.5 3.75L7.5 7.5a9 9 0 0 0 5 5l1.25-2 3.75 1.5v3A1.5 1.5 0 0 1 16 16.5 13.5 13.5 0 0 1 3.5 4 1.5 1.5 0 0 1 5 2.5Z"
          fill="currentColor"
        />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold leading-tight">{name}</span>
        <span className="block text-[11.5px] opacity-70">{phone}</span>
      </span>
      <span className="text-[11px] font-bold opacity-70">CALL</span>
    </a>
  )
}

function fmtMin(minutes: number) {
  const h24 = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, '0')} ${mer}`
}

function PadlockIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden>
      <path d="M11 15v-3a6 6 0 0 1 12 0v3" stroke="#5FD3C4" strokeWidth="4" strokeLinecap="round" />
      <rect x="8" y="15" width="18" height="13" rx="3" stroke="#5FD3C4" strokeWidth="4" />
    </svg>
  )
}

const SHARED = [
  ['Where you are', 'Your location, and when you arrive at or leave a saved place.'],
  ['Screen routines', 'Which routine is running, and when your phone is paused.'],
  ['Battery', 'So your parent knows if your phone is about to die.'],
  // Listed as plainly as the rest. Watching for new contacts without saying so
  // would break the one promise this screen exists to make.
  [
    'New contacts',
    'When someone new is saved to your phone, your parent sees their name — never their number, and never your existing contacts.',
  ],
]

export function ChildNotice() {
  const { reset, agent } = useDevice()
  const [confirming, setConfirming] = useState(false)
  const contacts = agent?.contacts ?? []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-body">
        Here is everything this phone tells your parent. Nothing else is
        collected, and none of it is sent anywhere except to their phone.
      </p>

      {SHARED.map(([title, body]) => (
        <div key={title} className="rounded-2xl bg-tint px-4 py-3">
          <div className="text-[13.5px] font-bold text-brand">{title}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-tealInk">{body}</div>
        </div>
      ))}

      <div className="rounded-2xl border-[1.5px] border-line px-4 py-3">
        <div className="text-[13.5px] font-bold">What is never shared</div>
        <div className="mt-0.5 text-[12px] leading-snug text-body">
          Your photos, what you type, and what is on your screen. Nestly cannot
          see any of it. Notes are the only messages it carries, and only
          between this phone and your parent's.
        </div>
      </div>

      <div className="rounded-2xl bg-amberBg px-4 py-3">
        <div className="text-[13.5px] font-bold text-[#8A5A16]">
          You can always call for help
        </div>
        <div className="mt-0.5 text-[12px] leading-snug text-[#8A5A16]">
          {contacts.length > 0
            ? `${contacts.map((c) => c.name).join(', ')} — these work even when your phone is paused.`
            : 'Your parent has not added any emergency numbers yet. Ask them to.'}
        </div>
      </div>

      <div className="mt-2">
        {confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-body">
              This unpairs the phone and deletes everything stored here. Your
              parent will be told the device was reset.
            </p>
            <PrimaryButton tone="coral" onClick={() => void reset()}>
              Yes, reset this phone
            </PrimaryButton>
            <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
          </div>
        ) : (
          <GhostButton onClick={() => setConfirming(true)}>Reset this device</GhostButton>
        )}
      </div>
    </div>
  )
}
