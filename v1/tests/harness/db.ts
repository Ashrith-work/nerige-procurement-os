/**
 * Test harness: a real Postgres instance with every migration applied.
 *
 * Why a real Postgres and not a mock: the thing under test IS the database.
 * Row Level Security, SECURITY DEFINER search_path pinning, CHECK constraints
 * and triggers have no meaningful mock. A test double would verify our
 * assumptions about Postgres rather than Postgres itself.
 *
 * Why role switching matters: a superuser bypasses RLS unconditionally, even
 * with FORCE ROW LEVEL SECURITY set. A suite that ran as the bootstrap user
 * would pass every isolation assertion while production leaked. `asUser()`
 * therefore always SET ROLE authenticated before running anything.
 */
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Vitest runs from the repo root, so cwd is stable and avoids the
// __dirname/import.meta divergence between CJS and ESM transpilation.
const REPO_ROOT = process.cwd()
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations')
const SHIM = join(REPO_ROOT, 'supabase', 'tests', '00_supabase_shim.sql')

export interface TestDb {
  client: Client
  /** Run `fn` impersonating an authenticated user, exactly as PostgREST would. */
  asUser<T>(userId: string, fn: (c: Client) => Promise<T>): Promise<T>
  /** Run `fn` with no session — the `anon` role. */
  asAnon<T>(fn: (c: Client) => Promise<T>): Promise<T>
  /** Privileged escape hatch for fixture setup. Never used inside assertions. */
  asAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T>
  stop(): Promise<void>
}

let singleton: Promise<TestDb> | null = null

async function boot(): Promise<TestDb> {
  const dataDir = await mkdtemp(join(tmpdir(), 'nerige-pg-'))
  // Deterministic-but-unusual port keeps parallel local runs off 5432.
  const port = 54329

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase('nerige_test')

  const client = new Client({
    host: 'localhost',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'nerige_test',
  })
  await client.connect()

  // Supabase-provided objects first, then our migrations in filename order.
  await client.query(await readFile(SHIM, 'utf8'))

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await client.query(sql)
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
    }
  }

  const withRole = async <T,>(
    role: string,
    userId: string | null,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> => {
    // A transaction scopes SET LOCAL, so role and JWT claim cannot leak into
    // the next test through the shared connection.
    await client.query('begin')
    try {
      await client.query(`set local role ${role}`)
      if (userId) {
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
        await client.query("select set_config('request.jwt.claim.role', $1, true)", [role])
      }
      return await fn(client)
    } finally {
      await client.query('rollback')
    }
  }

  return {
    client,
    asUser: (userId, fn) => withRole('authenticated', userId, fn),
    asAnon: (fn) => withRole('anon', null, fn),
    asAdmin: async (fn) => fn(client),
    stop: async () => {
      await client.end()
      await pg.stop()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

export function getTestDb(): Promise<TestDb> {
  singleton ??= boot()
  return singleton
}
