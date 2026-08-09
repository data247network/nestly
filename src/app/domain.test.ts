import { describe, expect, it } from 'vitest'
import { normaliseDomain } from './store'

/**
 * A blocklist entry that does not match anything fails silently — the parent
 * believes a site is blocked and it is not. That makes this small function
 * worth pinning down.
 */
describe('domain normalisation', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['www.example.com', 'example.com'],
    ['https://example.com', 'example.com'],
    ['http://www.example.com/some/path', 'example.com'],
    ['https://example.com:8443/x?y=1#z', 'example.com'],
    ['sub.example.co.uk', 'sub.example.co.uk'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['notadomain', 'no dot'],
    ['http://', 'scheme only'],
    ['.com', 'no label'],
  ])('rejects %s (%s)', (input) => {
    expect(normaliseDomain(input)).toBe('')
  })

  it('strips a userinfo prefix rather than keeping it', () => {
    expect(normaliseDomain('https://user@example.com/path')).toBe('example.com')
  })
})
