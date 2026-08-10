'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import type { CropRect } from '@/lib/products/image'

export interface ImageState {
  status: 'idle' | 'saved' | 'error'
  message?: string
}

/**
 * Everything an admin can do to a product's photograph.
 *
 * Three ways in, one row out: pick a different Shopify image, draw a crop, or
 * paste a URL from somewhere else entirely. All three write columns the sync is
 * forbidden from touching, which is what makes the edit survive the next
 * half-hourly run — see the ON CONFLICT clause in migration 015.
 *
 * Note what is NOT written: nothing here touches `image_urls`. That is
 * Shopify's list and the sync owns it. Overwriting it would mean the next sync
 * silently restored it and the editor would appear to forget.
 */

function parseCrop(raw: string): CropRect | null {
  if (!raw) return null

  try {
    const value = JSON.parse(raw) as Partial<CropRect>
    const { x, y, w, h } = value

    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    if (x! < 0 || y! < 0 || w! <= 0 || h! <= 0) return null
    if (x! + w! > 1.0001 || y! + h! > 1.0001) return null

    // Rounded to four places. A crop is a human dragging a box, not a
    // measurement, and sixteen decimal places of mouse jitter in the database
    // makes two identical-looking crops compare as different.
    const round = (n: number) => Math.round(n * 10000) / 10000
    return { x: round(x!), y: round(y!), w: round(w!), h: round(h!) }
  } catch {
    return null
  }
}

/** A pasted URL has to be one a browser will actually load. */
function parseUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    // http: is refused rather than upgraded. The portal is served over https
    // and a mixed-content image is blocked by the browser — it would save
    // cleanly here and then render as a blank card on a weaver's phone.
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export async function saveProductImage(
  _prev: ImageState,
  formData: FormData,
): Promise<ImageState> {
  await requireProcurement()

  const sku = String(formData.get('sku') ?? '').trim()
  if (!sku) return { status: 'error', message: 'No product given.' }

  const positionRaw = String(formData.get('display_image_position') ?? '').trim()
  const manualRaw = String(formData.get('manual_image_url') ?? '').trim()
  const cropRaw = String(formData.get('crop_json') ?? '').trim()
  const cropMode = String(formData.get('crop_mode') ?? 'top').trim()

  if (!['top', 'centre', 'none'].includes(cropMode)) {
    return { status: 'error', message: 'Unknown crop mode.' }
  }

  const update: Record<string, unknown> = { crop_mode: cropMode }

  if (positionRaw) {
    const position = Number(positionRaw)
    if (!Number.isInteger(position) || position < 1) {
      return { status: 'error', message: 'Pick an image position of 1 or more.' }
    }
    update.display_image_position = position
  }

  // An empty field clears the override rather than being ignored, so "go back
  // to the Shopify image" is expressible without a separate button.
  if (manualRaw) {
    const url = parseUrl(manualRaw)
    if (!url) {
      return {
        status: 'error',
        message: 'That is not a usable image address. It must start with https://',
      }
    }
    update.manual_image_url = url
  } else {
    update.manual_image_url = null
  }

  update.crop_json = cropRaw ? parseCrop(cropRaw) : null
  if (cropRaw && update.crop_json === null) {
    return { status: 'error', message: 'That crop rectangle is not usable. Draw it again.' }
  }

  const supabase = await createClient()

  // `display_image_url` is denormalised for the grid, so it has to be
  // recomputed here too — otherwise a position change looks correct on this
  // screen and stays stale on every card until the next sync.
  const { data: product } = await supabase
    .from('products')
    .select('image_urls')
    .eq('sku', sku)
    .maybeSingle()

  const urls = ((product?.image_urls as string[] | null) ?? []).filter(Boolean)
  if (urls.length > 0) {
    const position = (update.display_image_position as number | undefined) ?? 3
    update.display_image_url = urls[Math.min(Math.max(position, 1), urls.length) - 1]
  }

  const { error } = await supabase.from('products').update(update).eq('sku', sku)
  if (error) return { status: 'error', message: `Could not save: ${error.message}` }

  revalidatePath('/admin/products')
  revalidatePath('/reorder', 'layout')
  revalidatePath('/portal', 'layout')

  return { status: 'saved' }
}
