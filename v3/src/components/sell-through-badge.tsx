import { bandFor, type SellThrough, type SellThroughBand } from '@/lib/products/sell-through'

/**
 * The sell-through figure, under a photograph.
 *
 * Reads as a sentence rather than a statistic — "82% sold · 9 of 11" — because
 * the percentage alone is untrustworthy at small numbers. One piece sold out of
 * one is 100% sell-through and means almost nothing; nine of eleven at 82%
 * means a great deal. Showing the two numbers it came from lets a reader
 * discount the first case without having to open the product.
 *
 * Renders nothing at all when there is no ratio to report, rather than a dash
 * in an empty row. A card for a design that neither sold nor is held says
 * nothing about sell-through, and a dash on two thirds of the catalogue is
 * visual noise standing in for an absence.
 */
export function SellThroughBadge({ value, period }: { value: SellThrough; period: number }) {
  if (value.percent === null) return null

  const band = bandFor(value.percent)
  const had = value.unitsSold + value.stockOnHand

  return (
    <p className={`text-[11px] tabular-nums ${BAND_TONES[band]}`}>
      <span className="font-medium">{value.percent}% sold</span>
      <span className="text-stone-300"> · </span>
      <span className="text-stone-500">
        {value.unitsSold} of {had} in {period}d
      </span>
    </p>
  )
}

/**
 * Amber is as strong as this gets, and it marks slow rather than bad.
 *
 * A design stocked deep on purpose reads slow and is behaving exactly as
 * intended. Red would say "this is a mistake", which is a judgement the grid is
 * not entitled to make — the same reason the reorder ladder stops at amber.
 */
const BAND_TONES: Record<SellThroughBand, string> = {
  strong: 'text-emerald-700',
  steady: 'text-stone-600',
  slow: 'text-amber-700',
  unknown: 'text-stone-400',
}
