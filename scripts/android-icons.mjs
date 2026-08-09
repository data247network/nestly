// Generates the Nestly launcher icons and splash screens into
// android/app/src/main/res:
//
//   mipmap-*/ic_launcher.png             legacy square  (brand tile + mark)
//   mipmap-*/ic_launcher_round.png       legacy round
//   mipmap-*/ic_launcher_foreground.png  adaptive foreground, transparent
//   values/ic_launcher_background.xml    adaptive background colour
//   drawable*/splash.png                 splash, per orientation + density
//
// The mark is the app's own logo: a mint ring inside a rounded teal tile, the
// same glyph the sidebar and sign-in screen use.
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

const TEAL = '#147D77'
const MINT = '#5FD3C4'

/** The ring mark, sized as a fraction of a 100-unit canvas. */
const ring = (scale) => {
  const r = 22 * scale
  const w = 11 * scale
  return `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${MINT}" stroke-width="${w}"/>`
}

const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="${TEAL}"/>${ring(1)}</svg>`

const roundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="${TEAL}"/>${ring(1)}</svg>`

// Adaptive icons are cropped hard by the launcher: only the middle ~66% of the
// 108dp canvas is guaranteed visible, so the mark is scaled down to sit inside
// that safe zone.
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${ring(0.62)}</svg>`

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

for (const [density, size] of Object.entries(LEGACY)) {
  const dir = path.join(RES, `mipmap-${density}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), await png(tileSvg, size))
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), await png(roundSvg, size))
}

for (const [density, size] of Object.entries(FOREGROUND)) {
  const dir = path.join(RES, `mipmap-${density}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), await png(foregroundSvg, size))
}

fs.mkdirSync(path.join(RES, 'values'), { recursive: true })
fs.writeFileSync(
  path.join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${TEAL}</color>\n</resources>\n`,
)

// ---- splash ---------------------------------------------------------------
// Capacitor picks drawable/splash.png plus the per-orientation variants the
// template ships; all of them get the same centred mark on brand teal.

const splashSvg = (w, h) => {
  const mark = Math.round(Math.min(w, h) * 0.22)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="${TEAL}"/>
    <g transform="translate(${(w - mark) / 2} ${(h - mark) / 2}) scale(${mark / 100})">
      <circle cx="50" cy="50" r="34" fill="none" stroke="${MINT}" stroke-width="12"/>
    </g>
  </svg>`
}

const SPLASH = {
  'drawable': [480, 800],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
}

for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  const target = path.join(RES, dir)
  fs.mkdirSync(target, { recursive: true })
  const buf = await sharp(Buffer.from(splashSvg(w, h))).png({ compressionLevel: 9 }).toBuffer()
  fs.writeFileSync(path.join(target, 'splash.png'), buf)
}

console.log('[android-icons] Wrote Nestly launcher icons + splash to', path.relative(ROOT, RES))
