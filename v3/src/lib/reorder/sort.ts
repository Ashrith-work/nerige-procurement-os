/**
 * How the reorder pool is ordered. One file, on purpose.
 *
 * 8,903 designs cannot be read in one list and none of them can be filtered
 * away, so they are narrowed by vendor and collection and then SORTED — never
 * dropped. That makes the sort control load-bearing rather than decorative.
 *
 * A sales ranking file is coming from EasyEcom SKU Performance. When it lands it
 * becomes `products.sales_rank` and a new option here, "fastest selling first".
 * That entry is already written below with `enabled: false`. Turning it on is
 * one boolean in this file — no new component, no change to the page, no
 * refactor. That is the whole reason this registry exists rather than an
 * `order by` written inline at the call site.
 */

export interface SortStrategy {
  label: string
  /** Column on `products`. */
  column: string
  ascending: boolean
  /** Rows with a null sort value go last, so an unranked design never leads. */
  nullsFirst: boolean
  /** Off until the data behind it exists. */
  enabled: boolean
}

export const SORT_STRATEGIES = {
  /**
   * The default. `seq` is the trailing number in the SKU, runs 1..15,549 across
   * the catalogue and increases over time — so descending is "most recently
   * added first". Free, and available today.
   */
  newest: {
    label: 'Newest first',
    column: 'seq',
    ascending: false,
    nullsFirst: false,
    enabled: true,
  },
  oldest: {
    label: 'Oldest first',
    column: 'seq',
    ascending: true,
    nullsFirst: false,
    enabled: true,
  },
  /**
   * Waiting on the EasyEcom SKU Performance export. `sales_rank` is nullable and
   * null everywhere today, which is exactly why this is off: an option that
   * sorts every row identically looks broken.
   */
  fastest_selling: {
    label: 'Fastest selling first',
    column: 'sales_rank',
    ascending: true,
    nullsFirst: false,
    enabled: false,
  },
} as const satisfies Record<string, SortStrategy>

export type SortKey = keyof typeof SORT_STRATEGIES

export const DEFAULT_SORT: SortKey = 'newest'

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

/** Applies a named strategy to a PostgREST query builder. */
export function applySort<T extends { order: (col: string, opts: object) => T }>(
  query: T,
  key: SortKey,
): T {
  const s = SORT_STRATEGIES[key]
  return query.order(s.column, { ascending: s.ascending, nullsFirst: s.nullsFirst })
}
