import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { requireVendor } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary } from '@/lib/i18n'
import { toVendorOrder, ORDER_SELECT, type RawOrder } from '@/lib/orders/view'
import { StatusBadge } from '@/components/ui/primitives'
import { OrderSections } from '@/components/order-sections'
import { AcceptForm, DispatchForm } from './order-forms'

export const metadata = { title: 'Order · Nerige' }

/**
 * The vendor order screen.
 *
 * Two headed sections, restock first, then new designs, as a vertical scroll of
 * cards. No table anywhere: a table puts a code in a cell that clips, and the
 * code is the one string on this screen that gets copied onto fabric by hand.
 *
 * The `.eq('vendor_id', …)` is belt and braces for a weaver — `orders_select_own`
 * already decides what comes back, and a careless edit here would return
 * nothing rather than someone else's order. It is load-bearing for the OTHER
 * caller: when Pooja is viewing this portal as a weaver she is still an admin,
 * and `orders_select_internal` returns every vendor's orders. Under
 * impersonation the scope has to be stated, because RLS is not narrowing it.
 */
export default async function VendorOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireVendor()
  const t = getDictionary(user.locale)
  const supabase = await createClient()

  const { data } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .eq('vendor_id', user.vendorId)
    .maybeSingle()

  if (!data) notFound()

  const order = toVendorOrder(data as unknown as RawOrder)

  // Her own lead time, so the date field opens on the answer she usually gives.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('default_lead_time_days')
    .eq('id', user.vendorId)
    .maybeSingle()

  const suggested = new Date()
  suggested.setDate(suggested.getDate() + (vendor?.default_lead_time_days ?? 21))
  const suggestedDate = suggested.toISOString().slice(0, 10)

  return (
    // Every vendor screen is a phone screen. Constrained rather than stretched,
    // so a card is the same card on a laptop as it is on an Android handset.
    <div className="mx-auto max-w-md space-y-8 pb-10">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-mono text-base text-stone-900">{order.orderNumber}</h1>
          <StatusBadge status={order.status} />
        </div>
        <p className="text-sm text-stone-500">
          {t.order.orderFrom} · {t.order.issued} {format(new Date(order.issuedAt), 'd MMM yyyy')}
        </p>
      </header>

      <OrderSections order={order} t={t} locale={user.locale} />

      {/* One action, at the bottom, after she has seen everything she is being
          asked for. */}
      <section className="space-y-4 border-t border-stone-200 pt-6">
        {order.status === 'issued' && !user.readOnly && (
          <AcceptForm orderId={order.id} suggestedDate={suggestedDate} t={t} />
        )}

        {order.status === 'accepted' && (
          <>
            <p className="text-sm text-stone-600">
              {t.order.acceptedOn}. {t.order.promised}{' '}
              <span className="font-medium text-stone-900">
                {order.promisedDate && format(new Date(order.promisedDate), 'd MMM yyyy')}
              </span>
            </p>
            {!user.readOnly && <DispatchForm orderId={order.id} t={t} />}
          </>
        )}

        {(order.status === 'dispatched' || order.status === 'received') && (
          <div className="space-y-1 text-sm text-stone-600">
            <p>
              {t.order.dispatchedOn}{' '}
              <span className="font-medium text-stone-900">
                {order.dispatchedAt && format(new Date(order.dispatchedAt), 'd MMM yyyy')}
              </span>
            </p>
            {order.transportDocket && (
              <p>
                {t.order.docketIs}{' '}
                <span className="font-mono text-stone-900">{order.transportDocket}</span>
              </p>
            )}
            {order.status === 'received' && <p>{t.order.received}</p>}
          </div>
        )}

        {order.status === 'cancelled' && <p className="text-sm text-stone-600">{t.order.cancelled}</p>}
      </section>
    </div>
  )
}
