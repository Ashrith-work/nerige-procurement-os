'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { computeMrp, formatRupees } from '@/lib/intake/pricing'
import { previewSku } from '@/lib/intake/sku'
import { saveIntake, type SaveIntakeState } from './actions'

export interface FormVendor {
  id: string
  code: string
  displayName: string
}

export interface FormOption {
  code: string
  value: string
}

export interface FormVocabulary {
  collection: FormOption[]
  fabric: FormOption[]
  colour: FormOption[]
  product_type: FormOption[]
  pattern: FormOption[]
  border: FormOption[]
  pallu: FormOption[]
}

export interface DraftDefaults {
  uniqueCode: number
  vendorId: string
  collection: string
  fabric: string
  colour: string
  productType: string
  pattern: string
  border: string
  pallu: string
  costPrice: string
  note: string
}

const INITIAL: SaveIntakeState = { status: 'idle' }

/**
 * The new-saree form, for a phone held in one hand at the warehouse table.
 *
 * THE KEY. `intake_key` arrives from the server, generated when the page
 * rendered, and is held in state so a refresh of this route's data cannot swap
 * it out from under a form mid-submission. A double tap sends the same key
 * twice and the database answers the second with the first saree's code. The
 * only thing that mints a new key is "Enter another saree", which is the moment
 * a new saree genuinely begins.
 *
 * THE RESULT. The Unique Code is shown enormous, because the next thing that
 * happens is somebody copying it onto the fabric by hand, and a 16001 misread as
 * 16007 is a saree whose photographs are filed under another saree.
 */
export function IntakeForm({
  initialKey,
  vendors,
  vocabulary,
  markupMultiplier,
  roundingNearest,
  skuSeparator,
  draft,
}: {
  initialKey: string
  vendors: FormVendor[]
  vocabulary: FormVocabulary
  markupMultiplier: number
  roundingNearest: number
  skuSeparator: string
  draft: DraftDefaults | null
}) {
  const [intakeKey, setIntakeKey] = useState(initialKey)
  const [formInstance, setFormInstance] = useState(0)
  const [state, action, pending] = useActionState(saveIntake, INITIAL)

  // A result belongs to the key it was saved under; after a reset it is stale.
  const result = state.intakeKey === intakeKey ? state : INITIAL
  const done = result.status === 'created' || result.status === 'promoted' || result.status === 'repeat'

  const startAnother = () => {
    // In an event handler, not during render: a new key per new saree.
    setIntakeKey(`intake_${crypto.randomUUID()}`)
    setFormInstance((n) => n + 1)
  }

  if (done && result.uniqueCode) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border-2 border-stone-900 bg-white p-6 text-center">
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">Write this on the fabric</p>
          <p className="mt-2 font-mono text-7xl font-semibold tracking-tight text-stone-900 tabular-nums">
            {result.uniqueCode}
          </p>
          {result.sku && <p className="mt-3 font-mono text-xl break-all text-stone-800 sm:text-2xl">{result.sku}</p>}
        </div>

        <Alert tone={result.status === 'repeat' ? 'info' : 'success'}>{result.message}</Alert>

        <Alert>
          Next it goes on the <Link className="underline" href="/warehouse/shooting">shooting board</Link>. Nothing has
          been sent to Shopify: creating the Shopify product, the AI name and description, the Drive folder and the
          EasyEcom listing are not automated yet.
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={startAnother}>
            Enter another saree
          </Button>
          <Link
            href={`/intake/${result.uniqueCode}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-900 hover:bg-stone-50"
          >
            Open this saree
          </Link>
        </div>
      </div>
    )
  }

  return (
    <FormBody
      key={formInstance}
      action={action}
      pending={pending}
      result={result}
      intakeKey={intakeKey}
      vendors={vendors}
      vocabulary={vocabulary}
      markupMultiplier={markupMultiplier}
      roundingNearest={roundingNearest}
      skuSeparator={skuSeparator}
      draft={formInstance === 0 ? draft : null}
    />
  )
}

function FormBody({
  action,
  pending,
  result,
  intakeKey,
  vendors,
  vocabulary,
  markupMultiplier,
  roundingNearest,
  skuSeparator,
  draft,
}: {
  action: (formData: FormData) => void
  pending: boolean
  result: SaveIntakeState
  intakeKey: string
  vendors: FormVendor[]
  vocabulary: FormVocabulary
  markupMultiplier: number
  roundingNearest: number
  skuSeparator: string
  draft: DraftDefaults | null
}) {
  const known = (options: FormOption[], code: string | undefined) =>
    code && options.some((o) => o.code === code) ? code : ''

  const [vendorFilter, setVendorFilter] = useState('')
  const [vendorId, setVendorId] = useState(draft?.vendorId ?? '')
  const [collection, setCollection] = useState(known(vocabulary.collection, draft?.collection))
  const [fabric, setFabric] = useState(known(vocabulary.fabric, draft?.fabric))
  const [colour, setColour] = useState(known(vocabulary.colour, draft?.colour))
  const [cost, setCost] = useState(draft?.costPrice ?? '')
  // A draft being reopened is still a draft until the person unticks this.
  const [asDraft, setAsDraft] = useState(draft !== null)

  // The picker is a filter box over a native select: a 52-row dropdown is
  // unusable on a phone, and a native select still gets the phone's own wheel.
  const visibleVendors = useMemo(() => {
    const q = vendorFilter.trim().toLowerCase()
    const matches = q
      ? vendors.filter((v) => v.code.toLowerCase().includes(q) || v.displayName.toLowerCase().includes(q))
      : vendors
    // Keep the chosen weaver selectable even when the filter no longer matches her.
    const chosen = vendors.find((v) => v.id === vendorId)
    return chosen && !matches.includes(chosen) ? [chosen, ...matches] : matches
  }, [vendors, vendorFilter, vendorId])

  const vendorCode = vendors.find((v) => v.id === vendorId)?.code ?? ''
  const mrp = computeMrp(cost, markupMultiplier, roundingNearest)

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="intake_key" value={intakeKey} />

      {draft && (
        <Alert>
          Completing draft #{draft.uniqueCode}. Its note: “{draft.note}”
        </Alert>
      )}

      <Field label="Weaver" required>
        <Input
          type="search"
          placeholder="Type a code or name to narrow the list"
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
          aria-label="Filter weavers"
        />
        <Select name="vendor_id" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
          <option value="">Choose the weaver…</option>
          {visibleVendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.code} — {v.displayName}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <VocabSelect label="Collection" name="collection_code" options={vocabulary.collection} value={collection} onChange={setCollection} required={!asDraft} />
        <VocabSelect label="Fabric" name="fabric_code" options={vocabulary.fabric} value={fabric} onChange={setFabric} required={!asDraft} />
        <VocabSelect label="Colour" name="colour_code" options={vocabulary.colour} value={colour} onChange={setColour} required={!asDraft} />
        <VocabSelect
          label="Product type"
          name="product_type_code"
          options={vocabulary.product_type}
          defaultValue={known(vocabulary.product_type, draft?.productType)}
          required={!asDraft}
        />
        <VocabSelect label="Pattern" name="pattern_code" options={vocabulary.pattern} defaultValue={known(vocabulary.pattern, draft?.pattern)} />
        <VocabSelect label="Border" name="border_code" options={vocabulary.border} defaultValue={known(vocabulary.border, draft?.border)} />
        <VocabSelect label="Pallu" name="pallu_code" options={vocabulary.pallu} defaultValue={known(vocabulary.pallu, draft?.pallu)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cost price (₹)" required>
          <Input
            name="cost_price"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1200"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            required
          />
        </Field>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-stone-700">MRP</span>
          <p className="flex min-h-11 items-center rounded-lg bg-stone-50 px-3 text-base font-medium text-stone-900">
            {formatRupees(mrp)}
          </p>
          <span className="block text-xs text-stone-500">
            Cost × {markupMultiplier}, rounded up to the nearest ₹{roundingNearest}. Set by the owner.
          </span>
        </div>
      </div>

      <p className="text-sm text-stone-500">
        SKU will be <span className="font-mono text-stone-800">{previewSku({ vendorCode, collectionCode: collection, fabricCode: fabric, colourCode: colour }, skuSeparator)}</span>
      </p>

      <div className="space-y-2 rounded-lg border border-stone-200 p-3">
        <label className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
          <input
            type="checkbox"
            name="as_draft"
            checked={asDraft}
            onChange={(e) => setAsDraft(e.target.checked)}
            className="size-5"
          />
          Something is not in the list — save as a draft
        </label>
        {asDraft && (
          <Field label="What is missing?" hint="The owner adds it at master data; then you complete the draft." required>
            <Textarea name="draft_note" rows={3} maxLength={1000} required defaultValue={draft?.note ?? ''} placeholder="e.g. Colour: teal with gold — not in the colour list" />
          </Field>
        )}
      </div>

      {result.status === 'error' && <Alert tone="error">{result.message}</Alert>}
      {result.status === 'draft_saved' && (
        <Alert tone="success">
          {result.message} Draft #{result.uniqueCode}.
        </Alert>
      )}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Saving…' : asDraft ? 'Save draft' : 'Save and get the code'}
      </Button>
    </form>
  )
}

function VocabSelect({
  label,
  name,
  options,
  required,
  value,
  defaultValue,
  onChange,
}: {
  label: string
  name: string
  options: FormOption[]
  required?: boolean
  value?: string
  defaultValue?: string
  onChange?: (code: string) => void
}) {
  const controlled = onChange ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) } : { defaultValue }
  return (
    <Field label={label} required={required} hint={options.length === 0 ? 'No values named yet.' : undefined}>
      <Select name={name} required={required} {...controlled}>
        <option value="">{required ? `Choose ${label.toLowerCase()}…` : 'None'}</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.value} · {o.code}
          </option>
        ))}
      </Select>
    </Field>
  )
}
