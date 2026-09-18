import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * The Nerige Story mark.
 *
 * One component, because the logo now stands in for the word "Nerige" in seven
 * places and a raster wordmark sized by hand in seven places is seven chances
 * to get the aspect ratio wrong and shift the layout while it loads.
 *
 * The asset is the storefront's own header logo, pulled from
 * https://nerigestory.com/cdn/shop/files/NS_black_logo_1.png (945×630,
 * transparent PNG, 3:2) and resampled to 504×336 — three times the largest size
 * anything here renders it at. It is raster, not vector: Shopify publishes no
 * SVG of it. See docs/BRAND.md.
 *
 * Sizes are fixed rather than fluid, and both dimensions are always passed, so
 * the box is reserved before the image arrives. Nothing on these screens moves
 * under a person's thumb while a logo decodes.
 *
 *   wordmark  168×112  the sign-in, sign-up and auth screens, where the mark is
 *                      the page's whole identity and has room to be read
 *   compact    72×48   every application header. Measured floor: below roughly
 *                      72×48 the two-line script stops resolving into words.
 *                      At 72×48 the header grows by 4px against the 44px touch
 *                      targets already in it, which is the whole price of it.
 *   mark       28×28   the coral sprig alone, for anywhere even 72px is too
 *                      much. It is not a wordmark and never the only naming.
 *
 * `tone="inverse"` swaps to a white-script version of the same artwork, for the
 * one dark bar in the application (the developer header). The storefront ships
 * no light variant, so that file is derived — see docs/BRAND.md.
 */
const SOURCES = {
  light: '/brand/nerige-story-wordmark.png',
  inverse: '/brand/nerige-story-wordmark-inverse.png',
} as const

const MARK = '/brand/nerige-story-mark.png'

const SIZES = {
  wordmark: { width: 168, height: 112 },
  compact: { width: 72, height: 48 },
  mark: { width: 28, height: 28 },
} as const

export type LogoVariant = keyof typeof SIZES

export function Logo({
  variant = 'wordmark',
  tone = 'light',
  /**
   * `true` where a visible text label already names the brand beside the mark,
   * so a screen reader is not told "Nerige Story Nerige Story". Everywhere the
   * logo is the only naming — which is all of the headers — it stays `false`
   * and carries alt="Nerige Story".
   */
  decorative = false,
  priority = false,
  className,
}: {
  variant?: LogoVariant
  tone?: 'light' | 'inverse'
  decorative?: boolean
  priority?: boolean
  className?: string
}) {
  const { width, height } = SIZES[variant]
  const src = variant === 'mark' ? MARK : SOURCES[tone]

  return (
    <Image
      src={src}
      alt={decorative ? '' : 'Nerige Story'}
      aria-hidden={decorative || undefined}
      width={width}
      height={height}
      priority={priority}
      /* shrink-0: the weaver's header is a flex row on a 380px phone, and the
         mark is the one thing in it that must not be squeezed. */
      className={cn('block shrink-0', className)}
    />
  )
}
