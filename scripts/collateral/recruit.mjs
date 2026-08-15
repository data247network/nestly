// The tester-recruitment flyer: one A4 page asking fifteen families to try
// Nestly and say what is wrong with it.
//
// Deliberately not the parent advert. That one sells a finished product; this
// one is asking a favour, and the two need opposite tones. A recruitment flyer
// that oversells gets volunteers who expected a polished app and quietly stop
// replying — the useful ones are the people who signed up *knowing* it is
// early, because they are the ones who will bother to tell you it is broken.
//
// So: what it does, what it costs them, what we need back, and the honest
// admission that they are testing something unfinished. The Android-only
// requirement is stated twice, near the top and at the sign-up step, because it
// is the single thing that wastes everybody's time when it is missed.
import { sceneSafe, sceneGently, sceneTogether } from '../../src/art/figures.js'
import { C, docShell, wordmark } from './shared.mjs'

/** Where a volunteer actually goes. The portal handles both roles from here. */
const SIGNUP_URL = 'https://nestly-gamma-seven.vercel.app/download'

const WHAT_IT_DOES = [
  {
    scene: sceneSafe(),
    title: 'See where they are',
    body: 'A live map, and a nudge when they reach school or leave it. Works over the internet, or over Bluetooth with no signal at all.',
  },
  {
    scene: sceneGently(),
    title: 'Screen time in plain English',
    body: 'Which apps, how long, which sites were blocked — so you can guide rather than guess.',
  },
  {
    scene: sceneTogether(),
    title: 'Routines you both agree',
    body: 'School Hours, Bedtime, Homework. They run on their phone whether or not it has signal.',
  },
]

const ASKS = [
  'Use it for two weeks as you normally would.',
  'Tell us what confused you, broke, or annoyed you.',
  'One short call or message at the end — ten minutes.',
]

export function recruit() {
  const body = `
  <div class="page recruit">
    <header style="display:flex;justify-content:space-between;align-items:flex-start">
      ${wordmark(24)}
      <div style="text-align:right">
        <div style="font:800 11px/1 Manrope;letter-spacing:.14em;color:${C.teal}">
          CLOSED BETA
        </div>
        <div style="font:600 10.5px/1.5 Manrope;color:${C.body};margin-top:3px">
          15 families · Android only
        </div>
      </div>
    </header>

    <section style="margin-top:26px">
      <!-- The question comes before the headline on purpose. A parent scanning
           a noticeboard is not looking for an app; they are carrying a worry,
           and naming it is what makes them read the next line. -->
      <div style="font:700 17px/1.4 Manrope;color:${C.teal};max-width:92%">
        Are you worried about giving your young children and teenagers phones?
      </div>
      <h1 style="font:800 36px/1.05 'Baloo 2';color:${C.ink};margin:10px 0 0;letter-spacing:-.01em">
        Help us build a family<br/>safety app that works
      </h1>
      <p style="font:400 13.5px/1.65 Manrope;color:${C.slate};margin:13px 0 0;max-width:88%">
        <b style="color:${C.ink}">We have a support application for you.</b>
        Nestly keeps a parent and a child's phone in step — where they are,
        what they're doing online, and the routines you've agreed. It is built
        to keep working when there is no signal, which is the part most apps
        get wrong.
        <b style="color:${C.ink}">It is not finished, and that is why we need you.</b>
      </p>
    </section>

    <!-- The art class is what constrains these: the scenes are full-bleed SVGs
         carrying their own intrinsic size, so they need a width-bounded
         wrapper. Sizing the box in pixels and centring with flex lets them
         overflow the card and print on top of the paragraph above. -->
    <section style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px">
      ${WHAT_IT_DOES.map(
        (b) => `
        <div style="background:${C.cream};border-radius:16px;padding:16px 15px 18px">
          <div class="art" style="width:30mm;margin:0 auto 9px">${b.scene}</div>
          <div style="font:800 13.5px/1.3 Manrope;color:${C.ink}">${b.title}</div>
          <div style="font:400 11px/1.55 Manrope;color:${C.body};margin-top:5px">${b.body}</div>
        </div>`,
      ).join('')}
    </section>

    <section style="display:grid;grid-template-columns:1.05fr .95fr;gap:16px;margin-top:26px">
      <div style="background:${C.tint};border-radius:16px;padding:16px 18px">
        <div style="font:800 12px/1 Manrope;letter-spacing:.1em;color:${C.tealDark}">
          WHAT WE'RE ASKING
        </div>
        <ul style="margin:10px 0 0;padding:0;list-style:none">
          ${ASKS.map(
            (a) => `
            <li style="font:500 12px/1.5 Manrope;color:${C.slate};display:flex;gap:8px;margin-top:7px">
              <span style="color:${C.teal};font-weight:800">→</span><span>${a}</span>
            </li>`,
          ).join('')}
        </ul>
        <div style="font:700 11.5px/1.5 Manrope;color:${C.tealDark};margin-top:12px">
          Free for testers, for the whole trial.
        </div>
      </div>

      <div style="border:1.5px solid ${C.line};border-radius:16px;padding:16px 18px">
        <div style="font:800 12px/1 Manrope;letter-spacing:.1em;color:${C.ink}">
          YOU'LL NEED
        </div>
        <div style="font:500 12px/1.6 Manrope;color:${C.slate};margin-top:9px">
          <b style="color:${C.ink}">Two Android phones</b> — one yours, one your
          child's. Android 5.1 or newer.<br/>
          There is no iPhone version yet.
        </div>
        <div style="font:400 11px/1.5 Manrope;color:${C.body};margin-top:10px">
          Installed from a link, not the Play Store — we'll walk you through it.
        </div>
      </div>
    </section>

    <!-- The question every parent asks before the second sentence. Answering it
         on the page is worth more than another benefit. -->
    <section style="background:${C.ink};border-radius:16px;padding:15px 18px;margin-top:20px">
      <div style="font:800 11.5px/1 Manrope;letter-spacing:.1em;color:${C.mint}">
        ABOUT YOUR DATA
      </div>
      <div style="font:400 11.5px/1.6 Manrope;color:#D8DEE2;margin-top:7px">
        Your child's phone shows them exactly what is shared — nothing is
        hidden from them. We never sell data, and nothing goes to advertisers.
        Ask us to delete everything at any point and we will, no questions.
      </div>
    </section>

    <!-- The three steps exist because "volunteer for a beta" is vague enough to
         put people off. Somebody who can see it is twenty minutes of setup and
         a message at the end can decide on the spot. -->
    <section style="margin-top:24px">
      <div style="font:800 12px/1 Manrope;letter-spacing:.1em;color:${C.ink}">
        WHAT HAPPENS NEXT
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:11px">
        ${[
          ['1', 'You get in touch', 'Follow the link or reply to us. We send you the app and a setup code.'],
          ['2', 'Twenty minutes to set up', 'Install on both phones, link them with the code, agree the routines together.'],
          ['3', 'Use it, then tell us', 'Two weeks of normal life. Then ten minutes telling us what to fix.'],
        ]
          .map(
            ([n, t, b]) => `
          <div style="display:flex;gap:10px">
            <div style="flex:0 0 22px;height:22px;border-radius:11px;background:${C.teal};color:#fff;font:800 11px/22px Manrope;text-align:center">${n}</div>
            <div>
              <div style="font:800 12px/1.3 Manrope;color:${C.ink}">${t}</div>
              <div style="font:400 10.5px/1.5 Manrope;color:${C.body};margin-top:3px">${b}</div>
            </div>
          </div>`,
          )
          .join('')}
      </div>
    </section>

    <section style="display:flex;align-items:center;gap:16px;margin-top:26px;border-top:1.5px solid ${C.line};padding-top:18px">
      <div style="flex:1">
        <div style="font:800 17px/1.2 'Baloo 2';color:${C.ink}">
          Want in? Start here.
        </div>
        <div style="font:600 12.5px/1.5 Manrope;color:${C.teal};margin-top:4px;word-break:break-all">
          ${SIGNUP_URL.replace('https://', '')}
        </div>
        <div style="font:400 10.5px/1.5 Manrope;color:${C.body};margin-top:5px">
          Or reply to whoever handed you this. Places are limited to 15 families.
        </div>
      </div>
    </section>
  </div>`

  // Fixed A4, no page breaks: this is a single sheet, handed over or emailed.
  return docShell('Nestly — help us test it', body, `
    @page { size: A4; margin: 0; }
    .recruit { padding: 34px 36px 30px; }
  `)
}
