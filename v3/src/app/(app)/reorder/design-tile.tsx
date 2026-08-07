'use client'

import { useState } from 'react'
import Image from 'next/image'
import { shopifyImage } from '@/lib/orders/view'
import { useSelection, type Selected } from '@/lib/reorder/selection'
import { StockLine } from '@/components/stock-line'
import { getDictionary } from '@/lib/i18n'

export interface Design {
  sku: string
  title: string | null
  image_url: string | null
  price: string | number | null
  qty_available: number
  stock_synced_at: string | null
}

const t = getDictionary('en')

/**
 * One saree in the grid.
 *
 * The photograph, the code, a badge. This screen should feel like browsing the
 * storefront, and a wall of body text is what turns a grid back into a list.
 * Title, price and stock live behind the info button, one tap away, for when
 * she cannot tell two pinks apart.
 *
 * The top quarter of every frame is cropped away, matching the cards: the
 * catalogue is shot on a model and the saree is in the lower three quarters.
 *
 * The whole tile is the target, not a checkbox in the corner: she is tapping
 * with a thumb, at speed, and "tap the picture" is the only interaction that
 * needs no explanation.
 */
export function DesignTile({ design, vendorCode }: { design: Design; vendorCode: string }) {
  const { has, toggle } = useSelection()
  const [info, setInfo] = useState(false)
  const selected = has(design.sku)
  const src = shopifyImage(design.image_url, 400)

  const item: Selected = {
    sku: design.sku,
    vendorCode,
    title: design.title,
    imageUrl: design.image_url,
    reason: design.qty_available === 0 ? 'sold_out' : design.qty_available === 1 ? 'last_piece' : null,
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
            // Same crop as DesignCard: the inner box is 4/3 the height and
            // pulled up by 1/3, so only the bottom three quarters is visible.
            // unoptimized because shopifyImage() already asked Shopify's CDN
            // for this exact width — Vercel's optimiser would be a second hop
            // for a file that is already the right size.
            <div className="absolute inset-x-0" style={{ top: '-33.3333%', height: '133.3333%' }}>
              <Image
                src={src}
                alt={design.title ?? design.sku}
                fill
                sizes="(max-width: 640px) 50vw, 20vw"
                className="object-cover"
                unoptimized
              />
            </div>
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
