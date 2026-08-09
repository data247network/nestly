// Rasterises the family illustrations to PNG.
//
// Used two ways: as a visual check while iterating on the artwork, and to emit
// the app icon source for `android-icons.mjs`.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { sceneSafe, sceneGently, sceneTogether, sceneHero } from '../src/art/figures.js'

const dir = fileURLToPath(new URL('../.art-preview/', import.meta.url))
mkdirSync(dir, { recursive: true })

const jobs = [
  ['flashcard-1-safe', sceneSafe(), 420, 420],
  ['flashcard-2-gently', sceneGently(), 420, 420],
  ['flashcard-3-together', sceneTogether(), 420, 420],
  ['hero', sceneHero(), 1040, 600],
]

for (const [name, svg, w, h] of jobs) {
  writeFileSync(`${dir}${name}.svg`, svg)
  await sharp(Buffer.from(svg)).resize(w, h).png().toFile(`${dir}${name}.png`)
  console.log('rendered', name)
}

// Contact sheet — all three flash cards side by side, easiest thing to eyeball.
const sheet = await sharp({
  create: { width: 1300, height: 460, channels: 4, background: '#F7F3EC' },
})
  .composite(
    jobs.slice(0, 3).map(([name], i) => ({
      input: `${dir}${name}.png`,
      top: 20,
      left: 20 + i * 430,
    })),
  )
  .png()
  .toBuffer()
writeFileSync(`${dir}contact-sheet.png`, sheet)
console.log('rendered contact-sheet')
