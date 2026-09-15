'use server'

import { revalidatePath } from 'next/cache'
import { requireReceiving } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import {
  isRejectReason,
  parseCount,
  validateReceipt,
  type ReceiptEntry,
  type ReceiptProblem,
} from '@/lib/inwarding/rules'

export interface ReceiptActionState {
  status: 'idle' | 'error' | 'success'
  message?: string
  problems?: ReceiptProblem[]
  /** True when this parcel moved the order to received. */
  completed?: boolean
  /** Changes on every success, so the form knows to clear itself. */
  savedAt?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One parcel, as counted at the bench.
 *
 * This does not decide anything the database does not also decide.
 * `public.record_order_receipt()` checks the capability, refuses an order that
 * is not dispatched, validates every line and moves the order to received. The
 * validation here runs first only so that three mistakes on a twelve-line
 * parcel come back as three sentences in one round trip, rather than as the
 * first RPC error string.
 *
 * Field names: `lineId` repeated once per line, then `received:<id>`,
 * `rejected:<id>`, `reason:<id>`, `note:<id>`; and `note`, `closeShort` for the
 * parcel.
 */
export async function recordReceipt(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  await requireReceiving()

  const orderId = String(formData.get('orderId') ?? '')
  if (!UUID.test(orderId)) return { status: 'error', message: 'That order could not be found.' }

  const entries: ReceiptEntry[] = formData
    .getAll('lineId')
    .map(String)
    .filter((id) => UUID.test(id))
    .map((id) => {
      const reason = formData.get(`reason:${id}`)
      const note = String(formData.get(`note:${id}`) ?? '').trim()
      return {
        orderLineId: id,
        received: parseCount(formData.get(`received:${id}`)),
        rejected: parseCount(formData.get(`rejected:${id}`)),
        reason: isRejectReason(reason) ? reason : null,
        note: note || null,
      }
    })

  const closeShort = formData.get('closeShort') === 'on'
  const note = String(formData.get('note') ?? '').trim() || null

  const problems = validateReceipt(entries, { closeShort, note })
  if (problems.length > 0) {
    return { status: 'error', message: problems[0].message, problems }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_order_receipt', {
    p_order_id: orderId,
    p_lines: entries.map((e) => ({
      order_line_id: e.orderLineId,
      received: e.received,
      rejected: e.rejected,
      // A reason left selected on a line with nothing rejected is noise; the
      // database stores reason only alongside a rejection.
      reason: e.rejected > 0 ? e.reason : null,
      note: e.note,
    })),
    p_note: note,
    p_close_short: closeShort,
  })

  if (error) return { status: 'error', message: error.message }

  const completed = (data as { status?: string } | null)?.status === 'received'

  revalidatePath('/warehouse/inward')
  revalidatePath(`/warehouse/inward/${orderId}`)
  revalidatePath(`/orders/${orderId}`)

  return {
    status: 'success',
    completed,
    message: completed
      ? 'Parcel recorded. Every line is accounted for — the order is received.'
      : 'Parcel recorded. The order stays open for the pieces still to come.',
    savedAt: Date.now(),
  }
}
