/**
 * How the reorder pool is ordered. One file, on purpose.
 *
 * 8,903 designs cannot be read in one list and none of them can be filtered
 * away, so they are narrowed by vendor and collection and then SORTED — never
 * dropped. That makes the sort control load-bearing rather than decorative.
 *
 * THE LADDER. The default is no longer a single column. It is four rungs, and
 * within a rung, units sold in the chosen window, descending:
 *
 *   1  sold within the selected window          "Selling"
 *   2  sold within 365 days but not the window  "Slowing"
 *   3  unsold in a year, but stock remains      "In stock, not moving"
 *   4  unsold in a year, no stock               "Dormant"
 *
 * Anything unsold for a year sits at the very bottom. That is the whole point:
 * before this, a saree that sold out yesterday and one that has not sold since
 * 2024 were indistinguishable on the grid, because both read `qty_available: 0`
 * and both looked like proof of demand. Only one of them is.
 *
 * WHY THE RUNG IS A COLUMN. PostgREST cannot put a CASE in an ORDER BY, and a
 * view could not take the window as a parameter. So `tier_30`, `tier_60` and
 * `tier_90` are computed during the sales rollup — see migration 016 — and the
 * whole sort becomes `order by tier_90, units_90d desc`, which one index
 * covers.
 *
 * `seq` remains available as an explicit choice. It is the trailing number in
 * the SKU, so descending is "most recently added first", and it is the right
 * answer when the question is "what have we just started stocking" rather than
 * "what should we make more of".
 */

/** The windows the grid offers. Days, and the column suffix they map to. */
export const WINDOWS = [30, 60, 90] as const
export type Window = (typeof WINDOWS)[number]

export const DEFAULT_WINDOW: Window = 90

export function isWindow(value: unknown): value is Window {
  return WINDOWS.includes(Number(value) as Window)
}

export function resolveWindow(value: string | null | undefined): Window {
  return isWindow(value) ? (Number(value) as Window) : DEFAULT_WINDOW
}

export function unitsColumn(window: Window): 'units_30d' | 'units_60d' | 'units_90d' {
  return `units_${window}d` as 'units_30d' | 'units_60d' | 'units_90d'
}

export function tierColumn(window: Window): 'tier_30' | 'tier_60' | 'tier_90' {
  return `tier_${window}` as 'tier_30' | 'tier_60' | 'tier_90'
}

/** The rung a design sits on, and the badge word that names it. */
export type Tier = 1 | 2 | 3 | 4

export const TIER_KEYS: Record<Tier, 'selling' | 'slowing' | 'inStockNotMoving' | 'dormant'> = {
  1: 'selling',
  2: 'slowing',
  3: 'inStockNotMoving',
  4: 'dormant',
}

export interface SortStrategy {
  label: string
  /**
   * Columns applied in order. The ladder is two: the rung, then the units
   * inside it.
   */
  columns: { column: string; ascending: boolean; nullsFirst: boolean }[]
  /** Off until the data behind it exists. */
  enabled: boolean
  /** Whether the window selector changes what this sort means. */
  windowed: boolean
}

export const SORT_STRATEGIES = {
  /**
   * The default, and the reason Phase 4 exists. Best-selling first, dead stock
   * last, with everything unsold in a year below everything that has sold.
   */
  best_selling: {
    label: 'Best selling first',
    columns: [],
    enabled: true,
    windowed: true,
  },
  /**
   * `seq` is the trailing number in the SKU, runs 1..15,549 across the
   * catalogue and increases over time — so descending is "most recently added
   * first". Free, and available with no sales data at all.
   */
  newest: {
    label: 'Newest first',
    columns: [{ column: 'seq', ascending: false, nullsFirst: false }],
    enabled: true,
    windowed: false,
  },
  oldest: {
    label: 'Oldest first',
    columns: [{ column: 'seq', ascending: true, nullsFirst: false }],
    enabled: true,
    windowed: false,
  },
} as const satisfies Record<string, SortStrategy>

export type SortKey = keyof typeof SORT_STRATEGIES

export const DEFAULT_SORT: SortKey = 'best_selling'

export function isSortKey(value: string | null | undefined): value is SortKey {
  return typeof value === 'string' && value in SORT_STRATEGIES
}

/** The options a sort control should offer today. */
export function availableSorts(): { key: SortKey; label: string }[] {
  return (Object.keys(SORT_STRATEGIES) as SortKey[])
    .filter((k) => SORT_STRATEGIES[k].enabled)
    .map((k) => ({ key: k, label: SORT_STRATEGIES[k].label }))
}

export function resolveSort(value: string | null | undefined): SortKey {
  return isSortKey(value) && SORT_STRATEGIES[value].enabled ? value : DEFAULT_SORT
}

/**
 * Applies a named strategy to a PostgREST query builder.
 *
 * `seq` is appended to every sort as the final tiebreaker. Without it, two
 * designs with identical tier and units come back in whatever order Postgres
 * felt like, which means a design can appear on both page 1 and page 2 of the
 * same grid — or on neither.
 */
export function applySort<
  T extends { order: (col: string, opts: { ascending: boolean; nullsFirst: boolean }) => T },
>(query: T, key: SortKey, window: Window = DEFAULT_WINDOW): T {
  const strategy = SORT_STRATEGIES[key]

  let result = query

  if (strategy.windowed) {
    result = result.order(tierColumn(window), { ascending: true, nullsFirst: false })
    result = result.order(unitsColumn(window), { ascending: false, nullsFirst: false })
  }

  for (const column of strategy.columns) {
    result = result.order(column.column, {
      ascending: column.ascending,
      nullsFirst: column.nullsFirst,
    })
  }

  return result.order('seq', { ascending: false, nullsFirst: false })
}
