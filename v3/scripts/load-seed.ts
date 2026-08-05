/**
 * Loads the seed CSVs into a real database.
 *
 *   npm run seed                     # uses DATABASE_URL
 *   npm run seed -- --as-of 2026-08-01T00:00:00Z
 *
 * Connects as the database owner, which bypasses RLS. That is why bulk loading
 * lives in a script and never in an application code path — no page, action or
 * route handler ever holds a connection that can write `products`.
 */
import { Client } from 'pg'
import { join } from 'node:path'
import { loadSeed, DuplicateSkuError } from '../src/lib/seed/load'
import { formatReport, formatDuplicateFailure, isConsistent } from '../src/lib/seed/report'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const url = flag('database-url') ?? process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.')
    process.exit(1)
  }

  const seedDir = flag('seed-dir') ?? join(process.cwd(), '..', 'v2')
  const asOf = flag('as-of')
  const allowDuplicateSkus = process.argv.includes('--allow-duplicate-skus')

  const client = new Client({ connectionString: url })
  await client.connect()

  try {
    const report = await loadSeed(client, {
      productsCsvPath: join(seedDir, 'seed_products_full.csv'),
      poolCsvPath: join(seedDir, 'seed_reorder_pool.csv'),
      stockAsOf: asOf ? new Date(asOf) : undefined,
      allowDuplicateSkus,
      onProgress: (m) => console.log(m),
    })

    console.log(formatReport(report))

    if (!isConsistent(report)) {
      console.error('Loaded data is inconsistent with the supplied reorder pool.')
      process.exit(1)
    }
  } catch (err) {
    if (err instanceof DuplicateSkuError) {
      console.error(formatDuplicateFailure(err))
      process.exit(1)
    }
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
