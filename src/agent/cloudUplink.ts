import { Network } from '@capacitor/network'
import { KEYS, loadJSON, saveJSON } from '../platform/storage'
import type { ChildEvent, Telemetry, UsageReport } from '../link/protocol'

/** Primary child -> cloud uplink. Bluetooth is an offline fallback only. */
export const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/child-sync`
export const TELEMETRY_INTERVAL_MS = 60_000
export const LOW_BATTERY_INTERVAL_MS = 5 * 60_000
export const LOW_BATTERY_PERCENT = 15

const URGENT: ReadonlySet<string> = new Set([
  'zone-enter', 'zone-leave', 'battery-low', 'filter-off',
  'contact-added', 'site-blocked', 'tamper',
])

export function isUrgent(events: ChildEvent[]): boolean {
  return events.some((e) => URGENT.has(e.kind))
}

type Enrolment = { childId?: string; deviceSecret?: string }

export type UplinkPayload = {
  telemetry?: Telemetry
  events?: ChildEvent[]
  usage?: UsageReport
  locateFix?: { lat: number; lng: number; acc: number; ts: number }
}

export type UplinkResult = {
  ok: boolean
  error?: string
  status?: number
  accepted?: Record<string, unknown>
  eventsUpTo?: number
  policy?: unknown
  policyVersion?: number
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
  await saveJSON(KEYS.cloudSyncStatus, result.ok
    ? { lastAttempt: now, lastSuccess: now, status: result.status, accepted: result.accepted }
    : {
        lastAttempt: now,
        lastSuccess: previous?.lastSuccess,
        lastFailure: now,
        status: result.status,
        error: result.error ?? 'upload_failed',
      })
}

export async function publishEndpoint(): Promise<void> {
  await saveJSON(KEYS.cloudEndpoint, ENDPOINT)
}

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

  try {
    const status = await Network.getStatus()
    if (!status.connected) {
      const result = { ok: false, error: 'offline' }
      await recordSync(result)
      return result
    }
  } catch {
    // If the native network plugin is unavailable, let fetch determine reachability.
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childId: enrolment.childId,
        deviceSecret: enrolment.deviceSecret,
        telemetry: payload.telemetry ? {
          ts: payload.telemetry.ts,
          battery: payload.telemetry.battery,
          charging: payload.telemetry.charging,
          fix: payload.telemetry.fix,
          activeScenarioId: payload.telemetry.activeScenarioId,
          locked: payload.telemetry.locked,
        } : undefined,
        events: payload.events?.length ? payload.events : undefined,
        usage: payload.usage ? {
          day: payload.usage.day,
          apps: payload.usage.apps,
          sites: payload.usage.sites,
          usageAccess: payload.usage.usageAccess,
          filterOn: payload.usage.filterOn,
        } : undefined,
        locateFix: payload.locateFix,
      }),
    })

    const body = (await res.json().catch(() => ({}))) as UplinkResult
    if (!res.ok || body.ok === false) {
      const result = { ok: false, status: res.status, error: body.error ?? `http_${res.status}` }
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
    const result = { ok: false, error: error instanceof Error ? error.message : 'network_request_failed' }
    await recordSync(result)
    return result
  }
}

export function pushInterval(battery: number | null): number {
  return battery != null && battery <= LOW_BATTERY_PERCENT
    ? LOW_BATTERY_INTERVAL_MS
    : TELEMETRY_INTERVAL_MS
}
