import { Capacitor, registerPlugin } from '@capacitor/core'

export type SafetyLockStatus = {
  deviceOwner: boolean
  lockTaskPermitted: boolean
  legacyAdmin: boolean
  canLock: boolean
}

type SafetyLockPlugin = {
  status(): Promise<SafetyLockStatus>
  configure(): Promise<SafetyLockStatus & { configured: boolean }>
  lock(): Promise<SafetyLockStatus & { locked: boolean }>
  unlock(): Promise<{ unlocked: boolean }>
  openDeviceOwnerHelp(): Promise<void>
  openAppDetails(): Promise<void>
}

const SafetyLock = registerPlugin<SafetyLockPlugin>('NestlySafetyLock')

const browserStatus: SafetyLockStatus = {
  deviceOwner: false,
  lockTaskPermitted: false,
  legacyAdmin: false,
  canLock: false,
}

export async function getSafetyLockStatus(): Promise<SafetyLockStatus> {
  if (!Capacitor.isNativePlatform()) return browserStatus
  return SafetyLock.status()
}

export async function configureSafetyLock() {
  if (!Capacitor.isNativePlatform()) return { ...browserStatus, configured: false }
  return SafetyLock.configure()
}

export async function enterSafetyLock() {
  if (!Capacitor.isNativePlatform()) return { ...browserStatus, locked: false }
  return SafetyLock.lock()
}

export async function exitSafetyLock() {
  if (!Capacitor.isNativePlatform()) return { unlocked: false }
  return SafetyLock.unlock()
}

export async function openDeviceOwnerHelp() {
  if (Capacitor.isNativePlatform()) await SafetyLock.openDeviceOwnerHelp()
}

export async function openNestlyAppSettings() {
  if (Capacitor.isNativePlatform()) await SafetyLock.openAppDetails()
}
