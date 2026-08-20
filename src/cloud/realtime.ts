import { hasCloud, supabase } from './client'

type ChildTable = 'child_telemetry' | 'child_events' | 'child_usage'

let channelSequence = 0

function uniqueChannelName(prefix: string): string {
  channelSequence += 1
  return `${prefix}-${Date.now()}-${channelSequence}`
}

/**
 * Creates the household realtime channel with every postgres_changes handler
 * attached before subscribe().
 *
 * Supabase channels cannot accept new postgres_changes callbacks after they
 * have entered the subscribed state. React StrictMode and dependency-driven
 * effect cleanup/re-run can briefly overlap removeChannel() with a new
 * subscription. Reusing a deterministic channel name in that window can make
 * Supabase return the existing subscribed channel, after which `.on()` throws
 * and React's root boundary turns the whole app into a blank/recovery screen.
 * A unique channel per subscription avoids that race; cleanup still removes
 * the exact channel instance that was created here.
 */
export function subscribeToChildrenSafe(
  childIds: string[],
  onChange: (table: ChildTable) => void,
): () => void {
  if (!hasCloud() || childIds.length === 0) return () => {}

  const db = supabase()
  const inList = `in.(${childIds.join(',')})`
  const channel = db.channel(uniqueChannelName(`household-${childIds[0]}`))

  for (const table of ['child_telemetry', 'child_events', 'child_usage'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `child_id=${inList}` },
      () => onChange(table),
    )
  }

  channel.subscribe()

  let removed = false
  return () => {
    if (removed) return
    removed = true
    void db.removeChannel(channel)
  }
}
