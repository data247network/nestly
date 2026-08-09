# Nestly — launch plan and production stack

Written against the build as it stands: two Android phones talking over
Bluetooth, no server, no accounts, no payments. Everything below is what has to
change for a real Play Store launch.

---

## 1. Billing: the Play Store problem, and the options

**The rule.** Google Play requires Play Billing for any purchase that unlocks
features *in the app*. Charging on your own website for something the app then
enables is a policy violation, and it is enforced — this is exactly what Epic
and Match litigated over. Nestly's current design (extra children unlocked by a
web payment) would be rejected.

There is no way to keep 100% of revenue while unlocking in-app features. The
question is which trade you make.

### Option A — Play Billing, and price it in *(recommended to launch)*

Integrate Play Billing and treat the fee as a cost of sale.

- **Fee: 15%** on the first $1M/year, 30% above it. Most likely you stay at 15%
  indefinitely.
- Also: subscriptions that a user has held for 12+ months drop to 15%
  regardless.
- **Why this first:** it is the only option that cannot get you removed, it is
  the fastest to ship, and at £3.99/child the absolute fee is small. Trying to
  dodge 15% before you have any customers is optimising the wrong thing.

### Option B — External offer / alternative billing

In the UK and EEA, Play now permits linking out to your own payment page under
the *Alternative Billing* and *External Offers* programmes.

- Fee drops to roughly **11–20%** — the saving is far smaller than people
  expect, because Google still charges a service fee.
- Requires a separate application, per-region eligibility, and extra reporting.
- **Not worth it at launch.** Revisit when subscription revenue is large enough
  that 4–5 points matters.

### Option C — Make the paid tier genuinely non-app

Play Billing is only required for *in-app* functionality. It does **not** apply
to a purchase that unlocks something outside the app — the classic carve-out is
a web service the app happens to display.

Concretely for Nestly: if the paid tier were **the web dashboard and the family
cloud account** — which is where multi-parent, remote (non-Bluetooth) tracking
and history retention live — that is a service sold on the web, and the Android
app is one client of it. Spotify and Netflix operate exactly this way.

- **This is the strategically interesting option**, because it matches where the
  product is going anyway: the online service is what a larger family actually
  pays for.
- It requires the backend to exist first, and the app must not up-sell or link
  to the payment page (Play forbids "scarlet letter" steering).
- Risk: if the paid tier obviously unlocks *app* behaviour, it reads as
  circumvention. The split has to be real.

### Recommendation

**Launch on Option A.** Ship Play Billing, absorb 15%, get customers.

**Design toward Option C.** When the online service lands, the natural product
boundary — local Bluetooth free, cloud account paid — also happens to be the
compliant one. Do not contort the product to reach it; if it lands there
honestly, take it.

Do **not** pursue Option B unless subscriptions exceed roughly £100k/year.

---

## 2. What you need to obtain

These need your identity, your company and your bank details, so they are yours
to create — I cannot do them for you.

| # | What | Cost | Lead time | Notes |
| --- | --- | --- | --- | --- |
| 1 | Google Play Developer account | $25 once | 1–3 days | ID verification. **Register as an organisation, not an individual** — needs a D-U-N-S number, which itself takes ~2 weeks, so start here |
| 2 | Google Payments merchant profile | — | 1–2 days | Bank account + tax details. Required before any paid product |
| 3 | A company entity | varies | — | Play now shows the developer's legal name and address publicly. An individual account exposes your home address |
| 4 | Privacy policy URL | hosting | — | **Mandatory**, you request location |
| 5 | Terms of service URL | hosting | — | Required once you take payment |
| 6 | Support email + website | — | — | Shown on the store listing |
| 7 | A domain | ~£10/yr | — | `nestly.family` for the above, and later the API |

Not needed yet: Apple Developer ($99/yr) — only when iOS starts.

---

## 3. Technical work before submission

Ordered by what blocks what.

### Blocking — cannot submit without

1. **A real signing keystore.** The current one has a placeholder password
   committed in the repo. Generate a new one, back it up in two places. Losing
   it means you can never update the app.
2. **App Bundle (.aab), not APK.** One line change to the build script.
3. **Backend + accounts.** Play requires server-side verification of
   subscriptions; entitlement cannot live only on the phone or it is trivially
   bypassed. This is the single largest item.
4. **Play Billing integration**, once (3) exists.
5. **Data safety declaration.** Declare location collection; declare that
   message content is *not* collected. Must match actual behaviour — a mismatch
   is a suspension risk.
6. **Location permission declaration + demo video** showing the in-app use.
7. **Families policy compliance.** The child-facing surface puts Nestly in
   scope. Brings a content rating questionnaire, stricter ads/analytics rules,
   and a slower first review.

### Strongly recommended

8. **Crash reporting** (Firebase Crashlytics or Sentry). Shipping to strangers
   without it means finding out from one-star reviews.
9. **Delete-account flow.** Play requires an in-app *and* web route to delete an
   account once accounts exist.
10. **Foreground-service justification.** Android 14 scrutinises `location` and
    `connectedDevice` types; be ready to explain both.
11. **Closed testing track** — Play now requires 12 testers for 14 continuous
    days before a personal account can go to production. Start this early; it is
    a wall-clock delay you cannot compress.

### The honest blockers in the product

12. **Scenario enforcement is soft.** The child app shows a lock screen; it does
    not prevent other apps opening. Real enforcement needs Device Owner
    enrolment. Marketing must not claim more than this does.
13. **Acoustic safety alerts do not exist.** The screen and the alert flow are
    built; there is no classifier behind them. Either build it or remove the
    claim before launch — shipping it as-is would be a false safety promise.

---

## 4. Realistic timeline

| Phase | Duration | Notes |
| --- | --- | --- |
| Accounts + D-U-N-S | 2–3 weeks | Start immediately; mostly waiting |
| Backend + accounts | 4–8 weeks | The critical path |
| Play Billing | 1 week | After backend |
| Store assets, policies, declarations | 1 week | Can run in parallel |
| Closed testing (12 testers × 14 days) | 3 weeks | Cannot be compressed |
| First review (Families) | 1–3 weeks | Slower than a normal app |

**Earliest realistic launch: ~3 months.** The backend and the 14-day testing
window dominate; nothing else is close.

A **staged alternative**: ship a free, Bluetooth-only version to Play in ~4–6
weeks (no billing, no backend, no paid tier). It gets you a live listing,
reviews, testers and the 14-day requirement satisfied, while the backend is
built. Add subscriptions in v2.

---

## 5. Production tech stack

### Stays as it is

| Layer | Choice | Why |
| --- | --- | --- |
| App | React 18 + TypeScript + Tailwind | Works, one codebase for both roles |
| Native shell | Capacitor 6 | Pinned to compileSdk 34 / JDK 17 |
| Device link | Custom BLE plugin (Java) | Peripheral role has no community plugin |
| Local storage | Capacitor Preferences | Fine for policy + logs |
| Tests | Vitest | 73 tests |

### To be built

| Layer | Recommendation | Why this one |
| --- | --- | --- |
| **API** | Node + TypeScript (Fastify or NestJS) | Same language as the app; types shared with `protocol.ts` |
| **Database** | Postgres | Relational household/child/policy data; nothing here wants a document store |
| **Hosting** | Fly.io or Railway to start; AWS later | Cheap, fast to deploy, EU regions for GDPR |
| **Auth** | Supabase Auth or Auth0 | Do not hand-roll password reset and session security |
| **Push** | Firebase Cloud Messaging | The only real option on Android; needed for remote alerts |
| **Realtime** | WebSocket, or FCM data messages | Replaces "wait until Bluetooth range" |
| **Maps** | Mapbox or Google Maps SDK | Replaces the stylised map canvas |
| **Background location** | Fused Location + geofencing API | Battery-efficient; replaces the current LocationManager polling |
| **Billing** | Play Billing + server receipt validation | Entitlement must be server-side |
| **Errors** | Sentry | Both app and API |
| **Analytics** | PostHog or Firebase | Must be Families-policy compliant |
| **CI/CD** | GitHub Actions | Build AAB, run tests, upload to Play track |

### Functions to build server-side

1. **Accounts** — sign up, sign in, reset, delete. Household as the top object.
2. **Household membership** — multiple adults on one household. This is what
   makes the Pro/Premium adult limits real; today they are modelled only.
3. **Device registry** — enrolment tokens, so pairing is not purely physical.
4. **Policy sync** — the same `Policy` document, versioned, over HTTP instead of
   BLE. `protocol.ts` is already the schema.
5. **Event ingest** — child events and telemetry, retained per plan.
6. **Remote location** — the actual reason to pay: seeing your child when you
   are not next to them.
7. **Push notifications** — alerts that arrive immediately, not on next contact.
8. **Subscription entitlement** — validate Play receipts, expose plan limits.
9. **Reporting** — move report generation server-side so it covers history the
   phone has discarded.
10. **Admin/back-office** — plan definitions, customer support, refunds. This is
    where plan *editing* belongs, not in the parent app.

### What the online service changes for the product

Bluetooth store-and-forward stops being the mechanism and becomes the
**offline fallback** — which is genuinely valuable, and a real differentiator.
The child device keeps enforcing routines and logging with no signal at all;
the cloud simply means the parent does not have to wait to see it.

---

## 6. Immediate next steps

1. Register the Play organisation account and start the D-U-N-S request — it is
   the longest lead time and blocks everything.
2. Buy the domain; publish a privacy policy and terms.
3. Decide free vs paid at launch. Recommendation: **launch free, Bluetooth-only**,
   add billing in v2 with the backend.
4. Replace the signing keystore.
5. Switch the build to AAB.
6. Recruit 12 closed testers — the 14-day clock is wall-clock and cannot be
   compressed.
