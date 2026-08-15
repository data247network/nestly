import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { NestlyLink, type NativeVisit } from '../link/ble-peripheral'
import {
  distanceM,
  reminderDueAt,
  scenarioActiveAt,
  type EmergencyContact,
  type Reminder,
  type ChildEvent,
  type ChildEventKind,
  type Fix,
  type Message,
  type Policy,
  type PolicyScenario,
  type UsageReport,
  PROTOCOL_VERSION,
} from '../link/protocol'
import type { Transport } from '../link/transport'
import { KEYS, loadJSON, saveJSON } from '../platform/storage'
import { isUrgent, publishEndpoint, pushInterval, uplink } from './cloudUplink'

/**
 * The child device's agent.
 *
 * This is the part that makes the child phone a participant rather than a
 * viewer. It runs whether or not a parent is in range: sampling location,
 * deciding which scenario is active, deciding whether the phone should be
 * locked, and appending every transition to a durable log.
 *
 * Nothing here depends on connectivity. The log is the product — when the
 * parent's phone next comes within Bluetooth range, the backlog is handed over
 * and only then trimmed. That is the whole point of a store-and-forward design:
 * the child being out of range must cost you history, not create gaps.
 */

export type AgentSnapshot = {
  running: boolean
  locked: boolean
  activeScenario: PolicyScenario | null
  /** Minutes until the active scenario lifts, or null when nothing is active. */
  unlocksInMin: number | null
  lastFix: Fix | null
  battery: number | null
  charging: boolean | null
  policyVersion: number
  /** Events recorded but not yet confirmed received by the parent. */
  pendingEvents: number
  lastSyncAt: number | null
  /** Always available to the child, lock screen included. */
  contacts: EmergencyContact[]
  /** Web filtering — consent given, and the tunnel actually up. */
  filterConsented: boolean
  filterRunning: boolean
  /** Usage Access granted in Settings; without it there is no per-app time. */
  usageAccess: boolean
  /** Contacts permission granted; without it new numbers go unnoticed. */
  contactsGranted: boolean
  /**
   * Device admin and the overlay right, as Android currently reports them.
   *
   * On the snapshot rather than polled separately by the screen, so there is
   * one answer to "is protection on" and it is the same one tamper detection
   * uses. The setup card used to ask Android itself on every single render,
   * which was both wasteful and a second source of truth.
   */
  adminActive: boolean
  overlayAllowed: boolean
  /** The most recent site the child was warned about, for the warning banner. */
  lastWarning: { domain: string; cat: string; ts: number } | null
  /** Reminders from the parent, so the child's phone can list today's. */
  reminders: Reminder[]
  /** The one currently showing, if any — drives the banner on the child home. */
  dueReminder: { id: string; title: string; note?: string; ts: number } | null
}

type Persisted = {
  policy: Policy | null
  log: ChildEvent[]
  headSeq: number
  /** fenceId -> was the child inside it at the last evaluation. */
  inside: Record<string, boolean>
  lastSyncAt: number | null
}

/**
 * A factory, not a shared constant.
 *
 * The agent mutates its own state in place (`headSeq += 1`, `log.push(...)`).
 * Handing out one shared object as the "nothing stored yet" fallback means a
 * second agent inherits the first one's sequence numbers, log and — worst of
 * all — its policy, so a fresh install would silently start life running the
 * previous device's rules.
 */
const emptyState = (): Persisted => ({
  policy: null,
  log: [],
  headSeq: 0,
  inside: {},
  lastSyncAt: null,
})

/** Keep the log bounded — a child phone can go a long time without contact. */
const MAX_LOG = 500
const TICK_MS = 15_000

/**
 * How long to wait for an on-demand fix before answering with what we have.
 *
 * Indoors a high-accuracy lock can take a very long time or never arrive, and a
 * parent is watching a spinner throughout. Twelve seconds is long enough for a
 * warm GPS or a wifi fix and short enough to stay honest about the wait.
 */
const LOCATE_TIMEOUT_MS = 12_000

export class ChildAgent {
  private state: Persisted = emptyState()
  private timer?: ReturnType<typeof setInterval>
  private unsubscribe?: () => void
  private snapshot: AgentSnapshot = {
    running: false,
    locked: false,
    activeScenario: null,
    unlocksInMin: null,
    lastFix: null,
    battery: null,
    charging: null,
    policyVersion: 0,
    pendingEvents: 0,
    lastSyncAt: null,
    contacts: [],
    filterConsented: false,
    filterRunning: false,
    usageAccess: false,
    contactsGranted: false,
    // Assumed granted until the first read says otherwise: showing a permission
    // prompt for a moment on every launch, before the check has run, teaches a
    // child to dismiss it without reading.
    adminActive: true,
    overlayAllowed: true,
    lastWarning: null,
    reminders: [],
    dueReminder: null,
  }
  private subs = new Set<(s: AgentSnapshot) => void>()
  private lastActiveId: string | null = null
  private helloSent = false
  /** Latest native visit tally; replaced wholesale each tick. */
  private visits: NativeVisit[] = []
  private lastUsagePush = 0
  /** Today's report, so the cloud push sends the same figures the radio did. */
  private lastUsageReport?: UsageReport
  /** When the last routine cloud push happened, to pace the next one. */
  private lastCloudPush = 0
  /**
   * What protection looked like last tick.
   *
   * Undefined until the first read, and that distinction matters: treating
   * "not yet known" as "was on" would raise a tamper alert for every protection
   * that simply has not been granted yet, on every fresh install.
   */
  private lastProtection?: {
    adminActive: boolean
    overlayAllowed: boolean
    filterRunning: boolean
    usageAccess: boolean
  }

  constructor(
    private transport: Transport,
    private identity: { deviceId: string; name: string },
  ) {}

  /* ------------------------------------------------------------ lifecycle */

  async start() {
    this.state = await loadJSON<Persisted>(KEYS.childState, emptyState())
    this.unsubscribe = this.transport.onMessage((m) => void this.onMessage(m))

    this.transport.onStatus((s) => {
      // A fresh connection needs a fresh hello: the parent uses it to work out
      // how far behind it is.
      if (s.state === 'connected' && !this.helloSent) void this.sayHello()
      if (s.state !== 'connected') this.helloSent = false
    })

    // Hand the native uploader its address before anything else needs it.
    await publishEndpoint()

    await this.transport.start()
    await this.record('agent-start')
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.emit({ running: true })
    await this.tick()
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    await this.transport.stop()
    await this.persist()
    this.emit({ running: false })
  }

  onSnapshot(cb: (s: AgentSnapshot) => void) {
    this.subs.add(cb)
    cb(this.snapshot)
    return () => this.subs.delete(cb)
  }

  /** Current snapshot without subscribing. */
  current(): AgentSnapshot {
    return this.snapshot
  }

  private emit(patch: Partial<AgentSnapshot>) {
    const wasLocked = this.snapshot.locked
    this.snapshot = { ...this.snapshot, ...patch }
    for (const cb of this.subs) cb(this.snapshot)

    // Drive the real lock from the same state the UI reads, so the overlay and
    // the in-app screen can never disagree about whether the phone is locked.
    if (this.snapshot.locked !== wasLocked) void this.applyLock()
  }

  /**
   * Puts the enforced lock up or takes it down.
   *
   * The in-app lock screen only stopped a child who chose to keep looking at
   * it; pressing Home gave the phone back. This draws over everything instead.
   * Emergency numbers ride along on the overlay so the lock can never stand
   * between a child and help.
   */
  private async applyLock() {
    if (!Capacitor.isNativePlatform()) return
    const scenario = this.snapshot.activeScenario
    const contacts = this.snapshot.contacts.flatMap((c) =>
      c.phone?.trim() ? [c.name ?? '', c.phone] : [],
    )
    try {
      await NestlyLink.setLocked({
        locked: this.snapshot.locked,
        title: this.snapshot.locked ? 'Phone locked' : '',
        subtitle: scenario ? `${scenario.name} is running.` : 'Locked by your parent.',
        contacts,
      })
    } catch {
      // Older build without the method, or permission revoked. The in-app lock
      // screen still shows; enforcement is simply weaker, which the child's own
      // setup screen already warns about.
    }
  }

  /* ----------------------------------------------------------------- tick */

  /**
   * One evaluation pass: drain fixes, re-check zones and scenarios, push
   * whatever is pending. Called on a timer, and directly by tests so they do
   * not have to wait on wall-clock time.
   */
  async tick() {
    const fixes = await this.collectFixes()
    for (const fix of fixes) this.evaluateGeofences(fix)

    const latest = fixes[fixes.length - 1] ?? this.snapshot.lastFix
    const battery = await this.readBattery()
    this.evaluateScenarios(new Date())
    await this.collectFilterEvents()
    await this.collectNewContacts()

    this.emit({
      lastFix: latest ?? null,
      battery: battery.level,
      charging: battery.charging,
      pendingEvents: this.state.log.length,
      policyVersion: this.state.policy?.version ?? 0,
      lastSyncAt: this.state.lastSyncAt,
    })

    if (battery.level != null && battery.level <= 15 && !this.snapshot.charging) {
      await this.recordOnce('battery-low', 'low', 30 * 60_000)
    }

    await this.checkTampering()
    await this.persist()
    await this.push()
    await this.pushUsage()
    // Independent of Bluetooth: this is what reaches a parent who is miles away.
    await this.pushCloud()
  }

  /* --------------------------------------------------------------- filter */

  /**
   * Applies the parent's filter rules to the native VPN.
   *
   * Called whenever a policy arrives. Consent is never requested from here —
   * that is a system dialog needing a visible Activity, so the child's own
   * screen asks for it and this only starts the tunnel once it exists.
   */
  private async applyFilter() {
    if (!Capacitor.isNativePlatform()) return
    const f = this.state.policy?.filters
    if (!f) return

    const rules = {
      adult: f.adult,
      violence: f.violence,
      gambling: f.gambling,
      social: f.social ?? false,
      custom: f.custom ?? [],
      warn: f.warn ?? [],
    }

    try {
      const status = await NestlyLink.filterStatus()
      this.emit({ filterConsented: status.consented, filterRunning: status.running })
      if (!status.consented) return

      if (status.running) await NestlyLink.updateFilter(rules)
      else await NestlyLink.startFilter(rules)
      this.emit({ filterRunning: true })
    } catch {
      this.emit({ filterRunning: false })
    }
  }

  /** Drains block/warn decisions from the native filter into the event log. */
  private async collectFilterEvents() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const { events, visits, running } = await NestlyLink.drainFilterEvents()
      this.visits = visits
      this.emit({ filterRunning: running })

      for (const e of events) {
        if (e.kind === 'revoked') {
          // Filtering being switched off is itself something the parent needs
          // to know — otherwise protection lapses silently.
          await this.record('filter-off')
          this.emit({ filterRunning: false })
          continue
        }
        await this.record(
          e.kind === 'blocked' ? 'site-blocked' : 'site-warned',
          e.domain,
          undefined,
          e.category,
        )
        if (e.kind === 'warned') {
          this.emit({ lastWarning: { domain: e.domain, cat: e.category, ts: e.ts } })
        }
      }
    } catch {
      /* filter not available on this build or platform */
    }
  }

  /**
   * Records contacts newly added to the child's phone.
   *
   * Additions only, and only the name. The native side seeds its baseline
   * silently on first run, so switching this on does not fire one alert per
   * existing contact — which would train the parent to ignore the whole feed.
   */
  private async collectNewContacts() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const { granted, added } = await NestlyLink.drainNewContacts()
      this.emit({ contactsGranted: granted })
      for (const name of added) {
        await this.record('contact-added', name)
      }
    } catch {
      /* permission not granted, or an older build without the method */
    }
  }

  /**
   * Sends the day's usage and browsing summary.
   *
   * Separate from the event log because it is a *replaceable snapshot* rather
   * than a history: resending today's totals is correct, whereas resending an
   * arrival is not.
   */
  /**
   * Builds today's usage report, and sends it wherever it can go.
   *
   * The build used to sit behind `if (transport connected) return`, so a phone
   * with no parent nearby never even *assembled* a report — which is why the
   * web dashboard showed "—" for screen time no matter how long the child had
   * been on their phone. Assembling is cheap and has nothing to do with the
   * radio; only the sending does.
   *
   * Kept on the instance so the cloud push can carry the same report rather
   * than asking Android for the figures a second time a few milliseconds later.
   */
  private async pushUsage() {
    if (Date.now() - this.lastUsagePush < 60_000) return
    this.lastUsagePush = Date.now()

    let apps: UsageReport['apps'] = []
    let usageAccess = false
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await NestlyLink.getUsageToday()
        usageAccess = res.granted
        apps = res.apps.map((a) => ({
          pkg: a.pkg,
          label: a.label,
          minutes: a.minutes,
          category: a.category,
        }))
      } catch {
        /* usage access not granted */
      }
    }
    this.emit({ usageAccess })

    const report: UsageReport = {
      t: 'usage',
      day: localDay(),
      apps,
      sites: this.visits.map((v) => ({
        domain: v.domain,
        count: v.count,
        lastAt: v.lastAt,
        blocked: v.blocked,
        cat: (v.category || undefined) as UsageReport['sites'][number]['cat'],
      })),
      usageAccess,
      filterOn: this.snapshot.filterRunning,
    }
    this.lastUsageReport = report

    // The radio is optional here. The report exists either way, and the cloud
    // push picks it up on its own cadence.
    if (this.transport.status().state === 'connected') {
      await this.transport.send(report)
    }
  }

  /* ------------------------------------------------------------- location */

  private async collectFixes(): Promise<Fix[]> {
    if (Capacitor.isNativePlatform()) {
      // Native buffers fixes while the WebView is throttled, so this returns a
      // backlog rather than a single reading.
      try {
        const { fixes } = await NestlyLink.drainFixes()
        return fixes
      } catch {
        return []
      }
    }
    const simulated = readSimulatedFix()
    return simulated ? [simulated] : []
  }

  private async readBattery(): Promise<{ level: number | null; charging: boolean | null }> {
    if (Capacitor.isNativePlatform()) {
      try {
        return await NestlyLink.getBattery()
      } catch {
        return { level: null, charging: null }
      }
    }
    return { level: this.snapshot.battery, charging: this.snapshot.charging }
  }

  /* ------------------------------------------------------------ geofences */

  private evaluateGeofences(fix: Fix) {
    const fences = this.state.policy?.geofences ?? []
    for (const fence of fences) {
      const inside = distanceM(fix, fence) <= fence.radiusM
      const wasInside = this.state.inside[fence.id]

      // undefined means we have never evaluated this fence, so the first fix
      // establishes a baseline rather than firing a spurious arrival.
      if (wasInside === undefined) {
        this.state.inside[fence.id] = inside
        continue
      }
      if (inside === wasInside) continue

      this.state.inside[fence.id] = inside
      const notify = inside ? fence.notifyArrive : fence.notifyLeave
      if (notify) {
        void this.record(inside ? 'zone-enter' : 'zone-leave', fence.name, fix)
      }
    }
  }

  /* ------------------------------------------------------------ scenarios */

  private evaluateScenarios(now: Date) {
    const scenarios = this.state.policy?.scenarios ?? []
    const active = scenarios.find((s) => scenarioActiveAt(s, now)) ?? null
    const lockNow = this.state.policy?.lockNow ?? false

    if (active?.id !== this.lastActiveId) {
      if (this.lastActiveId) void this.record('scenario-end', this.lastActiveId)
      if (active) void this.record('scenario-start', active.id)
      this.lastActiveId = active?.id ?? null
    }

    const locked = lockNow || active != null
    const wasLocked = this.snapshot.locked
    this.emit({
      activeScenario: active,
      locked,
      unlocksInMin: active ? minutesUntilEnd(active, now) : null,
      contacts: this.state.policy?.contacts ?? [],
    })

    // Lock state is the one thing a parent checks in real time, so push it the
    // moment it changes rather than waiting for the next periodic telemetry.
    // Without this the parent's card could sit on "unlocked" for a whole
    // interval after the child had actually locked.
    if (locked !== wasLocked) void this.push()

    this.evaluateReminders(now)
  }

  /**
   * Fires any reminder that has come due.
   *
   * Evaluated locally from the policy, so a reminder still arrives when the
   * phones have been apart all day — which is exactly when a parent most wants
   * one. `firedOn` keys on the local date so a daily reminder fires once per
   * day rather than on every tick inside its window.
   */
  private firedOn = new Map<string, string>()

  /** Stable small int from a reminder id, for the Android notification id. */
  private static hash(id: string): number {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    // Keep clear of the foreground service's id (1001).
    return 2000 + (Math.abs(h) % 10_000)
  }

  private evaluateReminders(now: Date) {
    const reminders = this.state.policy?.reminders ?? []
    const today = now.toDateString()

    for (const r of reminders) {
      if (!reminderDueAt(r, now)) continue
      if (this.firedOn.get(r.id) === today) continue
      this.firedOn.set(r.id, today)

      void this.record('reminder-shown', r.title)
      this.emit({
        dueReminder: { id: r.id, title: r.title, note: r.note, ts: Date.now() },
      })
      // A banner inside the app is not enough — the child will not have it
      // open. The native notification is what actually reaches them.
      void NestlyLink.notify({
        title: r.title,
        body: r.note ?? 'Reminder from your parent',
        id: ChildAgent.hash(r.id),
      }).catch(() => {})
    }

    this.emit({ reminders })
  }

  /* ------------------------------------------------------------- tamper */

  /**
   * Notices protection being switched off, and says so loudly.
   *
   * Android does not let an app prevent any of this. Settings is system UI, no
   * app may put a prompt in front of it, and a device admin can always be
   * deactivated. So prevention was never the design — being unable to do it
   * quietly is. Each of these is recorded as an urgent event, which pushes to
   * the cloud immediately rather than waiting for the next batch, because the
   * next step after disabling protection is usually uninstalling the app.
   *
   * Only transitions are reported. Something that was never granted is not a
   * tamper; it is a setup step, and the child's own screen already asks for it.
   */
  private async checkTampering() {
    if (!Capacitor.isNativePlatform()) return

    let now: {
      adminActive: boolean
      adminDisabledAt: number
      overlayAllowed: boolean
      filterRunning: boolean
      usageAccess: boolean
    }
    try {
      now = await NestlyLink.protectionStatus()
    } catch {
      return // older build without the method
    }

    // The truth about what is switched on, published rather than discarded.
    //
    // This call already knew all of it and used it only to spot tampering, so
    // the child's own screen was left asking for permissions that had been
    // granted days earlier: `filterConsented` was written *only* inside
    // `applyFilter`, which returns early until a policy arrives, so on every
    // launch it read false while the VPN was demonstrably running. The setup
    // card then told a child to turn on things that were already on — and a
    // screen that asks for what it already has is one nobody reads.
    //
    // A running tunnel implies consent: it cannot start without it.
    this.emit({
      filterRunning: now.filterRunning,
      filterConsented: this.snapshot.filterConsented || now.filterRunning,
      usageAccess: now.usageAccess,
      adminActive: now.adminActive,
      overlayAllowed: now.overlayAllowed,
    })

    // Reported by the receiver rather than inferred, so a deactivate-and-
    // reactivate between ticks is still caught.
    if (now.adminDisabledAt > 0) {
      await this.record('tamper', 'uninstall protection')
    }

    const before = this.lastProtection
    this.lastProtection = {
      adminActive: now.adminActive,
      overlayAllowed: now.overlayAllowed,
      filterRunning: now.filterRunning,
      usageAccess: now.usageAccess,
    }
    if (!before) return

    if (before.overlayAllowed && !now.overlayAllowed) {
      await this.record('tamper', 'lock permission')
    }
    if (before.usageAccess && !now.usageAccess) {
      await this.record('tamper', 'screen time access')
    }
    // Filtering already has its own dedicated event, and raising both would
    // show a parent the same fact twice under different names.
    if (before.filterRunning && !now.filterRunning) {
      await this.recordOnce('filter-off', 'vpn', 10 * 60_000)
    }
  }

  /* ----------------------------------------------------------------- log */

  private async record(kind: ChildEventKind, ref?: string, fix?: Fix, cat?: string) {
    this.state.headSeq += 1
    const event: ChildEvent = {
      seq: this.state.headSeq,
      ts: Date.now(),
      kind,
      ...(ref ? { ref } : {}),
      ...(cat ? { cat: cat as ChildEvent['cat'] } : {}),
      ...(fix ? { lat: fix.lat, lng: fix.lng } : {}),
    }
    this.state.log.push(event)
    // Oldest-first trim. Losing ancient history beats refusing to record
    // anything new because storage filled up.
    if (this.state.log.length > MAX_LOG) this.state.log.splice(0, this.state.log.length - MAX_LOG)
    this.emit({ pendingEvents: this.state.log.length })
    await this.persist()

    // A zone exit or the filter being switched off is the reason a parent
    // installed this. Waiting up to a minute to mention it is a minute they
    // did not know, so these jump the queue.
    if (isUrgent([event])) void this.pushCloud(true)
  }

  private lastRecorded = new Map<string, number>()

  /** Records at most once per window — stops battery-low spamming the log. */
  private async recordOnce(kind: ChildEventKind, ref: string, windowMs: number) {
    const key = `${kind}:${ref}`
    const last = this.lastRecorded.get(key) ?? 0
    if (Date.now() - last < windowMs) return
    this.lastRecorded.set(key, Date.now())
    await this.record(kind, ref)
  }

  private async persist() {
    await saveJSON(KEYS.childState, this.state)
  }

  /* ---------------------------------------------------------------- link */

  /**
   * Re-announces this phone to the parent.
   *
   * Called after enrolment completes. The agent is normally already running and
   * connected by then, and hello is otherwise only sent on a fresh connection —
   * so without this the parent would not learn the cloud identity until the next
   * time the link dropped and came back, and would go on treating an enrolled
   * child as an unknown one for however long that took.
   */
  async announce() {
    if (this.transport.status().state === 'connected') await this.sayHello()
  }

  private async sayHello() {
    this.helloSent = true
    // Read fresh rather than caching at start(): a phone is very often enrolled
    // *after* the agent is already running.
    const enrolment = await loadJSON<{ childId?: string } | null>(KEYS.enrolment, null)
    await this.transport.send({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      deviceId: this.identity.deviceId,
      name: this.identity.name,
      headSeq: this.state.headSeq,
      policyVersion: this.state.policy?.version ?? 0,
      ...(enrolment?.childId ? { cloudChildId: enrolment.childId } : {}),
    })
  }

  /** Sends current telemetry and any unacked events, when a parent is listening. */
  /**
   * Sends to the cloud, on its own cadence.
   *
   * Deliberately separate from the Bluetooth push and never gated on it: the
   * whole point is to reach a parent who is nowhere near this phone. Failure is
   * ignored — being offline is the expected state, and the log is only trimmed
   * once the *parent* acknowledges over Bluetooth, so nothing is lost by an
   * upload that does not land.
   */
  private async pushCloud(force = false) {
    const now = Date.now()
    if (!force && now - this.lastCloudPush < pushInterval(this.snapshot.battery)) return
    this.lastCloudPush = now

    const res = await uplink({
      telemetry: {
        t: 'telemetry',
        ts: now,
        battery: this.snapshot.battery,
        charging: this.snapshot.charging,
        fix: this.snapshot.lastFix,
        activeScenarioId: this.snapshot.activeScenario?.id ?? null,
        locked: this.snapshot.locked,
      },
      events: this.state.log.slice(0, 40),
      // Usage was built, stored and shown over Bluetooth, and never sent here —
      // so the web report had nothing to draw and Screen time read "—" for
      // every family that had not paired a phone that day.
      usage: this.lastUsageReport ?? undefined,
    })

    // A rule changed while this phone was out of Bluetooth range for days.
    //
    // The gate matches the radio path's `>=` rather than being stricter than
    // it. Requiring strictly newer sounds safer and is not: both transports
    // share one version counter, so a policy that reached the radio but never
    // reached the server left the cloud copy at a version this would refuse for
    // ever — and a phone locked over Bluetooth could never be unlocked over the
    // internet, no matter how long it sat there with a signal.
    if (res.ok && res.policy && (res.policyVersion ?? 0) >= (this.state.policy?.version ?? 0)) {
      // Fed through the same handler the radio uses, so the version guard,
      // scenario re-evaluation, persistence and filter restart all happen
      // exactly once, in one place.
      await this.onMessage(res.policy as Policy)
    }

    // A parent tapped Locate while this phone was out of Bluetooth range. The
    // guard matters: `serveLocate` pushes to the cloud itself, so answering a
    // request that is already served would loop.
    if (res.ok && res.locateNow && !this.servingLocate) {
      this.servingLocate = true
      try {
        await this.serveLocate()
      } finally {
        this.servingLocate = false
      }
    }
  }

  /** One on-demand fix at a time; a second request rides the first answer. */
  private servingLocate = false

  /**
   * Answers "where are you now?".
   *
   * Takes a *fresh* reading rather than reporting the last one. The buffered
   * fixes the agent normally works from can be minutes old, which is fine for a
   * trickle and useless for the one moment a parent is standing there watching
   * a spinner — that is the whole difference between this and telemetry.
   *
   * Goes out over both links. Whichever the parent is listening on is the one
   * that matters, and the device has no way to know which that is.
   *
   * A phone that cannot get a fix answers with what it has, including nothing.
   * Staying silent would leave the parent's screen waiting indefinitely on a
   * position that is never coming; an honest "no fix" is a shorter wait.
   */
  private async serveLocate() {
    const fix = await this.currentFix()
    if (fix) this.emit({ lastFix: fix })

    // The radio first: it is the one that works with no signal at all, and if
    // the parent is close enough to be on it the answer is instant.
    await this.push()

    await uplink({
      telemetry: {
        t: 'telemetry',
        ts: Date.now(),
        battery: this.snapshot.battery,
        charging: this.snapshot.charging,
        fix: fix ?? this.snapshot.lastFix,
        activeScenarioId: this.snapshot.activeScenario?.id ?? null,
        locked: this.snapshot.locked,
      },
      ...(fix ? { locateFix: { lat: fix.lat, lng: fix.lng, acc: fix.acc, ts: fix.ts } } : {}),
    })
    this.lastCloudPush = Date.now()
  }

  /**
   * One reading, now.
   *
   * Asks the platform directly rather than draining the agent's buffer — the
   * buffer is what a background service happened to collect, and the point here
   * is to go and look. High accuracy, and a hard timeout: a parent waiting is
   * better served by a slightly coarse fix than by a GPS lock that never comes
   * indoors.
   */
  private async currentFix(): Promise<Fix | null> {
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: LOCATE_TIMEOUT_MS,
        // Never a cached reading: "where are you now" answered from a minute
        // ago is the exact failure this whole path exists to fix.
        maximumAge: 0,
      })
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy ?? 0,
        ts: pos.timestamp || Date.now(),
      }
    } catch {
      // Permission refused, location switched off, or nothing in range. Fall
      // back to whatever the buffer last held rather than reporting nothing.
      const buffered = await this.collectFixes()
      return buffered[buffered.length - 1] ?? this.snapshot.lastFix
    }
  }

  private async push() {
    if (this.transport.status().state !== 'connected') return

    await this.transport.send({
      t: 'telemetry',
      ts: Date.now(),
      battery: this.snapshot.battery,
      charging: this.snapshot.charging,
      fix: this.snapshot.lastFix,
      activeScenarioId: this.snapshot.activeScenario?.id ?? null,
      locked: this.snapshot.locked,
    })

    if (this.state.log.length > 0) {
      // Batched, and only trimmed once the parent acks — a dropped write
      // costs a retry, not a hole in the history.
      await this.transport.send({ t: 'events', events: this.state.log.slice(0, 40) })
    }
  }

  private async onMessage(msg: Message) {
    if (msg.t === 'policy') {
      const incoming = msg
      const current = this.state.policy?.version ?? -1

      if (incoming.version >= current) {
        this.state.policy = incoming
        this.evaluateScenarios(new Date())
        this.emit({ policyVersion: incoming.version })
        await this.persist()
        // New rules take effect immediately, not on the next tick.
        await this.applyFilter()
        return
      }

      // An older policy is ignored, including one that would unlock. That is
      // deliberate and tested: a stale resend must not be a way out of a lock,
      // or the lock is defeatable by anyone who can cause a replay. The route
      // out of a stuck lock is the parent publishing a *newer* policy, which
      // both transports now carry — see the `>=` gate in `pushCloud` and the
      // republish-on-ready in CloudBridge.
      return
    }

    if (msg.t === 'locate') {
      await this.serveLocate()
      return
    }

    if (msg.t === 'ack') {
      const before = this.state.log.length
      this.state.log = this.state.log.filter((e) => e.seq > msg.upTo)
      this.state.lastSyncAt = Date.now()
      if (before !== this.state.log.length) await this.persist()
      this.emit({ pendingEvents: this.state.log.length, lastSyncAt: this.state.lastSyncAt })

      // The parent tells us which policy it believes we have; if it is ahead,
      // ask for a resend by announcing ourselves again.
      if (msg.policyVersion > (this.state.policy?.version ?? 0)) await this.sayHello()
    }
  }
}

/** YYYY-MM-DD in the device's own timezone — the day a report covers. */
function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Minutes remaining in the active window, handling windows crossing midnight. */
function minutesUntilEnd(s: PolicyScenario, now: Date): number {
  const min = now.getHours() * 60 + now.getMinutes()
  const remaining = s.toMin > min ? s.toMin - min : 24 * 60 - min + s.toMin
  return Math.max(0, remaining)
}

/* --------------------------------------------------------------- dev only */

const SIM_KEY = 'nestly.dev.fix'

/**
 * Browser-only hook so geofence crossings can be driven deterministically
 * during development. Native never reads this.
 */
export function setSimulatedFix(lat: number, lng: number) {
  globalThis.localStorage?.setItem(SIM_KEY, JSON.stringify({ lat, lng, acc: 8, ts: Date.now() }))
}

export function readSimulatedFix(): Fix | null {
  try {
    const raw = globalThis.localStorage?.getItem(SIM_KEY)
    if (!raw) return null
    const f = JSON.parse(raw) as Fix
    return typeof f.lat === 'number' && typeof f.lng === 'number'
      ? { ...f, ts: Date.now() }
      : null
  } catch {
    return null
  }
}
