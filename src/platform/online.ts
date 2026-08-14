import { useEffect, useState } from 'react'
import { Network } from '@capacitor/network'

/**
 * Whether this phone has a working data connection.
 *
 * Only ever used to say something truthful on screen. Nothing in the sync path
 * asks first — the uplink and the note channels attempt and fall back, because
 * "connected" from Android means an interface is up, not that anything answers
 * at the other end of it.
 *
 * Optimistic on first render. A screen that flashes "no connection" for a
 * moment on every open, on a phone that is plainly online, teaches people to
 * ignore the line.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let cancelled = false
    let remove: (() => void) | undefined

    void (async () => {
      try {
        const status = await Network.getStatus()
        if (!cancelled) setOnline(status.connected)
        const handle = await Network.addListener('networkStatusChange', (s) => {
          if (!cancelled) setOnline(s.connected)
        })
        remove = () => void handle.remove()
      } catch {
        // No plugin, so this is a browser. `navigator.onLine` is weaker — it
        // reports the interface, not reachability — but it is what there is.
        const update = () => !cancelled && setOnline(globalThis.navigator?.onLine ?? true)
        update()
        globalThis.addEventListener?.('online', update)
        globalThis.addEventListener?.('offline', update)
        remove = () => {
          globalThis.removeEventListener?.('online', update)
          globalThis.removeEventListener?.('offline', update)
        }
      }
    })()

    return () => {
      cancelled = true
      remove?.()
    }
  }, [])

  return online
}
