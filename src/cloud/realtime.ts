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
 * have entered the subscribed state. React effect cleanup/re-run can overlap
 * with channel removal, so deterministic names can accidentally reuse a
 * subscribed channel. Every subscription gets a unique channel instance.
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

/** Locate has the same lifecycle rules as the household stream. */
export function subscribeToLocateSafe(childId: string, onChange: () => void): () => void {
  if (!hasCloud() || !childId) return () => {}
  const db = supabase()
  const channel = db
    .channel(uniqueChannelName(`locate-${childId}`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'locate_requests', filter: `child_id=eq.${childId}` },
      () => onChange(),
    )
  channel.subscribe()

  let removed = false
  return () => {
    if (removed) return
    removed = true
    void db.removeChannel(channel)
  }
}
