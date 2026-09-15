import Link from 'next/link'
import { cn } from '@/components/ui/primitives'
import { PERIOD_PRESETS, type Period } from '@/lib/performance/period'

/** The query string that reproduces `period`, for links that must keep it. */
export function periodQuery(period: Period): string {
  return period.preset === 'custom'
    ? `preset=custom&from=${period.from}&to=${period.to}`
    : `preset=${period.preset}`
}

/**
 * This week / last week / this month / last month, or two dates.
 *
 * Plain links and a GET form — no client JavaScript — so the period lives in
 * the URL, and a founder can send a link to "last week" to the other founder
 * and they see the same thing.
 */
export function PeriodPicker({ basePath, period, today }: { basePath: string; period: Period; today: string }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <nav aria-label="Period" className="flex flex-wrap gap-1">
        {PERIOD_PRESETS.map((p) => (
          <Link
            key={p.value}
            href={`${basePath}?preset=${p.value}`}
            aria-current={period.preset === p.value ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-lg border px-3 text-sm',
              period.preset === p.value
                ? 'border-stone-900 bg-stone-900 text-white'
                : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
            )}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <form action={basePath} method="get" className="flex flex-wrap items-end gap-1.5">
        <input type="hidden" name="preset" value="custom" />
        <label className="text-xs text-stone-500">
          From
          <input
            type="date"
            name="from"
            defaultValue={period.from}
            max={today}
            required
            className="mt-0.5 block min-h-11 rounded-lg border border-stone-300 bg-white px-2 text-base text-stone-900"
          />
        </label>
        <label className="text-xs text-stone-500">
          To
          <input
            type="date"
            name="to"
            defaultValue={period.to}
            max={today}
            required
            className="mt-0.5 block min-h-11 rounded-lg border border-stone-300 bg-white px-2 text-base text-stone-900"
          />
        </label>
        <button
          type="submit"
          className={cn(
            'min-h-11 rounded-lg border px-3 text-sm',
            period.preset === 'custom'
              ? 'border-stone-900 bg-stone-900 text-white'
              : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
          )}
        >
          Show
        </button>
      </form>
    </div>
  )
}
