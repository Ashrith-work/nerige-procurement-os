/**
 * Provisions a login. The one legitimate use of the service-role key.
 *
 * Access to this portal is by invitation and there is no signup form, so this
 * script is the ONLY thing in the system that creates a user. Creating an
 * auth.users row cannot be expressed under RLS, which is why it lives here and
 * not in application code. Both records are written together — an auth user
 * with no app_users profile can authenticate and then resolve to no session,
 * which is a confusing state to debug at eleven at night.
 *
 * Usage:
 *   npm run provision -- --role procurement_head --name "Pooja" \
 *     --user-id pooja@nerigestory.com --password 'xxxxxxxxxxxx'
 *
 *   npm run provision -- --role vendor --name "HDR owner" \
 *     --user-id hdr --password 'xxxxxxxxxxxx' --vendor-code HDR --locale kn
 *
 * Changing a password on an account that already exists:
 *   npm run provision -- --user-id hdr --password 'yyyyyyyyyyyy' --reset-password
 *
 * A user ID is an email address or a short handle; see src/lib/auth/user-id.ts.
 * Optional: --phone (contact only, no longer a credential), --locale kn|ta|te|hi|en
 *
 * `--locale` on a vendor sets `vendors.default_locale` — the language of the
 * WEAVER, which every login at that house then inherits. On an internal user it
 * sets that person's own `locale_override`, because Pooja has no vendor to
 * inherit from.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { normalisePhone } from '../src/lib/auth/phone'
import { toAuthEmail, toDisplayUserId } from '../src/lib/auth/user-id'
import { isLocale } from '../src/lib/i18n'

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
    }
  } catch {
    // Environment may be supplied directly (CI, shell export).
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/**
 * Must stay in step with the `app_role` enum (migration 020) and with `AppRole`
 * in src/lib/auth/session.ts. Three lists, one fact — a role missing from any
 * of them fails in a different place: here it is refused at the command line,
 * in the enum it is refused by the database, and in the union it becomes a
 * silent `never` at every comparison.
 *
 * `--vendor-code` remains meaningful only for `vendor`; the three internal
 * roles take `--locale` as their own locale_override, like procurement_head.
 */
const ROLES = [
  'admin',
  'procurement_head',
  'warehouse_manager',
  'customer_support',
  'vendor',
] as const

/**
 * Supabase's own floor is six characters, which is too low for a credential
 * nobody can reset without asking us. Twelve is not a policy anyone has to
 * remember — the script generates them.
 */
const MIN_PASSWORD = 12

async function main() {
  loadEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const userId = arg('user-id')
  const password = arg('password')

  if (!userId) throw new Error('--user-id is required')
  const email = toAuthEmail(userId)
  if (!email) {
    throw new Error(
      `"${userId}" is not a usable user ID. Give an email address, or a lowercase ` +
        `handle of 2-32 characters starting with a letter or digit, e.g. hdr`,
    )
  }

  if (!password) throw new Error('--password is required')
  if (password.length < MIN_PASSWORD) {
    throw new Error(`--password must be at least ${MIN_PASSWORD} characters`)
  }

  // --- reset an existing password ------------------------------------------
  if (has('reset-password')) {
    const { data: profile, error } = await admin
      .from('app_users')
      .select('id, full_name, role')
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw new Error(`Could not look up "${userId}": ${error.message}`)
    if (!profile) throw new Error(`No account with user ID "${userId}"`)

    const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password })
    if (updateError) throw new Error(`Could not set the password: ${updateError.message}`)

    console.log(`\n  Password set for ${profile.full_name} (${profile.role})`)
    console.log(`  Sign in at /login with user ID  ${toDisplayUserId(email)}`)
    return
  }

  // --- create ---------------------------------------------------------------
  const role = arg('role')
  const name = arg('name')
  const phoneRaw = arg('phone')
  const vendorCode = arg('vendor-code')
  const locale = arg('locale') ?? 'en'

  if (!role || !ROLES.includes(role as (typeof ROLES)[number])) {
    throw new Error(`--role must be one of: ${ROLES.join(', ')}`)
  }
  if (!name) throw new Error('--name is required')
  if (!isLocale(locale)) throw new Error('--locale must be one of: en, kn, ta, te, hi')
  if (role === 'vendor' && !vendorCode) {
    throw new Error('--vendor-code is required to link the login to a weaver, e.g. HDR')
  }

  // Contact detail now, not a credential — password sign-in replaced phone OTP.
  const phone = phoneRaw ? normalisePhone(phoneRaw) : null
  if (phoneRaw && !phone) throw new Error(`"${phoneRaw}" is not a valid Indian mobile number`)

  // Resolve the weaver first: failing here avoids leaving an orphan auth user.
  let vendorId: string | null = null
  if (vendorCode) {
    const { data: vendor, error } = await admin
      .from('vendors')
      .select('id, display_name')
      .eq('code', vendorCode.toUpperCase())
      .is('deleted_at', null)
      .single()
    if (error || !vendor) throw new Error(`No vendor with code "${vendorCode}"`)
    vendorId = vendor.id
    console.log(`Linking to ${vendor.display_name}`)
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    phone: phone || undefined,
    // Provisioned by someone who has already verified the person, and for a
    // weaver the address is derived rather than real — nothing would ever
    // arrive at it to confirm.
    email_confirm: true,
    phone_confirm: Boolean(phone),
  })
  if (authError || !created.user) {
    throw new Error(`Could not create auth user: ${authError?.message}`)
  }

  const { error: profileError } = await admin.from('app_users').insert({
    id: created.user.id,
    role,
    status: 'active',
    full_name: name,
    email,
    phone: phone || null,
    // Null for a weaver: her language is a property of the WEAVER, written to
    // vendors.default_locale below, so that a second login at the same house
    // inherits it instead of arriving in English. An override here is the
    // exception, and provisioning is not the moment to declare one.
    locale_override: role === 'vendor' ? null : locale,
  })
  if (profileError) {
    // Roll back the auth user so a retry is not blocked by a duplicate.
    await admin.auth.admin.deleteUser(created.user.id)
    throw new Error(`Could not create profile: ${profileError.message}`)
  }

  if (vendorId) {
    const { error } = await admin
      .from('vendor_users')
      .insert({ vendor_id: vendorId, user_id: created.user.id, is_owner: true })
    if (error) {
      await admin.auth.admin.deleteUser(created.user.id)
      throw new Error(`Could not link to vendor: ${error.message}`)
    }

    const { error: localeError } = await admin
      .from('vendors')
      .update({ default_locale: locale })
      .eq('id', vendorId)
    if (localeError) {
      throw new Error(`Linked, but could not set the vendor language: ${localeError.message}`)
    }
    console.log(`  Portal language for this weaver: ${locale}`)
  }

  console.log(`\n  Provisioned ${name} (${role})`)
  console.log(`  Sign in at /login with user ID  ${toDisplayUserId(email)}`)
}

main().catch((err) => {
  console.error(`\n  ${err.message}`)
  process.exit(1)
})
