import { describe, expect, it } from 'vitest'
import {
  LOW_BATTERY_INTERVAL_MS,
  LOW_BATTERY_PERCENT,
  TELEMETRY_INTERVAL_MS,
  isUrgent,
  pushInterval,
} from './cloudUplink'
import type { ChildEvent } from '../link/protocol'

const ev = (kind: ChildEvent['kind']): ChildEvent => ({ seq: 1, ts: 0, kind })

/**
 * The cadence is a safety judgement, not a tuning constant: too slow and a
 * parent learns about a zone exit late, too fast and the phone is flat by
 * lunchtime. These pin the decisions so a future edit has to mean it.
 */
describe('cloud uplink pacing', () => {
  it('sends the events a parent installed this for without waiting', () => {
    expect(isUrgent([ev('zone-leave')])).toBe(true)
    expect(isUrgent([ev('filter-off')])).toBe(true)
    expect(isUrgent([ev('contact-added')])).toBe(true)
    expect(isUrgent([ev('battery-low')])).toBe(true)
  })

  it('lets routine chatter ride the next batch', () => {
    expect(isUrgent([ev('agent-start')])).toBe(false)
    expect(isUrgent([ev('scenario-start')])).toBe(false)
    expect(isUrgent([ev('lock-shown')])).toBe(false)
    expect(isUrgent([])).toBe(false)
  })

  it('treats a mixed batch as urgent if anything in it is', () => {
    expect(isUrgent([ev('agent-start'), ev('zone-enter')])).toBe(true)
  })

  it('backs off when the battery is nearly gone', () => {
    // A phone that dies is worse for safety than a location five minutes old.
    expect(pushInterval(LOW_BATTERY_PERCENT)).toBe(LOW_BATTERY_INTERVAL_MS)
    expect(pushInterval(5)).toBe(LOW_BATTERY_INTERVAL_MS)
    expect(pushInterval(LOW_BATTERY_PERCENT + 1)).toBe(TELEMETRY_INTERVAL_MS)
  })

  it('uses the normal interval when the battery is unknown', () => {
    // Unknown must not be read as empty, or a device that cannot report its
    // battery would quietly drop to one update every five minutes.
    expect(pushInterval(null)).toBe(TELEMETRY_INTERVAL_MS)
  })
})
