/**
 * The shape a vendor order takes on screen.
 *
 * Deliberately separate from the query that produces it. The cards render from
 * this and nothing else, so the same components can be driven from PostgREST in
 * the application and from a direct SQL connection in a preview or a test —
 * which is how the screen gets looked at before there is a Supabase project to
 * look at it in.
 *
 * Everything here comes from the SNAPSHOT columns on the line, never from the
 * live product row. A vendor must see what was ordered, not what the record
 * later became: a re-shoot that swaps the photograph must not silently change
 * an order she has already accepted.
 */

export type OrderStatus = 'issued' | 'accepted' | 'dispatched' | 'received' | 'cancelled'
export type ReorderReason = 'sold_out' | 'last_piece'

export interface ReferencePhoto {
  sku: string
  imageUrl: string | null
}

/**
 * A saree she has made before. The code comes back on the piece.
 *
 * No description. `snapshot_desc` is still written when an order is created —
 * the record of what was ordered stays complete — but no screen renders it, so
 * it is not fetched either. On a 12-line order that is a few kilobytes of
 * marketing copy nobody reads, on a phone, over a mobile connection.
 */
export interface RestockLine {
  id: string
  sku: string
  title: string | null
  imageUrl: string | null
  quantity: number
  reorderReason: ReorderReason | null
}

/** "Make me more like these." Nothing comes back with a code on it. */
export interface NewDesignLine {
  id: string
  brief: string
  quantity: number
  references: ReferencePhoto[]
}

export interface VendorOrder {
  id: string
  orderNumber: string
  status: OrderStatus
  issuedAt: string
  promisedDate: string | null
  dispatchedAt: string | null
  transportDocket: string | null
  restock: RestockLine[]
  newDesigns: NewDesignLine[]
}

/** The row shape the query returns, before it is split into two sections. */
export interface RawOrderLine {
  id: string
  line_type: 'restock' | 'new_design'
  sku: string | null
  brief: string | null
  quantity: number
  reorder_reason: string | null
  snapshot_title: string | null
  snapshot_image_url: string | null
  order_line_refs: { sku: string; snapshot_image_url: string | null }[] | null
}

export interface RawOrder {
  id: string
  order_number: string
  status: string
  issued_at: string
  promised_date: string | null
  dispatched_at: string | null
  transport_docket: string | null
  order_lines: RawOrderLine[] | null
}

/**
 * One order, whole. Written once because two screens render it — the weaver's
 * and Pooja's — and they must not be able to drift into showing different
 * things. Two sides arguing from differently worded copies of the same order is
 * the problem this portal replaces.
 */
export const ORDER_SELECT = `
  id, order_number, status, issued_at, promised_date, dispatched_at, transport_docket,
  order_lines (
    id, line_type, sku, brief, quantity, reorder_reason,
    snapshot_title, snapshot_image_url,
    order_line_refs ( sku, snapshot_image_url )
  )
`

export function toVendorOrder(row: RawOrder): VendorOrder {
  const lines = row.order_lines ?? []

  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status as OrderStatus,
    issuedAt: row.issued_at,
    promisedDate: row.promised_date,
    dispatchedAt: row.dispatched_at,
    transportDocket: row.transport_docket,

    restock: lines
      .filter((l): l is RawOrderLine & { sku: string } => l.line_type === 'restock' && !!l.sku)
      .map((l) => ({
        id: l.id,
        sku: l.sku,
        title: l.snapshot_title,
        imageUrl: l.snapshot_image_url,
        quantity: l.quantity,
        reorderReason: (l.reorder_reason as ReorderReason | null) ?? null,
      })),

    newDesigns: lines
      .filter((l): l is RawOrderLine & { brief: string } => l.line_type === 'new_design' && !!l.brief)
      .map((l) => ({
        id: l.id,
        brief: l.brief,
        quantity: l.quantity,
        references: (l.order_line_refs ?? []).map((r) => ({
          sku: r.sku,
          imageUrl: r.snapshot_image_url,
        })),
      })),
  }
}

/**
 * Asks the Shopify CDN for a sensible size.
 *
 * 800 for a vendor card, 400 for a grid tile (spec §7). Without this a weaver
 * on a mobile connection pulls a 3,000px original for every card on the screen,
 * which on a slow signal is the difference between a usable portal and a blank
 * one.
 */
export function shopifyImage(url: string | null, width: 400 | 800): string | null {
  if (!url) return null
  return url.includes('?') ? `${url}&width=${width}` : `${url}?width=${width}`
}
