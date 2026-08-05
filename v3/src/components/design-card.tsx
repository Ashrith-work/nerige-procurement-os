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
 */

export interface PhotoProps {
  url: string | null
  alt: string
  className?: string
}

export type PhotoComponent = (props: PhotoProps) => ReactNode

/**
 * next/image, with the Shopify CDN in remotePatterns.
 *
 * Swappable only because next/image reads its configuration from a constant
 * Next inlines at build time and therefore cannot render outside a Next build.
 * The preview script passes a plain <img>; the application never passes
 * anything.
 */
export function NextPhoto({ url, alt, className }: PhotoProps): ReactNode {
  const src = shopifyImage(url, 800)
  if (!src) return <NoPhoto className={className} />

  return (
    <div className={`relative overflow-hidden rounded-xl bg-stone-100 ${className ?? ''}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 100vw, 640px"
        className="object-cover"
      />
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
  description,
  imageUrl,
  footer,
  Photo = NextPhoto,
}: {
  sku: string
  title: string | null
  description: string | null
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

      {description && <p className="text-sm leading-normal text-stone-600">{description}</p>}

      {footer}
    </article>
  )
}
