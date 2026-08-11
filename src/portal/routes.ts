/**
 * The public web surface, which is a different product from the app.
 *
 * Everything here is reachable with no account and no device. That is the whole
 * point: a parent evaluating Nestly, and a child following a setup link, both
 * arrive as strangers. The app's own router starts *after* a role has been
 * chosen, so it cannot serve either of them.
 *
 * Matched on pathname rather than a router library — three static routes and one
 * parameter do not justify the dependency, and Vercel already rewrites every
 * path to index.html.
 */
export type PortalRoute =
  | { name: 'landing' }
  | { name: 'download' }
  /** A child following the link their parent sent. Code may be absent. */
  | { name: 'setup'; code: string | null }
  | { name: 'signin' }
  | { name: 'signup' }
  /** Family Hub on the web. Requires a session; redirects to sign-in without. */
  | { name: 'hub' }

/**
 * Codes are read off a phone screen and typed by a child, so the alphabet
 * excludes I, O, 0 and 1. Mirrors the server's, and normalises the dashes and
 * spaces people add when a grouped code is copied.
 */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function matchPortal(pathname: string, search = ''): PortalRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path === '/' || path === '/home') return { name: 'landing' }
  if (path === '/download' || path === '/downloads') return { name: 'download' }
  if (path === '/signin' || path === '/login') return { name: 'signin' }
  if (path === '/signup' || path === '/join') return { name: 'signup' }
  if (path === '/hub' || path === '/family') return { name: 'hub' }

  // Both shapes work. `/setup/ABCD1234` is what a shared link looks like;
  // `/setup?code=` is what a QR scanner or an email client is liable to produce
  // after it rewrites the path.
  const inPath = /^\/setup(?:\/([A-Za-z0-9-]+))?$/.exec(path)
  if (inPath) {
    const fromQuery = new URLSearchParams(search).get('code')
    const raw = inPath[1] ?? fromQuery ?? ''
    const code = normaliseCode(raw)
    return { name: 'setup', code: code.length === 8 ? code : null }
  }

  return null
}
