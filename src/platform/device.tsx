import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChildAgent, type AgentSnapshot } from '../agent/childAgent'
import { ParentLink, type ChildLive } from '../agent/parentLink'
import { NoteBox, type NoteState } from '../agent/notes'
import { createTransport } from '../link'
import type { ChildEvent, Policy, UsageReport } from '../link/protocol'
import type { LinkStatus, Peer, Transport } from '../link/transport'
import {
  KEYS,
  deviceId as ensureDeviceId,
  loadJSON,
  perChild,
  remove,
  saveJSON,
} from './storage'

/**
 * Device identity and the live links.
 *
 * A Nestly install is either a parent device or a child device — chosen once,
 * on first run, and persisted. A child device runs one agent. A parent device
 * runs one independent link *per paired child*: separate BLE connection,
 * separate reassembly buffer, separate ack cursor and note queue. Sharing any
 * of those across children would cross their histories, because sequence
 * numbers are per-child and start at 1 on every device.
 */

export type Role = 'parent' | 'child'

export type Pairing = {
  /**
   * Stable identity for this child, fixed at pairing time and never changed.
   *
   * Everything else keys on it — the ack cursor, the note queue, the child's
   * card, their alerts and history. It happens to start life as the BLE
   * address, but it must not follow one: Android rotates a device's advertised
   * address for privacy, and re-keying on every rotation would orphan all of
   * the above.
   */
  peerId: string
  /**
   * The address the radio should dial *right now*. Updated whenever the child
   * is rediscovered at a new one.
   */
  address: string
  peerName: string
  pairedAt: number
}

/** One paired child, as far as the link layer is concerned. */
type ChildLink = {
  pairing: Pairing
  transport: Transport
  link: ParentLink
  notes: NoteBox
  stop: () => Promise<void>
}

export type ChildNote = NoteState & { childId: string }

type DeviceCtx = {
  ready: boolean
  onboarded: boolean
  completeOnboarding: () => Promise<void>
  /** Parent devices only. Persisted, so signing in is not a per-launch chore. */
  signedIn: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  role: Role | null
  deviceId: string
  setRole: (role: Role, name: string) => Promise<void>
  reset: () => Promise<void>
  name: string

  /** Parent only. One entry per paired child, keyed by peer id. */
  pairings: Pairing[]
  linkByChild: Record<string, LinkStatus>
  /** Aggregate, for the header: connected if *any* child is connected. */
  link: LinkStatus
  children: ChildLive[]
  /**
   * The first paired child. A convenience for the screens that are inherently
   * single-child — the lock control, the filtering detail — so they do not each
   * have to re-derive it. Screens that show the whole household use `children`.
   */
  child: ChildLive | null
  pairing: Pairing | null
  scan: (ms?: number) => Promise<Peer[]>
  pair: (peer: Peer) => Promise<void>
  unpair: (peerId: string) => Promise<void>
  renameDevice: (peerId: string, name: string) => Promise<void>
  /** Force an immediate reconnect. Omit `peerId` to retry every child. */
  refresh: (peerId?: string) => Promise<void>
  /** True while a manual refresh is running, so the button can show progress. */
  refreshing: boolean
  /**
   * Pushes policy to every paired child. Takes a builder rather than a policy
   * because zones are scoped per child — each device gets its own document.
   */
  pushPolicy: (build: (childId: string) => Policy) => Promise<void>
  onChildEvents: (cb: (childId: string, events: ChildEvent[]) => void) => () => void
  onChildUsage: (cb: (childId: string, report: UsageReport) => void) => () => void

  /** Child only. */
  agent: AgentSnapshot | null

  /** Notes, both roles. On a parent these carry the child they belong to. */
  notes: ChildNote[]
  sendNote: (text: string, childId?: string) => Promise<void>
}

const Ctx = createContext<DeviceCtx | null>(null)

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [role, setRoleState] = useState<Role | null>(null)
  const [name, setName] = useState('Nestly')
  const [id, setId] = useState('')
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [linkByChild, setLinkByChild] = useState<Record<string, LinkStatus>>({})
  const [childList, setChildList] = useState<ChildLive[]>([])
  const [agent, setAgent] = useState<AgentSnapshot | null>(null)
  const [notes, setNotes] = useState<ChildNote[]>([])
  const [childLink, setChildLink] = useState<LinkStatus>({ state: 'off' })
  const [refreshing, setRefreshing] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  const linksRef = useRef(new Map<string, ChildLink>())
  /**
   * The most recent policy, kept so a link created *after* the parent last
   * changed a rule still gets it. Links are built asynchronously, so a push can
   * land in the gap between the transport existing and its ParentLink existing —
   * and the caller has already recorded that version as sent.
   */
  const lastPolicyRef = useRef<((childId: string) => Policy) | null>(null)
  const agentRef = useRef<ChildAgent | null>(null)
  const childNotesRef = useRef<NoteBox | null>(null)
  const eventSubs = useRef(new Set<(childId: string, e: ChildEvent[]) => void>())
  const usageSubs = useRef(new Set<(childId: string, r: UsageReport) => void>())

  /* ------------------------------------------------------------- bootstrap */

  useEffect(() => {
    void (async () => {
      const [stored, list, legacy, myId, seen, signed] = await Promise.all([
        loadJSON<{ role: Role; name: string } | null>(KEYS.role, null),
        loadJSON<Pairing[]>(KEYS.pairings, []),
        loadJSON<Pairing | null>(KEYS.pairing, null),
        ensureDeviceId(),
        loadJSON<boolean>(KEYS.onboarded, false),
        loadJSON<boolean>(KEYS.signedIn, false),
      ])
      setSignedIn(signed)

      // Migrate the single-pairing installs already on people's phones. Done
      // once, then the legacy key is dropped so it cannot resurrect a child
      // that has since been unpaired.
      let merged = list
      if (legacy && !list.some((p) => p.peerId === legacy.peerId)) {
        merged = [...list, legacy]
      }
      if (legacy) await remove(KEYS.pairing)

      // Pairings written before the address/identity split have no `address`.
      // Seed it from the id they were stored under.
      if (merged.some((p) => !p.address)) {
        merged = merged.map((p) => (p.address ? p : { ...p, address: p.peerId }))
      }
      if (merged !== list) await saveJSON(KEYS.pairings, merged)

      setId(myId)
      setPairings(merged)
      setOnboarded(seen)
      if (stored) {
        setRoleState(stored.role)
        setName(stored.name)
      }
      setReady(true)
    })()
  }, [])

  /* ---------------------------------------------------------- child role */

  useEffect(() => {
    if (!ready || role !== 'child' || !id) return
    let cancelled = false

    const transport = createTransport('child', { deviceName: name })
    const unsubStatus = transport.onStatus((s) => !cancelled && setChildLink(s))

    void (async () => {
      const box = new NoteBox(transport, 'child', KEYS.notes)
      childNotesRef.current = box
      box.onChange((n) => !cancelled && setNotes(n.map((x) => ({ ...x, childId: id }))))
      await box.start()

      const a = new ChildAgent(transport, { deviceId: id, name })
      agentRef.current = a
      a.onSnapshot((s) => !cancelled && setAgent(s))
      await a.start()
    })()

    return () => {
      cancelled = true
      unsubStatus()
      void agentRef.current?.stop()
      void childNotesRef.current?.stop()
      agentRef.current = null
      childNotesRef.current = null
    }
  }, [ready, role, id, name])

  /* --------------------------------------------------------- parent role */

  // One link per pairing. Reconciled against the pairing list so adding or
  // removing a child starts or stops exactly that child's link, leaving the
  // others connected.
  useEffect(() => {
    if (!ready || role !== 'parent') return
    let cancelled = false
    const links = linksRef.current

    for (const pairing of pairings) {
      if (links.has(pairing.peerId)) continue

      const transport = createTransport('parent', {
        deviceName: name,
        pairedDeviceId: pairing.address ?? pairing.peerId,
        pairedName: pairing.peerName,
        // Android rotates a device's BLE address for privacy, so the address we
        // paired with expires. When the transport finds the child at a new one,
        // remember it — otherwise every future launch starts from the dead
        // address again and has to re-scan.
        onAddressChanged: (address) => {
          setPairings((prev) => {
            const target = prev.find((p) => p.peerId === pairing.peerId)
            if (!target || target.address === address) return prev
            const merged = prev.map((p) =>
              p.peerId === pairing.peerId ? { ...p, address } : p,
            )
            void saveJSON(KEYS.pairings, merged)
            return merged
          })
        },
      })
      const unsubStatus = transport.onStatus((s) => {
        if (cancelled) return
        setLinkByChild((prev) => ({ ...prev, [pairing.peerId]: s }))
      })

      const notes = new NoteBox(transport, 'parent', perChild.notes(pairing.peerId))
      const entry: ChildLink = {
        pairing,
        transport,
        notes,
        link: null as unknown as ParentLink,
        stop: async () => {
          unsubStatus()
          await notes.stop().catch(() => {})
          await entry.link?.stop().catch(() => {})
        },
      }
      links.set(pairing.peerId, entry)

      void (async () => {
        notes.onChange((n) => {
          if (cancelled) return
          setNotes((prev) => [
            ...prev.filter((x) => x.childId !== pairing.peerId),
            ...n.map((x) => ({ ...x, childId: pairing.peerId })),
          ])
        })
        await notes.start()

        const ackedSeq = await loadJSON<number>(perChild.ackedSeq(pairing.peerId), 0)
        const link = new ParentLink(
          transport,
          {
            onChild: (c) => {
              if (cancelled) return
              // Key on the *pairing* id, not the id the child reports. The BLE
              // address is what every other part of the parent app uses, and a
              // child that reinstalls keeps its address but mints a new id.
              const live = { ...c, deviceId: pairing.peerId }
              setChildList((prev) => [
                ...prev.filter((x) => x.deviceId !== pairing.peerId),
                live,
              ])
            },
            onUsage: (r) => {
              for (const cb of usageSubs.current) cb(pairing.peerId, r)
            },
            onEvents: (events) => {
              for (const cb of eventSubs.current) cb(pairing.peerId, events)
              void saveJSON(
                perChild.ackedSeq(pairing.peerId),
                events[events.length - 1]?.seq ?? 0,
              )
            },
          },
          ackedSeq,
        )
        entry.link = link
        await link.start()
        // Catch up on anything pushed while this link was still being built.
        if (lastPolicyRef.current) {
          await link.setPolicy(lastPolicyRef.current(pairing.peerId)).catch(() => {})
        }
      })()
    }

    // Tear down links whose pairing has gone.
    for (const [peerId, entry] of links) {
      if (pairings.some((p) => p.peerId === peerId)) continue
      links.delete(peerId)
      void entry.stop()
      setLinkByChild((prev) => {
        const { [peerId]: _gone, ...rest } = prev
        return rest
      })
      setChildList((prev) => prev.filter((c) => c.deviceId !== peerId))
      setNotes((prev) => prev.filter((n) => n.childId !== peerId))
    }

    return () => {
      cancelled = true
    }
  }, [ready, role, name, pairings])

  // Stop everything on unmount, separately from the reconcile above so that
  // adding a child does not tear down the links that are already up.
  useEffect(() => {
    const links = linksRef.current
    return () => {
      for (const entry of links.values()) void entry.stop()
      links.clear()
    }
  }, [])

  /* ---------------------------------------------------------------- actions */

  const completeOnboarding = useCallback(async () => {
    await saveJSON(KEYS.onboarded, true)
    setOnboarded(true)
  }, [])

  const signIn = useCallback(async () => {
    await saveJSON(KEYS.signedIn, true)
    setSignedIn(true)
  }, [])

  const signOut = useCallback(async () => {
    await remove(KEYS.signedIn)
    setSignedIn(false)
  }, [])

  const setRole = useCallback(async (next: Role, displayName: string) => {
    await saveJSON(KEYS.role, { role: next, name: displayName })
    setName(displayName)
    setRoleState(next)
  }, [])

  const reset = useCallback(async () => {
    const links = linksRef.current
    for (const [peerId, entry] of links) {
      await entry.stop()
      await remove(perChild.ackedSeq(peerId))
      await remove(perChild.notes(peerId))
    }
    links.clear()
    await Promise.all([
      remove(KEYS.role),
      remove(KEYS.pairing),
      remove(KEYS.pairings),
      remove(KEYS.childState),
      remove(KEYS.parentState),
      remove(KEYS.notes),
    ])
    setRoleState(null)
    setPairings([])
    setChildList([])
    setLinkByChild({})
    setNotes([])
    setAgent(null)
  }, [])

  /**
   * Scans using any existing link's transport, or a throwaway one when nothing
   * is paired yet. A scan is a property of the radio, not of a connection.
   */
  const scan = useCallback(
    async (ms = 6000) => {
      const existing = [...linksRef.current.values()][0]
      if (existing) return (await existing.transport.scan?.(ms)) ?? []

      const probe = createTransport('parent', { deviceName: name })
      try {
        await probe.start()
        return (await probe.scan?.(ms)) ?? []
      } finally {
        await probe.stop().catch(() => {})
      }
    },
    [name],
  )

  const pair = useCallback(async (peer: Peer) => {
    const next: Pairing = {
      peerId: peer.id,
      address: peer.id,
      peerName: peer.name,
      pairedAt: Date.now(),
    }
    setPairings((prev) => {
      if (prev.some((p) => p.peerId === peer.id)) return prev
      const merged = [...prev, next]
      void saveJSON(KEYS.pairings, merged)
      return merged
    })
  }, [])

  const unpair = useCallback(async (peerId: string) => {
    setPairings((prev) => {
      const merged = prev.filter((p) => p.peerId !== peerId)
      void saveJSON(KEYS.pairings, merged)
      return merged
    })
    await remove(perChild.ackedSeq(peerId))
    await remove(perChild.notes(peerId))
  }, [])

  const refresh = useCallback(async (peerId?: string) => {
    const targets = peerId
      ? [linksRef.current.get(peerId)].filter(Boolean)
      : [...linksRef.current.values()]
    if (targets.length === 0) return

    setRefreshing(true)
    try {
      await Promise.all(
        targets.map((e) => e!.transport.reconnect?.().catch(() => {})),
      )
    } finally {
      setRefreshing(false)
    }
  }, [])

  const renameDevice = useCallback(async (peerId: string, label: string) => {
    setPairings((prev) => {
      const merged = prev.map((p) =>
        p.peerId === peerId ? { ...p, peerName: label.trim() || p.peerName } : p,
      )
      void saveJSON(KEYS.pairings, merged)
      return merged
    })
  }, [])

  /** Policy is household-wide, so it fans out to every paired child. */
  const pushPolicy = useCallback(async (build: (childId: string) => Policy) => {
    lastPolicyRef.current = build
    await Promise.all(
      [...linksRef.current.values()].map((e) =>
        e.link?.setPolicy(build(e.pairing.peerId)).catch(() => {}),
      ),
    )
  }, [])

  const sendNote = useCallback(
    async (text: string, childId?: string) => {
      if (role === 'child') {
        await childNotesRef.current?.send(text)
        return
      }
      const targets = childId
        ? [linksRef.current.get(childId)].filter(Boolean)
        : [...linksRef.current.values()]
      await Promise.all(targets.map((e) => e!.notes.send(text).catch(() => {})))
    },
    [role],
  )

  const onChildEvents = useCallback((cb: (childId: string, e: ChildEvent[]) => void) => {
    eventSubs.current.add(cb)
    return () => eventSubs.current.delete(cb)
  }, [])

  const onChildUsage = useCallback((cb: (childId: string, r: UsageReport) => void) => {
    usageSubs.current.add(cb)
    return () => usageSubs.current.delete(cb)
  }, [])

  /** Best status across all children — what the header badge shows. */
  const aggregate = useMemo<LinkStatus>(() => {
    if (role === 'child') return childLink
    const all = Object.values(linkByChild)
    if (all.length === 0) return { state: 'off' }
    return (
      all.find((s) => s.state === 'connected') ??
      all.find((s) => s.state === 'error') ??
      all[0]
    )
  }, [role, childLink, linkByChild])

  const value = useMemo<DeviceCtx>(
    () => ({
      ready,
      onboarded,
      completeOnboarding,
      signedIn,
      signIn,
      signOut,
      role,
      deviceId: id,
      name,
      setRole,
      reset,
      pairings,
      linkByChild,
      link: aggregate,
      children: childList,
      child: childList[0] ?? null,
      pairing: pairings[0] ?? null,
      scan,
      pair,
      unpair,
      renameDevice,
      refresh,
      refreshing,
      pushPolicy,
      onChildEvents,
      onChildUsage,
      agent,
      notes,
      sendNote,
    }),
    [ready, onboarded, completeOnboarding, signedIn, signIn, signOut, role, id, name, setRole, reset, pairings, linkByChild, aggregate, childList, scan, pair, unpair, renameDevice, refresh, refreshing, pushPolicy, onChildEvents, onChildUsage, agent, notes, sendNote],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDevice(): DeviceCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDevice must be used inside <DeviceProvider>')
  return v
}
