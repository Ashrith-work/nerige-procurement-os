'use server'

import { revalidatePath } from 'next/cache'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export interface IssuePayload {
  restock: { sku: string; quantity: number }[]
  new_designs: { brief: string; quantity: number; refs: string[] }[]
}

export interface IssuedOrder {
  order_id: string
  order_number: string
  vendor_code: string
  vendor_name: string
  lines: number
}

export type IssueResult =
  | { status: 'ok'; batchId: string; orders: IssuedOrder[] }
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

  revalidatePath('/orders')

  const result = data as { batch_id: string; orders: IssuedOrder[] }
  return { status: 'ok', batchId: result.batch_id, orders: result.orders ?? [] }
}
