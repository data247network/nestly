/**
 * Nestly family illustrations — framework-free SVG builders.
 *
 * These return SVG markup *strings* rather than JSX on purpose: the app renders
 * them through a thin React wrapper, and the Node scripts that generate the
 * brochure and the parent flyer import this exact same module. One source of
 * truth, so the family on the flash cards is the family on the flyer.
 *
 * Coordinate convention: every figure is drawn with its FEET at (0, 0), growing
 * upward into negative Y. An adult is 100 units tall, a child 66. Composing a
 * scene is therefore just translating each figure along a ground line.
 *
 * All artwork here is original vector work, so it is licence-clean to ship
 * inside the APK and to print.
 */

export const SKIN = {
  light: '#F4CBA6',
  fair: '#E8B48A',
  tan: '#D2996B',
  warm: '#B87844',
  deep: '#8E5A32',
  rich: '#6B4223',
}

export const HAIR = {
  black: '#2E2A28',
  espresso: '#3D2B1F',
  brown: '#5A3B22',
  auburn: '#8C4A2B',
  sand: '#C9903F',
  grey: '#9AA2A9',
}

export const BRAND = {
  teal: '#147D77',
  mint: '#5FD3C4',
  tint: '#E4F5F2',
  cream: '#F7F3EC',
  ink: '#1E2A32',
  body: '#6B7680',
  line: '#E7E1D6',
  amber: '#FFB84D',
  amberBg: '#FFF3DE',
  coral: '#FF6B5B',
  coralBg: '#FFE9E6',
  violet: '#8B7FD1',
  violetBg: '#EFEBFB',
}

/* ----------------------------------------------------------------- shade -- */

/**
 * Darken a hex colour toward black. Sleeves are drawn a step darker than the
 * torso — without that separation the arms read as part of the body and every
 * figure comes out looking armless.
 */
export function shade(hex, amount = 0.16) {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c) => Math.round(c * (1 - amount))
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/* ------------------------------------------------------------------ arms -- */

// Elbow-bent polylines per pose. Each entry is [path, handX, handY] for the
// LEFT arm; the right arm is the same thing mirrored through x = 0. Poses are
// deliberately swung well clear of the torso so the silhouette stays readable
// at flash-card size.
const ADULT_ARM = {
  rest: ['M -12 -71 L -17 -58 L -16 -45', -16, -44],
  reach: ['M -12 -71 L -19 -58 L -25 -48', -25, -47],
  wave: ['M -12 -71 L -21 -64 L -24 -79', -24, -82],
  phone: ['M -12 -71 L -19 -62 L -17 -55', -17, -54],
  hold: ['M -12 -71 L -18 -60 L -9 -55', -9, -54],
  hug: ['M -12 -71 L -20 -62 L -28 -58', -28, -57],
}

const CHILD_ARM = {
  rest: ['M -9 -41 L -13 -32 L -12.5 -25', -12.5, -24],
  reach: ['M -9 -41 L -14.5 -33 L -18 -28', -18, -27],
  wave: ['M -9 -41 L -15 -36 L -18 -49', -18, -51],
  phone: ['M -9 -41 L -14 -34 L -7 -30', -7, -29],
  hold: ['M -9 -41 L -14 -34 L -7 -30', -7, -29],
  hug: ['M -9 -41 L -14 -33 L -4 -29', -4, -28],
}

function mirrorPath(d) {
  // Negate every X in an "M x y L x y L x y" polyline.
  return d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${-parseFloat(x)} ${y}`)
}

/**
 * Sleeves and hands are returned separately: sleeves go *behind* the torso so
 * the shoulder joint is hidden, hands go *in front* of it so a pose that brings
 * them across the body (holding a tablet) still shows them.
 */
function arms(table, pose, color, skin, width) {
  const [lp, lx, ly] = table[pose.left] || table.rest
  const [rp, rx, ry] = table[pose.right] || table.rest
  const sleeve = shade(color, 0.18)
  return {
    limbs: `
      <path d="${lp}" stroke="${sleeve}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="${mirrorPath(rp)}" stroke="${sleeve}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    hands: `
      <circle cx="${lx}" cy="${ly}" r="${width * 0.5}" fill="${skin}"/>
      <circle cx="${-rx}" cy="${ry}" r="${width * 0.5}" fill="${skin}"/>`,
  }
}

/** Soft contact shadow, so figures sit on the ground instead of floating. */
const groundShadow = (rx) =>
  `<ellipse cx="0" cy="0.5" rx="${rx}" ry="${rx * 0.22}" fill="#1E2A32" opacity="0.1"/>`

/** Where a figure's hand ends up, in the figure's own local space. */
export function handAt(kind, side, pose) {
  const table = kind === 'child' ? CHILD_ARM : ADULT_ARM
  const [, x, y] = table[pose] || table.rest
  return { x: side === 'right' ? -x : x, y }
}

/* ------------------------------------------------------------------ hair -- */

// Hair is drawn in two layers so volume can sit *behind* the head (a bob, an
// afro) while the fringe sits in front of it.
function hairBack(style, color, r, cy) {
  switch (style) {
    case 'long':
      return `<rect x="${-r - 1.3}" y="${cy - r * 0.9}" width="${r * 2 + 2.6}" height="${r * 2.5}" rx="${r * 0.85}" fill="${color}"/>`
    case 'afro':
      return `<circle cx="0" cy="${cy - r * 0.3}" r="${r * 1.4}" fill="${color}"/>`
    case 'puffs':
      return `<circle cx="${-r * 1.15}" cy="${cy - r * 0.25}" r="${r * 0.66}" fill="${color}"/>
              <circle cx="${r * 1.15}" cy="${cy - r * 0.25}" r="${r * 0.66}" fill="${color}"/>`
    case 'bun':
      return `<circle cx="0" cy="${cy - r - 1.8}" r="${r * 0.46}" fill="${color}"/>`
    default:
      return ''
  }
}

function hairFront(style, color, r, cy) {
  // A fringe over the top of the head. Its lowest sweep is deliberately kept
  // above cy (where the eyes sit at cy + 0.12r) — dip any lower and every
  // figure ends up peering out from under their hair.
  const fringe = `<path d="M ${-r - 0.6} ${cy - r * 0.22} a ${r + 0.6} ${r + 0.6} 0 0 1 ${2 * (r + 0.6)} 0 q ${-r * 0.5} ${r * 0.3} ${-r} ${r * 0.12} q ${-r * 0.5} ${-r * 0.14} ${-r} ${-r * 0.12} z" fill="${color}"/>`
  switch (style) {
    case 'curly':
      return `<g fill="${color}">
        <circle cx="${-r * 0.7}" cy="${cy - r * 0.42}" r="${r * 0.5}"/>
        <circle cx="0" cy="${cy - r * 0.68}" r="${r * 0.56}"/>
        <circle cx="${r * 0.7}" cy="${cy - r * 0.42}" r="${r * 0.5}"/>
        <circle cx="${-r * 1.0}" cy="${cy + r * 0.16}" r="${r * 0.4}"/>
        <circle cx="${r * 1.0}" cy="${cy + r * 0.16}" r="${r * 0.4}"/>
      </g>`
    case 'afro':
      return ''
    case 'wrap':
      // Headwrap: a band low across the forehead with a small knot at the side.
      return `<path d="M ${-r - 0.8} ${cy + r * 0.08} a ${r + 0.8} ${r + 0.8} 0 0 1 ${2 * (r + 0.8)} 0 z" fill="${color}"/>
        <path d="M ${-r - 0.8} ${cy + r * 0.06} q ${r} ${r * 0.42} ${2 * r + 1.6} 0" stroke="${shade(color, 0.22)}" stroke-width="${r * 0.22}" fill="none"/>
        <circle cx="${r * 0.72}" cy="${cy - r * 0.72}" r="${r * 0.34}" fill="${color}"/>`
    case 'bun':
    case 'long':
      return fringe
    case 'short':
    default:
      return `${fringe}
        <path d="M ${-r - 0.5} ${cy - r * 0.05} q -0.4 ${r * 0.4} 0.6 ${r * 0.6}" stroke="${color}" stroke-width="${r * 0.2}" stroke-linecap="round" fill="none"/>
        <path d="M ${r + 0.5} ${cy - r * 0.05} q 0.4 ${r * 0.4} -0.6 ${r * 0.6}" stroke="${color}" stroke-width="${r * 0.2}" stroke-linecap="round" fill="none"/>`
  }
}

function face(r, cy) {
  const eye = r * 0.135
  return `
    <circle cx="${-r * 0.34}" cy="${cy + r * 0.12}" r="${eye}" fill="#1E2A32"/>
    <circle cx="${r * 0.34}" cy="${cy + r * 0.12}" r="${eye}" fill="#1E2A32"/>
    <path d="M ${-r * 0.3} ${cy + r * 0.46} q ${r * 0.3} ${r * 0.32} ${r * 0.6} 0" stroke="#1E2A32" stroke-width="${r * 0.11}" stroke-linecap="round" fill="none" opacity="0.85"/>
    <circle cx="${-r * 0.64}" cy="${cy + r * 0.38}" r="${r * 0.17}" fill="#FF6B5B" opacity="0.2"/>
    <circle cx="${r * 0.64}" cy="${cy + r * 0.38}" r="${r * 0.17}" fill="#FF6B5B" opacity="0.2"/>`
}

/* --------------------------------------------------------------- figures -- */

/**
 * @param {object} o
 * @param {number} o.x  ground X
 * @param {number} o.y  ground Y
 * @param {number} [o.s] scale (1 = 100 units tall)
 * @param {boolean} [o.flip]
 * @param {string} o.skin
 * @param {string} o.hair
 * @param {string} [o.hairStyle] short|bun|long|curly|afro|puffs|wrap
 * @param {string} o.top    shirt colour
 * @param {string} o.bottom trouser colour
 * @param {{left?:string,right?:string}} [o.pose] arm poses
 * @param {string} [o.extra] extra markup drawn in the figure's local space
 */
export function adult({
  x,
  y,
  s = 1,
  flip = false,
  skin,
  hair,
  hairStyle = 'short',
  top,
  bottom,
  pose = {},
  extra = '',
}) {
  const r = 11.5
  const cy = -86
  const a = arms(ADULT_ARM, { left: pose.left || 'rest', right: pose.right || 'rest' }, top, skin, 7)
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    ${groundShadow(15)}
    <path d="M -5.5 -44 L -5.5 -3 M 5.5 -44 L 5.5 -3" stroke="${bottom}" stroke-width="8" stroke-linecap="round"/>
    <path d="M -5.5 -2.5 L -9.5 -2.5 M 5.5 -2.5 L 9.5 -2.5" stroke="#1E2A32" stroke-width="5" stroke-linecap="round" opacity="0.8"/>
    ${a.limbs}
    <path d="M -13 -74 q 0 -4 4 -4.6 q 4.6 -1.2 9 -1.2 q 4.4 0 9 1.2 q 4 0.6 4 4.6 l 0 26 q 0 5 -5 5 l -16 0 q -5 0 -5 -5 z" fill="${top}"/>
    ${a.hands}
    <rect x="-3.2" y="-80" width="6.4" height="6" rx="3" fill="${skin}"/>
    ${hairBack(hairStyle, hair, r, cy)}
    <circle cx="0" cy="${cy}" r="${r}" fill="${skin}"/>
    ${hairFront(hairStyle, hair, r, cy)}
    ${face(r, cy)}
    ${extra}
  </g>`
}

/** As {@link adult}, but 66 units tall with a proportionally larger head. */
export function child({
  x,
  y,
  s = 1,
  flip = false,
  skin,
  hair,
  hairStyle = 'short',
  top,
  bottom,
  pose = {},
  extra = '',
}) {
  const r = 10
  const cy = -54
  const a = arms(CHILD_ARM, { left: pose.left || 'rest', right: pose.right || 'rest' }, top, skin, 6)
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    ${groundShadow(11)}
    <path d="M -4.4 -27 L -4.4 -2.5 M 4.4 -27 L 4.4 -2.5" stroke="${bottom}" stroke-width="7" stroke-linecap="round"/>
    <path d="M -4.4 -2 L -8 -2 M 4.4 -2 L 8 -2" stroke="#1E2A32" stroke-width="4.4" stroke-linecap="round" opacity="0.8"/>
    ${a.limbs}
    <path d="M -10 -44 q 0 -3.4 3.4 -4 q 3.4 -1 6.6 -1 q 3.2 0 6.6 1 q 3.4 0.6 3.4 4 l 0 15 q 0 4 -4 4 l -12 0 q -4 0 -4 -4 z" fill="${top}"/>
    ${a.hands}
    <rect x="-2.8" y="-49" width="5.6" height="5.5" rx="2.8" fill="${skin}"/>
    ${hairBack(hairStyle, hair, r, cy)}
    <circle cx="0" cy="${cy}" r="${r}" fill="${skin}"/>
    ${hairFront(hairStyle, hair, r, cy)}
    ${face(r, cy)}
    ${extra}
  </g>`
}

/* ----------------------------------------------------------------- props -- */

export const backpack = (color = BRAND.coral) => `
  <rect x="-15.5" y="-43" width="7.5" height="17" rx="3.4" fill="${color}"/>
  <rect x="-14.4" y="-38" width="5.2" height="4.2" rx="1.7" fill="#FFFFFF" opacity="0.55"/>`

export const phone = (x, y, s = 1, rot = 0) => `
  <g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <rect x="-4.6" y="-7.4" width="9.2" height="14.8" rx="2.3" fill="#1E2A32"/>
    <rect x="-3.5" y="-6.3" width="7" height="12.6" rx="1.6" fill="${BRAND.tint}"/>
    <circle cx="0" cy="-1.6" r="1.8" fill="${BRAND.teal}"/>
    <path d="M 0 0.5 L -1.6 3.4 L 1.6 3.4 Z" fill="${BRAND.teal}"/>
  </g>`

export const tablet = (x, y, s = 1) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-11" y="-8" width="22" height="16" rx="2.6" fill="#1E2A32"/>
    <rect x="-9.6" y="-6.7" width="19.2" height="13.4" rx="1.6" fill="#FFFFFF"/>
    <rect x="-7.6" y="-4.4" width="6" height="2" rx="1" fill="${BRAND.mint}"/>
    <rect x="-7.6" y="-1.2" width="11" height="2" rx="1" fill="${BRAND.amber}"/>
    <rect x="-7.6" y="2" width="8" height="2" rx="1" fill="${BRAND.violet}"/>
  </g>`

export const pin = (x, y, s = 1, color = BRAND.teal) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="14" rx="6" ry="2.2" fill="${BRAND.ink}" opacity="0.12"/>
    <path d="M 0 12 C 0 12 -9 -0.5 -9 -6.5 A 9 9 0 1 1 9 -6.5 C 9 -0.5 0 12 0 12 Z" fill="${color}"/>
    <circle cx="0" cy="-6.5" r="3.4" fill="#FFFFFF"/>
  </g>`

export const heart = (x, y, s = 1, color = BRAND.coral, opacity = 1) => `
  <path transform="translate(${x} ${y}) scale(${s})" opacity="${opacity}"
    d="M 0 7 C -6 2.2 -9 -0.6 -9 -4 A 4.6 4.6 0 0 1 0 -6.2 A 4.6 4.6 0 0 1 9 -4 C 9 -0.6 6 2.2 0 7 Z" fill="${color}"/>`

export const shrub = (x, y, s = 1, color = BRAND.mint) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="${color}">
    <circle cx="-6" cy="-5" r="7"/><circle cx="5" cy="-7.5" r="9"/><circle cx="13" cy="-4" r="6"/>
    <rect x="-13" y="-5" width="28" height="5" rx="2.5"/>
  </g>`

export const house = (x, y, s = 1) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-18" y="-24" width="36" height="24" rx="2.5" fill="#FFFFFF"/>
    <path d="M -23 -23 L 0 -40 L 23 -23 Z" fill="${BRAND.teal}"/>
    <rect x="-4.5" y="-12" width="9" height="12" rx="1.6" fill="${shade(BRAND.teal, 0.1)}"/>
    <circle cx="2.4" cy="-6" r="0.9" fill="${BRAND.mint}"/>
    <rect x="-14" y="-19" width="7" height="7" rx="1.4" fill="${BRAND.amberBg}" stroke="${BRAND.line}" stroke-width="0.6"/>
    <rect x="7" y="-19" width="7" height="7" rx="1.4" fill="${BRAND.amberBg}" stroke="${BRAND.line}" stroke-width="0.6"/>
    <path d="M -10.5 -19 L -10.5 -12 M -14 -15.5 L -7 -15.5" stroke="${BRAND.line}" stroke-width="0.6"/>
    <path d="M 10.5 -19 L 10.5 -12 M 7 -15.5 L 14 -15.5" stroke="${BRAND.line}" stroke-width="0.6"/>
  </g>`

export const cloud = (x, y, s = 1, opacity = 0.7) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="#FFFFFF" opacity="${opacity}">
    <circle cx="-11" cy="2" r="9"/><circle cx="0" cy="-3" r="12"/><circle cx="12" cy="2" r="9"/>
    <rect x="-20" y="2" width="40" height="9" rx="4.5"/>
  </g>`

/** A tiny bar-chart card, used as the "we can see the pattern" motif. */
export const statCard = (x, y, s = 1) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-19" y="-15" width="38" height="30" rx="6" fill="#FFFFFF"/>
    <rect x="-13" y="-9" width="17" height="3" rx="1.5" fill="${BRAND.line}"/>
    <rect x="-13" y="2" width="4.5" height="7" rx="1.6" fill="${BRAND.mint}"/>
    <rect x="-6.5" y="-2" width="4.5" height="11" rx="1.6" fill="${BRAND.teal}"/>
    <rect x="0" y="4" width="4.5" height="5" rx="1.6" fill="${BRAND.mint}"/>
    <rect x="6.5" y="-4" width="4.5" height="13" rx="1.6" fill="${BRAND.amber}"/>
  </g>`

/** A shield with a tick — the "protected" motif. */
export const shield = (x, y, s = 1, color = BRAND.teal) => `
  <g transform="translate(${x} ${y}) scale(${s})">
    <path d="M 0 -14 L 12 -9 L 12 2 C 12 9 6 14 0 16 C -6 14 -12 9 -12 2 L -12 -9 Z" fill="${color}"/>
    <path d="M -5 1 L -1.5 4.5 L 5.5 -3" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`

/* ---------------------------------------------------------------- scenes -- */

function disc(bg, inner) {
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img">
    <defs><clipPath id="c"><circle cx="100" cy="100" r="100"/></clipPath></defs>
    <g clip-path="url(#c)">
      <circle cx="100" cy="100" r="100" fill="${bg}"/>
      ${inner}
    </g>
  </svg>`
}

/** Flash card 1 — "Know they're safe, always". Parent checks in from a distance. */
export function sceneSafe() {
  const g = 172
  const ps = 1.04 // parent scale
  const hand = handAt('adult', 'right', 'phone')
  return disc(
    BRAND.tint,
    `
    <rect x="0" y="${g}" width="200" height="40" fill="#C6E9E1"/>
    ${shrub(38, g + 1, 0.58, '#9FDCD1')}
    ${shrub(160, g + 1, 0.5, '#9FDCD1')}
    ${adult({
      x: 62,
      y: g,
      s: ps,
      skin: SKIN.tan,
      hair: HAIR.espresso,
      hairStyle: 'bun',
      top: BRAND.teal,
      bottom: '#2F3B43',
      pose: { right: 'phone' },
    })}
    ${phone(62 + hand.x * ps + 4, g + hand.y * ps - 1, 1.15, 10)}
    <path d="M 92 106 Q 116 74 132 84" stroke="${BRAND.teal}" stroke-width="2.2" stroke-dasharray="4 5.5" stroke-linecap="round" fill="none" opacity="0.5"/>
    ${child({
      x: 134,
      y: g,
      s: 1.04,
      skin: SKIN.warm,
      hair: HAIR.black,
      hairStyle: 'puffs',
      top: BRAND.coral,
      bottom: '#3E4A50',
      pose: { left: 'wave' },
      extra: backpack('#FFB84D'),
    })}
    ${pin(134, 70, 0.8)}
    ${heart(40, 74, 0.62, BRAND.coral, 0.42)}
  `,
  )
}

/** Flash card 2 — "See their world, gently". Looking at the screen together. */
export function sceneGently() {
  const g = 174
  return disc(
    BRAND.amberBg,
    `
    <rect x="0" y="${g}" width="200" height="40" fill="#F2DCB8"/>
    ${shrub(40, g + 1, 0.5, '#EBCB97')}
    ${shrub(158, g + 1, 0.44, '#EBCB97')}
    ${adult({
      x: 72,
      y: g,
      s: 1.02,
      skin: SKIN.deep,
      hair: '#C0392B',
      hairStyle: 'wrap',
      top: '#8B7FD1',
      bottom: '#3E4A50',
      pose: { right: 'reach' },
    })}
    ${child({
      x: 122,
      y: g,
      s: 1.04,
      skin: SKIN.fair,
      hair: HAIR.auburn,
      hairStyle: 'curly',
      top: BRAND.amber,
      bottom: '#2F3B43',
      pose: { left: 'hold', right: 'hold' },
      extra: tablet(0, -33, 1.05),
    })}
    ${statCard(158, 72, 0.9)}
    <path d="M 140 104 Q 152 88 154 84" stroke="${BRAND.amber}" stroke-width="2.2" stroke-dasharray="4 5.5" stroke-linecap="round" fill="none" opacity="0.7"/>
  `,
  )
}

/**
 * Flash card 3 — "Set limits, together". The whole household.
 * Parents are drawn first so the kids overlap them: their arms then read as
 * resting behind the children rather than growing out of their heads.
 */
export function sceneTogether() {
  const g = 176
  return disc(
    BRAND.violetBg,
    `
    <rect x="0" y="${g}" width="200" height="40" fill="#D3CBEE"/>
    ${adult({
      x: 58,
      y: g,
      s: 0.96,
      skin: SKIN.light,
      hair: HAIR.sand,
      hairStyle: 'long',
      top: BRAND.teal,
      bottom: '#3E4A50',
      pose: { right: 'hug' },
    })}
    ${adult({
      x: 144,
      y: g,
      s: 0.99,
      flip: true,
      skin: SKIN.rich,
      hair: HAIR.black,
      hairStyle: 'afro',
      top: BRAND.amber,
      bottom: '#2F3B43',
      pose: { right: 'hug' },
    })}
    ${child({
      x: 89,
      y: g,
      s: 0.94,
      skin: SKIN.fair,
      hair: HAIR.brown,
      hairStyle: 'short',
      top: BRAND.mint,
      bottom: '#2F3B43',
    })}
    ${child({
      x: 115,
      y: g,
      s: 0.8,
      skin: SKIN.warm,
      hair: HAIR.black,
      hairStyle: 'curly',
      top: BRAND.coral,
      bottom: '#3E4A50',
    })}
    ${heart(101, 46, 0.8, BRAND.violet, 0.7)}
    ${heart(72, 60, 0.5, BRAND.coral, 0.4)}
    ${heart(130, 56, 0.55, BRAND.teal, 0.36)}
  `,
  )
}

/**
 * Wide hero used on the brochure and flyer — the same household, at home,
 * with the safety motif made explicit.
 */
export function sceneHero() {
  const g = 256 // ground line
  const ps = 1.5 // parent scale — 150 units tall
  const hand = handAt('adult', 'right', 'phone')
  return `<svg viewBox="0 0 560 300" xmlns="http://www.w3.org/2000/svg" role="img">
    <defs>
      <linearGradient id="nestly-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BRAND.tint}"/>
        <stop offset="100%" stop-color="#F5FBF9"/>
      </linearGradient>
    </defs>
    <rect width="560" height="300" fill="url(#nestly-sky)"/>
    ${cloud(96, 52, 1.05, 0.75)}
    ${cloud(468, 44, 0.85, 0.6)}
    <rect x="0" y="${g}" width="560" height="44" fill="#C6E9E1"/>
    ${house(72, g, 2.4)}
    ${shrub(150, g + 1, 1.05, '#9FDCD1')}
    ${shrub(508, g + 1, 1.15, '#9FDCD1')}
    ${adult({
      x: 232,
      y: g,
      s: ps,
      skin: SKIN.tan,
      hair: HAIR.espresso,
      hairStyle: 'bun',
      top: BRAND.teal,
      bottom: '#2F3B43',
      pose: { right: 'hug' },
    })}
    ${adult({
      x: 400,
      y: g,
      s: ps,
      flip: true,
      skin: SKIN.rich,
      hair: HAIR.black,
      hairStyle: 'afro',
      top: '#8B7FD1',
      bottom: '#3E4A50',
      pose: { right: 'phone' },
    })}
    ${phone(400 - (hand.x * ps + 6), g + hand.y * ps - 2, 1.75, -10)}
    ${child({
      x: 292,
      y: g,
      s: 1.4,
      skin: SKIN.warm,
      hair: HAIR.black,
      hairStyle: 'puffs',
      top: BRAND.coral,
      bottom: '#3E4A50',
      extra: backpack('#FFB84D'),
    })}
    ${child({
      x: 344,
      y: g,
      s: 1.18,
      skin: SKIN.fair,
      hair: HAIR.auburn,
      hairStyle: 'curly',
      top: BRAND.mint,
      bottom: '#2F3B43',
    })}
    ${pin(292, 128, 1.15)}
    ${shield(492, 172, 1.9)}
    ${heart(176, 138, 1.0, BRAND.coral, 0.38)}
    ${heart(452, 108, 0.8, BRAND.violet, 0.38)}
  </svg>`
}

export const SCENES = {
  safe: sceneSafe,
  gently: sceneGently,
  together: sceneTogether,
  hero: sceneHero,
}
