/**
 * The insights vocabulary: types, presets, and the pure functions over them.
 *
 * Split from `query.ts` on purpose. That file is `server-only` because it holds
 * a database client, and the filter bar is a client component that needs
 * `PRESETS` and `Filters` — importing them from there drags `server-only` into
 * the browser bundle and fails the build. Types and constants have no business
 * being server-only anyway; the query is the thing worth guarding.
 */

export const PRESETS = [30, 60, 90, 180, 365] as const
export type Preset = (typeof PRESETS)[number]

export type GroupBy = 'vendor' | 'collection' | 'fabric' | 'colour'

export interface Filters {
  from: string
  to: string
  vendors: string[]
  collections: string[]
  fabrics: string[]
  colours: string[]
}

export interface Summary {
  orders_placed: number
  units_sold: number
  products_sold: number
  units_on_hand: number
  sell_through: number | null
  revenue: number
}

export interface BreakdownRow extends Summary {
  bucket: string
}

export interface DailyPoint {
  day: string
  units: number
  revenue: number
}

export const LEVEL_LABELS: Record<GroupBy, string> = {
  vendor: 'Vendor',
  collection: 'Collection',
  fabric: 'Fabric',
  colour: 'Colour',
}

/**
 * Which level the table breaks down to.
 *
 * "One level below whatever is selected": pick a vendor and see collections;
 * pick a collection and see fabrics; pick a fabric and see colours. With
 * nothing selected the interesting cut is by vendor, because that is the unit
 * Pooja buys in.
 *
 * The order mirrors the SKU itself — PGW-BRHM-SLK-CRM-5855 is vendor,
 * collection, fabric, colour — so drilling down the table is walking left to
 * right along a code.
 */
export function nextLevel(filters: Filters): GroupBy {
  if (filters.fabrics.length > 0) return 'colour'
  if (filters.collections.length > 0) return 'fabric'
  if (filters.vendors.length > 0) return 'collection'
  return 'vendor'
}

/** `?from=` and `?to=`, or a preset, resolved to two dates. */
export function resolveRange(params: {
  from?: string
  to?: string
  days?: string
}): { from: string; to: string; preset: Preset | null } {
  const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

  if (isDate(params.from) && isDate(params.to) && params.from <= params.to) {
    return { from: params.from, to: params.to, preset: null }
  }

  const days = (PRESETS as readonly number[]).includes(Number(params.days))
    ? (Number(params.days) as Preset)
    : 90

  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    preset: days,
  }
}

/**
 * The breakdown as CSV.
 *
 * Every field is quoted and internal quotes are doubled. A saree collection is
 * a free-text token and a comma in one would silently shift every column to its
 * right — a spreadsheet that opens without complaint and is wrong.
 */
export function toCsv(rows: BreakdownRow[], level: GroupBy): string {
  const header = [
    LEVEL_LABELS[level],
    'Orders',
    'Units sold',
    'Products sold',
    'Units on hand',
    'Sell through',
    'Revenue',
  ]

  const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`

  const lines = [header.map(escape).join(',')]

  for (const row of rows) {
    lines.push(
      [
        row.bucket,
        row.orders_placed,
        row.units_sold,
        row.products_sold,
        row.units_on_hand,
        row.sell_through === null ? '' : (row.sell_through * 100).toFixed(1),
        row.revenue,
      ]
        .map(escape)
        .join(','),
    )
  }

  // CRLF: Excel on Windows is where these are opened, and it is the line ending
  // the CSV specification actually names.
  return lines.join('\r\n')
}
