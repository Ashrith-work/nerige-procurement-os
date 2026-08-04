/**
 * Provisions a user. The ONE legitimate use of the service-role key.
 *
 * Creating an auth.users row cannot be expressed under RLS, so it happens here
 * rather than in application code. Both records are written together — an
 * auth user with no app_users profile can authenticate but resolves to no
 * session, which is a confusing state to debug.
 *
 * Usage:
 *   npm run provision -- --role founder --name "Ashrith" --email ashrith@nerigestory.com
 *   npm run provision -- --role vendor  --name "Shan Owner" --phone 9876543210 --vendor-code SHAN
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { normalisePhone } from '../src/lib/validation/india'

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

async function main() {
  loadEnv()

  const role = arg('role')
  const name = arg('name')
  const email = arg('email')
  const phoneRaw = arg('phone')
  const vendorCode = arg('vendor-code')

  const VALID_ROLES = ['founder', 'procurement_head', 'warehouse_manager', 'vendor']
  if (!role || !VALID_ROLES.includes(role)) {
    throw new Error(`--role must be one of: ${VALID_ROLES.join(', ')}`)
  }
  if (!name) throw new Error('--name is required')

  if (role === 'vendor') {
    if (!phoneRaw) throw new Error('Vendors sign in by phone OTP, so --phone is required')
    if (!vendorCode) throw new Error('--vendor-code is required to link the login to an organisation')
  } else if (!email) {
    throw new Error('Internal staff sign in by email magic link, so --email is required')
  }

  const phone = phoneRaw ? normalisePhone(phoneRaw) : null
  if (phoneRaw && !phone) throw new Error(`"${phoneRaw}" is not a valid Indian mobile number`)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

  const admin = createClient(url, key, { auth: { persistSession: false } })

  // Resolve the vendor first: failing here avoids leaving an orphan auth user.
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
    console.log(`Linking to vendor: ${vendor.display_name}`)
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: email || undefined,
    phone: phone || undefined,
    // Provisioned by a trusted operator who has already verified the person.
    // Without this the account cannot sign in until it confirms itself, which
    // for phone OTP is a chicken-and-egg problem.
    email_confirm: Boolean(email),
    phone_confirm: Boolean(phone),
  })
  if (authError || !created.user) throw new Error(`Could not create auth user: ${authError?.message}`)

  const { error: profileError } = await admin.from('app_users').insert({
    id: created.user.id,
    role,
    status: 'active',
    full_name: name,
    email: email || null,
    phone: phone || null,
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
    if (error) throw new Error(`Could not link to vendor: ${error.message}`)
  }

  console.log(`\n✓ Provisioned ${name} (${role})`)
  console.log(`  Sign in at /login using ${email ?? phone}`)
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  process.exit(1)
})
