import { describe, expect, it } from 'vitest'
import { resolvePolicy, schoolModePolicy } from './policyEngine'

describe('policy precedence', () => {
  it('lets emergency exceptions override lower layers', () => {
    const policy = resolvePolicy({
      defaultPolicy: { locked: false, calls: { emergency: true } },
      assignment: { locked: true },
      routine: { mode: 'school' },
      emergencyExceptions: { locked: false, calls: { emergency: true, parents: ['mum', 'dad'] } },
    })
    expect(policy.locked).toBe(false)
    expect(policy.calls).toEqual({ emergency: true, parents: ['mum', 'dad'] })
  })

  it('builds school mode with emergency calling preserved', () => {
    const policy = schoolModePolicy({ allowedContacts: ['mum', 'dad'], restrictedApps: ['games'] })
    expect(policy.mode).toBe('school')
    expect(policy.emergency).toEqual({ contacts: ['mum', 'dad'], allowEmergencyCalling: true })
  })
})
