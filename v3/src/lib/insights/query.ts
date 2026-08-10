import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  nextLevel,
  type BreakdownRow,
  type DailyPoint,
  type Filters,
  type GroupBy,
  type Summary,
} from './model'

/**
 * The insights dashboard's one query.
 *
 * Written once and shared by the screen and the CSV export, so an exported file
 * can never disagree with the table it was exported from — which is the whole
 * point of an export and the thing that quietly stops being true when the two
 * are built separately.
 *
 * The vocabulary — types, presets, `resolveRange`, `toCsv` — lives in
 * `model.ts` because the filter bar is a client component and needs it. Only
 * the part that touches a database is `server-only`.
 */

/** Postgres array arguments want null, not an empty array, to mean "no filter". */
function orNull(values: string[]): string[] | null {
  return values.length > 0 ? values : null
}

function args(filters: Filters) {
  return {
    p_from: filters.from,
    p_to: filters.to,
    p_vendors: orNull(filters.vendors),
    p_collections: orNull(filters.collections),
    p_fabrics: orNull(filters.fabrics),
    p_colours: orNull(filters.colours),
  }
}

export async function loadInsights(
  db: SupabaseClient,
  filters: Filters,
): Promise<{
  summary: Summary
  breakdown: BreakdownRow[]
  daily: DailyPoint[]
  groupBy: GroupBy
}> {
  const groupBy = nextLevel(filters)

  const [summaryResult, breakdownResult, dailyResult] = await Promise.all([
    db.rpc('insights_summary', args(filters)),
    db.rpc('insights_breakdown', { p_group_by: groupBy, ...args(filters) }),
    db.rpc('insights_daily', args(filters)),
  ])

  // A single-row set-returning function comes back as an array of one.
  const summary = (
    Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
  ) as Summary | null

  return {
    summary: summary ?? {
      orders_placed: 0,
      units_sold: 0,
      products_sold: 0,
      units_on_hand: 0,
      sell_through: null,
      revenue: 0,
    },
    breakdown: (breakdownResult.data ?? []) as BreakdownRow[],
    daily: (dailyResult.data ?? []) as DailyPoint[],
    groupBy,
  }
}
