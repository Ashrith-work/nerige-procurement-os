import Link from 'next/link'
import { formatDistanceToNowStrict } from 'date-fns'
import type { PipelineStage } from '@/lib/dashboards/pipeline'
import { cn } from '@/lib/utils'

/**
 * A pipeline: the stages left to right, with the count and the one order that
 * stands for each.
 *
 * Read as a sentence rather than as four tiles. The arrow between stages is
 * what makes it a journey — the same four numbers in a grid are four unrelated
 * facts, and somebody has to remember which way an order travels to make sense
 * of them.
 *
 * `href` is optional per stage, and that is how a role sees only the parts it
 * can open: the warehouse manager can read every stage, but the order screen is
 * procurement's, so their first two stages are plain cards rather than links
 * into a refusal.
 */

/** "6 days", from an ISO timestamp. Module level, because it reads the clock. */
function waiting(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso))
}

export function Pipeline({
  stages,
  hrefFor,
  orderHrefFor,
}: {
  stages: PipelineStage[]
  hrefFor: (stage: PipelineStage) => string | null
  orderHrefFor: (stage: PipelineStage) => string | null
}) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stages.map((stage, i) => {
        const href = hrefFor(stage)
        const orderHref = orderHrefFor(stage)

        const body = (
          <>
            <p className="text-xs text-stone-500">{stage.label}</p>
            <p className="mt-1 text-2xl font-medium tabular-nums">{stage.count}</p>
            <p className="mt-0.5 text-xs text-stone-500">{stage.whose}</p>
          </>
        )

        return (
          <li key={stage.key} className="relative">
            {/* The arrow, on the widths where the stages sit side by side. */}
            {i > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-1/2 -left-2.5 hidden -translate-y-1/2 text-stone-300 lg:block"
              >
                &rarr;
              </span>
            )}

            <div
              className={cn(
                'h-full rounded-xl border p-4',
                stage.key === 'received' ? 'border-emerald-200 bg-emerald-50/60' : 'border-stone-200',
              )}
            >
              {href ? (
                <Link
                  href={href}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
                >
                  {body}
                </Link>
              ) : (
                body
              )}

              {stage.mark && (
                <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600">
                  <span className="text-stone-500">{stage.mark.label}: </span>
                  {orderHref ? (
                    <Link href={orderHref} className="font-mono underline-offset-2 hover:underline">
                      {stage.mark.order.orderNumber}
                    </Link>
                  ) : (
                    <span className="font-mono">{stage.mark.order.orderNumber}</span>
                  )}
                  {stage.mark.order.vendorCode && (
                    <span className="text-stone-500"> · {stage.mark.order.vendorCode}</span>
                  )}
                  <span className="block text-stone-500">{waiting(stage.mark.order.since)}</span>
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
