import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Over-the-air updates for the sideloaded build.
 *
 * Nestly is installed from the portal rather than a store, so without this a
 * parent stays on whatever build they first installed — indefinitely, including
 * through fixes to the things that have already bitten us. The app checks a
 * manifest, and if there is something newer it offers to fetch it.
 *
 * It only ever *offers*. Android shows its own install confirmation and the
 * user can decline; nothing installs silently, and nothing can.
 *
 * Not active on the web build, where the browser already has the current code,
 * and there is no APK to replace.
 */

export type UpdateManifest = {
  versionCode: number
  versionName: string
  /** Absolute https URL of the APK. */
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
  downloadAndInstall(opts: { url: string; sha256?: string }): Promise<{ started: boolean }>
  openInstallSettings(): Promise<void>
}

const Updater = registerPlugin<UpdaterPlugin>('NestlyUpdater')

/**
 * Where the manifest lives. Same origin as the setup links, and a build-time
 * constant for the same reason: inside the APK `location.origin` is
 * `https://localhost`, which hosts nothing.
 */
const ORIGIN = (
  (import.meta.env.VITE_PORTAL_ORIGIN as string | undefined) ??
  'https://nestly-gamma-seven.vercel.app'
).replace(/\/+$/, '')

export const MANIFEST_URL = `${ORIGIN}/downloads/latest.json`

export function updatesSupported(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Compares the installed build against the published one.
 *
 * Compares `versionCode`, never `versionName`. The name is for humans and can
 * legitimately go sideways ("1.0" to "1.0-hotfix"); the code is the integer
 * Android itself uses to decide what constitutes an upgrade, and a downgrade is
 * refused by the installer anyway.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!updatesSupported()) return { state: 'unsupported' }

  try {
    const current = await Updater.currentVersion()

    // Cache-busted: a stale manifest is the one failure mode that makes this
    // whole feature pointless, and CDNs cache aggressively by default.
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return { state: 'error', message: 'Could not check for updates.' }

    const manifest = (await res.json()) as UpdateManifest
    if (typeof manifest?.versionCode !== 'number' || !manifest.url) {
      return { state: 'error', message: 'Update information was unreadable.' }
    }

    if (manifest.versionCode <= current.versionCode) {
      return { state: 'current', versionName: current.versionName }
    }
    return { state: 'available', manifest, currentVersionName: current.versionName }
  } catch {
    // Offline is the normal case for this app, not an error worth shouting
    // about — the product is built to work without a connection.
    return { state: 'error', message: 'No connection. Nestly keeps working offline.' }
  }
}

/**
 * Downloads and hands the APK to Android's installer.
 *
 * Sends the expected hash so the native side can refuse a download that does
 * not match what the manifest promised.
 */
export async function installUpdate(manifest: UpdateManifest): Promise<void> {
  const { allowed } = await Updater.canInstall()
  if (!allowed) {
    // Android will not show the install dialog until this is granted, and the
    // grant is per-app and lives in Settings. Sending them there is the only
    // way forward.
    await Updater.openInstallSettings()
    throw new Error(
      'Allow Nestly to install apps, then tap Update again. Android asks once.',
    )
  }
  await Updater.downloadAndInstall({ url: manifest.url, sha256: manifest.sha256 })
}
