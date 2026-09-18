import Link from 'next/link'
import { requireIntakeSubmit } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'
import { IntakeStatusBadge } from '@/app/(app)/intake/_components/intake-status-badge'
import { loadFlowSaree, splitSku } from '../_lib/saree'

export const metadata = { title: 'Write the code' }

/**
 * Step 2: the number that goes on the fabric.
 *
 * This screen has one job and shows almost nothing else. Somebody is holding a
 * marker over a saree, and the only thing that matters is that 16001 does not
 * become 16007 — a misread code is a saree whose photographs are filed against
 * another saree, and that is not found for weeks.
 *
 * So: monospace, enormous, tabular numerals, and the SKU beneath it with its
 * tail carrying the same number in the same weight. Everything else on the
 * screen is grey on purpose.
 */
export default async function WriteTheCodePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const user = await requireIntakeSubmit()
  const { code } = await searchParams
  const supabase = await createClient()

  const { row, problem } = await loadFlowSaree(supabase, user.id, code)

  const hrefs = {
    details: withFlow('/intake/new', 'new-saree'),
    code: '/flows/new-saree/code',
    shoot: row ? `/flows/new-saree/shoot?code=${row.unique_code}` : '/flows/new-saree/shoot',
    approve: row ? `/flows/new-saree/approve?code=${row.unique_code}` : '/flows/new-saree/approve',
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <FlowStepper flow="new-saree" current={2} hrefs={hrefs} />
        <EmptyState
          title="No saree to write a code on yet"
          body={problem ?? 'Nothing has been saved from this account. Enter the saree on the table first, and its code appears here.'}
          action={
            <Link href={withFlow('/intake/new', 'new-saree')}>
              <Button>Enter the saree</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const { head, tail } = splitSku(row.sku, row.unique_code)

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <FlowStepper flow="new-saree" current={2} hrefs={hrefs} />

      <PageHeader
        title="Write this on the fabric"
        subtitle="By hand, on the saree in front of you. Check it digit by digit before you move on."
        action={<IntakeStatusBadge status={row.status} />}
      />

      {problem && <Alert tone="error">{problem}</Alert>}

      <div className="rounded-2xl border-2 border-stone-900 bg-white p-6 text-center">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">Unique code</p>
        <p className="mt-2 font-mono text-7xl font-semibold tracking-tight text-stone-900 tabular-nums">
          {row.unique_code}
        </p>
        {row.sku && (
          <p className="mt-4 font-mono text-xl break-all sm:text-2xl">
            <span className="text-stone-500">{head}</span>
            <span className="font-semibold text-stone-900">{tail}</span>
          </p>
        )}
        <p className="mt-3 text-sm text-stone-500">
          The last part of the SKU is the same number. That is the only part that tells this saree
          apart from the next one off the same loom.
        </p>
      </div>

      <Alert>
        Nothing has reached Shopify. Creating the Shopify product, the AI name and description, the
        Drive folder and the EasyEcom listing are not automated yet — this code exists in Nerige and
        on the fabric, and nowhere else.
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Link href={hrefs.shoot}>
          <Button>The code is on the fabric — photograph it</Button>
        </Link>
        <Link href={`/intake/${row.unique_code}`}>
          <Button variant="secondary">Open this saree</Button>
        </Link>
      </div>
    </div>
  )
}
