/**
 * Issues a login for every weaver, in one pass.
 *
 *   npm run provision:vendors
 *
 * One login per vendor row, with the user ID being the vendor code in
 * lowercase — `hdr` for HDR, `pgw` for pranavgadwal. That is not a convenience:
 * the SKU prefix IS the vendor throughout this system, so the code is the one
 * identifier everybody already knows and writes on things.
 *
 * Passwords are generated here and written to `vendor-logins.local.csv`, which
 * is gitignored. That file is the ONLY readable copy — Supabase stores a hash
 * and nothing prints them again. Hand each weaver her row and delete it.
 *
 * Re-running is safe and non-destructive: a vendor who already has a login is
 * reported and skipped, never given a new password. Rotating one is an explicit
 * act:
 *
 *   npm run provision -- --user-id hdr --password '<new>' --reset-password
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { toAuthEmail, toDisplayUserId } from '../src/lib/auth/user-id'

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
    }
  } catch {
    // Environment may be supplied directly.
  }
}

/**
 * Ambiguous glyphs left out — these get read off a screen and typed on a phone
 * keyboard, and an O that turns out to be a zero is a support call.
 */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join('')
}

const OUTPUT = 'vendor-logins.local.csv'

interface Row {
  code: string
  name: string
  userId: string
  password: string
  status: 'created' | 'already had a login' | 'skipped'
  note?: string
}

async function main() {
  loadEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data: vendors, error } = await admin
    .from('vendors')
    .select('id, code, display_name')
    .is('deleted_at', null)
    .order('code')

  if (error) throw new Error(`Could not read vendors: ${error.message}`)
  if (!vendors?.length) throw new Error('No vendors. Load the catalogue first: npm run seed')

  console.log(`${vendors.length} weavers\n`)

  const rows: Row[] = []

  for (const vendor of vendors) {
    const userId = vendor.code.toLowerCase()
    const name = `${vendor.display_name} owner`
    const email = toAuthEmail(userId)

    if (!email) {
      rows.push({
        code: vendor.code,
        name,
        userId,
        password: '',
        status: 'skipped',
        note: 'vendor code is not a usable user ID',
      })
      console.log(`  ${vendor.code.padEnd(6)} skipped — code is not a usable user ID`)
      continue
    }

    const { data: existing } = await admin
      .from('app_users')
      .select('id')
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle()

    if (existing) {
      rows.push({
        code: vendor.code,
        name,
        userId,
        password: '',
        status: 'already had a login',
        note: 'password unchanged',
      })
      console.log(`  ${vendor.code.padEnd(6)} already had a login, left alone`)
      continue
    }

    const password = generatePassword()

    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      // The address is derived, not real. Nothing is ever sent to it, so there
      // is nothing for the weaver to go and confirm.
      email_confirm: true,
    })
    if (authError || !created.user) {
      throw new Error(`Could not create auth user for ${vendor.code}: ${authError?.message}`)
    }

    // Both records together, and the auth user rolled back if either fails. An
    // auth user with no profile can sign in and then resolve to no session,
    // which is a confusing state to debug.
    const { error: profileError } = await admin.from('app_users').insert({
      id: created.user.id,
      role: 'vendor',
      status: 'active',
      full_name: name,
      email,
      locale: 'en',
    })
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id)
      throw new Error(`Could not create profile for ${vendor.code}: ${profileError.message}`)
    }

    const { error: linkError } = await admin
      .from('vendor_users')
      .insert({ vendor_id: vendor.id, user_id: created.user.id, is_owner: true })
    if (linkError) {
      await admin.auth.admin.deleteUser(created.user.id)
      throw new Error(`Could not link ${vendor.code}: ${linkError.message}`)
    }

    rows.push({ code: vendor.code, name, userId, password, status: 'created' })
    console.log(`  ${vendor.code.padEnd(6)} ${toDisplayUserId(email)}`)
  }

  const csv = [
    'vendor_code,vendor_name,user_id,password,status,note',
    ...rows.map((r) =>
      [r.code, `"${r.name.replace(/"/g, '""')}"`, r.userId, r.password, r.status, r.note ?? ''].join(
        ',',
      ),
    ),
  ].join('\n')

  writeFileSync(OUTPUT, `${csv}\n`, 'utf8')

  const created = rows.filter((r) => r.status === 'created').length
  const existed = rows.filter((r) => r.status === 'already had a login').length
  const skipped = rows.filter((r) => r.status === 'skipped').length

  console.log(`
  ${created} created, ${existed} already had one, ${skipped} skipped

  Passwords written to ${OUTPUT} (gitignored).
  That is the only readable copy — Supabase keeps a hash and nothing prints
  them again. Hand each weaver her row, then delete the file.
`)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
