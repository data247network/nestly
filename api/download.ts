/**
 * The download link, routed through Vercel so the country is known.
 *
 * `app_downloads` had a `country` column and no way to fill it. The button was
 * a plain link to a static file, so nothing of ours ran; and when the click was
 * pointed straight at the Supabase function instead, the country was still null
 * — Supabase's gateway strips inbound geo headers, which is right (a client
 * that can set `cf-ipcountry` can set it to anything) and leaves the function
 * with nothing to read.
 *
 * Vercel does know. It injects `x-vercel-ip-country` on every request that
 * reaches a function of its own, derived at the edge from the connection rather
 * than from anything the browser said. So the download goes through here: the
 * country is read, the row is recorded, and the request is redirected to the
 * file. The user sees a download; the extra hop costs one redirect.
 *
 * **Deliberately not a hard dependency.** If the recorder is unreachable the
 * redirect still happens. Somebody installing the app their child's safety
 * depends on must never be stopped by our analytics, and the counter is worth
 * exactly nothing next to that.
 *
 * No personal data. Not the IP, not the user agent — the question is "how many,
 * from where", and an address would turn an anonymous tally into a record of
 * who downloaded a child-monitoring app.
 */

export const config = { runtime: 'edge' }

const APK = '/downloads/nestly.apk'

/** Bounded so a slow recorder cannot hold up a download. */
const RECORD_TIMEOUT_MS = 1500

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const asked = (url.searchParams.get('variant') ?? '').toLowerCase()
  const variant = asked === 'parent' || asked === 'child' ? asked : 'unknown'

  // Two letters, uppercase, and not one of the placeholders Cloudflare and
  // Vercel use for "we do not know" — those are absence dressed as data.
  const raw = req.headers.get('x-vercel-ip-country')?.trim().toUpperCase() ?? ''
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : null

  const supabase = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (supabase && key) {
    try {
      await fetch(`${supabase}/functions/v1/log-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({ variant, country }),
        signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
      })
    } catch {
      // Unreachable, slow, or misconfigured. The download is what matters.
    }
  }

  // 302, not 301. A permanent redirect would be cached by the browser and every
  // later download would skip this function entirely — the counter would show a
  // burst of installs on day one and silence afterwards, which reads as a
  // product nobody wants rather than a caching mistake.
  return Response.redirect(new URL(APK, url.origin), 302)
}
