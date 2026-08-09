// Generates the printed collateral into marketing/.
//
// Everything is emitted as one self-contained HTML file per piece: they get
// emailed and opened offline, so no CDN, no build step, no external assets.
// Print to PDF from any browser — the @page rules are already A4.
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { brochure, flashCards } from './collateral/brochure.mjs'
import { flyer } from './collateral/flyer.mjs'
import { howItWorks } from './collateral/howitworks.mjs'

const out = fileURLToPath(new URL('../marketing/', import.meta.url))
const assets = `${out}assets/`
mkdirSync(assets, { recursive: true })

const pieces = [
  ['nestly-brochure.html', brochure()],
  ['nestly-flyer-for-parents.html', flyer()],
  ['nestly-flash-cards.html', flashCards()],
  ['nestly-how-it-works.html', howItWorks()],
]

for (const [name, html] of pieces) {
  writeFileSync(out + name, html)
  console.log('wrote marketing/' + name)
}

// Ship the rasterised artwork alongside, for slide decks and social posts.
const art = fileURLToPath(new URL('../.art-preview/', import.meta.url))
for (const f of [
  'flashcard-1-safe.png',
  'flashcard-2-gently.png',
  'flashcard-3-together.png',
  'hero.png',
  'flashcard-1-safe.svg',
  'flashcard-2-gently.svg',
  'flashcard-3-together.svg',
  'hero.svg',
]) {
  if (existsSync(art + f)) {
    copyFileSync(art + f, assets + f)
    console.log('wrote marketing/assets/' + f)
  }
}
