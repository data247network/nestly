import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react'
import {
  MAX_EMERGENCY_CONTACTS,
  MAX_REMINDERS,
  formatClock,
  parseClock,
  type AppUsageEntry,
  type BlockCategory,
  type EmergencyContact,
  type Policy,
  type Reminder,
  type SiteVisit,
} from '../link/protocol'
import { KEYS, loadJSON, saveJSON } from '../platform/storage'
import type { PlanId } from './plans'
import type {
  ActivityEntry,
  Alert,
  AppUsage,
  Child,
  Filters,
  Geofence,
  Message,
  ScreenId,
  Scenario,
} from './types'

/**
 * Single in-memory store for the whole product. The screens read from it and
 * dispatch against it, so toggling a scenario or saving a geofence actually
 * changes what every other screen shows — this is a working app, not a
 * click-through of static mockups.
 *
 * Persistence is deliberately out of scope here: swapping `useReducer` for a
 * Capacitor Preferences-backed reducer is the single change needed to make the
 * state survive a restart. See README "Where the real backend plugs in".
 */

export type State = {
  screen: ScreenId
  history: ScreenId[]
  billing: 'monthly' | 'annual'
  /** Which child the parent-app detail screens are currently scoped to. */
  activeChildId: string
  children: Child[]
  geofences: Geofence[]
  scenarios: Scenario[]
  alerts: Alert[]
  messages: Message[]
  usage: AppUsage[]
  filters: Filters
  /** Draft state for the "New geofence" screen. */
  draftFence: {
    name: string
    radiusM: number
    notifyArrive: boolean
    notifyLeave: boolean
    lat: number | null
    lng: number | null
    /** Children this zone will cover. Empty = all of them. */
    childIds: string[]
  }
  editingScenarioId: string
  blockedAttempts: { site: string; when: string }[]
  /**
   * The full event trail from the child device, newest first. Distinct from
   * `alerts`: this keeps everything, including the routine transitions that are
   * useful as history but would be noise as notifications.
   */
  activity: ActivityEntry[]
  /**
   * Bumped on every change the child device needs to know about. The child
   * only adopts a policy whose version is at least its own, which is what
   * stops a stale re-send from undoing a newer rule.
   */
  policyVersion: number
  /** Parent-initiated lock, independent of any scheduled scenario. */
  lockNow: boolean
  /** Numbers the child can call even while the phone is locked. Max 4. */
  emergencyContacts: EmergencyContact[]
  /** Scheduled nudges shown on the child's phone. Part of the policy. */
  reminders: Reminder[]
  /**
   * Subscription tier. Governs how many child devices may be paired — see
   * `plans.ts`. Held here rather than on the device record because it is a
   * property of the household, not of any one phone.
   */
  plan: PlanId
  /**
   * Latest usage + browsing snapshot per child, keyed by child id. Replaced
   * wholesale on each report rather than merged: the child sends the day so
   * far, so the newest message is always the complete picture.
   */
  usageByChild: Record<
    string,
    | {
        apps: AppUsageEntry[]
        sites: SiteVisit[]
        day: string
        /** False when the child revoked Usage Access — the UI must say so. */
        usageAccess: boolean
        filterOn: boolean
      }
    | undefined
  >
  /** Which child the per-child settings screen is editing. */
  editingChildId: string
  reportRange: '7d' | '30d' | 'all'
}

export const INITIAL: State = {
  // The live app enters at Home; the flash cards are gated by the device's
  // onboarding flag, not by this. The showcase overrides it freely.
  screen: 'home',
  history: [],
  billing: 'monthly',
  activeChildId: '',
  // Populated from the paired device's own telemetry. No sample family: an
  // empty state that says "pair a phone" is more use than fictional children
  // that can never do anything.
  children: [],
  // Empty by design: a geofence is only meaningful at a real place, so the
  // parent creates the first one at their own location rather than inheriting
  // a sample zone in the wrong country.
  geofences: [],
  // Two starting points, both fully editable and deletable. Unlike the sample
  // children these are not fiction — they are the routines nearly every
  // household wants, and having them pre-filled saves a parent starting at a
  // blank screen.
  scenarios: [
    {
      id: 'school',
      name: 'School Hours',
      days: [0, 1, 2, 3, 4],
      fromMin: 8 * 60,
      toMin: 15 * 60,
      enabled: true,
      blocks: { games: true, social: true, messaging: false },
    },
    {
      id: 'bedtime',
      name: 'Bedtime',
      days: [0, 1, 2, 3, 4, 5, 6],
      fromMin: 21 * 60,
      toMin: 7 * 60,
      enabled: false,
      blocks: { games: true, social: true, messaging: false },
    },
  ],
  // Alerts are produced from real child events arriving over the link.
  alerts: [],
  messages: [],
  // App-usage reporting needs Android UsageStats access, which is not wired
  // yet — see README. Left empty rather than shown as invented numbers.
  usage: [],
  filters: {
    adult: true,
    violence: true,
    gambling: true,
    social: false,
    custom: [],
    // Nothing warn-only by default: a parent opting into a softer setting is a
    // deliberate choice, not something to inherit.
    warn: [],
  },
  draftFence: {
    name: '',
    radiusM: 200,
    notifyArrive: true,
    notifyLeave: true,
    lat: null,
    lng: null,
    childIds: [],
  },
  editingScenarioId: 'school',
  blockedAttempts: [],
  activity: [],
  policyVersion: 1,
  lockNow: false,
  emergencyContacts: [],
  reminders: [],
  plan: 'free',
  usageByChild: {},
  editingChildId: '',
  reportRange: '7d',
}

type Action =
  | { type: 'go'; to: ScreenId }
  | { type: 'back' }
  | { type: 'billing'; value: 'monthly' | 'annual' }
  | { type: 'activeChild'; id: string }
  | { type: 'toggleScenario'; id: string }
  | { type: 'editScenario'; id: string }
  | { type: 'setScenarioBlock'; id: string; key: 'games' | 'social' | 'messaging'; value: boolean }
  | { type: 'toggleScenarioDay'; id: string; day: number }
  | { type: 'addScenario' }
  | { type: 'patchScenario'; id: string; patch: Partial<Pick<Scenario, 'name' | 'fromMin' | 'toMin'>> }
  | { type: 'deleteScenario'; id: string }
  | { type: 'setFilter'; key: BlockCategory; value: boolean }
  | { type: 'setWarnOnly'; key: BlockCategory; value: boolean }
  | { type: 'addBlockedDomain'; domain: string }
  | { type: 'removeBlockedDomain'; domain: string }
  | { type: 'draftFence'; patch: Partial<State['draftFence']> }
  | { type: 'saveFence' }
  | { type: 'toggleFence'; id: string; key: 'notifyArrive' | 'notifyLeave' }
  /** Add or remove a child from an existing zone. */
  | { type: 'toggleFenceChild'; id: string; childId: string }
  /** Add or remove a child from the zone being created. */
  | { type: 'toggleDraftFenceChild'; childId: string }
  | { type: 'removeFence'; id: string }
  | { type: 'sendMessage'; text: string }
  | { type: 'dismissAlert'; id: string }
  /** Telemetry arrived from the paired child device. */
  | {
      type: 'childSeen'
      child: { deviceId: string; name: string }
      battery: number | null
      locked: boolean
      activeScenarioId: string | null
      hasFix: boolean
    }
  /** Events replayed from one child's log, oldest first. */
  | { type: 'ingestEvents'; childId: string; events: IngestedEvent[] }
  /** The day's usage + browsing snapshot from one child. */
  | {
      type: 'ingestUsage'
      childId: string
      day: string
      apps: AppUsageEntry[]
      sites: SiteVisit[]
      usageAccess: boolean
      filterOn: boolean
    }
  /** Unpaired: drop this child and everything that only made sense with them. */
  | { type: 'forgetChild'; childId: string }
  /**
   * Drops any child that is not in the current pairing list. Self-healing:
   * children are persisted, so a build that changes how they are keyed leaves
   * ghosts behind that no unpair will ever clear.
   */
  | { type: 'reconcileChildren'; validIds: string[] }
  | { type: 'renameChild'; id: string; name: string }
  | { type: 'setChildAvatar'; id: string; color: string }
  | { type: 'editChild'; id: string }
  | { type: 'setPlan'; plan: PlanId }
  | { type: 'setReportRange'; range: '7d' | '30d' | 'all' }
  | { type: 'setLockNow'; value: boolean }
  | { type: 'addContact' }
  | { type: 'patchContact'; id: string; patch: Partial<Pick<EmergencyContact, 'name' | 'phone'>> }
  | { type: 'removeContact'; id: string }
  | { type: 'addReminder' }
  | {
      type: 'patchReminder'
      id: string
      patch: Partial<Pick<Reminder, 'title' | 'note' | 'atMin' | 'enabled'>>
    }
  | { type: 'toggleReminderDay'; id: string; day: number }
  | { type: 'removeReminder'; id: string }
  | { type: 'restore'; state: Partial<State> }

export type IngestedEvent = {
  seq: number
  ts: number
  kind: string
  ref?: string
  cat?: BlockCategory
}

/** "https://www.Example.com/x?y" -> "example.com". Empty when unusable. */
export function normaliseDomain(input: string): string {
  let s = (input || '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^[a-z]+:\/\//, '')
  s = s.split('/')[0].split('?')[0].split('#')[0]
  s = s.split('@').pop() ?? s
  s = s.split(':')[0]
  if (s.startsWith('www.')) s = s.slice(4)
  // Must look like a hostname; a bare word would match nothing useful.
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : ''
}

/** Every action that changes what the child must enforce bumps the version. */
const POLICY_ACTIONS = new Set<Action['type']>([
  'toggleScenario',
  'setScenarioBlock',
  'toggleScenarioDay',
  'setFilter',
  'saveFence',
  'toggleFence',
  'toggleFenceChild',
  'removeFence',
  'setLockNow',
  'addScenario',
  'patchScenario',
  'deleteScenario',
  'addContact',
  'patchContact',
  'removeContact',
  'setWarnOnly',
  'addBlockedDomain',
  'removeBlockedDomain',
  'addReminder',
  'patchReminder',
  'toggleReminderDay',
  'removeReminder',
])

/** Exported for tests. The app uses it only through `StoreProvider`. */
export function reducer(state: State, action: Action): State {
  const next = apply(state, action)
  if (next !== state && POLICY_ACTIONS.has(action.type)) {
    return { ...next, policyVersion: next.policyVersion + 1 }
  }
  return next
}

function apply(state: State, action: Action): State {
  switch (action.type) {
    case 'go':
      if (action.to === state.screen) return state
      return { ...state, screen: action.to, history: [...state.history, state.screen].slice(-24) }
    case 'back': {
      const prev = state.history[state.history.length - 1]
      if (!prev) return state
      return { ...state, screen: prev, history: state.history.slice(0, -1) }
    }
    case 'billing':
      return { ...state, billing: action.value }
    case 'activeChild':
      return { ...state, activeChildId: action.id }
    case 'toggleScenario':
      return {
        ...state,
        scenarios: state.scenarios.map((s) =>
          s.id === action.id ? { ...s, enabled: !s.enabled } : s,
        ),
      }
    case 'editScenario':
      return { ...state, editingScenarioId: action.id }
    case 'setScenarioBlock':
      return {
        ...state,
        scenarios: state.scenarios.map((s) =>
          s.id === action.id ? { ...s, blocks: { ...s.blocks, [action.key]: action.value } } : s,
        ),
      }
    case 'toggleScenarioDay':
      return {
        ...state,
        scenarios: state.scenarios.map((s) =>
          s.id === action.id
            ? {
                ...s,
                days: s.days.includes(action.day)
                  ? s.days.filter((d) => d !== action.day)
                  : [...s.days, action.day].sort(),
              }
            : s,
        ),
      }
    case 'addScenario': {
      const id = `sc-${Date.now()}`
      const scenario: Scenario = {
        id,
        name: 'New routine',
        // Weekdays, late afternoon: the shape of most routines a parent adds,
        // and never accidentally active the moment it is created.
        days: [0, 1, 2, 3, 4],
        fromMin: 16 * 60,
        toMin: 17 * 60,
        enabled: false,
        blocks: { games: true, social: true, messaging: false },
      }
      return {
        ...state,
        scenarios: [...state.scenarios, scenario],
        editingScenarioId: id,
      }
    }

    case 'patchScenario':
      return {
        ...state,
        scenarios: state.scenarios.map((s) =>
          s.id === action.id ? { ...s, ...action.patch } : s,
        ),
      }

    case 'deleteScenario': {
      const scenarios = state.scenarios.filter((s) => s.id !== action.id)
      return {
        ...state,
        scenarios,
        editingScenarioId:
          state.editingScenarioId === action.id
            ? (scenarios[0]?.id ?? '')
            : state.editingScenarioId,
      }
    }

    case 'setFilter':
      return { ...state, filters: { ...state.filters, [action.key]: action.value } }

    case 'setWarnOnly': {
      const warn = new Set(state.filters.warn ?? [])
      if (action.value) warn.add(action.key)
      else warn.delete(action.key)
      return { ...state, filters: { ...state.filters, warn: [...warn] } }
    }

    case 'addBlockedDomain': {
      // Accept a pasted URL as well as a bare domain — a parent copying from
      // their child's history should not have to strip it by hand.
      const domain = normaliseDomain(action.domain)
      if (!domain || state.filters.custom.includes(domain)) return state
      return {
        ...state,
        filters: { ...state.filters, custom: [...state.filters.custom, domain] },
      }
    }

    case 'removeBlockedDomain':
      return {
        ...state,
        filters: {
          ...state.filters,
          custom: state.filters.custom.filter((d) => d !== action.domain),
        },
      }
    case 'draftFence':
      return { ...state, draftFence: { ...state.draftFence, ...action.patch } }
    case 'saveFence': {
      const d = state.draftFence
      // A zone without coordinates cannot be evaluated on the child device, so
      // it is refused rather than saved as something that will never fire.
      if (d.lat == null || d.lng == null) return state
      const id = `fence-${Date.now()}`
      return {
        ...state,
        geofences: [
          ...state.geofences,
          {
            id,
            // Empty means "every child" — the sensible default for a household
            // zone, and it keeps applying when another device is paired later.
            childIds: d.childIds,
            name: d.name.trim() || 'New zone',
            lat: d.lat,
            lng: d.lng,
            radiusM: d.radiusM,
            notifyArrive: d.notifyArrive,
            notifyLeave: d.notifyLeave,
          },
        ],
        draftFence: {
          name: '',
          radiusM: 200,
          notifyArrive: true,
          notifyLeave: true,
          lat: null,
          lng: null,
          childIds: [],
        },
      }
    }
    case 'toggleFence':
      return {
        ...state,
        geofences: state.geofences.map((f) =>
          f.id === action.id ? { ...f, [action.key]: !f[action.key] } : f,
        ),
      }

    case 'toggleFenceChild':
      return {
        ...state,
        geofences: state.geofences.map((f) =>
          f.id === action.id
            ? {
                ...f,
                childIds: f.childIds.includes(action.childId)
                  ? f.childIds.filter((c) => c !== action.childId)
                  : [...f.childIds, action.childId],
              }
            : f,
        ),
      }

    case 'toggleDraftFenceChild':
      return {
        ...state,
        draftFence: {
          ...state.draftFence,
          childIds: state.draftFence.childIds.includes(action.childId)
            ? state.draftFence.childIds.filter((c) => c !== action.childId)
            : [...state.draftFence.childIds, action.childId],
        },
      }

    case 'removeFence':
      return { ...state, geofences: state.geofences.filter((f) => f.id !== action.id) }
    case 'sendMessage': {
      const text = action.text.trim()
      if (!text) return state
      return {
        ...state,
        messages: [...state.messages, { id: `m-${Date.now()}`, from: 'parent', text }],
      }
    }
    case 'dismissAlert':
      return { ...state, alerts: state.alerts.filter((a) => a.id !== action.id) }

    case 'childSeen': {
      const existing = state.children.find((c) => c.id === action.child.deviceId)
      const active = state.scenarios.find((s) => s.id === action.activeScenarioId)
      const child: Child = {
        id: action.child.deviceId,
        name: action.child.name,
        age: existing?.age ?? 0,
        avatar: existing?.avatar ?? '#147D77',
        // A manual "Lock now" has no scenario behind it, so `active` is
        // undefined and the old `locked && active` test fell through to
        // "Location known" — the parent's card read as unlocked while the
        // child's phone was sitting on the lock screen. Lock state wins on its
        // own; the scenario name is only ever a refinement of it.
        status: action.locked
          ? (active ? active.name : 'Locked')
          : action.hasFix
            ? 'Location known'
            : 'No fix yet',
        statusTone: action.locked ? 'violet' : 'teal',
        screenMinutes: existing?.screenMinutes ?? 0,
        battery: action.battery ?? existing?.battery ?? 0,
        trend: existing?.trend ?? [0, 0, 0, 0, 0],
      }
      // Merge, keyed on device id. Stale entries are cleared by `forgetChild`
      // when the parent unpairs, which is the only correct trigger — a child
      // device that is simply out of range must keep its card.
      const others = state.children.filter((c) => c.id !== child.id)
      return {
        ...state,
        children: [...others, child].sort((a, b) => a.name.localeCompare(b.name)),
        activeChildId: state.activeChildId || child.id,
      }
    }

    /** Renames a child locally; the device keeps its own name for the advert. */
    case 'renameChild':
      return {
        ...state,
        children: state.children.map((c) =>
          c.id === action.id ? { ...c, name: action.name.trim() || c.name } : c,
        ),
      }

    case 'setChildAvatar':
      return {
        ...state,
        children: state.children.map((c) =>
          c.id === action.id ? { ...c, avatar: action.color } : c,
        ),
      }

    case 'editChild':
      return { ...state, editingChildId: action.id }

    case 'forgetChild': {
      // Only the unpaired child's data goes. With several children paired,
      // wiping the whole trail because one device was removed would destroy the
      // others' history too.
      const children = state.children.filter((c) => c.id !== action.childId)
      const { [action.childId]: _dropped, ...usageByChild } = state.usageByChild
      return {
        ...state,
        children,
        activeChildId:
          state.activeChildId === action.childId ? (children[0]?.id ?? '') : state.activeChildId,
        activity: state.activity.filter((a) => a.childId !== action.childId),
        alerts: state.alerts.filter((a) => a.childId !== action.childId),
        // A zone shared with other children survives with that child removed
        // from it. One that named only the removed child goes with them. A
        // zone scoped to everyone (empty list) is untouched.
        geofences: state.geofences
          .filter((g) => !(g.childIds.length === 1 && g.childIds[0] === action.childId))
          .map((g) =>
            g.childIds.includes(action.childId)
              ? { ...g, childIds: g.childIds.filter((id) => id !== action.childId) }
              : g,
          ),
        usageByChild,
      }
    }

    case 'reconcileChildren': {
      const valid = new Set(action.validIds)
      const children = state.children.filter((c) => valid.has(c.id))
      const dropped = state.children.filter((c) => !valid.has(c.id)).map((c) => c.id)
      const usageByChild = { ...state.usageByChild }
      for (const id of dropped) delete usageByChild[id]

      // Zones can carry child ids from a build that keyed children differently.
      // Those match nobody, so `buildPolicy` filters the zone out of every
      // child's policy and it silently stops firing — while the UI still reads
      // "Everyone", because an unresolvable id has no name to show. Prune the
      // dead ids; a zone left naming nobody reverts to covering everyone, which
      // is what a household zone meant before it was ever scoped.
      const prunedFences = state.geofences.map((g) => {
        if (g.childIds.length === 0) return g
        const live = g.childIds.filter((id) => valid.has(id))
        return live.length === g.childIds.length ? g : { ...g, childIds: live }
      })
      // `.map` always allocates, so compare element identity to decide whether
      // anything actually changed — otherwise this dispatches on every load.
      const fencesChanged = prunedFences.some((g, i) => g !== state.geofences[i])
      const geofences = fencesChanged ? prunedFences : state.geofences

      // Identity check, not a length check. This runs on every load, and the
      // common case now is that the children are already right but a zone still
      // carries a dead id — bailing on child count alone would skip that.
      if (children.length === state.children.length && geofences === state.geofences) {
        return state
      }

      return {
        ...state,
        children,
        activeChildId: valid.has(state.activeChildId)
          ? state.activeChildId
          : (children[0]?.id ?? ''),
        activity: state.activity.filter((a) => valid.has(a.childId)),
        alerts: state.alerts.filter((a) => valid.has(a.childId)),
        geofences,
        usageByChild,
      }
    }

    case 'ingestEvents': {
      const who = state.children.find((c) => c.id === action.childId)?.name ?? 'Your child'

      // Two destinations, deliberately different. The alerts feed is a place to
      // notice things and stays short; the activity trail is the full record,
      // including the routine starts and stops that would drown the feed.
      const alerts = action.events
        .map((e) => toAlert(e, who, action.childId))
        .filter((a): a is Alert => a !== null)

      // Sequence numbers are per-child, so de-duplication has to be scoped to
      // the child. Keyed globally, a second device starting at seq 1 would have
      // its entire history silently discarded as "already seen".
      const known = new Set(
        state.activity.filter((a) => a.childId === action.childId).map((a) => a.seq),
      )
      const fresh = action.events
        .filter((e) => !known.has(e.seq))
        .map((e) => ({ ...e, childId: action.childId }))
      if (alerts.length === 0 && fresh.length === 0) return state

      return {
        ...state,
        alerts: [...alerts.reverse(), ...state.alerts].slice(0, 200),
        activity: [...fresh.reverse(), ...state.activity].slice(0, 2000),
      }
    }

    case 'ingestUsage':
      return {
        ...state,
        usageByChild: {
          ...state.usageByChild,
          [action.childId]: {
            apps: action.apps,
            sites: action.sites,
            day: action.day,
            usageAccess: action.usageAccess,
            filterOn: action.filterOn,
          },
        },
      }

    case 'setPlan':
      if (state.plan === action.plan) return state
      return { ...state, plan: action.plan }

    case 'setReportRange':
      return { ...state, reportRange: action.range }

    case 'setLockNow':
      if (state.lockNow === action.value) return state
      return { ...state, lockNow: action.value }

    case 'addContact': {
      if (state.emergencyContacts.length >= MAX_EMERGENCY_CONTACTS) return state
      return {
        ...state,
        emergencyContacts: [
          ...state.emergencyContacts,
          { id: `ec-${Date.now()}`, name: '', phone: '' },
        ],
      }
    }

    case 'patchContact':
      return {
        ...state,
        emergencyContacts: state.emergencyContacts.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c,
        ),
      }

    case 'removeContact':
      return {
        ...state,
        emergencyContacts: state.emergencyContacts.filter((c) => c.id !== action.id),
      }

    case 'addReminder': {
      if (state.reminders.length >= MAX_REMINDERS) return state
      return {
        ...state,
        reminders: [
          ...state.reminders,
          {
            id: `rm-${Date.now()}`,
            title: '',
            note: '',
            // 4pm: after school and before the evening, which is when most
            // "did you…" reminders actually belong.
            atMin: 16 * 60,
            days: [],
            enabled: true,
          },
        ],
      }
    }

    case 'patchReminder':
      return {
        ...state,
        reminders: state.reminders.map((r) =>
          r.id === action.id ? { ...r, ...action.patch } : r,
        ),
      }

    case 'toggleReminderDay':
      return {
        ...state,
        reminders: state.reminders.map((r) =>
          r.id === action.id
            ? {
                ...r,
                days: r.days.includes(action.day)
                  ? r.days.filter((d) => d !== action.day)
                  : [...r.days, action.day].sort((a, b) => a - b),
              }
            : r,
        ),
      }

    case 'removeReminder':
      return { ...state, reminders: state.reminders.filter((r) => r.id !== action.id) }

    case 'restore':
      return migrate({ ...state, ...action.state })
  }
}

/**
 * Repairs state loaded from an older build.
 *
 * Scenarios once stored their times as display strings (`from: '9:00 AM'`).
 * They are numbers now, and a restored old record left `fromMin` undefined —
 * which surfaced as routines reading "NaN:NaN AM – NaN:NaN AM" on the Limits
 * tab, with a schedule the child device could never evaluate.
 *
 * Applied on restore rather than as a one-off script so it also covers a device
 * that skipped several versions.
 */
function migrate(state: State): State {
  type LegacyScenario = Scenario & { from?: string; to?: string }
  type LegacyFence = Geofence & { childId?: string }

  // Zones used to name exactly one child. Carry that across rather than
  // silently widening them to the whole household.
  let geofences = state.geofences
  if (geofences.some((g) => !Array.isArray(g.childIds))) {
    geofences = geofences.map((g) => {
      if (Array.isArray(g.childIds)) return g
      const legacy = (g as LegacyFence).childId
      return { ...g, childIds: legacy ? [legacy] : [] }
    })
  }

  const scenarios = state.scenarios.map((s) => {
    const legacy = s as LegacyScenario
    const fromMin = Number.isFinite(s.fromMin)
      ? s.fromMin
      : legacy.from
        ? parseClock(legacy.from)
        : 8 * 60
    const toMin = Number.isFinite(s.toMin)
      ? s.toMin
      : legacy.to
        ? parseClock(legacy.to)
        : 15 * 60
    if (fromMin === s.fromMin && toMin === s.toMin) return s
    return { ...s, fromMin, toMin }
  })

  const changed =
    scenarios.some((s, i) => s !== state.scenarios[i]) || geofences !== state.geofences
  return changed ? { ...state, scenarios, geofences } : state
}

/**
 * Turns a child-device event into a parent-facing alert.
 *
 * Returns null for events the parent does not need to see — the agent starting,
 * a scenario beginning on schedule. Surfacing those would bury the ones that
 * matter, which is exactly the "alerts without triage" failure the product is
 * meant to avoid.
 */
function toAlert(e: IngestedEvent, who: string, childId: string): Alert | null {
  const time = new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  // Alert ids include the child: two devices both emitting seq 3 would
  // otherwise collide and React would drop one of the rows.
  const base = { id: `ev-${childId}-${e.seq}`, who, time, ts: e.ts, childId }

  switch (e.kind) {
    case 'zone-enter':
      return { ...base, kind: 'location', title: `Arrived at ${e.ref ?? 'a zone'}`, tone: 'teal' }
    case 'zone-leave':
      return { ...base, kind: 'location', title: `Left ${e.ref ?? 'a zone'}`, tone: 'coral' }
    case 'battery-low':
      return { ...base, kind: 'content', title: 'Battery low', tone: 'amber' }
    case 'site-blocked':
      // Adult content is escalated: it is the one category a parent asked to be
      // told about directly rather than finding in a weekly report.
      return {
        ...base,
        kind: 'content',
        title:
          e.cat === 'adult'
            ? `Blocked adult site — ${e.ref ?? 'unknown'}`
            : `Blocked ${e.cat ?? 'a'} site — ${e.ref ?? 'unknown'}`,
        tone: e.cat === 'adult' ? 'coral' : 'violet',
        urgent: e.cat === 'adult',
      }
    case 'filter-off':
      return {
        ...base,
        kind: 'content',
        title: 'Web filtering was turned off on their phone',
        tone: 'coral',
        urgent: true,
      }
    case 'tamper':
      // The one alert that is always urgent. Protection being switched off is
      // usually the step before the app is removed altogether, so this may be
      // the last thing the phone ever manages to send.
      return {
        ...base,
        kind: 'content',
        title: `Protection turned off — ${e.ref ?? 'unknown'}`,
        tone: 'coral',
        urgent: true,
      }
    case 'contact-added':
      // Not marked urgent. New contacts are overwhelmingly ordinary — a
      // classmate, a cousin — and flagging every one as an emergency is how a
      // parent learns to swipe the whole feed away without reading it.
      return {
        ...base,
        kind: 'contact',
        title: `New contact added — ${e.ref ?? 'unnamed'}`,
        tone: 'amber',
      }
    case 'lock-dismissed':
      return {
        ...base,
        kind: 'content',
        title: 'Left the lock screen during a routine',
        tone: 'amber',
      }
    default:
      return null
  }
}

type Store = {
  state: State
  dispatch: React.Dispatch<Action>
  go: (to: ScreenId) => void
  back: () => void
  /** Null until a child device has paired and reported in. */
  activeChild: Child | null
  editingScenario: Scenario
}

const Ctx = createContext<Store | null>(null)

/** Everything worth keeping across a restart. Screen position deliberately isn't. */
const PERSISTED_KEYS = [
  'scenarios',
  'geofences',
  'filters',
  'children',
  'alerts',
  'activeChildId',
  'policyVersion',
  'lockNow',
  'activity',
  'emergencyContacts',
  'reminders',
  'plan',
  'usageByChild',
] as const

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const [hydrated, setHydrated] = useState(false)
  const go = useCallback((to: ScreenId) => dispatch({ type: 'go', to }), [])
  const back = useCallback(() => dispatch({ type: 'back' }), [])

  // Rules and history have to survive a restart: a child device that reboots
  // and comes back with no scenarios has silently stopped doing its job.
  useEffect(() => {
    void (async () => {
      const saved = await loadJSON<Partial<State>>(KEYS.parentState, {})
      if (Object.keys(saved).length > 0) dispatch({ type: 'restore', state: saved })
      setHydrated(true)
    })()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const slice: Partial<State> = {}
    for (const k of PERSISTED_KEYS) (slice as Record<string, unknown>)[k] = state[k]
    void saveJSON(KEYS.parentState, slice)
  }, [hydrated, state])

  const value = useMemo<Store>(() => {
    const activeChild =
      state.children.find((c) => c.id === state.activeChildId) ?? state.children[0] ?? null
    const editingScenario =
      state.scenarios.find((s) => s.id === state.editingScenarioId) ?? state.scenarios[0]
    return { state, dispatch, go, back, activeChild, editingScenario }
  }, [state, go, back])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Projects the parent's rules into the wire format the child enforces.
 *
 * Kept as a pure function so what the child receives is always derivable from
 * what the parent sees — there is no second copy of the rules to drift.
 */
export function buildPolicy(state: State, childId?: string): Policy {
  // Zones are the one part of the policy that differs per child, so each device
  // is sent only the ones that name it. Sending all of them and filtering on
  // the child would leak the other children's places onto their phone.
  const geofences = state.geofences.filter(
    (g) => g.childIds.length === 0 || childId == null || g.childIds.includes(childId),
  )

  return {
    t: 'policy',
    version: state.policyVersion,
    scenarios: state.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      days: s.days,
      fromMin: s.fromMin,
      toMin: s.toMin,
      enabled: s.enabled,
      blocks: s.blocks,
    })),
    geofences: geofences.map((g) => ({
      id: g.id,
      name: g.name,
      lat: g.lat,
      lng: g.lng,
      radiusM: g.radiusM,
      notifyArrive: g.notifyArrive,
      notifyLeave: g.notifyLeave,
    })),
    filters: state.filters,
    lockNow: state.lockNow,
    // Half-filled rows are dropped rather than synced: a lock screen showing a
    // button that dials nothing is worse than showing one fewer contact.
    contacts: state.emergencyContacts
      .filter((c) => c.phone.trim().length > 0)
      .slice(0, MAX_EMERGENCY_CONTACTS)
      .map((c) => ({
        id: c.id,
        name: c.name.trim() || 'Emergency',
        phone: c.phone.trim(),
      })),
    // Untitled reminders are dropped rather than synced — a nudge with no text
    // is just an alarm the child cannot act on.
    reminders: state.reminders
      .filter((r) => r.title.trim().length > 0)
      .slice(0, MAX_REMINDERS)
      .map((r) => ({
        id: r.id,
        title: r.title.trim(),
        ...(r.note?.trim() ? { note: r.note.trim() } : {}),
        atMin: r.atMin,
        days: r.days,
        enabled: r.enabled,
      })),
  }
}

export function useStore(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore must be used inside <StoreProvider>')
  return v
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "Weekdays · 8:00 AM – 3:00 PM" — the one-line summary shown in lists. */
export function describeSchedule(s: Scenario): string {
  const d = [...s.days].sort((a, b) => a - b)
  let days: string
  if (d.length === 7) days = 'Every day'
  else if (d.length === 0) days = 'No days set'
  else if (d.length === 5 && d.every((n) => n < 5)) days = 'Weekdays'
  else if (d.length === 2 && d[0] === 5 && d[1] === 6) days = 'Weekends'
  else days = d.map((n) => DAY_NAMES[n]).join('/')

  const overnight = s.toMin <= s.fromMin ? ' (overnight)' : ''
  return `${days} · ${formatClock(s.fromMin)} – ${formatClock(s.toMin)}${overnight}`
}

/** "1h 40m" from a minute count — used in a dozen places. */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  if (!m) return `${h}h`
  return `${h}h ${m}m`
}
