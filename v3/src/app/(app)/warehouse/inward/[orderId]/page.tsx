import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { requireReceiving } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, StatusBadge } from '@/components/ui/primitives'
import { PrintButton } from '@/components/print-button'
import {
  INWARD_ORDER_SELECT,
  REJECT_REASON_LABELS,
  toInwardOrder,
  type RawInwardOrder,
} from '@/lib/inwarding/view'
import { ReceiptForm, LineHeading } from './receipt-form'

export const metadata = { title: 'Receive order · Nerige' }

/**
 * One order at the receiving bench.
 *
 * Only a dispatched order offers the form; the database refuses anything else
 * (`public.record_order_receipt()`), and the page says why in words rather than
 * showing a form that will fail. Every earlier parcel is listed underneath, so
 * the second box of a short order is counted against what the first already
 * brought.
 *
 * Print-friendly: on paper the inputs become boxes to write in and the chrome
 * disappears, so the bench can count on a clipboard and type it in after.
 */
export default async function InwardOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  await requireReceiving()

  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound()

  const supabase = await createClient()
  const { data } = await supabase
    .from('orders')
    .select(INWARD_ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle()

  if (!data) notFound()
  const order = toInwardOrder(data as unknown as RawInwardOrder)
  const lineLabel = new Map(order.lines.map((l) => [l.id, l.sku ?? 'New design']))

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header className="space-y-2">
        <Link
          href="/warehouse/inward"
          className="no-print inline-block min-h-11 py-2.5 text-sm text-stone-500 underline underline-offset-2"
        >
          All inwarding
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium">{order.vendorName ?? 'Order'}</h1>
            <p className="font-mono text-sm text-stone-500">
              {order.vendorCode} · {order.orderNumber}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status} />
            <PrintButton label="Print sheet" />
          </div>
        </div>
      </header>

      <dl className="grid gap-x-6 gap-y-1.5 rounded-xl border border-stone-200 p-4 text-sm sm:grid-cols-2">
        <Fact label="Docket" value={order.docket} mono />
        <Fact label="Dispatched" value={order.dispatchedAt && format(new Date(order.dispatchedAt), 'd MMM yyyy')} />
        <Fact label="Promised by" value={order.promisedDate && format(new Date(order.promisedDate), 'd MMM yyyy')} />
        <Fact
          label="Pieces"
          value={`${order.piecesOrdered} ordered · ${order.piecesOutstanding} to come`}
        />
        {order.receivedAt && (
          <Fact label="Received" value={format(new Date(order.receivedAt), 'd MMM yyyy, HH:mm')} />
        )}
      </dl>

      {order.status === 'dispatched' ? (
        <ReceiptForm orderId={order.id} lines={order.lines} />
      ) : (
        <>
          <NotReceivable status={order.status} />
          <div className="space-y-4">
            {order.lines.map((line) => (
              <article key={line.id} className="space-y-2 rounded-xl border border-stone-200 p-4">
                <LineHeading line={line} />
                <p className="text-sm text-stone-600 tabular-nums">
                  Ordered {line.ordered} · received {line.received}
                  {line.rejected > 0 && ` · rejected ${line.rejected}`}
                </p>
              </article>
            ))}
          </div>
        </>
      )}

      {order.parcels.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-medium text-stone-900">Parcels opened</h2>
          <ul className="space-y-3">
            {order.parcels.map((p) => (
              <li key={p.id} className="space-y-1.5 rounded-xl border border-stone-200 p-4 text-sm break-inside-avoid">
                <p className="text-stone-900">
                  {format(new Date(p.receivedAt), 'd MMM yyyy, HH:mm')}
                  {p.receivedBy && <span className="text-stone-500"> · {p.receivedBy}</span>}
                  {p.closesOrder && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      Closed short
                    </span>
                  )}
                </p>
                {p.note && <p className="text-stone-600">{p.note}</p>}
                {p.lines.length > 0 && (
                  <ul className="space-y-0.5 text-stone-700 tabular-nums">
                    {p.lines.map((l) => (
                      <li key={l.orderLineId}>
                        <span className="font-mono">{lineLabel.get(l.orderLineId)}</span>: {l.received} received
                        {l.rejected > 0 &&
                          `, ${l.rejected} rejected (${l.reason ? REJECT_REASON_LABELS[l.reason] : 'no reason'})`}
                        {l.note && <span className="text-stone-500"> — {l.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function NotReceivable({ status }: { status: string }) {
  switch (status) {
    case 'received':
      return <Alert tone="success">Received. Every line is accounted for.</Alert>
    case 'accepted':
      return (
        <Alert>
          The weaver has not marked this order dispatched, so it cannot be received yet. If the
          parcel is already here, keep it aside and ask procurement to ring her — the dispatch date
          and docket are hers to record.
        </Alert>
      )
    case 'cancelled':
      return <Alert tone="error">This order was cancelled. Nothing can be received against it.</Alert>
    default:
      return <Alert>The weaver has not accepted this order yet. Nothing is on its way.</Alert>
  }
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className={value ? (mono ? 'font-mono text-stone-900' : 'text-stone-900') : 'text-stone-400'}>
        {value ?? '—'}
      </dd>
    </div>
  )
}
