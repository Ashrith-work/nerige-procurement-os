import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { requireStaff } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, Button, Card, LinkButton, PageHeader } from '@/components/ui/primitives'
import { formatRupees } from '@/lib/intake/pricing'
import { parseStatusHistory } from '@/lib/intake/history'
import { STATUS_LABELS, type IntakeStatus } from '@/lib/intake/status'
import { canEditDraft } from '@/lib/intake/transitions'
import { resolveProductImage, sizedImage } from '@/lib/products/image'
import { edgesFor, loadIntakeContext, loadPeople, loadVocabulary, vocabLabel } from '../_lib/data'
import { IntakeStatusBadge } from '../_components/intake-status-badge'
import { TransitionControls } from '../_components/transition-controls'
import { resolveIntakeError } from './actions'

export const metadata = { title: 'A saree being added · Nerige' }

interface ErrorRow {
  id: number
  workflow: string
  stage: string
  error_message: string
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
}

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm') : '—')

/**
 * One saree in intake: every field, where it has been, what broke, and what
 * the viewer can do next.
 *
 * THE PIPELINE PANEL IS HONEST ON PURPOSE. Most of the steps between a SKU and
 * a live product — the Shopify product, AI copy, the Drive folder, EasyEcom —
 * belong to the n8n pipeline, which is not wired. Each step says "not
 * automated yet" until its column is actually filled, rather than implying
 * progress by position in a list.
 */
export default async function IntakeDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireStaff()
  const { code: codeParam } = await params
  const code = Number(codeParam)
  if (!Number.isSafeInteger(code) || code <= 0) notFound()

  const supabase = await createClient()
  const { data: row } = await supabase.from('product_intakes').select('*').eq('unique_code', code).maybeSingle()
  if (!row) notFound()

  const status = row.status as IntakeStatus
  const history = parseStatusHistory(row.status_history)

  const [{ data: errorRows }, context, vocab, productResult] = await Promise.all([
    supabase
      .from('intake_errors')
      .select('id, workflow, stage, error_message, resolved, resolved_by, resolved_at, created_at')
      .eq('unique_code', code)
      .order('created_at', { ascending: false })
      .limit(50),
    loadIntakeContext(supabase),
    loadVocabulary(supabase),
    row.sku
      ? supabase
          .from('products')
          .select('sku, title, image_urls, image_url, display_image_position, manual_image_url, crop_json, crop_mode')
          .eq('sku', row.sku)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const errors = (errorRows ?? []) as ErrorRow[]
  const people = await loadPeople(supabase, [
    row.submitted_by,
    row.approved_by,
    ...history.map((h) => h.by),
    ...errors.map((e) => e.resolved_by),
  ])
  const name = (id: string | null) => (id ? (people.get(id) ?? 'Someone') : '—')

  const vendor = context.vendors.find((v) => v.id === row.vendor_id)
  const product = productResult.data
  const image = product
    ? sizedImage(
        resolveProductImage({
          imageUrls: product.image_urls,
          displayImagePosition: product.display_image_position,
          manualImageUrl: product.manual_image_url,
          cropJson: product.crop_json,
          cropMode: product.crop_mode,
          imageUrl: product.image_url,
        }).url,
        400,
      )
    : null

  const edges = edgesFor(user.role, status)
  const editableDraft = status === 'DRAFT' && canEditDraft(user.role, user.id, row.submitted_by)

  const pipeline: { step: string; done: boolean; detail: string }[] = [
    { step: 'Unique Code and SKU', done: Boolean(row.sku), detail: row.sku ?? 'Draft — assigned when completed' },
    {
      step: 'Shopify product',
      done: Boolean(row.shopify_product_id),
      detail: row.shopify_product_id ?? 'Not automated yet — no Shopify product has been created',
    },
    {
      step: 'AI name and description',
      done: Boolean(row.product_name),
      detail: row.product_name ?? 'Not automated yet',
    },
    { step: 'Drive folder', done: Boolean(row.drive_folder_id), detail: row.drive_folder_id ?? 'Not automated yet' },
    {
      step: 'EasyEcom listing',
      done: Boolean(row.easyecom_product_id),
      detail: row.easyecom_product_id ? `${row.easyecom_product_id} · ${row.mapping_status}` : 'Not automated yet',
    },
    {
      step: 'Photographs',
      done: row.image_count > 0,
      detail: row.image_count > 0 ? `${row.image_count} recorded by the warehouse (${row.img_status})` : 'Not shot yet',
    },
    {
      step: 'Review',
      done: row.approval_status === 'APPROVED',
      detail:
        row.approval_status === 'PENDING'
          ? 'Not decided'
          : `${row.approval_status} by ${name(row.approved_by)} · ${when(row.approved_at)}`,
    },
    {
      step: 'Published to the store',
      done: row.publish_status === 'PUBLISHED',
      detail: row.published_at ? when(row.published_at) : 'Not automated yet — publishing is done in Shopify by hand',
    },
  ]

  const fields: [string, string][] = [
    ['Weaver', vendor ? `${vendor.displayName} (${vendor.code})` : '—'],
    ['Collection', vocabLabel(vocab, 'collection', row.collection_code)],
    ['Fabric', vocabLabel(vocab, 'fabric', row.fabric_code)],
    ['Colour', vocabLabel(vocab, 'colour', row.colour_code)],
    ['Product type', vocabLabel(vocab, 'product_type', row.product_type_code)],
    ['Pattern', vocabLabel(vocab, 'pattern', row.pattern_code)],
    ['Border', vocabLabel(vocab, 'border', row.border_code)],
    ['Pallu', vocabLabel(vocab, 'pallu', row.pallu_code)],
    ['Cost price', formatRupees(row.cost_price)],
    ['MRP', `${formatRupees(row.mrp)} ${row.currency}`],
    ['Product name', row.product_name ?? '—'],
    ['SEO title', row.seo_title ?? '—'],
    ['Tags', row.tags ?? '—'],
    ['Shopify variant', row.shopify_variant_id ?? '—'],
    ['Shopify inventory item', row.shopify_inventory_item_id ?? '—'],
    ['EasyEcom SKU', row.easyecom_sku ?? '—'],
    ['Drive raw / edited', [row.drive_raw_folder_id, row.drive_edited_folder_id].filter(Boolean).join(' / ') || '—'],
    ['Image status', `${row.img_status} · ${row.image_count} photos`],
    ['Approval', row.approval_status],
    ['Rejection reason', row.rejection_reason ?? '—'],
    ['Publish', row.publish_status],
    ['Retries', String(row.retry_count)],
    ['Submitted by', name(row.submitted_by)],
    ['Created', when(row.created_at)],
    ['Last updated', when(row.updated_at)],
    ['Submission key', row.intake_key],
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={row.sku ?? `Draft #${code}`}
        subtitle={`Unique Code ${code}`}
        action={<LinkButton href="/intake/queue">Sarees being added</LinkButton>}
      />

      <div className="flex flex-wrap items-start gap-5">
        <div className="relative flex h-40 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stone-100">
          {image ? (
            <Image src={image} alt={product?.title ?? row.sku ?? ''} fill sizes="128px" className="object-cover" unoptimized />
          ) : (
            <span className="px-2 text-center text-xs text-stone-600">No photo in the system yet</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-mono text-5xl font-semibold tabular-nums">{code}</p>
          <IntakeStatusBadge status={status} className="text-sm" />
          {row.draft_note && status === 'DRAFT' && <p className="text-sm text-stone-600 italic">Waiting for: “{row.draft_note}”</p>}
        </div>
      </div>

      {row.error_status && (
        <Alert tone="error">
          <strong>Failed at {row.error_stage}</strong>
          {row.error_message ? ` — ${row.error_message}` : ''}
          {row.last_attempt_at ? ` (last tried ${when(row.last_attempt_at)})` : ''}
        </Alert>
      )}

      {(edges.length > 0 || editableDraft) && (
        <Card className="space-y-3">
          <h2 className="text-sm font-medium text-stone-700">Next step</h2>
          {editableDraft && (
            <Link
              href={`/intake/new?draft=${code}`}
              className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
            >
              Complete this draft
            </Link>
          )}
          <TransitionControls
            uniqueCode={code}
            status={status}
            edges={edges}
            imageCount={row.image_count}
            minImagesForReview={context.minImagesForReview}
          />
        </Card>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-stone-700">Pipeline</h2>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {pipeline.map((p) => (
            <li key={p.step} className="flex gap-3 px-4 py-2.5 text-sm">
              {/* The dot is decoration; the state is said in words for anyone
                  who cannot see a colour or a filled circle. */}
              <span aria-hidden className={p.done ? 'text-emerald-700' : 'text-stone-400'}>
                {p.done ? '●' : '○'}
              </span>
              <span className="sr-only">{p.done ? 'Done: ' : 'Not done yet: '}</span>
              <span className="w-44 shrink-0 text-stone-700">{p.step}</span>
              <span className="min-w-0 break-words text-stone-600">{p.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-stone-700">Timeline</h2>
        {history.length === 0 ? (
          <p className="text-sm text-stone-500">No recorded history.</p>
        ) : (
          <ol className="space-y-2 border-l border-stone-200 pl-4">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="text-sm">
                <span className="font-medium text-stone-900">{STATUS_LABELS[h.status]}</span>
                <span className="text-stone-500">
                  {' '}· {when(h.at)}
                  {h.by ? ` · ${name(h.by)}` : ''}
                </span>
                {h.note && <p className="text-stone-600 italic">“{h.note}”</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-stone-700">Details</h2>
        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-stone-500">{label}</dt>
              <dd className="break-words text-stone-900">{value}</dd>
            </div>
          ))}
        </dl>
        {row.product_description && (
          <details className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer text-stone-700">Description</summary>
            <p className="mt-2 whitespace-pre-line text-stone-700">{row.product_description}</p>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-stone-700">Error history</h2>
        {errors.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing has failed for this saree.</p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {errors.map((e) => (
              <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
                <p>
                  <span className="font-medium text-stone-900">{e.stage}</span>
                  <span className="text-stone-500"> · {e.workflow} · {when(e.created_at)}</span>
                </p>
                <p className="text-red-700">{e.error_message}</p>
                {e.resolved ? (
                  <p className="text-xs text-emerald-700">
                    Resolved by {name(e.resolved_by)} · {when(e.resolved_at)}
                  </p>
                ) : (
                  user.role === 'admin' && (
                    <form action={resolveIntakeError}>
                      <input type="hidden" name="error_id" value={e.id} />
                      <input type="hidden" name="unique_code" value={code} />
                      <Button type="submit" variant="ghost" className="px-2">
                        Mark resolved
                      </Button>
                    </form>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
