import Link from 'next/link'
import { listOrders, listReceipts } from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
  WorkSection,
} from '@/components/ui/primitives'
import { formatDate, dueLabel, pluralise } from '@/lib/format'
import { PO_STATUS_META, type PoStatus } from '@/lib/domain/procurement'

export const metadata = { title: 'Inbound · Nerige Story' }

interface InboundOrder {
  id: string
  po_number: string
  status: PoStatus
  required_by: string | null
  promised_date: string | null
  dispatched_at: string | null
  transporter: string | null
  docket_number: string | null
  parcel_count: number | null
  vendors: { display_name: string } | null
  purchase_order_lines: { quantity: number; quantity_received: number }[]
}

/**
 * The warehouse manager's whole system, on one screen.
 *
 * Ordered by what is physically most urgent rather than by date: a parcel on
 * the floor beats an order that has not left the loom. The information on each
 * row is what someone holding a consignment note needs to match it — vendor,
 * transporter, docket, parcel count — not the commercial detail, which is not
 * their job and would only be noise.
 */
export default async function InboundPage({
  searchParams,
}: {
  searchParams: Promise<{ posted?: string }>
}) {
  await requireRole('founder', 'warehouse_manager', 'procurement_head')
  const { posted } = await searchParams
  const [orderRows, drafts, recent] = await Promise.all([
    listOrders('inbound'),
    listReceipts({ status: 'draft' }),
    listReceipts({ status: 'posted' }),
  ])

  const orders = orderRows as unknown as InboundOrder[]
  const arriving = orders.filter((o) => o.status === 'dispatched' || o.status === 'partially_received')
  const later = orders.filter((o) => !['dispatched', 'partially_received'].includes(o.status))

  const piecesArriving = arriving.reduce(
    (n, o) =>
      n +
      o.purchase_order_lines.reduce(
        (m, l) => m + Math.max(l.quantity - l.quantity_received, 0),
        0,
      ),
    0,
  )
  const parcels = arriving.reduce((n, o) => n + (o.parcel_count ?? 0), 0)

  return (
    <div className="space-y-5">
      <PageHeader title="Inbound" subtitle="What is arriving, and what still needs counting." />

      {posted && <Alert tone="success">Count {posted} posted. The order has been updated.</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Consignments on the way" value={arriving.length} tone={arriving.length ? 'warn' : 'neutral'} />
        <Stat label="Pieces expected" value={piecesArriving} />
        <Stat label="Parcels declared" value={parcels || '—'} hint="As told to us by the vendor" />
      </div>

      <WorkSection
        title="Count these in"
        hint="Dispatched by the vendor. Match the docket, open the parcel, enter what is actually there."
        count={arriving.length}
      >
        {arriving.map((o) => (
          <InboundRow key={o.id} order={o} primary />
        ))}
      </WorkSection>

      <WorkSection
        title="Counts saved but not posted"
        hint="Started and left open. Nothing has moved onto the order until a count is posted."
        count={drafts?.length ?? 0}
      >
        {drafts?.map((d) => {
          const po = d.purchase_orders as unknown as
            | { po_number: string; vendors: { display_name: string } | null }
            | null
          return (
            <Link
              key={d.id}
              href={`/inbound/${d.purchase_order_id}`}
              className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50"
            >
              <span>
                <span className="font-medium">{po?.vendors?.display_name ?? 'Order'}</span>
                <span className="ml-2 font-mono text-xs text-stone-500">{d.grn_number}</span>
              </span>
              <span className="text-xs text-stone-500">{formatDate(d.received_on)}</span>
            </Link>
          )
        })}
      </WorkSection>

      <WorkSection
        title="Still with the vendor"
        hint="Not dispatched yet. Listed so a parcel that turns up early is not a surprise."
        count={later.length}
      >
        {later.map((o) => (
          <InboundRow key={o.id} order={o} />
        ))}
      </WorkSection>

      {orders.length === 0 && (drafts?.length ?? 0) === 0 && (
        <EmptyState
          title="Nothing expected"
          body="No orders are open with any vendor. When Procurement sends one, it appears here as soon as the vendor marks it dispatched."
        />
      )}

      {(recent?.length ?? 0) > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Recently counted</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {recent!.map((r) => {
              const po = r.purchase_orders as unknown as
                | { po_number: string; vendors: { display_name: string } | null }
                | null
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-mono text-xs">{r.grn_number}</span>
                    <span className="ml-2 text-stone-600">{po?.vendors?.display_name}</span>
                  </span>
                  <span className="text-xs text-stone-500">{formatDate(r.received_on)}</span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}

function InboundRow({ order, primary = false }: { order: InboundOrder; primary?: boolean }) {
  const outstanding = order.purchase_order_lines.reduce(
    (n, l) => n + Math.max(l.quantity - l.quantity_received, 0),
    0,
  )

  return (
    <Link
      href={`/inbound/${order.id}`}
      className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-stone-50"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{order.vendors?.display_name ?? 'Vendor'}</span>
          <StatusBadge status={order.status} label={PO_STATUS_META[order.status].label} />
        </div>
        <p className="mt-0.5 text-xs text-stone-500">
          <span className="font-mono">{order.po_number}</span>
          {order.transporter && ` · ${order.transporter}`}
          {order.docket_number && ` · docket ${order.docket_number}`}
          {order.parcel_count ? ` · ${pluralise(order.parcel_count, 'parcel')}` : ''}
        </p>
      </div>

      <div className="text-right">
        <p className="text-sm font-medium tabular-nums">{pluralise(outstanding, 'piece')}</p>
        <p className="text-xs text-stone-500">
          {order.dispatched_at
            ? `Sent ${formatDate(order.dispatched_at)}`
            : dueLabel(order.promised_date ?? order.required_by)}
        </p>
      </div>

      {primary && (
        <Button variant="secondary" className="pointer-events-none">
          Count
        </Button>
      )}
    </Link>
  )
}
