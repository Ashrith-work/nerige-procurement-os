'use server'

import { revalidatePath } from 'next/cache'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export interface CancelState {
  status: 'idle' | 'error'
  message?: string
}

/**
 * The only write Pooja has on an order she has already sent.
 *
 * This does not decide whether it is allowed. `app.orders_internal_write_guard()`
 * refuses every status move except issued or accepted to cancelled, and refuses
 * any edit to the date the weaver promised or the docket she recorded. This
 * function exists to turn the refusal into a sentence.
 */
export async function cancelOrder(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  await requireProcurement()

  const orderId = String(formData.get('orderId') ?? '')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', orderId)
    .select('id')

  if (error) {
    return { status: 'error', message: error.message }
  }
  if (!data || data.length === 0) {
    return { status: 'error', message: 'That order could not be cancelled.' }
  }

  revalidatePath('/orders')
  revalidatePath(`/orders/${orderId}`)
  return { status: 'idle' }
}
