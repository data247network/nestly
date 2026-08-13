import { describe, expect, it } from 'vitest'
import { encodeForm, safeEqual, verifySignature } from './stripe.ts'

/**
 * The two pieces of the Stripe integration that fail silently.
 *
 * A wrong `encodeForm` does not throw — Stripe ignores parameters it does not
 * recognise, so a mis-nested key produces a checkout that is subtly not the one
 * intended, at a price nobody chose. And a wrong `verifySignature` either
 * rejects every genuine webhook (payments never apply) or, far worse, accepts a
 * forged one, which is the whole security boundary of the endpoint.
 *
 * Runs under vitest rather than Deno because it exercises only the pure
 * helpers; nothing here touches `Deno.env`.
 */

/** Builds the header Stripe would send, so the verifier is tested against real input. */
async function sign(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`)),
  )
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp},v1=${hex}`
}

describe('encodeForm', () => {
  it('encodes flat values', () => {
    expect(encodeForm({ mode: 'subscription', quantity: 1 }).join('&')).toBe(
      'mode=subscription&quantity=1',
    )
  })

  it('nests objects in bracket notation', () => {
    expect(encodeForm({ metadata: { reference: 'nestly-1', period: 'annual' } }).join('&')).toBe(
      'metadata%5Breference%5D=nestly-1&metadata%5Bperiod%5D=annual',
    )
  })

  it('indexes arrays, which is what line_items actually needs', () => {
    const encoded = decodeURIComponent(
      encodeForm({
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'gbp',
              unit_amount: 499,
              recurring: { interval: 'month' },
              product_data: { name: 'Nestly Pro' },
            },
          },
        ],
      }).join('&'),
    )

    expect(encoded).toBe(
      'line_items[0][quantity]=1&' +
        'line_items[0][price_data][currency]=gbp&' +
        'line_items[0][price_data][unit_amount]=499&' +
        'line_items[0][price_data][recurring][interval]=month&' +
        'line_items[0][price_data][product_data][name]=Nestly Pro',
    )
  })

  it('drops null and undefined rather than sending the string "undefined"', () => {
    expect(encodeForm({ customer: undefined, customer_email: null, mode: 'subscription' })).toEqual([
      'mode=subscription',
    ])
  })

  it('escapes values that would otherwise break the encoding', () => {
    expect(encodeForm({ name: 'Nestly Pro & Co', url: 'https://x.test/a?b=c' }).join('&')).toBe(
      'name=Nestly%20Pro%20%26%20Co&url=https%3A%2F%2Fx.test%2Fa%3Fb%3Dc',
    )
  })
})

describe('verifySignature', () => {
  const secret = 'whsec_testsecret'
  const body = '{"id":"evt_1","type":"invoice.paid"}'

  it('accepts a genuine signature', async () => {
    expect(await verifySignature(body, await sign(body, secret), secret)).toEqual({ ok: true })
  })

  it('rejects a tampered body', async () => {
    const header = await sign(body, secret)
    const forged = '{"id":"evt_1","type":"customer.subscription.deleted"}'
    expect(await verifySignature(forged, header, secret)).toEqual({
      ok: false,
      reason: 'digest-mismatch',
    })
  })

  // The one that actually bit: Stripe delivered, this returned 401, and the
  // reason is what separates "wrong secret" from "not Stripe calling".
  it('reports digest-mismatch for a signature made with a different secret', async () => {
    expect(await verifySignature(body, await sign(body, 'whsec_wrong'), secret)).toEqual({
      ok: false,
      reason: 'digest-mismatch',
    })
  })

  it('rejects a stale timestamp, which is what stops a replay', async () => {
    const old = Math.floor(Date.now() / 1000) - 600
    const result = await verifySignature(body, await sign(body, secret, old), secret)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'stale' })
    expect((result as { ageSeconds: number }).ageSeconds).toBeGreaterThanOrEqual(600)
  })

  it('accepts when any one v1 matches, as during a secret rotation', async () => {
    const genuine = await sign(body, secret)
    const timestamp = genuine.split(',')[0].slice(2)
    const stale = (await sign(body, 'whsec_previous', Number(timestamp))).split(',')[1]
    expect(await verifySignature(body, `${genuine},${stale}`, secret)).toEqual({ ok: true })
  })

  it('distinguishes a missing header from a malformed one', async () => {
    expect(await verifySignature(body, '', secret)).toEqual({ ok: false, reason: 'no-header' })
    expect(await verifySignature(body, `t=${Math.floor(Date.now() / 1000)}`, secret)).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(await verifySignature(body, 'garbage', secret)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('safeEqual', () => {
  it('compares without leaking length or content through early exit', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
