import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The four numbers a dashboard needs about the receiving bench.
 *
 * Counts only, each a `head: true` request, so a dashboard tile costs four tiny
 * queries rather than a download of every open order. RLS applies: the caller
 * sees these numbers only if `app.can_receive_goods()` (or the developer read)
 * admits the orders.
 *
 *   expected            dispatched, no parcel opened yet
 *   partiallyReceived   dispatched, at least one parcel, still pieces to come
 *   lateNotDispatched   accepted, promised date passed, weaver has not sent it
 *   receivedThisWeek    moved to received in the last seven days
 */
export interface InwardCounts {
  expected: number
  partiallyReceived: number
  lateNotDispatched: number
  receivedThisWeek: number
}

/** Today as `yyyy-MM-dd` in the business's own time zone, not the server's. */
export function todayInIndia(now: Date = new Date()): string {
  // en-CA formats as ISO yyyy-mm-dd.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

export async function loadInwardCounts(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<InwardCounts> {
  const [dispatched, withParcel, late, received] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'dispatched'),
    // An inner embed turns "has at least one parcel" into a join; the count is
    // of orders, not of parcels.
    supabase
      .from('orders')
      .select('id, order_receipts!inner(id)', { count: 'exact', head: true })
      .eq('status', 'dispatched'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .lt('promised_date', todayInIndia(now)),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'received')
      .gte('received_at', daysAgoIso(7, now)),
  ])

  const firstError = [dispatched, withParcel, late, received].find((r) => r.error)?.error
  if (firstError) throw new Error(`Could not load inwarding counts: ${firstError.message}`)

  const partiallyReceived = withParcel.count ?? 0
  return {
    expected: Math.max(0, (dispatched.count ?? 0) - partiallyReceived),
    partiallyReceived,
    lateNotDispatched: late.count ?? 0,
    receivedThisWeek: received.count ?? 0,
  }
}
