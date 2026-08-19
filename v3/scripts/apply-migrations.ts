/**
 * Applies the migrations a database is missing, and nothing else.
 *
 *   npm run migrate -- --dry-run     # say what would run, change nothing
 *   npm run migrate                  # apply what is missing
 *
 * This exists because `npm run setup` cannot do it. Its migration step asks
 * whether `order_line_refs` exists and, if it does, skips the whole directory —
 * correct for the empty project it was written for, and exactly wrong for a
 * project that is eight migrations old and needs the ninth. A database that has
 * been live for a week takes the skip branch and silently stays behind.
 *
 * There is no schema_migrations table in this project, so "has this one run?"
 * cannot be looked up. It is answered by running the file and watching what
 * Postgres says:
 *
 *   - it succeeds                 -> it had not run; committed
 *   - it fails as a duplicate     -> it had already run; rolled back
 *   - it fails any other way      -> stop, and print the file and the message
 *
 * Every file runs inside its own transaction, so the rollback in the second case
 * leaves nothing behind, and a genuine failure in the third leaves the database
 * exactly as it was before that file started. Postgres runs DDL transactionally,
 * which is the whole reason this approach is safe here and would not be on MySQL.
 *
 * A file that is *partially* present — someone applied half of it by hand in the
 * SQL editor — reports as a duplicate and is skipped. That is not a case this can
 * fix, and it is why --dry-run prints the whole plan first.
 */
import { Client } from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Postgres codes that all mean "this object is already there". */
const ALREADY_THERE = new Set([
  '42P07', // duplicate_table (also index, view, sequence)
  '42710', // duplicate_object (also policy, trigger, constraint)
  '42701', // duplicate_column
  '42723', // duplicate_function
  '42P06', // duplicate_schema
  '42P13', // duplicate_prepared_statement / signature clash on replace
])

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

type Outcome = 'applied' | 'already' | 'would-apply'

async function main() {
  loadEnv()

  const dryRun = process.argv.includes('--dry-run')

  const databaseUrl = process.env.DATABASE_URL
  // The literal line from .env.example, and nothing more. An earlier version of
  // this rejected any localhost URL, which also rejects a throwaway Postgres on
  // a random port — the one database it is safe to practise against.
  const UNEDITED = 'postgres://postgres:postgres@localhost:5432/postgres'
  if (!databaseUrl || databaseUrl === UNEDITED || /placeholder|YOUR-PROJECT/i.test(databaseUrl)) {
    throw new Error(
      'DATABASE_URL is missing or still a placeholder.\n' +
        "Supabase: Project Settings -> Database -> Connection string, session mode, port 5432.\n" +
        'The 6543 pooler cannot run DDL. Percent-encode any @ in the password as %40.',
    )
  }

  const db = new Client({ connectionString: databaseUrl })
  await db.connect()

  try {
    // The migrations write tables with RLS forced and no INSERT policy, and
    // create objects in the private `app` schema. Find out now whether this role
    // can do that, rather than four files in.
    const { rows } = await db.query<{ user: string; bypass: boolean; superuser: boolean }>(
      `select current_user as user,
              coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass,
              coalesce((select rolsuper    from pg_roles where rolname = current_user), false) as superuser`,
    )
    const { user, bypass, superuser } = rows[0]
    console.log(`Connected as ${user} (bypassrls: ${bypass}, superuser: ${superuser})`)
    if (!bypass && !superuser) {
      throw new Error(
        `${user} can neither bypass RLS nor is superuser. Use the project's postgres connection string.`,
      )
    }

    const dir = join(process.cwd(), 'supabase', 'migrations')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    console.log(`\n${files.length} migration files, in filename order.`)
    if (dryRun) console.log('DRY RUN — every transaction is rolled back, nothing is committed.\n')
    else console.log('')

    const results: Array<{ file: string; outcome: Outcome }> = []

    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8')
      await db.query('begin')
      try {
        await db.query(sql)
        if (dryRun) {
          await db.query('rollback')
          results.push({ file, outcome: 'would-apply' })
          console.log(`  WOULD APPLY  ${file}`)
        } else {
          await db.query('commit')
          results.push({ file, outcome: 'applied' })
          console.log(`  APPLIED      ${file}`)
        }
      } catch (err) {
        await db.query('rollback')
        const code = (err as { code?: string }).code
        if (code && ALREADY_THERE.has(code)) {
          results.push({ file, outcome: 'already' })
          console.log(`  already      ${file}`)
        } else {
          console.error(`\n  FAILED       ${file}`)
          console.error(`  ${code ?? 'no code'}: ${(err as Error).message}`)
          console.error('\n  Rolled back. The database is as it was before this file started.')
          throw new Error(`${file} failed`)
        }
      }
    }

    const applied = results.filter((r) => r.outcome === 'applied').length
    const would = results.filter((r) => r.outcome === 'would-apply').length
    const already = results.filter((r) => r.outcome === 'already').length

    console.log('')
    if (dryRun) {
      console.log(`${would} to apply, ${already} already present.`)
      if (would > 0) console.log('Re-run without --dry-run to apply them.')
    } else {
      console.log(`${applied} applied, ${already} already present.`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`)
  process.exit(1)
})
