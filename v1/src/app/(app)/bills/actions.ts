'use server'

import { createHash, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/demo'
import { demoWriteRefusal } from '@/lib/demo/procurement'
import { requireUser, requireRole } from '@/lib/auth/session'

export interface BillFormState {
  status: 'idle' | 'error'
  message?: string
  fieldErrors?: Record<string, string>
}

/** Matches the bucket's allowed_mime_types in migration 007. */
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
const MAX_BYTES = 25 * 1024 * 1024

const BillSchema = z.object({
  purchase_order_id: z.uuid('Choose the order this bill is for.'),
  bill_number: z.string().trim().min(1, 'Enter the number printed on the bill.').max(60),
  bill_date: z.string().trim().min(1, 'Enter the date on the bill.'),
  subtotal_amount: z.coerce.number().nonnegative('Enter the amount before GST.'),
  tax_amount: z.coerce.number().nonnegative().default(0),
})

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

/**
 * Uploads a bill against an order.
 *
 * Three writes that have to happen in this order: the bytes into storage, the
 * metadata row that points at them, then the bill itself. The bill row will not
 * insert without a document_id — that NOT NULL is what makes "we have a bill
 * but nobody can find the paper" impossible.
 *
 * Used by both sides. The vendor uploads it from the portal the moment they
 * post the hard copy; Procurement uploads it when the paper arrives with the
 * parcel. Whoever gets there first, it lands on the order rather than in a chat.
 */
export async function submitBill(_prev: BillFormState, formData: FormData): Promise<BillFormState> {
  const user = await requireUser()

  if (isDemoMode()) return { status: 'error', message: demoWriteRefusal() }

  const parsed = BillSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0])
      fieldErrors[key] ??= issue.message
    }
    return { status: 'error', message: 'Please correct the highlighted fields.', fieldErrors }
  }
  const v = parsed.data

  const file = formData.get('document')
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: 'error',
      message: 'Attach a photo or scan of the bill.',
      fieldErrors: { document: 'A bill without the paper behind it is a claim, not a record.' },
    }
  }
  if (file.size > MAX_BYTES) {
    return { status: 'error', fieldErrors: { document: 'That file is larger than 25 MB.' } }
  }
  if (!ACCEPTED.includes(file.type)) {
    return {
      status: 'error',
      fieldErrors: { document: 'Use a PDF or a photo (JPEG, PNG, WebP or HEIC).' },
    }
  }

  const supabase = await createClient()

  // The order decides who the bill belongs to. Taking vendor_id from the form
  // would let a caller file a bill against somebody else's account; the trigger
  // overrides it anyway, and agreeing with the trigger here keeps the storage
  // path correct.
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, vendor_id, po_number, status')
    .eq('id', v.purchase_order_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!po) {
    return { status: 'error', message: 'That order could not be found.' }
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  // The same photograph uploaded twice is the most common way one delivery gets
  // paid for twice. Caught before it becomes a second payable row.
  const { data: duplicate } = await supabase
    .from('documents')
    .select('id')
    .eq('content_sha256', sha256)
    .eq('vendor_id', po.vendor_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (duplicate) {
    return {
      status: 'error',
      message: 'This exact file has already been uploaded for this vendor.',
      fieldErrors: { document: 'Already on file.' },
    }
  }

  const extension = EXTENSIONS[file.type] ?? 'bin'
  const path = `vendors/${po.vendor_id}/bills/${randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from('vendor-documents')
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    return { status: 'error', message: `Could not upload the file: ${uploadError.message}` }
  }

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .insert({
      vendor_id: po.vendor_id,
      owner_type: 'vendor_bill',
      owner_id: po.id,
      kind: 'other',
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size,
      content_sha256: sha256,
      uploaded_by: user.id,
    })
    .select('id')
    .single()

  if (documentError) {
    return { status: 'error', message: `Could not save the file: ${documentError.message}` }
  }

  const { error: billError } = await supabase.from('vendor_bills').insert({
    vendor_id: po.vendor_id,
    purchase_order_id: po.id,
    bill_number: v.bill_number,
    bill_date: v.bill_date,
    subtotal_amount: v.subtotal_amount,
    tax_amount: v.tax_amount,
    total_amount: v.subtotal_amount + v.tax_amount,
    document_id: document.id,
    submitted_by: user.id,
  })

  if (billError) {
    if (billError.code === '23505') {
      return {
        status: 'error',
        message: `Bill ${v.bill_number} has already been submitted for this vendor.`,
        fieldErrors: { bill_number: 'Already submitted.' },
      }
    }
    return { status: 'error', message: billError.message }
  }

  const destination = user.role === 'vendor' ? `/portal/orders/${po.id}` : `/purchase-orders/${po.id}`
  revalidatePath(destination)
  revalidatePath('/bills')
  redirect(destination)
}

// -----------------------------------------------------------------------------
// Review and settlement
// -----------------------------------------------------------------------------

/**
 * Applies a status change to a bill.
 *
 * Who may do what is decided by `app.bill_guard_transition()` — including the
 * rule that only the Founder can approve or settle. This function does not
 * re-check it, it surfaces the refusal, so the rule exists in exactly one place.
 */
async function moveBill(
  billId: string,
  patch: Record<string, unknown>,
  redirectTo: string,
): Promise<never> {
  if (isDemoMode()) redirect(`${redirectTo}?error=${encodeURIComponent(demoWriteRefusal())}`)

  const supabase = await createClient()
  const { error } = await supabase.from('vendor_bills').update(patch).eq('id', billId)

  revalidatePath('/bills')
  revalidatePath(redirectTo)
  redirect(
    error
      ? `${redirectTo}?error=${encodeURIComponent(error.message.replace(/^ERROR:\s*/i, '').split('\n')[0])}`
      : redirectTo,
  )
}

export async function startBillReview(formData: FormData): Promise<void> {
  await requireRole('founder', 'procurement_head')
  const id = String(formData.get('bill_id'))
  await moveBill(id, { status: 'under_review' }, `/bills/${id}`)
}

export async function disputeBill(formData: FormData): Promise<void> {
  await requireRole('founder', 'procurement_head')
  const id = String(formData.get('bill_id'))
  const note = String(formData.get('variance_note') ?? '').trim()

  if (!note) {
    redirect(`/bills/${id}?error=${encodeURIComponent('Say what does not agree — the vendor is told.')}`)
  }
  await moveBill(id, { status: 'disputed', variance_note: note }, `/bills/${id}`)
}

export async function rejectBill(formData: FormData): Promise<void> {
  await requireRole('founder', 'procurement_head')
  const id = String(formData.get('bill_id'))
  const note = String(formData.get('variance_note') ?? '').trim()

  if (!note) {
    redirect(`/bills/${id}?error=${encodeURIComponent('Say why the bill is being rejected.')}`)
  }
  await moveBill(id, { status: 'rejected', variance_note: note }, `/bills/${id}`)
}

/** Approval releases money, so it is the Founder's alone — in the database too. */
export async function approveBill(formData: FormData): Promise<void> {
  await requireRole('founder')
  const id = String(formData.get('bill_id'))
  await moveBill(id, { status: 'approved' }, `/bills/${id}`)
}

export async function markBillPaid(formData: FormData): Promise<void> {
  await requireRole('founder')
  const id = String(formData.get('bill_id'))
  const reference = String(formData.get('payment_reference') ?? '').trim()

  if (!reference) {
    redirect(
      `/bills/${id}?error=${encodeURIComponent('Record the payment reference — this is what reconciles against the bank statement.')}`,
    )
  }
  await moveBill(id, { status: 'paid', payment_reference: reference }, `/bills/${id}`)
}

/**
 * A short-lived link to the hard copy.
 *
 * The bucket is private and there is no public URL. Every view goes through a
 * signed URL minted here, after the caller's session has been checked — which
 * means access to the paper is governed by the same rules as access to the row.
 */
export async function billDocumentUrl(documentId: string): Promise<string | null> {
  await requireUser()
  // No bucket behind a demo session, so there is nothing to sign. The bill
  // screen already handles a null by saying the file could not be loaded.
  if (isDemoMode()) return null
  const supabase = await createClient()

  const { data: document } = await supabase
    .from('documents')
    .select('storage_bucket, storage_path')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!document) return null

  const { data } = await supabase.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.storage_path, 300)

  return data?.signedUrl ?? null
}
