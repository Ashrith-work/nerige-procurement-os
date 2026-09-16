import Link from 'next/link'
import Image from 'next/image'
import { format } from 'date-fns'
import { requireIntakeReview } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives'
import { formatRupees } from '@/lib/intake/pricing'
import { parseStatusHistory } from '@/lib/intake/history'
import { resolveProductImage, sizedImage } from '@/lib/products/image'
import {
  edgesFor,
  INTAKE_LIST_COLUMNS,
  loadIntakeContext,
  loadPeople,
  loadVocabulary,
  vocabLabel,
  type IntakeListRow,
} from '../intake/_lib/data'
import { IntakeStatusBadge } from '../intake/_components/intake-status-badge'
import { TransitionControls } from '../intake/_components/transition-controls'

export const metadata = { title: 'Approve sarees · Nerige' }

const DECIDED_LIMIT = 25

/**
 * Approving and rejecting new sarees.
 *
 * Procurement and the owner only — `requireIntakeReview()` here and
 * `app.can_review_intake()` in `transition_intake` underneath. The warehouse
 * manager who submitted and photographed a saree cannot reach this screen, and
 * could not approve through the database if she found another way: the person
 * who shoots a saree is not the person who signs it off.
 *
 * Oldest first: the saree that has waited longest is holding a shelf.
 *
 * A rejection needs a reason, in the form, in the function and in a CHECK
 * constraint (migration 022) — a rejection without one is a saree the warehouse
 * cannot fix.
 */
export default async function ReviewPage() {
  const user = await requireIntakeReview()
  const supabase = await createClient()

  const [{ data: waiting, error }, { data: decided }, context, vocab] = await Promise.all([
    supabase
      .from('product_intakes')
      .select(INTAKE_LIST_COLUMNS)
      .eq('status', 'READY_FOR_REVIEW')
      .order('updated_at', { ascending: true }),
    supabase
      .from('product_intakes')
      .select('unique_code, sku, status, approval_status, approved_by, approved_at, rejection_reason')
      .in('approval_status', ['APPROVED', 'REJECTED'])
      .order('approved_at', { ascending: false })
      .limit(DECIDED_LIMIT),
    loadIntakeContext(supabase),
    loadVocabulary(supabase),
  ])

  const rows = (waiting ?? []) as unknown as IntakeListRow[]
  const decisions = (decided ?? []) as {
    unique_code: number
    sku: string | null
    status: IntakeListRow['status']
    approval_status: string
    approved_by: string | null
    approved_at: string | null
    rejection_reason: string | null
  }[]

  // A saree created in Shopify by hand and brought in by the sync has a photo
  // on `products`. Most will not, until the Drive pipeline is wired.
  const skus = rows.map((r) => r.sku).filter((s): s is string => Boolean(s))
  const { data: products } = skus.length
    ? await supabase
        .from('products')
        .select('sku, title, image_urls, image_url, display_image_position, manual_image_url, crop_json, crop_mode')
        .in('sku', skus)
    : { data: [] }
  const images = new Map(
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
        400,
      ),
    ]),
  )

  const people = await loadPeople(supabase, [
    ...rows.map((r) => r.submitted_by),
    ...rows.flatMap((r) => parseStatusHistory(r.status_history).map((h) => h.by)),
    ...decisions.map((d) => d.approved_by),
  ])
  const vendors = new Map(context.vendors.map((v) => [v.id, v]))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Approve sarees"
        subtitle={
          rows.length === 0
            ? 'Sign off or send back. Nothing is waiting.'
            : `${rows.length} saree${rows.length === 1 ? '' : 's'} waiting on you. Sign off or send back.`
        }
      />

      <Alert>
        Approving records the decision only. Publishing to the store is not automated yet: an approved saree is not
        live on Shopify until it is published there by hand. Photographs live in the saree&apos;s Drive folder, which this
        screen cannot show yet.
      </Alert>

      {error && (
        <Alert tone="error">
          The list of sarees waiting could not be loaded, so this screen may be showing none when
          some are waiting. Reload the page; if it keeps happening, tell a developer: {error.message}
        </Alert>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing is waiting on you"
          body="A saree reaches this screen when the warehouse has photographed it and sent it on. Until then there is nothing to sign off."
          action={<LinkButton href="/intake/queue">Sarees being added</LinkButton>}
        />
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const vendor = vendors.get(r.vendor_id)
            const image = r.sku ? images.get(r.sku) : null
            const sentBy = parseStatusHistory(r.status_history).findLast((h) => h.status === 'READY_FOR_REVIEW')
            return (
              <li key={r.unique_code} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
                <div className="flex gap-4">
                  <div className="relative flex h-36 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stone-100">
                    {image ? (
                      <Image src={image} alt={r.sku ?? ''} fill sizes="112px" className="object-cover" unoptimized />
                    ) : (
                      <span className="px-2 text-center text-xs text-stone-600">Photos are in Drive</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link href={`/intake/${r.unique_code}`} className="block">
                      <span className="font-mono text-2xl font-semibold tabular-nums">{r.unique_code}</span>{' '}
                      <span className="font-mono text-sm break-all text-stone-600">{r.sku}</span>
                    </Link>
                    <p className="text-sm text-stone-800">
                      {vendor ? `${vendor.displayName} (${vendor.code})` : '—'}
                    </p>
                    <p className="text-sm text-stone-600">
                      {vocabLabel(vocab, 'collection', r.collection_code)} · {vocabLabel(vocab, 'fabric', r.fabric_code)} ·{' '}
                      {vocabLabel(vocab, 'colour', r.colour_code)} · {vocabLabel(vocab, 'product_type', r.product_type_code)}
                    </p>
                    <p className="text-sm text-stone-600">
                      Cost {formatRupees(r.cost_price)} · MRP {formatRupees(r.mrp)} · {r.image_count} photo
                      {r.image_count === 1 ? '' : 's'}
                    </p>
                    <p className="text-xs text-stone-600">
                      Submitted by {people.get(r.submitted_by ?? '') ?? '—'}
                      {sentBy ? ` · sent to review ${format(new Date(sentBy.at), 'd MMM, HH:mm')}` : ''}
                      {sentBy?.by ? ` by ${people.get(sentBy.by) ?? 'someone'}` : ''}
                    </p>
                  </div>
                </div>
                <TransitionControls
                  uniqueCode={r.unique_code}
                  status={r.status}
                  edges={edgesFor(user.role, r.status).filter((e) => e.to === 'APPROVED' || e.to === 'REJECTED')}
                  imageCount={r.image_count}
                  minImagesForReview={context.minImagesForReview}
                />
              </li>
            )
          })}
        </ul>
      )}

      {decisions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-stone-700">Recently decided</h2>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {decisions.map((d) => (
              <li key={d.unique_code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <Link href={`/intake/${d.unique_code}`} className="font-mono text-stone-900 underline-offset-2 hover:underline">
                  {d.sku ?? d.unique_code}
                </Link>
                <IntakeStatusBadge status={d.status} />
                <span className="text-stone-500">
                  {people.get(d.approved_by ?? '') ?? '—'}
                  {d.approved_at ? ` · ${format(new Date(d.approved_at), 'd MMM, HH:mm')}` : ''}
                </span>
                {d.approval_status === 'REJECTED' && d.rejection_reason && (
                  <span className="w-full text-stone-600 italic">“{d.rejection_reason}”</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
