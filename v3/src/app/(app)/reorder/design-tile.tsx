'use client'

import { useState } from 'react'
import { useSelection, type Selected } from '@/lib/reorder/selection'
import { StockLine } from '@/components/stock-line'
import { SalesBadges } from '@/components/sales-badges'
import { getDictionary } from '@/lib/i18n'
import { resolveProductImage, cropStyle, sizedImage, type CropRect } from '@/lib/products/image'
import { unitsColumn, tierColumn, type Tier, type Window } from '@/lib/reorder/sort'

export interface Design {
  sku: string
  title: string | null
  image_url: string | null
  image_urls: string[] | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: CropRect | null
  crop_mode: string | null
  price: string | number | null
  qty_available: number
  stock_synced_at: string | null
  units_30d: number | null
  units_60d: number | null
  units_90d: number | null
  tier_30: number | null
  tier_60: number | null
  tier_90: number | null
  sales_synced_at: string | null
}

// Pooja's screen, and Pooja reads English. The weaver-facing screens take their
// language from her profile; this one has no reason to.
const t = getDictionary('en')

/**
 * One saree in the grid.
 *
 * The photograph, the code, a stock badge, and — since Phase 4 — two quiet
 * sales badges beneath. This screen should feel like browsing the storefront,
 * and a wall of body text is what turns a grid back into a list. Title, price
 * and stock live behind the info button, one tap away, for when she cannot tell
 * two pinks apart.
 *
 * The whole tile is the target, not a checkbox in the corner: she is tapping
 * with a thumb, at speed, and "tap the picture" is the only interaction that
 * needs no explanation.
 *
 * The crop is per product now rather than a fixed 25% off the top, because the
 * admin can draw one — see `resolveProductImage`. A plain <img> rather than
 * next/image because a pasted `manual_image_url` can be on any host and
 * next/image refuses anything outside `remotePatterns`; the CDN is already
 * being asked for the exact width, so the optimiser was only ever a second hop.
 */
export function DesignTile({
  design,
  vendorCode,
  window,
  eager = false,
}: {
  design: Design
  vendorCode: string
  window: Window
  /** Above the fold: fetch immediately and at high priority. See page.tsx. */
  eager?: boolean
}) {
  const { has, toggle } = useSelection()
  const [info, setInfo] = useState(false)
  const selected = has(design.sku)

  const image = resolveProductImage({
    imageUrls: design.image_urls,
    displayImagePosition: design.display_image_position,
    manualImageUrl: design.manual_image_url,
    cropJson: design.crop_json,
    cropMode: design.crop_mode,
    imageUrl: design.image_url,
  })

  const src = sizedImage(image.url, 400)

  const units = (design[unitsColumn(window)] as number | null) ?? 0
  const tier = (design[tierColumn(window)] as number | null) as Tier | null
  // No sales sync has ever run: show nothing rather than a confident zero,
  // which would read as "this has never sold" instead of "we do not know yet".
  const salesTier = design.sales_synced_at ? tier : null

  const item: Selected = {
    sku: design.sku,
    vendorCode,
    title: design.title,
    // The snapshot on the order line is what the weaver will see for months, so
    // it is the RESOLVED image — the one with the admin's crop and choice — not
    // the raw Shopify column.
    imageUrl: image.url,
    reason:
      design.qty_available === 0 ? 'sold_out' : design.qty_available === 1 ? 'last_piece' : null,
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => toggle(item)}
        aria-pressed={selected}
        className={`block w-full text-left ${selected ? 'rounded-xl ring-2 ring-stone-900' : ''}`}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-stone-100">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- see header
            <img
              src={src}
              alt={design.title ?? design.sku}
              className="absolute max-w-none object-cover"
              style={cropStyle(image.crop)}
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager ? 'high' : 'auto'}
              // Decode off the main thread. With up to 120 tiles scrolling past,
              // synchronous decodes are what makes a fast connection still feel
              // like a stuttering grid on a mid-range phone.
              decoding="async"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-xs text-stone-400">
              No photo
            </span>
          )}

          {selected && (
            <span
              className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white"
              aria-hidden
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M7.6 13.4 4.2 10l-1.2 1.2 4.6 4.6 9.4-9.4-1.2-1.2z" />
              </svg>
            </span>
          )}

          <span
            className={`absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              design.qty_available === 0 ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950'
            }`}
          >
            {design.qty_available === 0 ? 'Sold out' : 'Last piece'}
          </span>
        </div>

        <p className="mt-1.5 font-mono text-[13px] leading-tight break-words text-stone-700">
          {design.sku}
        </p>

        <SalesBadges units={units} tier={salesTier} window={window} t={t} />
      </button>

      {/* Deliberately outside the selecting button: reading about a saree and
          ordering one must not be the same gesture. */}
      <button
        type="button"
        onClick={() => setInfo(true)}
        aria-label={`About ${design.sku}`}
        className="absolute top-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-stone-700 backdrop-blur hover:bg-white"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 12H9V9h2v5zm0-6H9V6h2v2z" />
        </svg>
      </button>

      {info && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-0 sm:items-center sm:p-4"
          onClick={() => setInfo(false)}
          role="presentation"
        >
          <div
            className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[17px] break-words text-stone-900">{design.sku}</p>
            {design.title && <p className="mt-1 text-base">{design.title}</p>}
            {design.price != null && (
              <p className="mt-1 text-sm text-stone-500 tabular-nums">
                ₹{Number(design.price).toLocaleString('en-IN')}
              </p>
            )}
            <div className="mt-2">
              <StockLine qty={design.qty_available} syncedAt={design.stock_synced_at} t={t} />
            </div>
            <div className="mt-1">
              <SalesBadges units={units} tier={salesTier} window={window} t={t} />
            </div>
            <button
              type="button"
              onClick={() => setInfo(false)}
              className="mt-5 min-h-11 w-full rounded-lg border border-stone-300 text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
