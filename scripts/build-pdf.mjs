// Renders the collateral to print-ready PDF.
//
// Uses puppeteer-core driving the Chrome already installed on this machine,
// rather than `puppeteer` — that would download a second ~150 MB Chromium for
// no benefit. Point CHROME_PATH at a binary if the discovery list misses.
//
// `preferCSSPageSize` is the important flag: the collateral already declares
// `@page { size: A4; margin: 0 }`, so honouring it gives exact A4 with the
// bleed-to-edge artwork intact, instead of Chrome's default Letter + margins.
import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import { sceneSafe, sceneGently, sceneTogether } from '../src/art/figures.js'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  throw new Error(
    'No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser executable.',
  )
}

const dir = fileURLToPath(new URL('../marketing/', import.meta.url))
mkdirSync(dir, { recursive: true })

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--font-render-hinting=none'],
})

/** Wait for the embedded woff2 faces to be ready, or headings print as fallback. */
async function settle(page) {
  await page.evaluateHandle('document.fonts.ready')
  await new Promise((r) => setTimeout(r, 150))
}

async function pdfFromFile(htmlName, pdfName) {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(dir + htmlName).href, { waitUntil: 'networkidle0' })
  await settle(page)
  await page.pdf({
    path: dir + pdfName,
    printBackground: true,
    preferCSSPageSize: true,
  })
  await page.close()
  console.log('wrote marketing/' + pdfName)
}

/**
 * One illustration, one square page, artwork bleeding to the edge — the shape
 * you want when dropping it into a deck or handing it to a printer.
 */
async function pdfFromScene(svg, pdfName, mm = 140) {
  const html = `<!doctype html><meta charset="utf-8">
    <style>
      @page { size: ${mm}mm ${mm}mm; margin: 0; }
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { margin: 0; width: ${mm}mm; height: ${mm}mm; background: #fff; }
      svg { display: block; width: 100%; height: 100%; }
    </style>${svg}`
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'load' })
  await settle(page)
  await page.pdf({ path: dir + pdfName, printBackground: true, preferCSSPageSize: true })
  await page.close()
  console.log('wrote marketing/' + pdfName)
}

await pdfFromFile('nestly-flyer-for-parents.html', 'nestly-flyer-for-parents.pdf')
await pdfFromFile('nestly-brochure.html', 'nestly-brochure.pdf')
await pdfFromFile('nestly-flash-cards.html', 'nestly-flash-cards.pdf')
await pdfFromFile('nestly-how-it-works.html', 'nestly-how-it-works.pdf')

const SCENES = [
  [sceneSafe(), 'nestly-flashcard-1-know-theyre-safe.pdf'],
  [sceneGently(), 'nestly-flashcard-2-see-their-world.pdf'],
  [sceneTogether(), 'nestly-flashcard-3-set-limits-together.pdf'],
]
for (const [svg, name] of SCENES) await pdfFromScene(svg, name)

// Also emit all three as one 3-page document — that is what actually gets
// attached to an email, rather than three separate files.
{
  const combined = `<!doctype html><meta charset="utf-8">
    <style>
      @page { size: 140mm 140mm; margin: 0; }
      html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { margin: 0; background: #fff; }
      .sheet { width: 140mm; height: 140mm; page-break-after: always; }
      .sheet:last-child { page-break-after: auto; }
      svg { display: block; width: 100%; height: 100%; }
    </style>${SCENES.map(([svg]) => `<div class="sheet">${svg}</div>`).join('')}`
  const page = await browser.newPage()
  await page.setContent(combined, { waitUntil: 'load' })
  await settle(page)
  await page.pdf({
    path: dir + 'nestly-flashcard-illustrations.pdf',
    printBackground: true,
    preferCSSPageSize: true,
  })
  await page.close()
  console.log('wrote marketing/nestly-flashcard-illustrations.pdf')
}

await browser.close()
