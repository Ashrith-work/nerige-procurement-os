import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { applySort, resolveSort, resolveWindow } from '@/lib/reorder/sort'
import { Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { FilterBar, type VendorOption, type CollectionOption } from './filter-bar'
import { DesignTile, type Design } from './design-tile'
import { SelectionFooter } from './selection-footer'

export const metadata = { title: 'Reorder · Nerige' }

/** Tiles are small; a page of them is still a page. */
const PAGE_SIZE = 120

/**
 * Pooja's screen. A grid of photographs, not a list.
 *
 * It should feel like browsing nerigestory.com, except tapping means "make this
 * again". Everything on it is in service of that: the tile is the photograph,
 * the code sits under it small enough not to compete, and the description is
 * behind an info button rather than on the tile.
 *
 * Nothing renders until a vendor is chosen. That is not a loading state, it is
 * the design — 8,891 designs is not a grid anyone can browse, and the way this
 * work actually happens is one weaver at a time.
 *
 * The default order is now the sales ladder rather than `seq`: best selling
 * first, and everything unsold for a year beneath everything that has sold. A
 * saree that sold out yesterday and one that has not moved since 2024 both read
 * `qty_available: 0`, and until Phase 4 the grid could not tell them apart.
 */
export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{
    vendor?: string
    c?: string
    q?: string
    sort?: string
    w?: string
    page?: string
  }>
}) {
  const params = await searchParams
  await requireProcurement()
  const supabase = await createClient()

  const clean = (v: string | undefined) => (v ?? '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()
  const vendorCode = clean(params.vendor).toUpperCase()
  const collection = clean(params.c)
  const search = clean(params.q)
  const sort = resolveSort(params.sort)
  const window = resolveWindow(params.w)
  const page = Math.max(1, Number(params.page) || 1)

  // Weavers, ordered by how much of theirs is waiting to be reordered. Pooja
  // opens this to work through a backlog, so the biggest backlog goes first.
  const [{ data: vendorRows }, { data: collectionRows }] = await Promise.all([
    supabase.from('vendors').select('id, code, display_name').is('deleted_at', null),
    supabase.from('vendor_collections').select('vendor_id, collection, reorder_count'),
  ])

  const poolByVendor = new Map<string, number>()
  for (const row of collectionRows ?? []) {
    poolByVendor.set(row.vendor_id, (poolByVendor.get(row.vendor_id) ?? 0) + row.reorder_count)
  }

  const vendors: VendorOption[] = (vendorRows ?? [])
    .map((v) => ({
      code: v.code as string,
      displayName: v.display_name as string,
      poolCount: poolByVendor.get(v.id) ?? 0,
      id: v.id as string,
    }))
    .filter((v) => v.poolCount > 0)
    .sort((a, b) => b.poolCount - a.poolCount)

  const chosen = (vendorRows ?? []).find((v) => v.code === vendorCode)

  const collections: CollectionOption[] = chosen
    ? (collectionRows ?? [])
        .filter((r) => r.vendor_id === chosen.id && r.reorder_count > 0)
        .map((r) => ({ collection: r.collection as string, reorderCount: r.reorder_count as number }))
        .sort((a, b) => b.reorderCount - a.reorderCount)
    : []

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title="Reorder" subtitle="Tap a saree to have it made again." />

      <FilterBar
        vendors={vendors}
        collections={collections}
        vendor={vendorCode}
        collection={collection}
        q={search}
        sort={sort}
        window={window}
      />

      {!chosen ? (
        <EmptyState
          title="Choose a vendor"
          body="One weaver at a time. Nearly nine thousand sarees are waiting to be reordered, and no grid shows them all at once."
        />
      ) : (
        <Grid
          supabase={supabase}
          vendorId={chosen.id}
          vendorCode={chosen.code}
          collection={collection}
          search={search}
          sort={sort}
          window={window}
          page={page}
        />
      )}

      <SelectionFooter />
    </div>
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>

async function Grid({
  supabase,
  vendorId,
  vendorCode,
  collection,
  search,
  sort,
  window,
  page,
}: {
  supabase: Supabase
  vendorId: string
  vendorCode: string
  collection: string
  search: string
  sort: ReturnType<typeof resolveSort>
  window: ReturnType<typeof resolveWindow>
  page: number
}) {
  let query = supabase
    .from('products')
    // No description: nothing renders it any more, and on a 120-tile page the
    // Shopify marketing copy is by far the largest thing on the wire.
    .select(
      `sku, title, image_url, image_urls, display_image_position, manual_image_url,
       crop_json, crop_mode, price, qty_available, stock_synced_at,
       units_30d, units_60d, units_90d, tier_30, tier_60, tier_90, sales_synced_at`,
      { count: 'exact' },
    )
    .eq('vendor_id', vendorId)
    // The pool: sold out, or down to the last piece. Note what is absent — no
    // filter on shopify_status. Shopify drafts a product the moment it sells
    // out, and those are the strongest reorder candidates there are.
    .in('qty_available', [0, 1])
    // Designs Shopify has stopped returning cannot be reordered; the photograph
    // and the price behind them are no longer maintained anywhere.
    .eq('is_active', true)

  if (collection) query = query.eq('collection', collection)
  if (search) query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`)

  const { data, count } = await applySort(query, sort, window).range(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE - 1,
  )

  const designs = (data ?? []) as Design[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (designs.length === 0) {
    return (
      <EmptyState
        title="Nothing here"
        body="Nothing in this vendor and collection is sold out or down to its last piece."
      />
    )
  }

  const syncedAt = designs.find((d) => d.stock_synced_at)?.stock_synced_at

  const href = (n: number) => {
    const p = new URLSearchParams({ vendor: vendorCode })
    if (collection) p.set('c', collection)
    if (search) p.set('q', search)
    p.set('sort', sort)
    p.set('w', String(window))
    if (n > 1) p.set('page', String(n))
    return `/reorder?${p.toString()}`
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-stone-500">
        <span className="tabular-nums">{total.toLocaleString('en-IN')}</span> to reorder
        {syncedAt && (
          <>
            <span className="text-stone-400"> · </span>
            stock checked {formatDistanceToNow(new Date(syncedAt))} ago
          </>
        )}
      </p>

      {/* Two columns on a phone, five where there is room. */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {designs.map((d) => (
          <li key={d.sku}>
            <DesignTile design={d} vendorCode={vendorCode} window={window} />
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3 pt-2">
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
    </section>
  )
}
