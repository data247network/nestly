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
| `stripe-checkout` | caller's JWT + household membership |
| `stripe-portal` | caller's JWT + household membership |
| `stripe-webhook` | HMAC-SHA256 over `timestamp.rawBody`, per Stripe's scheme |
| `push-notify` | the service role key. Internal: only `child-sync` calls it |

`verify_jwt` is off deliberately in every case. The gateway rejects CORS
preflights when it is on — browsers never send `Authorization` on an OPTIONS —
and each function's own check is stronger than "is this token signed".

## Sync cadence

- Child → parent over BLE: every 15s while connected
- Child → cloud: alerts immediately, telemetry every 60s, 5 min under 15% battery
- Cloud → parent's phone: FCM, on the urgent kinds only, within a second of the
  child's upload
- Viewers: Supabase realtime, debounced 800ms — no polling

## Push

Built and deployed; never seen on a real phone (see "Verify on hardware").

The receiving half is `@capacitor/push-notifications`, wrapped by
`src/platform/push.ts` and driven by `src/app/PushBridge.tsx`, which is mounted
only in the signed-in parent branch of `App`. Tokens go into `device_tokens`
through the `claim_device_token` RPC — a plain upsert cannot work, because the
row is keyed by handset and a second parent signing in on the same phone
collides with a row RLS correctly refuses them.

The sending half is `push-notify`. `child-sync` calls it after ingesting a batch
that contains any of `zone-enter`, `zone-leave`, `filter-off`, `contact-added`
or `tamper`. It mints a Google OAuth token from `FCM_SERVICE_ACCOUNT` (cached
for the hour, per warm instance) and sends over FCM HTTP v1.

Three properties worth knowing before changing it:

- **`child_events.notified_at` is the idempotency record.** The device resends
  its log until acknowledged, so the ingest path cannot tell a first arrival
  from a replay. Rows are *claimed* with a conditional update before anything is
  sent, which is also what stops two concurrent syncs double-buzzing.
- **Events older than 10 minutes are stamped, not sent.** A phone that has been
  out of signal since breakfast flushes its whole backlog at once, and forty
  notifications about a morning that is already over is how a parent learns to
  turn notifications off.
- **Dead tokens are pruned** on FCM's `UNREGISTERED` / `SENDER_ID_MISMATCH` /
  404, and on nothing else — a generic `INVALID_ARGUMENT` is far more often a
  malformed message, and pruning on it would empty a household's registrations
  over one bad send.

## Payments

Two providers, and they are **not** interchangeable — the difference reaches the
customer, so the plan cards say which is which before anyone pays.

| | Stripe | OPay |
|---|---|---|
| Currency | GBP | NGN |
| Sells | a subscription that renews until cancelled | one fixed period, paid up front |
| Cancel | Stripe Billing Portal, via `stripe-portal` | nothing to cancel; it runs out |

`Billing.tsx` shows a pay button per currency a plan is priced in, pounds first,
because pounds are what the card headline quotes. It used to hardcode
`startCheckout('opay', …)` and gate the button on an NGN price, which is why
Premium once read "No price set yet" while being priced at £7.99.

Things to know before changing the Stripe half:

- **Prices are built inline with `price_data`**, not from Price objects created
  in Stripe's dashboard. `plan_prices` stays the single source of truth, so an
  admin changing a price changes what is charged with nothing to mirror.
- **The webhook fetches back what it was just sent.** Event payloads are
  serialised with the API version pinned to the *endpoint* in Stripe's
  dashboard, not the one this code asks for — a dropdown can change the shape of
  every event. Only ids are read from the payload; the objects the database
  depends on are re-fetched against a pinned version.
- **`past_due` keeps the plan.** Stripe retries a failed card for about a
  fortnight. Access ends on `customer.subscription.deleted`, not on the first
  failed charge — cutting a family's safety app off the hour their card expired
  is not the behaviour to have.
- **`_shared/stripe.ts` is covered by tests** (`npm test`) for the form encoder
  and the signature verifier. Both fail silently when wrong: a mis-nested key is
  ignored by Stripe rather than rejected, and a broken verifier either refuses
  every real webhook or accepts forged ones.

## Next tasks

**1. Verify on hardware, and with a test card.** Never confirmed live:
- the lock overlay surviving Home
- the child uploading over mobile data in the background
- tamper alerts firing when a permission is revoked
- **Stripe, end to end.** Deployed and rejecting unauthorised callers, but no
  real card has been through it. Needs: the endpoint's event list to include the
  five that are handled (`checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated`,
  `customer.subscription.deleted`); the Billing Portal to have a saved default
  configuration in Stripe, without which "Manage or cancel" returns Stripe's own
  error; and the portal UI pushed to `main`, since Vercel deploys from there.
- **push, end to end.** Everything up to Google's door is proven: the service
  account signs, Google issues a token, and FCM accepts the message body and
  rejects only a deliberately invalid device token. What no test can reach is
  a real handset — the permission prompt, the token landing in `device_tokens`,
  the channel being audible, and the tap opening the alerts feed. Bump
  `versionCode` (still 7, same as both test phones) or the install will be
  refused as a downgrade.

**2. Play Store.** Release keystore exists at `android/nestly-release.jks`
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
- **The notification channel id is written in three places** — the manifest's
  `default_notification_channel_id`, `ALERT_CHANNEL_ID` in
  `src/platform/push.ts`, and `CHANNEL_ID` in `push-notify`. Change one and
  alerts still arrive, silently, filed under a channel Android invents. When
  Nestly is backgrounded the system builds the notification before any of our
  code runs, so nothing can correct it afterwards.
- **A channel's importance cannot be raised after it is created.** Android
  deliberately refuses, so a wrong `importance` shipped once needs a new channel
  id to fix, not a code change.
- **Android cannot gate Settings behind a code.** Uninstall resistance via Device
  Admin is a speed bump with a witness, not a lock. Don't imply otherwise in the
  product.

## Outstanding admin

- Supabase leaked-password protection still disabled
- The old GitHub token and Postgres password were rotated; the first Firebase
  service-account key was rotated after the leak
- `android/app/nestly-3495d-firebase-adminsdk-*.json` is a live service-account
  private key sitting inside the Android app module. Gitignored, and not
  packaged into the APK — Gradle only takes `src/main/assets` and `res` — but
  nothing in the build reads it either. The copy that matters is the
  `FCM_SERVICE_ACCOUNT` secret in Supabase; this one is worth moving somewhere
  that is not an app module before it gets swept into a build or a commit.
