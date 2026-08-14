import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Records that somebody downloaded the app.
 *
 * `app_downloads` has existed since the admin dashboard was built and has never
 * had a row in it, which is why the dashboard reads "0" and "Country comes from
 * download requests; none recorded yet." Nothing was writing to it — the
 * download button is a plain `<a href download>` pointing at a static file on
 * Vercel, so no code of ours runs when it is clicked, on either end.
 *
 * Hence this. The page calls it and then follows the link regardless; the
 * download must never wait on, or be prevented by, our own analytics.
 *
 * The country comes from the *request*, not from the browser. A client-supplied
 * country is a client-supplied opinion, and this is the one field on the
 * dashboard that would be quietly and permanently wrong if it were guessed.
 * When the edge does not tell us, the row is stored with a null country rather
 * than a guess — "unknown" is a fact and "GB" would be a fiction.
 *
 * No personal data is kept. Not the IP, not a user agent, not an identifier:
 * the question this answers is "how many, from where", and an address would
 * make an anonymous counter into a log of who downloaded a child-monitoring app.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })

/** Which button. Anything else is recorded as `unknown` rather than rejected. */
const VARIANTS = new Set(["parent", "child", "unknown"])

/**
 * Where the edge tells us the request came from.
 *
 * Several names because the answer depends on what is in front of the function
 * on any given day, and a country column that silently went null after an
 * infrastructure change would look exactly like a quiet month.
 */
function valid(raw: string | null | undefined): string | null {
  const value = raw?.trim().toUpperCase()
  // "XX" and "T1" are what Cloudflare returns for unknown and for Tor; both are
  // absence dressed as data.
  if (!value || !/^[A-Z]{2}$/.test(value) || value === "XX" || value === "T1") return null
  return value
}

/**
 * Where the request came from.
 *
 * Headers first, and they are the trustworthy source — an edge sets them from
 * the connection, and Supabase's gateway strips any the client tried to send.
 * In practice it strips *all* of them, which is why the body is read at all:
 * the portal's `/api/download` route on Vercel is the only place in this stack
 * that is told the country, so it passes on what it was given.
 *
 * That makes the body value only as honest as its caller, and a browser posting
 * here directly could claim anything. Acceptable for a download tally that
 * nobody is billed on; it would not be acceptable for anything else, and this
 * function deliberately records nothing else.
 */
function countryOf(req: Request, fromBody: string | null): string | null {
  for (const name of ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"]) {
    const value = valid(req.headers.get(name))
    if (value) return value
  }
  return valid(fromBody)
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let variant = "unknown"
  let bodyCountry: string | null = null
  try {
    const body = (await req.json()) as { variant?: string; country?: string }
    const asked = String(body.variant ?? "").toLowerCase()
    if (VARIANTS.has(asked)) variant = asked
    bodyCountry = typeof body.country === "string" ? body.country : null
  } catch {
    // A body that will not parse is still a download. Counting it as one of
    // unknown provenance beats losing it.
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  const { error } = await admin.from("app_downloads").insert({
    at: new Date().toISOString(),
    variant,
    country: countryOf(req, bodyCountry),
  })

  // Always 200. The caller is a page that is about to start a download, and
  // there is nothing useful it could do with a failure here — reporting one
  // would only invite somebody to make the download conditional on it.
  if (error) console.error("log-download: insert failed —", error.message)
  return json({ ok: true })
})
