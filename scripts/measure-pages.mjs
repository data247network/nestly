// Measures the true content height of each .page with min-height removed, under
// print media emulation. `.page` has min-height:297mm, so a naive scrollHeight
// always reports 297 and hides whether the content actually fits.
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

const exe = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync)

const dir = fileURLToPath(new URL('../marketing/', import.meta.url))
const browser = await puppeteer.launch({ executablePath: exe, headless: true })

for (const f of [
  'nestly-flyer-for-parents.html',
  'nestly-brochure.html',
  'nestly-flash-cards.html',
]) {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(dir + f).href, { waitUntil: 'networkidle0' })
  await page.emulateMediaType('print')
  await page.evaluateHandle('document.fonts.ready')
  const rows = await page.evaluate(() => {
    const PX_PER_MM = 96 / 25.4
    return [...document.querySelectorAll('.page')].map((p, i) => {
      // The print stylesheet pins height AND min-height and clips the overflow,
      // so all three have to be neutralised or every page just reports 297mm.
      const prev = { h: p.style.height, mh: p.style.minHeight, o: p.style.overflow }
      p.style.height = 'auto'
      p.style.minHeight = '0'
      p.style.overflow = 'visible'
      const h = p.scrollHeight / PX_PER_MM
      Object.assign(p.style, { height: prev.h, minHeight: prev.mh, overflow: prev.o })
      return { page: i + 1, contentMm: Math.round(h * 10) / 10 }
    })
  })
  console.log(f)
  for (const r of rows) {
    const slack = Math.round((297 - r.contentMm) * 10) / 10
    console.log(`   page ${r.page}: content ${r.contentMm}mm, slack ${slack}mm`)
  }
  await page.close()
}

await browser.close()
