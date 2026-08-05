'use server'

import { revalidatePath } from 'next/cache'
import { requireVendor, getUserDictionary } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export interface OrderActionState {
  status: 'idle' | 'error'
  message?: string
}

/**
 * The two things a vendor can write, and nothing else.
 *
 * Neither of these decides whether she is allowed to. `orders_update_own`
 * proves the order is hers and `app.orders_vendor_write_guard()` pins every
 * column she may not touch and refuses any status move other than issued to
 * accepted to dispatched. If both of these functions were deleted the
 * guarantee would still hold; they exist to give her a sentence back instead of
 * a database error.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function acceptOrder(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const t = (await getUserDictionary()).order
  await requireVendor()

  const orderId = String(formData.get('orderId') ?? '')
  const promisedDate = String(formData.get('promisedDate') ?? '')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(promisedDate) || promisedDate < today()) {
    return { status: 'error', message: t.dateInPast }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'accepted', promised_date: promisedDate })
    .eq('id', orderId)
    .select('id')

  if (error || !data || data.length === 0) {
    return { status: 'error', message: t.couldNotSave }
  }

  revalidatePath(`/portal/orders/${orderId}`)
  return { status: 'idle' }
}

export async function recordDispatch(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const t = (await getUserDictionary()).order
  await requireVendor()

  const orderId = String(formData.get('orderId') ?? '')
  const sentOn = String(formData.get('sentOn') ?? '')
  const docket = String(formData.get('docket') ?? '').trim()

  // A dispatch is a record of something that has happened, so a future date is
  // a typo rather than a plan.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn) || sentOn > today()) {
    return { status: 'error', message: t.dateInPast }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .update({
      status: 'dispatched',
      dispatched_at: new Date(`${sentOn}T00:00:00Z`).toISOString(),
      transport_docket: docket || null,
    })
    .eq('id', orderId)
    .select('id')

  if (error || !data || data.length === 0) {
    return { status: 'error', message: t.couldNotSave }
  }

  revalidatePath(`/portal/orders/${orderId}`)
  return { status: 'idle' }
}
