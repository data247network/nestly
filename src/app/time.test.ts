import { describe, expect, it } from 'vitest'
import { stamp } from './time'

/**
 * The bug this pins: alerts and the activity trail showed a bare "16:42" with
 * no date, so three rows from three different days read identically and the
 * obvious interpretation — all of this happened today — was wrong.
 */
describe('stamp', () => {
  const now = new Date('2026-08-14T18:00:00')
  const at = (iso: string) => stamp(new Date(iso).getTime(), now)

  it('shows the time alone while it is still today', () => {
    // A date on every row would be noise for the rows that need it least.
    expect(at('2026-08-14T16:42:00')).not.toMatch(/Aug|Yesterday/)
    expect(at('2026-08-14T16:42:00')).toMatch(/16:42|4:42/)
  })

  it('names yesterday rather than dating it', () => {
    expect(at('2026-08-13T16:42:00')).toMatch(/^Yesterday /)
  })

  it('dates anything older', () => {
    expect(at('2026-08-11T16:42:00')).toMatch(/11 Aug/)
  })

  it('adds the year only once it is not this one', () => {
    expect(at('2026-01-03T09:00:00')).not.toMatch(/2026/)
    expect(at('2025-12-30T09:00:00')).toMatch(/2025/)
  })

  it('does not call the same clock time yesterday just because the hour matches', () => {
    // The trap in a naive implementation: comparing hours and minutes, or
    // subtracting 24 hours from `now` rather than from the calendar day.
    expect(at('2026-08-14T00:05:00')).not.toMatch(/Yesterday/)
    expect(at('2026-08-13T23:55:00')).toMatch(/^Yesterday /)
  })
})
