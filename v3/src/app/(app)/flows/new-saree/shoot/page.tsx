import Link from 'next/link'
import { requireIntakeSubmit } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'
import {
  edgesFor,
  loadIntakeContext,
  loadVocabulary,
  vocabLabel,
} from '@/app/(app)/intake/_lib/data'
import { IntakeStatusBadge } from '@/app/(app)/intake/_components/intake-status-badge'
import { TransitionControls } from '@/app/(app)/intake/_components/transition-controls'
import { loadFlowSaree } from '../_lib/saree'

export const metadata = { title: 'Photograph it · Nerige' }

/**
 * Step 3: the camera.
 *
 * The moves are the existing ones — `transition_intake` and the same
 * `TransitionControls` the shooting board uses — narrowed to the ones that
 * belong to this step. "Send to review" is deliberately not among them: that is
 * step 4, and putting it here would let somebody finish the flow without ever
 * seeing the step that says what sending means.
 *
 * One saree, not a board. The board at /warehouse/shooting still exists and is
 * the right screen for working through a pile; this is the saree in your hand.
 */
export default async function ShootPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const user = await requireIntakeSubmit()
  const { code } = await searchParams
  const supabase = await createClient()

  const [{ row, problem }, context, vocab] = await Promise.all([
    loadFlowSaree(supabase, user.id, code),
    loadIntakeContext(supabase),
    loadVocabulary(supabase),
  ])

  const hrefs = {
    details: withFlow('/intake/new', 'new-saree'),
    code: row ? `/flows/new-saree/code?code=${row.unique_code}` : '/flows/new-saree/code',
    shoot: '/flows/new-saree/shoot',
    approve: row ? `/flows/new-saree/approve?code=${row.unique_code}` : '/flows/new-saree/approve',
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <FlowStepper flow="new-saree" current={3} hrefs={hrefs} />
        <EmptyState
          title="No saree to photograph yet"
          body={problem ?? 'Nothing has been saved from this account. Enter the saree first; it arrives here with its code on it.'}
          action={
            <Link href={withFlow('/intake/new', 'new-saree')}>
              <Button>Enter a saree</Button>
            </Link>
          }
        />
      </div>
    )
  }

  // Everything this person may do to this saree, minus the move that IS step 4.
  const edges = edgesFor(user.role, row.status).filter((e) => e.to !== 'READY_FOR_REVIEW')
  const vendorCode = context.vendors.find((v) => v.id === row.vendor_id)?.code ?? '—'

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <FlowStepper flow="new-saree" current={3} hrefs={hrefs} />

      <PageHeader
        title="Photograph it"
        subtitle="Shoot the saree, then record how many photographs were taken."
        action={<IntakeStatusBadge status={row.status} />}
      />

      {problem && <Alert tone="error">{problem}</Alert>}

      <div className="rounded-xl border border-stone-200 p-4">
        <p className="font-mono text-4xl font-semibold text-stone-900 tabular-nums">{row.unique_code}</p>
        <p className="font-mono text-sm break-all text-stone-600">{row.sku}</p>
        <p className="mt-2 text-sm text-stone-700">
          {vendorCode} · {vocabLabel(vocab, 'collection', row.collection_code)} ·{' '}
          {vocabLabel(vocab, 'fabric', row.fabric_code)} ·{' '}
          {vocabLabel(vocab, 'colour', row.colour_code)}
        </p>
        <p className="mt-1 text-xs text-stone-500 tabular-nums">
          {row.image_count > 0
            ? `${row.image_count} photograph${row.image_count === 1 ? '' : 's'} recorded so far`
            : 'No photographs recorded yet'}
        </p>
      </div>

      <Alert>
        Photographs are not uploaded here. They go into the saree&apos;s Google Drive folder, and the
        Drive → Shopify pipeline is not wired yet — the count below is what the reviewer checks
        against, and nothing about it reaches Shopify.
      </Alert>

      {row.status === 'DRAFT' ? (
        <Alert tone="error">
          This is still a draft, so it has no code on the fabric and cannot be shot. Complete it
          first.
        </Alert>
      ) : edges.length === 0 ? (
        <Alert>
          Nothing to do at this step: this saree is {row.status === 'REJECTED' ? 'back from review' : 'past the camera'}. Step 4
          says where it stands.
        </Alert>
      ) : (
        <TransitionControls
          uniqueCode={row.unique_code}
          status={row.status}
          edges={edges}
          imageCount={row.image_count}
          minImagesForReview={context.minImagesForReview}
        />
      )}

      <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-4">
        {row.status === 'DRAFT' ? (
          <Link href={`${withFlow('/intake/new', 'new-saree')}&draft=${row.unique_code}`}>
            <Button>Complete the draft</Button>
          </Link>
        ) : (
          <Link href={hrefs.approve}>
            <Button>Photographed — send it for approval</Button>
          </Link>
        )}
        <Link href="/warehouse/shooting">
          <Button variant="secondary">Everything waiting for the camera</Button>
        </Link>
      </div>
    </div>
  )
}
