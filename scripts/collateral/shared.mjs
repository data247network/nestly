// Shared chrome for the printed collateral: brand tokens, the page shell, and
// the small device mockups. Both the brochure and the flyer are single
// self-contained HTML files that print cleanly to A4 and open with no build
// step, so everything is inlined here rather than linked.
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

export const C = {
  teal: '#147D77',
  tealDark: '#0F5F5A',
  mint: '#5FD3C4',
  tint: '#E4F5F2',
  cream: '#F7F3EC',
  ink: '#1E2A32',
  slate: '#3E4A50',
  body: '#6B7680',
  muted: '#9AA2A9',
  line: '#E7E1D6',
  amber: '#FFB84D',
  amberBg: '#FFF3DE',
  coral: '#FF6B5B',
  coralBg: '#FFE9E6',
  violet: '#8B7FD1',
  violetBg: '#EFEBFB',
}

/**
 * Brand fonts, embedded as base64 woff2 rather than linked to Google Fonts.
 *
 * These files get emailed around, opened offline and printed to PDF on machines
 * that have never heard of Manrope. A CDN link would silently fall back to
 * Segoe UI and the brand would evaporate — and for the PDF specifically, an
 * embedded face is what gets subset into the document.
 *
 * Latin subsets only: the collateral is English, and pulling the Devanagari
 * cuts in would roughly quadruple the file for glyphs nothing references.
 */
const FONT_FILES = [
  ['Manrope', 400, 'manrope/files/manrope-latin-400-normal.woff2'],
  ['Manrope', 600, 'manrope/files/manrope-latin-600-normal.woff2'],
  ['Manrope', 700, 'manrope/files/manrope-latin-700-normal.woff2'],
  ['Manrope', 800, 'manrope/files/manrope-latin-800-normal.woff2'],
  ['Baloo 2', 700, 'baloo-2/files/baloo-2-latin-700-normal.woff2'],
  ['Baloo 2', 800, 'baloo-2/files/baloo-2-latin-800-normal.woff2'],
]

const FONT_CSS = FONT_FILES.map(([family, weight, rel]) => {
  const path = fileURLToPath(new URL(`../../node_modules/@fontsource/${rel}`, import.meta.url))
  const b64 = readFileSync(path).toString('base64')
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
}).join('\n')

export const BASE_CSS = `
  ${FONT_CSS}

  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    background: ${C.cream};
    color: ${C.ink};
    font-family: 'Manrope', 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
  }
  h1, h2, h3, .display {
    font-family: 'Baloo 2', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin: 0;
  }
  p { margin: 0 0 10px; }
  a { color: ${C.teal}; text-decoration: none; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 5px; }

  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 14mm;
    background: #fff;
    padding: 16mm 15mm;
    box-shadow: 0 18px 44px -18px rgba(30,42,50,0.35);
    position: relative;
    overflow: hidden;
  }
  .eyebrow {
    font-size: 8pt; font-weight: 800; letter-spacing: 0.12em;
    text-transform: uppercase; color: ${C.teal};
  }
  .lede { font-size: 12pt; color: ${C.slate}; line-height: 1.5; }
  .muted { color: ${C.body}; }
  .small { font-size: 8.5pt; }

  .grid { display: grid; gap: 6mm; }
  .g2 { grid-template-columns: 1fr 1fr; }
  .g3 { grid-template-columns: repeat(3, 1fr); }

  .card {
    background: ${C.cream};
    border-radius: 6mm;
    padding: 6mm;
  }
  .card.tint { background: ${C.tint}; }
  .card.outline { background: #fff; border: 1px solid ${C.line}; }

  .pill {
    display: inline-block; padding: 2mm 3.5mm; border-radius: 20mm;
    font-size: 8pt; font-weight: 800;
    background: ${C.tint}; color: ${C.teal};
  }

  .rule { height: 1px; background: ${C.line}; border: 0; margin: 6mm 0; }

  /* Illustration wrapper. Scoped to a direct child so the small inline icons
     elsewhere on the page keep their intrinsic size — a blanket "svg { width:
     100% }" blows the shield and QR glyphs up to full page width. */
  .art > svg { display: block; width: 100%; height: auto; }

  .foot {
    position: absolute; left: 15mm; right: 15mm; bottom: 9mm;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 7.5pt; color: ${C.muted};
    border-top: 1px solid ${C.line}; padding-top: 3mm;
  }

  @page { size: A4; margin: 0; }
  @media print {
    body { background: #fff; }
    /*
      Height is pinned rather than left as a minimum. A .page whose content
      lands even a fraction over 297mm spills into a blank trailing sheet, and
      print-media font metrics differ from screen, so the overflow shows up only
      in the PDF and not in the browser. Run scripts/measure-pages.mjs to see the
      real per-page slack; keep it positive rather than relying on this clip.
    */
    .page {
      margin: 0;
      box-shadow: none;
      height: 297mm;
      min-height: 297mm;
      overflow: hidden;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .noprint { display: none !important; }
  }
`

/** The Nestly wordmark, drawn rather than typeset so it prints identically. */
export const wordmark = (size = 26, color = C.ink) => `
  <div style="display:flex;align-items:center;gap:${size * 0.3}px">
    <svg width="${size * 1.35}" height="${size * 1.35}" viewBox="0 0 100 100" aria-hidden>
      <rect width="100" height="100" rx="30" fill="${C.teal}"/>
      <circle cx="50" cy="50" r="22" fill="none" stroke="${C.mint}" stroke-width="12"/>
    </svg>
    <span class="display" style="font-size:${size}px;color:${color}">Nestly</span>
  </div>`

/**
 * A small phone mockup for the collateral. Takes literal inner markup so each
 * call can show a different screen without dragging the React app into a
 * static HTML file.
 *
 * The screen contents are authored against a fixed BASE width and the whole
 * device is then CSS-scaled to the requested `w`. Sizing the frame directly
 * would leave the inner px values untouched, so shrinking the mockup to fit a
 * page silently crops the bottom off the screen instead of making it smaller.
 */
const MOCK_BASE = 140

export const phoneMock = (inner, { w = 140, label = '' } = {}) => {
  const k = w / MOCK_BASE
  const h = Math.round(MOCK_BASE * 2.05)
  return `<figure style="margin:0;text-align:center">
    <div style="width:${w}px;height:${Math.round(h * k)}px;margin:0 auto">
      <div style="transform:scale(${k});transform-origin:top left;width:${MOCK_BASE}px;height:${h}px;background:#12181C;border-radius:${MOCK_BASE * 0.14}px;padding:${MOCK_BASE * 0.035}px">
        <div style="width:100%;height:100%;background:#fff;border-radius:${MOCK_BASE * 0.105}px;overflow:hidden;position:relative;text-align:left">
          <div style="height:${MOCK_BASE * 0.1}px;background:#fff"></div>
          ${inner}
        </div>
      </div>
    </div>
    ${label ? `<figcaption style="font-size:7.5pt;font-weight:700;color:${C.body};margin-top:2.5mm">${label}</figcaption>` : ''}
  </figure>`
}

export const docShell = (title, body, extraCss = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
${body}
</body>
</html>
`
