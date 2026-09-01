export type PolicyInput = {
  emergencyExceptions?: Record<string, unknown>
  temporaryExceptions?: Record<string, unknown>
  routine?: Record<string, unknown>
  assignment?: Record<string, unknown>
  defaultPolicy?: Record<string, unknown>
}

export type ResolvedPolicy = Record<string, unknown>

/** Highest-priority policy values override lower-priority values while preserving
 * explicit emergency capabilities such as approved contacts/apps. */
export function resolvePolicy(input: PolicyInput): ResolvedPolicy {
  return merge(
    input.defaultPolicy,
    input.assignment,
    input.routine,
    input.temporaryExceptions,
    input.emergencyExceptions,
  )
}

function merge(...layers: Array<Record<string, unknown> | undefined>): ResolvedPolicy {
  const output: ResolvedPolicy = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [key, value] of Object.entries(layer)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
        output[key] = merge(output[key] as Record<string, unknown>, value as Record<string, unknown>)
      } else output[key] = value
    }
  }
  return output
}

export function schoolModePolicy(input: {
  allowedContacts?: string[]
  allowedApps?: string[]
  restrictedApps?: string[]
}): ResolvedPolicy {
  return {
    mode: 'school',
    locked: false,
    appRestrictions: {
      allow: input.allowedApps ?? [],
      restrict: input.restrictedApps ?? [],
    },
    emergency: {
      contacts: input.allowedContacts ?? [],
      allowEmergencyCalling: true,
    },
  }
}
