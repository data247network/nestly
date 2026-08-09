import { useEffect, useState } from 'react'
import { useDevice } from '../platform/device'
import { useStore } from '../app/store'
import { childCapacity, pairingBlockedReason } from '../app/plans'
import type { Peer } from '../link/transport'
import { Scene } from '../art/Scene'
import {
  Avatar,
  BackButton,
  Display,
  Field,
  FieldLabel,
  GhostButton,
  PrimaryButton,
  Row,
  Wordmark,
} from '../ui/kit'

/**
 * First-run setup.
 *
 * A Nestly install commits to being either the parent's phone or the child's,
 * once. That is not a preference — it decides which half of the Bluetooth link
 * runs — so it is asked plainly and up front rather than buried in settings.
 */
export function RoleGate() {
  const { setRole } = useDevice()
  const [choice, setChoice] = useState<'parent' | 'child' | null>(null)
  const [name, setName] = useState('')

  if (choice) {
    return (
      <NameStep
        role={choice}
        name={name}
        setName={setName}
        onBack={() => setChoice(null)}
        onDone={() => void setRole(choice, name.trim() || defaultName(choice))}
      />
    )
  }

  return (
    <div className="flex h-full flex-col px-[26px] py-[34px]">
      <Wordmark />
      <div className="mt-8">
        <Display className="mb-2 text-[24px] leading-tight">Which phone is this?</Display>
        <p className="text-[13.5px] leading-relaxed text-body">
          Nestly runs on both phones. Each one needs to know its part — you can
          change it later by resetting the app.
        </p>
      </div>

      <div className="mt-7 flex flex-col gap-3">
        <RoleCard
          scene="safe"
          title="This is my phone"
          subtitle="The parent app — see where they are, set the rules, get alerts."
          onClick={() => setChoice('parent')}
        />
        <RoleCard
          scene="together"
          title="This is my child's phone"
          subtitle="The child device — keeps the routines running and stays connected to you."
          onClick={() => setChoice('child')}
        />
      </div>

      <div className="mt-auto rounded-2xl bg-cream px-4 py-3 text-[11.5px] leading-relaxed text-body">
        The two phones connect over Bluetooth. They sync whenever they're near
        each other — no account and no internet needed yet.
      </div>
    </div>
  )
}

function RoleCard({
  scene,
  title,
  subtitle,
  onClick,
}: {
  scene: 'safe' | 'together'
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-2xl border-[1.5px] border-line bg-white p-3.5 text-left transition active:scale-[0.99]"
    >
      <Scene name={scene} className="w-[62px] shrink-0" />
      <span className="min-w-0">
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="block text-[12px] leading-snug text-body">{subtitle}</span>
      </span>
    </button>
  )
}

function NameStep({
  role,
  name,
  setName,
  onBack,
  onDone,
}: {
  role: 'parent' | 'child'
  name: string
  setName: (v: string) => void
  onBack: () => void
  onDone: () => void
}) {
  return (
    <div className="flex h-full flex-col px-[26px] py-[34px]">
      <button type="button" onClick={onBack} className="mb-5 w-8 text-left text-xl">
        ←
      </button>
      <Display className="mb-2 text-[22px]">
        {role === 'child' ? "What's your child's name?" : 'What should we call you?'}
      </Display>
      <p className="mb-6 text-[13px] text-body">
        {role === 'child'
          ? "This is the name shown on your phone when the two devices pair, and on the child's own screen."
          : 'Only used on this device.'}
      </p>

      <FieldLabel>NAME</FieldLabel>
      <Field value={name} onChange={setName} placeholder={defaultName(role)} />

      <div className="flex-1" />
      <PrimaryButton onClick={onDone}>Continue</PrimaryButton>
    </div>
  )
}

function defaultName(role: 'parent' | 'child') {
  return role === 'child' ? "Child's phone" : 'Parent'
}

/* ------------------------------------------------------------------ pairing */

/**
 * Parent-side pairing. Scans only for the Nestly service UUID, so the list is
 * child devices rather than every Bluetooth gadget in the house.
 */
export function PairChild({ onDone }: { onDone?: () => void }) {
  const { scan, pair, pairings, linkByChild, children: live, refresh, refreshing, signOut } =
    useDevice()
  const { state, dispatch, go } = useStore()
  const [peers, setPeers] = useState<Peer[]>([])
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const capacity = childCapacity(state.plan, pairings.length)
  const blocked = pairingBlockedReason(state.plan, pairings.length)
  const contactCount = state.emergencyContacts.filter((c) => c.phone.trim()).length

  const runScan = async () => {
    setScanning(true)
    setError(null)
    try {
      setPeers(await scan(6000))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not scan for devices.')
    } finally {
      setScanning(false)
    }
  }

  // Scan straight away when there is nothing paired, or when the parent has
  // explicitly asked to add another device.
  useEffect(() => {
    if (pairings.length === 0 || adding) void runScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairings.length === 0, adding])

  const showScanner = pairings.length === 0 || adding

  if (!showScanner) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
        <div className="flex items-baseline justify-between">
          <Display className="text-[20px]">Devices</Display>
          <span className="text-[11.5px] font-bold text-body">
            {capacity.used} of {capacity.limit}
          </span>
        </div>

        {/*
          The automatic retry is on a 30s timer, which is right when nobody is
          watching and useless when a parent is standing next to their child
          wondering why the card says "2 hours ago".
        */}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || pairings.length === 0}
          className="flex items-center justify-center gap-2 rounded-2xl border-[1.5px] border-brand py-2.5 text-[13px] font-bold text-brand transition active:scale-[0.99] disabled:opacity-45"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            className={refreshing ? 'animate-spin' : ''}
            aria-hidden
          >
            <path d="M14 8a6 6 0 1 1-1.9-4.4" />
            <path d="M14 1.5V4h-2.5" />
          </svg>
          {refreshing ? 'Reconnecting…' : 'Reconnect now'}
        </button>

        <div className="flex flex-col gap-2.5">
          {pairings.map((p) => {
            const status = linkByChild[p.peerId]
            const child = live.find((c) => c.deviceId === p.peerId)
            const label = state.children.find((c) => c.id === p.peerId)?.name ?? child?.name ?? p.peerName
            return (
              <button
                key={p.peerId}
                type="button"
                onClick={() => {
                  dispatch({ type: 'editChild', id: p.peerId })
                  go('childSetup')
                }}
                className="flex items-center gap-3 rounded-2xl bg-cream px-3.5 py-3 text-left"
              >
                <Avatar
                  name={label}
                  color={state.children.find((c) => c.id === p.peerId)?.avatar ?? '#147D77'}
                  size={38}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold">{label}</span>
                  <span className="block text-[11.5px] text-body">
                    {status?.state === 'connected'
                      ? 'Connected now'
                      : child?.lastSeenAt
                        ? `Last synced ${ago(child.lastSeenAt)}`
                        : 'Not in range'}
                  </span>
                </span>
                <span className="text-base text-muted">›</span>
              </button>
            )
          })}
        </div>

        {blocked ? (
          <button
            type="button"
            onClick={() => go('plans')}
            className="rounded-2xl bg-amberBg px-4 py-3 text-left text-[12px] leading-relaxed text-[#8A5A16]"
          >
            {blocked}
          </button>
        ) : (
          <GhostButton onClick={() => setAdding(true)}>+ Add another child device</GhostButton>
        )}

        {/*
          Emergency contacts sat two screens deep and were being missed, which
          meant children were being locked with no way to call anyone. It is a
          safety setting, so it belongs at the top level next to the devices it
          protects — and it says plainly when it is empty.
        */}
        <Row
          title="Emergency contacts"
          hint={
            contactCount === 0
              ? 'None set — they cannot call anyone while locked'
              : `${contactCount} number${contactCount === 1 ? '' : 's'}, callable while locked`
          }
          right={
            contactCount === 0 ? (
              <span className="rounded-lg bg-coralBg px-2 py-1 text-[10.5px] font-bold text-coralInk">
                Set up
              </span>
            ) : undefined
          }
          onClick={() => go('contacts')}
        />

        <Row
          title="Plan"
          hint={`${capacity.plan.name} · ${capacity.used} of ${capacity.limit} children`}
          onClick={() => go('plans')}
        />

        <Row title="Sign out" hint="Locks this app on this phone" onClick={() => void signOut()} />

        <div className="rounded-2xl bg-tint px-4 py-3 text-[11.5px] leading-relaxed text-tealInk">
          The phones sync over Bluetooth whenever they're close. Apart, each
          child's phone keeps recording and keeps its routines running — it hands
          everything over next time you're together.
        </div>

        <div className="flex-1" />
        {onDone ? <PrimaryButton onClick={onDone}>Done</PrimaryButton> : null}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      {adding ? <BackButton onClick={() => setAdding(false)} /> : null}
      <Display className="text-[20px]">Find your child's phone</Display>
      <p className="text-[13px] text-body">
        Open Nestly on their phone and choose <b>"This is my child's phone"</b>.
        Keep both phones close together.
      </p>

      {error ? (
        <div className="rounded-xl bg-coralBg px-3.5 py-3 text-[12.5px] text-coralInk">{error}</div>
      ) : null}

      <div className="flex flex-col gap-2">
        {peers.map((p) => {
          const already = pairings.some((x) => x.peerId === p.id)
          return (
            <button
              key={p.id}
              type="button"
              disabled={already}
              onClick={() => {
                void pair(p)
                setAdding(false)
              }}
              className={`flex items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left ${
                already ? 'bg-cream/60 opacity-60' : 'bg-cream'
              }`}
            >
              <span>
                <span className="block text-[13.5px] font-bold">{p.name}</span>
                <span className="block text-[11.5px] text-body">
                  {p.rssi != null ? `Signal ${p.rssi} dBm` : 'In range'}
                </span>
              </span>
              <span className="text-xs font-bold text-brand">
                {already ? 'Paired' : 'Pair'}
              </span>
            </button>
          )
        })}

        {peers.length === 0 ? (
          <div className="rounded-2xl bg-cream px-4 py-6 text-center text-[12.5px] text-body">
            {scanning ? 'Scanning…' : 'No child devices found yet.'}
          </div>
        ) : null}
      </div>

      <div className="flex-1" />
      <PrimaryButton onClick={() => void runScan()}>
        {scanning ? 'Scanning…' : 'Scan again'}
      </PrimaryButton>
    </div>
  )
}

/**
 * Per-child settings, opened by tapping a device in the Device tab.
 *
 * Renaming is local to the parent's app on purpose: the name the child device
 * advertises is set on that phone, and silently overwriting it from here would
 * make the two disagree about who they are.
 */
export function ChildSetup() {
  const { pairings, linkByChild, children: live, unpair, renameDevice } = useDevice()
  const { state, dispatch, go } = useStore()
  const [confirming, setConfirming] = useState(false)

  const peerId = state.editingChildId
  const pairing = pairings.find((p) => p.peerId === peerId)
  const child = state.children.find((c) => c.id === peerId)
  const liveChild = live.find((c) => c.deviceId === peerId)
  const status = linkByChild[peerId]

  if (!pairing) {
    return (
      <div className="flex h-full flex-col gap-4 px-[22px] py-[26px]">
        <BackButton onClick={() => go('pair')} />
        <p className="text-[13px] text-body">This device is no longer paired.</p>
      </div>
    )
  }

  const name = child?.name ?? liveChild?.name ?? pairing.peerName
  const colors = ['#147D77', '#FF6B5B', '#FFB84D', '#8B7FD1']

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-[22px] py-[26px]">
      <BackButton onClick={() => go('pair')} />
      <Display className="text-[20px]">{name}</Display>

      <div className="rounded-2xl bg-cream p-4">
        <div className="text-[12px] text-body">
          {status?.state === 'connected'
            ? 'Connected now'
            : liveChild?.lastSeenAt
              ? `Last synced ${ago(liveChild.lastSeenAt)}`
              : 'Not in range'}
        </div>
        <div className="mt-1 text-[11.5px] text-muted">
          Paired {new Date(pairing.pairedAt).toLocaleDateString()}
          {liveChild?.telemetry?.battery != null
            ? ` · Battery ${liveChild.telemetry.battery}%`
            : ''}
        </div>
      </div>

      <div>
        <FieldLabel>NAME</FieldLabel>
        <Field
          value={name}
          onChange={(v) => {
            dispatch({ type: 'renameChild', id: peerId, name: v })
            void renameDevice(peerId, v)
          }}
        />
      </div>

      <div>
        <FieldLabel>COLOUR</FieldLabel>
        <div className="flex gap-2.5">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => dispatch({ type: 'setChildAvatar', id: peerId, color: c })}
              className={`h-[34px] w-[34px] rounded-full ${
                (child?.avatar ?? '#147D77') === c ? 'ring-[2.5px] ring-ink' : ''
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <Row
        title="Zones for this child"
        hint={`${state.geofences.filter((g) => g.childIds.length === 0 || g.childIds.includes(peerId)).length} apply to them`}
        onClick={() => {
          dispatch({ type: 'activeChild', id: peerId })
          go('map')
        }}
      />
      <Row
        title="Activity trail"
        hint="Everything this device has reported"
        onClick={() => {
          dispatch({ type: 'activeChild', id: peerId })
          go('trail')
        }}
      />

      <div className="flex-1" />

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-coralBg p-4">
          <div className="text-[12.5px] text-coralInk">
            Forget {name}? Their zones, alerts and history on this phone are
            removed. The child's phone keeps its own copy until it is reset.
          </div>
          <div className="flex gap-2">
            <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
            <PrimaryButton
              tone="coral"
              onClick={() => {
                void unpair(peerId)
                go('pair')
              }}
            >
              Forget
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <GhostButton onClick={() => setConfirming(true)}>Forget this device</GhostButton>
      )}
    </div>
  )
}

/** Shared connection pill — the honest answer to "is this working right now?". */
export function LinkBadge() {
  const { link, child } = useDevice()
  const tone =
    link.state === 'connected'
      ? 'bg-tint text-brand'
      : link.state === 'error'
        ? 'bg-coralBg text-coralInk'
        : 'bg-amberBg text-[#8A5A16]'

  // "Last synced 3h ago" is the honest headline when apart — the connection
  // being down is the expected state, not news.
  const label =
    link.state === 'connected'
      ? 'Connected now'
      : link.state === 'error'
        ? (link.detail ?? 'Bluetooth problem')
        : child?.lastSeenAt
          ? `Last synced ${ago(child.lastSeenAt)}`
          : (link.detail ?? 'Waiting for the other phone')

  return (
    <span className={`inline-block rounded-lg px-2.5 py-1 text-[11px] font-bold ${tone}`}>
      {label}
    </span>
  )
}

export function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
