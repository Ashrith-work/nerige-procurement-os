'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/demo'
import { demoWriteRefusal } from '@/lib/demo/procurement'
import { requireRole, requireUser } from '@/lib/auth/session'

export interface FormState {
  status: 'idle' | 'error'
  message?: string
  fieldErrors?: Record<string, string>
}

const ORDER_MANAGERS = ['founder', 'procurement_head'] as const

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0])
    out[key] ??= issue.message
  }
  return out
}

/**
 * Turns a database refusal into something a person can act on.
 *
 * The status machine and the column guards raise real, specific messages —
 * "A vendor cannot move a purchase order from issued to received" — and those
 * are far more useful than a generic failure. What is stripped is the Postgres
 * decoration around them.
 */
function readableError(message: string): string {
  const cleaned = message.replace(/^ERROR:\s*/i, '').split('\n')[0]
  if (/row-level security/i.test(cleaned)) {
    return 'You do not have permission to do that.'
  }
  return cleaned
}

// -----------------------------------------------------------------------------
// Creating the order
// -----------------------------------------------------------------------------

const NewOrderSchema = z.object({
  vendor_id: z.uuid('Choose a vendor.'),
  title: z.string().trim().max(120).optional().or(z.literal('')),
  required_by: z.string().trim().optional().or(z.literal('')),
  instructions: z.string().trim().max(4000).optional().or(z.literal('')),
})

/**
 * Creates the order as a DRAFT and sends the user to it.
 *
 * Deliberately two steps rather than one big form: an order is assembled by
 * looking things up — which SKUs this vendor makes, what we paid last time —
 * and a single submit-everything screen cannot show that. The draft is
 * invisible to the vendor until it is issued, so there is no cost to it
 * existing while it is still being thought about.
 */
export async function createPurchaseOrder(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(...ORDER_MANAGERS)

  if (isDemoMode()) return { status: 'error', message: demoWriteRefusal() }

  const parsed = NewOrderSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }
  const v = parsed.data

  const supabase = await createClient()

  // An order to a vendor who has not cleared KYC is an order we cannot legally
  // pay. Blocked here with an explanation rather than at the payment stage,
  // three weeks later, once the sarees have already been woven.
  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, status, display_name')
    .eq('id', v.vendor_id)
    .is('deleted_at', null)
    .single()

  if (!vendor) {
    return { status: 'error', message: 'That vendor could not be found.' }
  }
  if (vendor.status !== 'active') {
    return {
      status: 'error',
      message: `${vendor.display_name} is ${vendor.status.replace(/_/g, ' ')} and cannot receive an order. Complete their KYC first.`,
      fieldErrors: { vendor_id: 'Not orderable.' },
    }
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .insert({
      vendor_id: v.vendor_id,
      title: v.title || null,
      required_by: v.required_by || null,
      instructions: v.instructions || null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { status: 'error', message: readableError(error.message) }

  revalidatePath('/purchase-orders')
  redirect(`/purchase-orders/${data.id}`)
}

// -----------------------------------------------------------------------------
// Lines
// -----------------------------------------------------------------------------

const RestockLineSchema = z.object({
  purchase_order_id: z.uuid(),
  product_id: z.uuid('Choose a product.'),
  quantity: z.coerce.number().int().positive('Enter how many pieces.'),
  unit_price: z.coerce.number().nonnegative('Enter a price.'),
})

export async function addRestockLine(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(...ORDER_MANAGERS)

  if (isDemoMode()) return { status: 'error', message: demoWriteRefusal() }

  const parsed = RestockLineSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error), message: 'Check the line.' }
  }
  const v = parsed.data

  const supabase = await createClient()
  // gst_rate follows the product rather than being retyped per line: it is a
  // property of what is being bought, and a mistyped rate becomes a mismatched
  // bill six weeks later.
  const { data: product } = await supabase
    .from('products')
    .select('gst_rate')
    .eq('id', v.product_id)
    .single()

  const { error } = await supabase.from('purchase_order_lines').insert({
    purchase_order_id: v.purchase_order_id,
    kind: 'restock',
    product_id: v.product_id,
    quantity: v.quantity,
    unit_price: v.unit_price,
    gst_rate: product?.gst_rate ?? 5,
  })

  if (error) return { status: 'error', message: readableError(error.message) }

  revalidatePath(`/purchase-orders/${v.purchase_order_id}`)
  return { status: 'idle' }
}

const NewDesignLineSchema = z.object({
  purchase_order_id: z.uuid(),
  series_id: z.string().trim().optional().or(z.literal('')),
  description: z
    .string()
    .trim()
    .min(10, 'Describe the design — colour, border, fabric, anything said on the call.')
    .max(2000),
  colours: z.string().trim().optional().or(z.literal('')),
  quantity: z.coerce.number().int().positive('Enter how many pieces.'),
  unit_price: z.coerce.number().nonnegative('Enter the agreed price.'),
})

/**
 * Adds a commissioned design with no SKU.
 *
 * This is the half of the weekly order that spreadsheets cannot hold: there is
 * no product code yet because the saree does not exist yet. The brief is the
 * line. A code gets assigned when the pieces arrive and someone can look at
 * them.
 */
export async function addNewDesignLine(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole(...ORDER_MANAGERS)

  if (isDemoMode()) return { status: 'error', message: demoWriteRefusal() }

  const parsed = NewDesignLineSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { status: 'error', fieldErrors: fieldErrorsFrom(parsed.error), message: 'Check the line.' }
  }
  const v = parsed.data

  const colours = (v.colours ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

  const supabase = await createClient()
  const { error } = await supabase.from('purchase_order_lines').insert({
    purchase_order_id: v.purchase_order_id,
    kind: 'new_design',
    series_id: v.series_id || null,
    description: v.description,
    colours,
    quantity: v.quantity,
    unit_price: v.unit_price,
  })

  if (error) return { status: 'error', message: readableError(error.message) }

  revalidatePath(`/purchase-orders/${v.purchase_order_id}`)
  return { status: 'idle' }
}

export async function removeLine(formData: FormData): Promise<void> {
  await requireRole(...ORDER_MANAGERS)

  const poId = String(formData.get('purchase_order_id'))
  const lineId = String(formData.get('line_id'))
  const back = `/purchase-orders/${poId}`
  if (isDemoMode()) redirect(`${back}?error=${encodeURIComponent(demoWriteRefusal())}`)

  const supabase = await createClient()

  // Only while the order is still a draft. The database permits Procurement to
  // amend an issued order — sometimes that is exactly right, and the audit trail
  // records it — but silently shrinking an order a vendor has already accepted
  // is not something a Remove link should do. An amendment that the vendor has
  // agreed to belongs in the thread and then in a fresh line.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('status')
    .eq('id', poId)
    .maybeSingle()

  if (po?.status !== 'draft') {
    redirect(
      `${back}?error=${encodeURIComponent('This order has already been sent. Agree the change with the vendor in the conversation, then amend it.')}`,
    )
  }

  // Soft delete: the line stays in the audit trail. "You removed six pieces
  // from my order" is a conversation that needs a record behind it.
  const { error } = await supabase
    .from('purchase_order_lines')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', lineId)

  revalidatePath(back)
  if (error) redirect(`${back}?error=${encodeURIComponent(readableError(error.message))}`)
  redirect(back)
}

// -----------------------------------------------------------------------------
// Moving the order along
// -----------------------------------------------------------------------------

/**
 * Applies a status change and reports the database's own refusal if there is
 * one.
 *
 * Every rule about who may do what lives in `app.po_guard_transition()`. This
 * function does not re-implement it — it applies the change and surfaces the
 * message, so there is exactly one place where the rules can be wrong.
 */
async function transition(
  poId: string,
  patch: Record<string, unknown>,
  redirectTo: string,
): Promise<never> {
  if (isDemoMode()) redirect(`${redirectTo}?error=${encodeURIComponent(demoWriteRefusal())}`)

  const supabase = await createClient()
  const { error } = await supabase.from('purchase_orders').update(patch).eq('id', poId)

  revalidatePath(redirectTo)
  revalidatePath('/purchase-orders')
  redirect(error ? `${redirectTo}?error=${encodeURIComponent(readableError(error.message))}` : redirectTo)
}

export async function issuePurchaseOrder(formData: FormData): Promise<void> {
  await requireRole(...ORDER_MANAGERS)
  const poId = String(formData.get('purchase_order_id'))
  await transition(poId, { status: 'issued' }, `/purchase-orders/${poId}`)
}

export async function cancelPurchaseOrder(formData: FormData): Promise<void> {
  await requireRole(...ORDER_MANAGERS)
  const poId = String(formData.get('purchase_order_id'))
  const reason = String(formData.get('cancellation_reason') ?? '').trim()

  if (!reason) {
    redirect(
      `/purchase-orders/${poId}?error=${encodeURIComponent('Say why the order is being cancelled — the vendor will be told.')}`,
    )
  }

  await transition(
    poId,
    { status: 'cancelled', cancellation_reason: reason },
    `/purchase-orders/${poId}`,
  )
}

// -----------------------------------------------------------------------------
// The order thread
// -----------------------------------------------------------------------------

/**
 * Posts a message against an order.
 *
 * Available to vendors as well as staff, which is the point: this is what
 * replaces the WhatsApp thread where "can we send 20 now and 20 next week?"
 * currently lives and is currently lost.
 */
export async function postOrderMessage(formData: FormData): Promise<void> {
  const user = await requireUser()

  const poId = String(formData.get('purchase_order_id'))
  const vendorId = String(formData.get('vendor_id'))
  const body = String(formData.get('body') ?? '').trim()
  const isInternal = formData.get('is_internal') === 'on'
  const returnTo = String(formData.get('return_to') ?? `/purchase-orders/${poId}`)

  if (!body) redirect(returnTo)
  if (isDemoMode()) redirect(`${returnTo}?error=${encodeURIComponent(demoWriteRefusal())}`)

  const supabase = await createClient()
  const { error } = await supabase.from('purchase_order_messages').insert({
    purchase_order_id: poId,
    vendor_id: vendorId,
    author_id: user.id,
    body,
    // A vendor cannot set this: the RLS policy refuses an internal note from
    // them outright, rather than silently saving one they could never read.
    is_internal: isInternal && user.role !== 'vendor',
  })

  revalidatePath(returnTo)
  if (error) redirect(`${returnTo}?error=${encodeURIComponent(readableError(error.message))}`)
  redirect(returnTo)
}
