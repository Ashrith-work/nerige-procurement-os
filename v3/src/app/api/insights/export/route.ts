import { type NextRequest } from 'next/server'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { loadInsights } from '@/lib/insights/query'
import { resolveRange, toCsv, type Filters } from '@/lib/insights/model'

/**
 * The breakdown table, as a file.
 *
 * It re-runs the same query function the screen does rather than serialising
 * whatever rows were rendered. That is the difference between an export and a
 * screenshot: the day somebody adds pagination to that table, a client-side
 * serialisation would quietly export one page and still be called "Export CSV".
 *
 * `requireProcurement()` first. This is every weaver's revenue in one file.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  await requireProcurement()

  const params = request.nextUrl.searchParams
  const range = resolveRange({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    days: params.get('days') ?? undefined,
  })

  const filters: Filters = {
    from: range.from,
    to: range.to,
    vendors: params.getAll('vendor'),
    collections: params.getAll('collection'),
    fabrics: params.getAll('fabric'),
    colours: params.getAll('colour'),
  }

  const supabase = await createClient()
  const { breakdown, groupBy } = await loadInsights(supabase, filters)

  const csv = toCsv(breakdown, groupBy)
  const name = `nerige-${groupBy}-${range.from}-to-${range.to}.csv`

  return new Response(
    // A BOM, so Excel opens it as UTF-8. Without it, a collection name in
    // Kannada or a ₹ arrives as mojibake in the one application these files are
    // actually opened in.
    `﻿${csv}`,
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}
