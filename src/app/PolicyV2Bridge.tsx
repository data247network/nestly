import { useEffect, useRef } from 'react'
import { hasCloud, supabase } from '../cloud/client'
import { useDevice } from '../platform/device'
import { useStore } from './store'
import { resolvePolicy } from '../domain/policyEngine'

/**
 * Applies the v2 precedence model without replacing the existing device policy
 * transport. The current PolicyBridge remains responsible for actual delivery.
 */
export function PolicyV2Bridge() {
  const { role } = useDevice()
  const { state, dispatch } = useStore()
  const lastFingerprint = useRef('')

  useEffect(() => {
    if (role !== 'parent' || !hasCloud()) return
    const childId = state.activeChildId
    if (!childId) return
    let cancelled = false

    const load = async () => {
      const db = supabase()
      const { data: assignments } = await db.from('policy_assignments').select('policy_profiles(body, priority)').eq('child_id', childId).eq('active', true)
      const { data: exceptions } = await db.from('policy_exceptions').select('kind, value, priority').eq('child_id', childId).eq('active', true)
      if (cancelled) return
      const profiles = (assignments ?? []) as Array<{ policy_profiles?: { body?: Record<string, unknown>; priority?: number } | null }>
      const assignment = profiles.sort((a, b) => (b.policy_profiles?.priority ?? 0) - (a.policy_profiles?.priority ?? 0))[0]?.policy_profiles?.body
      const emergency: Record<string, unknown> = {}
      const temporary: Record<string, unknown> = {}
      for (const item of (exceptions ?? []) as Array<{ kind: string; value: Record<string, unknown>; priority: number }>) {
        if (item.kind === 'emergency_contact' || item.kind === 'emergency_app') Object.assign(emergency, item.value)
        else Object.assign(temporary, item.value)
      }
      const resolved = resolvePolicy({ assignment, temporaryExceptions: temporary, emergencyExceptions: emergency })
      const fingerprint = JSON.stringify(resolved)
      if (fingerprint === lastFingerprint.current) return
      lastFingerprint.current = fingerprint
      // Store resolved v2 policy as a versioned change for the existing bridge.
      dispatch({ type: 'v2PolicyResolved', childId, policy: resolved } as never)
    }

    void load().catch(() => {})
    return () => { cancelled = true }
  }, [role, state.activeChildId, state.policyVersion, dispatch])

  return null
}
