import Link from 'next/link'
import { format, formatDistanceStrict } from 'date-fns'
import { requireReceiving } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'
import { INWARD_ORDER_SELECT, toInwardOrder, type RawInwardOrder } from '@/lib/inwarding/view'
import { todayInIndia } from '@/lib/inwarding/summary'

export const metadata = { title: 'Receive a parcel · Nerige' }

/**
 * Step 1 of receiving: which order the box in front of you belongs to.
 *
 * Oldest dispatch first, because that parcel has been in transit longest and is
 * the one most likely to be sitting on the bench. The docket is shown in
 * monospace and given its own line: it is the number printed on the transporter's
 * label, and matching it is how the bench identifies a box that carries no order
 * number anywhere on it.
 *
 * Only dispatched orders appear. An order a weaver has not marked dispatched
 * cannot be received — the database refuses it — and offering it here would be a
 * row that leads to a screen saying no.
 */
export default async function ReceiveFlowPage() {
  await requireReceiving()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orders')
    .select(INWARD_ORDER_SELECT)
    .eq('status', 'dispatched')

  const orders = ((data ?? []) as unknown as RawInwardOrder[])
    .map(toInwardOrder)
    .sort((a, b) => (a.dispatchedAt ?? a.issuedAt).localeCompare(b.dispatchedAt ?? b.issuedAt))

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <FlowStepper flow="receive" current={1} hrefs={{ parcel: '/flows/receive' }} />

      <PageHeader
        title="Receive a parcel"
        subtitle="On its way from a weaver. Oldest first — match the docket on the box."
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load what is on its way: {error.message}. Nothing below is a complete list.
        </p>
      )}

      {orders.length === 0 && !error ? (
        <EmptyState
          title="Nothing is on its way"
          body="No weaver has marked an order dispatched. If a parcel is here anyway, keep it aside and ask procurement to ring her — the dispatch date and docket are hers to record."
          action={
            <Link href="/warehouse/inward">
              <Button variant="secondary">All parcels</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={withFlow(`/warehouse/inward/${o.id}`, 'receive')}
                className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-900 focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-stone-900">
                    {o.vendorName ?? o.vendorCode ?? 'Weaver'}{' '}
                    <span className="font-mono text-sm font-normal text-stone-500">{o.orderNumber}</span>
                  </span>
                  <span className="block text-sm text-stone-600">
                    {o.docket ? (
                      <span className="font-mono text-stone-900">{o.docket}</span>
                    ) : (
                      <span className="text-stone-500">No docket</span>
                    )}
                    <span className="text-stone-400"> · </span>
                    <span className="tabular-nums">
                      sent{' '}
                      {o.dispatchedAt ? `${format(new Date(o.dispatchedAt), 'd MMM')} (${ago(o.dispatchedAt)})` : '—'}
                    </span>
                  </span>
                  <span className="block text-sm text-stone-600 tabular-nums">
                    {o.parcels.length > 0
                      ? `${o.piecesOutstanding} of ${o.piecesOrdered} pieces still to come · ${o.parcels.length} parcel${o.parcels.length === 1 ? '' : 's'} already opened`
                      : `${o.piecesOrdered} piece${o.piecesOrdered === 1 ? '' : 's'} ordered`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-stone-500">
        Looking for something that is not here — a late order, or one already received?{' '}
        <Link href="/warehouse/inward" className="underline underline-offset-2">
          All parcels
        </Link>{' '}
        shows every pile.
      </p>
    </div>
  )
}

function ago(iso: string): string {
  // Time in transit, measured to midday today in India so a parcel sent this
  // morning never reads as "in 2 hours". Strict, so "3 days" is never "about 3".
  return `${formatDistanceStrict(new Date(iso), new Date(`${todayInIndia()}T12:00:00+05:30`))} ago`
}
