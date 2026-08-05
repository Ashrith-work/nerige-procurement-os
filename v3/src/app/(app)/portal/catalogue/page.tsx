import Link from 'next/link'
import { requireVendor } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, type Dictionary } from '@/lib/i18n'
import { DesignCard } from '@/components/design-card'
import { StockLine } from '@/components/stock-line'
import { PrintButton } from '@/components/print-button'
import { Input, Button, PageHeader, EmptyState } from '@/components/ui/primitives'

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

/**
 * Every design the portal holds for this weaver. The same card as the order
 * screen, grouped by collection, searchable and printable.
 *
 * Collection is a choice rather than a default, for the same reason vendor is
 * required on Pooja's grid: HDR alone has over two thousand designs and no
 * phone renders that. With nothing chosen this shows the collections
 * themselves, which IS the grouping — one tap, then the cards.
 *
 * Search cuts across all of them, because a weaver looking up one code does not
 * know or care which collection it was filed under.
 */
export default async function VendorCatalogue({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; page?: string }>
}) {
  const { c, q, page } = await searchParams
  const user = await requireVendor()
  const t = getDictionary(user.locale)
  const supabase = await createClient()

  // PostgREST filters are a grammar, and `,` `(` `)` `*` are operators in it.
  // Anything else would let a search box rewrite the query.
  const search = (q ?? '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()
  const collection = (c ?? '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()
  const pageNumber = Math.max(1, Number(page) || 1)

  const showingCards = Boolean(collection) || Boolean(search)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="no-print">
        <PageHeader
          title={t.catalogue.title}
          subtitle={t.catalogue.everyDesign}
          action={showingCards ? <PrintButton label={t.catalogue.print} /> : undefined}
        />
      </div>

      <form action="/portal/catalogue" className="no-print flex gap-2">
        {collection && <input type="hidden" name="c" value={collection} />}
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
      </form>

      {showingCards ? (
        <Cards
          supabase={supabase}
          t={t}
          collection={collection}
          search={search}
          pageNumber={pageNumber}
        />
      ) : (
        <CollectionIndex supabase={supabase} t={t} />
      )}
    </div>
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/** The grouping itself: her collections, with how much is in each. */
async function CollectionIndex({ supabase, t }: { supabase: Supabase; t: Dictionary }) {
  const { data } = await supabase
    .from('vendor_collections')
    .select('collection, design_count')
    .order('design_count', { ascending: false })

  const collections = data ?? []

  if (collections.length === 0) {
    return <EmptyState title={t.catalogue.collections} body={t.catalogue.noResults} />
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium text-stone-900">{t.catalogue.collections}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((row) => (
          <li key={row.collection}>
            <Link
              href={`/portal/catalogue?c=${encodeURIComponent(row.collection)}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-stone-200 px-4 py-3 hover:border-stone-300"
            >
              <span className="font-mono text-base text-stone-900">{row.collection}</span>
              <span className="text-sm text-stone-500 tabular-nums">
                {t.catalogue.designsCount.replace('{n}', String(row.design_count))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

async function Cards({
  supabase,
  t,
  collection,
  search,
  pageNumber,
}: {
  supabase: Supabase
  t: Dictionary
  collection: string
  search: string
  pageNumber: number
}) {
  let query = supabase
    .from('products')
    .select('sku, title, description, image_url, qty_available, stock_synced_at', {
      count: 'exact',
    })

  if (collection) query = query.eq('collection', collection)
  if (search) query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`)

  // seq descending is newest first — the same default sort as the reorder grid.
  const { data, count } = await query
    .order('seq', { ascending: false })
    .range((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE - 1)

  const designs = (data ?? []) as Design[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (designs.length === 0) {
    return (
      <EmptyState
        title={search ? `${t.catalogue.resultsFor} “${search}”` : collection}
        body={t.catalogue.noResults}
        action={
          <Link href="/portal/catalogue">
            <Button variant="secondary">{t.catalogue.backToCollections}</Button>
          </Link>
        }
      />
    )
  }

  const href = (n: number) => {
    const p = new URLSearchParams()
    if (collection) p.set('c', collection)
    if (search) p.set('q', search)
    if (n > 1) p.set('page', String(n))
    return `/portal/catalogue?${p.toString()}`
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium text-stone-900">
          {search ? `${t.catalogue.resultsFor} “${search}”` : collection}{' '}
          <span className="font-normal text-stone-400 tabular-nums">
            {t.catalogue.designsCount.replace('{n}', String(total))}
          </span>
        </h2>
        {collection && (
          <Link href="/portal/catalogue" className="no-print text-sm text-stone-500 underline">
            {t.catalogue.backToCollections}
          </Link>
        )}
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
