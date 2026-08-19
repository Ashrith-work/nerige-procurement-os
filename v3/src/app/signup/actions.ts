'use server'

import { createClient } from '@/lib/supabase/server'
import { toAuthEmail } from '@/lib/auth/user-id'
import { REQUESTABLE_ROLE_VALUES } from './roles'

export interface SignupState {
  status: 'idle' | 'sent' | 'error'
  message?: string
}

/**
 * Asks for an account. Creates nothing.
 *
 * Runs through the ordinary anon client, not the service role: the only thing
 * this needs is EXECUTE on `request_signup`, which migration 028 grants to
 * `anon`. Reaching for the service-role key on a public, unauthenticated
 * endpoint would hand a form on the open internet a credential that bypasses
 * every policy in the schema, to do a job one function already does.
 *
 * ALWAYS ANSWERS THE SAME. Duplicate identity, existing account, or a genuinely
 * new applicant — all three return the same sentence. Anything else makes this
 * an oracle for whether a given person has a login here, and the applicant
 * cannot act on the difference anyway: in every case what happens next is that
 * somebody at Nerige looks at it.
 */
export async function requestSignup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const userId = String(formData.get('user_id') ?? '').trim()
  const fullName = String(formData.get('full_name') ?? '').trim()
  const role = String(formData.get('role') ?? '').trim()
  const vendorCode = String(formData.get('vendor_code') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!fullName) return { status: 'error', message: 'Please give your name.' }
  if (!userId) return { status: 'error', message: 'Please choose a user ID.' }
  if (!REQUESTABLE_ROLE_VALUES.has(role)) return { status: 'error', message: 'Please choose what you do.' }

  // Checked here as well as in the database, because this is the message the
  // applicant can act on: `toAuthEmail` is the same function the sign-in box
  // uses, so anything it rejects could never be signed in with even if an admin
  // approved it.
  if (toAuthEmail(userId) === null) {
    return {
      status: 'error',
      message:
        'That user ID will not work. Use your work email, or a short handle in lower case — letters and numbers, at least two characters.',
    }
  }

  if (role === 'vendor' && !vendorCode) {
    return { status: 'error', message: 'Please give your weaver code, for example HDR.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('request_signup', {
    p_user_id: userId,
    p_full_name: fullName,
    p_role: role,
    p_vendor_code: vendorCode || null,
    p_phone: phone || null,
    p_note: note || null,
  })

  if (error) {
    return {
      status: 'error',
      message: 'Something went wrong sending your request. Please try again.',
    }
  }

  return {
    status: 'sent',
    message:
      'Thank you. Nerige will review your request and give you a password once it is approved.',
  }
}
