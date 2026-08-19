/**
 * Sell-through: what fraction of the pieces we had have actually sold.
 *
 * One file, because the moment two screens compute this differently they are
 * two different metrics wearing the same name, and nobody can tell which one
 * they are reading.
 *
 * THE FORMULA
 *
 *   sell-through = units sold in the period / (units sold + stock still held)
 *
 * The denominator is the honest approximation of "how many we had". The
 * textbook figure is units received, which this system has never recorded —
 * there is no goods-inward event anywhere in the schema, only Shopify's current
 * inventory and Shopify's orders. Sold plus remaining reconstructs the starting
 * quantity exactly, PROVIDED nothing arrived mid-period. Where a design was
 * restocked during the window the result understates true sell-through, and
 * that is a bias worth stating rather than hiding: a fast design that was
 * topped up twice looks slower than it was.
 *
 * STOCK IS SHOPIFY'S AVAILABLE, decided 2026-08-19. EasyEcom's figure would
 * exclude pieces reserved against open customer orders and is the better number
 * in principle, but the endpoint is not wired and waiting for it means no
 * metric at all. See migration 027.
 *
 * WHY IT CAN BE NULL, AND WHY THAT IS NOT A ZERO. Nothing sold and nothing in
 * stock gives 0/0. That is not "sold none of them" — it is a design we neither
 * hold nor moved in the period, and there is no fraction to report. 7,462 of
 * the 10,149 designs are in exactly that state, so rendering it as 0% would put
 * a confident, wrong number on two thirds of the catalogue. Null, shown as a
 * dash, is the only truthful answer.
 *
 * NEGATIVE STOCK IS CLAMPED TO ZERO. Shopify's on-hand goes negative when a
 * design oversells — 27 currently are, one at -117. A negative denominator term
 * would push sell-through above 100% or, worse, flip its sign. Oversold means
 * "none left and then some", and for this ratio none left is what matters.
 */

/** The periods offered. Days, and the products column each reads. */
export const SELL_THROUGH_PERIODS = [30, 60, 90, 365] as const
export type SellThroughPeriod = (typeof SELL_THROUGH_PERIODS)[number]

export const DEFAULT_PERIOD: SellThroughPeriod = 90

export function isSellThroughPeriod(value: unknown): value is SellThroughPeriod {
  return SELL_THROUGH_PERIODS.includes(Number(value) as SellThroughPeriod)
}

export function resolvePeriod(value: string | null | undefined): SellThroughPeriod {
  return isSellThroughPeriod(value) ? (Number(value) as SellThroughPeriod) : DEFAULT_PERIOD
}

export type UnitsColumn = 'units_30d' | 'units_60d' | 'units_90d' | 'units_365d'

export function unitsColumnFor(period: SellThroughPeriod): UnitsColumn {
  return `units_${period}d` as UnitsColumn
}

/**
 * Unlike the reorder ladder, this offers 365 as well as 30/60/90.
 *
 * The ladder cannot: its tiers are "sold in the window" versus "sold in the
 * year but not the window", which collapses into a single rung once the window
 * IS the year, and there is no `tier_365` column because that tier would be
 * meaningless. Sell-through has no such dependency — it needs a units total and
 * a stock figure, and `units_365d` is already rolled up.
 */

export interface SellThrough {
  /** 0–100, rounded to one decimal. Null when there is nothing to divide. */
  percent: number | null
  unitsSold: number
  /** Stock as counted for the ratio: never negative. */
  stockOnHand: number
}

export function sellThrough(
  unitsSold: number | null | undefined,
  qtyAvailable: number | null | undefined,
): SellThrough {
  const sold = Math.max(0, unitsSold ?? 0)
  // Null stock is treated as none held, not as unknown. A product Shopify does
  // not track inventory for still sold what it sold, and reporting a dash for a
  // design with real sales would hide the one fact we do have.
  const stock = Math.max(0, qtyAvailable ?? 0)

  const had = sold + stock
  if (had === 0) return { percent: null, unitsSold: sold, stockOnHand: stock }

  return {
    percent: Math.round((sold / had) * 1000) / 10,
    unitsSold: sold,
    stockOnHand: stock,
  }
}

/**
 * Bands, for the one bit of colour this metric gets.
 *
 * Deliberately coarse and deliberately not red. A low sell-through is not a
 * fault — a design stocked deep on purpose reads low and is fine — so the
 * strongest tone available is amber, and it means "look at this", never "this
 * is wrong". Same argument as the reorder ladder's tier tones.
 */
export type SellThroughBand = 'strong' | 'steady' | 'slow' | 'unknown'

export function bandFor(percent: number | null): SellThroughBand {
  if (percent === null) return 'unknown'
  if (percent >= 75) return 'strong'
  if (percent >= 40) return 'steady'
  return 'slow'
}
