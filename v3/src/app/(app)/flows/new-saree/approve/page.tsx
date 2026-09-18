import Link from 'next/link'
import { requireIntakeSubmit } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'
import { edgesFor, loadIntakeContext } from '@/app/(app)/intake/_lib/data'
import { IntakeStatusBadge } from '@/app/(app)/intake/_components/intake-status-badge'
import { TransitionControls } from '@/app/(app)/intake/_components/transition-controls'
import { loadFlowSaree } from '../_lib/saree'

export const metadata = { title: 'Send for approval' }

/**
 * Step 4, and the end of the flow: handing the saree to whoever signs it off.
 *
 * The person who submits and shoots a saree is not the person who approves it —
 * `app.can_review_intake()` excludes the warehouse manager, and so does
 * `requireIntakeReview`. This screen is therefore the end of what the warehouse
 * can do, and it says so rather than leaving somebody waiting for a button that
 * will never appear on their account.
 *
 * Whatever state it lands in, the screen offers the same obvious next thing:
 * the next saree on the table.
 */
export default async function SendForApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const user = await requireIntakeSubmit()
  const { code } = await searchParams
  const supabase = await createClient()

  const [{ row, problem }, context] = await Promise.all([
    loadFlowSaree(supabase, user.id, code),
    loadIntakeContext(supabase),
  ])

  const another = (
    <Link href={withFlow('/intake/new', 'new-saree')}>
      <Button>Add another saree</Button>
    </Link>
  )

  const hrefs = {
    details: withFlow('/intake/new', 'new-saree'),
    code: row ? `/flows/new-saree/code?code=${row.unique_code}` : '/flows/new-saree/code',
    shoot: row ? `/flows/new-saree/shoot?code=${row.unique_code}` : '/flows/new-saree/shoot',
    approve: '/flows/new-saree/approve',
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <FlowStepper flow="new-saree" current={4} hrefs={hrefs} />
        <EmptyState
          title="Nothing to send yet"
          body={problem ?? 'Nothing has been saved from this account. A saree reaches this step once it has a code and its photographs are counted.'}
          action={another}
        />
      </div>
    )
  }

  const edges = edgesFor(user.role, row.status).filter((e) => e.to === 'READY_FOR_REVIEW')
  const sent = row.status === 'READY_FOR_REVIEW'
  const approved = row.status === 'APPROVED' || row.status === 'PUBLISHED'

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <FlowStepper
        flow="new-saree"
        current={4}
        hrefs={hrefs}
        note={
          sent
            ? 'Sent. Procurement decides from here; the saree stays on the intake queue until they do.'
            : approved
              ? 'Approved. This saree is through intake.'
              : undefined
        }
      />

      <PageHeader
        title={sent ? 'Sent for approval' : approved ? 'Approved' : 'Send for approval'}
        subtitle={`Saree ${row.unique_code}`}
        action={<IntakeStatusBadge status={row.status} />}
      />

      {problem && <Alert tone="error">{problem}</Alert>}

      <div className="rounded-xl border border-stone-200 p-4">
        <p className="font-mono text-3xl font-semibold text-stone-900 tabular-nums">{row.unique_code}</p>
        <p className="font-mono text-sm break-all text-stone-600">{row.sku}</p>
        <p className="mt-1 text-sm text-stone-600 tabular-nums">
          {row.image_count} photograph{row.image_count === 1 ? '' : 's'} recorded · review needs at
          least {Math.max(1, context.minImagesForReview)}
        </p>
      </div>

      {row.status === 'REJECTED' && (
        <Alert tone="error">
          Sent back at review{row.rejection_reason ? `: ${row.rejection_reason}` : '.'} Fix it, then
          reshoot at step 3.
        </Alert>
      )}

      {sent && (
        <Alert tone="success">
          With procurement now. Nothing has reached Shopify — approval records the decision here, and
          the Shopify product, the AI description and the EasyEcom listing are still done by hand.
        </Alert>
      )}

      {approved && (
        <Alert tone="success">
          Approved. Nothing has reached Shopify: the listing itself is still made by hand.
        </Alert>
      )}

      {edges.length > 0 && (
        <TransitionControls
          uniqueCode={row.unique_code}
          status={row.status}
          edges={edges}
          imageCount={row.image_count}
          minImagesForReview={context.minImagesForReview}
        />
      )}

      {edges.length === 0 && !sent && !approved && row.status !== 'REJECTED' && (
        <Alert>
          This saree is not ready to be sent yet. Count its photographs at step 3 first.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 border-t border-stone-200 pt-4">
        {another}
        <Link href="/intake/queue">
          <Button variant="secondary">Sarees being added</Button>
        </Link>
      </div>
    </div>
  )
}
