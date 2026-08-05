/**
 * Takes an empty Supabase project to a portal you can sign into.
 *
 *   npm run setup
 *
 * Reads everything from .env.local and never prints a secret. Each phase says
 * what it did, and re-running is safe: migrations that have already been applied
 * are detected, the loader upserts, and logins that exist are left alone.
 *
 *   1. migrations   — the 9 files in supabase/migrations, in order
 *   2. catalogue    — 9,827 designs and 50 weavers from the v2 exports
 *   3. logins       — Pooja, and an owner login for one weaver
 *   4. one order    — so there is something to look at on both sides
 */
import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadSeed } from '../src/lib/seed/load'
import { formatReport, isConsistent } from '../src/lib/seed/report'
import { seedDemoOrder } from '../src/lib/seed/demo-order'
import { normalisePhone } from '../src/lib/auth/phone'

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {
    // Supplied directly via the shell.
  }
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function required(name: string): string {
  const v = process.env[name]
  if (!v || /placeholder|YOUR-PROJECT/i.test(v)) {
    throw new Error(`${name} is missing or still a placeholder in .env.local`)
  }
  return v
}

const step = (n: number, what: string) => console.log(`\n[${n}/4] ${what}`)

async function main() {
  loadEnv()

  const databaseUrl = required('DATABASE_URL')
  const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
  required('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  const vendorCode = (flag('vendor') ?? 'HDR').toUpperCase()
  const poojaEmail = flag('email') ?? 'pooja@nerigestory.com'
  /**
   * The weaver gets an email as well as a phone.
   *
   * Phone OTP is how she signs in for real, but that needs an SMS provider
   * configured in Supabase, which is a paid account and a DLT registration in
   * India. A vendor row may carry both identifiers — only the internal role is
   * required to have an email — and the ROLE comes from app_users either way,
   * so signing in by magic link lands on /portal exactly as the phone code
   * would. It is the same session; only the proof of identity differs.
   */
  const weaverEmail = flag('vendor-email') ?? 'weaver@nerigestory.com'
  const weaverPhone = flag('phone') ?? '9876543210'
  const locale = flag('locale') ?? 'en'

  const db = new Client({ connectionString: databaseUrl })
  await db.connect()

  try {
    // --- preflight ------------------------------------------------------------
    // The loader writes `products`, which has no INSERT policy by design and
    // RLS forced. That only works from a role allowed to bypass it, so find out
    // now rather than 9,000 rows in.
    const who = await db.query<{ user: string; bypass: boolean; superuser: boolean }>(
      `select current_user as user,
              coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass,
              coalesce((select rolsuper    from pg_roles where rolname = current_user), false) as superuser`,
    )
    const { user, bypass, superuser } = who.rows[0]
    console.log(`Connected as ${user} (bypassrls: ${bypass}, superuser: ${superuser})`)
    if (!bypass && !superuser) {
      throw new Error(
        `${user} can neither bypass nor is superuser, so the loader cannot write products ` +
          `(RLS is forced and there is no INSERT policy). Use the project's postgres connection string.`,
      )
    }

    // --- 1. migrations --------------------------------------------------------
    step(1, 'Applying migrations')
    const dir = join(process.cwd(), 'supabase', 'migrations')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

    const already = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.tables
        where table_schema = 'public' and table_name = 'order_line_refs'`,
    )
    if (Number(already.rows[0].n) > 0) {
      console.log('   Schema already present, skipping. Reset the database to re-apply.')
    } else {
      for (const file of files) {
        try {
          await db.query(await readFile(join(dir, file), 'utf8'))
          console.log(`   ${file}`)
        } catch (err) {
          throw new Error(`${file} failed: ${(err as Error).message}`)
        }
      }
    }

    // --- 2. catalogue ---------------------------------------------------------
    step(2, 'Loading the catalogue')
    const report = await loadSeed(db, {
      productsCsvPath: join(process.cwd(), '..', 'v2', 'seed_products_full.csv'),
      poolCsvPath: join(process.cwd(), '..', 'v2', 'seed_reorder_pool.csv'),
      // The current export repeats two SKUs. Named here rather than hidden, and
      // both are printed in the report below.
      allowDuplicateSkus: true,
      onProgress: (m) => console.log(`   ${m}`),
    })
    console.log(formatReport(report))
    if (!isConsistent(report)) throw new Error('The load did not reproduce the supplied pool.')

    // --- 3. logins ------------------------------------------------------------
    step(3, 'Provisioning logins')
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const phone = normalisePhone(weaverPhone)
    if (!phone) throw new Error(`"${weaverPhone}" is not a valid Indian mobile number`)

    const vendor = await db.query<{ id: string; display_name: string }>(
      `select id, display_name from vendors where code = $1 and deleted_at is null`,
      [vendorCode],
    )
    if (vendor.rowCount === 0) throw new Error(`No vendor with code "${vendorCode}"`)

    await provision(admin, db, {
      role: 'procurement_head',
      name: 'Pooja',
      email: poojaEmail,
      locale: 'en',
    })
    await provision(admin, db, {
      role: 'vendor',
      name: `${vendor.rows[0].display_name} owner`,
      email: weaverEmail,
      phone,
      locale,
      vendorId: vendor.rows[0].id,
    })

    // --- 4. one order ---------------------------------------------------------
    step(4, 'Seeding one order')
    const existing = await db.query<{ n: string }>('select count(*)::text as n from orders')
    if (Number(existing.rows[0].n) > 0) {
      console.log('   Orders already exist, skipping.')
    } else {
      const { rows } = await db.query<{ id: string }>(
        `select id from app_users where role = 'procurement_head' and deleted_at is null limit 1`,
      )
      const demo = await seedDemoOrder(db, { vendorCode, createdBy: rows[0]?.id ?? null })
      console.log(
        `   ${demo.orderNumber} — ${demo.vendorName} / ${demo.collection}, ` +
          `${demo.restockSkus.length} restock + 1 new design`,
      )
    }

    console.log(`
Done. One thing left, in the Supabase dashboard:

  Authentication -> URL Configuration
     add  ${process.env.NEXT_PUBLIC_APP_URL}/auth/callback  to the redirect allow list

Then  npm run dev  and sign in on the "Nerige team" tab with either address.
Both arrive by email link; neither needs an SMS provider.

  ${poojaEmail.padEnd(28)} Pooja      -> /reorder
  ${weaverEmail.padEnd(28)} the weaver -> /portal

The weaver also has ${phone} on her record, which is how she would really sign
in once Authentication -> Providers -> Phone has an SMS provider behind it.
`)
  } finally {
    await db.end()
  }
}

/** Only the admin surface this script uses; the full generic type is unhelpful here. */
type Admin = {
  auth: {
    admin: {
      createUser: (attrs: {
        email?: string
        phone?: string
        email_confirm?: boolean
        phone_confirm?: boolean
      }) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      deleteUser: (id: string) => Promise<unknown>
    }
  }
}

async function provision(
  admin: Admin,
  db: Client,
  opts: {
    role: 'procurement_head' | 'vendor'
    name: string
    email?: string
    phone?: string
    locale: string
    vendorId?: string
  },
) {
  const label = opts.email ?? opts.phone ?? opts.name

  const existing = await db.query<{ id: string }>(
    `select id from app_users
      where deleted_at is null
        and ((email is not null and email = $1) or (phone is not null and phone = $2))`,
    [opts.email ?? null, opts.phone ?? null],
  )
  if (existing.rowCount && existing.rowCount > 0) {
    console.log(`   ${label} already exists, leaving it alone`)
    return
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    phone: opts.phone,
    // Provisioned by someone who has already verified the person. Without this
    // the account cannot sign in until it confirms itself, which for phone OTP
    // is a chicken-and-egg problem.
    email_confirm: Boolean(opts.email),
    phone_confirm: Boolean(opts.phone),
  })
  if (error || !data.user) throw new Error(`Could not create ${label}: ${error?.message}`)

  try {
    await db.query(
      `insert into app_users (id, role, status, full_name, email, phone, locale)
       values ($1, $2::app_role, 'active', $3, $4, $5, $6)`,
      [data.user.id, opts.role, opts.name, opts.email ?? null, opts.phone ?? null, opts.locale],
    )
    if (opts.vendorId) {
      await db.query(
        `insert into vendor_users (vendor_id, user_id, is_owner) values ($1, $2, true)`,
        [opts.vendorId, data.user.id],
      )
    }
  } catch (err) {
    // Roll back the auth user so a retry is not blocked by a duplicate.
    await admin.auth.admin.deleteUser(data.user.id)
    throw err
  }

  console.log(`   ${label} provisioned as ${opts.role}`)
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
})
