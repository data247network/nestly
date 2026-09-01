import { useEffect, useRef } from 'react'
import { hasCloud, supabase } from '../cloud/client'
import { useDevice } from '../platform/device'
import { useStore } from './store'
import { resolvePolicy } from '../domain/policyEngine'

/**
 * Resolves Architecture v2 cloud policy layers and projects supported controls
 * onto the existing store so PolicyBridge keeps one proven delivery path.
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
      const { data: assignments, error: assignmentError } = await db
        .from('policy_assignments')
        .select('policy_profiles(body, priority)')
        .eq('child_id', childId)
        .eq('active', true)
      if (assignmentError) throw assignmentError
      const { data: exceptions, error: exceptionError } = await db
        .from('policy_exceptions')
        .select('kind, value, priority')
        .eq('child_id', childId)
        .eq('active', true)
      if (exceptionError) throw exceptionError
      if (cancelled) return

      const profiles = (assignments ?? []) as Array<{ policy_profiles?: { body?: Record<string, unknown>; priority?: number } | null }>
      const assignment = profiles.sort((a, b) => (b.policy_profiles?.priority ?? 0) - (a.policy_profiles?.priority ?? 0))[0]?.policy_profiles?.body
      const emergency: Record<string, unknown> = {}
      const temporary: Record<string, unknown> = {}
      for (const item of (exceptions ?? []) as Array<{ kind: string; value: Record<string, unknown> }>) {
        if (item.kind === 'emergency_contact' || item.kind === 'emergency_app') Object.assign(emergency, item.value)
        else Object.assign(temporary, item.value)
      }

      const resolved = resolvePolicy({ assignment, temporaryExceptions: temporary, emergencyExceptions: emergency })
      const fingerprint = JSON.stringify(resolved)
      if (fingerprint === lastFingerprint.current) return
      lastFingerprint.current = fingerprint

      // Supported v2 controls are deliberately translated into existing typed
      // actions. This removes the previous unimplemented v2PolicyResolved cast.
      const locked = typeof resolved.locked === 'boolean' ? resolved.locked : false
      dispatch({ type: 'setLockNow', value: locked })

      const appRestrictions = resolved.appRestrictions
      if (appRestrictions && typeof appRestrictions === 'object' && !Array.isArray(appRestrictions)) {
        const restrict = (appRestrictions as Record<string, unknown>).restrict
        if (Array.isArray(restrict)) {
          const values = new Set(restrict.filter((x): x is string => typeof x === 'string'))
          dispatch({ type: 'setScenarioBlock', id: 'school', key: 'games', value: values.has('games') })
          dispatch({ type: 'setScenarioBlock', id: 'school', key: 'social', value: values.has('social') })
          dispatch({ type: 'setScenarioBlock', id: 'school', key: 'messaging', value: values.has('messaging') })
        }
      }
    }

    void load().catch(() => {})
    return () => { cancelled = true }
  }, [role, state.activeChildId, state.policyVersion, dispatch])

  return null
}
