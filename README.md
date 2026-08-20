# Nestly

Family safety, gently done — location, screen time and safety alerts for a household.

Nestly now uses a **cloud-first architecture** for connected operation, with Bluetooth LE retained as the offline/fallback transport. A single install is either a **parent phone** or a **child phone**, chosen on first run.

## How the two devices work now

When internet access is available, the child device uploads telemetry, events, usage snapshots and notes directly to Supabase. The parent app and web Family Hub consume the same cloud state. Supabase Realtime provides live updates, while periodic pulls remain as a recovery path when a socket is unavailable.

When the internet is unavailable, the child continues operating locally and Bluetooth remains the fallback path. The product therefore does not pretend that Bluetooth is a live tracker: without a network connection the parent sees the last synchronised state and history.

```text
                     ┌──────────────────┐
                     │     Supabase     │
                     │ Auth + Postgres  │
                     │ Realtime + Edge  │
                     └───────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        Child phone     Parent phone    Family Hub
        cloud sync      cloud sync       web portal
              │              ▲
              └──── BLE ─────┘
                 fallback
```

### Surfaces

| Surface | What it does |
| --- | --- |
| **Parent phone** | Pair children, see cloud/last-known position, define zones and routines, manage emergency numbers, filtering, alerts, activity and reports, send notes and lock the child device |
| **Child phone** | Runs the autonomous agent, uploads when online, maintains the local event log, applies policies, shows the lock/emergency surface and explains what is shared |
| **Family Hub** | Account sign-in, household management, children, devices, alerts, activity and billing from a desktop browser |
| **Supabase** | Auth, household data, child telemetry/events/usage, notes, policies, enrolment, Realtime and privileged Edge Functions |

## Cloud architecture

The production Supabase project is `Nestly` (`toebajpgzhanrrvyhwmc`, EU West). The client uses the publishable API key only; privileged database work is performed by Edge Functions/service-role operations.

### Core cloud tables

- `households` / `household_members` — account and security boundary
- `children` — child/device identity and enrolment secret
- `policies` — versioned policy documents
- `child_telemetry` — latest telemetry
- `child_events` — append-only event history with `(child_id, seq)` idempotency
- `child_usage` — daily usage snapshot
- `notes` — parent/child notes with delivery state
- `locate_requests` — on-demand location requests
- `device_tokens` — parent push registrations
- `subscriptions`, `plans`, `plan_prices`, `household_addons`, `payments` — entitlement/billing data

RLS is enabled across the public application tables. Household-scoped data is restricted through `private.is_household_member(...)` and `private.child_household(...)`. Server-only tables such as `admin_users` and `app_downloads` intentionally have no client policy, so authenticated/anonymous clients are denied by default and server-side operations bypass RLS with the service role.

### Realtime

`child_telemetry`, `child_events`, `child_usage`, `locate_requests` and `policies` are published to `supabase_realtime`. Notes are also published for live message updates.

The parent subscribes by child ID and re-reads the authoritative cloud state after a change. The web Family Hub uses the same pattern, with a small debounce to avoid a reload per row during bursts.

## Edge Functions

The live project currently has active functions for:

- `enroll-child` — redeem a child enrolment code and mint/bind a device secret
- `child-sync` — authenticate a child device using its device secret and synchronise telemetry, events, usage, notes, locate responses and policies
- `push-notify` — turn eligible child events/notes into parent FCM notifications
- `admin-api` / `admin-stats` — privileged administration and dashboard data
- `opay-checkout` / `opay-webhook` — OPay billing integration
- `stripe-checkout` / `stripe-webhook` / `stripe-portal` — Stripe billing integration
- `paystack-checkout` / `paystack-webhook` — Paystack billing integration
- `log-download` — server-side download/log handling

The child-facing `child-sync` and `enroll-child` functions deliberately implement their own device-secret authentication because a child device does not have a parent account session. Internal functions such as `push-notify` additionally validate the service-role credential in the request body/header.

**Important:** `verify_jwt=false` is intentional for functions whose caller is a child device, webhook or another trusted server-side function. Those functions must therefore retain strong application-level authentication and input validation. Do not switch JWT verification off on a new function merely for convenience.

## Security verification

Before the current cloud-first release, the production Supabase security configuration was checked directly.

- All public application tables have RLS enabled.
- Household data policies use household membership checks.
- `locate_requests` was tightened to `authenticated` household members rather than the `public` role.
- `household_addons` is no longer publicly readable.
- Privileged administration RPCs no longer grant `EXECUTE` to `anon` or ordinary `authenticated` users.
- `claim_device_token` remains callable by authenticated users but not anonymous users.
- `rls_auto_enable()` is no longer executable by `anon` or `authenticated`.
- Supabase's remaining security advisor findings are limited to the intentionally server-managed `admin_users`/`app_downloads` tables and the Auth leaked-password-protection setting. Enable leaked-password protection before public production launch.

## Running it

```bash
npm install
npm run dev
```

The app picks its surface from the viewport:

- **≥ 1100px wide** → the showcase: a sidebar over every screen, each rendered inside a real phone or browser frame.
- **Narrower, or running natively** → the app fullscreen, exactly as it ships.

### Running both devices in a browser

The link has a loopback transport that speaks the same framed protocol over a `BroadcastChannel`, so two tabs behave like two paired devices:

```text
http://localhost:5174/?device=parent
http://localhost:5174/?device=child
```

The `?device=` parameter partitions their stored role and pairing.

```bash
npm run build
npm test
npm run verify:devices
```

### Cloud environment

Copy `.env.example` to `.env.local` and provide the Supabase publishable key:

```text
VITE_SUPABASE_URL=https://toebajpgzhanrrvyhwmc.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Never put a Supabase secret/service-role key, database password or GitHub token in the client environment or commit them to the repository.

## Building the Android APK

The Android build uses the repository's Capacitor/Gradle project. The current local toolchain is JDK 17 with Android SDK platform 34/build-tools 34.0.0.

```bash
npm run android:apk:release
npm run android:apk
```

The release build is written to `release/Nestly-release.apk` and the debug build to `release/Nestly.apk`.

Install locally with:

```bash
adb install -r release/Nestly-release.apk
```

See `docs/DISTRIBUTION.md` for signing. Do not use the placeholder keystore password for a public release.

**Google Play:** build an **AAB**, target the current Play-required SDK, use a real upload key, complete the Data Safety/Families declarations and validate the foreground-service/location requirements before production release. The APK is useful for internal testing; Play distribution should use the signed AAB.

## Layout

```text
src/
  app/              state, navigation and domain types
  cloud/            Supabase client and cloud synchronisation
  platform/         native device, storage, push and export integrations
  link/             BLE/loopback transport and protocol
  agent/            autonomous child agent and parent link
  screens/          onboarding, parent, child and web screens
  showcase/         desktop design/stakeholder surface
  ui/               shared UI primitives
  art/              reusable SVG artwork
android/
  app/src/main/java/family/nestly/app/
                    native BLE peripheral + foreground service + filtering
supabase/
  migrations/       database schema, RLS, Realtime and billing migrations
  functions/        source for deployed Edge Functions
scripts/             APK, artwork, collateral and two-device verification
marketing/           generated brochure, flyer and flash-card collateral
```

## Testing

```bash
npm test
npm run verify:devices
```

The test suite covers protocol framing, schedules, scan deduplication, agent behaviour, notes and domains. The two-device verifier exercises role gating, pairing and telemetry using the development loopback transport.

Real-phone validation remains important because Android BLE, background execution, permissions and vendor battery optimisation cannot be completely reproduced in a browser.

## Bluetooth link and offline fallback

```text
src/link/
  protocol.ts       UUIDs, message types, chunking/reassembly, geo + time helpers
  transport.ts      Transport interface and framing plumbing
  ble-peripheral.ts child side -> custom Android plugin
  ble-central.ts    parent side -> @capacitor-community/bluetooth-le
  loopback.ts       BroadcastChannel development transport
```

The child peripheral role is native because the Capacitor BLE library provides the central role but not the peripheral/GATT-server role needed for two-phone pairing.

The foreground service keeps advertising and location collection alive when the WebView is backgrounded. Native location buffering prevents JavaScript timer throttling from creating holes in the event history.

Bluetooth remains a fallback rather than the primary connected path. A child without internet can continue applying local rules and recording events; those records can later cross the Bluetooth link.

## Pairing more than one child

A parent can maintain independent links for multiple children. Each child has its own connection, reassembly buffer, acknowledgement cursor and note queue. Event sequence numbers are per child and are deduplicated using `(childId, seq)`.

Cloud enrolment allows a child to remain associated with its household even when the parent and child phones are apart. The child secret is generated during enrolment and stored on the child device.

## Plans

Capacity, not safety features. Every tier is intended to expose the same core safety feature set.

| Plan | Adults | Children |
| --- | ---: | ---: |
| Family | 1 | 2 |
| Pro | 2 | 4 |
| Premium | 3 | 6 |

Cloud billing/entitlements are modelled in Supabase. The production payment integrations are handled server-side; never trust a client-provided entitlement.

## Reports

The Report tab summarises children over 7 / 30 / all days and exports CSV or PDF through the system share sheet. Cloud usage is a daily snapshot; event history remains append-only.

Every export should make its coverage and last-seen state clear. A missing event may mean nothing happened or that the device was offline, so the UI must not turn absence of data into a false assurance.

## Web filtering and activity reporting

### Filtering — local DNS VpnService

An ordinary Android app cannot inspect HTTPS page content. Nestly's filter operates at DNS level, records domain names and can refuse configured domains/categories.

The child is explicitly told:

- domain names are visible, not page contents;
- DNS-over-HTTPS can bypass the filter;
- the child can switch the VPN off, which generates a `filter-off` alert;
- making the filter unremovable requires stronger device-management controls such as Device Owner.

### Reporting — UsageStatsManager

`PACKAGE_USAGE_STATS` is a special permission granted through Android Settings. It provides app foreground usage. Site visits come from the filter's domain tally.

## Known limits

- **Real-phone BLE validation is still required.** Browser/loopback tests cannot prove every Android BLE vendor behaviour.
- **The lock is a soft lock.** Genuine prevention of other apps requires Device Owner enrolment.
- **Filtering is DNS-level.** It does not inspect encrypted page content and can be bypassed by DNS-over-HTTPS or by disabling the VPN where device-management controls do not prevent it.
- **Category lists need a maintained feed** for production-grade coverage.
- **Reboot/background behaviour needs hardware validation** across supported Android versions and manufacturers.
- **Notifications depend on FCM configuration and valid device tokens.** The server prunes invalid tokens but push credentials must be kept current.

## Online service status

The cloud service is now part of the product rather than a future placeholder:

| Capability | Status |
| --- | --- |
| Supabase Auth | Live |
| Household/child data | Live |
| Child direct cloud sync | Live |
| Parent cloud reads | Live |
| Supabase Realtime | Live |
| Child enrolment | Live |
| On-demand locate | Live |
| Notes over cloud | Live |
| Push notification pipeline | Live |
| Web Family Hub | Live |
| Billing functions | Deployed; provider-specific production validation still required |
| Device Owner enforcement | Not yet implemented |
| Production-grade content categorisation | Not yet implemented |
| Public Google Play release | Not yet — internal hardware validation first |

## One deviation from the design

The original design file is a screen gallery and therefore did not need in-product navigation. A real phone does, so `src/ui/TabBar.tsx` provides Home · Map · Limits · Alerts · Hub navigation while retaining the original visual language and design tokens.
