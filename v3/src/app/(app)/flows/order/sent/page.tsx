import Link from 'next/link'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, Button, EmptyState, PageHeader, StatusBadge } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'

export const metadata = { title: 'Order sent' }

interface SentOrder {
  id: string
  orderNumber: string
  status: string
  issuedAt: string
  vendorCode: string | null
  vendorName: string | null
  lines: number
  pieces: number
}

type Embedded<T> = T | T[] | null | undefined

function one<T>(v: Embedded<T>): T | null {
  // PostgREST returns a to-one embed as an array when it cannot prove the
  // relationship is to-one. Normalise both shapes rather than assume either.
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

const SELECT = `
  id, order_number, status, issued_at, batch_id,
  vendors ( code, display_name ),
  order_lines ( id, quantity )
`

interface RawOrder {
  id: string
  order_number: string
  status: string
  issued_at: string
  batch_id: string
  vendors: Embedded<{ code: string; display_name: string }>
  order_lines: { id: string; quantity: number }[] | null
}

function toSent(row: RawOrder): SentOrder {
  const vendor = one(row.vendors)
  const lines = row.order_lines ?? []
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    issuedAt: row.issued_at,
    vendorCode: vendor?.code ?? null,
    vendorName: vendor?.display_name ?? null,
    lines: lines.length,
    pieces: lines.reduce((n, l) => n + l.quantity, 0),
  }
}

/**
 * The last step of ordering: what went out, and the door back to the start.
 *
 * READ FROM THE DATABASE, not handed over from the screen that sent it. One
 * press of send writes one batch — every order it produced shares a `batch_id`
 * (migration 20260804000300) — so "what did I just send" is a question the rows
 * can answer on their own. That matters more than it sounds: the send screen is
 * a client component holding its result in memory, and a tablet that locks
 * between pressing send and reading the confirmation would otherwise lose the
 * answer entirely. Here it survives a reload, a different device and tomorrow.
 *
 * `?batch=` pins a particular one; without it, the latest batch this person
 * created.
 */
export default async function OrderSentPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const user = await requireProcurement()
  const { batch } = await searchParams
  const supabase = await createClient()

  const pinned = batch && /^[0-9a-f-]{36}$/i.test(batch) ? batch : null

  // The latest batch this person created, in one round trip: her most recent
  // order names it, and every sibling comes back with the second query.
  let batchId = pinned
  if (!batchId) {
    const { data } = await supabase
      .from('orders')
      .select('batch_id')
      .eq('created_by', user.id)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    batchId = (data?.batch_id as string | undefined) ?? null
  }

  const { data, error } = batchId
    ? await supabase.from('orders').select(SELECT).eq('batch_id', batchId).order('order_number')
    : { data: [], error: null }

  const orders = ((data ?? []) as unknown as RawOrder[]).map(toSent)
  const pieces = orders.reduce((n, o) => n + o.pieces, 0)

  const again = (
    <Link href="/flows/order">
      <Button>Order from another weaver</Button>
    </Link>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <FlowStepper
        flow="order"
        current={4}
        hrefs={{
          weaver: '/flows/order',
          designs: withFlow('/reorder', 'order'),
          quantities: withFlow('/reorder/review', 'order'),
        }}
        note={
          orders.length > 0
            ? 'Sent. Each weaver has her own order in her portal.'
            : 'Nothing has been sent from this account yet.'
        }
      />

      <PageHeader title="Sent" subtitle="What went out, and to whom." />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not read the orders back: {error.message}. They were still created — open orders to check.
        </p>
      )}

      {orders.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          body="Start by choosing a weaver; her sold-out designs are what you pick from."
          action={again}
        />
      ) : (
        <>
          <Alert tone="success">
            {orders.length} {orders.length === 1 ? 'order' : 'orders'}, {pieces}{' '}
            {pieces === 1 ? 'piece' : 'pieces'}, sent{' '}
            {format(new Date(orders[0].issuedAt), 'd MMM yyyy, HH:mm')}.
          </Alert>

          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-900 focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-stone-900">
                      {o.vendorName ?? o.vendorCode ?? 'Weaver'}{' '}
                      <span className="font-mono text-sm font-normal text-stone-500">{o.orderNumber}</span>
                    </span>
                    <span className="block text-sm text-stone-600 tabular-nums">
                      {o.lines} {o.lines === 1 ? 'line' : 'lines'} · {o.pieces}{' '}
                      {o.pieces === 1 ? 'piece' : 'pieces'}
                    </span>
                  </span>
                  <StatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>

          <Alert>
            Nothing else happens automatically until a weaver accepts. Her parcel is received through
            &ldquo;Receive a parcel&rdquo; when it arrives.
          </Alert>

          <div className="flex flex-wrap gap-2">
            {again}
            <Link href="/orders">
              <Button variant="secondary">See all orders</Button>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
