import { hasCloud, supabase } from './client'

export type CloudRosterChild = {
  id: string
  name: string
  avatar: string
  enrolledAt: string | null
}

/**
 * Minimal household roster used by communication/control bridges.
 *
 * It deliberately does not join telemetry, events, usage or billing. A notes
 * channel or policy update must not disappear because an unrelated dashboard
 * aggregate failed. The roster is the minimum information needed to address a
 * specific child over the cloud.
 */
export async function loadCloudRoster(householdId: string): Promise<CloudRosterChild[]> {
  if (!hasCloud()) return []
  const { data, error } = await supabase()
    .from('children')
    .select('id, name, avatar, enrolled_at')
    .eq('household_id', householdId)
    .order('name')
  if (error) throw error

  return (data ?? []).map((child) => ({
    id: child.id as string,
    name: child.name as string,
    avatar: (child.avatar as string) ?? '#147D77',
    enrolledAt: (child.enrolled_at as string) ?? null,
  }))
}
