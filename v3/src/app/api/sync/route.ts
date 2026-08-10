import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSync, type SyncKind } from '@/lib/shopify/run-sync'

/**
 * The scheduled sync. Called by Vercel Cron every thirty minutes.
 *
 * This is the one route in the application that runs with no user session, so
 * it is also the one that has to prove it is the scheduler. Vercel signs cron
 * invocations with `CRON_SECRET` in the Authorization header; anything else is
 * refused before it can cost a Shopify bulk operation.
 *
 * The comparison is `timingSafeEqual`. A plain `===` on a secret leaks its
 * length and, byte by byte over enough requests, its contents — and this
 * endpoint is public by necessity, so it is exactly the kind of thing that gets
 * hammered.
 *
 * It uses the service-role client, which is unavoidable and deliberate: there
 * is no user here to run as, and the sync RPCs check `app.is_internal()` which
 * a session-less request can never satisfy. The blast radius is bounded by this
 * file doing nothing except calling those two RPCs.
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // No secret configured means no scheduled sync. Refusing is the safe default:
  // the alternative is an open endpoint that starts Shopify bulk operations.
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 })
  }

  const requested = request.nextUrl.searchParams.get('kind')
  const kinds: SyncKind[] =
    requested === 'shopify_orders'
      ? ['shopify_orders']
      : requested === 'shopify_products'
        ? ['shopify_products']
        // Products first, then sales. The sales table has a foreign key onto
        // `products`, so a SKU that appeared in Shopify this morning has to
        // exist before its sales can be written — the other order silently
        // drops the first day of a new design's sales.
        : ['shopify_products', 'shopify_orders']

  const db = createAdminClient()
  const results = []

  for (const kind of kinds) {
    const result = await runSync(db, kind)
    results.push({ kind, ...result })

    // A failed product sync means the sales sync has nothing sound to hang off.
    if (result.status === 'failed') break
  }

  const failed = results.some((r) => r.status === 'failed')

  // 500 on failure so the platform's own cron monitoring shows it. A sync that
  // reports 200 while having written nothing is how three days of staleness
  // goes unnoticed.
  return NextResponse.json({ results }, { status: failed ? 500 : 200 })
}
