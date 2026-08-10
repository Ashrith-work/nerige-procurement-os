import { interpolate, formatCount, type Dictionary, type Locale } from '@/lib/i18n'
import { TIER_KEYS, type Tier, type Window } from '@/lib/reorder/sort'

/**
 * Two small facts under a photograph: how many sold, and whether it is moving.
 *
 * DELIBERATELY QUIET. Low contrast, small, and below the code — never beside
 * it. The SKU is the one string on a vendor card that gets copied onto a fabric
 * label by hand, and a bright green "36 sold" competing with it for attention
 * is a worse card even though it is a more interesting number.
 *
 * The two badges answer different questions and both are needed. "36 sold in 90
 * days" is the magnitude; "Selling" is the direction. A design with 36 sales
 * that all happened eight months ago is not the same proposition as one with 36
 * last month, and the count alone cannot tell them apart.
 *
 * Both are translated. The number goes through `formatCount` so the native
 * numerals flag applies here as everywhere else.
 */
export function SalesBadges({
  units,
  tier,
  window,
  t,
  locale = 'en',
}: {
  units: number
  tier: Tier | null
  window: Window
  t: Dictionary
  locale?: Locale
}) {
  // Nothing to say yet: sales have never been synced. Better than a row of
  // zeroes, which reads as "this has never sold" rather than "we do not know".
  if (tier === null) return null

  const soldLabel =
    units > 0
      ? interpolate(units === 1 ? t.badge.soldInWindow_one : t.badge.soldInWindow_other, {
          n: formatCount(units, locale),
          days: formatCount(window, locale),
        })
      : t.badge.neverSold

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-stone-500">
      {units > 0 && (
        <>
          <span className="tabular-nums">{soldLabel}</span>
          <span className="text-stone-300">·</span>
        </>
      )}
      <span className={TIER_TONES[tier]}>{t.badge[TIER_KEYS[tier]]}</span>
      {units === 0 && tier >= 3 && (
        <>
          <span className="text-stone-300">·</span>
          <span>{t.badge.neverSold}</span>
        </>
      )}
    </p>
  )
}

/**
 * Muted on purpose, and only the bottom rung carries any warmth at all.
 *
 * Tier 4 is the one worth noticing — unsold for a year with nothing left — and
 * even it is amber rather than red. Red on a reorder grid would read as "do not
 * make this", and that is Pooja's call, not the grid's.
 */
const TIER_TONES: Record<Tier, string> = {
  1: 'text-emerald-700',
  2: 'text-stone-500',
  3: 'text-stone-500',
  4: 'text-amber-700',
}
