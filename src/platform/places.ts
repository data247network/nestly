/**
 * Turns coordinates into somewhere a parent recognises.
 *
 * "5.56598, 5.80290" is precise and useless: it answers *where* in a way no
 * human reads, and the question a parent is actually asking is "is that near
 * her school?". This resolves a nearby street and landmark so the answer is
 * legible at a glance.
 *
 * Uses OpenStreetMap's Nominatim, which needs no API key and no billing
 * account. That matters more than accuracy here — a key would be one more
 * secret to manage and one more thing to expire silently.
 *
 * DELIBERATELY ON DEMAND. Nominatim's usage policy allows about one request a
 * second, and continuously geocoding a moving child would both breach it and
 * spend a family's data to relabel the same street repeatedly. This is called
 * when a parent taps Locate, and the answer is cached.
 */

export type Place = {
  /** One line, already shortened for display. */
  label: string
  /** The fuller address, for the detail line. */
  detail?: string
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'

/**
 * Cache keyed on coordinates rounded to ~11 metres.
 *
 * A stationary phone reports a slightly different fix every minute; without
 * rounding, every one would look like a new place and trigger a fresh lookup
 * for a child who has not moved.
 */
const cache = new Map<string, Place | null>()

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

/**
 * Best-effort. Returns null rather than throwing, because a missing place name
 * must never break a location display — the coordinates are still shown, and
 * they are the part that matters if this fails.
 */
export async function describePlace(lat: number, lng: number): Promise<Place | null> {
  const key = cacheKey(lat, lng)
  if (cache.has(key)) return cache.get(key) ?? null

  try {
    const url = `${ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    const res = await fetch(url, {
      headers: {
        // Nominatim requires callers to identify themselves. An anonymous
        // client is blocked, and rightly so.
        'Accept-Language': 'en',
      },
    })
    if (!res.ok) {
      cache.set(key, null)
      return null
    }

    const body = (await res.json()) as {
      name?: string
      display_name?: string
      address?: Record<string, string>
    }

    const place = summarise(body)
    cache.set(key, place)
    return place
  } catch {
    // Offline, rate-limited, or blocked. Not worth a retry loop: the parent
    // still has coordinates and a map.
    cache.set(key, null)
    return null
  }
}

/**
 * Picks the most recognisable parts of an address.
 *
 * Nominatim returns everything from house number to country. A parent wants the
 * landmark and the street — "St Mary's School, Airport Road" — not a postal
 * address, and certainly not the country they are standing in.
 */
function summarise(body: {
  name?: string
  display_name?: string
  address?: Record<string, string>
}): Place {
  const a = body.address ?? {}

  // A named feature is the best answer when there is one: schools, shops and
  // places of worship are how people describe where they are.
  const landmark =
    body.name?.trim() ||
    a.amenity ||
    a.school ||
    a.shop ||
    a.building ||
    a.place_of_worship ||
    ''

  const street = a.road || a.pedestrian || a.footway || ''
  const area = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || ''

  const parts = [landmark, street, area].filter(Boolean)
  // Duplicates are common — a road named after the suburb it runs through.
  const unique = parts.filter((p, i) => parts.indexOf(p) === i)

  if (unique.length === 0) {
    // Fall back to the first two components of the full string rather than
    // showing the whole thing, which runs to the country and postcode.
    const rough = (body.display_name ?? '').split(',').slice(0, 2).join(',').trim()
    return { label: rough || 'Unnamed place' }
  }

  return {
    label: unique.slice(0, 2).join(', '),
    detail: unique.length > 2 ? unique.slice(2).join(', ') : undefined,
  }
}
