// Redacts personal data out of captured screenshots before they go into
// anything shareable.
//
// The lock-screen capture is the single most persuasive image in the guide —
// and it shows the household's real emergency numbers. A sales document that
// leaks the owner's family phone numbers is not a document you can send.
//
// Redaction is destructive on purpose: it rewrites the PNG rather than relying
// on the layout to cover the digits, so the numbers are not recoverable from
// the file.
import sharp from 'sharp'
import { existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const dir = fileURLToPath(new URL('../docs/screens/', import.meta.url))

/**
 * Boxes are given in fractions of the image, so they survive a different
 * capture resolution. Each is drawn as a filled rounded rect matching the
 * surrounding card, with a placeholder number on top.
 */
const JOBS = [
  {
    file: 'child/02-child-lock.png',
    // Two phone-number lines inside the teal contact cards.
    boxes: [
      { x: 0.17, y: 0.567, w: 0.40, h: 0.031, fill: '#6FD6C4', text: '07xxx xxxxxx' },
      { x: 0.17, y: 0.666, w: 0.40, h: 0.031, fill: '#6FD6C4', text: '08xxx xxxxxx' },
    ],
  },
]

for (const job of JOBS) {
  const path = dir + job.file
  if (!existsSync(path)) {
    console.log('skip (not captured):', job.file)
    continue
  }

  const img = sharp(path)
  const { width = 720, height = 1600 } = await img.metadata()

  const overlays = job.boxes.map((b) => {
    const w = Math.round(b.w * width)
    const h = Math.round(b.h * height)
    const fontSize = Math.round(h * 0.86)
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${w}" height="${h}" rx="${Math.round(h * 0.2)}" fill="${b.fill}"/>
      <text x="0" y="${Math.round(h * 0.8)}" font-family="sans-serif"
            font-size="${fontSize}" fill="#2F6F62">${b.text}</text>
    </svg>`
    return {
      input: Buffer.from(svg),
      left: Math.round(b.x * width),
      top: Math.round(b.y * height),
    }
  })

  const out = await img.composite(overlays).png().toBuffer()
  await sharp(out).toFile(path)
  console.log('redacted', job.file, `(${job.boxes.length} field${job.boxes.length === 1 ? '' : 's'})`)
}
