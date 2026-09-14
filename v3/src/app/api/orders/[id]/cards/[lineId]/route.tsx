import { ImageResponse } from 'next/og'
import { type NextRequest } from 'next/server'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { cropForMode } from '@/lib/products/image'
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  CAPTION_HEIGHT,
  IMAGE_HEIGHT,
  cardImageUrl,
  cropGeometry,
  skuTail,
  type CropRect,
} from '@/lib/po/share-card'

/**
 * One order line, as a photograph a weaver can be sent.
 *
 * Rendered on demand rather than stored, for the same reason the PO is: the
 * card is a rendering of the line, not a second copy of it. Nothing to keep in
 * step, nothing to invalidate when a crop is corrected.
 *
 * THE IMAGE IS THE SNAPSHOT, THE CROP IS LIVE. `snapshot_image_url` was frozen
 * when the order was issued and stays frozen — which saree was asked for is a
 * fact about the order and must not drift. The crop is not that: it is a
 * display preference, and if someone improves it on the product the card should
 * improve too. So the photograph comes from the order and the rectangle from
 * `products`, joined on SKU.
 */
export const dynamic = 'force-dynamic'

function isValidCrop(c: unknown): c is CropRect {
  if (!c || typeof c !== 'object') return false
  const r = c as Record<string, unknown>
  const nums = [r.x, r.y, r.w, r.h]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  const { x, y, w, h } = c as unknown as CropRect
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.0001 && y + h <= 1.0001
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; lineId: string }> },
) {
  await requireProcurement()

  const { id, lineId } = await ctx.params
  const supabase = await createClient()

  const { data: line } = await supabase
    .from('order_lines')
    .select(
      `id, order_id, line_type, sku, brief, quantity, snapshot_image_url,
       order_line_refs ( snapshot_image_url )`,
    )
    .eq('id', lineId)
    .eq('order_id', id)
    .maybeSingle()

  if (!line) return new Response('Not found', { status: 404 })

  const isNewDesign = line.line_type !== 'restock'

  // A new-design line has no saree of its own; it points at the ones that
  // inspired it, and the first reference is what the weaver is shown.
  type Ref = { snapshot_image_url: string | null }
  const refs = (line.order_line_refs ?? []) as Ref[]
  const sourceUrl = line.snapshot_image_url ?? refs[0]?.snapshot_image_url ?? null

  // The crop belongs to the product, not the order. Absent — a new design, or a
  // SKU since removed — the named default applies, which is what every card in
  // the app already falls back to.
  let crop: CropRect = cropForMode('top')
  let liveImageUrl: string | null = null

  if (line.sku) {
    const { data: product } = await supabase
      .from('products')
      .select('crop_json, crop_mode, display_image_url')
      .eq('sku', line.sku)
      .maybeSingle()

    if (product) {
      crop = isValidCrop(product.crop_json) ? product.crop_json : cropForMode(product.crop_mode)
      liveImageUrl = product.display_image_url
    }
  }

  /**
   * An ABSENT snapshot is not a deliberate blank.
   *
   * Freezing the photograph at issue time is the rule, and it stands: a re-shoot
   * must not change the saree on an order a weaver has already accepted. But
   * orders issued before snapshots were populated carry no photograph at all —
   * every line of ORD-000001 is like this — and honouring the freeze there means
   * sending a weaver a card that says "No photograph", which is worse than
   * sending her this month's picture of the right saree.
   *
   * So the snapshot wins whenever there IS one, and the live product image is
   * the fallback rather than the default. A card with the wrong crop can be
   * fixed; a card with no saree on it cannot be sent at all.
   */
  const imageUrl = cardImageUrl(sourceUrl ?? liveImageUrl)
  const geo = cropGeometry(crop)
  const tail = skuTail(line.sku)

  // What the weaver reads first. For a restock it is her own code; for a new
  // design there is no code yet, so the brief carries the meaning instead.
  const headline = isNewDesign ? 'NEW DESIGN' : tail
  const subtitle = isNewDesign ? (line.brief ?? '').slice(0, 90) : null

  return new ImageResponse(
    (
      <div
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1c1917',
        }}
      >
        <div
          style={{
            width: CARD_WIDTH,
            height: IMAGE_HEIGHT,
            display: 'flex',
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#292524',
          }}
        >
          {imageUrl ? (
            /* This JSX is rendered to a PNG by satori, not to a DOM. `next/image`
               does not exist in that renderer, and `alt` has nowhere to go in a
               flat image — both rules are about a browser that is not involved. */
            /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */
            <img
              src={imageUrl}
              width={geo.width}
              height={geo.height}
              style={{
                position: 'absolute',
                left: geo.left,
                top: geo.top,
                objectFit: 'cover',
              }}
            />
          ) : (
            // A card with no photograph still carries the code and the count,
            // which is the part that cannot be guessed from the conversation.
            <div
              style={{
                display: 'flex',
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#78716c',
                fontSize: 40,
              }}
            >
              No photograph
            </div>
          )}
        </div>

        <div
          style={{
            width: CARD_WIDTH,
            height: CAPTION_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 56px',
            backgroundColor: '#1c1917',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: subtitle ? 76 : 132,
                fontWeight: 700,
                color: '#fafaf9',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {headline}
            </div>
            {subtitle ? (
              <div style={{ fontSize: 34, color: '#a8a29e', marginTop: 16, display: 'flex' }}>
                {subtitle}
              </div>
            ) : null}
          </div>

          {/* The quantity is the instruction. It is set apart and boxed so that
              it cannot be read as part of the code beside it. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 220,
              height: 180,
              borderRadius: 24,
              backgroundColor: '#fafaf9',
              padding: '0 32px',
            }}
          >
            <div style={{ fontSize: 108, fontWeight: 700, color: '#1c1917', lineHeight: 1 }}>
              {line.quantity}
            </div>
            <div
              style={{
                fontSize: 28,
                color: '#57534e',
                marginTop: 8,
                letterSpacing: '0.08em',
                display: 'flex',
              }}
            >
              {line.quantity === 1 ? 'PIECE' : 'PIECES'}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
