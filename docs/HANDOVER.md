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
| `paystack-checkout` | caller's JWT + household membership |
| `paystack-webhook` | HMAC-SHA512 of the raw body, keyed with the secret API key |
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
- Notes: sent immediately on both links; parent polls every 30s under realtime,
  child polls `child-sync` every 45s

## Notes

Notes go over the internet, and over Bluetooth when the internet is not there.
They were the last thing in the product that crossed by radio only.

The two links cannot duplicate a note because the **sender mints its id** and
both paths de-duplicate on it — `notes.client_id`, unique, doing exactly what
`(child_id, seq)` does for events. That is the property to preserve; a
server-generated id cannot work, because the phone that wrote the note has
already filed it under its own and would not recognise the row coming back.

Four pieces:

| Piece | Does |
|---|---|
| `src/agent/notes.ts` | the store on both devices. One thread, two links |
| `src/cloud/notes.ts` | the parent's channel — RLS + realtime |
| `src/agent/cloudNotes.ts` | the child's channel — `child-sync` + device secret |
| `src/app/NotesBridge.tsx` | binds a pairing to its cloud child, and gives online-only children a thread |

Things worth knowing before changing it:

- **`delivered` means the other phone has it, not that the server does.**
  `synced` is the separate flag that stops re-uploading. Collapsing the two
  would put a tick on a note sitting in Postgres while the child's phone is in a
  bag, which is the one thing this screen must never do.
- **Bluetooth retries anything undelivered, cloud-accepted or not.** Deliberate:
  a note the server holds has not reached a child whose mobile data is off, and
  that child is often standing right there. The duplicate costs nothing.
- **`sender` is set server-side in `child-sync`, never read from the request.** A
  device secret authenticates a child's phone and nothing else; letting it post
  a note attributed to the parent would put words in their mouth.
- **The poll returns recent notes, not just unacknowledged ones.** Filtering on
  `delivered_at` would mean the first adult to open the app is the only one who
  ever sees a note. Each channel keeps a session ack-cache so that costs one
  write per note rather than one per cycle.
- **`platform/device.tsx` does not import the cloud** and should stay that way —
  it is the offline core. The parent's channel is handed in by `NotesBridge`.
- **A note from a child raises a notification**, on its own channel
  (`nestly-notes`, "Notes") rather than the alerts one, so a parent can silence
  one without losing the other. Claimed via `notes.notified_at` exactly as
  events are. Notes stack in the shade; alerts still replace by kind.
  **The channel id is now in four places** — the two in `push.ts`, `CHANNEL_ID`
  and `NOTE_CHANNEL_ID` in push-notify. A push naming a channel the handset has
  never created is filed under one Android invents, which is silent: a phone on
  an older build will not hear a note notification until it updates.
  A parent's note is never pushed anywhere. The child's phone registers no
  token, deliberately.

## Locate

The Locate button used to open the map, which showed the last telemetry push —
a minute old at best, five under a low battery. That is a fine heartbeat and a
poor answer to a button labelled Locate.

It is now a *request*, asked over both links at once and answered by a fresh
reading:

- `locate_requests`, one row per child, not a queue. Asked twice in a minute is
  the same question; queueing the second would make the phone take two fixes.
- `child-sync` returns `locateNow: true` while `served_at` is null, and records
  the answering fix on the row **as well as** in `child_telemetry` — telemetry
  is last-write-wins, so the fix the parent is watching for can be overwritten
  by the routine push a second behind it.
- Over Bluetooth it is the `{t:'locate'}` downlink; the child replies with
  immediate telemetry. An older child build ignores the message, which looks the
  same as a phone that cannot get a fix, so there is no protocol bump.
- `useLocate` reports honestly: asking, found, timed out at 90s, or unavailable
  when neither link could carry the question. Worst case is about a minute — the
  child's cloud poll plus up to 12s for the fix — and the UI says so rather than
  spinning silently.
- A found fix offers "Save as a zone", which *prefills* `draftFence` and opens
  the geofence editor. It does not create a zone: naming it and choosing the
  radius are the parent's, and a zone quietly added would start sending alerts
  nobody asked for.

## One resolver for the household id

`CloudBridge`, `CloudHydrate`, `CloudWatch` and `NotesBridge` all used to read
the cached `nestly.household` and give up when it was missing. The Devices
screen did not — it fell back to `ensureHousehold()` and saved the result.

That difference was a real bug on a real phone: Home showed one child while
Devices listed two, because Devices had resolved the household for itself and
the four bridges had quietly done nothing all session. They resolve once on
mount, so "not there yet" meant "not until the app restarts".

`resolveHouseholdId()` in `cloud/sync.ts` is now the only way any of them get
it, and the fallback is inside it.

## Publishing an update

The updater itself is fine and always was: `checkForUpdate` fetches
`/downloads/latest.json` cache-busted with `no-store`, compares **versionCode**
(never the name), and the native side verifies the SHA-256 before handing the
file to Android. It checks once per launch — polling a manifest on a timer
spends a family's data to learn nothing almost every time — plus the manual
button on Devices.

**The publisher was the broken part.** `publish-apk.mjs` read the APK from
`android/app/build/outputs/apk/release/`, which `build-apk.ps1` never writes:
it builds in a temp copy of the project and copies only the finished APK to
`release/`. So the path under the repo held whatever Gradle last produced in
place — days old, at the previous versionCode — while the manifest took its
version from `build.gradle`. Publishing that pair hands every phone an update
that installs and still reports the old number, then offers itself again for
ever.

Now: the publisher reads `release/Nestly-release.apk`, and `build-apk.ps1`
carries Gradle's `output-metadata.json` alongside it as
`Nestly-release.metadata.json`. The publisher cross-checks that against
`build.gradle` and **refuses to publish a mismatch**. build.gradle says what
the next build will be; the metadata says what these bytes actually are.

### Pushing to GitHub

The repo is private and this machine has no working credential helper for it —
a plain `git push` fails with `Repository not found`, which is GitHub's answer
for "private repo, and you are nobody". A personal access token is kept as a
**comment on line 7 of `.env.local`**, which is gitignored and untracked.

Push with it without ever storing it in the repo:

```bash
TOKEN=$(grep -o 'ghp_[A-Za-z0-9_]*' .env.local | head -1)
git push "https://x-access-token:${TOKEN}@github.com/data247network/nestly.git" main
```

Deliberately *not* `git remote set-url` with the token in it. That writes the
credential into `.git/config` in plaintext, where it survives every future
clone of the working tree, shows up in `git remote -v` on a shared screen, and
is the kind of thing that ends up in a screenshot. The one-off URL leaves the
remote clean — check with `git remote get-url origin`.

Vercel deploys `main` automatically, so the push *is* the publish.

If the token stops working it has been rotated or expired: mint a new one at
GitHub → Settings → Developer settings → Personal access tokens, with `repo`
scope, and replace the comment. **Never `git add -A` after editing `.env.local`
without looking** — see the Firebase key incident below.

Release checklist:

1. Bump `versionCode` (and `versionName`) in `android/app/build.gradle`
2. `npm run android:apk:release`
3. `npm run apk:publish` — refuses if the APK does not match the bump
4. Commit `public/downloads` and push to `main`; Vercel serves it

`latest.json` is served `no-store` (see `vercel.json`), so a CDN cannot hold an
old manifest and make every phone think it is current.

**The download page reads its version from that manifest.** It used to be a
constant, `'1.0'`, and it stayed `'1.0'` through eight releases — the page
offered "Version 1.0" of a file that was 1.7. Anything a person has to remember
to update in step with a release is something they will forget.

## Times on screen

Alerts and the activity trail rendered a bare clock, frozen at ingest. Three
rows reading 16:42, 16:42, 16:41 from three different days are indistinguishable
from three rows this afternoon. `app/time.ts` `stamp()` formats from `ts` at
render — time alone today, "Yesterday HH:MM", then a date. `Alert.time` is gone;
`ts` is the only record.

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

## The plan catalogue

Four tiers, and the numbers live in `plans` + `plan_prices`, read at runtime.
`src/app/plans.ts` is the offline fallback only — keep the two in step.

| id | name | adults | children | ₦/mo | ₦/yr | £/mo | £/yr |
|---|---|---|---|---|---|---|---|
| `free` | Free Plan | 1 | 1 | 0 | 0 | 0 | 0 |
| `standard` | Standard | 2 | 2 | 1,000 | 10,200 | 0.54 | 5.54 |
| `pro` | Pro | 2 | 4 | 2,000 | 20,400 | 1.09 | 11.07 |
| `premium` | Premium | 3 | 6 | 3,000 | 30,600 | 1.63 | 16.61 |

Two rules, neither recoverable from the numbers alone:

- **Yearly is 15% off the whole year.** The pricing sheet had Standard that way
  but Pro and Premium at 15% off *one month* (24,000 → 23,700), which is a 1.25%
  discount announced as 15% and would have made the cheapest tier the best value
  per adult. Confirmed and corrected.
- **Sterling is derived from Naira at ₦1,842 to the pound.** The sheet's own
  rate — 700 ÷ 0.38 exactly, and it reproduces 0.54, 1.09 and 1.63. Stored, not
  computed at runtime, so a moving rate cannot reprice everybody mid-month.

The catalogue before this was incoherent: the row with id `free` was named
"Standard" at £4, the real free tier sat under `defaultfreeplan` which no
household could be assigned to, and the Naira prices bore no relation to the
Sterling ones.

**Add-ons.** One extra adult or child on top of any plan: ₦700/£0.38 per unit
per month, ₦7,140/£3.88 per year. `addon_prices` holds the price,
`household_addons` holds what a household bought, and `household_limits()` is
the one place plan + add-ons are added up — three copies of a capacity check is
three chances to let somebody past it. `household_addons` is readable by the
household and **writable only by the service role**, like `subscriptions`:
entitlement a client can edit is not entitlement.

## Extra places (add-ons) — HALF BUILT, finish this next

A family that exceeds its plan quota and does not want to upgrade can buy extra
places per unit. **The UI and the database exist; the billing does not.** The
screen currently says so in as many words — "Not billed yet" — and that sentence
must come out in the same change that connects payment, not before.

Done:

- `addon_prices` (₦700/£0.38 monthly, ₦7,140/£3.88 yearly), `household_addons`,
  and `household_limits()` as the single place plan + add-ons are summed.
- `payments.addon_adults`, `payments.addon_children`, `payments.addons_granted_at`.
- The gate in `UpgradeHint`: silent within quota, priced past it, with the next
  tier named as the alternative for anyone adding several.

Still to do, and the order matters:

1. **`stripe-checkout` / `paystack-checkout`** — accept `addonAdults` and
   `addonChildren`, clamp 0–20. When either is non-zero the session is for the
   *units only*, not a plan change: amount = units × the `addon_prices` row for
   that currency. It cannot be a second line item on the plan, because a family
   on the free tier has a £0 plan line and Stripe rejects that. Write the units
   onto the `payments` row before the customer leaves, as the amount already is.
2. **`stripe-webhook` / `paystack-webhook`** — on success, look the payment up by
   reference and, if it carries units, add them to `household_addons`.
   **Claim `addons_granted_at` conditionally first** (`where addons_granted_at is
   null`), exactly as `push-notify` claims `child_events`. Webhooks are retried;
   granting per delivery hands a family five extra children for one payment.
3. **Client** — `startAddonCheckout` in `cloud/sync.ts`, wired to a "Add anyway"
   button on the gate, and remove the "Not billed yet" line.
4. **Enforcement** — the limit checks still read `planOf()` from the compiled
   fallback, so a family that has *bought* a place is still told they are over
   quota. Switch those reads to `household_limits()`.

Note `household_addons` is service-role-only by design: entitlement a client can
edit is not entitlement, so the grant has to happen in the webhook.

## Downloads and countries

Both read zero on the admin dashboard because nothing had ever written to
`app_downloads`. The download button was a plain `<a href download>` to a static
file on Vercel, so no code of ours ran at either end.

The chain now: the button points at **`/api/download?variant=…`** (a Vercel edge
function), which reads `x-vercel-ip-country`, calls the **`log-download`**
Supabase function, and 302s to the APK.

- It has to be a Vercel function, because Vercel is the only part of this stack
  that is told the country. Supabase's gateway *strips* inbound geo headers —
  correctly, since a client that can set `cf-ipcountry` can set it to anything —
  so a request pointed straight at Supabase always recorded `country: null`.
  That was verified, not assumed.
- **302, never 301.** A permanent redirect gets cached and every later download
  skips the function, so the counter would show a burst on day one and silence
  after — indistinguishable from a product nobody wants.
- The recorder is never awaited and never fatal. Somebody installing the app
  their child's safety depends on must not be blocked by our analytics.
- Nothing personal is stored: no IP, no user agent. Just when, which button, and
  a two-letter country. An unknown country is stored as null, not guessed.

## Joining a family, not inventing one

`ensureHousehold()` creates a household when it finds none. That is right for
the parent who signs up first and quietly wrong for everyone after them: the
second parent signed in, was handed a brand new empty "My family" of their own,
and reported — entirely fairly — that the app was not syncing. It was. There was
nothing in the household it had just invented for them, and the family they
meant to join was elsewhere behind a code they were never asked for.

Sign-in now calls `existingHouseholdId()` first. A member goes straight in; a
new account is *asked* — join with a code, or start a new family — and
`ensureHousehold` is only reached from that explicit choice. Never implicitly.

Also on this screen: password reset (`requestPasswordReset` / `setPassword`) and
**resend confirmation**, which appears only when a sign-in failed specifically
on an unconfirmed address. Telling somebody to sign up again gets them "already
registered", a dead end when their first email simply never arrived. The reset
box answers identically whether or not the address exists, so it cannot be used
to find out who has an account.

## One child, one card

The app drew a child twice — a "Location known" card from Bluetooth and a
"Linked online" card from the cloud, same person, different batteries. Every
consumer read `cloudChildId` off `liveChildren`, which only exists while a BLE
connection has delivered a `Hello`. Out of range there was nothing to say the
pairing and the cloud child were the same person.

The binding is now stored on the `Pairing` itself, written the first time a
child reports it. `CloudHydrate`, `CloudBridge` and `NotesBridge` all read the
stored one first and the live one second. Reading it off the radio is the bug;
if you add a fourth consumer, do the same.

**That alone was not enough**, and the reason is worth keeping. The binding is
still *learned* from `Hello`, so it does not exist until the phones have been in
Bluetooth range at least once since the app was installed — and a parent who
updates while their child is at school sees the duplicate anyway. `ble_address`
on `children` is null and Android does not expose a device's own BLE address, so
there is nothing to match on server-side either.

So `syncCloudChildren` falls back to the **name**: a cloud child whose name
matches exactly one existing Bluetooth child is not drawn again. Deliberately
scoped to *display*. Notes, policy and events stay keyed on ids and are never
routed by name — merging two cards wrongly is visible and self-corrects when the
phones next meet, whereas routing a private note by a guessed identity does not.
Two children sharing a name is ambiguous, so nothing merges and both are shown.
Covered by four tests in `children.test.ts`.

Notes gained a tab per child on the parent's phone, for the same reason: every
child's notes went into one list and anything typed was broadcast to all of
them, so with two children a note meant for one went to both and the second
child's thread looked empty.

## Admin lists

Parents and Families both have a search box. It matches **every word in any
field** — "eton pro" finds the Pro family belonging to Eton without caring about
order — and always shows "12 of 400" rather than "12 results", because a bare
count leaves you wondering whether the rest failed to load.

**It filters client-side, and that is a deliberate ceiling.** The `parents` and
`families` admin actions return every row, so this narrows what is shown, not
what is fetched. Fine at this size and instant; when a list reaches a few
thousand rows it is the *fetch* that needs paging, and the search term should
move into those two actions in `admin-api`.

Dashboard tiles drill into the list behind them — Families, Parents, Children
and Subscriptions all navigate, and Subscriptions arrives with "Paying families
only" ticked, shown as a visible toggle rather than applied invisibly. Choosing
a section from the sidebar clears whatever a tile asked for.

Downloads has no list yet: `admin-api` has no `downloads` or `children` action,
so those two would need new read-only handlers before their tiles could open
anything.

## Payments

Two providers, and they are **not** interchangeable — the difference reaches the
customer, so the plan cards say which is which before anyone pays.

| | Stripe | Paystack |
|---|---|---|
| Currency | GBP | NGN |
| Sells | a subscription that renews until cancelled | one fixed period, paid up front |
| Cancel | Stripe Billing Portal, via `stripe-portal` | nothing to cancel; it runs out |

**OPay is gone.** It routes by the merchant's *registered business country*, and
that account is registered in Egypt, so every naira request came back as
`request forbidden(request domain error.)`. No value of `country`, `currency` or
host fixes that — an Egypt account settles in EGP. Paystack is Nigerian and
takes NGN natively. The deployed `opay-*` functions are unreferenced and can be
deleted from the dashboard; no OPay payment ever succeeded.

Paystack has **no separate webhook signing secret**: `x-paystack-signature` is
HMAC-SHA512 of the raw body keyed with `PAYSTACK_SECRET_KEY`. One less secret,
and one more reason that key must never reach a client.

`Billing.tsx` shows a pay button per currency a plan is priced in, pounds first,
because pounds are what the card headline quotes. It used to hardcode
`startCheckout('opay', …)` and gate the button on an NGN price, which is why
Premium once read "No price set yet" while being priced at £7.99.

## Which link wins

The parent app now treats **the internet as primary and Bluetooth as the
fallback**, which is the opposite of what the code originally assumed and is a
product decision rather than an engineering one. Bluetooth reports every 15s
against the cloud's 60s, so the radio is genuinely fresher — but only ever when
the two phones are in the same room, which is the one situation where a parent
does not need a map. `preferredFix` in `src/screens/parent.tsx` is where that
choice lives.

The offline promise is untouched: with no signal Bluetooth still carries
everything. It just stops overriding a server that has an answer.

`useCloudChildren` polls every 15s underneath the realtime socket, paused while
the app is off screen. Realtime is the fast path but not a guarantee — a
websocket that drops when a phone changes network reconnects silently and the
screen simply stops updating with nothing on it to say so.

**The gap that remains:** `activity.tsx`, `report.tsx` and `hub.tsx` render from
`state.alerts`, `state.activity` and `state.usageByChild`, which are store
fields written only by the Bluetooth link. They are not per-screen bugs — the
fix is to hydrate those fields from the cloud, which means touching the reducer
the whole offline product runs on. Do it deliberately, not in passing.

Both webhooks name their rejection reason in the logs (`digest-mismatch`,
`stale`, `no-header`). That exists because a genuine Stripe delivery was
rejected for a day and the log said only "Rejected" — a wrong secret, clock skew
and something-that-is-not-Stripe are three unrelated faults with three unrelated
fixes. `digest-mismatch` nearly always means the secret is from the wrong mode
or the wrong endpoint.

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
- **notes between two phones that are nowhere near each other.** The server half
  is proven end to end against the deployed `child-sync` — both directions,
  receipts both ways, a replay staying one row, a wrong secret refused — and the
  Bluetooth fallback is proven in the loopback browser. What no test reaches is
  the parent's phone signed into a real account writing through RLS, and the
  realtime socket actually firing on a handset.
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
