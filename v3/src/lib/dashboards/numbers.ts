import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_PERIOD_DAYS,
  addDays,
  daysBetween,
  todayInWarehouse,
  type IsoDate,
} from '@/lib/performance/period'

/**
 * The two analyses `/numbers` adds to the insights query it already shares:
 * which designs moved, and what the shelves look like right now.
 *
 * NEITHER DUPLICATES `insights_summary`. The headline figures, the breakdown
 * and the daily line all come from `loadInsights`, unchanged, so the Numbers
 * screen and the sales analysis can never disagree about a period. What is
 * genuinely absent there is the design level — `insights_breakdown` groups by
 * vendor, collection, fabric and colour, and there is deliberately no SKU
 * grouping, because 10,149 buckets is not a table anybody reads.
 *
 * SO MOVERS READ THE ROLLED-UP WINDOWS. `products.units_30d … units_365d` are
 * maintained by the sales sync (migration 019). They are fixed windows, not the
 * arbitrary range the period selector allows, so the screen picks the nearest
 * one and says which it used rather than quietly re-labelling 90 days as 74.
 * The alternative — aggregating `sku_sales_daily` per SKU in TypeScript — is a
 * year of daily rows across ten thousand designs pulled through a serverless
 * function to sort eight of them.
 *
 * Errors throw. A "nothing sold" list produced by a failed query is a lie about
 * the catalogue, and it is the kind that gets acted on.
 */

export const MOVER_WINDOWS = [30, 60, 90, 365] as const
export type MoverWindow = (typeof MOVER_WINDOWS)[number]

/** How many designs each list shows. Short on purpose: this is a glance, not a report. */
const LIST_SIZE = 8

/** The rolled-up window closest to the period on screen. */
export function nearestMoverWindow(days: number): MoverWindow {
  return MOVER_WINDOWS.reduce((best, w) =>
    Math.abs(w - days) < Math.abs(best - days) ? w : best,
  )
}

export function unitsColumn(window: MoverWindow): string {
  return `units_${window}d`
}

export interface Mover {
  sku: string
  title: string | null
  units: number
  qtyAvailable: number
}

export interface Movers {
  window: MoverWindow
  /** Most units in the window, best first. */
  best: Mover[]
  /** Still on the shelf, nothing sold in the window, deepest stock first. */
  slow: Mover[]
  /** The stock figures behind both lists, as an ISO timestamp. */
  stockSyncedAt: string | null
}

interface ProductRow {
  sku: string
  title: string | null
  qty_available: number | null
  stock_synced_at: string | null
  [units: string]: unknown
}

function toMover(row: ProductRow, column: string): Mover {
  return {
    sku: row.sku,
    title: row.title,
    units: Number(row[column] ?? 0),
    qtyAvailable: row.qty_available ?? 0,
  }
}

export async function loadMovers(supabase: SupabaseClient, window: MoverWindow): Promise<Movers> {
  const column = unitsColumn(window)
  const select = `sku, title, qty_available, stock_synced_at, ${column}`

  const [best, slow] = await Promise.all([
    supabase
      .from('products')
      .select(select)
      .eq('is_active', true)
      .gt(column, 0)
      .order(column, { ascending: false })
      .limit(LIST_SIZE),
    // Sitting on stock: pieces on the shelf and not one of them moved in the
    // window. Ordered by how many are sitting, because ten unsold is a
    // different conversation from one.
    supabase
      .from('products')
      .select(select)
      .eq('is_active', true)
      .eq(column, 0)
      .gt('qty_available', 0)
      .order('qty_available', { ascending: false })
      .limit(LIST_SIZE),
  ])

  const failed = [best, slow].find((r) => r.error)?.error
  if (failed) throw new Error(`Could not load the movers: ${failed.message}`)

  const bestRows = (best.data ?? []) as unknown as ProductRow[]
  const slowRows = (slow.data ?? []) as unknown as ProductRow[]

  return {
    window,
    best: bestRows.map((r) => toMover(r, column)),
    slow: slowRows.map((r) => toMover(r, column)),
    stockSyncedAt: [...bestRows, ...slowRows].find((r) => r.stock_synced_at)?.stock_synced_at ?? null,
  }
}

/**
 * The team's output for a period: total target-days of work over total days
 * present, counting only people with targeted work.
 *
 * Summed, not averaged. Averaging each person's ratio would let a half day
 * count for as much as a full one, and the figure would move when somebody took
 * an afternoon off. Null when nobody was in, which is not zero output.
 */
export function teamOutput(people: { output: { targetDays: number; ratio: number | null }; attendanceDays: number }[]): number | null {
  let targetDays = 0
  let attendanceDays = 0
  for (const p of people) {
    if (p.output.ratio === null) continue
    targetDays += p.output.targetDays
    attendanceDays += p.attendanceDays
  }
  return attendanceDays > 0 ? targetDays / attendanceDays : null
}

export interface StaffRange {
  from: IsoDate
  to: IsoDate
  /** True when the screen's period had to be cut to fit. Say so rather than silently re-labelling. */
  clamped: boolean
}

/**
 * The staff period, from the period on screen.
 *
 * Two clamps, both of them the review's own rules rather than new ones. The
 * sheet is never read past today, because a period that includes tomorrow shows
 * tomorrow as a day the manager failed to fill in; and it is never longer than
 * `MAX_PERIOD_DAYS`, because a year of counts for six people on eight tasks is
 * tens of thousands of rows to answer a summary. The recent end is the end
 * anybody is asking about, so the start is what gives way.
 */
export function staffRange(from: IsoDate, to: IsoDate, today: IsoDate = todayInWarehouse()): StaffRange {
  const end = to > today ? today : to
  let start = from > end ? end : from
  const clamped = end !== to || daysBetween(start, end) + 1 > MAX_PERIOD_DAYS

  if (daysBetween(start, end) + 1 > MAX_PERIOD_DAYS) start = addDays(end, -(MAX_PERIOD_DAYS - 1))

  return { from: start, to: end, clamped }
}

export interface StockGlance {
  /** Designs Shopify still returns. The catalogue as it stands. */
  designs: number
  /** Sold out or down to the last piece — the reorder pool, by the same rule the grid uses. */
  reorderPool: number
  /** Oversold: pieces owed that do not exist. Sold out, and then some. */
  oversold: number
}

/**
 * Three counts, no rows. Head-only, so the glance costs three tiny queries
 * rather than a download of the catalogue.
 *
 * `qty_available <= 1` is the reorder pool exactly as `/reorder` defines it
 * (migration 029), so the number here and the number on that screen are the
 * same number rather than two readings of the same idea.
 */
export async function loadStockGlance(supabase: SupabaseClient): Promise<StockGlance> {
  const head = () => supabase.from('products').select('sku', { count: 'exact', head: true }).eq('is_active', true)

  const [designs, pool, oversold] = await Promise.all([
    head(),
    head().lte('qty_available', 1),
    head().lt('qty_available', 0),
  ])

  const failed = [designs, pool, oversold].find((r) => r.error)?.error
  if (failed) throw new Error(`Could not count the catalogue: ${failed.message}`)

  return {
    designs: designs.count ?? 0,
    reorderPool: pool.count ?? 0,
    oversold: oversold.count ?? 0,
  }
}
