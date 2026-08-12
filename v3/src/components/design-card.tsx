import type { ReactNode } from 'react'
import { cropStyle, sizedImage, cropForMode, type CropRect } from '@/lib/products/image'

/**
 * One design, as a card. The single card layout in this build.
 *
 * The order screen and the vendor catalogue render the same component, because
 * they are the same thing to the person reading them: a photograph and the code
 * that goes on the piece. Two card layouts would be two chances for the code to
 * be smaller on one of them.
 *
 * A card fills most of a phone screen on purpose. The photograph is 300px tall
 * and the code sits directly beneath it at 19px monospace — never truncated,
 * never in a table cell that could clip it, because it is copied onto a fabric
 * label by hand and has to be readable at arm's length.
 *
 * THREE THINGS AND NO MORE: the photograph, the saree name, the code. There is
 * no description. The Shopify copy is written to sell a saree to a customer —
 * "a stunning pista green semi Bangalore silk with a peacock gold zari border"
 * — and neither a weaver about to make it again nor Pooja choosing what to
 * reorder is reading three lines of that. It pushed the code and the quantity
 * down the card, and on a phone that is the whole screen. It is still in the
 * database and still visible on the admin product screen.
 */

export interface PhotoProps {
  url: string | null
  alt: string
  crop?: CropRect
  className?: string
}

export type PhotoComponent = (props: PhotoProps) => ReactNode

/**
 * The photograph, cropped to whatever the admin chose.
 *
 * A plain <img> rather than next/image. The crop is per product now and a
 * pasted `manual_image_url` can be on any host — next/image refuses anything
 * outside `remotePatterns`, so a manual override would render as a broken
 * image. `sizedImage()` already asks Shopify's own CDN for the exact width, so
 * routing through Vercel's optimiser was a second network hop for a file that
 * is already the right size; with 9,827 designs its cache is cold almost every
 * time, so that hop is paid on nearly every tile.
 *
 * Swappable because the preview script renders these components outside a Next
 * build, where next/image cannot run at all.
 */
export function Photo({ url, alt, crop, className }: PhotoProps): ReactNode {
  const src = sizedImage(url, 800)
  if (!src) return <NoPhoto className={className} />

  const rect = crop ?? cropForMode('top')

  return (
    <div className={`relative overflow-hidden rounded-xl bg-stone-100 ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={src}
        alt={alt}
        className="absolute max-w-none object-cover"
        style={cropStyle(rect)}
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}

/** Kept under the old name so the preview script and existing callers still work. */
export const NextPhoto = Photo

export function NoPhoto({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-stone-100 ${className ?? ''}`}
      aria-hidden
    >
      <span className="text-xs text-stone-400">No photo</span>
    </div>
  )
}

export function DesignCard({
  sku,
  title,
  imageUrl,
  crop,
  footer,
  badges,
  Photo: PhotoImpl = Photo,
}: {
  sku: string
  title: string | null
  imageUrl: string | null
  crop?: CropRect
  /** What this card is for: a quantity on an order, a stock line in the catalogue. */
  footer?: ReactNode
  /** The two quiet sales badges. Below everything, never beside the code. */
  badges?: ReactNode
  Photo?: PhotoComponent
}) {
  return (
    // break-inside-avoid so a printed catalogue never splits a code across two
    // sheets of paper.
    <article className="space-y-3 break-inside-avoid rounded-xl border border-stone-200 p-4">
      <PhotoImpl url={imageUrl} alt={title ?? sku} crop={crop} className="h-[300px] w-full" />

      <p className="font-mono text-[19px] leading-tight font-medium break-words text-stone-900">
        {sku}
      </p>

      {title && <p className="text-base text-stone-900">{title}</p>}

      {footer}

      {badges}
    </article>
  )
}
