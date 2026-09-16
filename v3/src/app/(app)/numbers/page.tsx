import Link from 'next/link'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, EmptyState, PageHeader, cn } from '@/components/ui/primitives'
import { DashboardSection, SectionError, settle } from '@/components/dashboard/tile'
import { DashboardStrip } from '@/components/dashboard/strip'
import { DataAge } from '@/components/dashboard/data-age'
import { loadInsights } from '@/lib/insights/query'
import { LEVEL_LABELS, resolveRange, type Filters } from '@/lib/insights/model'
import { UnitsChart } from '@/app/(app)/admin/insights/units-chart'
import { BreakdownTable } from '@/app/(app)/admin/insights/breakdown-table'
import { loadSyncAges } from '@/lib/dashboards/freshness'
import {
  loadMovers,
  loadStockGlance,
  nearestMoverWindow,
  staffRange,
  teamOutput,
  type Mover,
} from '@/lib/dashboards/numbers'
import { loadPeriodSummary } from '@/lib/performance/summary'
import { formatDays, formatPercent } from '@/lib/performance/calc'
import { daysBetween, formatLongDay } from '@/lib/performance/period'
import { PeriodBar } from './period-bar'

export const metadata = { title: 'Numbers · Nerige' }

/**
 * Numbers: every analysis, in one place, opened on purpose.
 *
 * This screen exists so that the other two do not have to carry a single
 * measurement. Sell-through, movers, revenue and staff output are all worth
 * knowing and none of them is worth interrupting a morning with — a person
 * arrives here having decided to ask, which is the only state of mind in which
 * a percentage means anything.
 *
 * NOTHING HERE IS COMPUTED TWICE. The headline figures, the daily line and the
 * breakdown are `loadInsights` — the same function, the same arguments and the
 * same period as `/admin/insights`, whose components are imported rather than
 * reimplemented. What this screen adds is the design level (`loadMovers`) and
 * the shelf (`loadStockGlance`), neither of which the insights functions
 * express, plus the staff review read over the same period.
 *
 * ONE PERIOD, OBEYED THROUGHOUT. The selector writes it to the URL and every
 * section reads it from there. Two sections cannot honour it exactly and both
 * say so where they sit: movers read the nearest rolled-up sales window, and
 * the staff sheet is never read past today or beyond the review's own limit.
 *
 * Staff performance is admin only, matching `requireStaffReview()`. Pooja's
 * login does not get a screen full of blanks; she gets a screen without it.
 */
export default async function NumbersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>
}) {
  const params = await searchParams
  const user = await requireProcurement()
  const supabase = await createClient()

  const range = resolveRange(params)
  const filters: Filters = {
    from: range.from,
    to: range.to,
    vendors: [],
    collections: [],
    fabrics: [],
    colours: [],
  }

  const periodDays = daysBetween(range.from, range.to) + 1
  const window = nearestMoverWindow(periodDays)
  const staff = staffRange(range.from, range.to)
  const isAdmin = user.role === 'admin'

  const [insights, movers, stock, sync, people] = await Promise.all([
    settle(() => loadInsights(supabase, filters)),
    settle(() => loadMovers(supabase, window)),
    settle(() => loadStockGlance(supabase)),
    settle(() => loadSyncAges(supabase)),
    isAdmin ? settle(() => loadPeriodSummary(supabase, { from: staff.from, to: staff.to })) : null,
  ])

  const insightsHref = `/admin/insights?from=${range.from}&to=${range.to}`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DashboardStrip current="numbers" role={user.role} />

      <PageHeader
        title="Numbers"
        subtitle="Every analysis, in one place. Nothing here interrupts you anywhere else."
        action={
          <Link
            href={insightsHref}
            className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-900 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Filter and drill down
          </Link>
        }
      />

      <PeriodBar from={range.from} to={range.to} preset={range.preset} />

      <DashboardSection title="Sales">
        {insights.ok ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Figure label="Orders placed" value={insights.value.summary.orders_placed.toLocaleString('en-IN')} />
              <Figure label="Units sold" value={insights.value.summary.units_sold.toLocaleString('en-IN')} />
              <Figure label="Designs sold" value={insights.value.summary.products_sold.toLocaleString('en-IN')} />
              <Figure
                label="Sell through"
                value={
                  insights.value.summary.sell_through === null
                    ? '—'
                    : `${(insights.value.summary.sell_through * 100).toFixed(1)}%`
                }
                hint="Sold ÷ sold plus still on hand"
              />
              <Figure label="Revenue" value={money(insights.value.summary.revenue)} />
            </div>

            {insights.value.daily.length === 0 ? (
              <EmptyState
                title="No sales in this period"
                body="Either nothing sold in this window, or the sales sync has not run. The line below the figures says when it last worked."
              />
            ) : (
              <Card className="space-y-3">
                <h3 className="text-base font-medium text-stone-900">Units sold per day</h3>
                <UnitsChart points={insights.value.daily} from={range.from} to={range.to} />
              </Card>
            )}

            <DataAge
              what="Sales"
              at={sync.ok ? sync.value.orders : null}
              never="The sales sync has never succeeded — these figures are not current."
              failed={sync.ok ? undefined : sync.error}
            />
          </div>
        ) : (
          <SectionError message={insights.error} />
        )}
      </DashboardSection>

      {insights.ok && (
        <DashboardSection
          title={`By ${LEVEL_LABELS[insights.value.groupBy].toLowerCase()}`}
          action={
            <Link href={insightsHref} className="text-sm text-stone-600 underline-offset-2 hover:underline">
              Narrow it down
            </Link>
          }
        >
          <BreakdownTable
            rows={insights.value.breakdown}
            level={insights.value.groupBy}
            levelLabel={LEVEL_LABELS[insights.value.groupBy]}
            filters={filters}
          />
        </DashboardSection>
      )}

      <DashboardSection title="Movers">
        {movers.ok ? (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <MoverList
                title="Selling fastest"
                empty="Nothing sold in this window."
                movers={movers.value.best}
                measure="sold"
              />
              <MoverList
                title="Sitting on stock"
                empty="Every design with stock has sold at least one."
                movers={movers.value.slow}
                measure="on hand"
                slow
              />
            </div>
            <p className="text-xs text-stone-500">
              Movers read the catalogue’s rolled-up sales window — the last {movers.value.window} days
              {periodDays === movers.value.window ? '' : `, the nearest one to the ${periodDays} days above`}.
            </p>
          </div>
        ) : (
          <SectionError message={movers.error} />
        )}
      </DashboardSection>

      <DashboardSection
        title="Stock at a glance"
        action={
          <Link href="/reorder" className="text-sm text-stone-600 underline-offset-2 hover:underline">
            Reorder grid
          </Link>
        }
      >
        {stock.ok ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure label="Designs in the catalogue" value={stock.value.designs.toLocaleString('en-IN')} />
              <Figure
                label="Pieces on hand"
                value={insights.ok ? insights.value.summary.units_on_hand.toLocaleString('en-IN') : '—'}
              />
              <Figure
                label="Sold out or last piece"
                value={stock.value.reorderPool.toLocaleString('en-IN')}
                hint="What the reorder grid offers"
              />
              <Figure
                label="Oversold"
                value={stock.value.oversold.toLocaleString('en-IN')}
                hint="Paid for, and not on the shelf"
              />
            </div>
            <DataAge
              what="Stock and catalogue"
              at={sync.ok ? sync.value.products : null}
              never="The catalogue sync has never succeeded — stock figures are not current."
              failed={sync.ok ? undefined : sync.error}
            />
          </div>
        ) : (
          <SectionError message={stock.error} />
        )}
      </DashboardSection>

      {isAdmin && people && (
        <DashboardSection
          title="The floor staff"
          action={
            <Link
              href={`/admin/performance?preset=custom&from=${staff.from}&to=${staff.to}`}
              className="text-sm text-stone-600 underline-offset-2 hover:underline"
            >
              Full review
            </Link>
          }
        >
          {people.ok ? (
            <Card className="space-y-3 p-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
                <p className="text-sm text-stone-600">
                  Sheet filled on{' '}
                  <span
                    className={cn(
                      'tabular-nums',
                      people.value.totals.completeDates < people.value.totals.expectedDates
                        ? 'text-amber-700'
                        : 'text-emerald-700',
                    )}
                  >
                    {people.value.totals.completeDates} of {people.value.totals.expectedDates}
                  </span>{' '}
                  working days
                </p>
                <p className="text-sm text-stone-600">
                  Team output{' '}
                  <span className="font-medium tabular-nums">{formatPercent(teamOutput(people.value.people))}</span>
                </p>
              </div>

              {people.value.people.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-stone-500">
                  Nobody was on the roster in this period. The warehouse manager adds people on the staff sheet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 text-right font-medium">Days in</th>
                        <th className="px-3 py-2 text-right font-medium">Output</th>
                        <th className="px-3 py-2 text-right font-medium">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {people.value.people.map((p) => (
                        <tr key={p.staff.id} className="hover:bg-stone-50">
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/admin/performance/staff/${p.staff.id}?preset=custom&from=${staff.from}&to=${staff.to}`}
                              className="font-medium text-stone-900 underline-offset-2 hover:underline"
                            >
                              {p.staff.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatDays(p.attendanceDays)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatPercent(p.output.ratio)}</td>
                          <td
                            className={cn(
                              'px-3 py-2.5 text-right tabular-nums',
                              p.flags.total > 0 ? 'text-red-700' : 'text-stone-500',
                            )}
                          >
                            {p.flags.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="px-4 pb-4 text-xs text-stone-500">
                {formatLongDay(staff.from)} – {formatLongDay(staff.to)}
                {staff.clamped ? ' — the sheet is only read up to today, and at most 93 days at a time.' : '.'} Counts
                are the warehouse manager’s rough daily numbers, not timings.
              </p>
            </Card>
          ) : (
            <SectionError message={people.error} />
          )}
        </DashboardSection>
      )}
    </div>
  )
}

function money(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 px-3 py-2.5">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-xl font-medium tabular-nums text-stone-900">{value}</p>
      {hint && <p className="text-[11px] text-stone-500">{hint}</p>}
    </div>
  )
}

/**
 * Eight designs, code first.
 *
 * SKUs are monospace everywhere in this application: they are read character by
 * character and copied onto fabric by hand. The title is secondary and allowed
 * to be cut; the code never is.
 */
function MoverList({
  title,
  empty,
  movers,
  measure,
  slow = false,
}: {
  title: string
  empty: string
  movers: Mover[]
  measure: 'sold' | 'on hand'
  slow?: boolean
}) {
  return (
    <Card className="space-y-2">
      <h3 className="text-base font-medium text-stone-900">{title}</h3>
      {movers.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {movers.map((m) => (
            <li key={m.sku} className="flex items-baseline justify-between gap-3 py-2">
              <Link
                href={`/lookup/${encodeURIComponent(m.sku)}`}
                className="min-w-0 underline-offset-2 hover:underline"
              >
                <span className="block font-mono text-sm text-stone-900">{m.sku}</span>
                {m.title && <span className="block truncate text-xs text-stone-500">{m.title}</span>}
              </Link>
              <span className="shrink-0 text-right text-sm tabular-nums">
                <span className="font-medium">{(slow ? m.qtyAvailable : m.units).toLocaleString('en-IN')}</span>
                <span className="block text-xs text-stone-500">{measure}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
