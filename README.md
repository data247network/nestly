# Nestly

Family safety, gently done — location, screen time and safety alerts for a
household, built from the `FamilyApp.dc.html` design.

A single install is **either a parent phone or a child phone**, chosen on first
run. The two pair directly over Bluetooth LE; there is no server yet.

## How the two devices work today

Bluetooth only reaches 10–50 metres, so this is deliberately a
**store-and-forward** product, not a live tracker:

- The **child device** runs an agent that keeps working with no parent nearby
  and no internet at all. It samples location, evaluates geofences, decides
  which routine is active, locks itself accordingly, and appends every
  transition to a durable local log.
- The **parent device** picks that backlog up whenever the two phones are near
  each other, acknowledges it, and pushes any rule changes back down.
- The parent app therefore shows **history plus "last synced"**, never a live
  pretence. A rule you change while your child is at school lands when they get
  home.

That is the honest shape of a Bluetooth-only build, and it is what the online
service later replaces with real-time sync.

| Surface | What it does |
| --- | --- |
| **Parent phone** | Pair a device, see last known position, define zones and routines, set emergency numbers, block sites by category or by name, read alerts, the activity trail and the screen-time report, leave notes, lock the phone now |
| **Child phone** | Runs the agent and the web filter; shows the active routine, the lock screen with one-tap emergency calling, an age-appropriateness warning, notes, and a plain statement of everything being shared |
| **Web dashboard** | Design-complete, not wired — it needs the online service |

---

## Running it

```bash
npm install
npm run dev
```

The app picks its surface from the viewport:

- **≥ 1100px wide** → the **showcase**: a sidebar over every screen, each
  rendered inside a real phone or browser frame. This is how the design was
  authored and what a stakeholder walkthrough wants.
- **Narrower, or running natively** → the app **fullscreen**, exactly as it
  ships.

### Running both devices in a browser

You do not need two phones to work on this. The link has a loopback transport
that speaks the identical framed protocol over a `BroadcastChannel`, so two tabs
behave like two paired devices:

```
http://localhost:5174/?device=parent
http://localhost:5174/?device=child
```

The `?device=` parameter matters: both tabs share one origin (they must, for the
BroadcastChannel), so it partitions their stored role and pairing. Without it
they would overwrite each other.

```bash
npm run build        # typecheck + production bundle into dist/
npm test             # protocol, agent and link behaviour
npm run verify:devices   # drives both roles headlessly against the dev server
```

---

## Building the Android APK

The toolchain already installed on this machine under `~/.fbms-android`
(JDK 17 + Android SDK platform-34 + build-tools 34.0.0) is what the build uses.

```bash
npm run android:apk:release     # -> release/Nestly-release.apk, signed
npm run android:apk             # -> release/Nestly.apk, debug-signed
```

Install it with:

```bash
adb install -r release/Nestly-release.apk
```

See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) for signing, and read the
warning there about the placeholder keystore password before this goes to Play.

Capacitor is pinned to the **6.x** line deliberately: it targets compileSdk 34 /
Gradle 8.2 / JDK 17, which matches the installed toolchain. Capacitor 7 would
demand SDK 35 + JDK 21 and break it.

---

## Layout

```
src/
  app/
    types.ts        screen ids, domain types
    nav.ts          screen registry + groups (mirrors the design file)
    store.tsx       the parent's rules; buildPolicy() projects them onto the wire
    PolicyBridge.tsx joins the store to the paired device, both directions
    Router.tsx      screen id -> component
  platform/
    device.tsx      device role, pairing, and the live link
    storage.ts      persistence (Preferences / localStorage)
  link/             the Bluetooth link — see below
  agent/
    childAgent.ts   the child device's autonomous agent
    parentLink.ts   the parent's half: telemetry in, policy out
  screens/          onboarding · setup · parent · child · web
  showcase/         Showcase.tsx · frames.tsx  (desktop review surface)
  ui/               kit.tsx (shared primitives) · TabBar.tsx
  art/
    figures.js      all family illustrations, as SVG-returning functions
    Scene.tsx       thin React wrapper over the above
scripts/
  build-apk.ps1           APK build (JDK 17 + temp-dir workaround)
  android-icons.mjs       launcher icons + splash screens
  render-art.mjs          artwork -> PNG/SVG
  build-collateral.mjs    brochure + flyer + flash-card sheet
  verify-two-devices.mjs  drives both roles headlessly
marketing/                the generated collateral (see below)
```

## Testing

```bash
npm test                 # 58 tests: framing, schedules, scan dedupe, agent, notes, domains
npm run verify:devices   # 11 checks: role gate -> pairing -> real telemetry
```

Two more bugs came out of running the app on a real phone rather than the
loopback, and both are worth remembering:

- **Stale child cards.** `childSeen` appended rather than replaced, so resetting
  the child device — which mints a new device id — left the old card on the
  parent's Home screen forever, showing a battery level from whenever it last
  checked in. Only one device can be paired, so the store now holds exactly one
  child, and unpairing clears the history with it.
- **"Connection timeout" shown as an error.** Out of range is the *normal*
  state for a Bluetooth-only product — a red banner sat on Home all day while
  the child was at school. Connect failures now read as "Not in range right
  now" and retry themselves; only Bluetooth being off or a refused permission
  is an error.

The unit tests cover what cannot be seen on a screen. Two more bugs they caught
are worth knowing about, because both were invisible in the browser:

- **Framing.** `new Array(n)` is sparse, and `Array.some()` skips holes, so a
  message was treated as complete after its first chunk. Single-chunk messages
  hid it entirely — and over real BLE, at a 20-byte chunk size, *every*
  telemetry message is multi-chunk.
- **Shared default state.** The child agent's "nothing stored yet" fallback was
  one shared object that the agent then mutated in place, so a second agent
  inherited the first one's sequence numbers, log and policy.

### The artwork

`src/art/figures.js` is framework-free on purpose. It returns SVG **markup
strings**, so the React app, the brochure generator and the flyer generator all
import the same module — the family on the onboarding flash cards is literally
the same drawing as the family on the flyer.

It is original vector work, which is why it can be bundled into the APK and
printed without a licence question.

```bash
node scripts/render-art.mjs   # -> .art-preview/*.png for a visual check
```

---

## Marketing collateral

```bash
npm run build:collateral   # artwork -> HTML -> PDF -> verify
```

Writes into `marketing/`:

| File | What it is |
| --- | --- |
| `nestly-brochure.{html,pdf}` | 4-page stakeholder / investor brief, A4 |
| `nestly-flyer-for-parents.{html,pdf}` | 1-page parent advert flyer, A4 |
| `nestly-flash-cards.{html,pdf}` | The three onboarding flash cards, A4 sheet |
| `nestly-flashcard-illustrations.pdf` | The three illustrations, 3 pages at 140×140mm |
| `nestly-flashcard-{1,2,3}-*.pdf` | Each illustration on its own 140×140mm page |
| `assets/*.png`, `assets/*.svg` | Raw artwork for decks and social |

The HTML is self-contained — brand fonts embedded as base64 woff2, artwork
inline, no CDN — so it survives being emailed and opened offline, and the PDFs
carry the real Manrope/Baloo 2 typography rather than a system fallback.

PDFs are rendered by `scripts/build-pdf.mjs` through `puppeteer-core` driving
the Chrome already on the machine (set `CHROME_PATH` to override). It passes
`preferCSSPageSize`, so the documents' own `@page { size: A4; margin: 0 }` wins
and the artwork bleeds to the edge.

### Keeping the pages from spilling

`.page` is pinned to exactly 297mm in print. A page whose content lands even a
fraction over that spills into a blank trailing sheet — and because print-media
font metrics differ from screen, that only shows up in the PDF, never in the
browser. Two helpers guard it:

```bash
npm run collateral:measure   # per-page content height and remaining slack
npm run collateral:preview   # screenshots each page under print emulation
```

Keep the reported slack positive. Current: flyer 3.6mm, brochure 14.4 / 4.1 /
6.8 / 49.6mm, flash cards 95.1mm.

> **Two sections of the brochure are deliberately unfinished.** Market sizing
> and traction appear as marked amber placeholders rather than invented numbers.
> Fill them from your own research before showing it to anyone.

> **Two sections of the brochure are deliberately unfinished.** Market sizing
> and traction appear as marked amber placeholders rather than invented numbers.
> Fill them from your own research before showing it to anyone.

---

## The Bluetooth link

```
src/link/
  protocol.ts       UUIDs, message types, chunking/reassembly, geo + time helpers
  transport.ts      the Transport interface and shared framing plumbing
  ble-peripheral.ts child side  -> custom Android plugin
  ble-central.ts    parent side -> @capacitor-community/bluetooth-le
  loopback.ts       BroadcastChannel stand-in for development
android/app/src/main/java/family/nestly/app/
  NestlyLinkPlugin.java        advertiser + GATT server + location buffering
  NestlyForegroundService.java keeps both alive when backgrounded
```

**Why a custom plugin.** `@capacitor-community/bluetooth-le` implements only the
BLE *central* role — it can connect to a peripheral but cannot become one. Two
phones need one of each, so the child's peripheral side (advertise + GATT server)
is written natively.

**Why a foreground service.** Advertising and location updates both stop once
the hosting process is cached. Android 14 also requires the service to declare
`location|connectedDevice` types matching what it actually does.

**Why location is buffered natively.** A backgrounded WebView has its timers
throttled hard, so a JS sampling loop would miss fixes and the child's history
would quietly develop holes. Native collects and buffers; JS drains whenever it
next runs. Every fix keeps its own timestamp, so history stays accurate however
late it is read.

## Pairing more than one child

Supported. An Android central holds roughly **7 concurrent GATT connections**, so
one parent phone carries a realistic household.

A parent device runs one **independent link per paired child** — separate BLE
connection, reassembly buffer, ack cursor and note queue. None of those can be
shared: event sequence numbers are per-child and start at 1 on every device, so
a single global cursor would silently discard a second child's entire history as
"already seen". `store.tsx` scopes de-duplication per `childId` for the same
reason.

Pairings live in `KEYS.pairings`. Installs from before this change are migrated
from the old single `KEYS.pairing` on first run, then that key is deleted so an
unpaired child cannot reappear.

The Device tab lists every paired child; tapping one opens its settings — rename,
colour, its zones and trail, unpair. Unpairing removes only that child's data.

Policy is still household-wide and fans out to every child. Per-child scenarios
are the next step; `Geofence.childId` already exists for it.

### Plans

Capacity, not features. Every tier has the full feature set, because paywalling
a safety feature in a child-safety app is indefensible.

| Plan | Adults | Children |
| --- | --- | --- |
| Family | 1 | 2 |
| Pro | 2 | 4 |
| Premium | 3 | 6 |

The **child limit is enforced** at pairing time. The **adult limit is modelled
but not enforced** — a second parent phone needs the online service to share a
household, so there is nothing to count yet. Billing is not wired either:
choosing a plan changes the limit locally so the behaviour can be exercised.

## Reports

The Report tab summarises each child over 7 / 30 / all days and exports CSV or
PDF through the system share sheet (`platform/exportFile.ts`). jsPDF is imported
dynamically so its ~350 KB stays out of the startup bundle — this app opens on a
locked child's phone, where cold-start time matters.

Every export states its coverage. Over Bluetooth, "nothing happened" and "the
phones were never near each other" produce identical data, and only one of those
is reassuring — so each section carries its child's last-seen time.

## Accounts

There are none, and that is deliberate rather than unfinished. An account is
only useful once there is a server to hold it — today the two phones trust each
other because they were physically paired, which is a stronger guarantee than a
password and needs no personal data at all.

Accounts arrive with the online service, and they buy three things: seeing your
child while you are apart, recovering the pairing if a phone is lost, and more
than one adult on the same family.

## Getting onto Google Play

**Technical work — about a week**

- [ ] Build an **AAB** (`bundleRelease`), not an APK — Play requires it
- [ ] **targetSdk 35** — Play's minimum from Aug 2025; this build is 34, and the
      test phone is already on Android 16
- [ ] Fresh upload keystore with a real password (see `docs/DISTRIBUTION.md`)
- [ ] Crash reporting, and a real support address

**Policy work — the long pole, allow 2–4 weeks including review**

- [ ] **Privacy policy URL** — mandatory, since the app requests location
- [ ] **Data safety form** — declare location; declare that message content is
      *not* collected, which the transparency screen already promises
- [ ] **Families policy** — a child-facing surface puts this app in scope, which
      means a stricter content and ads review
- [ ] **Foreground-service justification** for `location` and `connectedDevice`
- [ ] `ACCESS_FINE_LOCATION` needs a written justification
- [ ] Play's stance on monitoring apps: permitted **only** when marketed as
      parental control and the monitored person is clearly notified. The
      persistent notification and the transparency screen exist for this reason —
      do not remove them to make the app "quieter"

**Blocking before any public release**

- [ ] Two-phone hardware validation of the BLE link
- [ ] Decide what the store listing claims. Today's lock is a *soft* lock; saying
      "block apps" without Device Owner enrolment would be a false claim and a
      refund magnet

Realistically: an internal-testing track in **1–2 weeks**, and production once
the radio is proven on real hardware and the listing claims match what the
build actually enforces.

## Web filtering and activity reporting

Two Android mechanisms, because they are the only supported ones. Neither needs
root; both need the child's own consent, asked for on the child's screen.

### Filtering — a local DNS VpnService

An ordinary app cannot see inside Chrome. `NestlyFilterService` establishes a
VPN that routes **only** a fake DNS server into the tunnel — not the child's
whole connection — reads each lookup, and either answers NXDOMAIN or forwards it
upstream.

```
NestlyFilterService.java  the tunnel and the DNS packet loop
Dns.java                  question parsing, refusal packets, IPv4 checksum
FilterRules.java          categories, seed lists, keyword pass, parent domains
```

What a parent is told, on the screen itself, because it matters:

- It sees **domain names only** — never page content, never anything encrypted.
- **DNS-over-HTTPS bypasses it.** Chrome's "Secure DNS" resolves names itself.
- **The child can switch the VPN off.** Doing so raises a `filter-off` alert
  rather than lapsing quietly. Making it un-removable needs Device Owner.
- Failure is **open**: if the upstream resolver is unreachable the query gets
  SERVFAIL and the browser retries. Failing closed would look like a broken
  internet connection and get the app uninstalled.

Categories are a small seed list plus a conservative keyword pass, deliberately
tuned to under-block: a false block on a school site costs more trust than a
missed site. The production answer is a maintained categorised feed pulled from
the server.

### Reporting — UsageStatsManager

`PACKAGE_USAGE_STATS` is a *special* permission: it cannot be requested with a
runtime prompt, only granted in Settings. The child's screen detects it, explains
why, and opens the right Settings page. It gives real per-app foreground minutes,
bucketed so social-media hours can be reported separately.

Site visits come from the filter's own tally, so browsing history and blocking
share one source.

## Known limits of this build

Stated plainly, because each is a real gap rather than a rough edge:

- **The BLE radio path is untested.** All the logic above it is covered by tests
  and by the two-device check, but phone-to-phone BLE needs two Android phones.
  Nothing here has run on real hardware.
- **The lock is a soft lock.** The child device shows its lock screen, and that
  is all it can do — genuinely preventing other apps needs Device Owner
  enrolment. A determined child can press Home. Emergency contacts on the lock
  screen work regardless, since they are stored on the device.
- **Filtering is DNS-level.** Domain names only, bypassable by DNS-over-HTTPS,
  and switchable off by the child. See above — all three are surfaced in the app
  rather than hidden.
- **The category lists are a seed.** A handful of well-known domains plus
  keywords. Real coverage needs a maintained feed.
- **The agent does not survive a reboot.** Restarting it needs a boot receiver
  that can start the link without the activity.
- **Notes are not instant messaging.** They queue and cross when the phones are
  near each other. Each note shows its real state — "waiting to send" until the
  other phone has acknowledged storing it — rather than a tick that means
  "probably".

## Where the online service plugs in

| Today | What replaces it |
| --- | --- |
| `LoopbackTransport` / BLE transports | A synced transport; `Transport` in `src/link/transport.ts` is the seam |
| Store-and-forward backlog | Real-time push, with the same event log as the fallback |
| `MapCanvas` in `src/ui/kit.tsx` | A real tile layer; positions are already real coordinates |
| Pairing over BLE | Account-based enrolment with a server-minted device token |
| Child-side limits | Android **Device Owner** enrolment — what makes them un-removable |
| Acoustic alert screen | An on-device audio classifier behind the flow that already exists |

---

## One deviation from the design

The design file is a **screen gallery** — it navigates through its own sidebar,
so it never needed in-product navigation. A real phone does: there has to be a
way to get from Home to Limits.

`src/ui/TabBar.tsx` adds a five-item bottom tab bar (Home · Map · Limits ·
Alerts · Hub), drawn in the design's existing visual language. Detail screens
keep their parent tab lit rather than clearing the bar. Nothing else departs
from the source design; the colour tokens in `tailwind.config.js` are lifted
from it verbatim.
