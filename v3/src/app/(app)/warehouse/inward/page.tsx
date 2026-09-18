import Link from 'next/link'
import { format, formatDistanceStrict } from 'date-fns'
import { requireReceiving } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, StatusBadge } from '@/components/ui/primitives'
import {
  bucketForInward,
  INWARD_ORDER_SELECT,
  toInwardOrder,
  type InwardOrder,
  type RawInwardOrder,
} from '@/lib/inwarding/view'
import { daysAgoIso, todayInIndia } from '@/lib/inwarding/summary'

export const metadata = { title: 'Parcels' }

/** How far back "received recently" reaches. Two weeks covers a late second parcel. */
const RECENT_DAYS = 14

/**
 * What is on its way to the warehouse, and what has arrived.
 *
 * Four piles, in the order the bench works them: parcels expected (oldest
 * dispatch first — it has been in transit longest), orders part-received and
 * still owed pieces, orders a weaver promised and has not sent, and what came in
 * recently. The third pile is not receivable; it is here so a late order is seen
 * by the people who will notice the missing parcel first.
 */
export default async function InwardPage() {
  await requireReceiving()
  const supabase = await createClient()

  const today = todayInIndia()
  const since = daysAgoIso(RECENT_DAYS)

  // Three narrow queries rather than one wide OR: each is an index range on
  // orders (status, …), and the received pile must not pull the whole history.
  const [dispatched, late, received] = await Promise.all([
    supabase.from('orders').select(INWARD_ORDER_SELECT).eq('status', 'dispatched'),
    supabase
      .from('orders')
      .select(INWARD_ORDER_SELECT)
      .eq('status', 'accepted')
      .lt('promised_date', today),
    supabase
      .from('orders')
      .select(INWARD_ORDER_SELECT)
      .eq('status', 'received')
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(50),
  ])

  const error = dispatched.error ?? late.error ?? received.error
  const rows = [...(dispatched.data ?? []), ...(late.data ?? []), ...(received.data ?? [])]
  const orders = (rows as unknown as RawInwardOrder[]).map(toInwardOrder)
  const piles = bucketForInward(orders, today, since)

  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        title="Parcels"
        subtitle="On the way, part-received, done — and what a weaver promised but has not sent."
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          The parcels could not be loaded, so the piles below may be empty when they are not.
          Reload the page; if it keeps happening, tell a developer: {error.message}
        </p>
      )}

      <Pile
        title="Expected"
        help="Dispatched by the weaver. Oldest first."
        orders={piles.expected}
        empty="Nothing is on its way right now."
        detail={(o) => (
          <>
            {o.docket ? <span className="font-mono">{o.docket}</span> : 'No docket'}
            {' · sent '}
            {o.dispatchedAt ? `${format(new Date(o.dispatchedAt), 'd MMM')} (${ago(o.dispatchedAt)})` : '—'}
            {` · ${o.piecesOrdered} pieces`}
          </>
        )}
      />

      <Pile
        title="Partially received"
        help="At least one parcel opened, pieces still to come."
        orders={piles.partiallyReceived}
        empty="No order is waiting on a second parcel."
        detail={(o) => (
          <>
            {`${o.piecesOutstanding} of ${o.piecesOrdered} pieces to come`}
            {o.parcels[0] && ` · last parcel ${format(new Date(o.parcels[0].receivedAt), 'd MMM')}`}
          </>
        )}
      />

      <Pile
        title="Late, not dispatched"
        help="The weaver accepted and the promised date has passed, but she has not sent it."
        orders={piles.lateNotDispatched}
        empty="No weaver is past her promised date."
        detail={(o) => (
          <>
            {`Promised ${o.promisedDate ? format(new Date(o.promisedDate), 'd MMM yyyy') : '—'}`}
            {` · ${o.piecesOrdered} pieces`}
          </>
        )}
      />

      <Pile
        title="Received recently"
        help={`Closed in the last ${RECENT_DAYS} days.`}
        orders={piles.receivedRecently}
        empty="Nothing received in the last two weeks."
        detail={(o) => {
          const short = o.parcels.some((p) => p.closesOrder) && o.piecesOutstanding > 0
          const rejected = o.lines.reduce((n, l) => n + l.rejected, 0)
          return (
            <>
              {o.receivedAt ? format(new Date(o.receivedAt), 'd MMM, HH:mm') : '—'}
              {rejected > 0 && ` · ${rejected} rejected`}
              {short && ` · closed ${o.piecesOutstanding} short`}
            </>
          )
        }}
      />
    </div>
  )
}

function ago(iso: string): string {
  // Time in transit, measured to midday today in India so a parcel sent this
  // morning never reads as "in 2 hours". Strict so "3 days" is never "about 3".
  return `${formatDistanceStrict(new Date(iso), new Date(`${todayInIndia()}T12:00:00+05:30`))} ago`
}

function Pile({
  title,
  help,
  orders,
  empty,
  detail,
}: {
  title: string
  help: string
  orders: InwardOrder[]
  empty: string
  detail: (o: InwardOrder) => React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-medium text-stone-900">
          {title} <span className="text-stone-600 tabular-nums">{orders.length}</span>
        </h2>
        <p className="text-sm text-stone-600">{help}</p>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 px-4 py-4 text-sm text-stone-600">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/warehouse/inward/${o.id}`}
                className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-stone-900">
                    {o.vendorName ?? o.vendorCode}{' '}
                    <span className="font-mono text-sm font-normal text-stone-600">{o.orderNumber}</span>
                  </span>
                  <span className="block text-sm text-stone-600 tabular-nums">{detail(o)}</span>
                </span>
                <StatusBadge status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
