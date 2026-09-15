'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireIntakeSubmit } from '@/lib/auth/session'

export interface SaveIntakeState {
  status: 'idle' | 'created' | 'repeat' | 'draft_saved' | 'promoted' | 'error'
  message?: string
  uniqueCode?: number
  sku?: string | null
  /** The key the result belongs to, so a reset form can tell an old result from a new one. */
  intakeKey?: string
}

const COST_PATTERN = /^\d{1,9}(\.\d{1,2})?$/

/**
 * Submits a new saree, or saves / completes a draft.
 *
 * Everything that matters happens in `save_intake` (migration 035): the
 * vocabulary check before a code is allocated, the Unique Code, the SKU and
 * SKU_CREATED in one statement, and the repeat-key answer that makes a double
 * tap on a slow warehouse connection create exactly one saree. This action
 * checks the form's shape and turns the database's sentence into the screen's.
 *
 * The MRP is not taken from the form. The screen shows a preview; the database
 * prices the saree from its own settings, so a stale page cannot set a price.
 */
export async function saveIntake(_prev: SaveIntakeState, formData: FormData): Promise<SaveIntakeState> {
  await requireIntakeSubmit()

  const text = (name: string) => String(formData.get(name) ?? '').trim()
  const intakeKey = text('intake_key')
  const asDraft = formData.get('as_draft') === 'on'
  const cost = text('cost_price')

  if (!intakeKey) return { status: 'error', message: 'This form has no submission key. Reload the page.' }
  if (!text('vendor_id')) return { status: 'error', message: 'Choose the weaver.', intakeKey }
  if (!COST_PATTERN.test(cost) || Number(cost) <= 0) {
    return { status: 'error', message: 'Enter the cost price in rupees, e.g. 1200 or 1200.50.', intakeKey }
  }

  if (!asDraft) {
    const missing = (['collection_code', 'fabric_code', 'colour_code', 'product_type_code'] as const).filter((f) => !text(f))
    if (missing.length > 0) {
      return {
        status: 'error',
        message: 'Collection, fabric, colour and product type are all needed. If one is not in the list, tick "Something is not in the list" and save a draft.',
        intakeKey,
      }
    }
  } else if (!text('draft_note')) {
    return { status: 'error', message: 'Say what is missing, so the owner can add it.', intakeKey }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('save_intake', {
    p_intake_key: intakeKey,
    p_vendor_id: text('vendor_id'),
    p_collection_code: text('collection_code'),
    p_fabric_code: text('fabric_code'),
    p_colour_code: text('colour_code'),
    p_product_type_code: text('product_type_code'),
    p_pattern_code: text('pattern_code') || null,
    p_border_code: text('border_code') || null,
    p_pallu_code: text('pallu_code') || null,
    p_cost_price: cost,
    p_as_draft: asDraft,
    p_draft_note: asDraft ? text('draft_note') : null,
  })

  if (error) return { status: 'error', message: error.message, intakeKey }

  const result = data as { unique_code: number; sku: string | null; status: string; outcome: SaveIntakeState['status'] }

  revalidatePath('/intake/queue')
  revalidatePath('/warehouse/shooting')
  revalidatePath('/admin/master-data')
  revalidatePath(`/intake/${result.unique_code}`)

  const messages: Record<string, string> = {
    created: 'Saved. Write the code on the fabric.',
    promoted: 'Draft completed. Write the code on the fabric.',
    repeat: 'This saree was already saved — here is its code. Nothing new was created.',
    draft_saved: 'Draft saved. It gets a SKU once the missing value is added and you complete it.',
  }

  return {
    status: result.outcome,
    message: messages[result.outcome] ?? 'Saved.',
    uniqueCode: Number(result.unique_code),
    sku: result.sku,
    intakeKey,
  }
}
