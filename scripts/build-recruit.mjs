#!/usr/bin/env node
/**
 * Builds the tester-recruitment flyer: HTML, PDF and PNG.
 *
 *   node scripts/build-recruit.mjs
 *
 * Three formats because they get used in three different places. The PDF is
 * what a school office prints; the PNG is what actually travels, because a
 * WhatsApp group or a Facebook parents' page will show an image inline and
 * bury a PDF behind a download nobody taps.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { recruit } from './collateral/recruit.mjs'

const out = fileURLToPath(new URL('../marketing/', import.meta.url))
mkdirSync(out, { recursive: true })

const HTML = 'nestly-tester-recruitment.html'
const PDF = 'nestly-tester-recruitment.pdf'
const PNG = 'nestly-tester-recruitment.png'

writeFileSync(out + HTML, recruit())
console.log('wrote marketing/' + HTML)

/** Same candidates the other collateral scripts use. */
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const executablePath = CHROME_CANDIDATES.find((p) => p && existsSync(p))
if (!executablePath) {
  // The HTML is already written and opens in any browser, so this is a partial
  // success rather than a failure — say which part worked.
  console.error('No Chrome found; wrote the HTML only. Open it and print to PDF.')
  process.exit(0)
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--font-render-hinting=none'],
})

const page = await browser.newPage()
// 2x, so the PNG stays crisp when someone pinch-zooms it on a phone — which is
// how most people will read it.
await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(out + HTML).href, { waitUntil: 'networkidle0' })

// Without this the embedded woff2 faces are not ready and every heading prints
// in a fallback, which is the one defect nobody notices until it is printed.
await page.evaluateHandle('document.fonts.ready')
await new Promise((r) => setTimeout(r, 200))

await page.pdf({ path: out + PDF, printBackground: true, preferCSSPageSize: true })
console.log('wrote marketing/' + PDF)

await page.screenshot({ path: out + PNG, fullPage: true })
console.log('wrote marketing/' + PNG)

await browser.close()
