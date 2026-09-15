import { outstanding, orderCompletion, type Completion, type RejectReason } from './rules'

/**
 * The shape an order takes at the receiving bench.
 *
 * Separate from the queries that fill it, as `src/lib/orders/view.ts` is, so
 * the bucketing below is pure and tested rather than living inside a page.
 *
 * Photographs and titles come from the line SNAPSHOTS, never from `products`:
 * the bench checks the parcel against what was ordered, and the warehouse role
 * holds no read on products (its cost column is not the bench's business).
 */

export interface InwardReference {
  sku: string
  imageUrl: string | null
}

export interface InwardLine {
  id: string
  kind: 'restock' | 'new_design'
  sku: string | null
  title: string | null
  imageUrl: string | null
  brief: string | null
  references: InwardReference[]
  ordered: number
  received: number
  rejected: number
  outstanding: number
}

export interface InwardParcelLine {
  orderLineId: string
  received: number
  rejected: number
  reason: RejectReason | null
  note: string | null
}

export interface InwardParcel {
  id: string
  receivedAt: string
  receivedBy: string | null
  note: string | null
  closesOrder: boolean
  lines: InwardParcelLine[]
}

export interface InwardOrder {
  id: string
  orderNumber: string
  status: string
  vendorCode: string | null
  vendorName: string | null
  issuedAt: string
  promisedDate: string | null
  dispatchedAt: string | null
  docket: string | null
  receivedAt: string | null
  lines: InwardLine[]
  parcels: InwardParcel[]
  completion: Completion
  piecesOrdered: number
  piecesOutstanding: number
}

/** One select, used by the list and the detail alike, so the two cannot drift. */
export const INWARD_ORDER_SELECT = `
  id, order_number, status, issued_at, promised_date, dispatched_at, transport_docket, received_at,
  vendors ( code, display_name ),
  order_lines (
    id, line_type, sku, brief, quantity, snapshot_title, snapshot_image_url,
    order_line_refs ( sku, snapshot_image_url ),
    order_line_receipts ( qty_received, qty_rejected )
  ),
  order_receipts (
    id, received_at, received_by_name, note, closes_order,
    order_line_receipts ( order_line_id, qty_received, qty_rejected, reject_reason, note )
  )
`

type OneOrMany<T> = T | T[] | null | undefined

function one<T>(v: OneOrMany<T>): T | null {
  // PostgREST returns a to-one embed as an array when it cannot prove the
  // relationship is to-one. Normalise both shapes rather than assume either.
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

export interface RawInwardOrder {
  id: string
  order_number: string
  status: string
  issued_at: string
  promised_date: string | null
  dispatched_at: string | null
  transport_docket: string | null
  received_at: string | null
  vendors: OneOrMany<{ code: string; display_name: string }>
  order_lines:
    | {
        id: string
        line_type: 'restock' | 'new_design'
        sku: string | null
        brief: string | null
        quantity: number
        snapshot_title: string | null
        snapshot_image_url: string | null
        order_line_refs?: { sku: string; snapshot_image_url: string | null }[] | null
        order_line_receipts?: { qty_received: number; qty_rejected: number }[] | null
      }[]
    | null
  order_receipts?:
    | {
        id: string
        received_at: string
        received_by_name: string | null
        note: string | null
        closes_order: boolean
        order_line_receipts?:
          | {
              order_line_id: string
              qty_received: number
              qty_rejected: number
              reject_reason: RejectReason | null
              note: string | null
            }[]
          | null
      }[]
    | null
}

export function toInwardOrder(row: RawInwardOrder): InwardOrder {
  const vendor = one(row.vendors)

  const lines: InwardLine[] = (row.order_lines ?? [])
    .map((l) => {
      const received = (l.order_line_receipts ?? []).reduce((n, r) => n + r.qty_received, 0)
      const rejected = (l.order_line_receipts ?? []).reduce((n, r) => n + r.qty_rejected, 0)
      return {
        id: l.id,
        kind: l.line_type,
        sku: l.sku,
        title: l.snapshot_title,
        imageUrl: l.snapshot_image_url,
        brief: l.brief,
        references: (l.order_line_refs ?? []).map((r) => ({ sku: r.sku, imageUrl: r.snapshot_image_url })),
        ordered: l.quantity,
        received,
        rejected,
        outstanding: outstanding({ ordered: l.quantity, received, rejected }),
      }
    })
    // Restock first, as on the weaver's own screen: those carry a code and are
    // checked first at the bench. Then by SKU, so a printed sheet is stable.
    .sort((a, b) =>
      a.kind === b.kind ? (a.sku ?? a.id).localeCompare(b.sku ?? b.id) : a.kind === 'restock' ? -1 : 1,
    )

  const parcels: InwardParcel[] = (row.order_receipts ?? [])
    .map((p) => ({
      id: p.id,
      receivedAt: p.received_at,
      receivedBy: p.received_by_name,
      note: p.note,
      closesOrder: p.closes_order,
      lines: (p.order_line_receipts ?? []).map((lr) => ({
        orderLineId: lr.order_line_id,
        received: lr.qty_received,
        rejected: lr.qty_rejected,
        reason: lr.reject_reason,
        note: lr.note,
      })),
    }))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    vendorCode: vendor?.code ?? null,
    vendorName: vendor?.display_name ?? null,
    issuedAt: row.issued_at,
    promisedDate: row.promised_date,
    dispatchedAt: row.dispatched_at,
    docket: row.transport_docket,
    receivedAt: row.received_at,
    lines,
    parcels,
    completion: orderCompletion(lines, {
      hasParcel: parcels.length > 0,
      closedShort: parcels.some((p) => p.closesOrder),
    }),
    piecesOrdered: lines.reduce((n, l) => n + l.ordered, 0),
    piecesOutstanding: lines.reduce((n, l) => n + l.outstanding, 0),
  }
}

export interface InwardBuckets {
  /** Dispatched, nothing opened yet. Oldest dispatch first: it has waited longest. */
  expected: InwardOrder[]
  /** Dispatched, at least one parcel opened, pieces still to come. */
  partiallyReceived: InwardOrder[]
  /** Accepted, promised date passed, not sent. Visible, not receivable. */
  lateNotDispatched: InwardOrder[]
  /** Received on or after `receivedSince`. Newest first. */
  receivedRecently: InwardOrder[]
}

/**
 * Sorts orders into the four piles the bench works from.
 *
 * `today` is a `yyyy-MM-dd` string in the business's time zone and
 * `receivedSince` an ISO timestamp, both passed in so this stays pure.
 */
export function bucketForInward(
  orders: readonly InwardOrder[],
  today: string,
  receivedSince: string,
): InwardBuckets {
  const byDispatch = (a: InwardOrder, b: InwardOrder) =>
    (a.dispatchedAt ?? a.issuedAt).localeCompare(b.dispatchedAt ?? b.issuedAt)

  return {
    expected: orders.filter((o) => o.status === 'dispatched' && o.parcels.length === 0).sort(byDispatch),
    partiallyReceived: orders
      .filter((o) => o.status === 'dispatched' && o.parcels.length > 0)
      .sort(byDispatch),
    lateNotDispatched: orders
      .filter((o) => o.status === 'accepted' && o.promisedDate !== null && o.promisedDate < today)
      .sort((a, b) => (a.promisedDate ?? '').localeCompare(b.promisedDate ?? '')),
    receivedRecently: orders
      .filter((o) => o.status === 'received' && o.receivedAt !== null && o.receivedAt >= receivedSince)
      .sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '')),
  }
}

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  damaged: 'Damaged',
  wrong_design: 'Wrong design',
  weaving_error: 'Weaving error',
  other: 'Other',
}
