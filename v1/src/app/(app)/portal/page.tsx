import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { listOrders, listBills, listProducts } from '@/lib/data/procurement'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  WorkSection,
} from '@/components/ui/primitives'
import { money, formatDate, dueLabel, pluralise } from '@/lib/format'
import {
  PO_STATUS_META,
  BILL_STATUS_META,
  type PoStatus,
  type BillStatus,
} from '@/lib/domain/procurement'

export const metadata = { title: 'My orders · Nerige Story' }

interface PortalOrder {
  id: string
  po_number: string
  status: PoStatus
  title: string | null
  required_by: string | null
  promised_date: string | null
  total_amount: string
  purchase_order_lines: { quantity: number; quantity_received: number }[]
}

/**
 * The vendor's home screen.
 *
 * Organised by what they have to DO, not by order date. A weaver opening this
 * on a phone between jobs has one question — "is there anything for me?" — and
 * the answer has to be the first thing on the screen. Orders that need nothing
 * from them are pushed below the fold, and orders they cannot act on are not
 * shown at all.
 */
export default async function PortalPage() {
  const user = await requireRole('vendor')

  // The vendorId passed here is used only by demo mode. Against a real database
  // RLS scopes every one of these queries to the caller's own organisation and
  // hides drafts — see the note in src/lib/data/procurement.ts.
  const [orderRows, bills, products] = await Promise.all([
    listOrders('all', { vendorId: user.vendorId }),
    listBills(user.vendorId),
    listProducts({ vendorId: user.vendorId }),
  ])

  const orders = orderRows as unknown as PortalOrder[]

  const toAccept = orders.filter((o) => o.status === 'issued')
  const toMake = orders.filter((o) => ['acknowledged', 'in_production'].includes(o.status))
  const inTransit = orders.filter((o) => o.status === 'dispatched')
  const billable = orders.filter(
    (o) =>
      ['partially_received', 'received'].includes(o.status) &&
      !bills.some((b) => b.purchase_order_id === o.id),
  )
  const done = orders.filter((o) => ['closed', 'cancelled'].includes(o.status))

  const nothingToDo =
    toAccept.length === 0 && toMake.length === 0 && inTransit.length === 0 && billable.length === 0

  return (
    <div className="space-y-5">
      <PageHeader
        title={user.vendorName ?? 'My orders'}
        subtitle="Everything Nerige Story has ordered from you."
        action={
          <Link href="/portal/catalogue">
            <Button variant="secondary">My codes ({products.length})</Button>
          </Link>
        }
      />

      {/* The reason the portal exists, said plainly and permanently. A vendor
          who has not opened the catalogue does not know the codes are here. */}
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-stone-900 text-white">
        <div>
          <p className="text-sm font-medium">Write the code on every piece before you pack</p>
          <p className="text-xs text-stone-300">
            Your codes are listed here. Labelling them means your parcel is checked in the same day
            it arrives instead of waiting to be identified.
          </p>
        </div>
        <Link href="/portal/catalogue">
          <Button className="bg-white text-stone-900 hover:bg-stone-100">See my codes</Button>
        </Link>
      </Card>

      <WorkSection
        title="Please accept"
        hint="New orders. Accept them and tell us the date you can make."
        count={toAccept.length}
      >
        {toAccept.map((o) => (
          <OrderRow key={o.id} order={o} cta="Accept" />
        ))}
      </WorkSection>

      <WorkSection
        title="To make and send"
        hint="Accepted. Tell us when you dispatch so the warehouse can expect it."
        count={toMake.length}
      >
        {toMake.map((o) => (
          <OrderRow key={o.id} order={o} cta="Update" />
        ))}
      </WorkSection>

      <WorkSection
        title="On the way"
        hint="Dispatched. We will confirm the count on arrival."
        count={inTransit.length}
      >
        {inTransit.map((o) => (
          <OrderRow key={o.id} order={o} />
        ))}
      </WorkSection>

      <WorkSection
        title="Send us the bill"
        hint="Received and counted. Upload your bill here and it goes straight to accounts."
        count={billable.length}
      >
        {billable.map((o) => (
          <OrderRow key={o.id} order={o} cta="Upload bill" />
        ))}
      </WorkSection>

      {nothingToDo && orders.length > 0 && (
        <Card>
          <p className="text-sm font-medium">Nothing needs you right now.</p>
          <p className="text-sm text-stone-500">
            When a new order is sent you will get an SMS with a link straight to it.
          </p>
        </Card>
      )}

      {orders.length === 0 && (
        <EmptyState
          title="No orders yet"
          body="When Nerige Story sends you an order it appears here, and you will get an SMS. You will be able to accept it, tell us when it ships, and upload your bill."
        />
      )}

      {bills.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Your bills</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {bills.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{b.bill_number}</span>
                  <span className="ml-2 text-stone-500">{formatDate(b.bill_date)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{money(b.total_amount)}</span>
                  <StatusBadge
                    status={b.status}
                    label={BILL_STATUS_META[b.status as BillStatus]?.label}
                  />
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-stone-500">
            Payment status updates here as soon as it changes — no need to call and ask.
          </p>
        </Card>
      )}

      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-500">Past orders ({done.length})</summary>
          <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white px-4">
            {done.map((o) => (
              <li key={o.id} className="py-2">
                <Link href={`/portal/orders/${o.id}`} className="flex justify-between gap-2">
                  <span className="font-mono text-xs text-stone-500">{o.po_number}</span>
                  <StatusBadge status={o.status} label={PO_STATUS_META[o.status].label} />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function OrderRow({ order, cta }: { order: PortalOrder; cta?: string }) {
  const pieces = order.purchase_order_lines.reduce((n, l) => n + l.quantity, 0)

  return (
    <Link
      href={`/portal/orders/${order.id}`}
      className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-stone-50"
    >
      <div className="min-w-0">
        <p className="font-medium">
          {order.title ?? order.po_number}
          <span className="ml-2 font-mono text-xs font-normal text-stone-400">
            {order.po_number}
          </span>
        </p>
        <p className="text-xs text-stone-500">
          {pluralise(pieces, 'piece')} · {money(order.total_amount)}
          {order.required_by && ` · ${dueLabel(order.promised_date ?? order.required_by)}`}
        </p>
      </div>
      {cta && (
        <Button variant="secondary" className="pointer-events-none">
          {cta}
        </Button>
      )}
    </Link>
  )
}
