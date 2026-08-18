import { Network } from '@capacitor/network'
import { KEYS, loadJSON, saveJSON } from '../platform/storage'
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

/**
 * Where the child device posts.
 *
 * Exported because notes use the same door — a child has one credential and one
 * route to the server, and giving notes their own endpoint would mean a second
 * copy of the device-secret check to keep in step with this one.
 */
export const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/child-sync`

/**
 * Publishes the endpoint for the native uploader.
 *
 * The service that keeps uploading while the app is closed is written in Java
 * and cannot see a build-time constant, so the address is handed over through
 * storage. Written on every agent start rather than once, so a rebuild pointing
 * at a different project corrects itself instead of stranding the phone on an
 * address nobody serves any more.
 */
export async function publishEndpoint(): Promise<void> {
  await saveJSON(KEYS.cloudEndpoint, ENDPOINT)
}

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
  // Someone switching protection off is the single most important thing a
  // parent can be told, and the only signal that survives the app being
  // uninstalled a moment later.
  'tamper',
])

export function isUrgent(events: ChildEvent[]): boolean {
  return events.some((e) => URGENT.has(e.kind))
}

type Enrolment = { childId?: string; deviceSecret?: string }

export type UplinkPayload = {
  telemetry?: Telemetry
  events?: ChildEvent[]
  usage?: UsageReport
  /**
   * A fix taken because the parent asked for one, rather than on the timer.
   *
   * Carried separately from `telemetry` so the server can record it against the
   * request that prompted it. Telemetry is last-write-wins, so the very fix a
   * parent is waiting on can be overwritten by the routine push a second later.
   */
  locateFix?: { lat: number; lng: number; acc: number; ts: number }
}

export type UplinkResult = {
  ok: boolean
  /** Machine-readable reason for an upload that did not reach the cloud. */
  error?: string
  /** HTTP status when the server answered. Omitted for local/network failures. */
  status?: number
  /** Server acknowledgement of the accepted records. */
  accepted?: Record<string, unknown>
  /** Highest event sequence durably stored by the cloud for this request. */
  eventsUpTo?: number
  /** The policy the parent last published, if the server had a newer one. */
  policy?: unknown
  policyVersion?: number
  /** A parent is waiting on a fresh position. Answer it now, not on the timer. */
  locateNow?: boolean
}

export type CloudSyncStatus = {
  lastAttempt: number
  lastSuccess?: number
  lastFailure?: number
  status?: number
  error?: string
  accepted?: Record<string, unknown>
}

async function recordSync(result: UplinkResult): Promise<void> {
  const previous = await loadJSON<CloudSyncStatus | null>(KEYS.cloudSyncStatus, null)
  const now = Date.now()
  await saveJSON(KEYS.cloudSyncStatus, {
    lastAttempt: now,
    ...(result.ok
      ? { lastSuccess: now, status: result.status, accepted: result.accepted }
      : {
          lastSuccess: previous?.lastSuccess,
          lastFailure: now,
          status: result.status,
          error: result.error ?? 'upload_failed',
        }),
  })
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
  if (!enrolment?.childId || !enrolment.deviceSecret) {
    const result = { ok: false, error: 'not_enrolled' }
    await recordSync(result)
    return result
  }

  if (!import.meta.env.VITE_SUPABASE_URL) {
    const result = { ok: false, error: 'cloud_not_configured' }
    await recordSync(result)
    return result
  }

  // Checked rather than attempted: a fetch on a dead network can hang for the
  // full timeout, and the agent's tick would block behind it.
  try {
    const status = await Network.getStatus()
    if (!status.connected) {
      const result = { ok: false, error: 'offline' }
      await recordSync(result)
      return result
    }
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
        locateFix: payload.locateFix,
      }),
    })

    const body = (await res.json().catch(() => ({}))) as UplinkResult
    if (!res.ok || body.ok === false) {
      const result = {
        ok: false,
        status: res.status,
        error: body.error ?? `http_${res.status}`,
      }
      await recordSync(result)
      return result
    }
    const result = {
      ok: true,
      status: res.status,
      accepted: body.accepted,
      eventsUpTo: body.eventsUpTo,
      policy: body.policy,
      policyVersion: body.policyVersion,
      locateNow: body.locateNow ?? false,
    }
    await recordSync(result)
    return result
  } catch (error) {
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : 'network_request_failed',
    }
    await recordSync(result)
    return result
  }
}

/** How long to wait before the next routine push, given the battery. */
export function pushInterval(battery: number | null): number {
  return battery != null && battery <= LOW_BATTERY_PERCENT
    ? LOW_BATTERY_INTERVAL_MS
    : TELEMETRY_INTERVAL_MS
}
