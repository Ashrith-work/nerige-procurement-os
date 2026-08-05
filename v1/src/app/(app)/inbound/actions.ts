'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/demo'
import { demoWriteRefusal } from '@/lib/demo/procurement'
import { requireRole } from '@/lib/auth/session'

const RECEIVERS = ['founder', 'warehouse_manager', 'procurement_head'] as const

/**
 * Records a count against an order.
 *
 * Written as one action rather than a save-then-post pair because of where it
 * is used: someone is standing at a table with an open parcel and a phone. Two
 * round trips is one too many, and a half-saved count is worse than none.
 *
 * The sequence is create-draft → add lines → post, in that order, because
 * posting is what rolls the numbers onto the order and is irreversible. If
 * anything fails before the post, the draft survives and shows up in "counts in
 * progress" — recoverable, rather than silently lost.
 */
export async function recordReceipt(formData: FormData): Promise<void> {
  await requireRole(...RECEIVERS)

  const poId = String(formData.get('purchase_order_id'))
  const returnTo = `/inbound/${poId}`
  const post = formData.get('post') === '1'

  const fail = (msg: string) => redirect(`${returnTo}?error=${encodeURIComponent(msg)}`)
  if (isDemoMode()) fail(demoWriteRefusal())

  // Every line the form offered, whether or not a number was typed into it.
  const counts: { lineId: string; received: number; damaged: number }[] = []
  for (const [key, value] of formData.entries()) {
    const match = /^received_(.+)$/.exec(key)
    if (!match) continue

    const lineId = match[1]
    const received = Number(value)
    const damaged = Number(formData.get(`damaged_${lineId}`) ?? 0)

    if (!Number.isFinite(received) || received < 0) fail('Counts cannot be negative.')
    if (!Number.isFinite(damaged) || damaged < 0) fail('Damaged counts cannot be negative.')
    if (received === 0 && damaged === 0) continue

    counts.push({ lineId, received, damaged })
  }

  if (counts.length === 0) {
    fail('Nothing was counted. Enter how many pieces arrived on at least one line.')
  }

  const supabase = await createClient()

  const { data: receipt, error: receiptError } = await supabase
    .from('goods_receipts')
    .insert({
      purchase_order_id: poId,
      // vendor_id and the GRN number are both assigned by trigger from the
      // order, so neither can be got wrong here.
      vendor_id: String(formData.get('vendor_id')),
      received_on: String(formData.get('received_on') || new Date().toISOString().slice(0, 10)),
      parcel_count: Number(formData.get('parcel_count')) || null,
      docket_number: String(formData.get('docket_number') ?? '') || null,
      notes: String(formData.get('notes') ?? '') || null,
    })
    .select('id, grn_number')
    .single()

  if (receiptError) fail(receiptError.message)

  const { error: linesError } = await supabase.from('goods_receipt_lines').insert(
    counts.map((c) => ({
      goods_receipt_id: receipt!.id,
      purchase_order_line_id: c.lineId,
      // quantity_ordered and vendor_id are snapshotted by trigger from the order
      // line; passing them from the browser would make them forgeable.
      quantity_ordered: 0,
      quantity_received: c.received,
      quantity_damaged: c.damaged,
    })),
  )

  if (linesError) fail(`Count saved as a draft but the lines failed: ${linesError.message}`)

  if (post) {
    const { error: postError } = await supabase
      .from('goods_receipts')
      .update({ status: 'posted' })
      .eq('id', receipt!.id)

    if (postError) {
      fail(`The count is saved as a draft but could not be posted: ${postError.message}`)
    }
  }

  revalidatePath('/inbound')
  revalidatePath(returnTo)
  revalidatePath(`/purchase-orders/${poId}`)
  redirect(post ? `/inbound?posted=${encodeURIComponent(receipt!.grn_number)}` : returnTo)
}

/** Posts a count that was saved earlier and left open. */
export async function postDraftReceipt(formData: FormData): Promise<void> {
  await requireRole(...RECEIVERS)

  const grnId = String(formData.get('goods_receipt_id'))
  const poId = String(formData.get('purchase_order_id'))
  if (isDemoMode()) redirect(`/inbound/${poId}?error=${encodeURIComponent(demoWriteRefusal())}`)

  const supabase = await createClient()
  const { error } = await supabase
    .from('goods_receipts')
    .update({ status: 'posted' })
    .eq('id', grnId)

  revalidatePath('/inbound')
  revalidatePath(`/purchase-orders/${poId}`)
  redirect(error ? `/inbound/${poId}?error=${encodeURIComponent(error.message)}` : '/inbound')
}
