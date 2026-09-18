import Link from 'next/link'
import { Alert } from '@/components/ui/primitives'
import { formatLongDay } from '@/lib/performance/period'
import { ORDER_GROUPS, type DayOrders } from '@/lib/day-sheet/calc'
import { cn } from '@/lib/utils'

/**
 * The orders half of the day sheet, as a summary rather than a table of counts.
 *
 * NOT ONE INPUT ON IT, and that is the reason this screen exists rather than the
 * spreadsheet it replaces: every figure is already in `dispatch.orders`, synced
 * from Shopify for the board this same warehouse picks from. Asking somebody to
 * count it again produces a second, worse answer and teaches them the sheet is
 * busywork.
 *
 * WHY IT READS AS A SENTENCE FIRST. In the rail it has about 300 pixels, and
 * twelve numbers in that space is a wall nobody reads twice. So it leads with
 * the three that decide whether the day is finished — what came in, what went
 * out, what is still waiting — and the rest sits under a disclosure for the
 * afternoon when somebody actually wants the split by lane and by kind.
 *
 * `stillToGo` is the one that matters at four o'clock: orders taken today that
 * have not left. It is shown against what came in, because "9 still to go" means
 * something different out of 12 than out of 60.
 */
export function OrdersSection({
  date,
  orders,
  error,
}: {
  date: string
  orders: DayOrders | null
  error: string | null
}) {
  return (
    <section aria-labelledby="orders" className="rounded-xl border border-stone-300 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-stone-200 px-3 py-2">
        <h2 id="orders" className="text-sm font-medium text-stone-900">
          Orders
        </h2>
        <span className="text-xs text-stone-500">from the board</span>
      </div>

      {error && (
        <div className="p-3">
          <Alert tone="error">
            The orders for this day could not be counted. Try reloading; if it keeps failing, tell a
            developer: {error}
          </Alert>
        </div>
      )}

      {orders && !orders.boardConnected && (
        <div className="p-3">
          <Alert>
            The dispatch board is not connected to this database, so orders cannot be counted here. The
            rest of the day sheet works as normal.
          </Alert>
        </div>
      )}

      {orders?.boardConnected && (
        <>
          <dl className="divide-y divide-stone-100 text-sm">
            <Line label="Came in" value={orders.ordersReceived} />
            <Line label="Went out" value={orders.dispatched} />
            <Line
              label="Still to go"
              value={orders.stillToGo}
              tone={orders.stillToGo === 0 ? 'good' : 'warn'}
              hint={
                orders.ordersReceived > 0 && orders.stillToGo > 0
                  ? `of ${orders.ordersReceived} taken today`
                  : undefined
              }
            />
          </dl>

          {/* The backlog is a different question from today's work, so it is
              separated by a rule rather than being a fourth line of the same
              list: one is "is today finished", the other is "how far behind are
              we", and reading them as one column hides both. */}
          <dl className="divide-y divide-stone-100 border-t border-stone-200 text-sm">
            <Line
              label="Open, all days"
              value={orders.openTillDate}
              tone={orders.openTillDate === 0 ? 'good' : 'calm'}
            />
            {orders.oldestOpen && (
              <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <dt className="text-stone-600">Oldest waiting</dt>
                <dd className="text-sm text-stone-900">{formatLongDay(orders.oldestOpen)}</dd>
              </div>
            )}
          </dl>

          {/* Everything else, one click away. A warehouse manager wants the split
              by lane when he is planning the courier run, and not before. */}
          <details className="border-t border-stone-200">
            <summary className="min-h-11 cursor-pointer list-none px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:outline-none">
              The rest of the day&rsquo;s orders
            </summary>
            <div className="space-y-3 px-3 pb-3">
              {ORDER_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="text-xs font-medium text-stone-500">{group.title}</h3>
                  <dl className="mt-1 space-y-0.5 text-sm">
                    {group.figures.map((figure) => (
                      <div key={figure.key} className="flex items-baseline justify-between gap-3">
                        <dt className="text-stone-600">{figure.label}</dt>
                        <dd className="font-medium text-stone-900 tabular-nums">{orders[figure.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              <p className="text-xs text-stone-500">
                The board&rsquo;s count for {formatLongDay(date)}, read when this page loaded.{' '}
                <Link href="/work" className="underline underline-offset-2">
                  Orders in progress
                </Link>
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  )
}

function Line({
  label,
  value,
  tone = 'calm',
  hint,
}: {
  label: string
  value: number
  tone?: 'calm' | 'good' | 'warn'
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <dt className="text-stone-600">
        {label}
        {hint && <span className="block text-xs text-stone-500">{hint}</span>}
      </dt>
      <dd
        className={cn(
          'text-lg font-medium tabular-nums',
          tone === 'calm' && 'text-stone-900',
          tone === 'good' && 'text-emerald-700',
          tone === 'warn' && 'text-amber-800',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
