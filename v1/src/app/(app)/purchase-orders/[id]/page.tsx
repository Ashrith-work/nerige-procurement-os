import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getOrder,
  getOrderLines,
  getOrderMessages,
  listReceipts,
  listBills,
  listProducts,
  listSeries,
} from '@/lib/data/procurement'
import { requireUser } from '@/lib/auth/session'
import {
  Alert,
  Button,
  Card,
  Input,
  PageHeader,
  StatusBadge,
} from '@/components/ui/primitives'
import { OrderLines, type OrderLine } from '@/components/orders/order-lines'
import { OrderThread, type ThreadMessage } from '@/components/orders/order-thread'
import { LineForms, type ProductOption, type SeriesOption } from './line-forms'
import { issuePurchaseOrder, cancelPurchaseOrder, removeLine } from '../actions'
import { money, moneyExact, formatDate, formatDateTime, dueLabel } from '@/lib/format'
import {
  PO_STATUS_META,
  BILL_STATUS_META,
  canManageOrders,
  canReceiveGoods,
  canHandleBills,
  type PoStatus,
  type BillStatus,
} from '@/lib/domain/procurement'

interface OrderDetail {
  id: string
  po_number: string
  status: PoStatus
  title: string | null
  required_by: string | null
  promised_date: string | null
  instructions: string | null
  issued_at: string | null
  acknowledged_at: string | null
  dispatched_at: string | null
  transporter: string | null
  docket_number: string | null
  parcel_count: number | null
  received_at: string | null
  cancellation_reason: string | null
  subtotal_amount: string
  tax_amount: string
  total_amount: string
  vendor_id: string
  vendors: { display_name: string; code: string; primary_phone: string | null } | null
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Deliberately not surfacing a load failure here: a broken tab title is not
  // worth failing the page render over, and the page itself reports the error.
  const order = await getOrder(id).catch(() => null)
  return { title: `${order?.po_number ?? 'Order'} · Nerige Story` }
}

export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const { error: errorMessage } = await searchParams
  const data = await getOrder(id)

  // RLS makes an order the caller may not see indistinguishable from one that
  // does not exist. That is the correct behaviour — the alternative leaks the
  // fact that a given order number belongs to somebody.
  if (!data) notFound()
  const po = data as unknown as OrderDetail

  const [lineRows, messageRows, receipts, allBills] = await Promise.all([
    getOrderLines(id),
    getOrderMessages(id, true),
    listReceipts({ orderId: id }),
    listBills(),
  ])
  const bills = allBills.filter((b) => b.purchase_order_id === id)

  const lines = lineRows as unknown as OrderLine[]
  const messages = messageRows as unknown as ThreadMessage[]

  const isDraft = po.status === 'draft'
  const canEdit = canManageOrders(user.role) && (isDraft || po.status === 'issued')
  const anythingReceived = lines.some((l) => l.quantity_received > 0)
  const meta = PO_STATUS_META[po.status]

  // The catalogue this vendor can actually be ordered from. Fetched only when
  // the order is still open to editing — no point paying for it otherwise.
  let products: ProductOption[] = []
  let series: SeriesOption[] = []
  if (canEdit) {
    const [p, sr] = await Promise.all([
      listProducts({ vendorFilter: po.vendor_id }),
      listSeries(po.vendor_id),
    ])
    products = p as unknown as ProductOption[]
    series = sr as unknown as SeriesOption[]
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={po.vendors?.display_name ?? 'Order'}
        subtitle={`${po.po_number}${po.title ? ` · ${po.title}` : ''}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={po.status} label={meta.label} />
            <Link href="/purchase-orders" className="text-sm text-stone-500 hover:text-stone-900">
              All orders
            </Link>
          </div>
        }
      />

      {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

      {po.status === 'cancelled' && po.cancellation_reason && (
        <Alert tone="error">Cancelled — {po.cancellation_reason}</Alert>
      )}

      {/* What happens next, stated rather than implied by a status word. */}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{meta.hint}</p>
          <p className="text-xs text-stone-500">
            {po.required_by ? `Needed by ${formatDate(po.required_by)} · ${dueLabel(po.required_by)}` : 'No date set'}
            {po.promised_date && ` · vendor promised ${formatDate(po.promised_date)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDraft && canManageOrders(user.role) && (
            <form action={issuePurchaseOrder}>
              <input type="hidden" name="purchase_order_id" value={po.id} />
              <Button type="submit" disabled={lines.length === 0}>
                Send to vendor
              </Button>
            </form>
          )}

          {canReceiveGoods(user.role) &&
            !['draft', 'received', 'closed', 'cancelled'].includes(po.status) && (
              <Link href={`/inbound/${po.id}`}>
                <Button variant="secondary">Count stock in</Button>
              </Link>
            )}

          {canHandleBills(user.role) && (po.status === 'received' || anythingReceived) && (
            <Link href={`/bills/new?po=${po.id}`}>
              <Button variant={bills.length ? 'secondary' : 'primary'}>Add bill</Button>
            </Link>
          )}
        </div>
      </Card>

      <OrderLines
        lines={lines}
        showReceived={anythingReceived || ['dispatched', 'partially_received', 'received', 'closed'].includes(po.status)}
        action={
          isDraft && canManageOrders(user.role)
            ? (line) => (
                <form action={removeLine}>
                  <input type="hidden" name="purchase_order_id" value={po.id} />
                  <input type="hidden" name="line_id" value={line.id} />
                  <button
                    type="submit"
                    className="text-xs text-stone-400 hover:text-red-700"
                    aria-label={`Remove line ${line.line_no}`}
                  >
                    Remove
                  </button>
                </form>
              )
            : undefined
        }
      />

      {canEdit && <LineForms purchaseOrderId={po.id} products={products} series={series} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Order</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Value" value={money(po.total_amount)} />
            <Row label="Of which GST" value={moneyExact(po.tax_amount)} />
            <Row label="Sent" value={formatDateTime(po.issued_at)} />
            <Row label="Accepted" value={formatDateTime(po.acknowledged_at)} />
            <Row label="Dispatched" value={formatDateTime(po.dispatched_at)} />
            {po.transporter && <Row label="Transporter" value={po.transporter} />}
            {po.docket_number && <Row label="Docket" value={po.docket_number} />}
            {po.parcel_count !== null && <Row label="Parcels" value={String(po.parcel_count)} />}
            <Row label="Received" value={formatDateTime(po.received_at)} />
          </dl>
          {po.instructions && (
            <div className="rounded-lg bg-stone-50 px-3 py-2">
              <p className="text-xs font-medium text-stone-500">Instructions to the vendor</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{po.instructions}</p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {receipts.length > 0 && (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Counted in</h2>
              <ul className="divide-y divide-stone-100 text-sm">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <Link href={`/inbound/${po.id}`} className="font-mono text-xs hover:underline">
                        {r.grn_number}
                      </Link>
                      <span className="ml-2 text-stone-500">{formatDate(r.received_on)}</span>
                    </span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canHandleBills(user.role) && (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Bills</h2>
              {bills.length === 0 ? (
                <p className="text-sm text-stone-500">
                  {anythingReceived
                    ? 'Stock is in but no bill has been attached yet. This is the gap where spend goes missing.'
                    : 'No bill yet.'}
                </p>
              ) : (
                <ul className="divide-y divide-stone-100 text-sm">
                  {bills.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        <Link href={`/bills/${b.id}`} className="font-medium hover:underline">
                          {b.bill_number}
                        </Link>
                        <span className="ml-2 text-stone-500">{formatDate(b.bill_date)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{money(b.total_amount)}</span>
                        <StatusBadge
                          status={b.status}
                          label={BILL_STATUS_META[b.status as BillStatus]?.label}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      <OrderThread
        purchaseOrderId={po.id}
        vendorId={po.vendor_id}
        messages={messages}
        returnTo={`/purchase-orders/${po.id}`}
        canPostInternal
      />

      {canManageOrders(user.role) && !['closed', 'cancelled', 'received'].includes(po.status) && (
        <Card className="space-y-3 border-red-100">
          <h2 className="text-sm font-semibold text-red-800">Cancel this order</h2>
          <p className="text-sm text-stone-500">
            The vendor is told immediately. Anything already counted in stays on the record.
          </p>
          <form action={cancelPurchaseOrder} className="flex flex-wrap gap-2">
            <input type="hidden" name="purchase_order_id" value={po.id} />
            <Input
              name="cancellation_reason"
              required
              maxLength={500}
              placeholder="Why is it being cancelled?"
              className="max-w-sm"
            />
            <Button type="submit" variant="danger">
              Cancel order
            </Button>
          </form>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  )
}
