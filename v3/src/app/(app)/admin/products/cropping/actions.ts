'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'
import { parseCropRect } from '@/lib/products/image'

/**
 * Saving one crop, from the queue.
 *
 * Deliberately narrower than `saveProductImage`: it writes `crop_json` and
 * nothing else. The queue exists to answer one question about hundreds of
 * sarees — how should this photograph be framed for the weaver — and an action
 * that also carried the image position and the manual URL would let a fast
 * sequence of saves quietly clear a field the form was not showing.
 *
 * `requireAdmin()`, like the full editor: a product photograph is something a
 * customer can already see, and every correction to those is the owner's alone.
 */
export interface CropResult {
  sku: string
  status: 'saved' | 'error'
  message?: string
}

export async function saveCrop(sku: string, cropJson: string): Promise<CropResult> {
  await requireAdmin()

  const trimmed = sku.trim()
  if (!trimmed) return { sku, status: 'error', message: 'No product given.' }

  // An empty string is "use the default framing again", which is how a crop
  // drawn badly a minute ago is undone without leaving the queue.
  const crop = cropJson.trim() ? parseCropRect(cropJson) : null
  if (cropJson.trim() && !crop) {
    return { sku: trimmed, status: 'error', message: 'That rectangle is not usable. Draw it again.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('products').update({ crop_json: crop }).eq('sku', trimmed)
  if (error) return { sku: trimmed, status: 'error', message: `Could not save: ${error.message}` }

  // Every screen that shows this photograph: the weaver's catalogue and order,
  // the reorder grid, the product list. The WhatsApp card reads the crop at
  // render time and needs no invalidation.
  revalidatePath('/portal', 'layout')
  revalidatePath('/reorder', 'layout')
  revalidatePath('/orders', 'layout')
  revalidatePath('/admin/products')

  return { sku: trimmed, status: 'saved' }
}
