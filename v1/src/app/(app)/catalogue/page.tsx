import Link from 'next/link'
import { listProducts } from '@/lib/data/procurement'
import { listVendors } from '@/lib/data/vendors'
import { requireUser } from '@/lib/auth/session'
import { Button, EmptyState, Input, PageHeader, StatusBadge } from '@/components/ui/primitives'
import { money, formatDate } from '@/lib/format'
import { canManageOrders } from '@/lib/domain/procurement'

export const metadata = { title: 'Catalogue · Nerige Story' }

interface ProductRow {
  id: string
  sku: string
  title: string
  colour: string | null
  fabric: string | null
  status: string
  cost_price: string | null
  last_ordered_at: string | null
  units_ordered_total: number
  units_sold_30d: number | null
  sales_synced_at: string | null
  vendors: { display_name: string; code: string } | null
  product_series: { name: string } | null
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vendor?: string }>
}) {
  const user = await requireUser()
  const { q, vendor } = await searchParams
  const [data, { vendors }] = await Promise.all([
    listProducts({ vendorFilter: vendor, q }),
    listVendors(),
  ])

  const products = data as unknown as ProductRow[]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Catalogue"
        subtitle="Every SKU we buy, and who makes it. These are the codes vendors print on labels."
        action={
          canManageOrders(user.role) ? (
            <Link href="/catalogue/new">
              <Button>Add SKU</Button>
            </Link>
          ) : undefined
        }
      />

      <form className="flex flex-wrap gap-2">
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search code, name or colour…"
          className="max-w-xs"
          aria-label="Search the catalogue"
        />
        <select
          name="vendor"
          defaultValue={vendor ?? ''}
          aria-label="Filter by vendor"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.display_name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>


      {products.length === 0 && (
        <EmptyState
          title={q || vendor ? 'Nothing matches' : 'The catalogue is empty'}
          body={
            q || vendor
              ? 'Try a different code, name or vendor.'
              : 'Add the SKUs you already buy. Once they are here, vendors can look up their own codes instead of asking.'
          }
          action={
            canManageOrders(user.role) ? (
              <Link href="/catalogue/new">
                <Button>Add SKU</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {products.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Vendor</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
                <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                  Last ordered
                </th>
                <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                  Sold 30d
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{p.title}</span>
                    {p.colour && <span className="ml-1 text-stone-500">· {p.colour}</span>}
                    {p.product_series && (
                      <span className="block text-xs text-stone-400">{p.product_series.name}</span>
                    )}
                    {p.status !== 'active' && (
                      <span className="mt-1 inline-block">
                        <StatusBadge status={p.status} />
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-stone-600 sm:table-cell">
                    {p.vendors?.display_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(p.cost_price)}</td>
                  <td className="hidden px-4 py-2.5 text-right text-stone-600 md:table-cell">
                    {p.last_ordered_at ? formatDate(p.last_ordered_at) : 'Never'}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right tabular-nums md:table-cell">
                    {/* An unsynced product shows a dash, not a zero. A zero here
                        would read as "nobody bought it", which is a very
                        different claim from "we do not know yet". */}
                    {p.sales_synced_at ? (p.units_sold_30d ?? 0) : <span className="text-stone-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {products.length > 0 && products.every((p) => !p.sales_synced_at) && (
        <p className="text-xs text-stone-500">
          Sales figures fill in once the Shopify sync is connected. Until then the column stays
          blank rather than showing zeroes.
        </p>
      )}
    </div>
  )
}
