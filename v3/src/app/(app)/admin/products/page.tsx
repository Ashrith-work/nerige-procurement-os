import Link from 'next/link'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { resolveProductImage, cropStyle, sizedImage } from '@/lib/products/image'
import { PageHeader, Input, Select, Button, EmptyState } from '@/components/ui/primitives'
import {
  SELL_THROUGH_PERIODS,
  resolvePeriod,
  sellThrough,
  unitsColumnFor,
} from '@/lib/products/sell-through'
import { SellThroughBadge } from '@/components/sell-through-badge'
import { StockBadge } from '@/components/stock-badge'

export const metadata = { title: 'Products · Nerige' }

const PAGE_SIZE = 60

interface Row {
  sku: string
  title: string | null
  vendor_id: string
  qty_available: number
  units_30d: number | null
  units_60d: number | null
  units_90d: number | null
  units_365d: number | null
  sales_synced_at: string | null
  is_active: boolean
  image_urls: string[] | null
  image_url: string | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: { x: number; y: number; w: number; h: number } | null
  crop_mode: string | null
}

/**
 * Every design Nerige holds, across every weaver.
 *
 * Reachable on its own as well as from inside a vendor, because fixing
 * photographs is work done in a run — an afternoon of correcting crops across
 * whatever looks wrong — and being made to pick a weaver first would mean
 * fifty-three visits to do one pass.
 *
 * Inactive products are shown, greyed. They are designs Shopify stopped
 * returning, and the reason to see them here is that "where did that saree go"
 * is otherwise unanswerable from inside the portal.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    vendor?: string
    q?: string
    page?: string
    inactive?: string
    period?: string
  }>
}) {
  const params = await searchParams
  await requireProcurement()
  const supabase = await createClient()

  const clean = (v: string | undefined) => (v ?? '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()
  const vendorCode = clean(params.vendor).toUpperCase()
  const search = clean(params.q)
  const page = Math.max(1, Number(params.page) || 1)
  const showInactive = params.inactive === '1'
  const period = resolvePeriod(params.period)
  const unitsColumn = unitsColumnFor(period)

  const { data: vendorRows } = await supabase
    .from('vendors')
    .select('id, code, display_name')
    .is('deleted_at', null)
    .order('code')

  const vendors = vendorRows ?? []
  const chosen = vendors.find((v) => v.code === vendorCode)

  let query = supabase
    .from('products')
    .select(
      'sku, title, vendor_id, qty_available, is_active, image_urls, image_url, display_image_position, manual_image_url, crop_json, crop_mode, units_30d, units_60d, units_90d, units_365d, sales_synced_at',
      { count: 'exact' },
    )

  if (chosen) query = query.eq('vendor_id', chosen.id)
  if (!showInactive) query = query.eq('is_active', true)
  if (search) query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`)

  const { data, count } = await query
    .order('seq', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  const rows = (data ?? []) as Row[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const href = (n: number) => {
    const p = new URLSearchParams()
    if (vendorCode) p.set('vendor', vendorCode)
    if (search) p.set('q', search)
    if (showInactive) p.set('inactive', '1')
    p.set('period', String(period))
    if (n > 1) p.set('page', String(n))
    const qs = p.toString()
    return qs ? `/admin/products?${qs}` : '/admin/products'
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="All products"
        subtitle={`${total.toLocaleString('en-IN')} designs${chosen ? ` · ${chosen.display_name}` : ''}`}
      />

      <form action="/admin/products" className="flex flex-wrap gap-2">
        <Select name="vendor" defaultValue={vendorCode} className="w-auto min-w-44">
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.code}>
              {v.code} — {v.display_name}
            </option>
          ))}
        </Select>
        <Input
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Code or name"
          className="w-auto min-w-52 flex-1"
        />
        {/*
          * The sell-through period. Submits with the rest of the filter form
          * rather than navigating on change, so choosing a period and typing a
          * search is one round trip instead of two.
          */}
        <Select name="period" defaultValue={String(period)} className="w-auto min-w-40">
          {SELL_THROUGH_PERIODS.map((d) => (
            <option key={d} value={d}>
              Sell-through · {d} days
            </option>
          ))}
        </Select>
        <label className="flex min-h-11 items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} />
          Include inactive
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nothing here" body="No design matches that." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((row) => {
            const image = resolveProductImage({
              imageUrls: row.image_urls,
              displayImagePosition: row.display_image_position,
              manualImageUrl: row.manual_image_url,
              cropJson: row.crop_json,
              cropMode: row.crop_mode,
              imageUrl: row.image_url,
            })

            return (
              <li key={row.sku}>
                <Link
                  href={`/admin/products/${encodeURIComponent(row.sku)}`}
                  className={`block space-y-1.5 rounded-lg border border-stone-200 p-2 hover:border-stone-400 ${
                    row.is_active ? '' : 'opacity-50'
                  }`}
                >
                  <div className="relative h-32 w-full overflow-hidden rounded-md bg-stone-100">
                    {image.url && (
                      // A manual override can be on any host; next/image
                      // refuses anything outside remotePatterns.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sizedImage(image.url, 400) ?? image.url}
                        alt={row.sku}
                        className="absolute max-w-none object-cover"
                        style={cropStyle(image.crop)}
                      />
                    )}
                    <StockBadge qty={row.qty_available} />
                    {image.isManual && (
                      <span className="absolute top-1 right-1 rounded bg-stone-900/80 px-1 text-[10px] text-white">
                        edited
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs break-words text-stone-900">{row.sku}</p>
                  {/*
                    * Withheld until a sales sync has run at all. Without this a
                    * fresh database shows 0% against every design, which reads
                    * as "nothing sells" rather than "we have not counted yet".
                    */}
                  {row.sales_synced_at && (
                    <SellThroughBadge
                      value={sellThrough(row[unitsColumn], row.qty_available)}
                      period={period}
                    />
                  )}
                  {!row.is_active && <p className="text-[11px] text-amber-700">Not in Shopify</p>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={href(page - 1)}>
              <Button variant="secondary">Previous</Button>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-stone-500 tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)}>
              <Button variant="secondary">Next</Button>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  )
}
