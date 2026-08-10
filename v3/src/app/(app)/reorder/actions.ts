'use server'

import { revalidatePath } from 'next/cache'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { sendOnWhatsApp } from '@/app/(app)/orders/send-actions'

export interface IssuePayload {
  restock: { sku: string; quantity: number }[]
  new_designs: { brief: string; quantity: number; refs: string[] }[]
  /** Also push each order to the weaver's WhatsApp as it is created. */
  alsoWhatsApp?: boolean
}

export interface IssuedOrder {
  order_id: string
  order_number: string
  vendor_code: string
  vendor_name: string
  lines: number
}

export type IssueResult =
  | { status: 'ok'; batchId: string; orders: IssuedOrder[]; whatsapp?: string }
  | { status: 'error'; message: string }

/**
 * One press of send.
 *
 * All this does is hand the selection to `public.issue_orders`, which splits it
 * by weaver and writes every order in one transaction. The split, the vendor
 * resolution, the snapshots and the refusals all live in the database — three
 * orders where the second insert failed would be worse than none, and no amount
 * of care in this file can make four separate PostgREST requests atomic.
 *
 * Note what is NOT sent: a vendor. The payload names sarees; the database
 * decides whose they are, from each SKU's own product row.
 */
export async function issueOrders(payload: IssuePayload): Promise<IssueResult> {
  await requireProcurement()

  const restock = (payload.restock ?? []).filter((l) => l.sku && l.quantity > 0)
  const newDesigns = (payload.new_designs ?? []).filter(
    (l) => l.brief?.trim() && l.refs?.length > 0 && l.quantity > 0,
  )

  if (restock.length === 0 && newDesigns.length === 0) {
    return { status: 'error', message: 'Nothing selected.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('issue_orders', {
    p_payload: { restock, new_designs: newDesigns },
  })

  if (error) {
    // The function raises with a sentence rather than a code, so it can be shown.
    return { status: 'error', message: error.message }
  }

  const result = data as { batch_id: string; orders: IssuedOrder[] }
  const orders = result.orders ?? []

  // Putting an order in the portal IS delivering it there, so the timestamp is
  // recorded at issue rather than waiting for someone to press a button that
  // would not change anything. The button on the order screen exists for the
  // case where this write failed, and is idempotent.
  await supabase
    .from('orders')
    .update({ dashboard_sent_at: new Date().toISOString() })
    .in(
      'id',
      orders.map((o) => o.order_id),
    )

  let whatsapp: string | undefined

  if (payload.alsoWhatsApp) {
    // Sequential, and failures are collected rather than thrown. One weaver's
    // number being wrong must not lose the other two sends — and the orders
    // themselves already exist, so there is nothing to roll back.
    const failures: string[] = []
    let sent = 0

    for (const order of orders) {
      const form = new FormData()
      form.set('orderId', order.order_id)
      const outcome = await sendOnWhatsApp({ status: 'idle' }, form)
      if (outcome.status === 'sent') sent += 1
      else failures.push(`${order.vendor_code}: ${outcome.message ?? 'failed'}`)
    }

    whatsapp = failures.length
      ? `WhatsApp: ${sent} of ${orders.length} sent. ${failures.join(' · ')}`
      : `WhatsApp: sent to ${sent} ${sent === 1 ? 'weaver' : 'weavers'}.`
  }

  revalidatePath('/orders')

  return { status: 'ok', batchId: result.batch_id, orders, whatsapp }
}
