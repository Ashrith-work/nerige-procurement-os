'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/demo'
import { demoWriteRefusal } from '@/lib/demo/procurement'
import { requireRole } from '@/lib/auth/session'

/**
 * The vendor's four moves.
 *
 * Every one of them is a status change the database validates in
 * `app.po_guard_transition()`, and every column a vendor must not touch is
 * pinned back by `app.po_pin_vendor_columns()`. These actions therefore do not
 * defend anything — they exist to make the move from a phone and to report the
 * refusal in words rather than as a stack trace.
 */

async function move(
  poId: string,
  patch: Record<string, unknown>,
): Promise<never> {
  const destinationIfDemo = `/portal/orders/${poId}`
  if (isDemoMode()) {
    redirect(`${destinationIfDemo}?error=${encodeURIComponent(demoWriteRefusal())}`)
  }

  const supabase = await createClient()
  const { error } = await supabase.from('purchase_orders').update(patch).eq('id', poId)

  const destination = `/portal/orders/${poId}`
  revalidatePath(destination)
  revalidatePath('/portal')

  redirect(
    error
      ? `${destination}?error=${encodeURIComponent(error.message.replace(/^ERROR:\s*/i, '').split('\n')[0])}`
      : destination,
  )
}

/**
 * Accepting the order, with the date the vendor can actually make.
 *
 * The promised date is captured separately from the date we asked for, because
 * they are frequently different and pretending otherwise is what makes every
 * order look late. "Agreed a later date" and "missed the agreed date" are
 * different conversations, and only one of them is a problem.
 */
export async function acceptOrder(formData: FormData): Promise<void> {
  await requireRole('vendor')

  const poId = String(formData.get('purchase_order_id'))
  const promised = String(formData.get('promised_date') ?? '').trim()

  await move(poId, {
    status: 'acknowledged',
    promised_date: promised || null,
  })
}

export async function startProduction(formData: FormData): Promise<void> {
  await requireRole('vendor')
  await move(String(formData.get('purchase_order_id')), { status: 'in_production' })
}

/**
 * Recording dispatch.
 *
 * The transporter and docket are what the warehouse quotes when a parcel goes
 * missing, so they are captured at the moment the vendor hands the consignment
 * over — not reconstructed from a chat message a week later.
 */
export async function markDispatched(formData: FormData): Promise<void> {
  await requireRole('vendor')

  const poId = String(formData.get('purchase_order_id'))
  const transporter = String(formData.get('transporter') ?? '').trim()
  const docket = String(formData.get('docket_number') ?? '').trim()
  const parcels = Number(formData.get('parcel_count'))

  if (!transporter) {
    redirect(
      `/portal/orders/${poId}?error=${encodeURIComponent('Enter who is carrying it — the warehouse needs this to trace the parcel.')}`,
    )
  }

  await move(poId, {
    status: 'dispatched',
    transporter,
    docket_number: docket || null,
    parcel_count: Number.isFinite(parcels) && parcels > 0 ? parcels : null,
  })
}
