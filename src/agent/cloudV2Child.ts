import { Network } from '@capacitor/network'
import { KEYS, loadJSON } from '../platform/storage'
import type { RequestKind } from '../domain/v2'
import { ENDPOINT } from './cloudUplink'

/**
 * The child device's side of chores, requests and rewards.
 *
 * `chores`, `child_requests` and `reward_transactions` are all scoped by RLS to
 * `private.is_household_member(household_id)`, which resolves through
 * `auth.uid()`. A child device never signs in — that is a deliberate property
 * of the product — so it never has an `auth.uid()` for that check to pass.
 * Calling these tables directly from the child app, the way the parent side
 * does, fails silently under RLS every time.
 *
 * This goes through `child-sync` instead, the same door notes and locate
 * already use: the device secret is the credential, and the edge function
 * writes with the service role on the child's behalf.
 */

type Enrolment = { childId?: string; deviceSecret?: string }

export type ChildChore = {
  id: string
  title: string
  description: string | null
  dueAt: string | null
  reward: { screenTimeMinutes?: number; points?: number }
  /** 'open' — anyone may claim it. 'submitted' — awaiting a parent's review. */
  status: 'open' | 'submitted'
  /** Whether the pending submission, if any, is this child's own. */
  mine: boolean
}

export type ChildReward = {
  id: string
  source: string
  payload: { screenTimeMinutes?: number; points?: number; message?: string }
  createdAt: string | null
}

type SyncResponse = {
  chores?: ChildChore[]
  rewards?: ChildReward[]
  accepted?: Record<string, unknown>
  error?: string
}

async function post(body: Record<string, unknown>): Promise<SyncResponse | null> {
  const enrolment = await loadJSON<Enrolment | null>(KEYS.enrolment, null)
  if (!enrolment?.childId || !enrolment.deviceSecret) return null

  try {
    const status = await Network.getStatus()
    if (!status.connected) return null
  } catch {
    // Native network plugin unavailable: let fetch decide.
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childId: enrolment.childId,
        deviceSecret: enrolment.deviceSecret,
        ...body,
      }),
    })
    if (!res.ok) return null
    return (await res.json().catch(() => ({}))) as SyncResponse
  } catch {
    return null
  }
}

export async function loadChildChores(): Promise<ChildChore[]> {
  const res = await post({ wantChores: true })
  return res?.chores ?? []
}

/**
 * Marks a chore done. The server claims it atomically, so a chore already
 * taken by a sibling — or already submitted by this same device on a retried
 * request — comes back as `unavailable` rather than double-counting.
 */
export async function completeChore(
  choreId: string,
  note?: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await post({ choreDone: { choreId, note } })
  if (!res) return { ok: false, message: 'Could not reach the family account. Try again.' }
  if (res.accepted?.chore === 'submitted') {
    return { ok: true, message: 'Sent to your parent for review.' }
  }
  if (res.accepted?.chore === 'unavailable') {
    return { ok: false, message: 'That chore is no longer available.' }
  }
  return { ok: false, message: 'Could not send that. Try again.' }
}

export async function submitChildRequest(
  kind: RequestKind,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  const res = await post({ request: { kind, payload } })
  if (!res) return { ok: false, message: 'Could not reach the family account. Try again.' }
  if (res.accepted?.request === 'sent') return { ok: true, message: 'Request sent to your parent.' }
  return { ok: false, message: 'Could not send your request. Try again.' }
}

export async function loadChildRewardsV2(): Promise<ChildReward[]> {
  const res = await post({ wantRewards: true })
  return res?.rewards ?? []
}
