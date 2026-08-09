// Sanity-checks the generated PDFs: page count, page size in mm, and whether
// the brand fonts actually got embedded. Cheap structural parse — no library —
// because the only failure modes that matter here are "wrong paper size",
// "split across an extra page" and "fell back to Segoe UI".
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const dir = fileURLToPath(new URL('../marketing/', import.meta.url))
const PT_TO_MM = 25.4 / 72

for (const f of readdirSync(dir).filter((n) => n.endsWith('.pdf')).sort()) {
  const buf = readFileSync(dir + f)
  const raw = buf.toString('latin1')

  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length
  const boxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
  const sizes = [
    ...new Set(
      boxes.map(
        (m) =>
          `${Math.round((+m[3] - +m[1]) * PT_TO_MM)}x${Math.round((+m[4] - +m[2]) * PT_TO_MM)}mm`,
      ),
    ),
  ]

  const fonts = [...new Set([...raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-,]+)/g)].map((m) => m[1]))]
  const hasBrand = fonts.some((n) => /Manrope|Baloo/i.test(n))

  // The illustration PDFs are pure vector with no type in them at all, so "no
  // fonts" is the correct result there rather than a fallback to report.
  const fontNote = fonts.length === 0
    ? 'no type (vector only)'
    : hasBrand
      ? 'brand fonts OK'
      : `FONT FALLBACK -> ${fonts.join(' ')}`

  console.log(
    [
      f.padEnd(44),
      `${String(pages).padStart(2)}p`,
      sizes.join(',').padEnd(12),
      `${Math.round(buf.length / 1024)}KB`.padStart(7),
      fontNote,
    ].join('  '),
  )
}
