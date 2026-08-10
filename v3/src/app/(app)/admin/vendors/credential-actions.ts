'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProcurement } from '@/lib/auth/session'
import { toAuthEmail, toDisplayUserId } from '@/lib/auth/user-id'
import { normalisePhone } from '@/lib/auth/phone'
import { generatePassword } from '@/lib/auth/password'
import { isLocale } from '@/lib/i18n'

/**
 * Creating and re-issuing weaver logins.
 *
 * THE PASSWORD IS NEVER STORED. It is generated in memory, handed to Supabase
 * Auth — which keeps only a bcrypt hash — returned once in the value below, and
 * then it is gone. Nothing writes it to a table, a log line or a cookie. Close
 * the card without copying it and the only way forward is to issue another one,
 * which is one click and is itself recorded.
 *
 * What is recorded is `credential_issued_at` and `credential_issued_by`, which
 * answers every question an admin actually has about a credential except the
 * one nobody at Nerige should be able to answer.
 *
 * The service-role client appears here for exactly one call — creating or
 * updating the `auth.users` row, which no policy of ours can reach. Everything
 * else on this path runs as the signed-in admin under the policies added in
 * migration 013, so the bypass is as narrow as it can be made.
 */
export interface CredentialResult {
  status: 'idle' | 'issued' | 'error'
  message?: string
  /** Shown once and never retrievable. */
  credential?: {
    userId: string
    password: string
    vendorCode: string
    displayName: string
  }
}

const MIN_PASSWORD = 12

/** Reads a trimmed string field, or '' when absent. */
function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

/**
 * A brand-new weaver: the vendor row, the auth user, the profile and the link,
 * in that order.
 *
 * Order matters on failure. The auth user is created only once the vendor row
 * exists, and is deleted again if the profile or the link fails — an auth user
 * with no profile can sign in and then resolve to no session, which presents as
 * "the portal is broken" rather than as "this account is half-made".
 */
export async function createVendor(
  _prev: CredentialResult,
  formData: FormData,
): Promise<CredentialResult> {
  const admin = await requireProcurement()

  const code = field(formData, 'code').toUpperCase()
  const displayName = field(formData, 'display_name')
  const whatsappRaw = field(formData, 'whatsapp_number')
  const locale = field(formData, 'default_locale') || 'en'
  const loginId = field(formData, 'login_id').toLowerCase()

  if (!/^[A-Z0-9][A-Z0-9_-]{1,15}$/.test(code)) {
    return { status: 'error', message: 'A vendor code is 2–16 characters: letters, digits, - or _.' }
  }
  if (!displayName) return { status: 'error', message: 'Give the weaver a name.' }
  if (!isLocale(locale)) return { status: 'error', message: 'Pick a language.' }

  const email = toAuthEmail(loginId)
  if (!email) {
    return {
      status: 'error',
      message: `"${loginId}" is not a usable login ID. Use a short handle like hdr, or an email address.`,
    }
  }

  // E.164 or nothing. A ten-digit number with +91 assumed is the commonest way
  // a WhatsApp send fails silently later.
  const whatsapp = whatsappRaw ? normalisePhone(whatsappRaw) : null
  if (whatsappRaw && !whatsapp) {
    return { status: 'error', message: `"${whatsappRaw}" is not a valid mobile number.` }
  }

  const supabase = await createClient()

  const { data: clash } = await supabase
    .from('vendors')
    .select('id')
    .eq('code', code)
    .is('deleted_at', null)
    .maybeSingle()

  if (clash) return { status: 'error', message: `A vendor with code ${code} already exists.` }

  const { data: vendor, error: vendorError } = await supabase
    .from('vendors')
    .insert({
      code,
      display_name: displayName,
      default_locale: locale,
      whatsapp_number: whatsapp,
    })
    .select('id, code, display_name')
    .single()

  if (vendorError || !vendor) {
    return { status: 'error', message: `Could not create the vendor: ${vendorError?.message}` }
  }

  return issueLogin({
    adminId: admin.id,
    vendorId: vendor.id,
    vendorCode: vendor.code,
    displayName: `${vendor.display_name} owner`,
    email,
    isOwner: true,
  })
}

/** A second login at a weaver that already exists — the owner's son, a manager. */
export async function addVendorLogin(
  _prev: CredentialResult,
  formData: FormData,
): Promise<CredentialResult> {
  const admin = await requireProcurement()

  const vendorId = field(formData, 'vendorId')
  const loginId = field(formData, 'login_id').toLowerCase()
  const fullName = field(formData, 'full_name')

  const email = toAuthEmail(loginId)
  if (!vendorId || !email) return { status: 'error', message: 'Give a usable login ID.' }
  if (!fullName) return { status: 'error', message: 'Give this person a name.' }

  const supabase = await createClient()
  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, code, display_name')
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) return { status: 'error', message: 'That vendor is not here.' }

  return issueLogin({
    adminId: admin.id,
    vendorId: vendor.id,
    vendorCode: vendor.code,
    displayName: fullName,
    email,
    isOwner: false,
  })
}

async function issueLogin(opts: {
  adminId: string
  vendorId: string
  vendorCode: string
  displayName: string
  email: string
  isOwner: boolean
}): Promise<CredentialResult> {
  const password = generatePassword()
  if (password.replace(/-/g, '').length < MIN_PASSWORD - 2) {
    return { status: 'error', message: 'Could not generate a password.' }
  }

  const supabase = await createClient()
  const serviceRole = createAdminClient()

  const { data: created, error: authError } = await serviceRole.auth.admin.createUser({
    email: opts.email,
    password,
    // Created by someone who has already met this person, and for a weaver the
    // address is derived rather than real — nothing would ever arrive at it to
    // confirm.
    email_confirm: true,
  })

  if (authError || !created.user) {
    return { status: 'error', message: `Could not create the login: ${authError?.message}` }
  }

  const rollback = async (message: string): Promise<CredentialResult> => {
    await serviceRole.auth.admin.deleteUser(created.user!.id)
    return { status: 'error', message }
  }

  const { error: profileError } = await supabase.from('app_users').insert({
    id: created.user.id,
    role: 'vendor',
    status: 'active',
    full_name: opts.displayName,
    email: opts.email,
    // Null so she follows vendors.default_locale. Writing 'en' here would
    // out-rank the language the admin just chose and leave her portal English.
    locale_override: null,
    credential_issued_at: new Date().toISOString(),
    credential_issued_by: opts.adminId,
  })

  if (profileError) return rollback(`Could not create the profile: ${profileError.message}`)

  const { error: linkError } = await supabase
    .from('vendor_users')
    .insert({ vendor_id: opts.vendorId, user_id: created.user.id, is_owner: opts.isOwner })

  if (linkError) return rollback(`Could not link the login: ${linkError.message}`)

  revalidatePath('/admin/vendors', 'layout')

  return {
    status: 'issued',
    credential: {
      userId: toDisplayUserId(opts.email) ?? opts.email,
      password,
      vendorCode: opts.vendorCode,
      displayName: opts.displayName,
    },
  }
}

/**
 * A new password for a login that already exists.
 *
 * This is the answer to "what is her password" — there isn't one anybody can
 * look up, so the supported move is to issue another. It takes one click,
 * invalidates the old one immediately, and writes a fresh
 * `credential_issued_at` so the trail shows it happened.
 */
export async function resetVendorPassword(
  _prev: CredentialResult,
  formData: FormData,
): Promise<CredentialResult> {
  const admin = await requireProcurement()
  const userId = field(formData, 'userId')
  if (!userId) return { status: 'error', message: 'No login given.' }

  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, full_name, email, role')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!profile) return { status: 'error', message: 'That login is not here.' }
  if (profile.role !== 'vendor') {
    return { status: 'error', message: 'This screen only re-issues weaver logins.' }
  }

  const { data: link } = await supabase
    .from('vendor_users')
    .select('vendors(code)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()

  type V = { code: string }
  const embedded = link?.vendors as V | V[] | null
  const vendorCode = (Array.isArray(embedded) ? embedded[0] : embedded)?.code ?? ''

  const password = generatePassword()

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password })
  if (error) return { status: 'error', message: `Could not set the password: ${error.message}` }

  // Recorded after the change succeeded, so the timestamp never claims an
  // issuing that did not happen.
  await supabase
    .from('app_users')
    .update({
      credential_issued_at: new Date().toISOString(),
      credential_issued_by: admin.id,
    })
    .eq('id', userId)

  revalidatePath('/admin/vendors', 'layout')

  return {
    status: 'issued',
    credential: {
      userId: toDisplayUserId(profile.email) ?? profile.email ?? '',
      password,
      vendorCode,
      displayName: profile.full_name,
    },
  }
}
