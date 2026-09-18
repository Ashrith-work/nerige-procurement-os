import Link from 'next/link'
import { requireStaff } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary } from '@/lib/i18n'
import { Button, Input, PageHeader } from '@/components/ui/primitives'
import { Photo } from '@/components/design-card'
import { StockLine } from '@/components/stock-line'
import { resolveProductImage, type CropRect } from '@/lib/products/image'

export const metadata = { title: 'Look something up' }

/** A row of `public.lookup_products()`. Named columns only — there is no cost. */
interface LookupRow {
  sku: string
  title: string | null
  seq: number | null
  unique_code: number | null
  vendor_code: string
  vendor_name: string
  image_url: string | null
  image_urls: string[] | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: CropRect | null
  crop_mode: string | null
  qty_available: number
  stock_synced_at: string | null
  units_90d: number
  last_sold_at: string | null
  is_active: boolean
}

/**
 * "Is this saree in stock?" — answered on the phone, by customer support.
 *
 * Search by a fragment of the SKU, the Unique Code off a label, or words from
 * the title. Reads through `public.lookup_products()`, a SECURITY DEFINER
 * function that names its columns, because support holds no row access to
 * products: a row policy would have handed over the cost column with the row.
 *
 * A GET form, so a result is a URL that can be pasted into a chat to a
 * colleague, and the back button returns to the list.
 */
export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  await requireStaff()
  const t = getDictionary('en')
  const raw = (await searchParams).q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? ''

  let rows: LookupRow[] = []
  let error: string | null = null

  if (q) {
    const supabase = await createClient()
    const res = await supabase.rpc('lookup_products', { p_query: q, p_limit: 40 })
    if (res.error) error = res.error.message
    rows = (res.data ?? []) as LookupRow[]
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Look something up"
        subtitle="Stock and orders for any saree, while you are on the phone."
      />

      <form method="get" className="flex gap-2" role="search">
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="SKU, Unique Code or title"
          aria-label="SKU, Unique Code or title"
          autoComplete="off"
          autoFocus
        />
        <Button type="submit">Search</Button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          The search did not run. Try it again; if it keeps failing, tell a developer: {error}
        </p>
      )}

      {!q && !error && (
        <p className="text-sm text-stone-600">
          Type any part of a SKU, the Unique Code written on the label, or a few words of the name.
          The weaver&rsquo;s code and the number at the end are usually enough.
        </p>
      )}

      {q && !error && rows.length === 0 && (
        <p className="text-sm text-stone-600">
          Nothing matches &ldquo;{q}&rdquo;. Try part of the SKU — the weaver&rsquo;s code and the
          number at the end are usually enough.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
          {rows.map((r) => {
            const image = resolveProductImage({
              imageUrls: r.image_urls,
              displayImagePosition: r.display_image_position,
              manualImageUrl: r.manual_image_url,
              cropJson: r.crop_json,
              cropMode: r.crop_mode,
              imageUrl: r.image_url,
            })
            return (
              <li key={r.sku}>
                <Link
                  // SKUs can contain spaces ('DMG - 157'); encoded so the link
                  // survives and the detail page decodes it back verbatim.
                  href={`/lookup/${encodeURIComponent(r.sku)}`}
                  className="flex gap-4 px-4 py-3 hover:bg-stone-50"
                >
                  <Photo url={image.url} alt={r.title ?? r.sku} crop={image.crop} className="h-24 w-20 shrink-0" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block font-mono text-base font-medium break-words text-stone-900">
                      {r.sku}
                    </span>
                    {r.title && <span className="block text-sm text-stone-700">{r.title}</span>}
                    <span className="block text-xs text-stone-600">
                      {r.vendor_name}
                      {(r.unique_code ?? r.seq) !== null && ` · Unique Code ${r.unique_code ?? r.seq}`}
                      {!r.is_active && ' · Shopify no longer lists this'}
                    </span>
                    <StockLine qty={r.qty_available} syncedAt={r.stock_synced_at} t={t} />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
