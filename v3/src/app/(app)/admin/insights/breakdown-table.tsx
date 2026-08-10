import Link from 'next/link'
import { Card, Button, EmptyState } from '@/components/ui/primitives'
import type { BreakdownRow, Filters, GroupBy } from '@/lib/insights/model'

/**
 * The same five figures, one level below whatever is selected.
 *
 * Each row links to itself-plus-that-value, so reading the table and drilling
 * into it are the same gesture — click HDR and the table becomes HDR's
 * collections, click VINT and it becomes HDR/VINT's fabrics. The URL carries it
 * all, so the back button walks back up the levels.
 *
 * The export button is a link to a route that runs the same query function, not
 * a client-side serialisation of the rows on screen. A CSV built from what the
 * table happens to be showing silently exports only the current page the day
 * somebody adds pagination.
 */
export function BreakdownTable({
  rows,
  level,
  levelLabel,
  filters,
}: {
  rows: BreakdownRow[]
  level: GroupBy
  levelLabel: string
  filters: Filters
}) {
  const params = new URLSearchParams()
  params.set('from', filters.from)
  params.set('to', filters.to)
  for (const v of filters.vendors) params.append('vendor', v)
  for (const v of filters.collections) params.append('collection', v)
  for (const v of filters.fabrics) params.append('fabric', v)
  for (const v of filters.colours) params.append('colour', v)

  const drillTo = (value: string) => {
    const next = new URLSearchParams(params)
    next.append(
      level === 'vendor'
        ? 'vendor'
        : level === 'collection'
          ? 'collection'
          : level === 'fabric'
            ? 'fabric'
            : 'colour',
      value,
    )
    return `/admin/insights?${next.toString()}`
  }

  if (rows.length === 0) {
    return <EmptyState title={`No ${levelLabel.toLowerCase()} to show`} body="Nothing matches this selection." />
  }

  const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

  return (
    <Card className="space-y-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 className="text-base font-medium text-stone-900">By {levelLabel.toLowerCase()}</h2>
        <Link href={`/api/insights/export?${params.toString()}`} prefetch={false}>
          <Button variant="secondary">Export CSV</Button>
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-left text-stone-500">
            <tr>
              <Th>{levelLabel}</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Units sold</Th>
              <Th className="text-right">Designs sold</Th>
              <Th className="text-right">On hand</Th>
              <Th className="text-right">Sell through</Th>
              <Th className="text-right">Revenue</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <tr key={row.bucket} className="hover:bg-stone-50">
                <Td>
                  <Link
                    href={drillTo(row.bucket)}
                    className="font-mono text-stone-900 underline-offset-2 hover:underline"
                  >
                    {row.bucket}
                  </Link>
                </Td>
                <Td className="text-right tabular-nums">
                  {row.orders_placed.toLocaleString('en-IN')}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {row.units_sold.toLocaleString('en-IN')}
                </Td>
                <Td className="text-right tabular-nums">
                  {row.products_sold.toLocaleString('en-IN')}
                </Td>
                <Td className="text-right tabular-nums text-stone-500">
                  {row.units_on_hand.toLocaleString('en-IN')}
                </Td>
                <Td className="text-right tabular-nums">
                  {row.sell_through === null ? '—' : `${(row.sell_through * 100).toFixed(1)}%`}
                </Td>
                <Td className="text-right tabular-nums">{money(row.revenue)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium whitespace-nowrap ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</td>
}
