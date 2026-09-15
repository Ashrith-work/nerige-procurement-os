import Link from 'next/link'
import { requireIntakeSubmit } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, EmptyState, PageHeader } from '@/components/ui/primitives'
import { MISSING_CODE } from '@/lib/intake/status'
import { canEditDraft } from '@/lib/intake/transitions'
import { loadIntakeContext, loadVocabulary, newIntakeKey, offered, VOCAB_TYPES } from '../_lib/data'
import { IntakeForm, type DraftDefaults, type FormVocabulary } from './intake-form'

export const metadata = { title: 'New saree · Nerige' }

/**
 * A new saree, from the warehouse table.
 *
 * Warehouse manager and owner only, matching `app.can_submit_intake()`. The
 * dropdowns offer named, active master data and nothing else — the same
 * predicate the database enforces — so a value that is not there yet is a
 * draft with a note, never a typed-in code.
 *
 * `?draft=16005` reopens a draft for completion. It carries its own intake key,
 * so completing it updates that row and keeps the code it was given.
 */
export default async function NewIntakePage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const user = await requireIntakeSubmit()
  const { draft: draftParam } = await searchParams
  const supabase = await createClient()

  const [context, vocab] = await Promise.all([loadIntakeContext(supabase), loadVocabulary(supabase)])

  let draft: DraftDefaults | null = null
  let draftKey: string | null = null
  let draftProblem: string | null = null

  if (draftParam) {
    const code = Number(draftParam)
    const { data } = Number.isSafeInteger(code)
      ? await supabase.from('product_intakes').select('*').eq('unique_code', code).maybeSingle()
      : { data: null }

    if (!data) draftProblem = `No saree with code ${draftParam}.`
    else if (data.status !== 'DRAFT') draftProblem = `Saree ${code} is no longer a draft.`
    else if (!canEditDraft(user.role, user.id, data.submitted_by)) draftProblem = 'This draft belongs to someone else.'
    else {
      const code_ = (c: string | null) => (c && c !== MISSING_CODE ? c : '')
      draftKey = data.intake_key
      draft = {
        uniqueCode: code,
        vendorId: data.vendor_id,
        collection: code_(data.collection_code),
        fabric: code_(data.fabric_code),
        colour: code_(data.colour_code),
        productType: code_(data.product_type_code),
        pattern: code_(data.pattern_code),
        border: code_(data.border_code),
        pallu: code_(data.pallu_code),
        costPrice: String(data.cost_price),
        note: data.draft_note ?? '',
      }
    }
  }

  const vendors = context.vendors
    .filter((v) => !v.isPlaceholder && v.status !== 'archived')
    .map((v) => ({ id: v.id, code: v.code, displayName: v.displayName }))

  const vocabulary = Object.fromEntries(
    VOCAB_TYPES.map((t) => [t, offered(vocab, t).map((v) => ({ code: v.code, value: v.value ?? v.code }))]),
  ) as unknown as FormVocabulary

  const nothingNamed = vocabulary.collection.length === 0 || vocabulary.fabric.length === 0 || vocabulary.colour.length === 0 || vocabulary.product_type.length === 0

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={draft ? `Complete draft #${draft.uniqueCode}` : 'New saree'}
        subtitle="Enter what is on the table. The code to write on the fabric appears when you save."
        action={
          <Link href="/intake/queue" className="text-sm text-stone-600 underline-offset-2 hover:underline">
            Intake queue
          </Link>
        }
      />

      {draftProblem && <Alert tone="error">{draftProblem} A new saree is shown instead.</Alert>}

      {nothingNamed && (
        <Alert>
          Some lists are empty because nobody has named those values yet
          {user.role === 'admin' ? (
            <>
              {' '}— name them at <Link className="underline" href="/admin/master-data">master data</Link>.
            </>
          ) : (
            '. Save a draft with a note and the owner will add them.'
          )}
        </Alert>
      )}

      {vendors.length === 0 ? (
        <EmptyState title="No weavers" body="There is no active weaver to submit a saree against." />
      ) : (
        <IntakeForm
          initialKey={draftKey ?? newIntakeKey()}
          vendors={vendors}
          vocabulary={vocabulary}
          markupMultiplier={context.markupMultiplier}
          roundingNearest={context.roundingNearest}
          skuSeparator={context.skuSeparator}
          draft={draft}
        />
      )}
    </div>
  )
}
