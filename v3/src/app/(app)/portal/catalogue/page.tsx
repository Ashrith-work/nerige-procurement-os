import Link from 'next/link'
import { requireVendor } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, type Dictionary } from '@/lib/i18n'
import { DesignCard } from '@/components/design-card'
import { StockLine } from '@/components/stock-line'
import { PrintButton } from '@/components/print-button'
import { Input, Select, Button, PageHeader, EmptyState } from '@/components/ui/primitives'

export const metadata = { title: 'My designs · Nerige' }

/** Large cards, so a page is a page and not a scroll of a thousand. */
const PAGE_SIZE = 48

interface Design {
  sku: string
  title: string | null
  description: string | null
  image_url: string | null
  qty_available: number
  stock_synced_at: string | null
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
 * What she can see is not decided here. `products` has RLS forced and
 * `products_select_own` scopes every row to her own vendor_id, so this page
 * cannot show another weaver's designs even if it forgot to filter. The queries
 * below carry no vendor predicate at all, deliberately — the database is the
 * boundary, not this file.
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
  collection,
  colour,
  fabric,
  search,
  pageNumber,
}: {
  supabase: Supabase
  t: Dictionary
  collection: string
  colour: string
  fabric: string
  search: string
  pageNumber: number
}) {
  let query = supabase
    .from('products')
    .select('sku, title, description, image_url, qty_available, stock_synced_at', {
      count: 'exact',
    })

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
            {t.catalogue.designsCount.replace('{n}', String(total))}
          </span>
        </h2>
      </div>

      {/* One column on a phone, more where there is room. Cards never split
          across a column or a printed page. */}
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 print:columns-2">
        {designs.map((d) => (
          <div key={d.sku} className="mb-4">
            <DesignCard
              sku={d.sku}
              title={d.title}
              description={d.description}
              imageUrl={d.image_url}
              footer={<StockLine qty={d.qty_available} syncedAt={d.stock_synced_at} t={t} />}
            />
          </div>
        ))}
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
            {t.catalogue.page.replace('{n}', String(pageNumber)).replace('{total}', String(pages))}
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
