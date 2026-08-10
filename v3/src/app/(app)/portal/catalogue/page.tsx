import Link from 'next/link'
import { requireVendor } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, interpolate, formatCount, type Dictionary, type Locale } from '@/lib/i18n'
import { DesignCard } from '@/components/design-card'
import { StockLine } from '@/components/stock-line'
import { SalesBadges } from '@/components/sales-badges'
import { resolveProductImage, type CropRect } from '@/lib/products/image'
import type { Tier } from '@/lib/reorder/sort'
import { PrintButton } from '@/components/print-button'
import { Input, Select, Button, PageHeader, EmptyState } from '@/components/ui/primitives'

export const metadata = { title: 'My designs · Nerige' }

/** Large cards, so a page is a page and not a scroll of a thousand. */
const PAGE_SIZE = 48

interface Design {
  sku: string
  title: string | null
  image_url: string | null
  image_urls: string[] | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: CropRect | null
  crop_mode: string | null
  qty_available: number
  stock_synced_at: string | null
  units_90d: number | null
  tier_90: number | null
  sales_synced_at: string | null
}

interface Facet {
  facet: string
  value: string
  design_count: number
}

/**
 * Every design the portal holds for this weaver.
 *
 * This screen used to open on a list of collections and refuse to render cards
 * until one was chosen, on the reasoning that 2,365 designs is not a grid
 * anyone browses. That was the wrong trade: a weaver looking for a saree she
 * half-remembers does not know which collection it was filed under, and being
 * made to guess before seeing anything reads as an empty portal.
 *
 * So it opens on everything, newest first, and narrows by collection, colour or
 * fabric — the three things actually encoded in the SKU. Pagination handles the
 * volume; the filters handle the finding.
 *
 * For a weaver, what she can see is not decided here: `products` has RLS forced
 * and `products_select_own` scopes every row to her own vendor_id, so this page
 * could not show another weaver's designs even if it forgot to filter.
 *
 * The explicit `vendor_id` predicate below exists for the other caller. When
 * Pooja opens this screen as a weaver she is still an admin, and
 * `products_select_internal` returns all 9,827 designs — the scope has to be
 * stated because RLS is not narrowing it. `vendor_facets` is filtered for the
 * same reason.
 */
export default async function VendorCatalogue({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; colour?: string; fabric?: string; q?: string; page?: string }>
}) {
  const params = await searchParams
  const user = await requireVendor()
  const t = getDictionary(user.locale)
  const supabase = await createClient()

  // PostgREST filters are a grammar, and `,` `(` `)` `*` are operators in it.
  // Anything else would let a search box rewrite the query.
  const clean = (v: string | undefined) => (v ?? '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()

  const collection = clean(params.c)
  const colour = clean(params.colour)
  const fabric = clean(params.fabric)
  const search = clean(params.q)
  const pageNumber = Math.max(1, Number(params.page) || 1)

  const { data: facetRows } = await supabase
    .from('vendor_facets')
    .select('facet, value, design_count')
    .eq('vendor_id', user.vendorId)
    .order('design_count', { ascending: false })

  const facets = (facetRows ?? []) as Facet[]
  const of = (kind: string) => facets.filter((f) => f.facet === kind)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="no-print">
        <PageHeader
          title={t.catalogue.title}
          subtitle={t.catalogue.everyDesign}
          action={<PrintButton label={t.catalogue.print} />}
        />
      </div>

      {/* A plain GET form. Every filter lands in the URL, so a weaver can
          bookmark "my green Vintage sarees" and send the link to someone. */}
      <form action="/portal/catalogue" className="no-print space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <FacetSelect
            name="c"
            label={t.catalogue.allCollections}
            value={collection}
            options={of('collection')}
          />
          <FacetSelect
            name="colour"
            label={t.catalogue.allColours}
            value={colour}
            options={of('colour')}
          />
          <FacetSelect
            name="fabric"
            label={t.catalogue.allFabrics}
            value={fabric}
            options={of('fabric')}
          />
        </div>

        <div className="flex gap-2">
          <Input
            name="q"
            type="search"
            defaultValue={search}
            placeholder={t.catalogue.search}
            aria-label={t.catalogue.search}
          />
          <Button type="submit" variant="secondary">
            {t.catalogue.searchAction}
          </Button>
          {(collection || colour || fabric || search) && (
            <Link href="/portal/catalogue">
              <Button type="button" variant="ghost">
                {t.catalogue.clear}
              </Button>
            </Link>
          )}
        </div>
      </form>

      <Cards
        supabase={supabase}
        t={t}
        locale={user.locale}
        vendorId={user.vendorId}
        collection={collection}
        colour={colour}
        fabric={fabric}
        search={search}
        pageNumber={pageNumber}
      />
    </div>
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Counts sit in the option text on purpose. "GRN (465)" tells her the filter is
 * worth applying before she applies it; a bare list of codes does not.
 */
function FacetSelect({
  name,
  label,
  value,
  options,
}: {
  name: string
  label: string
  value: string
  options: Facet[]
}) {
  if (options.length === 0) return null

  return (
    <Select name={name} defaultValue={value} aria-label={label}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value} ({o.design_count})
        </option>
      ))}
    </Select>
  )
}

async function Cards({
  supabase,
  t,
  locale,
  vendorId,
  collection,
  colour,
  fabric,
  search,
  pageNumber,
}: {
  supabase: Supabase
  t: Dictionary
  locale: Locale
  vendorId: string
  collection: string
  colour: string
  fabric: string
  search: string
  pageNumber: number
}) {
  let query = supabase
    .from('products')
    .select(
      `sku, title, image_url, image_urls, display_image_position, manual_image_url,
       crop_json, crop_mode, qty_available, stock_synced_at,
       units_90d, tier_90, sales_synced_at`,
      { count: 'exact' },
    )
    .eq('vendor_id', vendorId)
    // Designs Shopify has stopped returning are not hers to be asked about.
    .eq('is_active', true)

  if (collection) query = query.eq('collection', collection)
  if (colour) query = query.eq('colour_code', colour)
  if (fabric) query = query.eq('fabric', fabric)
  if (search) query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`)

  // seq descending is newest first — the same default sort as the reorder grid.
  const { data, count } = await query
    .order('seq', { ascending: false })
    .range((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE - 1)

  const designs = (data ?? []) as Design[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const applied = [collection, colour, fabric].filter(Boolean).join(' · ')
  const heading = search ? `${t.catalogue.resultsFor} “${search}”` : applied || t.catalogue.title

  if (designs.length === 0) {
    return (
      <EmptyState
        title={heading}
        body={t.catalogue.noResults}
        action={
          <Link href="/portal/catalogue">
            <Button variant="secondary">{t.catalogue.clear}</Button>
          </Link>
        }
      />
    )
  }

  const href = (n: number) => {
    const p = new URLSearchParams()
    if (collection) p.set('c', collection)
    if (colour) p.set('colour', colour)
    if (fabric) p.set('fabric', fabric)
    if (search) p.set('q', search)
    if (n > 1) p.set('page', String(n))
    const qs = p.toString()
    return qs ? `/portal/catalogue?${qs}` : '/portal/catalogue'
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-stone-900">
          {heading}{' '}
          <span className="font-normal text-stone-400 tabular-nums">
            {interpolate(t.catalogue.designsCount, { n: formatCount(total, locale) })}
          </span>
        </h2>
      </div>

      {/* One column on a phone, more where there is room. Cards never split
          across a column or a printed page. */}
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 print:columns-2">
        {designs.map((d) => {
          const image = resolveProductImage({
            imageUrls: d.image_urls,
            displayImagePosition: d.display_image_position,
            manualImageUrl: d.manual_image_url,
            cropJson: d.crop_json,
            cropMode: d.crop_mode,
            imageUrl: d.image_url,
          })

          return (
            <div key={d.sku} className="mb-4">
              <DesignCard
                sku={d.sku}
                title={d.title}
                imageUrl={image.url}
                crop={image.crop}
                footer={
                  <StockLine
                    qty={d.qty_available}
                    syncedAt={d.stock_synced_at}
                    t={t}
                    locale={locale}
                  />
                }
                badges={
                  <SalesBadges
                    units={d.units_90d ?? 0}
                    tier={d.sales_synced_at ? ((d.tier_90 as Tier | null) ?? null) : null}
                    window={90}
                    t={t}
                    locale={locale}
                  />
                }
              />
            </div>
          )
        })}
      </div>

      {pages > 1 && (
        <nav className="no-print flex items-center justify-between gap-3 pt-2">
          {pageNumber > 1 ? (
            <Link href={href(pageNumber - 1)}>
              <Button variant="secondary">{t.catalogue.previous}</Button>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-stone-500 tabular-nums">
            {interpolate(t.catalogue.page, {
              n: formatCount(pageNumber, locale),
              total: formatCount(pages, locale),
            })}
          </span>
          {pageNumber < pages ? (
            <Link href={href(pageNumber + 1)}>
              <Button variant="secondary">{t.catalogue.next}</Button>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  )
}
