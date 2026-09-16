import { relativeAge } from '@/lib/dashboards/freshness'

/**
 * How old a synced number is, in one line.
 *
 * Every figure on these screens that nobody in the building typed carries one
 * of these. Three states, three different sentences, and the third is the one
 * worth having: never synced is not "a long time ago", it is "this figure is
 * not current", and a screen that says so is a screen somebody can trust.
 *
 * `failed` carries a loader's own error through, so a missing age reads as "we
 * could not ask" rather than silently disappearing.
 */
export function DataAge({
  what,
  at,
  never,
  failed,
}: {
  /** What was synced, as a sentence opener: "Stock and catalogue". */
  what: string
  at: string | null
  /** What to say when the sync has never succeeded. */
  never: string
  failed?: string
}) {
  if (failed) {
    return (
      <p className="text-xs text-stone-500">
        {what}: could not read the sync status — {failed}
      </p>
    )
  }

  return (
    <p className="text-xs text-stone-500">
      {at ? `${what} last synced ${relativeAge(at)} ago.` : never}
    </p>
  )
}
