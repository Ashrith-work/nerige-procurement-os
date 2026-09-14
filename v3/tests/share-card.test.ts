/**
 * The weaver's card, in the parts that can be got wrong silently.
 *
 * A card renders whatever it is handed. If `skuTail` returns the wrong four
 * digits nothing throws, nothing logs, and a weaver makes the wrong saree — the
 * failure surfaces weeks later as a delivery nobody ordered. These are pure
 * functions precisely so that the part which cannot announce its own mistakes
 * can be pinned down here.
 *
 * No database: everything under test is arithmetic and string handling.
 */
import { describe, it, expect } from 'vitest'
import {
  skuTail,
  cardImageUrl,
  cropGeometry,
  cardFilename,
  CARD_WIDTH,
  IMAGE_HEIGHT,
  type ShareCard,
} from '../src/lib/po/share-card'

describe('skuTail — the code a weaver reads', () => {
  it('takes the last segment of a hyphenated SKU', () => {
    expect(skuTail('PGW-BRHM-SLK-CRM-5855')).toBe('5855')
  })

  it('takes trailing digits when there are no hyphens', () => {
    // The ~100 holding-pen SKUs. The number is written on the saree itself.
    expect(skuTail('VINTWB14700')).toBe('14700')
  })

  it('keeps a non-numeric tail rather than inventing one', () => {
    expect(skuTail('PGW-BRHM-SLK-CRM-A12B')).toBe('A12B')
  })

  it('falls back to the whole string when it can find no tail', () => {
    // Long is still usable. Empty is not.
    expect(skuTail('VINTWB')).toBe('VINTWB')
  })

  it('is empty for absent input rather than printing "null"', () => {
    expect(skuTail(null)).toBe('')
    expect(skuTail(undefined)).toBe('')
    expect(skuTail('   ')).toBe('')
  })

  it('ignores trailing hyphens instead of returning empty', () => {
    expect(skuTail('PGW-BRHM-5855-')).toBe('5855')
  })
})

describe('cardImageUrl — what the renderer is allowed to fetch', () => {
  it('pins JPEG on Shopify, because the renderer cannot decode WebP', () => {
    const out = cardImageUrl('https://cdn.shopify.com/s/files/1/x/saree.jpg')
    expect(out).toContain('format=jpg')
    expect(out).toContain(`width=${CARD_WIDTH}`)
  })

  it('leaves other hosts untouched', () => {
    // A pasted manual_image_url may be anywhere, and a host that validates its
    // query string turns an unexpected parameter into a 404.
    const url = 'https://images.example.com/photo.jpg'
    expect(cardImageUrl(url)).toBe(url)
  })

  it('returns null for absent or unparseable input', () => {
    expect(cardImageUrl(null)).toBeNull()
    expect(cardImageUrl('')).toBeNull()
    expect(cardImageUrl('not a url')).toBeNull()
  })
})

describe('cropGeometry — showing the saree and not the floor', () => {
  it('scales the source so the kept fraction fills the frame', () => {
    // Keeping 70% of the height means drawing the source 1/0.7 times taller.
    const g = cropGeometry({ x: 0, y: 0.18, w: 1, h: 0.7 })
    expect(g.width).toBe(CARD_WIDTH)
    expect(g.height).toBe(Math.round(IMAGE_HEIGHT / 0.7))
  })

  it('offsets by the part being cut away', () => {
    const g = cropGeometry({ x: 0, y: 0.18, w: 1, h: 0.7 })
    expect(g.top).toBe(Math.round(-(0.18 / 0.7) * IMAGE_HEIGHT))
    expect(g.left).toBe(0)
  })

  it('is identity for a full-frame crop', () => {
    const g = cropGeometry({ x: 0, y: 0, w: 1, h: 1 })
    expect(g).toEqual({ width: CARD_WIDTH, height: IMAGE_HEIGHT, left: 0, top: 0 })
  })

  it('survives a zero-width crop instead of dividing by zero', () => {
    // A blank card reads as a missing photograph; an Infinity reads as a crash.
    const g = cropGeometry({ x: 0, y: 0, w: 0, h: 0 })
    expect(Number.isFinite(g.width)).toBe(true)
    expect(Number.isFinite(g.height)).toBe(true)
  })

  it('handles a horizontal crop as well as a vertical one', () => {
    const g = cropGeometry({ x: 0.25, y: 0, w: 0.5, h: 1 })
    expect(g.width).toBe(CARD_WIDTH * 2)
    expect(g.left).toBe(Math.round(-(0.25 / 0.5) * CARD_WIDTH))
  })
})

describe('cardFilename — the name it lands under in a phone gallery', () => {
  const base: ShareCard = {
    sku: 'PGW-BRHM-SLK-CRM-5855',
    brief: null,
    quantity: 6,
    imageUrl: null,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    isNewDesign: false,
  }

  it('names a restock by its code and count', () => {
    expect(cardFilename(base)).toBe('5855-x6.png')
  })

  it('names a new design without pretending it has a code', () => {
    expect(cardFilename({ ...base, sku: null, isNewDesign: true, quantity: 2 })).toBe(
      'new-design-x2.png',
    )
  })

  it('still produces a usable name for a codeless restock', () => {
    expect(cardFilename({ ...base, sku: null, quantity: 1 })).toBe('saree-x1.png')
  })
})
