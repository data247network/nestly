import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

/**
 * Firebase push, on the parent's phone.
 *
 * Everything a parent needs to know already reaches the server within seconds —
 * the child device uploads alerts the moment they happen. What was missing is
 * the last hop: the parent had to open Nestly to find out. A zone exit at 3pm
 * that a parent reads at 6pm is not an alert, it is a log entry.
 *
 * Parent devices only. A child's phone is the one being watched; pushing to it
 * would tell the child what their parent has just been told, which is neither
 * useful nor something we promised.
 *
 * Nothing here is load-bearing. Notifications are a convenience on top of a
 * product that already works with no signal at all, so every call is allowed to
 * fail quietly: a phone with notifications refused, no Play Services, or no
 * network is a phone that behaves exactly as it did before this existed.
 */

/**
 * The channel urgent alerts arrive on.
 *
 * Must match `default_notification_channel_id` in AndroidManifest.xml and
 * `channel_id` in the push-notify edge function. When Nestly is not in the
 * foreground the notification is built by the system before any of our code
 * runs, so a mismatch is not a styling bug — Android files the alert under a
 * channel it invents, which is silent.
 */
export const ALERT_CHANNEL_ID = 'nestly-alerts'

/**
 * The channel notes arrive on. Must match `NOTE_CHANNEL_ID` in push-notify.
 *
 * Separate from alerts on purpose. Android channels are the only place a person
 * gets to say "buzz me for this, not for that", and "my child wrote to me" and
 * "protection was switched off" are not the same request — a parent who turns
 * one down should keep the other. There is no manifest default for this one, so
 * every note push names it explicitly.
 */
export const NOTE_CHANNEL_ID = 'nestly-notes'

/** What survives the trip from the edge function into a tapped notification. */
export type PushPayload = {
  title: string | null
  body: string | null
  /** The `ChildEventKind` that caused this, or `note`. */
  kind: string | null
  /** Supabase child uuid, so a tap can open the right child. */
  childId: string | null
}

export type PushHandlers = {
  /** The FCM registration token. Fires again whenever Firebase rotates it. */
  onToken: (token: string) => void
  /** Registration refused or unavailable. Not fatal; nothing else changes. */
  onUnavailable?: (reason: string) => void
  /** A notification was tapped. */
  onOpened?: (payload: PushPayload) => void
  /** A notification arrived while Nestly was open and on screen. */
  onReceived?: (payload: PushPayload) => void
}

/** Web has no FCM token to register, and the portal is not a phone to buzz. */
export function pushSupported(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * The token this phone last registered, if any.
 *
 * Held here rather than in React state because the one caller that needs it —
 * signing out — is a user action, not a render. Repopulated on every launch:
 * `register()` re-emits the existing token rather than minting a new one.
 */
let lastToken: string | null = null

export function currentPushToken(): string | null {
  return lastToken
}

/**
 * Subscribes this phone to push, and returns how to stop.
 *
 * The order below is not incidental. `register()` resolves before the token
 * arrives — the token comes back as a `registration` event — so a listener
 * attached afterwards misses it on the launch that matters most, the first one,
 * and the phone then registers nothing until Firebase happens to rotate the
 * token days later.
 */
export async function startPush(handlers: PushHandlers): Promise<() => void> {
  if (!pushSupported()) return () => {}

  // Declaring the channel id in the manifest does not create the channel; only
  // this does. Created before registering so it exists before any notification
  // can arrive. Re-creating an existing channel is a no-op, and Android will
  // not let us quietly re-raise importance a parent has turned down — which is
  // correct, and why this is not something to retry.
  try {
    await PushNotifications.createChannel({
      id: ALERT_CHANNEL_ID,
      name: 'Safety alerts',
      description: 'Zones, filtering, new contacts, and protection being switched off.',
      // IMPORTANCE_HIGH, which is 4 — makes a sound and shows a heads-up
      // banner. The whole point is to interrupt; a silent safety alert is a
      // contradiction. Not 5: that is IMPORTANCE_MAX, which Android's own docs
      // mark unused, and which a channel cannot be corrected out of later.
      importance: 4,
      // VISIBILITY_PRIVATE. The alert appears on the lock screen but its
      // contents follow the phone's own "sensitive notifications" setting —
      // a child's name and where they are should not be readable by anyone who
      // picks up a locked phone.
      visibility: 0,
      vibration: true,
    })
    // Created before registering, like the alerts channel, so it exists before
    // any note can arrive. A push naming a channel the phone has never created
    // is filed by Android under one it invents, which is silent — and a silent
    // note is worse than none, because the tick still says it was delivered.
    await PushNotifications.createChannel({
      id: NOTE_CHANNEL_ID,
      name: 'Notes',
      description: 'Notes your child writes to you.',
      // Also HIGH. A note is rare and was typed by a person who wanted an
      // answer; burying it under a silent channel makes the feature pointless.
      // A parent who disagrees can turn this one down without touching alerts,
      // which is the whole reason it is a separate channel.
      importance: 4,
      // Private for the same reason as alerts: what a child writes should not
      // be readable by whoever picks up a locked phone.
      visibility: 0,
      vibration: true,
    })
  } catch {
    /* Android 7 and older have no channels. Notifications still arrive. */
  }

  const handles = await Promise.all([
    PushNotifications.addListener('registration', (token) => {
      if (!token.value) return
      lastToken = token.value
      handlers.onToken(token.value)
    }),
    PushNotifications.addListener('registrationError', (err) => {
      handlers.onUnavailable?.(String(err.error ?? 'Registration failed.'))
    }),
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      handlers.onReceived?.(toPayload(n.title, n.body, n.data))
    }),
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      handlers.onOpened?.(toPayload(a.notification?.title, a.notification?.body, a.notification?.data))
    }),
  ])

  const stop = () => {
    for (const handle of handles) void handle.remove()
  }

  try {
    // On Android 12 and below this always reports granted — POST_NOTIFICATIONS
    // did not exist, and the permission is implicit.
    let { receive } = await PushNotifications.checkPermissions()
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      receive = (await PushNotifications.requestPermissions()).receive
    }

    if (receive !== 'granted') {
      handlers.onUnavailable?.('Notifications are turned off for Nestly.')
      stop()
      return () => {}
    }

    await PushNotifications.register()
  } catch (e) {
    handlers.onUnavailable?.(e instanceof Error ? e.message : 'Push is unavailable on this phone.')
    stop()
    return () => {}
  }

  return stop
}

/**
 * Releases this phone's token at Firebase.
 *
 * Called on sign-out alongside dropping the row server-side. Doing only the
 * server half would leave the handset registered and quietly re-adding itself
 * on the next token rotation.
 */
export async function stopPush(): Promise<void> {
  if (!pushSupported()) return
  lastToken = null
  try {
    await PushNotifications.unregister()
  } catch {
    /* Nothing was registered, which is the state we wanted anyway. */
  }
}

/**
 * Normalises what Android hands back.
 *
 * A notification tapped from the tray and one that arrived with Nestly open
 * take different routes through the plugin, and the second carries its title
 * and body inside `data` rather than as fields. Reading both means a tap
 * behaves the same either way.
 */
function toPayload(title: unknown, body: unknown, data: unknown): PushPayload {
  const d = (data ?? {}) as Record<string, unknown>
  const text = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s.length > 0 ? s : null
  }
  return {
    title: text(title) ?? text(d.title),
    body: text(body) ?? text(d.body),
    kind: text(d.kind),
    childId: text(d.childId),
  }
}
