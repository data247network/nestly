export type DeviceManagementMode = 'standard' | 'device_owner' | 'managed'
export type DeviceEnrollmentState = 'pending' | 'active' | 'revoked' | 'retired'
export type RequestKind = 'extra_screen_time' | 'app_access' | 'temporary_unlock' | 'routine_exception' | 'custom'
export type RequestStatus = 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled'
export type PolicyExceptionKind = 'emergency_contact' | 'emergency_app' | 'temporary_unlock' | 'approved_app'

export interface DeviceRecord {
  id: string
  householdId: string
  childId?: string | null
  installId: string
  platform: 'android' | 'ios' | 'web' | string
  displayName?: string | null
  enrollmentState: DeviceEnrollmentState
  managementMode: DeviceManagementMode
  lastSeenAt?: string | null
}

export interface PolicyProfile {
  id: string
  householdId: string
  name: string
  description?: string | null
  priority: number
  body: Record<string, unknown>
  active: boolean
  version: number
}

export interface PolicyException {
  kind: PolicyExceptionKind
  value: Record<string, unknown>
  priority: number
  active: boolean
  startsAt?: string | null
  endsAt?: string | null
}

export interface Routine {
  id: string
  householdId: string
  childId?: string | null
  name: string
  timezone: string
  schedule: Record<string, unknown>
  policyProfileId?: string | null
  action: Record<string, unknown>
  active: boolean
}

export interface SafeZone {
  id: string
  householdId: string
  name: string
  latitude: number
  longitude: number
  radiusM: number
  active: boolean
  childIds: string[]
}

export interface ChildRequest {
  id: string
  householdId: string
  childId: string
  deviceId?: string | null
  kind: RequestKind
  payload: Record<string, unknown>
  status: RequestStatus
  requestedAt: string
}

export interface RewardPayload {
  screenTimeMinutes?: number
  points?: number
  message?: string
}

export interface CommandDelivery {
  commandId: string
  deviceId?: string | null
  channel: 'realtime' | 'push' | 'poll' | 'bluetooth'
  status: 'queued' | 'delivered' | 'acknowledged' | 'failed'
}
