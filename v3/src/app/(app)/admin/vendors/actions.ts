'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireProcurement } from '@/lib/auth/session'
import { IMPERSONATION_COOKIE, readImpersonation } from '@/lib/auth/impersonation'
import { isLocale } from '@/lib/i18n'

/**
 * Start looking at a weaver's portal as she sees it.
 *
 * The log row is written BEFORE the cookie is set, and a failure to write it
 * aborts the whole thing. An audit trail that is best-effort is not an audit
 * trail — it is a log with a hole in it exactly where somebody would want one.
 */
export async function startImpersonating(formData: FormData): Promise<void> {
  const admin = await requireProcurement()
  const vendorId = String(formData.get('vendorId') ?? '')
  if (!vendorId) return

  const supabase = await createClient()

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id')
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) return

  const { error } = await supabase
    .from('impersonation_log')
    .insert({ admin_user_id: admin.id, vendor_id: vendorId })

  if (error) throw new Error(`Could not record the view: ${error.message}`)

  const jar = await cookies()
  jar.set(IMPERSONATION_COOKIE, vendorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Deliberately short. A forgotten impersonation cookie is how somebody ends
    // up reading a weaver's screen next Tuesday believing it is their own.
    maxAge: 60 * 60 * 2,
  })

  redirect('/portal')
}

export async function stopImpersonating(): Promise<void> {
  const admin = await requireProcurement()
  const active = await readImpersonation()

  const jar = await cookies()
  jar.delete(IMPERSONATION_COOKIE)

  if (active) {
    const supabase = await createClient()
    // Close the most recent open session for this pair. Not fatal if it misses:
    // the row that matters — that she looked, and when — is already written.
    const { data: open } = await supabase
      .from('impersonation_log')
      .select('id')
      .eq('admin_user_id', admin.id)
      .eq('vendor_id', active.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (open) {
      await supabase
        .from('impersonation_log')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', open.id)
    }
  }

  redirect('/admin/vendors')
}

/**
 * The admin setting a weaver's language.
 *
 * This is the setting the whole locale feature turns on. The Gadwal weaver's
 * house is Telugu speaking, so PGW's default becomes `te` and her portal is
 * Telugu from her first sign-in — she is never asked a question in a language
 * she cannot read in order to say which language she reads.
 */
export async function setVendorLocale(formData: FormData): Promise<void> {
  await requireProcurement()

  const vendorId = String(formData.get('vendorId') ?? '')
  const locale = String(formData.get('default_locale') ?? '')
  if (!vendorId || !isLocale(locale)) return

  const supabase = await createClient()
  const { error } = await supabase
    .from('vendors')
    .update({ default_locale: locale })
    .eq('id', vendorId)

  if (error) throw new Error(`Could not set the language: ${error.message}`)

  revalidatePath('/admin/vendors', 'layout')
}
