import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDistanceToNow } from 'date-fns'

/**
 * How old the synced numbers are.
 *
 * Two of the three dashboards show figures nobody in this building typed:
 * stock and catalogue come from Shopify's product sync, sales from its order
 * sync. Every screen that shows one of those has to say when it last worked —
 * "88 sold" is a different sentence when the sync stopped on Tuesday.
 *
 * LAST SUCCEEDED, not last ran. A sync that has failed every hour since Tuesday
 * has a very recent run and very old data; `sync_runs` distinguishes the two and
 * only the succeeded row is an answer to "how old is this number". See
 * migration 014.
 *
 * Errors throw, like every loader behind these screens: a missing age must read
 * as "we could not ask", never as "just now".
 */

export type SyncKind = 'shopify_products' | 'shopify_orders'

export interface SyncAges {
  /** Catalogue and stock. */
  products: string | null
  /** Sales — what the Numbers screen is built on. */
  orders: string | null
}

export async function loadSyncAges(supabase: SupabaseClient): Promise<SyncAges> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('kind, finished_at')
    .eq('status', 'succeeded')
    .in('kind', ['shopify_products', 'shopify_orders'])
    .order('finished_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(`Could not read the sync status: ${error.message}`)

  const rows = (data ?? []) as { kind: SyncKind; finished_at: string | null }[]
  const newest = (kind: SyncKind) => rows.find((r) => r.kind === kind)?.finished_at ?? null

  return { products: newest('shopify_products'), orders: newest('shopify_orders') }
}

/**
 * "3 hours ago", from an ISO timestamp.
 *
 * A module-level helper rather than a call in a component body: `formatDistanceToNow`
 * reads the clock, and the purity rule rejects that inside render.
 */
export function relativeAge(iso: string): string {
  return formatDistanceToNow(new Date(iso))
}

/** A sync that has not succeeded within a day. Never having succeeded counts. */
export function isStale(iso: string | null, hours = 24, now: Date = new Date()): boolean {
  if (!iso) return true
  return now.getTime() - new Date(iso).getTime() > hours * 60 * 60 * 1000
}
