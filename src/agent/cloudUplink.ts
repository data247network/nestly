import { Network } from '@capacitor/network'
import { KEYS, loadJSON } from '../platform/storage'
import type { ChildEvent, Telemetry, UsageReport } from '../link/protocol'

/**
 * The child device's uplink to the cloud.
 *
 * Nestly's cloud used to depend entirely on the parent being within Bluetooth
 * range: a child at school and a parent at work meant nothing reached the
 * server at all. This sends the same payloads the radio does, over the
 * internet, so a parent can see where their child is from anywhere.
 *
 * Bluetooth is untouched and stays the fallback. If this fails — no signal, no
 * data, aeroplane mode — the device carries on enforcing routines and logging
 * locally exactly as before, and catches up later.
 *
 * PACING. Streaming continuously would flatten a child's phone by lunchtime and
 * tell a parent nothing more, so the cadence is chosen around what the
 * information is worth:
 *
 *   - Alerts go immediately. A zone exit or the filter being switched off is
 *     the whole reason a parent installed this, and a minute's delay on one of
 *     those is a minute they did not know.
 *   - Ordinary telemetry batches on a timer.
 *   - Below 15% battery it backs right off. A phone that dies is worse for
 *     safety than a location that is five minutes stale.
 */

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/child-sync`

/** Routine position and battery. Frequent enough to be useful, not constant. */
export const TELEMETRY_INTERVAL_MS = 60_000
/** When the battery is nearly gone, staying alive matters more than freshness. */
export const LOW_BATTERY_INTERVAL_MS = 5 * 60_000
export const LOW_BATTERY_PERCENT = 15

/**
 * Events a parent would want to know about now rather than at the next batch.
 * Everything else rides along with the following telemetry push.
 */
const URGENT: ReadonlySet<string> = new Set([
  'zone-enter',
  'zone-leave',
  'battery-low',
  'filter-off',
  'contact-added',
  'site-blocked',
])

export function isUrgent(events: ChildEvent[]): boolean {
  return events.some((e) => URGENT.has(e.kind))
}

type Enrolment = { childId?: string; deviceSecret?: string }

export type UplinkPayload = {
  telemetry?: Telemetry
  events?: ChildEvent[]
  usage?: UsageReport
}

export type UplinkResult = {
  ok: boolean
  /** The policy the parent last published, if the server had a newer one. */
  policy?: unknown
  policyVersion?: number
}

/**
 * Sends what the device has, if it is enrolled and online.
 *
 * Returns `ok: false` rather than throwing for the ordinary failures — being
 * offline is the expected state for this product, not an exception worth
 * unwinding the agent's tick over.
 */
export async function uplink(payload: UplinkPayload): Promise<UplinkResult> {
  const enrolment = await loadJSON<Enrolment | null>(KEYS.enrolment, null)
  if (!enrolment?.childId || !enrolment.deviceSecret) return { ok: false }

  // Checked rather than attempted: a fetch on a dead network can hang for the
  // full timeout, and the agent's tick would block behind it.
  try {
    const status = await Network.getStatus()
    if (!status.connected) return { ok: false }
  } catch {
    /* Network plugin unavailable off-device; fall through and just try. */
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childId: enrolment.childId,
        deviceSecret: enrolment.deviceSecret,
        telemetry: payload.telemetry
          ? {
              ts: payload.telemetry.ts,
              battery: payload.telemetry.battery,
              charging: payload.telemetry.charging,
              fix: payload.telemetry.fix,
              activeScenarioId: payload.telemetry.activeScenarioId,
              locked: payload.telemetry.locked,
            }
          : undefined,
        events: payload.events?.length ? payload.events : undefined,
        usage: payload.usage
          ? {
              day: payload.usage.day,
              apps: payload.usage.apps,
              sites: payload.usage.sites,
              usageAccess: payload.usage.usageAccess,
              filterOn: payload.usage.filterOn,
            }
          : undefined,
      }),
    })

    if (!res.ok) return { ok: false }
    const body = (await res.json().catch(() => ({}))) as UplinkResult
    return { ok: true, policy: body.policy, policyVersion: body.policyVersion }
  } catch {
    return { ok: false }
  }
}

/** How long to wait before the next routine push, given the battery. */
export function pushInterval(battery: number | null): number {
  return battery != null && battery <= LOW_BATTERY_PERCENT
    ? LOW_BATTERY_INTERVAL_MS
    : TELEMETRY_INTERVAL_MS
}
