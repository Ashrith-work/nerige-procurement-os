import Link from 'next/link'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui/primitives'

export const metadata = { title: 'Orders · Nerige' }

/**
 * Roughly six months of Pooja's volume. Named rather than silent: if the list
 * is ever cut off, the screen says so at the bottom.
 */
const RECENT_LIMIT = 200

interface Row {
  id: string
  order_number: string
  status: string
  issued_at: string
  promised_date: string | null
  dispatched_at: string | null
  batch_id: string
  vendors: { code: string; display_name: string } | { code: string; display_name: string }[] | null
  order_lines: { count: number }[]
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/**
 * Issued orders and their state.
 *
 * Grouped by the press of send that created them, because that is the unit
 * Pooja decided in: she tapped fourteen sarees once, and three weavers each got
 * an order. A flat list would show three unrelated rows and hide the decision.
 */
export default async function OrdersPage() {
  await requireProcurement()
  const supabase = await createClient()

  const { data, count } = await supabase
    .from('orders')
    .select(
      'id, order_number, status, issued_at, promised_date, dispatched_at, batch_id, vendors(code, display_name), order_lines(count)',
      { count: 'exact' },
    )
    .order('issued_at', { ascending: false })
    .limit(RECENT_LIMIT)

  const orders = (data ?? []) as unknown as Row[]

  if (orders.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Orders" />
        <EmptyState
          title="Nothing sent yet"
          body="Orders appear here once you have chosen a vendor on the reorder screen and pressed send."
        />
      </div>
    )
  }

  const batches: { batchId: string; issuedAt: string; orders: Row[] }[] = []
  for (const o of orders) {
    const existing = batches.find((b) => b.batchId === o.batch_id)
    if (existing) existing.orders.push(o)
    else batches.push({ batchId: o.batch_id, issuedAt: o.issued_at, orders: [o] })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Orders" subtitle="What you have sent, and where it has got to." />

      {batches.map((batch) => (
        <section key={batch.batchId} className="space-y-2">
          <h2 className="text-sm text-stone-500">
            {format(new Date(batch.issuedAt), 'd MMM yyyy')}
            <span className="text-stone-400"> · </span>
            {batch.orders.length} {batch.orders.length === 1 ? 'vendor' : 'vendors'}
          </h2>

          <ul className="space-y-2">
            {batch.orders.map((o) => {
              const vendor = one(o.vendors)
              return (
                <li key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="flex items-center gap-3 rounded-xl border border-stone-200 p-4 hover:border-stone-300"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base text-stone-900">
                        {vendor?.display_name ?? 'Unknown vendor'}{' '}
                        <span className="font-mono text-sm text-stone-400">{vendor?.code}</span>
                      </p>
                      <p className="mt-0.5 text-sm text-stone-500">
                        <span className="font-mono">{o.order_number}</span>
                        <span className="text-stone-400"> · </span>
                        <span className="tabular-nums">{o.order_lines?.[0]?.count ?? 0} lines</span>
                        {o.promised_date && (
                          <>
                            <span className="text-stone-400"> · </span>
                            promised {format(new Date(o.promised_date), 'd MMM')}
                          </>
                        )}
                        {o.dispatched_at && (
                          <>
                            <span className="text-stone-400"> · </span>
                            sent {format(new Date(o.dispatched_at), 'd MMM')}
                          </>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={o.status} />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {(count ?? 0) > orders.length && (
        <p className="text-sm text-stone-500">
          Showing the most recent {orders.length} of {count} orders.
        </p>
      )}
    </div>
  )
}
