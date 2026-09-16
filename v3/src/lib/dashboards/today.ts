import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The counts behind Today.
 *
 * Only things waiting on a person. Anything that is merely in flight belongs to
 * `/work`, anything that measures belongs to `/numbers`, and neither is loaded
 * here — the split is the point, and the cheapest way to keep it is for this
 * file to have no query that could answer "how are we doing".
 *
 * Every loader throws on a failed query. A section then renders an error rather
 * than a zero, because "nothing is waiting" and "we could not ask" must never
 * look the same on a screen somebody clears their morning against.
 */

/** How long a weaver may sit on an order before it is worth chasing. */
const STALE_DAYS = 3

export interface OrderDecisions {
  /** Sent, not yet accepted by the weaver. */
  issued: number
  /** Of those, the ones that have waited longer than a weaver normally takes. */
  issuedStale: number
}

function staleBefore(now: Date): string {
  return new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/** Orders waiting on a weaver to accept, and how many have waited too long. */
export async function loadOrderDecisions(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<OrderDecisions> {
  const head = () => supabase.from('orders').select('id', { count: 'exact', head: true })
  const [issued, stale] = await Promise.all([
    head().eq('status', 'issued'),
    head().eq('status', 'issued').lt('issued_at', staleBefore(now)),
  ])

  const failed = [issued, stale].find((r) => r.error)?.error
  if (failed) throw new Error(`Could not count orders: ${failed.message}`)

  return { issued: issued.count ?? 0, issuedStale: stale.count ?? 0 }
}

export interface AdminQueue {
  signups: number
  unidentified: number
  unnamedCodes: number
}

/**
 * The three queues only the owner can clear: a login to grant, a design with no
 * weaver against it, a code in a SKU nobody has named yet. Each blocks somebody
 * else's work, which is what keeps them on Today rather than in a settings area.
 */
export async function loadAdminQueue(supabase: SupabaseClient): Promise<AdminQueue> {
  const [signups, unidentified, unnamed] = await Promise.all([
    supabase.from('signup_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase
      .from('products')
      .select('sku, vendors!inner(is_placeholder)', { count: 'exact', head: true })
      .eq('vendors.is_placeholder', true),
    supabase.from('master_data').select('code', { count: 'exact', head: true }).eq('status', 'unnamed'),
  ])

  const failed = [signups, unidentified, unnamed].find((r) => r.error)?.error
  if (failed) throw new Error(`Could not count the owner's queue: ${failed.message}`)

  return {
    signups: signups.count ?? 0,
    unidentified: unidentified.count ?? 0,
    unnamedCodes: unnamed.count ?? 0,
  }
}
