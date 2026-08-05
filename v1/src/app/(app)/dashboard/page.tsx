import Link from 'next/link'
import { listVendors } from '@/lib/data/vendors'
import { listOrders, listBills } from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import {
  Button,
  Card,
  PageHeader,
  Stat,
  StatusBadge,
  WorkSection,
} from '@/components/ui/primitives'
import { money, formatDate, dueLabel, daysUntil, hoursSince, pluralise } from '@/lib/format'
import { PO_STATUS_META, type PoStatus, type BillStatus } from '@/lib/domain/procurement'

export const metadata = { title: 'Dashboard · Nerige Story' }

interface DashOrder {
  id: string
  po_number: string
  status: PoStatus
  title: string | null
  required_by: string | null
  promised_date: string | null
  issued_at: string | null
  total_amount: string
  vendors: { display_name: string } | null
  purchase_order_lines: { quantity: number; quantity_received: number }[]
}

interface DashBill {
  id: string
  bill_number: string
  status: BillStatus
  total_amount: string
  variance_amount: string | null
  due_date: string | null
  bill_date: string
  purchase_order_id: string
  vendors: { display_name: string; msme_category: string } | null
}

/**
 * The Procurement Head's dashboard.
 *
 * Built around one question — what needs me today? — because that is the
 * question being answered right now by scrolling a WhatsApp thread. Every
 * section is a list of things somebody has to act on, and every one of them
 * disappears when it is dealt with. Nothing here is a vanity metric.
 *
 * The four gaps this is watching, in the order they cost money:
 *   1. orders sent and never acknowledged — the vendor may not have seen it
 *   2. orders past their date — the reason a drop slips
 *   3. stock received with no bill against it — spend that goes unrecorded,
 *      the single problem the founder named outright
 *   4. bills whose figures do not match what arrived — paying for air
 */
export default async function DashboardPage() {
  await requireRole('founder', 'procurement_head')

  const [orderRows, billRows, { vendors }] = await Promise.all([
    listOrders('open'),
    listBills(),
    listVendors(),
  ])

  const orders = orderRows as unknown as DashOrder[]
  const bills = billRows as unknown as DashBill[]

  // --- The four gaps ---------------------------------------------------------
  // 48 hours matches the deferred chase event the outbox queues on issue, so
  // this list and the reminder the vendor receives never disagree.
  const unacknowledged = orders.filter(
    (o) => o.status === 'issued' && (hoursSince(o.issued_at) ?? 0) >= 48,
  )

  const late = orders.filter(
    (o) =>
      !['received'].includes(o.status) &&
      (daysUntil(o.promised_date ?? o.required_by) ?? 1) < 0,
  )

  const billedOrderIds = new Set(bills.map((b) => b.purchase_order_id))
  const unbilled = orders.filter(
    (o) => ['partially_received', 'received'].includes(o.status) && !billedOrderIds.has(o.id),
  )

  const toReview = bills.filter((b) => b.status === 'submitted')
  const variances = bills.filter(
    (b) => !['paid', 'rejected'].includes(b.status) && Number(b.variance_amount ?? 0) > 0,
  )
  const dueSoon = bills.filter(
    (b) =>
      !['paid', 'rejected'].includes(b.status) &&
      (daysUntil(b.due_date) ?? 999) <= 7,
  )

  // --- Money -----------------------------------------------------------------
  const committed = orders.reduce((sum, o) => sum + Number(o.total_amount), 0)
  const unpaid = bills
    .filter((b) => !['paid', 'rejected'].includes(b.status))
    .reduce((sum, b) => sum + Number(b.total_amount), 0)

  const monthStart = new Date()
  monthStart.setDate(1)
  const paidThisMonth = bills
    .filter((b) => b.status === 'paid' && new Date(b.bill_date) >= monthStart)
    .reduce((sum, b) => sum + Number(b.total_amount), 0)

  const pendingKyc = vendors.filter((v) => v.status === 'pending_kyc')
  const nothingUrgent =
    unacknowledged.length === 0 &&
    late.length === 0 &&
    unbilled.length === 0 &&
    toReview.length === 0 &&
    variances.length === 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="What needs you today."
        action={
          <Link href="/purchase-orders/new">
            <Button>New order</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Open orders"
          value={orders.length}
          hint={money(committed) + ' committed'}
          href="/purchase-orders?filter=open"
        />
        <Stat
          label="Late"
          value={late.length}
          tone={late.length ? 'bad' : 'good'}
          href="/purchase-orders?filter=late"
        />
        <Stat
          label="Unbilled deliveries"
          value={unbilled.length}
          tone={unbilled.length ? 'warn' : 'good'}
          hint="Stock in, no bill attached"
        />
        <Stat
          label="Owed to vendors"
          value={money(unpaid)}
          hint={dueSoon.length ? `${pluralise(dueSoon.length, 'bill')} due within 7 days` : 'Nothing due this week'}
          tone={dueSoon.length ? 'warn' : 'neutral'}
          href="/bills"
        />
      </div>

      {nothingUrgent && (
        <Card>
          <p className="text-sm font-medium">Nothing needs chasing.</p>
          <p className="text-sm text-stone-500">
            Every order is acknowledged and on time, every delivery has a bill against it, and no
            bill is waiting to be checked.
          </p>
        </Card>
      )}

      <WorkSection
        title="Sent but not acknowledged"
        hint="Two days or more without a response. The vendor may not have seen it — a call is usually faster than waiting."
        count={unacknowledged.length}
      >
        {unacknowledged.map((o) => (
          <OrderRow key={o.id} order={o} note={`Sent ${formatDate(o.issued_at)}`} />
        ))}
      </WorkSection>

      <WorkSection
        title="Past the agreed date"
        hint="Measured against the date the vendor promised where there is one, not the date we asked for."
        count={late.length}
      >
        {late.map((o) => (
          <OrderRow key={o.id} order={o} note={dueLabel(o.promised_date ?? o.required_by)} tone="bad" />
        ))}
      </WorkSection>

      <WorkSection
        title="Received, no bill"
        hint="Stock is on the shelves and nothing has been billed for it. This is where spend stops being traceable."
        count={unbilled.length}
      >
        {unbilled.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <Link href={`/purchase-orders/${o.id}`} className="font-medium hover:underline">
                {o.vendors?.display_name}
              </Link>
              <p className="text-xs text-stone-500">
                <span className="font-mono">{o.po_number}</span> ·{' '}
                {pluralise(
                  o.purchase_order_lines.reduce((n, l) => n + l.quantity_received, 0),
                  'piece',
                )}{' '}
                counted in
              </p>
            </div>
            <Link href={`/bills/new?po=${o.id}`}>
              <Button variant="secondary">Add bill</Button>
            </Link>
          </li>
        ))}
      </WorkSection>

      <WorkSection
        title="Bills to check"
        hint="Uploaded and waiting. Match each against what was counted in."
        count={toReview.length}
      >
        {toReview.map((b) => (
          <BillRow key={b.id} bill={b} />
        ))}
      </WorkSection>

      <WorkSection
        title="Billed for more than arrived"
        hint="Query these before they are approved."
        count={variances.length}
      >
        {variances.map((b) => (
          <BillRow key={b.id} bill={b} tone="bad" />
        ))}
      </WorkSection>

      {pendingKyc.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Vendors blocked from ordering</h2>
          <p className="text-xs text-stone-500">
            No order can be sent until KYC is complete — an unvetted vendor cannot legally be paid.
          </p>
          <ul className="divide-y divide-stone-100">
            {pendingKyc.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/vendors/${v.id}`} className="text-sm font-medium hover:underline">
                  {v.display_name}
                </Link>
                <StatusBadge status={v.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Paid this month</p>
          <p className="text-xs text-stone-500">Bills settled since the 1st.</p>
        </div>
        <p className="text-xl font-semibold tabular-nums">{money(paidThisMonth)}</p>
      </Card>
    </div>
  )
}

function OrderRow({
  order,
  note,
  tone,
}: {
  order: DashOrder
  note: string
  tone?: 'bad'
}) {
  return (
    <li className="py-3">
      <Link
        href={`/purchase-orders/${order.id}`}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <span className="font-medium">{order.vendors?.display_name}</span>
          <span className="ml-2 text-sm text-stone-500">{order.title ?? order.po_number}</span>
          <p className="text-xs text-stone-500">
            <span className="font-mono">{order.po_number}</span> ·{' '}
            <StatusBadge status={order.status} label={PO_STATUS_META[order.status].label} />
          </p>
        </div>
        <div className="text-right">
          <p className="font-medium tabular-nums">{money(order.total_amount)}</p>
          <p className={`text-xs ${tone === 'bad' ? 'font-medium text-red-700' : 'text-stone-500'}`}>
            {note}
          </p>
        </div>
      </Link>
    </li>
  )
}

function BillRow({ bill, tone }: { bill: DashBill; tone?: 'bad' }) {
  const variance = Number(bill.variance_amount ?? 0)

  return (
    <li className="py-3">
      <Link href={`/bills/${bill.id}`} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-medium">{bill.vendors?.display_name}</span>
          <span className="ml-2 text-sm text-stone-500">{bill.bill_number}</span>
          <p className="text-xs text-stone-500">{dueLabel(bill.due_date)}</p>
        </div>
        <div className="text-right">
          <p className="font-medium tabular-nums">{money(bill.total_amount)}</p>
          {tone === 'bad' && variance > 0 && (
            <p className="text-xs font-medium text-red-700">{money(variance)} over</p>
          )}
        </div>
      </Link>
    </li>
  )
}
