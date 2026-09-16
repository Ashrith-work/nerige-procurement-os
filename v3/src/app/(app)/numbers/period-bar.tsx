import Link from 'next/link'
import { Button, Card, Input } from '@/components/ui/primitives'
import { PRESETS, type Preset } from '@/lib/insights/model'
import { cn } from '@/lib/utils'

/**
 * The one period control, and everything below it obeys.
 *
 * Plain links and a plain form, no client JavaScript. The period lives in the
 * URL, which is what makes a view on this screen something a person can send to
 * somebody else — "the last 90 days, look at the movers" is a link, not a set
 * of instructions.
 *
 * The presets are the insights presets, imported rather than retyped, so this
 * screen and the sales analysis offer the same windows and a link between them
 * keeps its meaning.
 */
export function PeriodBar({
  from,
  to,
  preset,
}: {
  from: string
  to: string
  preset: Preset | null
}) {
  const href = (days: Preset) => `/numbers?days=${days}`

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PRESETS.map((days) => {
            const on = preset === days
            return (
              <Link
                key={days}
                href={href(days)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-lg border px-3 text-sm',
                  'focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:outline-none',
                  on
                    ? 'border-stone-900 bg-stone-900 font-medium text-white'
                    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
                )}
              >
                {days} days
              </Link>
            )
          })}
        </div>

        <form action="/numbers" className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-stone-600">
            From
            <Input type="date" name="from" defaultValue={from} className="mt-1" />
          </label>
          <label className="text-sm text-stone-600">
            To
            <Input type="date" name="to" defaultValue={to} className="mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>

      <p className="text-xs text-stone-500">
        Every figure below is for {from} to {to}.
      </p>
    </Card>
  )
}
