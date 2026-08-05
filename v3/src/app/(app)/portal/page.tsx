import Link from 'next/link'
import { format } from 'date-fns'
import { requireVendor } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, type Dictionary } from '@/lib/i18n'
import { PageHeader } from '@/components/ui/primitives'

export const metadata = { title: 'My orders · Nerige' }

interface OrderRow {
  id: string
  order_number: string
  status: string
  issued_at: string
  promised_date: string | null
  dispatched_at: string | null
  order_lines: { count: number }[]
}

/**
 * Vendor home. Her orders, grouped by what needs her, and nothing else.
 *
 * Three groups in the order the work happens: what she has not answered yet,
 * what she is weaving, what has gone. No counts of anything, no catalogue
 * summary, no chrome — a weaver opens this to answer one question, and every
 * extra thing on the screen is a delay in answering it.
 *
 * There is no vendor filter in this query. `orders_select_own` decides what
 * comes back.
 */
export default async function PortalHome() {
  const user = await requireVendor()
  const t = getDictionary(user.locale)
  const supabase = await createClient()

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, issued_at, promised_date, dispatched_at, order_lines(count)')
    .order('issued_at', { ascending: false })

  const orders = (data ?? []) as unknown as OrderRow[]

  // Cancelled orders are not in any of the three groups: a cancelled order
  // needs nothing from her. It still opens at its own URL and says so.
  const toAccept = orders.filter((o) => o.status === 'issued')
  const inProgress = orders.filter((o) => o.status === 'accepted')
  const sent = orders.filter((o) => o.status === 'dispatched' || o.status === 'received')

  const nothing = toAccept.length + inProgress.length + sent.length === 0

  return (
    <div className="mx-auto max-w-md space-y-8">
      <PageHeader title={user.vendorName ?? t.nav.myOrders} subtitle={user.vendorCode ?? undefined} />

      {nothing && <p className="text-sm text-stone-500">{t.portal.nothingYet}</p>}

      <Group title={t.portal.toAccept} help={t.portal.toAcceptHelp} orders={toAccept} t={t} />
      <Group title={t.portal.inProgress} help={t.portal.inProgressHelp} orders={inProgress} t={t} />
      <Group title={t.portal.sent} orders={sent} t={t} />
    </div>
  )
}

/** Renders nothing at all when empty. A screen of empty headings reads as broken. */
function Group({
  title,
  help,
  orders,
  t,
}: {
  title: string
  help?: string
  orders: OrderRow[]
  t: Dictionary
}) {
  if (orders.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-base font-medium text-stone-900">
          {title} <span className="text-stone-400">({orders.length})</span>
        </h2>
        {help && <p className="text-sm text-stone-500">{help}</p>}
      </div>

      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              href={`/portal/orders/${o.id}`}
              className="block rounded-xl border border-stone-200 p-4 hover:border-stone-300"
            >
              <p className="font-mono text-base text-stone-900">{o.order_number}</p>
              <p className="mt-0.5 text-sm text-stone-500">
                {t.portal.linesInOrder.replace('{n}', String(o.order_lines?.[0]?.count ?? 0))}
                {o.promised_date && (
                  <>
                    {' · '}
                    {t.portal.promisedBy} {format(new Date(o.promised_date), 'd MMM')}
                  </>
                )}
                {o.dispatched_at && (
                  <>
                    {' · '}
                    {t.portal.sentOn} {format(new Date(o.dispatched_at), 'd MMM')}
                  </>
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
