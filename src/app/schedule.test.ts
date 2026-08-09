import { describe, expect, it } from 'vitest'
import { describeSchedule } from './store'
import type { Scenario } from './types'

const base: Scenario = {
  id: 'x',
  name: 'Test',
  days: [0, 1, 2, 3, 4],
  fromMin: 8 * 60,
  toMin: 15 * 60,
  enabled: true,
  blocks: { games: true, social: true, messaging: false },
}

describe('schedule summary', () => {
  it('recognises weekdays', () => {
    expect(describeSchedule(base)).toBe('Weekdays · 8:00 AM – 3:00 PM')
  })

  it('recognises every day', () => {
    expect(describeSchedule({ ...base, days: [0, 1, 2, 3, 4, 5, 6] })).toContain('Every day')
  })

  it('recognises weekends', () => {
    expect(describeSchedule({ ...base, days: [5, 6] })).toContain('Weekends')
  })

  it('lists individual days otherwise', () => {
    expect(describeSchedule({ ...base, days: [1, 3] })).toContain('Tue/Thu')
  })

  it('says so when no days are selected', () => {
    expect(describeSchedule({ ...base, days: [] })).toContain('No days set')
  })

  it('flags a window that runs past midnight', () => {
    const s = describeSchedule({ ...base, fromMin: 21 * 60, toMin: 7 * 60 })
    expect(s).toContain('9:00 PM – 7:00 AM')
    expect(s).toContain('overnight')
  })

  it('does not flag a same-day window as overnight', () => {
    expect(describeSchedule(base)).not.toContain('overnight')
  })
})
