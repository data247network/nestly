// Screenshots each .page under print-media emulation, at exact A4 pixel size.
//
// This is the same rendering path the PDF is produced from, including the
// overflow clip, so it is the honest way to check that pinning .page height did
// not quietly cut the bottom off anything.
import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync)

const dir = fileURLToPath(new URL('../marketing/', import.meta.url))
const out = fileURLToPath(new URL('../.art-preview/print/', import.meta.url))
mkdirSync(out, { recursive: true })

const browser = await puppeteer.launch({ executablePath: exe, headless: true })

for (const [file, stem] of [
  ['nestly-flyer-for-parents.html', 'flyer'],
  ['nestly-brochure.html', 'brochure'],
  ['nestly-flash-cards.html', 'flashcards'],
]) {
  const page = await browser.newPage()
  await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 })
  await page.goto(pathToFileURL(dir + file).href, { waitUntil: 'networkidle0' })
  await page.emulateMediaType('print')
  await page.evaluateHandle('document.fonts.ready')
  const els = await page.$$('.page')
  for (let i = 0; i < els.length; i++) {
    await els[i].screenshot({ path: `${out}${stem}-p${i + 1}.png` })
    console.log(`wrote .art-preview/print/${stem}-p${i + 1}.png`)
  }
  await page.close()
}

await browser.close()
