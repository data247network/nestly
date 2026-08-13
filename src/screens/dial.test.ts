import { describe, expect, it } from 'vitest'
import { dialHref } from './child'

/**
 * The emergency call button.
 *
 * This is the one control in the product that has to work when everything else
 * has failed, and it silently did not: the number was percent-encoded, so
 * Android opened an empty dialer and no call was placed. Numbers arrive from a
 * parent typing into a form, so they carry spaces, brackets and dashes — the
 * formats below are the ones people actually enter.
 */
describe('dialHref', () => {
  it('keeps a leading + and strips the spacing around it', () => {
    expect(dialHref('+234 801 234 5678')).toBe('tel:+2348012345678')
  })

  it('handles the bracketed and dashed forms people type', () => {
    expect(dialHref('(0801) 234-5678')).toBe('tel:08012345678')
    expect(dialHref('+44 (0)20 7946 0958')).toBe('tel:+442079460958')
  })

  it('leaves a plain national number alone', () => {
    expect(dialHref('08012345678')).toBe('tel:08012345678')
  })

  it('keeps short codes and extension characters a dialer needs', () => {
    expect(dialHref('*123#')).toBe('tel:*123#')
    expect(dialHref('0800 111 222,,456')).toBe('tel:0800111222,,456')
  })

  it('only treats + as international in first position', () => {
    // A stray + mid-number is a typo, not a country code, and leaving it in
    // makes the whole string unparseable.
    expect(dialHref('0801+2345678')).toBe('tel:08012345678')
  })

  it('never emits a percent escape, which is what broke it', () => {
    expect(dialHref('+234 801 234 5678')).not.toContain('%')
  })
})
