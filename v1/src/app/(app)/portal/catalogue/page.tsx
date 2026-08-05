import Link from 'next/link'
import { listProducts } from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import { Card, EmptyState, Input, PageHeader, Button } from '@/components/ui/primitives'
import { money, formatDate } from '@/lib/format'

export const metadata = { title: 'My codes · Nerige Story' }

interface VendorProduct {
  id: string
  sku: string
  title: string
  colour: string | null
  fabric: string | null
  variant_note: string | null
  cost_price: string | null
  last_ordered_at: string | null
  units_ordered_total: number
  units_sold_30d: number | null
  units_sold_90d: number | null
  sales_synced_at: string | null
  product_series: { name: string } | null
}

/**
 * The vendor's own SKU codes — the first of the two things the portal exists for.
 *
 * Every code here currently lives in one person's head and a spreadsheet. When
 * a parcel arrives unlabelled, the warehouse opens every piece to work out what
 * it is. Publishing the list costs nothing and removes that entirely: the
 * weaver writes the code on the piece before it is packed.
 *
 * Grouped by series and sorted by code, because that is how a weaver thinks
 * about their own work — by design family, not by our internal ordering.
 * Printable, because the loom does not have a screen next to it.
 */
export default async function VendorCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requireRole('vendor')
  const { q } = await searchParams
  // vendorId is used only by demo mode; RLS scopes `products` for real.
  const data = await listProducts({ vendorId: user.vendorId, q })

  const products = data.filter((p) => p.status !== 'discontinued') as unknown as VendorProduct[]

  // Grouped in code rather than by a second query: the list is tens of rows,
  // not thousands, and one round trip beats N.
  const grouped = new Map<string, VendorProduct[]>()
  for (const p of products) {
    const key = p.product_series?.name ?? 'Other'
    const list = grouped.get(key) ?? []
    list.push(p)
    grouped.set(key, list)
  }

  const anySales = products.some((p) => p.sales_synced_at)

  return (
    <div className="space-y-5">
      <PageHeader
        title="My codes"
        subtitle={`The codes to write on each piece you send ${user.vendorName ? `from ${user.vendorName}` : ''}`}
        action={
          <Link href="/portal" className="text-sm text-stone-500 hover:text-stone-900">
            My orders
          </Link>
        }
      />

      <Card className="bg-stone-900 text-white print:hidden">
        <p className="text-sm font-medium">Write the code on the piece before packing</p>
        <p className="mt-1 text-xs text-stone-300">
          A labelled parcel is checked in on the day it arrives. An unlabelled one waits until
          someone can identify every piece by hand — which is what delays your payment.
        </p>
      </Card>

      <form className="flex flex-wrap gap-2 print:hidden">
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search code, name or colour…"
          className="max-w-xs"
          aria-label="Search my codes"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {products.length === 0 ? (
        <EmptyState
          title={q ? 'Nothing matches' : 'No codes yet'}
          body={
            q
              ? 'Try part of the code, the name, or a colour.'
              : 'Once Nerige Story lists the designs they buy from you, their codes appear here.'
          }
        />
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([seriesName, items]) => (
            <section key={seriesName} className="space-y-2">
              <h2 className="text-sm font-semibold">{seriesName}</h2>
              <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Code</th>
                      <th className="px-4 py-2 font-medium">What it is</th>
                      <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                        Your rate
                      </th>
                      <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                        Last ordered
                      </th>
                      {anySales && (
                        <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                          Selling
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {items.map((p) => (
                      <tr key={p.id}>
                        {/* Large and monospaced: this is the string someone
                            copies onto a label by hand. */}
                        <td className="px-4 py-3 font-mono text-base font-medium">{p.sku}</td>
                        <td className="px-4 py-3">
                          <p>{p.title}</p>
                          <p className="text-xs text-stone-500">
                            {[p.colour, p.fabric, p.variant_note].filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                          {money(p.cost_price)}
                        </td>
                        <td className="hidden px-4 py-3 text-right text-xs text-stone-500 md:table-cell">
                          {p.last_ordered_at ? formatDate(p.last_ordered_at) : 'Not yet'}
                        </td>
                        {anySales && (
                          <td className="hidden px-4 py-3 text-right text-xs md:table-cell">
                            {p.sales_synced_at ? (
                              <>
                                <span className="tabular-nums font-medium text-stone-700">
                                  {p.units_sold_30d ?? 0}
                                </span>
                                <span className="block text-stone-400">last 30 days</span>
                              </>
                            ) : (
                              <span className="text-stone-300">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {products.length > 0 && (
        <p className="text-xs text-stone-500 print:hidden">
          {anySales
            ? 'Selling figures are how many pieces of that design sold in the last 30 days, so you can see which of your designs is moving.'
            : 'Sales figures will appear here once they are connected, so you can see which of your designs are moving.'}
        </p>
      )}
    </div>
  )
}
