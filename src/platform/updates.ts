import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * OTA updates for sideloaded Nestly builds.
 *
 * The app checks the published manifest and offers an update when the Android
 * versionCode is newer. Android still owns the installation confirmation; this
 * code never installs silently.
 */
export type UpdateManifest = {
  versionCode: number
  versionName: string
  url: string
  sha256: string
  size: number
  notes?: string
}

export type UpdateStatus =
  | { state: 'unsupported' }
  | { state: 'current'; versionName: string }
  | { state: 'available'; manifest: UpdateManifest; currentVersionName: string }
  | { state: 'error'; message: string }

type UpdaterPlugin = {
  currentVersion(): Promise<{ versionCode: number; versionName: string }>
  canInstall(): Promise<{ allowed: boolean }>
  downloadAndInstall(opts: { url: string; sha256?: string; size?: number }): Promise<{ started: boolean }>
  openInstallSettings(): Promise<void>
}

const Updater = registerPlugin<UpdaterPlugin>('NestlyUpdater')
const ORIGIN = (
  (import.meta.env.VITE_PORTAL_ORIGIN as string | undefined) ??
  'https://nestly-gamma-seven.vercel.app'
).replace(/\/+$/, '')
const MANIFEST_ORIGIN = new URL(ORIGIN).origin

export const MANIFEST_URL = `${ORIGIN}/downloads/latest.json`

export function updatesSupported(): boolean {
  return Capacitor.isNativePlatform()
}

export async function installedVersion(): Promise<{
  versionCode: number
  versionName: string
} | null> {
  if (!updatesSupported()) return null
  try {
    return await Updater.currentVersion()
  } catch {
    return null
  }
}

function validManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<UpdateManifest>
  if (!Number.isInteger(m.versionCode) || m.versionCode <= 0) return false
  if (typeof m.versionName !== 'string' || !m.versionName.trim()) return false
  if (typeof m.url !== 'string') return false
  if (typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(m.sha256)) return false
  if (!Number.isInteger(m.size) || m.size <= 0 || m.size > 80 * 1024 * 1024) return false

  try {
    const url = new URL(m.url)
    // Only the official Nestly HTTPS host may supply an APK. The hash protects
    // the bytes, while this prevents a compromised manifest from redirecting
    // the app to an unrelated download host.
    if (url.protocol !== 'https:' || url.origin !== MANIFEST_ORIGIN) return false
    if (url.pathname !== '/downloads/nestly.apk') return false
  } catch {
    return false
  }
  return true
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!updatesSupported()) return { state: 'unsupported' }

  try {
    const current = await Updater.currentVersion()
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { state: 'error', message: 'Could not check for updates.' }

    const raw: unknown = await res.json()
    if (!validManifest(raw)) {
      return { state: 'error', message: 'Update information was unreadable.' }
    }

    if (raw.versionCode <= current.versionCode) {
      return { state: 'current', versionName: current.versionName }
    }
    return { state: 'available', manifest: raw, currentVersionName: current.versionName }
  } catch {
    // Offline is normal for Nestly. Do not interrupt the child/parent experience.
    return { state: 'error', message: 'No connection. Nestly keeps working offline.' }
  }
}

export async function installUpdate(manifest: UpdateManifest): Promise<void> {
  if (!validManifest(manifest)) throw new Error('This update is not a valid Nestly release.')

  const { allowed } = await Updater.canInstall()
  if (!allowed) {
    await Updater.openInstallSettings()
    throw new Error('Allow Nestly to install apps, then tap Update again. Android asks once.')
  }

  await Updater.downloadAndInstall({
    url: manifest.url,
    sha256: manifest.sha256,
    size: manifest.size,
  })
}
