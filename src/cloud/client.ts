import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * The Supabase client.
 *
 * Deliberately optional. Nestly's whole premise is that two phones work over
 * Bluetooth with no server, so the cloud is an *addition*, not a dependency —
 * if these variables are absent the app must behave exactly as it does today
 * rather than white-screening. Every caller checks `hasCloud()` first.
 *
 * The publishable key is safe to ship: it is protected by row-level security,
 * which is why the RLS work came before this file existed.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export function hasCloud(): boolean {
  return Boolean(url && key)
}

/**
 * Session storage.
 *
 * localStorage does not survive on a Capacitor WebView the way people assume —
 * Android can clear it under storage pressure, and a parent silently signed out
 * would stop receiving their child's data with no explanation. Capacitor
 * Preferences is backed by SharedPreferences, which does survive.
 */
const nativeStorage = {
  getItem: async (k: string) => (await Preferences.get({ key: k })).value,
  setItem: async (k: string, v: string) => {
    await Preferences.set({ key: k, value: v })
  },
  removeItem: async (k: string) => {
    await Preferences.remove({ key: k })
  },
}

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!hasCloud()) {
    throw new Error('Supabase is not configured — check hasCloud() before calling.')
  }
  client ??= createClient(url!, key!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No OAuth redirects on a native shell; there is no URL to parse.
      detectSessionInUrl: !Capacitor.isNativePlatform(),
      ...(Capacitor.isNativePlatform() ? { storage: nativeStorage } : {}),
    },
  })
  return client
}
