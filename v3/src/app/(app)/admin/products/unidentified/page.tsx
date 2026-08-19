import { requireAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState } from '@/components/ui/primitives'
import { resolveProductImage } from '@/lib/products/image'
import { IdentifyRow, type UnidentifiedProduct, type VendorOption } from './identify-row'

export const metadata = { title: 'To be identified · Nerige' }

const PAGE_SIZE = 50

interface Row {
  sku: string
  title: string | null
  units_30d: number
  units_365d: number
  image_urls: string[] | null
  image_url: string | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: { x: number; y: number; w: number; h: number } | null
  crop_mode: string | null
}

/**
 * The holding pen: every saree whose SKU names no weaver.
 *
 * These are real, sellable products — `VINTWB14700` and the ninety-nine like
 * it — that arrive from Shopify with a stock number where a vendor prefix
 * should be. The sync writes them against the placeholder vendor rather than
 * inventing a weaver from the stock number (which is what it used to do, once
 * per product) or dropping them (which would hide a hundred sarees). See
 * migration 026.
 *
 * ORDERED BY WHAT THEY SELL, not by SKU. A product in here cannot be reordered:
 * /reorder's access path is vendor-then-collection, and the placeholder has no
 * weaver to send an order to. So the cost of leaving one unidentified is
 * exactly its sales, and the queue is sorted so the expensive ones are dealt
 * with first.
 *
 * ADMIN ONLY, matching `identify_product_vendor`'s own check. Assigning a
 * weaver decides who gets asked to make a saree again and who gets paid for it;
 * that is an ownership decision, not a warehouse one.
 */
export default async function UnidentifiedProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)

  const supabase = await createClient()

  const { data: placeholder } = await supabase
    .from('vendors')
    .select('id')
    .eq('is_placeholder', true)
    .maybeSingle()

  // No placeholder means migration 026 has not run. Say so plainly rather than
  // rendering an empty queue, which would read as "nothing to do".
  if (!placeholder) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="To be identified" />
        <EmptyState
          title="Not set up yet"
          body="No placeholder vendor exists, so nothing can be parked for identification. Migration 026 has not been applied to this database."
        />
      </div>
    )
  }

  const from = (page - 1) * PAGE_SIZE

  const [{ data: rows, count }, { data: vendorRows }] = await Promise.all([
    supabase
      .from('products')
      .select(
        'sku, title, units_30d, units_365d, image_urls, image_url, display_image_position, manual_image_url, crop_json, crop_mode',
        { count: 'exact' },
      )
      .eq('vendor_id', placeholder.id)
      .eq('is_active', true)
      .order('units_30d', { ascending: false })
      .order('units_365d', { ascending: false })
      .order('sku')
      .range(from, from + PAGE_SIZE - 1),
    supabase
      .from('vendors')
      .select('code, display_name')
      .is('deleted_at', null)
      .eq('is_placeholder', false)
      .order('code'),
  ])

  const total = count ?? 0

  const products: UnidentifiedProduct[] = ((rows ?? []) as Row[]).map((r) => {
    const resolved = resolveProductImage({
      imageUrls: r.image_urls,
      displayImagePosition: r.display_image_position,
      manualImageUrl: r.manual_image_url,
      cropJson: r.crop_json,
      cropMode: r.crop_mode,
      imageUrl: r.image_url,
    })
    return {
      sku: r.sku,
      title: r.title,
      imageUrl: resolved.url,
      crop: resolved.crop,
      unitsLast30Days: r.units_30d ?? 0,
      unitsLastYear: r.units_365d ?? 0,
    }
  })

  const vendors: VendorOption[] = (vendorRows ?? []).map((v) => ({
    code: v.code as string,
    displayName: (v.display_name as string) ?? (v.code as string),
  }))

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="To be identified"
        subtitle={
          total === 0
            ? 'Every saree in the catalogue has a weaver.'
            : `${total} sarees arrived with a stock number where the vendor code should be. Commonest sellers first — those are the ones that cannot be reordered until this is done.`
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="No product is sitting with the placeholder vendor."
        />
      ) : (
        <ul className="rounded border border-stone-200 bg-white px-4">
          {products.map((p) => (
            <IdentifyRow key={p.sku} product={p} vendors={vendors} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center gap-3 text-sm">
          {page > 1 && (
            <a className="underline" href={`/admin/products/unidentified?page=${page - 1}`}>
              Previous
            </a>
          )}
          <span className="text-stone-500">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <a className="underline" href={`/admin/products/unidentified?page=${page + 1}`}>
              Next
            </a>
          )}
        </nav>
      )}
    </div>
  )
}
