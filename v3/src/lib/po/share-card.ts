/**
 * The card a weaver receives on WhatsApp, reduced to the two facts she acts on.
 *
 * WHY THIS EXISTS. Ordering a saree today means: open Shopify, find the design,
 * pick an image, screenshot it, crop the screenshot, crop it again, copy it,
 * send it. Per design. It is the single largest consumer of Pooja's day, and
 * every step of it is already knowable from data this system holds — the
 * photograph, which part of it to show, the code, the quantity.
 *
 * WHAT GOES ON IT. The saree, its code, and how many. Nothing else.
 *
 * Deliberately NOT on it: price. A weaver is told what to make and how much of
 * it; what it costs is between Nerige and its books. This is a product decision,
 * not an oversight — see the plan.
 *
 * THE CODE IS THE TAIL, NOT THE SKU. A SKU reads
 * `VENDOR-COLLECTION-FABRIC-COLOUR-SEQ` — `PGW-BRHM-SLK-CRM-5855`. The weaver
 * wrote `5855` on the saree and on her own register; the four segments before it
 * are Nerige's filing system and mean nothing to her. Printing the whole string
 * makes her read twenty-two characters to find the four she uses, which on a
 * phone screen at arm's length in a workshop is how the wrong saree gets made.
 */

/** Portrait, because sarees are. Sized for WhatsApp without re-compression. */
export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350

/** The caption band across the foot of the card. */
export const CAPTION_HEIGHT = 300

export const IMAGE_HEIGHT = CARD_HEIGHT - CAPTION_HEIGHT

/**
 * The part of a SKU a weaver actually uses.
 *
 * Hyphenated SKUs give up their last segment. The ~100 hyphenless ones
 * (`VINTWB14700`) have no segments at all, so the trailing run of digits is
 * taken instead — for those the number IS the identifier, and it is what is
 * written on the saree.
 *
 * Returns the whole string when neither applies, because a card showing a code
 * that is merely long is still usable; a card showing nothing is not.
 */
export function skuTail(sku: string | null | undefined): string {
  const s = (sku ?? '').trim()
  if (!s) return ''

  if (s.includes('-')) {
    const last = s.split('-').filter(Boolean).pop() ?? ''
    if (last) return last
  }

  const trailingDigits = s.match(/(\d+)$/)
  if (trailingDigits) return trailingDigits[1]

  return s
}

/**
 * Asks the Shopify CDN for a JPEG at card width.
 *
 * Two things matter here and both are failure modes seen in the PDF generator.
 *
 * FORMAT. Shopify serves WebP by content negotiation. The renderer decodes JPEG
 * and PNG; handed a WebP it produces a card with a hole where the saree was. So
 * the format is pinned rather than negotiated.
 *
 * HOST. Only Shopify's CDN understands these parameters. A `manual_image_url`
 * may point anywhere, and appending query parameters to a host that ignores
 * them is harmless but to one that validates them turns a working URL into a
 * 404 — so other hosts are passed through untouched.
 */
export function cardImageUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim()
  if (!u) return null

  try {
    const parsed = new URL(u)
    if (!parsed.hostname.endsWith('shopify.com')) return u
    parsed.searchParams.set('width', String(CARD_WIDTH))
    parsed.searchParams.set('format', 'jpg')
    return parsed.toString()
  } catch {
    return null
  }
}

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Turns a crop rectangle into absolute pixel geometry for the image frame.
 *
 * The same idea as `cropStyle` in `lib/products/image`, but in pixels rather
 * than percentages: the renderer has no percentage-of-parent sizing, so the
 * scaled dimensions and the offsets are computed here.
 *
 * A crop keeps the fraction `w × h` of the source, so the source must be drawn
 * `1/w` times wider than the frame and shifted left by the part being cut.
 */
export function cropGeometry(
  crop: CropRect,
  frameWidth = CARD_WIDTH,
  frameHeight = IMAGE_HEIGHT,
): { width: number; height: number; left: number; top: number } {
  const safeW = crop.w > 0 ? crop.w : 1
  const safeH = crop.h > 0 ? crop.h : 1

  const width = Math.round(frameWidth / safeW)
  const height = Math.round(frameHeight / safeH)

  // `Math.round(-0)` is `-0`, and an uncropped card would carry `left: -0px`
  // into the markup. Harmless to render, but it reads as a bug to anyone
  // inspecting the output. `|| 0` collapses it because -0 is falsy.
  return {
    width,
    height,
    left: Math.round(-(crop.x / safeW) * frameWidth) || 0,
    top: Math.round(-(crop.y / safeH) * frameHeight) || 0,
  }
}

/** What one card needs to render. */
export interface ShareCard {
  sku: string | null
  /** Set for a new-design line, which has a brief instead of a code. */
  brief: string | null
  quantity: number
  imageUrl: string | null
  crop: CropRect
  isNewDesign: boolean
}

/**
 * The filename a card is saved under.
 *
 * Named for the code and the quantity, because the file lands in a phone's
 * gallery among a thousand others and the name is the only thing distinguishing
 * it there.
 */
export function cardFilename(card: ShareCard): string {
  const tail = skuTail(card.sku)
  const stem = tail || (card.isNewDesign ? 'new-design' : 'saree')
  return `${stem}-x${card.quantity}.png`
}
