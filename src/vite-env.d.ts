/// <reference types="vite/client" />

/**
 * Typed build-time configuration.
 *
 * Both are optional on purpose: the cloud is an addition to the Bluetooth
 * product, not a requirement, so a build without them has to compile and run.
 * `hasCloud()` is the single place that decides whether the online path is
 * available.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
