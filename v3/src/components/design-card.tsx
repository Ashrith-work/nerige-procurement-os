import type { ReactNode } from 'react'
import Image from 'next/image'
import { shopifyImage } from '@/lib/orders/view'

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
 * There is no description. The Shopify copy is written to sell a saree to a
 * customer — "a stunning pista green semi Bangalore silk with a peacock gold
 * zari border" — and neither a weaver about to make it again nor Pooja choosing
 * what to reorder is reading three lines of that. It pushed the code and the
 * quantity down the card, and on a phone that is the whole screen.
 */

/**
 * How much of the top of every photograph to cut away.
 *
 * The catalogue is shot on a model, so the top quarter of the frame is face and
 * background — the saree itself is below it. Cropping is done here, in CSS,
 * rather than by asking the CDN for a cropped file, so it costs nothing and can
 * be changed in one number without re-fetching nine thousand images.
 */
const CROP_TOP = 0.25

/** Inner box scale and offset that show only the bottom (1 - CROP_TOP) of a frame. */
const SCALE = `${(100 / (1 - CROP_TOP)).toFixed(4)}%`
const OFFSET = `-${((CROP_TOP / (1 - CROP_TOP)) * 100).toFixed(4)}%`

export interface PhotoProps {
  url: string | null
  alt: string
  className?: string
}

export type PhotoComponent = (props: PhotoProps) => ReactNode

/**
 * next/image pointed straight at the Shopify CDN.
 *
 * `unoptimized` is deliberate. shopifyImage() already asks Shopify for the
 * width we want, and Shopify serves it from its own CDN — routing it through
 * Vercel's optimiser adds a second network hop and a transform for an image
 * that is already the right size. With 9,827 designs the optimiser's cache is
 * cold almost every time, so that hop is paid on nearly every tile.
 *
 * Swappable only because next/image reads configuration Next inlines at build
 * time and therefore cannot render outside a Next build. The preview script
 * passes a plain <img>; the application never passes anything.
 */
export function NextPhoto({ url, alt, className }: PhotoProps): ReactNode {
  const src = shopifyImage(url, 800)
  if (!src) return <NoPhoto className={className} />

  return (
    <div className={`relative overflow-hidden rounded-xl bg-stone-100 ${className ?? ''}`}>
      <div className="absolute inset-x-0" style={{ top: OFFSET, height: SCALE }}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 640px) 100vw, 640px"
          className="object-cover"
          unoptimized
        />
      </div>
    </div>
  )
}

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
  footer,
  Photo = NextPhoto,
}: {
  sku: string
  title: string | null
  imageUrl: string | null
  /** What this card is for: a quantity on an order, a stock line in the catalogue. */
  footer?: ReactNode
  Photo?: PhotoComponent
}) {
  return (
    // break-inside-avoid so a printed catalogue never splits a code across two
    // sheets of paper.
    <article className="space-y-3 break-inside-avoid rounded-xl border border-stone-200 p-4">
      <Photo url={imageUrl} alt={title ?? sku} className="h-[300px] w-full" />

      <p className="font-mono text-[19px] leading-tight font-medium break-words text-stone-900">
        {sku}
      </p>

      {title && <p className="text-base text-stone-900">{title}</p>}

      {footer}
    </article>
  )
}
