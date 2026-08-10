/**
 * Which photograph a weaver sees, and how it is cropped.
 *
 * One file, because three places need the same answer and they must not be able
 * to disagree: the sync (which denormalises it onto `display_image_url`), the
 * admin image editor (which previews it), and every card component.
 *
 * THE POSITION RULE. Shopify returns a median of eleven images per product.
 * Image 1 is, on essentially every product in this catalogue, the full-length
 * shot on a model — the saree occupies about a quarter of the frame and the
 * rest is face, background and floor. Image 3 is the fabric. So the default is
 * position 3, stored per product so it can be corrected where it is wrong.
 *
 * THE FALLBACK. About 169 products carry fewer than three images. Falling back
 * to the LAST available rather than the first is deliberate: image order on
 * these products runs from context to detail, so the last one is the closest
 * thing to a fabric shot they have. The first would be the model again.
 */

/** A crop rectangle in fractions of the source image, drawn by hand. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type CropMode = 'top' | 'centre' | 'none'

export interface ProductImageInput {
  imageUrls: string[] | null | undefined
  displayImagePosition: number | null | undefined
  manualImageUrl: string | null | undefined
  cropJson: CropRect | null | undefined
  cropMode: string | null | undefined
  /** The single-image column from the CSV era, still populated for seeded rows. */
  imageUrl?: string | null
}

export interface ResolvedImage {
  url: string | null
  crop: CropRect
  /** True when a human chose this, so the UI can say so. */
  isManual: boolean
}

export const DEFAULT_IMAGE_POSITION = 3

/**
 * How much of the frame each named mode keeps.
 *
 * `top` cuts the upper 18% and the lower 12%. The catalogue is shot on a model
 * against a plain ground: the top of the frame is head and background, the
 * bottom is floor, and the saree is the band between them. Cropping in CSS
 * rather than asking the CDN for a cropped file costs nothing and can be
 * changed without re-fetching nine thousand images.
 */
const MODE_CROPS: Record<CropMode, CropRect> = {
  top: { x: 0, y: 0.18, w: 1, h: 0.7 },
  centre: { x: 0, y: 0.15, w: 1, h: 0.7 },
  none: { x: 0, y: 0, w: 1, h: 1 },
}

export function cropForMode(mode: string | null | undefined): CropRect {
  return MODE_CROPS[(mode as CropMode) ?? 'top'] ?? MODE_CROPS.top
}

function isValidCrop(crop: unknown): crop is CropRect {
  if (!crop || typeof crop !== 'object') return false
  const c = crop as Record<string, unknown>
  const nums = [c.x, c.y, c.w, c.h]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  const { x, y, w, h } = c as unknown as CropRect
  // A zero-area or out-of-bounds rectangle renders as a blank card, which looks
  // like a missing photograph rather than like a bad crop.
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001
}

/**
 * The resolution order, stated once:
 *
 *   1. `manual_image_url` — a human looked at this product and chose.
 *   2. the image at `display_image_position`, 1-based.
 *   3. the last image available, when there are fewer than that many.
 *   4. `image_url`, the single-image column from the CSV loader.
 *
 * And for the crop: a hand-drawn `crop_json` beats the named `crop_mode`.
 */
export function resolveProductImage(input: ProductImageInput): ResolvedImage {
  const crop = isValidCrop(input.cropJson) ? input.cropJson : cropForMode(input.cropMode)

  const manual = (input.manualImageUrl ?? '').trim()
  if (manual) return { url: manual, crop, isManual: true }

  const urls = (input.imageUrls ?? []).filter(
    (u): u is string => typeof u === 'string' && u.trim() !== '',
  )

  if (urls.length > 0) {
    const position = input.displayImagePosition ?? DEFAULT_IMAGE_POSITION
    // Fewer images than the chosen position: take the last one. See the header.
    const index = Math.min(Math.max(position, 1), urls.length) - 1
    return { url: urls[index], crop, isManual: false }
  }

  const legacy = (input.imageUrl ?? '').trim()
  return { url: legacy || null, crop, isManual: false }
}

/**
 * The CSS that shows only the crop rectangle, inside a fixed-size box.
 *
 * Expressed as an absolutely positioned inner box scaled up and offset, rather
 * than as `object-position`, because `object-position` can only move the image
 * and not choose a window into it. This is what lets a hand-drawn rectangle of
 * any shape be honoured exactly.
 */
export function cropStyle(crop: CropRect): {
  width: string
  height: string
  left: string
  top: string
} {
  return {
    width: `${(100 / crop.w).toFixed(4)}%`,
    height: `${(100 / crop.h).toFixed(4)}%`,
    left: `${(-(crop.x / crop.w) * 100).toFixed(4)}%`,
    top: `${(-(crop.y / crop.h) * 100).toFixed(4)}%`,
  }
}

/**
 * Asks the Shopify CDN for a sensible size.
 *
 * 800 for a vendor card, 400 for a grid tile, 200 for a PDF thumbnail. Without
 * this a weaver on a mobile connection pulls a 3,000px original for every card
 * on the screen, which on a slow signal is the difference between a usable
 * portal and a blank one.
 *
 * Only applied to Shopify's own CDN. A pasted `manual_image_url` may be
 * anywhere, and appending `?width=` to a host that does not understand it can
 * turn a working URL into a 404.
 */
export function sizedImage(url: string | null, width: 200 | 400 | 800): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('shopify.com')) return url
    parsed.searchParams.set('width', String(width))
    return parsed.toString()
  } catch {
    return url
  }
}
