// Renders the family illustrations to a single HTML page so the artwork can be
// eyeballed on its own, without booting the whole app.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { sceneSafe, sceneGently, sceneTogether, sceneHero } from '../src/art/figures.js'

const out = fileURLToPath(new URL('../.art-preview/index.html', import.meta.url))
mkdirSync(fileURLToPath(new URL('../.art-preview', import.meta.url)), { recursive: true })

const card = (title, svg, w = 260) =>
  `<figure style="margin:0;text-align:center"><div style="width:${w}px;margin:0 auto">${svg}</div>
   <figcaption style="font:600 13px Manrope,system-ui;color:#6B7680;margin-top:10px">${title}</figcaption></figure>`

writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>Nestly artwork</title>
<body style="margin:0;padding:40px;background:#F7F3EC;font-family:system-ui">
<h1 style="font:800 26px system-ui;color:#1E2A32">Nestly — family artwork</h1>
<div style="display:flex;gap:30px;flex-wrap:wrap;align-items:flex-start;margin-top:24px">
${card('Flash card 1 — Know they’re safe, always', sceneSafe())}
${card('Flash card 2 — See their world, gently', sceneGently())}
${card('Flash card 3 — Set limits, together', sceneTogether())}
</div>
<div style="margin-top:40px;max-width:760px">${card('Hero — brochure & flyer', sceneHero(), 720)}</div>
</body>`,
)
console.log('wrote', out)
