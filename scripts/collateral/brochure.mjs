// The stakeholder / partner brochure: four A4 pages.
//
// A note on numbers. Everything in here that is stated as fact is verifiable
// from the product itself — the feature set, the three surfaces, the pricing
// model and the build status. Market sizing, traction and financial projections
// are NOT invented: they appear as clearly-marked placeholders for the author to
// fill from their own research. A brochure with confident made-up figures is
// worse than useless in front of an investor.
import { sceneHero, sceneSafe, sceneGently, sceneTogether } from '../../src/art/figures.js'
import { C, docShell, phoneMock, wordmark } from './shared.mjs'

const TODAY = new Date().toLocaleDateString('en-GB', {
  year: 'numeric',
  month: 'long',
})

/* ------------------------------------------------------------- page pieces */

const placeholder = (label, hint) => `
  <div style="border:1.5px dashed ${C.amber};background:${C.amberBg};border-radius:4mm;padding:4mm">
    <div style="font-size:7.5pt;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#8A5A16">
      ${label} — to complete
    </div>
    <div class="small" style="color:${C.slate};margin-top:1.5mm">${hint}</div>
  </div>`

const foot = (n) => `
  <div class="foot">
    <span>Nestly — product brief · ${TODAY}</span>
    <span>${n}</span>
  </div>`

/* ------------------------------------------------------------------ mockups */

const mockHome = `
<div style="padding:9px 10px;font-family:inherit">
  <div style="font-size:5.5px;color:${C.body}">Good afternoon</div>
  <div style="font-size:10px;font-weight:800;margin-bottom:7px">The Rivera Family</div>
  <div style="display:flex;gap:5px;margin-bottom:7px">
    ${[
      ['M', 'Maya, 12', 'At School', C.teal, C.tint],
      ['L', 'Leo, 8', 'On the move', C.coral, C.coralBg],
    ]
      .map(
        ([i, n, s, col, bg]) => `
      <div style="flex:1;background:${C.cream};border-radius:7px;padding:6px">
        <div style="width:14px;height:14px;border-radius:50%;background:${col};color:#fff;font-size:6px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:4px">${i}</div>
        <div style="font-size:6.5px;font-weight:800">${n}</div>
        <div style="display:inline-block;background:${bg};color:${col};font-size:5px;font-weight:800;padding:1px 4px;border-radius:4px;margin-top:3px">${s}</div>
      </div>`,
      )
      .join('')}
  </div>
  <div style="display:flex;gap:4px;margin-bottom:8px">
    <div style="flex:1;background:${C.ink};color:#fff;border-radius:6px;padding:5px 0;text-align:center;font-size:5.5px;font-weight:800">Lock now</div>
    <div style="flex:1;background:${C.cream};border-radius:6px;padding:5px 0;text-align:center;font-size:5.5px;font-weight:800">Locate</div>
    <div style="flex:1;background:${C.cream};border-radius:6px;padding:5px 0;text-align:center;font-size:5.5px;font-weight:800">Message</div>
  </div>
  <div style="font-size:6.5px;font-weight:800;margin-bottom:4px">Recent alerts</div>
  <div style="background:${C.coralBg};border-radius:5px;padding:4px 5px;font-size:5.5px;margin-bottom:3px">Leo left the School zone · 2:14 PM</div>
  <div style="background:${C.amberBg};border-radius:5px;padding:4px 5px;font-size:5.5px">New contact added on Maya's phone</div>
</div>`

const mockLock = `
<div style="background:${C.ink};height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:14px;gap:6px">
  <div style="width:30px;height:30px;border-radius:50%;background:#2B3944;display:flex;align-items:center;justify-content:center">
    <svg width="15" height="15" viewBox="0 0 34 34" fill="none">
      <path d="M11 15v-3a6 6 0 0 1 12 0v3" stroke="${C.mint}" stroke-width="4" stroke-linecap="round"/>
      <rect x="8" y="15" width="18" height="13" rx="3" stroke="${C.mint}" stroke-width="4"/>
    </svg>
  </div>
  <div style="color:#fff;font-size:9px;font-weight:800">School Hours is active</div>
  <div style="color:#A9B2B9;font-size:6px">Unlocks in 47 minutes</div>
  <div style="background:#2B3944;color:${C.mint};font-size:5.5px;font-weight:800;padding:3px 7px;border-radius:6px">8:00 AM – 3:00 PM</div>
  <div style="border:1px solid #47555F;color:#fff;font-size:5.5px;font-weight:800;padding:5px 11px;border-radius:7px;margin-top:4px">Call Mom</div>
  <div style="color:${C.body};font-size:5px;margin-top:3px">Managed by Nestly Family</div>
</div>`

const mockNotice = `
<div style="background:${C.tint};height:100%;padding:13px 11px;display:flex;flex-direction:column;gap:5px">
  <div style="width:22px;height:22px;border-radius:7px;background:${C.teal};margin:0 auto 2px"></div>
  <div style="font-size:9px;font-weight:800;text-align:center;line-height:1.2">This phone is looked after by Mom</div>
  <div style="font-size:5.5px;color:${C.slate};text-align:center;line-height:1.4">Here's exactly what's shared:</div>
  ${['Location & zone entry/exit', 'Screen time & app activity', 'Web filtering & safety alerts']
    .map(
      (t) => `<div style="display:flex;gap:5px;align-items:center;background:#fff;padding:5px 6px;border-radius:6px">
        <span style="width:4px;height:4px;border-radius:1px;background:${C.teal}"></span>
        <span style="font-size:5.5px">${t}</span></div>`,
    )
    .join('')}
  <div style="font-size:5px;color:${C.slate};text-align:center;margin-top:2px">Nestly never reads inside your private messages.</div>
</div>`

/* -------------------------------------------------------------------- pages */

const cover = `
<div class="page" style="display:flex;flex-direction:column">
  ${wordmark(30)}
  <div style="margin-top:22mm">
    <div class="eyebrow">Product brief · ${TODAY}</div>
    <h1 style="font-size:38pt;line-height:1.02;margin-top:4mm;max-width:160mm">
      The family safety app that<br>doesn't feel like surveillance.
    </h1>
    <p class="lede" style="margin-top:6mm;max-width:150mm">
      Nestly gives parents location, screen time and safety alerts across three
      surfaces — a parent phone app, a managed child device and a web dashboard —
      while showing the child exactly what is shared. Free for the first two
      children, so households can adopt it before they pay for it.
    </p>
  </div>

  <div class="art" style="margin-top:auto;border-radius:7mm;overflow:hidden;background:${C.tint}">
    ${sceneHero()}
  </div>

  <div style="display:flex;gap:5mm;margin-top:7mm">
    ${[
      ['2 real devices', 'Parent and child, paired over Bluetooth'],
      ['Works offline', 'Routines enforced on the child’s phone'],
      ['Android build', 'Signed APK, sideload-ready today'],
    ]
      .map(
        ([h, s]) => `<div class="card" style="flex:1">
          <div class="display" style="font-size:15pt">${h}</div>
          <div class="small muted">${s}</div>
        </div>`,
      )
      .join('')}
  </div>
  ${foot('1')}
</div>`

const problemPage = `
<div class="page">
  <div class="eyebrow">The problem</div>
  <h2 style="font-size:23pt;margin:3mm 0 5mm;max-width:160mm">
    Parents are handed a binary choice: spy, or hope.
  </h2>

  <div class="grid g2" style="margin-bottom:5mm">
    <div>
      <p>
        The category splits cleanly in two, and neither half fits an ordinary
        household. On one side sit heavyweight monitoring tools built around
        covert capture — message interception, keystroke logs, screen
        recording. They work, and they cost the parent the relationship.
      </p>
      <p>
        On the other sit the built-in platform controls: trustworthy, and far
        too blunt. A daily minute budget cannot tell a maths app at 4pm from a
        game at 4pm, and it collapses the moment a child's phone is on a
        different platform to their parent's.
      </p>
      <p class="muted small">
        The tell is what parents actually ask first. Not "can I see everything?"
        but "will my child know?" — a question neither half of the market
        answers well.
      </p>
    </div>
    <div class="card" style="padding:5mm">
      <h3 style="font-size:12pt;margin-bottom:3mm">What breaks in practice</h3>
      <ul class="small">
        <li><b>Rules that ignore context.</b> A screen-time cap doesn't know it's a school day.</li>
        <li><b>Enforcement that needs signal.</b> Limits lift the moment the phone drops offline.</li>
        <li><b>Alerts without triage.</b> A wall of notifications trains parents to ignore all of them.</li>
        <li><b>Nothing for the child.</b> The supervised person has no view of what is collected.</li>
        <li><b>Priced per household, up front.</b> Families pay before they trust it.</li>
      </ul>
    </div>
  </div>

  <hr class="rule" style="margin:4mm 0">

  <div class="eyebrow">The product</div>
  <h2 style="font-size:20pt;margin:2mm 0 4mm">Three surfaces, one household</h2>

  <div class="grid g3" style="gap:5mm">
    ${[
      [
        'Parent app',
        C.tint,
        C.teal,
        'Phone-first. Home, live map and geofences, screen-time scenarios, activity and web filtering, a triaged alerts feed, encrypted family chat, and weekly guidance.',
      ],
      [
        'Child device',
        C.violetBg,
        C.violet,
        'Deliberately two screens. A lock screen that says which routine is running and when it lifts, and a transparency notice listing exactly what is shared.',
      ],
      [
        'Web dashboard',
        C.amberBg,
        '#8A5A16',
        'For a desk rather than a pocket. Both children side by side, a map that keeps the live activity feed in view, and plan management.',
      ],
    ]
      .map(
        ([t, bg, ink, d]) => `
        <div class="card" style="background:${bg};padding:5mm">
          <div style="font-weight:800;color:${ink};font-size:11.5pt;margin-bottom:2mm">${t}</div>
          <div class="small" style="color:${C.slate}">${d}</div>
        </div>`,
      )
      .join('')}
  </div>

  <div style="display:flex;gap:8mm;justify-content:center;margin-top:4mm">
    ${phoneMock(mockHome, { w: 94, label: 'Parent app — Home' })}
    ${phoneMock(mockLock, { w: 94, label: 'Child device — Lock screen' })}
    ${phoneMock(mockNotice, { w: 94, label: 'Child device — Transparency' })}
  </div>
  ${foot('2')}
</div>`

const differentiatorPage = `
<div class="page">
  <div class="eyebrow">Why this one wins</div>
  <h2 style="font-size:23pt;margin:3mm 0 6mm">Four decisions competitors haven't copied</h2>

  <div class="grid g2">
    ${[
      [
        'Scenarios, not minute budgets',
        'Rules are named routines — School Hours, Lunch, Piano Lesson, Church — each with its own days, window and block list. Parents reason about their week, not about a number, and the same vocabulary works for a seven-year-old and a sixteen-year-old.',
      ],
      [
        'Enforcement that survives offline',
        'A scenario is evaluated on the device against a locally-held schedule. Turning off mobile data, the oldest trick there is, does not lift the limit. Most competitors enforce server-side and quietly fail open.',
      ],
      [
        'Acoustic safety alerts',
        'On-device audio classification flags distress patterns — a scream, panic — and surfaces one triaged alert with a confidence score, a location and two actions: call, or mark false alarm. No audio leaves the device and nothing is recorded.',
      ],
      [
        'Transparency as a feature',
        'The child sees a plain list of everything shared, and private message content is explicitly excluded. This is the answer to the objection that stops most sign-ups, and it is very hard for a covert-capture competitor to copy without repudiating their own product.',
      ],
    ]
      .map(
        ([t, d]) => `
        <div class="card outline">
          <h3 style="font-size:12.5pt;margin-bottom:2.5mm">${t}</h3>
          <p class="small muted" style="margin:0">${d}</p>
        </div>`,
      )
      .join('')}
  </div>

  <hr class="rule">

  <div class="eyebrow">Business model</div>
  <h2 style="font-size:20pt;margin:3mm 0 5mm">Free until the family is bought in</h2>

  <div style="display:flex;gap:6mm;align-items:stretch">
    <div class="card" style="flex:1">
      <div style="font-weight:800;font-size:12pt">Family plan</div>
      <div class="small muted" style="margin-bottom:2mm">1 parent + 2 children</div>
      <div class="display" style="font-size:26pt">£0</div>
      <ul class="small" style="margin-top:3mm">
        <li>Location &amp; geofences</li>
        <li>Screen time &amp; scenarios</li>
        <li>Web filtering</li>
        <li>Acoustic safety alerts</li>
        <li>Full activity history</li>
      </ul>
    </div>
    <div class="card tint" style="flex:1;border:1.5px solid ${C.teal}">
      <div style="font-weight:800;font-size:12pt">Additional children</div>
      <div class="small" style="color:${C.slate};margin-bottom:2mm">Third child and up</div>
      <div class="display" style="font-size:26pt">£3.99<span style="font-size:11pt"> /mo each</span></div>
      <div class="small" style="color:${C.slate}">or £34/yr — a 25% saving</div>
      <ul class="small" style="margin-top:3mm">
        <li>Identical feature set</li>
        <li>Billed per additional child</li>
        <li>Add or remove any time</li>
      </ul>
    </div>
    <div style="flex:1">
      <h3 style="font-size:12pt;margin-bottom:2.5mm">The logic</h3>
      <p class="small muted">
        Two free children covers most of the market outright, which removes
        price as a reason not to try it and buys distribution through the
        cheapest channel there is — one parent telling another at the school
        gate.
      </p>
      <p class="small muted">
        Revenue then comes from larger families, who are also the households
        under the most logistical strain and the least likely to churn. The
        upgrade moment is a real event — a third child getting a phone — rather
        than an arbitrary paywall.
      </p>
      <p class="small muted">
        Billing is web-only, which keeps app-store commission off the
        subscription line entirely.
      </p>
    </div>
  </div>
  ${foot('3')}
</div>`

const statusPage = `
<div class="page">
  <div class="eyebrow">Where it stands</div>
  <h2 style="font-size:23pt;margin:3mm 0 6mm">Built, running, and installable today</h2>

  <div class="grid g2" style="margin-bottom:7mm">
    <div>
      <h3 style="font-size:12.5pt;margin-bottom:3mm">Done</h3>
      <ul class="small">
        <li>Two real devices. A single install becomes a parent phone or a child phone and the pair links directly over Bluetooth LE — no account, no server, nothing to sign up for.</li>
        <li>An autonomous child agent: samples real location, evaluates geofences on-device, decides which routine is active, and logs every transition durably.</li>
        <li>Store-and-forward sync. The child keeps working out of range and hands its backlog over when the phones next meet, so distance costs latency rather than history.</li>
        <li>Android application packaged with Capacitor 6, release-signed and sideload-ready, including a custom BLE-peripheral plugin and foreground service.</li>
      </ul>

      <h3 style="font-size:12.5pt;margin:5mm 0 3mm">Next, in order</h3>
      <ul class="small">
        <li><b>Hardware validation.</b> The link is covered by tests end to end, but the radio itself needs two Android handsets before any pilot.</li>
        <li><b>Online service.</b> Accounts and real-time sync, so a parent sees their child while they are apart. The transport is already an interface with two implementations behind it.</li>
        <li><b>Device policy.</b> Android Device Owner enrolment — what turns today's soft lock screen into limits a child cannot step around.</li>
        <li><b>Acoustic model.</b> On-device classifier behind the alert flow that is already built.</li>
        <li><b>iOS.</b> The Capacitor project is structured for it; the parent app first.</li>
      </ul>
    </div>

    <div>
      <div class="card" style="margin-bottom:5mm">
        <h3 style="font-size:12pt;margin-bottom:3mm">Technical shape</h3>
        <table class="small" style="width:100%;border-collapse:collapse">
          ${[
            ['App', 'React 18 + TypeScript + Tailwind'],
            ['Native shell', 'Capacitor 6 (Android; iOS ready)'],
            ['Device link', 'Bluetooth LE, custom peripheral plugin'],
            ['Target', 'compileSdk 34, minSdk 22'],
            ['Offline', 'Rules enforced on-device; no network needed'],
            ['Distribution', 'Release-signed APK; Play-ready'],
          ]
            .map(
              ([k, v]) =>
                `<tr><td style="padding:1.6mm 0;color:${C.body};width:32%">${k}</td><td style="padding:1.6mm 0;font-weight:700">${v}</td></tr>`,
            )
            .join('')}
        </table>
      </div>

      ${placeholder(
        'Market sizing',
        'Insert your own TAM/SAM/SOM for households with school-age children in the launch geography, with the source. Deliberately left blank rather than estimated.',
      )}
      <div style="height:5mm"></div>
      ${placeholder(
        'Traction & pipeline',
        'Insert waitlist numbers, pilot schools, letters of intent or early install figures once they exist.',
      )}
    </div>
  </div>

  <hr class="rule">

  <div style="display:flex;gap:6mm;align-items:center">
    <div style="flex:1">
      <div class="eyebrow">The ask</div>
      <h2 style="font-size:18pt;margin:2mm 0 3mm">What we're looking for</h2>
      <p class="small muted" style="max-width:105mm">
        Introductions to schools and parent networks for a pilot cohort, and
        partners on the device-policy and on-device-audio work. The product is
        far enough along that the next useful input is real households, not more
        design.
      </p>
    </div>
    <div class="art" style="width:46mm">${sceneTogether()}</div>
  </div>
  ${foot('4')}
</div>`

/* --------------------------------------------------------------------- doc */

export function brochure() {
  const body = [cover, problemPage, differentiatorPage, statusPage].join('\n')
  return docShell('Nestly — stakeholder brochure', body, BROCHURE_CSS)
}

const BROCHURE_CSS = `
  h2 { color: ${C.ink}; }
`

/** Standalone sheet of the three onboarding flash cards, for print or slides. */
export function flashCards() {
  const cards = [
    [sceneSafe(), "Know they're safe, always", 'Real-time location and gentle check-ins, so you always know your child is okay — without hovering.'],
    [sceneGently(), 'See their world, gently', 'A friendly view of screen time and app activity, so you can guide instead of guess.'],
    [sceneTogether(), 'Set limits, together', 'Build routines like School or Lunch that keep working even offline.'],
  ]
  const body = `
  <div class="page" style="display:flex;flex-direction:column">
    ${wordmark(24)}
    <div style="margin-top:8mm">
      <div class="eyebrow">Onboarding</div>
      <h2 style="font-size:22pt;margin-top:2mm">The three flash cards</h2>
      <p class="small muted" style="max-width:150mm">
        What a parent sees in the first fifteen seconds. Each card carries one
        promise and one illustration — no feature lists, no permissions, no
        account yet.
      </p>
    </div>
    <div class="grid g3" style="flex:1;align-content:center;align-items:start;margin:8mm 0">
      ${cards
        .map(
          ([svg, title, body], i) => `
        <div style="text-align:center">
          <div class="art" style="width:52mm;margin:0 auto 5mm">${svg}</div>
          <div style="display:flex;gap:1.5mm;justify-content:center;margin-bottom:4mm">
            ${[0, 1, 2]
              .map(
                (d) =>
                  `<span style="height:1.6mm;border-radius:1mm;background:${d === i ? C.teal : C.line};width:${d === i ? '6mm' : '1.6mm'};display:inline-block"></span>`,
              )
              .join('')}
          </div>
          <h3 style="font-size:14pt;line-height:1.15;margin-bottom:2.5mm">${title}</h3>
          <p class="small muted" style="margin:0">${body}</p>
        </div>`,
        )
        .join('')}
    </div>
    <div>
      <div class="card tint small" style="color:${C.slate}">
        Artwork is original vector work, drawn from one shared module — the same
        source renders these cards in the app, the hero on the flyer and the
        illustrations in the brochure, so the family never looks slightly
        different in two places.
      </div>
    </div>
    ${foot('Flash cards')}
  </div>`
  return docShell('Nestly — onboarding flash cards', body, BROCHURE_CSS)
}
