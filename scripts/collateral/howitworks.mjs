// "How it works" — the guide handed to parents to persuade them to buy.
//
// Every screen in it is a real capture from a real phone (scripts/capture-screens.ps1),
// not a mockup. A guide that shows screens the app does not render is a promise
// you break on day one, and this is the document a parent judges the product by
// before they have used it.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { sceneSafe, sceneGently, sceneTogether, sceneHero } from '../../src/art/figures.js'
import { C, docShell, wordmark } from './shared.mjs'

const TODAY = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })

/** Inlines a captured PNG, so the file survives being emailed. */
function shot(role, name) {
  const path = fileURLToPath(new URL(`../../docs/screens/${role}/${name}.png`, import.meta.url))
  if (!existsSync(path)) return null
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`
}

/** A phone-shaped frame around a real screenshot. */
function phone(role, name, caption, w = 148) {
  const src = shot(role, name)
  if (!src) {
    return `<figure style="margin:0;text-align:center">
      <div style="width:${w}px;height:${Math.round(w * 2.05)}px;border:1.5px dashed ${C.line2};border-radius:${w * 0.13}px;display:flex;align-items:center;justify-content:center;margin:0 auto;color:${C.muted};font-size:8pt;padding:4mm;text-align:center">
        ${name}<br>not captured yet
      </div>
      <figcaption style="font-size:8pt;color:${C.body};margin-top:2.5mm;font-weight:700">${caption}</figcaption>
    </figure>`
  }
  return `<figure style="margin:0;text-align:center">
    <div style="width:${w}px;background:#12181C;border-radius:${w * 0.13}px;padding:${w * 0.03}px;margin:0 auto;box-shadow:0 8px 20px -8px rgba(30,42,50,0.4)">
      <img src="${src}" style="width:100%;display:block;border-radius:${w * 0.1}px"/>
    </div>
    <figcaption style="font-size:8pt;color:${C.body};margin-top:2.5mm;font-weight:700">${caption}</figcaption>
  </figure>`
}

const foot = (n) => `
  <div class="foot">
    <span>Nestly — how it works · ${TODAY}</span>
    <span>${n}</span>
  </div>`

/* --------------------------------------------------------------- page 1 -- */

const cover = `
<div class="page" style="display:flex;flex-direction:column">
  ${wordmark(30)}

  <div style="margin-top:16mm">
    <div class="eyebrow">A guide for parents</div>
    <h1 style="font-size:34pt;line-height:1.05;margin-top:4mm;max-width:150mm">
      How Nestly works
    </h1>
    <p class="lede" style="margin-top:5mm;max-width:150mm">
      Two phones, yours and your child's. Nestly keeps them gently connected —
      so you know they're okay, their routines hold, and they can always reach
      you. No hovering, and nothing hidden from them.
    </p>
  </div>

  <div class="art" style="margin-top:8mm;border-radius:6mm;overflow:hidden;background:${C.tint}">
    ${sceneHero()}
  </div>

  <div class="grid g3" style="margin-top:auto;gap:5mm">
    ${[
      ['1 · Set it up', 'Five minutes per phone. No account needed to start.'],
      ['2 · Agree the rules', 'Routines, zones and reminders — visible to both of you.'],
      ['3 · Get on with your day', 'Their phone keeps working even with no signal.'],
    ]
      .map(
        ([h, s]) => `<div class="card" style="padding:5mm">
          <div style="font-weight:800;font-size:11pt;color:${C.teal}">${h}</div>
          <div class="small muted" style="margin-top:1.5mm">${s}</div>
        </div>`,
      )
      .join('')}
  </div>
  ${foot('1')}
</div>`

/* --------------------------------------------------------------- page 2 -- */

const yourPhone = `
<div class="page">
  <div class="eyebrow">On your phone</div>
  <h2 style="font-size:23pt;margin:3mm 0 4mm">Everything in one calm place</h2>
  <p class="small muted" style="max-width:150mm;margin-bottom:6mm">
    These are real screens from the app, not illustrations. Nestly opens on the
    people, not on a dashboard of numbers.
  </p>

  <div style="display:flex;gap:7mm;justify-content:center;margin-bottom:7mm">
    ${phone('parent', '01-home', 'Home — everyone at a glance')}
    ${phone('parent', '02-map', 'Map — places that matter')}
    ${phone('parent', '03-limits', 'Limits — routines, not nagging')}
  </div>

  <div class="grid g3" style="gap:5mm">
    ${[
      [
        'Home',
        'Each child on a card: where they are, battery, and whether their phone is paused. One tap to lock, locate or leave a note.',
      ],
      [
        'Map & zones',
        'Draw a circle around home, school or grandma\'s. Choose which children each zone covers — most cover everyone. You\'re told on arrival and on leaving.',
      ],
      [
        'Limits',
        'Routines like School Hours or Bedtime. They run on your child\'s phone, so they keep working with no signal and no internet.',
      ],
    ]
      .map(
        ([t, d]) => `<div>
          <h3 style="font-size:12pt;margin-bottom:2mm">${t}</h3>
          <p class="small muted" style="margin:0">${d}</p>
        </div>`,
      )
      .join('')}
  </div>

  <hr class="rule">

  <div style="display:flex;gap:7mm;justify-content:center">
    ${phone('parent', '04-hub', 'Hub — notes both ways', 132)}
    ${phone('parent', '05-reports', 'Reports — the week in one place', 132)}
    ${phone('parent', '06-devices', 'Devices — add and manage phones', 132)}
  </div>
  ${foot('2')}
</div>`

/* --------------------------------------------------------------- page 3 -- */

const theirPhone = `
<div class="page">
  <div class="eyebrow">On their phone</div>
  <h2 style="font-size:23pt;margin:3mm 0 4mm">Your child can see exactly what you can</h2>
  <p class="small muted" style="max-width:150mm;margin-bottom:6mm">
    This is the part most apps leave out. Nestly shows the child a plain list of
    what is shared — because a child who knows the rules keeps them, and a child
    who feels spied on finds a way around them.
  </p>

  <div style="display:flex;gap:8mm;justify-content:center;margin-bottom:7mm">
    ${phone('child', '01-child-home', 'Their home screen', 140)}
    ${phone('child', '02-child-lock', 'When a routine is running', 140)}
    ${phone('child', '03-child-notice', 'What is shared, in plain words', 140)}
  </div>

  <div class="grid g2" style="gap:6mm">
    <div class="card tint">
      <h3 style="font-size:12pt;margin-bottom:2.5mm">What Nestly shares</h3>
      <ul class="small" style="color:${C.slate}">
        <li>Where they are, and when they arrive or leave a zone</li>
        <li>Screen time and which apps were used</li>
        <li>Sites that were blocked, and safety alerts</li>
      </ul>
    </div>
    <div class="card outline">
      <h3 style="font-size:12pt;margin-bottom:2.5mm">What it never does</h3>
      <ul class="small muted">
        <li><b>Never reads inside their messages</b></li>
        <li>Never records audio or their screen</li>
        <li>Never hides that it is running — a notice stays on their phone</li>
        <li>Never blocks the numbers you set as emergency contacts</li>
      </ul>
    </div>
  </div>

  <div class="card" style="margin-top:6mm;display:flex;gap:5mm;align-items:flex-start">
    <svg width="30" height="30" viewBox="0 0 32 32" style="flex-shrink:0" aria-hidden>
      <path d="M16 2 26 6v10c0 7-5 11-10 13C11 27 6 23 6 16V6z" fill="${C.teal}"/>
      <path d="M11 16l3.5 3.5L21.5 12" stroke="#fff" stroke-width="2.6"
            stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
    <div>
      <h3 style="font-size:11.5pt;margin-bottom:1.5mm">They can always call for help</h3>
      <p class="small muted" style="margin:0">
        You choose up to four numbers. They stay callable even while the phone is
        paused, with no signal and no internet — a locked phone that can't dial
        for help isn't safety, it's a risk.
      </p>
    </div>
  </div>
  ${foot('3')}
</div>`

/* --------------------------------------------------------------- page 4 -- */

const setup = `
<div class="page">
  <div class="eyebrow">Getting started</div>
  <h2 style="font-size:23pt;margin:3mm 0 6mm">Five minutes, once</h2>

  <div class="grid g2" style="gap:6mm;margin-bottom:7mm">
    <div>
      ${[
        ['Install Nestly on both phones', 'Yours and your child\'s. Same app — it asks which one it is on first run.'],
        ['Choose the role', 'On yours pick "This is my phone". On theirs, "This is my child\'s phone".'],
        ['Pair them', 'Hold the phones together. Yours finds theirs over Bluetooth and remembers it.'],
        ['Add your emergency numbers', 'Do this before you ever lock their phone.'],
        ['Set your first routine', 'School Hours and Bedtime are ready to switch on.'],
      ]
        .map(
          ([t, d], i) => `<div style="display:flex;gap:4mm;margin-bottom:4.5mm">
            <div style="flex-shrink:0;width:8mm;height:8mm;border-radius:50%;background:${C.teal};color:#fff;font-weight:800;font-size:10pt;display:flex;align-items:center;justify-content:center">${i + 1}</div>
            <div>
              <div style="font-weight:800;font-size:11pt">${t}</div>
              <div class="small muted">${d}</div>
            </div>
          </div>`,
        )
        .join('')}
    </div>

    <div>
      <div class="card tint" style="margin-bottom:5mm">
        <h3 style="font-size:12pt;margin-bottom:2.5mm">Why Bluetooth?</h3>
        <p class="small" style="color:${C.slate};margin:0">
          Right now the two phones talk directly to each other, with no company
          server in between. Your family's location never leaves your phones.
        </p>
        <p class="small" style="color:${C.slate};margin:2.5mm 0 0">
          It means updates arrive when you're near each other rather than
          instantly — their phone records all day and hands everything over when
          you're next together. Routines and zones keep working the whole time.
        </p>
      </div>

      <div class="card outline">
        <h3 style="font-size:12pt;margin-bottom:2.5mm">Coming next</h3>
        <p class="small muted" style="margin:0">
          An optional online account adds live updates while you're apart, a
          second parent on the same family, and history kept safely off the
          phone.
        </p>
      </div>
    </div>
  </div>

  <hr class="rule">

  <div style="display:flex;gap:6mm;align-items:stretch">
    <div class="card" style="flex:1">
      <div class="eyebrow">What it costs</div>
      <div class="display" style="font-size:26pt;margin:1mm 0">Free</div>
      <p class="small muted" style="margin:0">
        One parent and up to two children, with every feature included. Larger
        families: <b>Pro</b> covers 2 adults and 4 children, <b>Premium</b> 3
        adults and 6 children.
      </p>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <div class="art" style="width:44mm;margin:0 auto">${sceneTogether()}</div>
    </div>
  </div>

  <div class="card tint small" style="margin-top:6mm;color:${C.slate}">
    <b>A note on what Nestly is not.</b> It is not spyware, and it does not
    pretend your child cannot see it. Routines are agreed, not imposed in
    secret — that is the whole design. If you want something that watches a
    child without their knowledge, Nestly is the wrong app.
  </div>
  ${foot('4')}
</div>`

export function howItWorks() {
  const body = [cover, yourPhone, theirPhone, setup].join('\n')
  return docShell('Nestly — how it works', body, `h2 { color: ${C.ink}; }`)
}
