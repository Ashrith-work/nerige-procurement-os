import Link from 'next/link'
import { format } from 'date-fns'
import { requireIntakeSubmit } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, EmptyState, LinkButton, PageHeader } from '@/components/ui/primitives'
import { STAGE_STATUSES, type IntakeStatus } from '@/lib/intake/status'
import {
  edgesFor,
  INTAKE_LIST_COLUMNS,
  loadIntakeContext,
  loadVocabulary,
  vocabLabel,
  type IntakeListRow,
  type Vocabulary,
} from '../../intake/_lib/data'
import { IntakeStatusBadge } from '../../intake/_components/intake-status-badge'
import { TransitionControls } from '../../intake/_components/transition-controls'

export const metadata = { title: 'Shooting' }

const LIMIT = 300

interface Group {
  title: string
  body: string
  statuses: readonly IntakeStatus[]
}

/**
 * The photography stage of intake: what is waiting to be shot, what has been
 * shot and needs its photographs counted and sent on, and what is with review.
 *
 * Warehouse manager and owner, matching `app.can_submit_intake()`. Any warehouse
 * manager may shoot any saree — shooting is shared floor work, and
 * `transition_intake` (migration 035) admits it that way.
 *
 * Grouped by what to DO rather than by status, and oldest first within each
 * group, because the saree that has sat on the shelf longest is the one to pick
 * up next. The Unique Code is the biggest thing on each card: it is what is
 * written on the fabric in the pile, and the only thing that matches a card to
 * a saree.
 */
const GROUPS: Group[] = [
  {
    title: 'To shoot',
    body: 'Code on the fabric, not photographed yet.',
    statuses: STAGE_STATUSES.shoot,
  },
  {
    title: 'Shot — photos to count and send to review',
    body: 'Count the photographs taken, then send to review.',
    statuses: STAGE_STATUSES.upload,
  },
  {
    title: 'With review',
    body: 'Waiting for procurement. Take one back if a photo needs redoing.',
    statuses: ['READY_FOR_REVIEW'],
  },
  {
    title: 'Sent back',
    body: 'Rejected at review. Read why, then reshoot.',
    statuses: ['REJECTED'],
  },
]

export default async function ShootingPage() {
  const user = await requireIntakeSubmit()
  const supabase = await createClient()

  const statuses = GROUPS.flatMap((g) => [...g.statuses])
  const [{ data, error }, context, vocab] = await Promise.all([
    supabase
      .from('product_intakes')
      .select(INTAKE_LIST_COLUMNS)
      .in('status', statuses)
      .order('updated_at', { ascending: true })
      .limit(LIMIT),
    loadIntakeContext(supabase),
    loadVocabulary(supabase),
  ])

  const rows = (data ?? []) as unknown as IntakeListRow[]
  const vendorCode = new Map(context.vendors.map((v) => [v.id, v.code]))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Shooting"
        subtitle="Photograph each saree, count the photos, send it to review."
        action={<LinkButton href="/intake/queue">Sarees being added</LinkButton>}
      />

      <Alert>
        Photographs are not uploaded here. They go into the saree&apos;s Google Drive folder, and the Drive → Shopify
        pipeline is not wired yet — so recording a count here puts nothing on Shopify. The count is what the reviewer
        checks against.
      </Alert>

      {error && (
        <Alert tone="error">
          The board could not be loaded, so it may be showing nothing when sarees are waiting.
          Reload the page; if it keeps happening, tell a developer: {error.message}
        </Alert>
      )}

      {rows.length === 0 && !error ? (
        <EmptyState
          title="Nothing waiting for the camera"
          body="A saree appears here the moment it is saved with a Unique Code. Write the code on the fabric, add it, and it will be waiting when you pick up the camera."
          action={
            <LinkButton href="/intake/new" variant="primary">
              Add a saree
            </LinkButton>
          }
        />
      ) : (
        GROUPS.map((group) => {
          const items = rows.filter((r) => group.statuses.includes(r.status))
          return (
            <section key={group.title} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-medium text-stone-900">
                  {group.title} <span className="text-stone-600 tabular-nums">{items.length}</span>
                </h2>
              </div>
              <p className="text-sm text-stone-600">{group.body}</p>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-600">
                  Nothing here.
                </p>
              ) : (
                <ul className="space-y-3">
                  {items.map((r) => (
                    <ShootCard
                      key={r.unique_code}
                      row={r}
                      vendorCode={vendorCode.get(r.vendor_id) ?? '—'}
                      vocab={vocab}
                      edges={edgesFor(user.role, r.status)}
                      minImages={context.minImagesForReview}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}

function ShootCard({
  row,
  vendorCode,
  vocab,
  edges,
  minImages,
}: {
  row: IntakeListRow
  vendorCode: string
  vocab: Vocabulary
  edges: ReturnType<typeof edgesFor>
  minImages: number
}) {
  return (
    <li className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={`/intake/${row.unique_code}`} className="min-w-0">
          <p className="font-mono text-4xl font-semibold tabular-nums text-stone-900">{row.unique_code}</p>
          <p className="font-mono text-sm break-all text-stone-600">{row.sku}</p>
        </Link>
        <IntakeStatusBadge status={row.status} />
      </div>
      <p className="text-sm text-stone-700">
        {vendorCode} · {vocabLabel(vocab, 'collection', row.collection_code)} · {vocabLabel(vocab, 'fabric', row.fabric_code)} ·{' '}
        {vocabLabel(vocab, 'colour', row.colour_code)}
      </p>
      <p className="text-xs text-stone-600 tabular-nums">
        {row.image_count > 0 ? `${row.image_count} photos recorded · ` : ''}
        Here since {format(new Date(row.updated_at), 'd MMM, HH:mm')}
      </p>
      {row.status === 'REJECTED' && row.rejection_reason && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Why: {row.rejection_reason}</p>
      )}
      {edges.length > 0 ? (
        <TransitionControls
          uniqueCode={row.unique_code}
          status={row.status}
          edges={edges}
          imageCount={row.image_count}
          minImagesForReview={minImages}
        />
      ) : (
        row.status !== 'READY_FOR_REVIEW' &&
        row.status !== 'REJECTED' && (
          <p className="text-sm text-stone-600">Nothing for you to do on this one yet.</p>
        )
      )}
    </li>
  )
}
