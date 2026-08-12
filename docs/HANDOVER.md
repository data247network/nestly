# Nestly — where things stand

Written 12 August 2026. Paste the "Next tasks" section into a new session to
pick up.

## What Nestly is

A family safety app. A child's phone enforces routines, filters browsing, logs
events and can be locked; a parent sees it from their phone or the web. The
premise is that **it works with no signal at all** — Bluetooth carries
everything between the two phones, and the cloud is an addition that removes the
wait, never a dependency. Any change that breaks the offline path is wrong, even
if it makes the online one better.

## Live systems

| Thing | Where |
|---|---|
| Repo | `github.com/data247network/nestly` (private) |
| Web portal | https://nestly-gamma-seven.vercel.app (auto-deploys from `main`) |
| Backend | Supabase project `toebajpgzhanrrvyhwmc` |
| APK | `/downloads/nestly.apk` + `/downloads/latest.json` on the portal |
| Play Console | Data247, personal account, no app created yet |

Both test phones (Galaxy A54 parent, A12 child) run **v1.6 / versionCode 7**.

## Surfaces

- **Parent app** — Android, Capacitor. Home, map, limits, hub, reports, devices.
- **Child app** — same APK; role chosen at first launch. Runs the agent.
- **Family Hub** — the web portal at `/hub`. Sign in, children, devices, alerts,
  plan and billing, settings.
- **Admin** — `/admin`. Cross-household stats, parents (ban/delete), families
  (plan changes), plan catalogue CRUD.
- **Cloud** — Supabase: Postgres + RLS, edge functions, realtime.

## Edge functions (all deployed, all `verify_jwt: false` by design)

| Function | Authenticates by |
|---|---|
| `enroll-child` | the invite code itself — a child has no account |
| `child-sync` | the child's `device_secret` from enrolment |
| `admin-api` | caller's JWT, then membership of `admin_users`, re-read per request |
| `opay-checkout` | caller's JWT + household membership |
| `opay-webhook` | HMAC-SHA3-512 signature over OPay's exact field ordering |

`verify_jwt` is off deliberately in every case. The gateway rejects CORS
preflights when it is on — browsers never send `Authorization` on an OPTIONS —
and each function's own check is stronger than "is this token signed".

## Sync cadence

- Child → parent over BLE: every 15s while connected
- Child → cloud: alerts immediately, telemetry every 60s, 5 min under 15% battery
- Viewers: Supabase realtime, debounced 800ms — no polling

## Next tasks

**1. FCM push — the secret is set, nothing is built.**
`FCM_SERVICE_ACCOUNT` is in Supabase secrets; `android/app/google-services.json`
is in place and Gradle applies the plugin conditionally. Two halves:
- *Receive*: add the Firebase messaging dependency, request `POST_NOTIFICATIONS`,
  register each parent's token into `device_tokens` (table exists, empty).
- *Send*: an edge function that mints an OAuth token from the service account and
  pushes on urgent events — `zone-enter/leave`, `filter-off`, `contact-added`,
  `tamper`. Those already flow to the server within seconds; only the phone-buzz
  is missing.

**2. Stripe checkout.** Webhook destination is configured correctly (5 events,
snapshot payload, correct URL). Needs `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` in Supabase secrets, GBP prices per plan set in Admin →
Plans & billing, then `stripe-checkout` and `stripe-webhook` functions. Stripe
can do true recurring subscriptions; OPay cannot, so OPay sells fixed periods.

**3. Verify on hardware.** Never confirmed on a real phone:
- the lock overlay surviving Home
- the child uploading over mobile data in the background
- tamper alerts firing when a permission is revoked

**4. Play Store.** Release keystore exists at `android/nestly-release.jks`
(credentials in `android/keystore.properties`, gitignored). Personal accounts
need 12 testers opted in for 14 continuous days before production. Build an AAB,
not an APK. **Remove `REQUEST_INSTALL_PACKAGES` and the self-updater before
submitting** — Play distributes updates itself and a self-updating APK is grounds
for removal.

## Things that will bite you

- **Never `git add -A` without looking.** A Firebase service-account key was
  swept into a commit that way. `*firebase-adminsdk*.json` is ignored now, but
  the habit is the fix, not the ignore rule.
- **Debug APKs cannot update release-signed phones.** `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
  `publish-apk.mjs` refuses debug builds for exactly this reason.
- **`cap:build` carries `--mode native`.** The web build uses `base: '/'` for
  nested portal routes; native needs `'./'`. Building the APK any other way ships
  a blank page.
- **A 200 is not proof a page works.** `/setup/CODE` returned 200 while rendering
  nothing, because the assets 404'd into the SPA fallback. Render it.
- **`vercel.json` rejects unknown keys.** A `comment` property failed a whole
  deployment before the build started.
- **Realtime is opt-in per table.** A channel on an unpublished table looks
  healthy and never fires.
- **Android cannot gate Settings behind a code.** Uninstall resistance via Device
  Admin is a speed bump with a witness, not a lock. Don't imply otherwise in the
  product.

## Outstanding admin

- Supabase leaked-password protection still disabled
- The old GitHub token and Postgres password were rotated; the first Firebase
  service-account key was rotated after the leak
