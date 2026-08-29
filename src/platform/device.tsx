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
import { NoteBox, type NoteChannel, type NoteState } from '../agent/notes'
import { childNoteChannel } from '../agent/cloudNotes'
import { createTransport } from '../link'
import type { ChildEvent, Policy, UsageReport } from '../link/protocol'
import type { LinkStatus, Peer, Transport } from '../link/transport'
import { hasCloud, supabase } from '../cloud/client'
import { KEYS, deviceId as ensureDeviceId, loadJSON, perChild, remove, saveJSON } from './storage'

export type Role = 'parent' | 'child'
export type Pairing = { peerId: string; address: string; peerName: string; pairedAt: number; cloudChildId?: string }
type ChildLink = { pairing: Pairing; transport: Transport; link: ParentLink; notes: NoteBox; stop: () => Promise<void> }
export type ChildNote = NoteState & { childId: string }
type DeviceCtx = {
  ready: boolean; onboarded: boolean; completeOnboarding: () => Promise<void>; signedIn: boolean; signIn: () => Promise<void>; signOut: () => Promise<void>; role: Role | null; deviceId: string; setRole: (role: Role, name: string) => Promise<void>; reset: () => Promise<void>; name: string
  pairings: Pairing[]; linkByChild: Record<string, LinkStatus>; link: LinkStatus; children: ChildLive[]; child: ChildLive | null; pairing: Pairing | null
  scan: (ms?: number) => Promise<Peer[]>; pair: (peer: Peer) => Promise<void>; unpair: (peerId: string) => Promise<void>; renameDevice: (peerId: string, name: string) => Promise<void>; refresh: (peerId?: string) => Promise<void>; refreshing: boolean
  pushPolicy: (build: (childId: string) => Policy) => Promise<void>; requestLocate: (peerId?: string) => Promise<boolean>; onChildEvents: (cb: (childId: string, events: ChildEvent[]) => void) => () => void; onChildUsage: (cb: (childId: string, report: UsageReport) => void) => () => void
  agent: AgentSnapshot | null; announceEnrolment: () => Promise<void>; notes: ChildNote[]; sendNote: (text: string, childId?: string) => Promise<void>; setNoteChannel: (localChildId: string, channel: NoteChannel | null) => void; setCloudChildren: (children: { id: string; name: string }[]) => Promise<void>
}
const Ctx = createContext<DeviceCtx | null>(null)

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false), [onboarded, setOnboarded] = useState(false), [role, setRoleState] = useState<Role | null>(null), [name, setName] = useState('Nestly'), [id, setId] = useState(''), [pairings, setPairings] = useState<Pairing[]>([]), [linkByChild, setLinkByChild] = useState<Record<string, LinkStatus>>({}), [childList, setChildList] = useState<ChildLive[]>([]), [agent, setAgent] = useState<AgentSnapshot | null>(null), [notes, setNotes] = useState<ChildNote[]>([]), [childLink, setChildLink] = useState<LinkStatus>({ state: 'off' }), [refreshing, setRefreshing] = useState(false), [signedIn, setSignedIn] = useState(false)
  const linksRef = useRef(new Map<string, ChildLink>()), lastPolicyRef = useRef<((childId: string) => Policy) | null>(null), agentRef = useRef<ChildAgent | null>(null), childNotesRef = useRef<NoteBox | null>(null), cloudNotesRef = useRef(new Map<string, NoteBox>()), eventSubs = useRef(new Set<(childId: string, e: ChildEvent[]) => void>()), usageSubs = useRef(new Set<(childId: string, r: UsageReport) => void>())

  useEffect(() => { void (async () => {
    const [stored, list, legacy, myId, seen, signed] = await Promise.all([loadJSON<{ role: Role; name: string } | null>(KEYS.role, null), loadJSON<Pairing[]>(KEYS.pairings, []), loadJSON<Pairing | null>(KEYS.pairing, null), ensureDeviceId(), loadJSON<boolean>(KEYS.onboarded, false), loadJSON<boolean>(KEYS.signedIn, false)])
    setSignedIn(signed); let merged = list
    if (legacy && !list.some((p) => p.peerId === legacy.peerId)) merged = [...list, legacy]
    if (legacy) await remove(KEYS.pairing)
    if (merged.some((p) => !p.address)) merged = merged.map((p) => p.address ? p : { ...p, address: p.peerId })
    if (merged !== list) await saveJSON(KEYS.pairings, merged)
    setId(myId); setPairings(merged); setOnboarded(seen); if (stored) { setRoleState(stored.role); setName(stored.name) }; setReady(true)
  })() }, [])

  useEffect(() => { if (!ready || role !== 'child' || !id) return; let cancelled = false; const transport = createTransport('child', { deviceName: name }); const unsubStatus = transport.onStatus((s) => !cancelled && setChildLink(s)); void (async () => { const box = new NoteBox(transport, 'child', KEYS.notes); childNotesRef.current = box; box.onChange((n) => !cancelled && setNotes(n.map((x) => ({ ...x, childId: id })))); await box.start(); box.setCloud(childNoteChannel()); const a = new ChildAgent(transport, { deviceId: id, name }); agentRef.current = a; a.onSnapshot((s) => !cancelled && setAgent(s)); await a.start() })(); return () => { cancelled = true; unsubStatus(); void agentRef.current?.stop(); void childNotesRef.current?.stop(); agentRef.current = null; childNotesRef.current = null } }, [ready, role, id, name])

  useEffect(() => { if (!ready || role !== 'parent') return; let cancelled = false; const links = linksRef.current
    for (const pairing of pairings) { if (links.has(pairing.peerId)) continue; const transport = createTransport('parent', { deviceName: name, pairedDeviceId: pairing.address ?? pairing.peerId, pairedName: pairing.peerName, onAddressChanged: (address) => setPairings((prev) => { const target = prev.find((p) => p.peerId === pairing.peerId); if (!target || target.address === address) return prev; const merged = prev.map((p) => p.peerId === pairing.peerId ? { ...p, address } : p); void saveJSON(KEYS.pairings, merged); return merged }) }); const unsubStatus = transport.onStatus((s) => { if (!cancelled) setLinkByChild((prev) => ({ ...prev, [pairing.peerId]: s })) }); const box = new NoteBox(transport, 'parent', perChild.notes(pairing.peerId)); const entry: ChildLink = { pairing, transport, notes: box, link: null as unknown as ParentLink, stop: async () => { unsubStatus(); await box.stop().catch(() => {}); await entry.link?.stop().catch(() => {}) } }; links.set(pairing.peerId, entry); void (async () => { box.onChange((n) => { if (!cancelled) setNotes((prev) => [...prev.filter((x) => x.childId !== pairing.peerId), ...n.map((x) => ({ ...x, childId: pairing.peerId }))]) }); await box.start(); const ackedSeq = await loadJSON<number>(perChild.ackedSeq(pairing.peerId), 0); const link = new ParentLink(transport, { onChild: (c) => { if (cancelled) return; if (c.cloudChildId) setPairings((prev) => { const target = prev.find((p) => p.peerId === pairing.peerId); if (!target || target.cloudChildId === c.cloudChildId) return prev; const merged = prev.map((p) => p.peerId === pairing.peerId ? { ...p, cloudChildId: c.cloudChildId } : p); void saveJSON(KEYS.pairings, merged); return merged }); const live = { ...c, deviceId: pairing.peerId }; setChildList((prev) => [...prev.filter((x) => x.deviceId !== pairing.peerId), live]) }, onUsage: (r) => { for (const cb of usageSubs.current) cb(pairing.peerId, r) }, onEvents: (events) => { for (const cb of eventSubs.current) cb(pairing.peerId, events); void saveJSON(perChild.ackedSeq(pairing.peerId), events[events.length - 1]?.seq ?? 0) } }, ackedSeq); entry.link = link; await link.start(); if (lastPolicyRef.current) await link.setPolicy(lastPolicyRef.current(pairing.peerId)).catch(() => {}) })() }
    for (const [peerId, entry] of links) { if (pairings.some((p) => p.peerId === peerId)) continue; links.delete(peerId); void entry.stop(); setLinkByChild((prev) => { const { [peerId]: _gone, ...rest } = prev; return rest }); setChildList((prev) => prev.filter((c) => c.deviceId !== peerId)); setNotes((prev) => prev.filter((n) => n.childId !== peerId)) }
    return () => { cancelled = true }
  }, [ready, role, name, pairings])
  useEffect(() => { const links = linksRef.current, cloudNotes = cloudNotesRef.current; return () => { for (const entry of links.values()) void entry.stop(); links.clear(); for (const box of cloudNotes.values()) void box.stop(); cloudNotes.clear() } }, [])

  const completeOnboarding = useCallback(async () => { await saveJSON(KEYS.onboarded, true); setOnboarded(true) }, [])
  const signIn = useCallback(async () => { await saveJSON(KEYS.signedIn, true); setSignedIn(true) }, [])
  const signOut = useCallback(async () => { if (hasCloud()) await supabase().auth.signOut().catch(() => {}); await remove(KEYS.signedIn); await remove(KEYS.household); setSignedIn(false) }, [])
  const setRole = useCallback(async (next: Role, displayName: string) => { await saveJSON(KEYS.role, { role: next, name: displayName }); setName(displayName); setRoleState(next) }, [])
  const reset = useCallback(async () => { const links = linksRef.current; for (const [peerId, entry] of links) { await entry.stop(); await remove(perChild.ackedSeq(peerId)); await remove(perChild.notes(peerId)) }; links.clear(); for (const [cloudId, box] of cloudNotesRef.current) { await box.stop().catch(() => {}); await remove(perChild.notes(cloudId)) }; cloudNotesRef.current.clear(); await Promise.all([remove(KEYS.role), remove(KEYS.pairing), remove(KEYS.pairings), remove(KEYS.childState), remove(KEYS.parentState), remove(KEYS.notes)]); setRoleState(null); setPairings([]); setChildList([]); setLinkByChild({}); setNotes([]); setAgent(null) }, [])
  const scan = useCallback(async (ms = 6000) => { const existing = [...linksRef.current.values()][0]; if (existing) return (await existing.transport.scan?.(ms)) ?? []; const probe = createTransport('parent', { deviceName: name }); try { await probe.start(); return (await probe.scan?.(ms)) ?? [] } finally { await probe.stop().catch(() => {}) } }, [name])
  const pair = useCallback(async (peer: Peer) => { const next: Pairing = { peerId: peer.id, address: peer.id, peerName: peer.name, pairedAt: Date.now() }; setPairings((prev) => { if (prev.some((p) => p.peerId === peer.id)) return prev; const merged = [...prev, next]; void saveJSON(KEYS.pairings, merged); return merged }) }, [])
  const unpair = useCallback(async (peerId: string) => { setPairings((prev) => { const merged = prev.filter((p) => p.peerId !== peerId); void saveJSON(KEYS.pairings, merged); return merged }); await remove(perChild.ackedSeq(peerId)); await remove(perChild.notes(peerId)) }, [])
  const refresh = useCallback(async (peerId?: string) => { const targets = peerId ? [linksRef.current.get(peerId)].filter(Boolean) : [...linksRef.current.values()]; if (!targets.length) return; setRefreshing(true); try { await Promise.all(targets.map((e) => e!.transport.reconnect?.().catch(() => {}))) } finally { setRefreshing(false) } }, [])
  const renameDevice = useCallback(async (peerId: string, label: string) => { setPairings((prev) => { const merged = prev.map((p) => p.peerId === peerId ? { ...p, peerName: label.trim() || p.peerName } : p); void saveJSON(KEYS.pairings, merged); return merged }) }, [])
  const pushPolicy = useCallback(async (build: (childId: string) => Policy) => { lastPolicyRef.current = build; await Promise.all([...linksRef.current.values()].map((e) => e.link?.setPolicy(build(e.pairing.peerId)).catch(() => {}))) }, [])
  const sendNote = useCallback(async (text: string, childId?: string) => { if (role === 'child') { await childNotesRef.current?.send(text); return }; const boxes = childId ? [linksRef.current.get(childId)?.notes ?? cloudNotesRef.current.get(childId)].filter(Boolean) : [...[...linksRef.current.values()].map((e) => e.notes), ...cloudNotesRef.current.values()]; await Promise.all(boxes.map((b) => b!.send(text).catch(() => {}))) }, [role])
  const setNoteChannel = useCallback((localChildId: string, channel: NoteChannel | null) => { (linksRef.current.get(localChildId)?.notes ?? cloudNotesRef.current.get(localChildId))?.setCloud(channel) }, [])
  const setCloudChildren = useCallback(async (list: { id: string; name: string }[]) => { const boxes = cloudNotesRef.current, wanted = new Set(list.map((c) => c.id)); for (const [cloudId, box] of boxes) { if (wanted.has(cloudId)) continue; boxes.delete(cloudId); await box.stop().catch(() => {}); setNotes((prev) => prev.filter((n) => n.childId !== cloudId)) }; for (const child of list) { if (boxes.has(child.id)) continue; const box = new NoteBox(null, 'parent', perChild.notes(child.id)); boxes.set(child.id, box); box.onChange((n) => setNotes((prev) => [...prev.filter((x) => x.childId !== child.id), ...n.map((x) => ({ ...x, childId: child.id }))])); await box.start() } }, [])
  const requestLocate = useCallback(async (peerId?: string) => { const targets = peerId ? [linksRef.current.get(peerId)].filter(Boolean) : [...linksRef.current.values()]; const asked = await Promise.all(targets.map((e) => e!.link?.requestLocate().catch(() => false) ?? false)); return asked.some(Boolean) }, [])
  const onChildEvents = useCallback((cb: (childId: string, e: ChildEvent[]) => void) => { eventSubs.current.add(cb); return () => eventSubs.current.delete(cb) }, [])
  const onChildUsage = useCallback((cb: (childId: string, r: UsageReport) => void) => { usageSubs.current.add(cb); return () => usageSubs.current.delete(cb) }, [])
  const aggregate = useMemo<LinkStatus>(() => { if (role === 'child') return childLink; const all = Object.values(linkByChild); return all.length === 0 ? { state: 'off' } : (all.find((s) => s.state === 'connected') ?? all.find((s) => s.state === 'error') ?? all[0]) }, [role, childLink, linkByChild])
  const announceEnrolment = useCallback(async () => { await agentRef.current?.announce() }, [])
  const value = useMemo<DeviceCtx>(() => ({ ready, onboarded, completeOnboarding, signedIn, signIn, signOut, role, deviceId: id, name, setRole, reset, pairings, linkByChild, link: aggregate, children: childList, child: childList[0] ?? null, pairing: pairings[0] ?? null, scan, pair, unpair, renameDevice, refresh, refreshing, pushPolicy, requestLocate, onChildEvents, onChildUsage, agent, announceEnrolment, notes, sendNote, setNoteChannel, setCloudChildren }), [ready, onboarded, completeOnboarding, signedIn, signIn, signOut, role, id, name, setRole, reset, pairings, linkByChild, aggregate, childList, scan, pair, unpair, renameDevice, refresh, refreshing, pushPolicy, requestLocate, onChildEvents, onChildUsage, agent, announceEnrolment, notes, sendNote, setNoteChannel, setCloudChildren])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useDevice(): DeviceCtx { const v = useContext(Ctx); if (!v) throw new Error('useDevice must be used inside <DeviceProvider>'); return v }
