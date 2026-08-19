'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'

export interface IdentifyState {
  status: 'idle' | 'saved' | 'error'
  message?: string
  /** Echoed back so the row that changed can say so, rather than the whole page. */
  sku?: string
}

/**
 * Names the weaver behind a product whose SKU does not.
 *
 * The write goes through `identify_product_vendor`, not a direct update, so the
 * "only out of the holding pen" rule lives in one place that cannot be
 * forgotten — see migration 026. Everything this action does is check the shape
 * of the form and translate the RPC's errors into something a person can act
 * on.
 *
 * `requireAdmin()` duplicates the RPC's own `app.is_admin()` check on purpose.
 * The database check is the one that actually protects the row; this one exists
 * so a warehouse manager who reaches the URL gets a redirect rather than a
 * stack trace.
 */
export async function identifyVendor(
  _prev: IdentifyState,
  formData: FormData,
): Promise<IdentifyState> {
  await requireAdmin()

  const sku = String(formData.get('sku') ?? '').trim()
  const vendorCode = String(formData.get('vendor_code') ?? '').trim().toUpperCase()

  if (!sku) return { status: 'error', message: 'No product given.' }
  if (!vendorCode) return { status: 'error', message: 'Choose a weaver first.', sku }

  const supabase = await createClient()
  const { error } = await supabase.rpc('identify_product_vendor', {
    p_sku: sku,
    p_vendor_code: vendorCode,
  })

  if (error) {
    return { status: 'error', message: error.message, sku }
  }

  // Both paths matter: the queue this row just left, and the catalogue and
  // reorder screens it just became reachable through.
  revalidatePath('/admin/products/unidentified')
  revalidatePath('/admin/products')
  revalidatePath('/reorder', 'layout')

  return { status: 'saved', message: `${sku} assigned to ${vendorCode}.`, sku }
}
