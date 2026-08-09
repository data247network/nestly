// Drives the actual UI of two "devices" against a running dev server.
//
// Both pages sit on the same origin so they share a BroadcastChannel — that is
// the loopback link standing in for BLE — while `?device=parent|child`
// partitions their storage so they behave like two separate phones.
//
// The unit tests cover the protocol and the agent. This covers the wiring: role
// gate, pairing, and the parent's screen actually reflecting a real child.
import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const BASE = process.env.NESTLY_URL ?? 'http://localhost:5174'

const exe = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
  .filter(Boolean)
  .find(existsSync)
if (!exe) throw new Error('No Chrome/Edge found; set CHROME_PATH.')

const shots = fileURLToPath(new URL('../.art-preview/devices/', import.meta.url))
mkdirSync(shots, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await puppeteer.launch({ executablePath: exe, headless: true })

/** Click the first button whose trimmed text contains `text`. */
async function clickText(page, text) {
  const ok = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().toLowerCase().includes(t.toLowerCase()),
    )
    if (!el) return false
    el.click()
    return true
  }, text)
  if (!ok) throw new Error(`No button matching "${text}". Visible: ${await buttons(page)}`)
  await sleep(250)
}

const buttons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).join(' | '),
  )

const bodyText = (page) => page.evaluate(() => document.body.innerText)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForText(page, text, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if ((await bodyText(page)).toLowerCase().includes(text.toLowerCase())) return true
    await sleep(200)
  }
  return false
}

async function openDevice(role) {
  const page = await browser.newPage()
  await page.setViewport({ width: 400, height: 860, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/?device=${role}`, { waitUntil: 'networkidle0' })
  // Start from a clean slate so re-runs are deterministic.
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(400)
  return page
}

/** Dismiss the three intro flash cards. */
async function skipOnboarding(page) {
  const shown = await waitForText(page, "Know they're safe")
  await clickText(page, 'Skip')
  return shown
}

try {
  const child = await openDevice('child')
  const parent = await openDevice('parent')

  // ---- onboarding then role gate ---------------------------------------
  check('child: onboarding flash cards shown first', await skipOnboarding(child))
  check('parent: onboarding flash cards shown first', await skipOnboarding(parent))

  check('child: role gate shown', await waitForText(child, 'Which phone is this?'))
  await clickText(child, "This is my child's phone")
  await child.type('input', 'Maya')
  await clickText(child, 'Continue')
  check('child: reaches its own home screen', await waitForText(child, 'Maya'))

  check('parent: role gate shown', await waitForText(parent, 'Which phone is this?'))
  await clickText(parent, 'This is my phone')
  await parent.type('input', 'Mum')
  await clickText(parent, 'Continue')
  check('parent: prompted to pair', await waitForText(parent, "Connect your child's phone"))

  // ---- pairing ----------------------------------------------------------
  await clickText(parent, 'Pair a device')
  check('parent: pairing screen', await waitForText(parent, "Find your child's phone"))
  await sleep(1200) // let the scan window elapse
  await clickText(parent, 'Pair')
  check('parent: pairing recorded', await waitForText(parent, 'Paired device'))

  // ---- the link ---------------------------------------------------------
  // The child agent ticks on its own; give it a couple of cycles.
  const linked = await waitForText(parent, 'Connected now', 10_000)
  check('parent: link reports connected', linked)

  const sawChild = await waitForText(parent, 'Maya', 12_000)
  check('parent: sees the real child device by name', sawChild)

  await parent.screenshot({ path: `${shots}parent-paired.png` })
  await child.screenshot({ path: `${shots}child-home.png` })

  // ---- child status is real --------------------------------------------
  const childText = await bodyText(child)
  check(
    'child: shows its own agent state, not fixtures',
    childText.includes('Nothing running') || childText.includes('ROUTINE'),
    childText.split('\n').slice(0, 4).join(' / '),
  )
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exit(1)
