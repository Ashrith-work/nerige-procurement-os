'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/session'
import { toAuthEmail } from '@/lib/auth/user-id'
import { normalisePhone } from '@/lib/auth/phone'

export interface DecisionState {
  status: 'idle' | 'approved' | 'rejected' | 'error'
  message?: string
  /** Shown once, never stored. See generatePassword. */
  password?: string
  userId?: string
  requestId?: string
}

/**
 * A password nobody chose and nobody has to remember for long.
 *
 * base64url of 18 random bytes — 144 bits, well past anything that needs a
 * rate limiter behind it. Readable enough to be dictated over a phone call,
 * which is how it will actually travel, since this system sends no email: the
 * accounts live on a domain that cannot receive one.
 *
 * It is returned to the approving admin exactly once and never written down.
 * Supabase stores only its hash, and if it is lost the fix is the same as for
 * any forgotten password here — set a new one.
 */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

/**
 * Approving a request, which is the moment an account starts to exist.
 *
 * ORDER MATTERS, and it is the same order `provision-user.ts` uses for the same
 * reason: resolve the weaver FIRST, because a bad vendor code discovered after
 * `createUser` leaves an orphan auth user that blocks every retry with a
 * duplicate-email error. Every later failure rolls the auth user back.
 *
 * The service-role client appears here, and this is the category `admin.ts`
 * permits it for — creating an auth.users row cannot be expressed under RLS.
 * Everything else on this path goes through the ordinary client so it is
 * policy-checked: the decision itself is recorded by `decide_signup_request`,
 * which re-verifies `app.is_admin()` in the database rather than trusting that
 * this action already did.
 */
export async function approveSignup(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const admin = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const locale = String(formData.get('locale') ?? 'en')
  if (!id) return { status: 'error', message: 'No request given.' }

  const supabase = await createClient()

  // Read through the ordinary client: the admin-only SELECT policy is what
  // makes this readable at all, so a non-admin reaching this line gets nothing
  // rather than a row it should not see.
  const { data: request, error: readError } = await supabase
    .from('signup_requests')
    .select('id, user_id, full_name, requested_role, vendor_code, phone, status')
    .eq('id', id)
    .maybeSingle()

  if (readError || !request) return { status: 'error', message: 'That request no longer exists.' }
  if (request.status !== 'pending') {
    return { status: 'error', message: `That request was already ${request.status}.` }
  }

  const email = toAuthEmail(request.user_id as string)
  if (!email) {
    return {
      status: 'error',
      message: `"${request.user_id}" cannot be turned into a sign-in identity. Reject it and ask them to apply again.`,
    }
  }

  const role = request.requested_role as string
  const service = createAdminClient()

  // The weaver, first. See the header.
  let vendorId: string | null = null
  if (role === 'vendor') {
    const code = String(request.vendor_code ?? '').toUpperCase()
    const { data: vendor } = await service
      .from('vendors')
      .select('id, is_placeholder')
      .eq('code', code)
      .is('deleted_at', null)
      .maybeSingle()

    if (!vendor) {
      return {
        status: 'error',
        message: `No weaver has the code "${code}". Create the vendor first, or reject this request.`,
      }
    }
    // The holding pen is not a weaver — it owns the products whose SKU names
    // none. A login against it would be a person signing in as "unknown".
    if (vendor.is_placeholder) {
      return { status: 'error', message: 'UNIDENTIFIED is a holding pen, not a weaver.' }
    }
    vendorId = vendor.id as string
  }

  const phone = request.phone ? normalisePhone(String(request.phone)) : null
  const password = generatePassword()

  const { data: created, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    phone: phone || undefined,
    // An admin has just looked at this request and decided. For a weaver the
    // address is derived rather than real, so nothing could ever arrive at it
    // to confirm.
    email_confirm: true,
    phone_confirm: Boolean(phone),
  })

  if (authError || !created.user) {
    return {
      status: 'error',
      message: `Could not create the login: ${authError?.message ?? 'unknown error'}`,
    }
  }

  const { error: profileError } = await service.from('app_users').insert({
    id: created.user.id,
    role,
    status: 'active',
    full_name: request.full_name,
    email,
    phone: phone || null,
    // Null for a weaver: her language belongs to the WEAVER, so a second login
    // at the same house inherits it rather than arriving in English.
    locale_override: role === 'vendor' ? null : locale,
  })

  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id)
    return { status: 'error', message: `Could not create the profile: ${profileError.message}` }
  }

  if (vendorId) {
    const { error: linkError } = await service
      .from('vendor_users')
      .insert({ vendor_id: vendorId, user_id: created.user.id, is_owner: true })
    if (linkError) {
      await service.auth.admin.deleteUser(created.user.id)
      return { status: 'error', message: `Could not link to the weaver: ${linkError.message}` }
    }
    await service.from('vendors').update({ default_locale: locale }).eq('id', vendorId)
  }

  // Last, so that a row only ever reads 'approved' once the login behind it
  // actually exists. The reverse order would leave an approved request with no
  // account whenever any step above failed.
  const { error: decideError } = await supabase.rpc('decide_signup_request', {
    p_id: id,
    p_status: 'approved',
    p_note: null,
  })

  if (decideError) {
    return {
      status: 'error',
      message: `The login was created but the request could not be closed: ${decideError.message}. Do not approve it again.`,
      password,
      userId: request.user_id as string,
    }
  }

  revalidatePath('/admin/signups')

  return {
    status: 'approved',
    message: `${request.full_name} can now sign in. This password is shown once — copy it now.`,
    password,
    userId: request.user_id as string,
    requestId: id,
  }
}

/** Rejecting creates nothing and undoes nothing; it closes the request. */
export async function rejectSignup(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!id) return { status: 'error', message: 'No request given.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('decide_signup_request', {
    p_id: id,
    p_status: 'rejected',
    p_note: note || null,
  })

  if (error) return { status: 'error', message: error.message }

  revalidatePath('/admin/signups')
  return { status: 'rejected', message: 'Request rejected.', requestId: id }
}
