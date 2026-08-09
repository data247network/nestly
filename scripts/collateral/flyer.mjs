// The parent-facing advert flyer: one A4 page, warm, benefit-led, no jargon.
//
// Written for a school-gate handout or a nursery noticeboard, so the promise
// and the price are both readable from arm's length, and the privacy answer —
// the first thing a parent actually asks — is on the page rather than buried.
import { sceneHero, sceneSafe, sceneGently, sceneTogether } from '../../src/art/figures.js'
import { C, docShell, wordmark } from './shared.mjs'

const BENEFITS = [
  {
    scene: sceneSafe(),
    title: "Know they're safe",
    body: 'See where they are on a live map. Get a nudge when they reach school, or leave it.',
  },
  {
    scene: sceneGently(),
    title: 'See their world',
    body: 'A plain-English view of screen time and apps — so you can guide, instead of guess.',
  },
  {
    scene: sceneTogether(),
    title: 'Agree the rules',
    body: 'Set routines like School Hours or Lunch. They run on their phone, with or without signal.',
  },
]

export function flyer() {
  const body = `
  <div class="page flyer">
    <header style="display:flex;justify-content:space-between;align-items:center">
      ${wordmark(24)}
      <span class="pill">Free for your first 2 children</span>
    </header>

    <section style="margin-top:6mm">
      <h1 style="font-size:27pt;line-height:1.04;max-width:150mm">
        Know they're safe.<br>Without hovering.
      </h1>
      <p class="lede" style="margin-top:3mm;max-width:150mm;font-size:11pt">
        A family safety app for parents who want to worry less and nag less.
        Location, screen time and gentle safety alerts — in one calm place your
        whole household can see.
      </p>
    </section>

    <div class="art" style="width:133mm;margin:4mm auto 5mm;border-radius:5mm;overflow:hidden;background:${C.tint}">
      ${sceneHero()}
    </div>

    <section class="grid g3" style="gap:5mm">
      ${BENEFITS.map(
        (b) => `
        <div>
          <div class="art" style="width:25mm;margin-bottom:2mm">${b.scene}</div>
          <h3 style="font-size:12pt;margin-bottom:1mm">${b.title}</h3>
          <p class="small muted" style="margin:0">${b.body}</p>
        </div>`,
      ).join('')}
    </section>

    <section class="card tint" style="margin-top:5mm;padding:5mm;display:flex;gap:5mm;align-items:flex-start">
      <svg width="34" height="34" viewBox="0 0 32 32" style="flex-shrink:0" aria-hidden>
        <path d="M16 2 26 6v10c0 7-5 11-10 13C11 27 6 23 6 16V6z" fill="${C.teal}"/>
        <path d="M11 16l3.5 3.5L21.5 12" stroke="#fff" stroke-width="2.6"
              stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
      <div>
        <h3 style="font-size:12.5pt;margin-bottom:2mm">Your child can see exactly what you can</h3>
        <p class="small" style="margin:0;color:${C.slate}">
          Every Nestly-managed phone shows the child a plain list of what's shared —
          location, screen time and safety alerts. <b>Nestly never reads inside
          their private messages.</b> Trust is the point; secret surveillance
          isn't the product.
        </p>
      </div>
    </section>

    <section style="margin-top:5mm;display:flex;gap:5mm;align-items:stretch">
      <div class="card" style="flex:1;padding:5mm">
        <div class="eyebrow">What it costs</div>
        <div class="display" style="font-size:26pt;margin:1mm 0">Free</div>
        <p class="small muted" style="margin:0">
          One parent and up to two children, with every feature included —
          location, geofences, screen time, web filtering and safety alerts.
          More children are <b>£3.99 a month each</b>.
        </p>
      </div>
      <div class="card outline" style="flex:1;padding:5mm;display:flex;flex-direction:column;justify-content:center">
        <div class="eyebrow">Get started</div>
        <p class="small" style="margin:2mm 0 3mm;color:${C.slate}">
          Install it on both phones, tell each one whose it is, and pair them
          over Bluetooth. About five minutes, no account needed.
        </p>
        <div style="display:flex;align-items:center;gap:4mm">
          ${qrBlock()}
          <div class="small muted">
            <div style="font-weight:800;color:${C.ink}">app.nestly.family</div>
            <div>Android today · iOS coming</div>
          </div>
        </div>
      </div>
    </section>

    <div class="foot">
      <span>Nestly — family safety, gently done.</span>
      <span>hello@nestly.family</span>
    </div>
  </div>`

  return docShell('Nestly — flyer for parents', body, FLYER_CSS)
}

const FLYER_CSS = `
  /* One page, always: this gets printed on an office MFD and handed out. */
  .flyer { padding: 12mm 14mm 12mm; }
  .flyer h1 { color: ${C.ink}; }
  .flyer .foot { left: 14mm; right: 14mm; bottom: 8mm; }
`

/**
 * A placeholder QR block. It is deliberately a fixed pattern rather than a real
 * encoded URL — the download link does not exist yet, and a scannable code that
 * goes nowhere is worse on a printed flyer than an obvious placeholder.
 */
function qrBlock() {
  const rows = [0b1110111, 0b1000101, 0b1011101, 0b1010001, 0b1110110, 0b0001011, 0b1101101]
  const cells = rows
    .flatMap((row, y) =>
      Array.from({ length: 7 }, (_, x) =>
        (row >> (6 - x)) & 1
          ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${C.ink}"/>`
          : '',
      ),
    )
    .join('')
  return `<svg viewBox="0 0 7 7" width="72" height="72" shape-rendering="crispEdges"
    style="border:1px solid ${C.line};border-radius:3mm;padding:2mm;background:#fff" aria-hidden>${cells}</svg>`
}
