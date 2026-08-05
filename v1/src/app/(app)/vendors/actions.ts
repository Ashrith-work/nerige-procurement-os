'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import {
  validateGstin,
  validatePan,
  gstinMatchesPan,
  normalisePhone,
  maxPaymentTermsDays,
} from '@/lib/validation/india'

export interface VendorFormState {
  status: 'idle' | 'error'
  message?: string
  /** Keyed by form field name so errors render beside the offending input. */
  fieldErrors?: Record<string, string>
}

const VendorSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/, 'Use 2–16 characters: A–Z, 0–9, hyphen or underscore.'),
  legal_name: z.string().trim().min(2, 'Legal name is required.').max(200),
  display_name: z.string().trim().min(2, 'Display name is required.').max(120),
  gst_registration_type: z.enum(['regular', 'composition', 'unregistered', 'exempt']),
  gstin: z.string().trim().toUpperCase().optional().or(z.literal('')),
  pan: z.string().trim().toUpperCase().optional().or(z.literal('')),
  msme_category: z.enum(['not_registered', 'micro', 'small', 'medium']),
  udyam_number: z.string().trim().toUpperCase().optional().or(z.literal('')),
  payment_terms_days: z.coerce.number().int().min(0).max(180),
  default_lead_time_days: z.coerce.number().int().min(0).max(365),
  primary_contact_name: z.string().trim().max(120).optional().or(z.literal('')),
  primary_phone: z.string().trim().optional().or(z.literal('')),
  primary_email: z.string().trim().toLowerCase().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

/**
 * Creates a vendor.
 *
 * Validation runs in three layers, and all three are deliberate:
 *   1. Zod — shape and type, with messages next to the field
 *   2. this function — statutory correctness (GSTIN checksum, PAN/GSTIN
 *      agreement, MSME terms) that Zod cannot express
 *   3. the database — CHECK constraints and triggers that hold no matter which
 *      code path, import script or n8n workflow does the writing
 *
 * Skipping layer 3 because layers 1–2 exist is how bad data eventually arrives
 * from somewhere nobody remembered.
 */
export async function createVendor(
  _prev: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  // Defence in depth. RLS would reject this write anyway; this produces a clear
  // message instead of an opaque database error.
  await requireRole('founder', 'procurement_head')

  const parsed = VendorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0])
      fieldErrors[key] ??= issue.message
    }
    return { status: 'error', message: 'Please correct the highlighted fields.', fieldErrors }
  }

  const v = parsed.data
  const fieldErrors: Record<string, string> = {}

  // --- Statutory checks -----------------------------------------------------
  if (v.gst_registration_type === 'regular' && !v.gstin) {
    fieldErrors.gstin = 'A GSTIN is required for a regular-registration vendor.'
  }

  if (v.gstin) {
    const result = validateGstin(v.gstin)
    if (!result.valid) fieldErrors.gstin = result.error!
    else if (v.pan && !gstinMatchesPan(v.gstin, v.pan)) {
      // The GSTIN embeds the PAN, so a mismatch means one of the two documents
      // was mis-transcribed. Catching it now avoids an invoice that cannot be
      // matched in M6.
      fieldErrors.pan = 'This PAN does not match the PAN embedded in the GSTIN.'
    }
  }

  if (v.pan) {
    const result = validatePan(v.pan)
    if (!result.valid) fieldErrors.pan = result.error!
  }

  if (v.msme_category !== 'not_registered' && !v.udyam_number) {
    fieldErrors.udyam_number = 'An MSME claim needs a Udyam registration number.'
  }

  const maxTerms = maxPaymentTermsDays(v.msme_category)
  if (v.payment_terms_days > maxTerms) {
    fieldErrors.payment_terms_days =
      `A ${v.msme_category} MSME supplier must be paid within ${maxTerms} days ` +
      `(Income Tax Act s.43B(h)) — paying later disallows the expense for the year.`
  }

  let phone: string | null = null
  if (v.primary_phone) {
    phone = normalisePhone(v.primary_phone)
    if (!phone) fieldErrors.primary_phone = 'Enter a valid 10-digit mobile number.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', message: 'Please correct the highlighted fields.', fieldErrors }
  }

  // --- Write ----------------------------------------------------------------
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('vendors')
    .insert({
      code: v.code,
      legal_name: v.legal_name,
      display_name: v.display_name,
      gst_registration_type: v.gst_registration_type,
      gstin: v.gstin || null,
      pan: v.pan || null,
      msme_category: v.msme_category,
      udyam_number: v.udyam_number || null,
      payment_terms_days: v.payment_terms_days,
      default_lead_time_days: v.default_lead_time_days,
      primary_contact_name: v.primary_contact_name || null,
      primary_phone: phone,
      primary_email: v.primary_email || null,
      notes: v.notes || null,
      // A new vendor is never immediately orderable. KYC completion moves it to
      // 'active' — the control that stops a PO going to an unvetted supplier.
      status: 'pending_kyc',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // Partial unique indexes on code and gstin.
      return {
        status: 'error',
        message: 'A vendor with this code or GSTIN already exists.',
        fieldErrors: { code: 'Already in use.' },
      }
    }
    return { status: 'error', message: `Could not save the vendor: ${error.message}` }
  }

  revalidatePath('/vendors')
  redirect(`/vendors/${data.id}`)
}
