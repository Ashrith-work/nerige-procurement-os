/**
 * Creates one order so the vendor screen has something to show.
 *
 *   npm run seed:order
 *   npm run seed:order -- --vendor PGW --collection BRHM
 *
 * Runs against DATABASE_URL as the owner, which bypasses RLS — issuing orders
 * is Pooja's job and arrives in step 6. This is scaffolding for looking at the
 * screen, not a code path anyone signs into.
 */
import { Client } from 'pg'
import { seedDemoOrder } from '../src/lib/seed/demo-order'

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

  const client = new Client({ connectionString: url })
  await client.connect()

  try {
    // Attribute it to Pooja if she has been provisioned; the column is nullable
    // and an unattributed demo order is better than a failed one.
    const { rows } = await client.query(
      `select id from app_users where role = 'procurement_head' and deleted_at is null limit 1`,
    )

    const result = await seedDemoOrder(client, {
      vendorCode: flag('vendor'),
      collection: flag('collection'),
      createdBy: rows[0]?.id ?? null,
    })

    console.log(`\n  ${result.orderNumber} — ${result.vendorName} (${result.vendorCode})`)
    console.log(`  Collection ${result.collection}`)
    console.log(`  ${result.restockSkus.length} restock lines, 1 new design line`)
    console.log(`  restock:    ${result.restockSkus.slice(0, 3).join(', ')} …`)
    console.log(`  references: ${result.referenceSkus.join(', ')}`)
    console.log(`\n  Open /portal/orders/${result.orderId}\n`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(`\n  ${err.message}`)
  process.exit(1)
})
