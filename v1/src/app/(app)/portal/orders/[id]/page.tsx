import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getOrder,
  getOrderLines,
  getOrderMessages,
  listReceipts,
  listBills,
} from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  StatusBadge,
} from '@/components/ui/primitives'
import { OrderLines, type OrderLine } from '@/components/orders/order-lines'
import { OrderThread, type ThreadMessage } from '@/components/orders/order-thread'
import { BillForm } from '@/components/bills/bill-form'
import { acceptOrder, startProduction, markDispatched } from '../../actions'
import { money, formatDate, formatDateTime, dueLabel, pluralise } from '@/lib/format'
import {
  PO_STATUS_META,
  BILL_STATUS_META,
  receivedValue,
  type PoStatus,
  type BillStatus,
} from '@/lib/domain/procurement'

export const metadata = { title: 'Order · Nerige Story' }

interface PortalOrderDetail {
  id: string
  po_number: string
  status: PoStatus
  title: string | null
  required_by: string | null
  promised_date: string | null
  instructions: string | null
  issued_at: string | null
  transporter: string | null
  docket_number: string | null
  parcel_count: number | null
  dispatched_at: string | null
  total_amount: string
  vendor_id: string
}

/**
 * One order, from the vendor's side.
 *
 * The same lines, quantities and prices the procurement screen shows — the
 * whole point being that there is one copy of the order rather than two people
 * arguing from differently-remembered versions of a phone call.
 *
 * What is added here is the one action that is theirs to take right now, at the
 * top, as a button. A vendor should never have to work out what the system
 * wants from them.
 */
export default async function PortalOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireRole('vendor')
  const { id } = await params
  const { error: errorMessage } = await searchParams
  const data = await getOrder(id, user.vendorId)

  // A draft order is invisible to the vendor at the policy level, so this is
  // also what a not-yet-sent order looks like from here. Correctly so.
  if (!data) notFound()
  const po = data as unknown as PortalOrderDetail

  const [lineRows, messageRows, receipts, allBills] = await Promise.all([
    getOrderLines(id),
    // The vendor never sees internal notes. Enforced by RLS against a real
    // database; mirrored here so the demo does not teach otherwise.
    getOrderMessages(id, false),
    listReceipts({ orderId: id, vendorId: user.vendorId }),
    listBills(user.vendorId),
  ])
  const bills = allBills.filter((b) => b.purchase_order_id === id)

  const lines = lineRows as unknown as OrderLine[]
  const messages = messageRows as unknown as ThreadMessage[]
  const anythingReceived = lines.some((l) => l.quantity_received > 0)
  const meta = PO_STATUS_META[po.status]

  return (
    <div className="space-y-5">
      <PageHeader
        title={po.title ?? `Order ${po.po_number}`}
        subtitle={`${po.po_number} · sent ${formatDate(po.issued_at)}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={po.status} label={meta.label} />
            <Link href="/portal" className="text-sm text-stone-500 hover:text-stone-900">
              My orders
            </Link>
          </div>
        }
      />

      {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

      {po.instructions && (
        <Card className="bg-stone-50 shadow-none">
          <p className="text-xs font-medium text-stone-500">From Nerige Story</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{po.instructions}</p>
        </Card>
      )}

      {/* The one thing to do next. */}
      {po.status === 'issued' && (
        <Card className="space-y-4 border-amber-200 bg-amber-50/50">
          <div>
            <h2 className="text-sm font-semibold">Please accept this order</h2>
            <p className="text-sm text-stone-600">
              {pluralise(lines.reduce((n, l) => n + l.quantity, 0), 'piece')} ·{' '}
              {money(po.total_amount)} · needed by {formatDate(po.required_by)}
            </p>
          </div>
          <form action={acceptOrder} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="purchase_order_id" value={po.id} />
            <div className="w-48">
              <Field
                label="When can you send it?"
                hint="Tell us the real date. We plan around it."
              >
                <Input type="date" name="promised_date" defaultValue={po.required_by ?? ''} />
              </Field>
            </div>
            <Button type="submit">Accept order</Button>
          </form>
          <p className="text-xs text-stone-600">
            If anything is wrong — a quantity, a price, a design — say so in the conversation below
            before accepting.
          </p>
        </Card>
      )}

      {po.status === 'acknowledged' && (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Started weaving?</h2>
          <form action={startProduction}>
            <input type="hidden" name="purchase_order_id" value={po.id} />
            <Button type="submit" variant="secondary">
              Mark as in production
            </Button>
          </form>
        </Card>
      )}

      {['acknowledged', 'in_production'].includes(po.status) && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Sending it out?</h2>
            <p className="text-xs text-stone-500">
              The warehouse uses this to trace your parcel if anything goes missing.
            </p>
          </div>
          <form action={markDispatched} className="grid gap-4 sm:grid-cols-3">
            <input type="hidden" name="purchase_order_id" value={po.id} />
            <Field label="Transporter" required>
              <Input name="transporter" required placeholder="VRL Logistics" />
            </Field>
            <Field label="Docket / LR number">
              <Input name="docket_number" placeholder="VRL-88213" />
            </Field>
            <Field label="How many parcels">
              <Input type="number" name="parcel_count" min={1} step={1} placeholder="3" />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit">Mark as dispatched</Button>
            </div>
          </form>
        </Card>
      )}

      {po.status === 'dispatched' && (
        <Alert tone="info">
          On its way — {po.transporter}
          {po.docket_number && `, docket ${po.docket_number}`}
          {po.parcel_count && `, ${pluralise(po.parcel_count, 'parcel')}`}. We will confirm the
          count here once it arrives.
        </Alert>
      )}

      <OrderLines lines={lines} showReceived={anythingReceived} />

      <p className="text-xs text-stone-500">
        Write the code shown against each item on the piece itself before packing. Parcels that
        arrive labelled are checked in the same day.
      </p>

      {receipts.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">What we counted</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {receipts.map((r) => {
              const grnLines = (r.goods_receipt_lines ?? []) as {
                quantity_received: number
                quantity_damaged: number
              }[]
              const good = grnLines.reduce((n, l) => n + l.quantity_received, 0)
              const damaged = grnLines.reduce((n, l) => n + l.quantity_damaged, 0)

              return (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-stone-600">{formatDate(r.received_on)}</span>
                  <span className="tabular-nums">
                    {good} good{damaged > 0 && `, ${damaged} damaged`}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-stone-500">
            If this does not match what you sent, raise it in the conversation below — the count is
            on the record and we can check it against your docket.
          </p>
        </Card>
      )}

      {bills.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Your bill for this order</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {bills.map((b) => (
              <li key={b.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                </div>
                {b.due_date && !['paid', 'rejected'].includes(b.status) && (
                  <p className="text-xs text-stone-500">Payable by {formatDate(b.due_date)}</p>
                )}
                {b.variance_note && (
                  <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    Query from Nerige Story: {b.variance_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {anythingReceived && bills.length === 0 && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Send us your bill</h2>
            <p className="text-sm text-stone-500">
              Photograph the hard copy and upload it here. It reaches accounts immediately and you
              can see its payment status without calling.
            </p>
          </div>
          <BillForm
            orders={[
              {
                id: po.id,
                po_number: po.po_number,
                label: po.title ?? po.po_number,
                receivedValue: receivedValue(lines),
              },
            ]}
            defaultOrderId={po.id}
            audience="vendor"
          />
        </Card>
      )}

      <OrderThread
        purchaseOrderId={po.id}
        vendorId={po.vendor_id}
        messages={messages}
        returnTo={`/portal/orders/${po.id}`}
        canPostInternal={false}
      />

      <p className="text-xs text-stone-400">
        Sent {formatDateTime(po.issued_at)} · needed by {formatDate(po.required_by)}
        {po.promised_date && ` · you promised ${formatDate(po.promised_date)}`} ·{' '}
        {dueLabel(po.promised_date ?? po.required_by)}
      </p>
    </div>
  )
}
