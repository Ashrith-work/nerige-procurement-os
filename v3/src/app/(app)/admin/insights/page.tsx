import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, EmptyState } from '@/components/ui/primitives'
import { loadInsights } from '@/lib/insights/query'
import { resolveRange, LEVEL_LABELS, type Filters } from '@/lib/insights/model'
import { InsightsFilters, type FacetRow } from './insights-filters'
import { UnitsChart } from './units-chart'
import { BreakdownTable } from './breakdown-table'

export const metadata = { title: 'Insights · Nerige' }

/**
 * Admin only, and never visible to a weaver.
 *
 * The route is behind `requireProcurement()`, and every function it calls is
 * `security invoker` — so even if a vendor login somehow reached this URL she
 * would be redirected, and if she reached the functions directly she would see
 * her own rows and nobody else's. Two independent reasons, which is the right
 * number for a screen showing every weaver's revenue to every other weaver if
 * it were wrong.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string
    to?: string
    days?: string
    vendor?: string | string[]
    collection?: string | string[]
    fabric?: string | string[]
    colour?: string | string[]
  }>
}) {
  const params = await searchParams
  await requireProcurement()
  const supabase = await createClient()

  const list = (value: string | string[] | undefined): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean)

  const range = resolveRange(params)

  const filters: Filters = {
    from: range.from,
    to: range.to,
    vendors: list(params.vendor),
    collections: list(params.collection),
    fabrics: list(params.fabric),
    colours: list(params.colour),
  }

  const [{ data: facetRows }, insights] = await Promise.all([
    supabase
      .from('catalogue_facets')
      .select('vendor_code, collection, fabric, colour_code, design_count'),
    loadInsights(supabase, filters),
  ])

  const { summary, breakdown, daily, groupBy } = insights

  const money = (n: number) =>
    `₹${Math.round(n).toLocaleString('en-IN')}`

  return (
    <div className="space-y-5">
      <PageHeader
        title="Insights"
        subtitle={`${range.from} to ${range.to}`}
      />

      <InsightsFilters
        facets={(facetRows ?? []) as FacetRow[]}
        filters={filters}
        preset={range.preset}
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Figure label="Orders placed" value={summary.orders_placed.toLocaleString('en-IN')} />
        <Figure label="Units sold" value={summary.units_sold.toLocaleString('en-IN')} />
        <Figure label="Designs sold" value={summary.products_sold.toLocaleString('en-IN')} />
        <Figure
          label="Sell through"
          value={summary.sell_through === null ? '—' : `${(summary.sell_through * 100).toFixed(1)}%`}
          hint="Sold ÷ sold plus still on hand"
        />
        <Figure label="Revenue" value={money(summary.revenue)} />
      </div>

      {daily.length === 0 ? (
        <EmptyState
          title="No sales in this period"
          body="Either nothing sold against this selection, or the sales sync has not run yet. Settings shows when it last worked."
        />
      ) : (
        <Card className="space-y-3">
          <h2 className="text-base font-medium text-stone-900">Units sold per day</h2>
          <UnitsChart points={daily} from={range.from} to={range.to} />
        </Card>
      )}

      <BreakdownTable
        rows={breakdown}
        level={groupBy}
        levelLabel={LEVEL_LABELS[groupBy]}
        filters={filters}
      />
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 px-3 py-2.5">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-xl font-medium tabular-nums text-stone-900">{value}</p>
      {hint && <p className="text-[11px] text-stone-400">{hint}</p>}
    </div>
  )
}
