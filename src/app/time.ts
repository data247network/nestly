/**
 * When something happened, written the way a person reads it.
 *
 * The alerts feed and the activity trail both showed a bare clock — "16:42" —
 * and both froze it at ingest. On a phone that had been out of range since
 * yesterday that is not merely terse, it is wrong: a parent looking at three
 * rows reading 16:42, 16:42, 16:41 has no way to tell whether that was an hour
 * ago or last Tuesday, and the obvious reading is the wrong one.
 *
 * So: the time alone while it is still today, because the date would be noise;
 * the day as soon as it is not.
 */
export function stamp(ts: number, now = new Date()): string {
  const then = new Date(ts)
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay(then, now)) return time

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(then, yesterday)) return `Yesterday ${time}`

  const date = then.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    // The year only once it is not this one — otherwise it is four characters
    // of noise on every row for eleven months of the year.
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${date}, ${time}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  )
}
