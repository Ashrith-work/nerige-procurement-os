import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, EmptyState, PageHeader, cn } from '@/components/ui/primitives'
import { resolveProductImage, sizedImage } from '@/lib/products/image'
import { SKU_VOCAB_TYPES, VOCAB_LABELS, VOCAB_TYPES, type VocabType } from '../../intake/_lib/data'
import { CodeRow, type CodeRowData } from './code-row'
import { AddValueForm } from './add-value-form'

export const metadata = { title: 'Saree words' }

interface MasterRow {
  type: VocabType
  code: string
  value: string | null
  status: 'unnamed' | 'named' | 'ignored'
  active: boolean
  design_count: number
  examples: { sku: string; title: string | null }[] | null
}

/**
 * Naming the vocabulary every intake dropdown is built from.
 *
 * The sync discovers collection, fabric and colour codes from SKU segments
 * (migration 024) and can know nothing about what they mean: `BRHM` is in the
 * SKU, whether it means "Bridal" or "Brahmin" is not. Until a code is named it
 * is not offered at intake, so this screen is what stands between the
 * catalogue and the new-saree form.
 *
 * COMMONEST FIRST. A code on 3,991 designs matters more than one on four, and a
 * hundred codes cannot be named in one sitting. The three commonest are `GEN`
 * and `XX` — "unspecified" — which is what Ignore is for, if that is the
 * business answer.
 *
 * Owner only, matching `master_data_admin_write`. Everyone else reads the
 * vocabulary; naming it decides what every future SKU is allowed to say.
 */
export default async function MasterDataPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireAdmin()
  const params = await searchParams
  const type: VocabType = (VOCAB_TYPES as readonly string[]).includes(params.type ?? '') ? (params.type as VocabType) : 'collection'

  const supabase = await createClient()
  const [{ data, error }, { data: drafts }] = await Promise.all([
    supabase
      .from('master_data')
      .select('type, code, value, status, active, design_count, examples')
      .order('design_count', { ascending: false })
      .order('code'),
    supabase
      .from('product_intakes')
      .select('unique_code, draft_note, created_at')
      .eq('status', 'DRAFT')
      .order('created_at', { ascending: true })
      .limit(20),
  ])

  const all = (data ?? []) as MasterRow[]
  const unnamedByType = new Map<VocabType, number>()
  for (const r of all) if (r.status === 'unnamed') unnamedByType.set(r.type, (unnamedByType.get(r.type) ?? 0) + 1)

  const rows = all.filter((r) => r.type === type)
  const unnamed = rows.filter((r) => r.status === 'unnamed')
  const named = rows
    .filter((r) => r.status === 'named')
    .sort((a, b) => Number(b.active) - Number(a.active) || b.design_count - a.design_count || (a.value ?? '').localeCompare(b.value ?? ''))
  const ignored = rows.filter((r) => r.status === 'ignored')

  // Photographs for the codes that need a name — that is where a picture
  // answers a question. Named rows show their example SKUs only.
  const exampleSkus = unnamed.flatMap((r) => (r.examples ?? []).slice(0, 3).map((e) => e.sku))
  const { data: products } = exampleSkus.length
    ? await supabase
        .from('products')
        .select('sku, title, image_urls, image_url, display_image_position, manual_image_url, crop_json, crop_mode')
        .in('sku', exampleSkus)
    : { data: [] }
  const imageBySku = new Map(
    (products ?? []).map((p) => [
      p.sku as string,
      sizedImage(
        resolveProductImage({
          imageUrls: p.image_urls,
          displayImagePosition: p.display_image_position,
          manualImageUrl: p.manual_image_url,
          cropJson: p.crop_json,
          cropMode: p.crop_mode,
          imageUrl: p.image_url,
        }).url,
        200,
      ),
    ]),
  )

  const toRow = (r: MasterRow, withImages: boolean): CodeRowData => ({
    type: r.type,
    code: r.code,
    value: r.value,
    status: r.status,
    active: r.active,
    designCount: r.design_count,
    examples: withImages
      ? (r.examples ?? []).slice(0, 3).map((e) => ({ sku: e.sku, title: e.title, imageUrl: imageBySku.get(e.sku) ?? null }))
      : [],
  })

  const isSkuType = SKU_VOCAB_TYPES.includes(type)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Saree words"
        subtitle="What each code in a SKU means. Name a code once and it is offered every time a new saree is added."
      />

      {error && (
        <Alert tone="error">
          The saree words could not be loaded, so this list may be incomplete. Reload the page;
          if it keeps happening, tell a developer: {error.message}
        </Alert>
      )}

      {(drafts ?? []).length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-medium text-amber-900">
            Sarees held up waiting for a word
          </h2>
          <ul className="space-y-1 text-sm">
            {(drafts ?? []).map((d) => (
              <li key={d.unique_code as number}>
                <Link href={`/intake/${d.unique_code}`} className="font-mono text-amber-900 underline-offset-2 hover:underline">
                  #{d.unique_code as number}
                </Link>{' '}
                <span className="text-amber-800 italic">{(d.draft_note as string | null) ?? 'No note'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4" aria-label="Kinds of word">
        {VOCAB_TYPES.map((t) => {
          const count = unnamedByType.get(t) ?? 0
          return (
            <Link
              key={t}
              href={`/admin/master-data?type=${t}`}
              aria-current={t === type ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm',
                t === type ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
              )}
            >
              {VOCAB_LABELS[t]}
              {count > 0 && (
                <span className="rounded-full bg-amber-700 px-1.5 text-xs text-white tabular-nums">
                  <span className="sr-only">still to name: </span>
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <p className="text-sm text-stone-600">
        {isSkuType
          ? `${VOCAB_LABELS[type]} codes are found inside SKUs when the catalogue syncs. The code is fixed; only its name is yours.`
          : `${VOCAB_LABELS[type]} has no place in the SKU — it reaches Shopify and the product copy. These words are added here by hand.`}{' '}
        Retiring a word stops it being offered; sarees already carrying it are unaffected.
      </p>

      <section className="space-y-2">
        <h2 className="font-medium text-stone-900">
          Needs a name <span className="text-stone-600 tabular-nums">{unnamed.length}</span>
        </h2>
        {unnamed.length === 0 ? (
          <p className="text-sm text-stone-600">
            Every {VOCAB_LABELS[type].toLowerCase()} code has a name.
          </p>
        ) : (
          <ul className="rounded-xl border border-stone-200 bg-white px-4">
            {unnamed.map((r) => (
              <CodeRow key={r.code} row={toRow(r, true)} />
            ))}
          </ul>
        )}
      </section>

      <AddValueForm type={type} typeLabel={VOCAB_LABELS[type]} codeRequired={isSkuType} />

      <section className="space-y-2">
        <h2 className="font-medium text-stone-900">
          Named <span className="text-stone-600 tabular-nums">{named.length}</span>
        </h2>
        {named.length === 0 ? (
          <EmptyState
            title="Nothing named yet"
            body={`Until one ${VOCAB_LABELS[type].toLowerCase()} has a name, nobody can choose one while adding a saree. Name a code above, or add a word of your own.`}
          />
        ) : (
          <ul className="rounded-xl border border-stone-200 bg-white px-4">
            {named.map((r) => (
              <CodeRow key={r.code} row={toRow(r, false)} />
            ))}
          </ul>
        )}
      </section>

      {ignored.length > 0 && (
        <details className="space-y-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-stone-700">
            Ignored <span className="ml-2 text-stone-600 tabular-nums">{ignored.length}</span>
          </summary>
          <ul className="mt-2 rounded-xl border border-stone-200 bg-white px-4">
            {ignored.map((r) => (
              <CodeRow key={r.code} row={toRow(r, false)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
