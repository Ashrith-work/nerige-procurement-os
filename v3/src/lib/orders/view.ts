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

import { cropForMode, type CropRect } from '@/lib/products/image'

export type OrderStatus = 'issued' | 'accepted' | 'dispatched' | 'received' | 'cancelled'
export type ReorderReason = 'sold_out' | 'last_piece'

export interface ReferencePhoto {
  sku: string
  imageUrl: string | null
  /** See RestockLine.crop — the same rule, for a reference photograph. */
  crop: CropRect
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
  /**
   * How this design is selling right now — deliberately NOT a snapshot.
   *
   * Everything else on the card is frozen at the moment the order was issued,
   * because a re-shoot must not change the photograph on an order she has
   * already accepted. This is the exception, and it is not an inconsistency:
   * "36 sold in 90 days" is not part of what was ordered, it is context about
   * the design, and context that is three months stale is worth less than
   * none. Null until a sales sync has run.
   */
  unitsSold: number | null
  tier: number | null
  /**
   * How the photograph is framed, and the SECOND deliberate exception to the
   * snapshot rule.
   *
   * The crop belongs to the product, not to the order: it is not part of what
   * was ordered, it is how the same photograph is shown. Freezing it would mean
   * correcting a badly framed saree fixed her catalogue and the card she is
   * sent on WhatsApp while leaving the order screen showing the old framing —
   * three views of one saree, two of them right. The card route
   * (api/orders/[id]/cards) already reads it live for exactly this reason.
   */
  crop: CropRect
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
  order_line_refs:
    | { sku: string; snapshot_image_url: string | null; products: RawProductFraming | RawProductFraming[] | null }[]
    | null
  products: RawLineProduct | RawLineProduct[] | null
}

/** The framing columns, as they come back from an embed. */
export interface RawProductFraming {
  crop_json: CropRect | null
  crop_mode: string | null
}

export interface RawLineProduct extends RawProductFraming {
  units_90d: number | null
  tier_90: number | null
  sales_synced_at: string | null
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
    order_line_refs ( sku, snapshot_image_url, products ( crop_json, crop_mode ) ),
    products ( units_90d, tier_90, sales_synced_at, crop_json, crop_mode )
  )
`

/**
 * The crop a product carries, or the default framing when the product row is
 * gone — a design deleted from Shopify still has an order against it, and an
 * uncropped photograph is better than a blank card.
 */
function framing(product: RawProductFraming | null | undefined): CropRect {
  const crop = product?.crop_json
  if (crop && crop.w > 0 && crop.h > 0) return crop
  return cropForMode(product?.crop_mode)
}

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
      .map((l) => {
        // PostgREST returns an embed as an array when it cannot prove the
        // relationship is to-one. order_lines.sku is a plain FK, so there is at
        // most one — normalise both shapes rather than assuming either.
        const product = Array.isArray(l.products) ? l.products[0] : l.products

        return {
          id: l.id,
          sku: l.sku,
          title: l.snapshot_title,
          imageUrl: l.snapshot_image_url,
          quantity: l.quantity,
          reorderReason: (l.reorder_reason as ReorderReason | null) ?? null,
          // Null until a sales sync has run: a confident zero would read as
          // "this has never sold" rather than "we do not know yet".
          unitsSold: product?.sales_synced_at ? (product.units_90d ?? 0) : null,
          tier: product?.sales_synced_at ? (product.tier_90 ?? null) : null,
          crop: framing(product),
        }
      }),

    newDesigns: lines
      .filter((l): l is RawOrderLine & { brief: string } => l.line_type === 'new_design' && !!l.brief)
      .map((l) => ({
        id: l.id,
        brief: l.brief,
        quantity: l.quantity,
        references: (l.order_line_refs ?? []).map((r) => ({
          sku: r.sku,
          imageUrl: r.snapshot_image_url,
          crop: framing(Array.isArray(r.products) ? r.products[0] : r.products),
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
