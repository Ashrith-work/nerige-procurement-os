/**
 * Proves the loader against a throwaway Postgres, with no Supabase project and
 * no network:
 *
 *   npm run seed:verify
 *
 * Boots an embedded Postgres, applies every migration, loads both CSVs and
 * prints the count reconciliation. This is how step 2 is checked, and it is
 * also the fastest way to find out that a migration no longer applies cleanly.
 */
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigrations } from '../tests/harness/db'
import { loadSeed, DuplicateSkuError } from '../src/lib/seed/load'
import { formatReport, formatDuplicateFailure, isConsistent } from '../src/lib/seed/report'

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'nerige-seed-'))
  const port = 54330

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // Same reason as tests/harness/db.ts: initdb otherwise inherits the host
    // locale, which on a Windows machine is WIN1252, and the migrations contain
    // UTF-8 characters with no WIN1252 equivalent. Without this, this script
    // fails on a developer's laptop while passing on Linux CI.
    initdbFlags: ['-E', 'UTF8', '--locale=C'],
  })

  console.log('Booting Postgres')
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('nerige_seed')

  const client = new Client({
    host: 'localhost',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'nerige_seed',
  })
  await client.connect()

  let ok = false
  try {
    console.log('Applying migrations')
    await applyMigrations(client)

    const report = await loadSeed(client, {
      productsCsvPath: join(process.cwd(), '..', 'v2', 'seed_products_full.csv'),
      poolCsvPath: join(process.cwd(), '..', 'v2', 'seed_reorder_pool.csv'),
      allowDuplicateSkus: process.argv.includes('--allow-duplicate-skus'),
      onProgress: (m) => console.log(m),
    })

    console.log(formatReport(report))
    ok = isConsistent(report)
    if (!ok) console.error('Loaded data is inconsistent with the supplied reorder pool.')
  } catch (err) {
    if (err instanceof DuplicateSkuError) {
      console.error(formatDuplicateFailure(err))
    } else {
      throw err
    }
  } finally {
    await client.end()
    await pg.stop()
    await rm(dataDir, { recursive: true, force: true })
  }

  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
