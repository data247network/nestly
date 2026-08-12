/**
 * The smallest Stripe client that does the job.
 *
 * Stripe's own SDK is a Node library; the versions that run under Deno pull in a
 * large dependency tree for what is, at the level this project uses it, three
 * POST requests and a signature check. This is that, and nothing else.
 *
 * The one genuinely fiddly part is the encoding. Stripe's API is
 * form-urlencoded, not JSON, and nested values go in bracket notation —
 * `line_items[0][price_data][currency]=gbp`. Hand-writing those keys is how you
 * end up silently sending a flat field Stripe ignores.
 */

const API = "https://api.stripe.com/v1"

/**
 * Pinned rather than floating.
 *
 * Stripe changes response shapes between versions, and an account whose default
 * version moves would otherwise change what this code receives without a deploy.
 */
export const STRIPE_API_VERSION = "2024-06-20"

export function stripeKey(): string | null {
  const key = Deno.env.get("STRIPE_SECRET_KEY")?.trim()
  return key && key.length > 0 ? key : null
}

/** Flattens into Stripe's bracket notation. */
export function encodeForm(value: unknown, key = "", out: string[] = []): string[] {
  if (value === null || value === undefined) return out

  if (Array.isArray(value)) {
    value.forEach((v, i) => encodeForm(v, `${key}[${i}]`, out))
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      encodeForm(v, key ? `${key}[${k}]` : k, out)
    }
  } else {
    out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return out
}

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/**
 * One Stripe call.
 *
 * `idempotencyKey` is worth passing on anything that creates or charges.
 * Retrying a create without one is how a customer ends up with two
 * subscriptions for one click.
 */
export async function stripeRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<T> {
  const key = stripeKey()
  if (!key) throw new StripeError("Stripe is not configured.", 503)

  const method = init.method ?? "POST"
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_API_VERSION,
  }
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded"
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey

  const res = await fetch(`${API}/${path}`, {
    method,
    headers,
    body: method === "POST" && init.body ? encodeForm(init.body).join("&") : undefined,
  })

  const out = (await res.json().catch(() => ({}))) as
    & { error?: { message?: string; code?: string } }
    & T

  if (!res.ok) {
    throw new StripeError(out.error?.message ?? `Stripe refused the request (${res.status}).`, res.status)
  }
  return out as T
}

/* -------------------------------------------------------------- signature -- */

/** Constant-time compare, so a wrong signature cannot be found byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** Stripe rejects anything older than this, and so should we — it is replay defence. */
const TOLERANCE_SECONDS = 300

/**
 * Verifies a `Stripe-Signature` header against the raw request body.
 *
 * Two things are easy to get wrong and both fail closed in the same
 * indistinguishable way. The signature covers `timestamp.rawBody`, so the body
 * must be the exact bytes received — re-serialising the parsed JSON changes key
 * order and whitespace and never matches. And the header can carry several `v1`
 * signatures during a secret rotation, so any one matching is a pass.
 */
export async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  let timestamp = ""
  const candidates: string[] = []

  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name === "t") timestamp = value
    else if (name === "v1") candidates.push(value)
  }

  if (!timestamp || candidates.length === 0) return false

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${rawBody}`)),
  )
  const expected = hex(mac)

  return candidates.some((candidate) => safeEqual(candidate.toLowerCase(), expected))
}
