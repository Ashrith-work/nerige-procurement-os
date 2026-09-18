import Link from 'next/link'
import { format } from 'date-fns'
import { requireReceiving } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, Button, EmptyState, PageHeader, StatusBadge } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'
import {
  INWARD_ORDER_SELECT,
  REJECT_REASON_LABELS,
  toInwardOrder,
  type RawInwardOrder,
} from '@/lib/inwarding/view'

export const metadata = { title: 'Parcel recorded' }

/**
 * Step 3: what the bench just recorded, and what the weaver still owes.
 *
 * Read back from the order rather than handed over from the form, so it is the
 * same answer tomorrow, on another tablet, to anybody who asks. The second
 * question is the one this screen exists for: a parcel that closed the order and
 * a parcel that left four pieces outstanding look identical at the bench, and
 * the difference decides whether anyone rings the weaver.
 *
 * The action keeps its name from the step before it: "Record the parcel"
 * produces "Parcel recorded".
 */
export default async function ReceiveDonePage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  await requireReceiving()
  const { order: orderId } = await searchParams
  const supabase = await createClient()

  const valid = orderId && /^[0-9a-f-]{36}$/i.test(orderId) ? orderId : null

  const { data } = valid
    ? await supabase.from('orders').select(INWARD_ORDER_SELECT).eq('id', valid).maybeSingle()
    : { data: null }

  const order = data ? toInwardOrder(data as unknown as RawInwardOrder) : null

  const again = (
    <Link href="/flows/receive">
      <Button>Receive another parcel</Button>
    </Link>
  )

  if (!order) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <FlowStepper flow="receive" current={3} hrefs={{ parcel: '/flows/receive' }} />
        <EmptyState
          title="No parcel to show"
          body="This step shows what a parcel recorded. Start from the list of what is on its way."
          action={again}
        />
      </div>
    )
  }

  const latest = order.parcels[0] ?? null
  const lineLabel = new Map(order.lines.map((l) => [l.id, l.sku ?? 'New design']))
  const owing = order.lines.filter((l) => l.outstanding > 0)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <FlowStepper
        flow="receive"
        current={3}
        hrefs={{
          parcel: '/flows/receive',
          counts: withFlow(`/warehouse/inward/${order.id}`, 'receive'),
        }}
        note={
          latest
            ? order.status === 'received'
              ? 'Parcel recorded, and the order is closed.'
              : 'Parcel recorded. The order stays open for what is still owed.'
            : 'Nothing has been recorded against this order yet.'
        }
      />

      <PageHeader
        title={latest ? 'Parcel recorded' : 'Nothing recorded yet'}
        subtitle={`${order.vendorName ?? order.vendorCode ?? 'Weaver'} · ${order.orderNumber}`}
        action={<StatusBadge status={order.status} />}
      />

      {latest ? (
        <section className="space-y-3">
          <h2 className="text-base font-medium text-stone-900">
            What this parcel brought{' '}
            <span className="font-normal text-stone-500">
              {format(new Date(latest.receivedAt), 'd MMM yyyy, HH:mm')}
              {latest.receivedBy && ` · ${latest.receivedBy}`}
            </span>
          </h2>
          {latest.note && <p className="text-sm text-stone-600">{latest.note}</p>}
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 text-sm">
            {latest.lines.map((l) => (
              <li key={l.orderLineId} className="px-4 py-3 tabular-nums">
                <span className="font-mono text-stone-900">{lineLabel.get(l.orderLineId)}</span>
                <span className="text-stone-400"> · </span>
                {l.received} received
                {l.rejected > 0 && (
                  <>
                    {', '}
                    {l.rejected} rejected ({l.reason ? REJECT_REASON_LABELS[l.reason] : 'no reason'})
                  </>
                )}
                {l.note && <span className="text-stone-500"> — {l.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Alert>
          Nothing has been counted against this order. Go back a step to count the box in front of
          you.
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-medium text-stone-900">Still outstanding</h2>
        {order.status === 'received' ? (
          <Alert tone="success">
            Every line is accounted for. This order is closed
            {order.piecesOutstanding > 0
              ? `, ${order.piecesOutstanding} piece${order.piecesOutstanding === 1 ? '' : 's'} short — it was closed deliberately.`
              : '.'}
          </Alert>
        ) : owing.length === 0 ? (
          <Alert>
            Nothing is owed on the lines, but the order is still open. It closes when a parcel
            accounts for the last piece.
          </Alert>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 text-sm">
            {owing.map((l) => (
              <li key={l.id} className="px-4 py-3 tabular-nums">
                <span className="font-mono text-stone-900">{l.sku ?? 'New design'}</span>
                <span className="text-stone-400"> · </span>
                <span className="font-medium text-amber-700">{l.outstanding} to come</span> of{' '}
                {l.ordered}
              </li>
            ))}
          </ul>
        )}
      </section>

      {order.lines.some((l) => l.kind === 'new_design' && l.received > 0) && (
        <Alert>
          The new designs in this parcel have no codes yet. They go through &ldquo;Add a saree&rdquo;
          to be given one.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-4">
        {again}
        {order.status !== 'received' && (
          <Link href={withFlow(`/warehouse/inward/${order.id}`, 'receive')}>
            <Button variant="secondary">Count another box for this order</Button>
          </Link>
        )}
        <Link href="/warehouse/inward">
          <Button variant="secondary">All parcels</Button>
        </Link>
      </div>
    </div>
  )
}
