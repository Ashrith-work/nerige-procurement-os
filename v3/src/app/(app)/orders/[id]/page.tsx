import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary } from '@/lib/i18n'
import { toVendorOrder, ORDER_SELECT, type RawOrder } from '@/lib/orders/view'
import { StatusBadge } from '@/components/ui/primitives'
import { OrderSections } from '@/components/order-sections'
import { CancelForm } from './cancel-form'

export const metadata = { title: 'Order · Nerige' }

/**
 * One order, from Pooja's side.
 *
 * Rendered with the SAME component the weaver's screen uses, on purpose. If she
 * wants to know what the vendor is looking at, she should be looking at it —
 * not at a table that claims to describe it. Two sides arguing from differently
 * worded copies of the same order is exactly what this replaces.
 *
 * Read only apart from cancel, and that is enforced by
 * `app.orders_internal_write_guard()` rather than by the absence of a button.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireProcurement()
  const t = getDictionary('en')
  const supabase = await createClient()

  const { data } = await supabase
    .from('orders')
    .select(`${ORDER_SELECT}, batch_id, vendors(code, display_name)`)
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  const order = toVendorOrder(data as unknown as RawOrder)
  const raw = data as unknown as {
    batch_id: string
    vendors: { code: string; display_name: string } | { code: string; display_name: string }[] | null
  }
  const vendor = Array.isArray(raw.vendors) ? raw.vendors[0] : raw.vendors

  // The other orders from the same press of send.
  const { data: siblingRows } = await supabase
    .from('orders')
    .select('id, order_number, vendors(code)')
    .eq('batch_id', raw.batch_id)
    .neq('id', id)

  const siblings = (siblingRows ?? []) as unknown as {
    id: string
    order_number: string
    vendors: { code: string } | { code: string }[] | null
  }[]

  const cancellable = order.status === 'issued' || order.status === 'accepted'

  return (
    <div className="mx-auto max-w-md space-y-8 pb-10">
      <header className="space-y-2">
        <Link href="/orders" className="text-sm text-stone-500 underline underline-offset-2">
          All orders
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-medium">{vendor?.display_name ?? 'Order'}</h1>
            <p className="font-mono text-sm text-stone-500">
              {vendor?.code} · {order.orderNumber}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>
      </header>

      {/* What the weaver has told us, which is the only reason Pooja opens this
          screen once the order has gone. */}
      <dl className="space-y-1.5 rounded-xl border border-stone-200 p-4 text-sm">
        <Fact label="Sent" value={format(new Date(order.issuedAt), 'd MMM yyyy')} />
        <Fact
          label="Promised by"
          value={order.promisedDate ? format(new Date(order.promisedDate), 'd MMM yyyy') : null}
          missing="Not accepted yet"
        />
        <Fact
          label="Dispatched"
          value={order.dispatchedAt ? format(new Date(order.dispatchedAt), 'd MMM yyyy') : null}
          missing="—"
        />
        <Fact label="Docket" value={order.transportDocket} missing="—" mono />
      </dl>

      {siblings.length > 0 && (
        <p className="text-sm text-stone-500">
          Sent at the same time as{' '}
          {siblings.map((s, i) => {
            const code = Array.isArray(s.vendors) ? s.vendors[0]?.code : s.vendors?.code
            return (
              <span key={s.id}>
                {i > 0 && ', '}
                <Link href={`/orders/${s.id}`} className="underline underline-offset-2">
                  {code}
                </Link>
              </span>
            )
          })}
          .
        </p>
      )}

      {/* The weaver's own screen, unchanged. */}
      <OrderSections order={order} t={t} />

      <section className="border-t border-stone-200 pt-6">
        {cancellable ? (
          <CancelForm orderId={order.id} vendorName={vendor?.display_name ?? 'The vendor'} />
        ) : (
          <p className="text-sm text-stone-500">
            {order.status === 'cancelled'
              ? 'This order was cancelled.'
              : 'This order has left the vendor and can no longer be cancelled.'}
          </p>
        )}
      </section>
    </div>
  )
}

function Fact({
  label,
  value,
  missing,
  mono,
}: {
  label: string
  value: string | null
  missing?: string
  mono?: boolean
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className={value ? (mono ? 'font-mono text-stone-900' : 'text-stone-900') : 'text-stone-400'}>
        {value ?? missing ?? '—'}
      </dd>
    </div>
  )
}
